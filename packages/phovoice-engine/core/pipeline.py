"""PhoVoice AI — Core Transcription Pipeline Engine.
Coordinates:
  Uploaded Audio -> Universal Normalization -> Silero VAD -> Sherpa-ONNX ASR
  -> ViBERT-Capu Punctuation -> Normalization & Context Correction -> Segments/Timestamps.
Preloads all models once at startup and reuses across concurrent requests.
"""
from __future__ import annotations

import logging
import os
import re
import time
from typing import Any, Dict, List, Optional, Tuple, Union

import numpy as np

import config
from core.audio_utils import decode_audio_to_16k_mono
from core.vietnamese_itn import VietnameseITN

logger = logging.getLogger("phovoice.pipeline")

# Canonical Model Map
MODEL_PROFILES = {
    "68M": {
        "dir": "sherpa-onnx-zipformer-vi-2025-04-20",
        "name": "Zipformer 68M (Balanced / Full Accuracy)",
        "default": True,
    },
    "30M": {
        "dir": "zipformer-30m-rnnt-6000h",
        "name": "Zipformer 30M (Ultra Fast / Low Latency)",
        "default": False,
    },
    "VI-EN": {
        "dir": "nghiasr-int8",
        "name": "NghiASR INT8 (Vietnamese - English Bilingual)",
        "default": False,
    },
    "MULTILINGUAL": {
        "dir": "pengcheng-starling-multilingual",
        "name": "PengCheng Starling (Multilingual)",
        "default": False,
    },
}

STREAMING_MODEL_DIR = "zipformer-30m-rnnt-streaming-6000h"


class PhoVoicePipeline:
    """Enterprise-grade PhoVoice Transcription Pipeline with Preloaded Models."""

    def __init__(self, models_dir: Optional[str] = None):
        self.models_dir = models_dir or config.MODELS_DIR
        self._offline_recognizers: Dict[str, Any] = {}
        self._streaming_recognizer: Any = None
        self._vad_detector: Any = None
        self._vad_window_size: int = 512
        self._punct_engine: Any = None
        self._context_corrector: Any = None
        self._is_ready: bool = False

    def is_loaded(self) -> bool:
        return self._is_ready

    def preload_all(self):
        """Preload models into RAM/VRAM during application startup."""
        logger.info("🚀 Preloading PhoVoice models into RAM...")
        t0 = time.perf_counter()

        # 1. Silero VAD
        try:
            self._get_vad()
            logger.info("✅ Silero VAD loaded.")
        except Exception as e:
            logger.warning(f"Silero VAD load warning: {e}")

        # 2. Default Offline ASR (68M)
        try:
            self._get_offline_recognizer("68M")
            logger.info("✅ Sherpa-ONNX 68M ASR loaded.")
        except Exception as e:
            logger.warning(f"ASR 68M load warning: {e}")

        # 3. Streaming ASR
        try:
            self._get_streaming_recognizer()
            logger.info("✅ Sherpa-ONNX 30M Streaming ASR loaded.")
        except Exception as e:
            logger.warning(f"Streaming ASR load warning: {e}")

        # 4. ViBERT-Capu Punctuation Engine
        try:
            self._get_punct_engine()
            logger.info("✅ ViBERT-Capu Punctuation Engine loaded.")
        except Exception as e:
            logger.warning(f"Punctuation Engine load warning: {e}")

        self._is_ready = True
        elapsed = time.perf_counter() - t0
        logger.info(f"✨ PhoVoice Pipeline ready in {elapsed:.2f}s!")

    # ─── Internal Model Loaders (Singletons) ─────────────────────────────────

    def _get_offline_recognizer(self, model_key: str = "68M") -> Any:
        model_key = model_key.upper()
        if model_key in self._offline_recognizers:
            return self._offline_recognizers[model_key]

        import sherpa_onnx

        profile = MODEL_PROFILES.get(model_key, MODEL_PROFILES["68M"])
        model_subpath = profile["dir"]
        model_path = os.path.join(self.models_dir, model_subpath)

        if not os.path.isdir(model_path):
            # Fallback to 68M or streaming model
            model_path = os.path.join(self.models_dir, MODEL_PROFILES["68M"]["dir"])
            if not os.path.isdir(model_path):
                logger.info("[PhoVoicePipeline] Offline model not found, falling back to 30M streaming model")
                rec = self._get_streaming_recognizer()
                if rec is not None:
                    return rec
                raise FileNotFoundError(f"ASR model directory not found at: {model_path}")

        def pick(kind: str) -> str:
            candidates = sorted(f for f in os.listdir(model_path) if f.startswith(kind))
            if not candidates:
                raise FileNotFoundError(f"Missing {kind}-*.onnx in {model_path}")
            plain = [f for f in candidates if not f.endswith(".opt")]
            return os.path.join(model_path, (plain or candidates)[0])

        try:
            num_threads = min(6, max(2, (os.cpu_count() or 4) // 2))
            recognizer = sherpa_onnx.OfflineRecognizer.from_transducer(
                encoder=pick("encoder"),
                decoder=pick("decoder"),
                joiner=pick("joiner"),
                tokens=os.path.join(model_path, "tokens.txt"),
                num_threads=num_threads,
                sample_rate=16000,
                feature_dim=80,
                decoding_method="modified_beam_search",
            )
            self._offline_recognizers[model_key] = recognizer
            return recognizer
        except Exception as e:
            logger.warning(f"[PhoVoicePipeline] Failed to load offline recognizer ({e}), falling back to streaming model")
            rec = self._get_streaming_recognizer()
            if rec is not None:
                return rec
            raise

    def _get_streaming_recognizer(self) -> Any:
        if self._streaming_recognizer is not None:
            return self._streaming_recognizer

        import sherpa_onnx

        model_dir = os.path.join(self.models_dir, STREAMING_MODEL_DIR)
        if not os.path.isdir(model_dir):
            logger.warning(f"Streaming model directory not found at {model_dir}")
            return None

        self._streaming_recognizer = sherpa_onnx.OnlineRecognizer.from_transducer(
            tokens=os.path.join(model_dir, "tokens.txt"),
            encoder=os.path.join(model_dir, "encoder-epoch-31-avg-11-chunk-64-left-128.fp16.onnx"),
            decoder=os.path.join(model_dir, "decoder-epoch-31-avg-11-chunk-64-left-128.fp16.onnx"),
            joiner=os.path.join(model_dir, "joiner-epoch-31-avg-11-chunk-64-left-128.fp16.onnx"),
            num_threads=2,
            decoding_method="greedy_search",
        )
        return self._streaming_recognizer

    def create_streaming_stream(self) -> Any:
        try:
            rec = self._get_streaming_recognizer()
            if rec:
                return rec.create_stream()
        except Exception as e:
            logger.warning(f"Failed to create streaming stream: {e}")
        return None

    def _get_vad(self) -> Tuple[int, Any]:
        if self._vad_detector is not None:
            return self._vad_window_size, self._vad_detector

        import sherpa_onnx

        vad_dir = os.path.join(self.models_dir, "silero-vad")
        model = os.path.join(vad_dir, "silero_vad_16k_op15.onnx")
        if not os.path.exists(model):
            model = os.path.join(vad_dir, "silero_vad.onnx")
        if not os.path.exists(model):
            return 512, None

        cfg = sherpa_onnx.VadModelConfig()
        cfg.silero_vad.model = model
        cfg.silero_vad.threshold = 0.30
        cfg.silero_vad.min_silence_duration = 0.25  # 250ms silence triggers conversational turn boundary
        cfg.silero_vad.min_speech_duration = 0.15
        cfg.silero_vad.max_speech_duration = 6.5   # 6.5s max speech segment ensures multi-speaker turns are broken down
        cfg.sample_rate = 16000
        win = int(getattr(cfg.silero_vad, "window_size", 512) or 512)

        self._vad_window_size = win
        self._vad_detector = sherpa_onnx.VoiceActivityDetector(cfg, buffer_size_in_seconds=120)
        return self._vad_window_size, self._vad_detector

    def _get_punct_engine(self) -> Any:
        if self._punct_engine is not None:
            return self._punct_engine

        try:
            from core.punctuation.punctuation_engine import PunctuationEngine
            eng = PunctuationEngine(prefer_int8=True)
            eng._ensure_loaded()
            if eng._is_loaded and eng._restorer is not None:
                self._punct_engine = eng
                logger.info("[PhoVoicePipeline] ViBERT-Capu Punctuation Engine initialized successfully.")
                return self._punct_engine
        except Exception as e:
            logger.warning(f"Could not load PunctuationEngine: {e}")

        try:
            from core.punctuation_restorer_improved import ImprovedPunctuationRestorer
            self._punct_engine = ImprovedPunctuationRestorer(prefer_int8=True)
            logger.info("[PhoVoicePipeline] ImprovedPunctuationRestorer initialized successfully.")
        except Exception as e2:
            logger.warning(f"Could not load ViBERT-Capu punctuation model: {e2}")
            self._punct_engine = None

        return self._punct_engine

    def _apply_corrections(self, text: str) -> str:
        """Apply context and technical dictionary correction rules and Vietnamese ITN number formatting."""
        if not text or not text.strip():
            return text

        try:
            # 1. Apply Vietnamese Inverse Text Normalization (Numbers, Currencies, Dates, Percentages)
            text = VietnameseITN.normalize(text)

            # 2. Apply Technical Context Corrections
            if self._context_corrector is None:
                from core.correction.context_corrector import ContextCorrector
                self._context_corrector = ContextCorrector()
            res, _ = self._context_corrector.correct(text)
            return res
        except Exception:
            return text

    def _restore_punctuation(self, text: str, segments: Optional[List[Dict[str, Any]]] = None) -> Tuple[str, List[Dict[str, Any]]]:
        """Apply punctuation restoration on full text and segment by segment."""
        if not text or not text.strip():
            return text, segments or []

        punct = self._get_punct_engine()
        if punct is not None:
            try:
                norm_text = text.lower().strip()
                if hasattr(punct, "restore_punctuation"):
                    punct_text = punct.restore_punctuation(norm_text)
                elif hasattr(punct, "restore"):
                    punct_text = punct.restore(norm_text)
                else:
                    punct_text = norm_text

                if punct_text and not punct_text.isupper():
                    if segments:
                        for seg in segments:
                            s_txt = seg.get("text", "").lower().strip()
                            if s_txt:
                                if hasattr(punct, "restore_punctuation"):
                                    seg["text"] = punct.restore_punctuation(s_txt)
                                elif hasattr(punct, "restore"):
                                    seg["text"] = punct.restore(s_txt)
                    return punct_text, segments or []
            except Exception as e:
                logger.warning(f"Punctuation restoration error: {e}")

        # Regex heuristic capitalization fallback
        t = text.lower().strip()
        sentences = re.split(r'(?<=[.!?])\s+', t)
        capitalized = " ".join(s[0].upper() + s[1:] if len(s) > 0 else s for s in sentences)
        return capitalized, segments or []

    def _perform_speaker_diarization(
        self,
        segment_audios: List[np.ndarray],
        segment_metadata: Optional[List[Dict[str, float]]] = None,
        session_id: Optional[str] = None,
    ) -> List[Tuple[str, str]]:
        """Acoustic feature clustering to distinguish multiple speakers (Speaker Diarization).
        Returns List of (speaker_id, speaker_label) consistent across chunks.
        """
        if not segment_audios:
            return []

        from core.speaker_session import get_speaker_session_manager
        session_mgr = get_speaker_session_manager()
        session_state = session_mgr.get_or_create_session(session_id)

        def extract_feat(chunk: np.ndarray) -> np.ndarray:
            if len(chunk) < 640:
                return np.zeros(24, dtype=np.float32)
            rms = np.sqrt(np.mean(chunk**2) + 1e-9)
            zcr = np.mean(np.abs(np.diff(np.sign(chunk)))) / 2.0
            fft_v = np.abs(np.fft.rfft(chunk[:min(len(chunk), 8192)]))
            freqs = np.fft.rfftfreq(min(len(chunk), 8192), 1.0 / 16000)
            norm_fft = fft_v / (np.sum(fft_v) + 1e-9)
            centroid = np.sum(freqs * norm_fft)
            spread = np.sqrt(np.sum(((freqs - centroid)**2) * norm_fft) + 1e-9)
            bands = np.array_split(fft_v, 20)
            b_energies = [float(np.log(np.mean(b**2) + 1e-6)) for b in bands]
            feat = np.array([rms, zcr, centroid / 4000.0, spread / 2000.0] + b_energies, dtype=np.float32)
            norm = np.linalg.norm(feat)
            return feat / (norm + 1e-9)

        embeddings = [extract_feat(a) for a in segment_audios]
        results: List[Tuple[str, str]] = []

        prev_spk_id: Optional[str] = None
        last_end_s = 0.0

        for i, (emb, audio) in enumerate(zip(embeddings, segment_audios)):
            dur_s = len(audio) / 16000.0
            st_s = segment_metadata[i]["start"] if segment_metadata and i < len(segment_metadata) else 0.0
            pause_s = max(0.0, st_s - last_end_s) if i > 0 else 0.0

            spk_id, spk_label = session_state.match_or_create_speaker(
                embedding=emb,
                duration_s=dur_s,
                prev_speaker_id=prev_spk_id,
                pause_s=pause_s,
            )
            results.append((spk_id, spk_label))
            prev_spk_id = spk_id
            last_end_s = segment_metadata[i]["end"] if segment_metadata and i < len(segment_metadata) else last_end_s + dur_s

        # Apply global cluster reconciliation
        merge_map = session_state.reconcile_and_merge_clusters()
        if merge_map:
            updated_results = []
            for spk_id, spk_label in results:
                target_id = merge_map.get(spk_id, spk_id)
                target_label = session_state.aliases.get(target_id, spk_label)
                updated_results.append((target_id, target_label))
            results = updated_results

        return results

    # ─── Public Transcription Execution ─────────────────────────────────────

    def transcribe(
        self,
        audio_source: Union[str, bytes],
        model: str = "68M",
        punctuate: bool = True,
        normalize: bool = True,
        diarize: bool = False,
        timestamps: bool = True,
        session_id: Optional[str] = None,
        translate: bool = False,
        target_language: str = "en",
    ) -> Dict[str, Any]:
        """Full transcription pipeline execution with Speaker Diarization.
        Returns standardized dictionary conforming to PhoVoice API Schema.
        """
        t0 = time.perf_counter()

        # 1. Decode & normalize audio to 16kHz mono float32
        samples, duration_s = decode_audio_to_16k_mono(audio_source)
        if len(samples) == 0:
            return {
                "text": "",
                "language": "vi",
                "duration": 0.0,
                "processing_time": 0.0,
                "rtf": 0.0,
                "segments": [],
                "features": {
                    "punctuation": punctuate,
                    "normalization": normalize,
                    "timestamps": timestamps,
                    "diarization": diarize,
                    "translation": translate,
                },
            }

        # 2. ASR recognizer & VAD
        recognizer = self._get_offline_recognizer(model)
        vad_win, vad = self._get_vad()

        segments: List[Dict[str, Any]] = []
        segment_audios: List[np.ndarray] = []

        def decode_chunk(chunk_samples: np.ndarray) -> str:
            stream = recognizer.create_stream()
            stream.accept_waveform(16000, np.asarray(chunk_samples, dtype=np.float32))
            recognizer.decode_stream(stream)
            return stream.result.text.strip().lower()

        def text_ok(n_samples: int) -> bool:
            return n_samples >= 1600  # >= 0.1s

        # Run VAD-guided segment recognition
        if vad is not None:
            vad.reset()
            for i in range(0, len(samples), vad_win):
                vad.accept_waveform(samples[i:i + vad_win])
            vad.flush()

            while not vad.empty():
                seg = vad.front
                st_s = seg.start / 16000.0
                end_s = min(st_s + len(seg.samples) / 16000.0, duration_s)
                if text_ok(len(seg.samples)):
                    txt = decode_chunk(seg.samples)
                    if txt:
                        segments.append({
                            "start": round(max(st_s, 0.0), 2),
                            "end": round(end_s, 2),
                            "speaker": "SPEAKER_00",
                            "speaker_label": "Người 1",
                            "text": txt,
                            "confidence": 0.95,
                        })
                        segment_audios.append(np.array(seg.samples, dtype=np.float32))
                vad.pop()

        # Fallback 20s fixed chunking if no VAD segments detected
        if not segments:
            chunk_size = 16000 * 20
            for c_start in range(0, len(samples), chunk_size):
                c_end = min(c_start + chunk_size, len(samples))
                c_samp = samples[c_start:c_end]
                if text_ok(len(c_samp)):
                    txt = decode_chunk(c_samp)
                    if txt:
                        segments.append({
                            "start": round(c_start / 16000.0, 2),
                            "end": round(c_end / 16000.0, 2),
                            "speaker": "SPEAKER_00",
                            "speaker_label": "Người 1",
                            "text": txt,
                            "confidence": 0.90,
                        })
                        segment_audios.append(np.array(c_samp, dtype=np.float32))

        # 3. Speaker Diarization Clustering with cross-chunk consistency
        if diarize and segment_audios and len(segments) == len(segment_audios):
            speaker_results = self._perform_speaker_diarization(
                segment_audios,
                segment_metadata=segments,
                session_id=session_id,
            )
            for seg, (spk_id, spk_label) in zip(segments, speaker_results):
                seg["speaker"] = spk_id
                seg["speaker_label"] = spk_label
        else:
            for seg in segments:
                if "speaker" not in seg:
                    seg["speaker"] = "SPEAKER_00"
                    seg["speaker_label"] = "Người 1"

        raw_full_text = " ".join(s["text"] for s in segments).strip()
        final_text = raw_full_text

        # 4. Context & Technical Normalization
        if normalize and final_text:
            final_text = self._apply_corrections(final_text)
            for seg in segments:
                seg["text"] = self._apply_corrections(seg.get("text", ""))

        # 5. Punctuation Restoration
        if punctuate and final_text:
            final_text, segments = self._restore_punctuation(final_text, segments)

        proc_time = time.perf_counter() - t0
        rtf = round(proc_time / max(duration_s, 1e-6), 3)

        return {
            "text": final_text,
            "language": "vi",
            "duration": round(duration_s, 2),
            "processing_time": round(proc_time, 2),
            "rtf": rtf,
            "provider": "phovoice",
            "segments": segments if timestamps else [],
            "features": {
                "punctuation": punctuate,
                "normalization": normalize,
                "timestamps": timestamps,
                "diarization": diarize,
                "translation": translate,
            },
        }

    def create_streaming_stream(self) -> Optional[Any]:
        """Create a new streaming session stream for WebSocket real-time audio."""
        recognizer = self._get_streaming_recognizer()
        if recognizer is None:
            return None
        return recognizer.create_stream()


# Global Singleton Pipeline instance
_pipeline_instance: Optional[PhoVoicePipeline] = None


def get_pipeline() -> PhoVoicePipeline:
    global _pipeline_instance
    if _pipeline_instance is None:
        _pipeline_instance = PhoVoicePipeline()
    return _pipeline_instance
