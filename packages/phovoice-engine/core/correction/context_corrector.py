"""Context Corrector — Sửa lỗi dựa trên ngữ cảnh câu và chủ đề lớp học (Phase 25.17).
"""
from __future__ import annotations

import re
from typing import Dict, List, Optional, Tuple
from core.correction.base import CorrectionEdit


class ContextCorrector:
    """Sửa các lỗi từ đồng âm/nhầm lẫn dựa vào các từ đi kèm xung quanh."""

    CONTEXT_RULES = [
        # (pattern, replacement, reason, confidence)
        (r'(?i)\b(độ phức tạp|complexity|thời gian chạy)\s+(o\s*[\(\[]?\s*n\s*l[oó]c\s*n\s*[\)\]]?|o\s*n\s*log\s*n)\b',
         r'\1 O(n log n)', "Contextual Big O Complexity", 0.96),
        (r'(?i)\b(độ phức tạp|complexity)\s+(o\s*[\(\[]?\s*1\s*[\)\]]?|o\s*một)\b',
         r'\1 O(1)', "Contextual Big O Constant", 0.96),
        (r'(?i)\b(độ phức tạp|complexity)\s+(o\s*[\(\[]?\s*n\s*[\)\]]?|o\s*en)\b',
         r'\1 O(n)', "Contextual Big O Linear", 0.96),
        (r'(?i)\b(lập trình|code|viết|ngôn ngữ)\s+(xê|c)\s+(cộng\s+cộng|\+\+)\b',
         r'\1 C++', "Contextual Programming Language C++", 0.95),
        (r'(?i)\b(ngôn ngữ|viết bằng|chạy bằng)\s+(bai\s+thơn|pai\s+thon)\b',
         r'\1 Python', "Contextual Programming Language Python", 0.95),
        (r'(?i)\b(triển khai|deploy|chạy trên|đóng gói)\s+(đốc\s+cơ|đóc\s+cơ)\b',
         r'\1 Docker', "Contextual Deployment Tool Docker", 0.95),
        (r'(?i)\b(đẩy lên|push lên|kho chứa|repo)\s+(gít\s+háp|gin\s+háp)\b',
         r'\1 GitHub', "Contextual Version Control GitHub", 0.95),
        (r'(?i)\b(gọi|triệu gọi|endpoint)\s+(ây\s+pi\s+ai|rét\s+api)\b',
         r'\1 REST API', "Contextual Web Service REST API", 0.94),
        (r'(?i)\b(hàm|tổn thất|mất mát)\s+(lốt|lót|lót\s+phanh\s+sừn)\b',
         r'\1 loss function', "Contextual ML Loss Function", 0.93),
        (r'(?i)\b(mô hình|model)\s+bị\s+(âu\s+vơ\s+phít\s+tinh|over\s+fit)\b',
         r'\1 bị overfitting', "Contextual ML Overfitting", 0.94),
    ]

    def __init__(self):
        pass

    def correct(self, text: str, min_confidence: float = 0.85) -> Tuple[str, List[CorrectionEdit]]:
        if not text or not text.strip():
            return text, []

        result_text = text
        edits: List[CorrectionEdit] = []

        for pattern_str, rep_str, reason, conf in self.CONTEXT_RULES:
            if conf >= min_confidence:
                pattern = re.compile(pattern_str)
                matches = list(pattern.finditer(result_text))
                if matches:
                    for m in reversed(matches):
                        orig_slice = m.group(0)
                        start, end = m.span()
                        new_slice = pattern.sub(rep_str, orig_slice)
                        if new_slice != orig_slice:
                            result_text = result_text[:start] + new_slice + result_text[end:]
                            edits.append(CorrectionEdit(
                                original=orig_slice,
                                replacement=new_slice,
                                confidence=conf,
                                reason=reason,
                                start_char=start,
                                end_char=end
                            ))

        return result_text, edits
