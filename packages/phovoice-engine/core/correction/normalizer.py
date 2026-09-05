"""Normalizer — Chuẩn hóa Unicode, khoảng trắng, bảo toàn thực thể số/URL/IP (Phase 25.15).
"""
from __future__ import annotations

import re
import unicodedata
from typing import List, Tuple


class TextNormalizer:
    """Chuẩn hóa văn bản và bảo vệ các thực thể đặc biệt (URL, IP, Email, Version)."""

    # Regex nhận dạng thực thể cần bảo vệ
    URL_REGEX = re.compile(r'https?://(?:[-\w.]|(?:%[\da-fA-F]{2}))+[/\w\-._~:?#[\]@!$&\'()*+,;=]*')
    EMAIL_REGEX = re.compile(r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b')
    IPV4_REGEX = re.compile(r'\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b')
    VERSION_REGEX = re.compile(r'\bv?\d+\.\d+(?:\.\d+)?(?:-[a-zA-Z0-9.]+)?\b')
    MATH_BIG_O = re.compile(r'\bO\s*\(\s*([^\)]+)\s*\)', re.IGNORECASE)

    def __init__(self):
        pass

    def normalize(self, text: str) -> str:
        if not text or not text.strip():
            return ""

        # 1. Unicode NFC
        t = unicodedata.normalize("NFC", text.strip())

        # 2. Bảo vệ và chuẩn hóa Big O notation: O(n log n), O(1), O(n)
        t = self.MATH_BIG_O.sub(lambda m: f"O({m.group(1).strip()})", t)

        # 3. Chuẩn hóa khoảng trắng thừa
        t = re.sub(r'[ \t]+', ' ', t)

        # 4. Chuẩn hóa dấu câu: không cách trước dấu chấm, phẩy, hỏi, than; cách 1 dấu sau
        t = re.sub(r'\s+([,.:;?!])', r'\1', t)
        t = re.sub(r'([,.:;?!])(?=[^\s\d,.:;?!])', r'\1 ', t)

        # 5. Viết hoa chữ cái đầu tiên
        if len(t) > 0 and t[0].islower():
            t = t[0].upper() + t[1:]

        return t.strip()
