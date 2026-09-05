"""Master Correction Pipeline — Điều phối quy trình sửa lỗi ASR và chính tả đa tầng (Phase 25).
"""
from __future__ import annotations

import logging
import time
from typing import Any, Dict, List, Optional

from core.correction.base import CorrectionEdit, CorrectionMode, CorrectionResult
from core.correction.context_corrector import ContextCorrector
from core.correction.normalizer import TextNormalizer
from core.correction.phonetic_matcher import PhoneticMatcher
from core.correction.technical_corrector import TechnicalTermCorrector

logger = logging.getLogger(__name__)


class CorrectionPipeline:
    def __init__(self, mode: CorrectionMode = CorrectionMode.BALANCED):
        self.mode = mode
        self.normalizer = TextNormalizer()
        self.phonetic_matcher = PhoneticMatcher()
        self.technical_corrector = TechnicalTermCorrector()
        self.context_corrector = ContextCorrector()

    def set_mode(self, mode: CorrectionMode) -> None:
        self.mode = mode

    def correct_stream_partial(self, text: str) -> str:
        """Dùng cho luồng Realtime Streaming (Partial results) — chỉ chuẩn hóa nhẹ, không block."""
        if not text or self.mode == CorrectionMode.OFF:
            return text
        return self.normalizer.normalize(text)

    def correct_final(self, text: str, subject: str = "all") -> CorrectionResult:
        """Dùng cho Final Transcript / Offline batch — chạy toàn diện các tầng sửa lỗi."""
        t0 = time.perf_counter()
        raw_text = text or ""
        if not raw_text.strip() or self.mode == CorrectionMode.OFF:
            return CorrectionResult(raw_text=raw_text, corrected_text=raw_text, mode=self.mode, latency_ms=0.0)

        current_text = raw_text
        all_edits: List[CorrectionEdit] = []

        # TẦNG 1: Normalizer (Unicode NFC, whitespace, số & thực thể)
        current_text = self.normalizer.normalize(current_text)

        if self.mode in (CorrectionMode.BALANCED, CorrectionMode.AGGRESSIVE):
            # TẦNG 2: Context Corrector (Khớp ngữ cảnh cụm từ toán học/kỹ thuật)
            current_text, ctx_edits = self.context_corrector.correct(current_text)
            all_edits.extend(ctx_edits)

            # TẦNG 3: Phonetic Matcher (Tiếng bồi → Thuật ngữ chuẩn)
            current_text, phone_edits = self.phonetic_matcher.match_and_replace(current_text)
            all_edits.extend(phone_edits)

            # TẦNG 4: Technical Term Corrector (Viết hoa & chuẩn hóa case)
            current_text, tech_edits = self.technical_corrector.correct(current_text, subject=subject)
            all_edits.extend(tech_edits)

            # TẦNG 5: Re-normalize spacing and punctuation
            current_text = self.normalizer.normalize(current_text)

        elapsed_ms = (time.perf_counter() - t0) * 1000.0
        return CorrectionResult(
            raw_text=raw_text,
            corrected_text=current_text,
            mode=self.mode,
            edits=all_edits,
            latency_ms=elapsed_ms
        )
