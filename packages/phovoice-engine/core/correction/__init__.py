"""Multi-Stage Correction Package (Phase 25).
"""
from core.correction.base import CorrectionEdit, CorrectionMode, CorrectionResult
from core.correction.context_corrector import ContextCorrector
from core.correction.normalizer import TextNormalizer
from core.correction.phonetic_matcher import PhoneticMatcher
from core.correction.pipeline import CorrectionPipeline
from core.correction.technical_corrector import TechnicalTermCorrector

__all__ = [
    "CorrectionMode",
    "CorrectionEdit",
    "CorrectionResult",
    "TextNormalizer",
    "PhoneticMatcher",
    "TechnicalTermCorrector",
    "ContextCorrector",
    "CorrectionPipeline",
]
