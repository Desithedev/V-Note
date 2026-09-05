"""PunctuationEngine — Phục hồi Dấu câu & Viết hoa Tiếng Việt (Phase 9).

Đặc tính:
- Sử dụng mô hình ViBERT-capu ONNX (Int8 hoặc FP32).
- Khôi phục dấu câu: chấm, phẩy, hỏi, than, viết hoa đầu câu & tên riêng.
- Hỗ trợ pause hints: sử dụng khoảng cách thời gian giữa các từ để tối ưu vị trí ngắt câu.
- Không block streaming: chỉ áp dụng cho final segment.
"""
from __future__ import annotations

import logging
import os
import re
from typing import Any, Callable, Dict, List, Optional

logger = logging.getLogger(__name__)


class PunctuationEngine:
    """Engine phục hồi dấu câu tiếng Việt chuẩn hóa."""

    def __init__(self,
                 model_name: str = "dragonSwing/vibert-capu",
                 confidence: float = 0.45,
                 prefer_int8: bool = True,
                 execution_provider: str = "cpu"):
        self.model_name = model_name
        self.confidence = confidence
        self.prefer_int8 = prefer_int8
        self.execution_provider = execution_provider
        self._restorer: Any = None
        self._is_loaded = False

    def _ensure_loaded(self) -> None:
        if self._restorer is None:
            try:
                from core.punctuation_restorer_improved import ImprovedPunctuationRestorer
                self._restorer = ImprovedPunctuationRestorer(
                    confidence=self.confidence,
                    model_name=self.model_name,
                    prefer_int8=self.prefer_int8,
                    execution_provider=self.execution_provider
                )
                self._is_loaded = True
                logger.info("[PunctuationEngine] Nạp mô hình ViBERT-capu thành công.")
            except Exception as e:
                logger.error(f"[PunctuationEngine] Lỗi nạp mô hình: {e}")
                self._restorer = None

    def restore_punctuation(self, text: str, pause_hints: Optional[List[float]] = None) -> str:
        """Thêm dấu câu và viết hoa cho đoạn văn bản tiếng Việt."""
        if not text or not text.strip():
            return ""

        # Luôn luôn chuyển text về lowercase trước khi đưa vào restorer
        clean_text = text.strip()
        if clean_text.isupper() or sum(1 for c in clean_text if c.isupper()) / max(len(clean_text), 1) > 0.5:
            clean_text = clean_text.lower()

        self._ensure_loaded()
        if self._restorer is not None:
            try:
                res = self._restorer.restore(clean_text, pause_hints=pause_hints)
                if res and not res.isupper():
                    return res
            except Exception as e:
                logger.warning(f"[PunctuationEngine] Lỗi xử lý text: {e}")

        # Fallback viết hoa chữ đầu câu nếu không có model
        t = clean_text.lower()
        sentences = re.split(r'(?<=[.!?])\s+', t)
        return " ".join(s[0].upper() + s[1:] if len(s) > 0 else s for s in sentences)


    def restore_segments(self, segments: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Phục hồi dấu câu trên từng segment của transcript."""
        out = []
        for seg in segments:
            item = dict(seg)
            raw_text = item.get("text", "")
            if raw_text:
                item["text"] = self.restore_punctuation(raw_text)
            out.append(item)
        return out
