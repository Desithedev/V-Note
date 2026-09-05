"""Technical Term Corrector — Chuẩn hóa thuật ngữ kỹ thuật theo môn học (Phase 25.10).
"""
from __future__ import annotations

import json
import logging
import os
import re
from typing import Dict, List, Optional, Set, Tuple
from core.correction.base import CorrectionEdit

logger = logging.getLogger(__name__)


class TechnicalTermCorrector:
    def __init__(self, vocab_dir: Optional[str] = None):
        if vocab_dir is None:
            repo_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
            vocab_dir = os.path.join(repo_root, "vocabulary", "subjects")

        self.vocab_dir = vocab_dir
        self.subject_terms: Dict[str, Set[str]] = {}
        self.term_lookup: Dict[str, str] = {}   # lower_term -> canonical_term
        self._load_all_subjects()

    def _load_all_subjects(self) -> None:
        if not os.path.exists(self.vocab_dir):
            return

        for fname in os.listdir(self.vocab_dir):
            if fname.endswith(".json"):
                fpath = os.path.join(self.vocab_dir, fname)
                try:
                    with open(fpath, "r", encoding="utf-8") as f:
                        data = json.load(f)
                        cat = data.get("category", fname[:-5])
                        terms = data.get("terms", [])
                        self.subject_terms[cat] = set(terms)
                        for t in terms:
                            self.term_lookup[t.lower()] = t
                            # Thêm biến thể không dấu cách / có dấu cách
                            no_space = t.lower().replace(" ", "")
                            if no_space != t.lower():
                                self.term_lookup[no_space] = t
                except Exception as e:
                    logger.warning(f"[TechnicalTermCorrector] Lỗi đọc {fname}: {e}")

        logger.info(f"[TechnicalTermCorrector] Đã nạp {len(self.term_lookup)} thuật ngữ chuyên ngành.")

    def correct(self, text: str, subject: str = "all", min_confidence: float = 0.80) -> Tuple[str, List[CorrectionEdit]]:
        """Nhận diện và viết hoa/chuẩn hóa chính xác các thuật ngữ kỹ thuật."""
        if not text or not text.strip() or not self.term_lookup:
            return text, []

        result_text = text
        edits: List[CorrectionEdit] = []

        # Sắp xếp các thuật ngữ theo độ dài giảm dần
        sorted_terms = sorted(self.term_lookup.items(), key=lambda x: len(x[0]), reverse=True)

        for lower_form, canonical in sorted_terms:
            # Tạo regex khớp không phân biệt hoa thường
            # Hỗ trợ cả trường hợp có dấu gạch ngang hoặc cách
            var_pattern = re.escape(lower_form).replace(r'\ ', r'[\s\-]?')
            pattern = re.compile(r'(?i)\b' + var_pattern + r'\b')
            matches = list(pattern.finditer(result_text))

            if matches:
                for m in reversed(matches):
                    orig_slice = m.group(0)
                    if orig_slice != canonical:
                        start, end = m.span()
                        result_text = result_text[:start] + canonical + result_text[end:]
                        edits.append(CorrectionEdit(
                            original=orig_slice,
                            replacement=canonical,
                            confidence=0.92,
                            reason=f"Technical Term Casing/Normalization ('{orig_slice}' → '{canonical}')",
                            start_char=start,
                            end_char=end
                        ))

        return result_text, edits
