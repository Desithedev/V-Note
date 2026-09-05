"""Vietnamese Inverse Text Normalization (ITN) Module.
Converts spoken Vietnamese numbers, dates, times, currencies, and percentages into digits.
Examples:
  - "năm mươi lăm phần trăm" -> "55%"
  - "hai mươi ba" -> "23"
  - "một triệu hai trăm nghìn đồng" -> "1.200.000 đồng"
  - "ngày mười lăm tháng tám năm hai nghìn không trăm hai mươi tư" -> "ngày 15 tháng 8 năm 2024"
  - "không chín không năm một hai ba bốn năm sáu" -> "0905123456"
"""
from __future__ import annotations

import re
from typing import List, Tuple

# Mapping of basic units
UNITS = {
    "không": 0, "linh": 0, "lẻ": 0,
    "một": 1, "mốt": 1,
    "hai": 2,
    "ba": 3,
    "bốn": 4, "tư": 4,
    "năm": 5, "lăm": 5,
    "sáu": 6,
    "bảy": 7, "bẩy": 7,
    "tám": 8,
    "chín": 9,
}

DIGIT_WORDS = {
    "không": "0", "một": "1", "hai": "2", "ba": "3", "bốn": "4", "tư": "4",
    "năm": "5", "sáu": "6", "bảy": "7", "bẩy": "7", "tám": "8", "chín": "9"
}

def parse_vietnamese_number_words(words: List[str]) -> int | None:
    """Parse a list of Vietnamese number words up to billions into an integer."""
    if not words:
        return None
    
    total = 0
    current_billions = 0
    current_millions = 0
    current_thousands = 0
    current_hundreds = 0
    current_val = 0
    
    i = 0
    while i < len(words):
        w = words[i].lower()
        
        if w == "tỷ" or w == "ti":
            chunk = (current_val + current_hundreds + current_thousands + current_millions) or 1
            current_billions += chunk * 1_000_000_000
            current_millions = current_thousands = current_hundreds = current_val = 0
        elif w == "triệu":
            chunk = (current_val + current_hundreds + current_thousands) or 1
            current_millions += chunk * 1_000_000
            current_thousands = current_hundreds = current_val = 0
        elif w in ("nghìn", "ngàn"):
            chunk = (current_val + current_hundreds) or 1
            current_thousands += chunk * 1_000
            current_hundreds = current_val = 0
        elif w == "trăm":
            chunk = current_val or 1
            current_hundreds = chunk * 100
            current_val = 0
        elif w in ("mươi", "chục"):
            chunk = current_val or 1
            current_val = chunk * 10
        elif w == "mười":
            current_val += 10
        elif w in ("linh", "lẻ"):
            pass
        elif w in UNITS:
            current_val += UNITS[w]
        else:
            return None
        i += 1
        
    total = current_billions + current_millions + current_thousands + current_hundreds + current_val
    return total

def format_number_with_dots(n: int) -> str:
    """Format large numbers with dot separators e.g. 1200000 -> 1.200.000"""
    if n >= 10000:
        return f"{n:,}".replace(",", ".")
    return str(n)


class VietnameseITN:
    """Inverse Text Normalization for Vietnamese speech recognition outputs."""

    # Words that form numbers
    NUM_WORDS = set(UNITS.keys()) | {"mươi", "mười", "chục", "trăm", "nghìn", "ngàn", "triệu", "tỷ", "ti"}

    @classmethod
    def normalize_phone_numbers(cls, text: str) -> str:
        """Convert digit sequences like 'không chín không năm một hai ba bốn năm sáu' -> '0905123456'."""
        tokens = text.split()
        out = []
        i = 0
        while i < len(tokens):
            # Check if this token starts a sequence of 4 or more isolated digit words
            j = i
            digits = []
            while j < len(tokens) and tokens[j].lower() in DIGIT_WORDS:
                digits.append(DIGIT_WORDS[tokens[j].lower()])
                j += 1
            
            # If 4 or more consecutive isolated single digits, convert to phone/serial number
            if len(digits) >= 4:
                out.append("".join(digits))
                i = j
            else:
                out.append(tokens[i])
                i += 1
        return " ".join(out)

    @classmethod
    def normalize_percentages(cls, text: str) -> str:
        """Convert 'X phần trăm' -> 'X%'."""
        def repl(match):
            num_str = match.group(1).strip()
            # Convert num_str to digits if words
            words = num_str.split()
            val = parse_vietnamese_number_words(words)
            if val is not None:
                return f"{val}%"
            return f"{num_str}%"

        # Regex for [number words] phần trăm
        pattern = r'\b((?:(?:không|một|mốt|hai|ba|bốn|tư|năm|lăm|sáu|bảy|bẩy|tám|chín|mười|mươi|chục|trăm|linh|lẻ)\s+)+)phần trăm\b'
        text = re.sub(pattern, repl, text, flags=re.IGNORECASE)
        text = re.sub(r'(\d+)\s+phần trăm\b', r'\1%', text, flags=re.IGNORECASE)
        return text

    @classmethod
    def normalize_dates_and_times(cls, text: str) -> str:
        """Convert 'ngày mười lăm tháng tám năm hai nghìn không trăm hai mươi tư' -> 'ngày 15 tháng 8 năm 2024'."""
        # Ngày X
        def repl_day(m):
            words = m.group(1).split()
            v = parse_vietnamese_number_words(words)
            return f"ngày {v}" if v is not None and 1 <= v <= 31 else m.group(0)
        
        text = re.sub(
            r'\bngày\s+((?:không|mồng|mùng|một|mốt|hai|ba|bốn|tư|năm|lăm|sáu|bảy|bẩy|tám|chín|mười|mươi|chục|hai mươi|ba mươi)(?:\s+(?:một|mốt|hai|ba|bốn|tư|năm|lăm|sáu|bảy|bẩy|tám|chín))?)\b',
            repl_day,
            text,
            flags=re.IGNORECASE
        )

        # Tháng Y
        def repl_month(m):
            words = m.group(1).split()
            v = parse_vietnamese_number_words(words)
            return f"tháng {v}" if v is not None and 1 <= v <= 12 else m.group(0)

        text = re.sub(
            r'\btháng\s+((?:một|hai|ba|bốn|tư|năm|sáu|bảy|bẩy|tám|chín|mười|mười một|mười hai))\b',
            repl_month,
            text,
            flags=re.IGNORECASE
        )

        # Năm Z
        def repl_year(m):
            words = m.group(1).split()
            v = parse_vietnamese_number_words(words)
            return f"năm {v}" if v is not None and 1900 <= v <= 2100 else m.group(0)

        text = re.sub(
            r'\bnăm\s+((?:(?:một|hai)\s+nghìn(?:\s+(?:không|lẻ|linh|một|hai|ba|bốn|năm|sáu|bảy|tám|chín|mười|mươi|trăm))*))\b',
            repl_year,
            text,
            flags=re.IGNORECASE
        )

        # Giờ / Phút
        def repl_time(m):
            h_words = m.group(1).split()
            h_val = parse_vietnamese_number_words(h_words)
            p_words = m.group(2).split() if m.group(2) else None
            p_val = parse_vietnamese_number_words(p_words) if p_words else None
            
            if h_val is not None:
                if p_val is not None:
                    return f"{h_val}h{p_val:02d}"
                return f"{h_val}h"
            return m.group(0)

        text = re.sub(
            r'\b((?:không|một|hai|ba|bốn|tư|năm|sáu|bảy|bẩy|tám|chín|mười|mười một|mười hai|mười ba|mười bốn|mười lăm|mười sáu|mười bảy|mười tám|mười chín|hai mươi|hai mươi mốt|hai mươi hai|hai mươi ba|hai mươi bốn))\s+giờ(?:\s+((?:(?:không|lẻ|linh|một|hai|ba|bốn|tư|năm|lăm|sáu|bảy|tám|chín|mười|mươi)\s*)+)(?:phút)?)?\b',
            repl_time,
            text,
            flags=re.IGNORECASE
        )

        return text

    @classmethod
    def normalize_general_numbers(cls, text: str) -> str:
        """Find spans of Vietnamese number words and convert them to digits."""
        words = text.split()
        if not words:
            return text

        result = []
        i = 0
        while i < len(words):
            # Check if words[i] is a number word
            clean_w = re.sub(r'[^\w\s]', '', words[i].lower())
            
            if clean_w in cls.NUM_WORDS:
                # Accumulate consecutive number words
                num_span = [clean_w]
                original_span = [words[i]]
                j = i + 1
                while j < len(words):
                    next_clean = re.sub(r'[^\w\s]', '', words[j].lower())
                    if next_clean in cls.NUM_WORDS:
                        num_span.append(next_clean)
                        original_span.append(words[j])
                        j += 1
                    else:
                        break
                
                # Try parsing the accumulated number span
                # We only convert if:
                # 1. Length of span >= 2 (e.g. "hai mươi", "một trăm", "mười lăm")
                # 2. Or single word is a compound magnitude (e.g. "nghìn", "triệu")
                val = parse_vietnamese_number_words(num_span) if len(num_span) >= 2 else None
                
                if val is not None and val > 0:
                    formatted = format_number_with_dots(val)
                    # Check if the last word had punctuation attached (e.g. "hai mươi,")
                    last_orig = original_span[-1]
                    punct_suffix = re.search(r'([,.:;?!]+)$', last_orig)
                    if punct_suffix:
                        formatted += punct_suffix.group(1)
                    
                    result.append(formatted)
                    i = j
                    continue

            result.append(words[i])
            i += 1

        return " ".join(result)

    @classmethod
    def normalize(cls, text: str) -> str:
        """Full pipeline for Vietnamese Inverse Text Normalization."""
        if not text or not text.strip():
            return text
        
        t = text
        t = cls.normalize_percentages(t)
        t = cls.normalize_dates_and_times(t)
        t = cls.normalize_phone_numbers(t)
        t = cls.normalize_general_numbers(t)
        
        # Clean up any duplicate spacing
        t = re.sub(r'[ \t]+', ' ', t).strip()
        return t
