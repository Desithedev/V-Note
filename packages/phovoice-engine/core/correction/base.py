"""Base data models and interfaces for Multi-Stage Correction Engine (Phase 25).
"""
from __future__ import annotations

import enum
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


class CorrectionMode(str, enum.Enum):
    OFF = "OFF"
    CONSERVATIVE = "CONSERVATIVE"      # Unicode, khoảng trắng, viết hoa cơ bản
    BALANCED = "BALANCED"              # Spelling + Technical terms + Pronunciation aliases (Default)
    AGGRESSIVE = "AGGRESSIVE"          # Contextual reconstruction + Optional LLM


@dataclass
class CorrectionEdit:
    original: str
    replacement: str
    confidence: float
    reason: str
    start_char: int = -1
    end_char: int = -1

    def to_dict(self) -> Dict[str, Any]:
        return {
            "original": self.original,
            "replacement": self.replacement,
            "confidence": round(self.confidence, 3),
            "reason": self.reason,
            "start_char": self.start_char,
            "end_char": self.end_char,
        }


@dataclass
class CorrectionResult:
    raw_text: str
    corrected_text: str
    mode: CorrectionMode = CorrectionMode.BALANCED
    edits: List[CorrectionEdit] = field(default_factory=list)
    latency_ms: float = 0.0

    def to_dict(self) -> Dict[str, Any]:
        return {
            "raw_text": self.raw_text,
            "corrected_text": self.corrected_text,
            "mode": self.mode.value if hasattr(self.mode, "value") else str(self.mode),
            "edits_count": len(self.edits),
            "edits": [e.to_dict() for e in self.edits],
            "latency_ms": round(self.latency_ms, 2),
        }
