"""Phonetic Matcher — Ánh xạ phát âm tiếng bồi / biến thể phiên âm sang chuẩn (Phase 25.11).
"""
from __future__ import annotations

import json
import logging
import os
import re
from typing import Dict, List, Optional, Tuple
from core.correction.base import CorrectionEdit

logger = logging.getLogger(__name__)


class PhoneticMatcher:
    def __init__(self, alias_file: Optional[str] = None):
        if alias_file is None:
            repo_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
            alias_file = os.path.join(repo_root, "vocabulary", "pronunciation_aliases.json")

        self.alias_file = alias_file
        self.aliases: Dict[str, str] = {}
        self._load_aliases()

    def _load_aliases(self) -> None:
        if os.path.exists(self.alias_file):
            try:
                with open(self.alias_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    self.aliases = data.get("aliases", {})
                    logger.info(f"[PhoneticMatcher] Đã nạp {len(self.aliases)} quy tắc phát âm.")
            except Exception as e:
                logger.warning(f"[PhoneticMatcher] Không đọc được file aliases: {e}")
                self.aliases = {}

    def match_and_replace(self, text: str, min_confidence: float = 0.75) -> Tuple[str, List[CorrectionEdit]]:
        """Tìm và thay thế các từ/cụm từ phát âm tiếng bồi bằng thuật ngữ chuẩn."""
        if not text or not text.strip() or not self.aliases:
            return text, []

        result_text = text
        edits: List[CorrectionEdit] = []

        # Sắp xếp các alias theo độ dài giảm dần để ưu tiên cụm từ dài trước (greedy matching)
        sorted_aliases = sorted(self.aliases.items(), key=lambda x: len(x[0]), reverse=True)

        for alias, target in sorted_aliases:
            # Dùng regex boundary để tránh thay thế giữa từ
            pattern = re.compile(r'(?i)\b' + re.escape(alias) + r'\b')
            matches = list(pattern.finditer(result_text))
            if matches:
                # Tính độ tin cậy dựa trên độ dài cụm từ và tính đặc thù
                conf = 0.95 if len(alias.split()) > 1 else 0.88
                if conf >= min_confidence:
                    for m in reversed(matches):
                        orig_slice = m.group(0)
                        start, end = m.span()
                        
                        # Giữ nguyên dấu hoa nếu từ gốc ở đầu câu
                        rep = target
                        if start == 0 or (start > 1 and result_text[start - 2] in '.!?'):
                            if len(rep) > 0 and rep[0].islower():
                                rep = rep[0].upper() + rep[1:]

                        result_text = result_text[:start] + rep + result_text[end:]
                        edits.append(CorrectionEdit(
                            original=orig_slice,
                            replacement=rep,
                            confidence=conf,
                            reason=f"Phonetic Alias Match ('{alias}' → '{target}')",
                            start_char=start,
                            end_char=end
                        ))

        return result_text, edits
