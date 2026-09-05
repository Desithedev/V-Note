"""PhoVoice AI — Audio Decoding, Resampling & Preprocessing.
Converts any incoming audio format (WAV, MP3, M4A, AAC, WEBM, OGG, FLAC) into 16kHz mono PCM.
"""
from __future__ import annotations

import io
import logging
import os
import shutil
import subprocess
import wave
from typing import Tuple, Union

import numpy as np
import urllib.request

logger = logging.getLogger("phovoice.audio")

SAMPLE_RATE = 16000


def _detect_audio_extension(header: bytes) -> str:
    """Detect file extension from magic bytes."""
    if len(header) >= 12 and header[:4] == b"RIFF" and header[8:12] == b"WAVE":
        return ".wav"
    if header.startswith(b"ID3") or (len(header) >= 2 and header[0] == 0xFF and (header[1] & 0xE0) == 0xE0):
        return ".mp3"
    if header.startswith(b"\x1a\x45\xdf\xa3"):
        return ".webm"
    if len(header) >= 8 and header[4:8] == b"ftyp":
        return ".m4a"
    if header.startswith(b"OggS"):
        return ".ogg"
    if header.startswith(b"fLaC"):
        return ".flac"
    return ".wav"


def _clean_mp3_bytes(data: bytes) -> bytes:
    """Strip ID3v1, ID3v2 and trailing metadata to prevent mpg123 resync errors."""
    if len(data) > 128 and data[-128:-125] == b"TAG":
        data = data[:-128]
    if data.startswith(b"ID3") and len(data) > 10:
        size = 0
        for b in data[6:10]:
            size = (size << 7) | (b & 0x7F)
        tag_size = 10 + size
        if len(data) > tag_size:
            data = data[tag_size:]
    return data


def _get_ffmpeg_path() -> str | None:
    """Locate portable ffmpeg executable if available."""
    # 1. Local bin or project directory
    local_candidates = [
        os.path.join(os.path.dirname(__file__), "..", "bin", "ffmpeg.exe"),
        os.path.join(os.path.dirname(__file__), "..", "ffmpeg.exe"),
        os.path.join(os.path.dirname(__file__), "..", "models", "ffmpeg.exe"),
        r"C:\ffmpeg\bin\ffmpeg.exe",
        r"C:\Program Files\ffmpeg\bin\ffmpeg.exe",
    ]
    for c in local_candidates:
        abs_c = os.path.abspath(c)
        if os.path.exists(abs_c):
            return abs_c

    # 2. Check PATH
    path = shutil.which("ffmpeg")
    if path and os.path.exists(path):
        return path

    # 3. Check imageio_ffmpeg
    try:
        import imageio_ffmpeg
        exe = imageio_ffmpeg.get_ffmpeg_exe()
        if exe and os.path.exists(exe):
            return exe
    except Exception:
        pass

    return None


def decode_audio_to_16k_mono(source: Union[str, bytes, np.ndarray]) -> Tuple[np.ndarray, float]:
    """Decode audio input from file path, bytes, or numpy array to 16kHz mono float32 array in [-1.0, 1.0].
    Returns (samples_array, duration_in_seconds).
    """
    # Case 0: Already a numpy array
    if isinstance(source, np.ndarray):
        samples = np.clip(source, -1.0, 1.0).astype(np.float32)
        if samples.ndim > 1:
            samples = samples.mean(axis=1)
        duration = len(samples) / float(SAMPLE_RATE)
        return samples, duration

    # Case 1: Bytes buffer
    if isinstance(source, bytes):
        cleaned = _clean_mp3_bytes(source)
        try:
            import soundfile as sf
            data, sr = sf.read(io.BytesIO(cleaned), dtype="float32")
            if data.ndim > 1:
                data = data.mean(axis=1)
            duration = len(data) / float(sr)
            if sr != SAMPLE_RATE:
                data = resample_audio(data, sr, SAMPLE_RATE)
            return np.clip(data, -1.0, 1.0).astype(np.float32), duration
        except Exception as e:
            logger.debug(f"Direct soundfile bytes decode failed, falling back to temp file: {e}")
            import tempfile
            ext = _detect_audio_extension(cleaned[:32])
            with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tf:
                tf.write(cleaned)
                temp_path = tf.name
            try:
                return decode_audio_to_16k_mono(temp_path)
            finally:
                if os.path.exists(temp_path):
                    try:
                        os.remove(temp_path)
                    except Exception:
                        pass

    # Case 2: File path on disk
    file_path = str(source)
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"Audio file not found: {file_path}")

    # 2.1 Resilient Chunked SoundFile Read (Recovers all audio even if trailing bytes/ID3 are corrupt)
    try:
        import soundfile as sf
        blocks = []
        sr = SAMPLE_RATE
        with sf.SoundFile(file_path) as f:
            sr = f.samplerate
            while True:
                try:
                    chunk = f.read(16000, dtype="float32")
                    if len(chunk) == 0:
                        break
                    blocks.append(chunk)
                except Exception:
                    # Trailing corruption reached; stop without throwing
                    break
        if len(blocks) > 0:
            data = np.concatenate(blocks)
            if data.ndim > 1:
                data = data.mean(axis=1)
            if len(data) > 0:
                duration = len(data) / float(sr)
                if sr != SAMPLE_RATE:
                    data = resample_audio(data, sr, SAMPLE_RATE)
                return np.clip(data, -1.0, 1.0).astype(np.float32), duration
    except Exception as e:
        logger.debug(f"Resilient soundfile read failed for {file_path}: {e}")

    # 2.2 Try native wave module for simple WAVs
    try:
        with wave.open(file_path, "rb") as wf:
            rate = wf.getframerate()
            channels = wf.getnchannels()
            sampwidth = wf.getsampwidth()
            n_frames = wf.getnframes()
            raw = wf.readframes(n_frames)
        duration = n_frames / max(rate, 1)

        if sampwidth == 2:
            samples = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
        elif sampwidth == 4:
            samples = np.frombuffer(raw, dtype=np.int32).astype(np.float32) / 2147483648.0
        elif sampwidth == 1:
            samples = (np.frombuffer(raw, dtype=np.uint8).astype(np.float32) - 128.0) / 128.0
        else:
            raise ValueError(f"Unsupported sample width: {sampwidth}")

        if channels > 1:
            samples = samples.reshape(-1, channels).mean(axis=1)

        if rate != SAMPLE_RATE:
            samples = resample_audio(samples, rate, SAMPLE_RATE)

        return np.clip(samples, -1.0, 1.0).astype(np.float32), duration
    except Exception as e:
        logger.debug(f"wave module failed for {file_path}: {e}")

    # 2.3 Try librosa
    try:
        import librosa
        data, sr = librosa.load(file_path, sr=SAMPLE_RATE, mono=True)
        duration = len(data) / float(SAMPLE_RATE)
        return np.clip(data, -1.0, 1.0).astype(np.float32), duration
    except Exception as e:
        logger.debug(f"librosa load failed for {file_path}: {e}")

    # 2.4 Try pydub (AudioSegment)
    try:
        from pydub import AudioSegment
        seg = AudioSegment.from_file(file_path)
        seg = seg.set_frame_rate(SAMPLE_RATE).set_channels(1)
        raw = seg.raw_data
        samples = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
        duration = len(samples) / float(SAMPLE_RATE)
        return np.clip(samples, -1.0, 1.0).astype(np.float32), duration
    except Exception as e:
        logger.debug(f"pydub failed for {file_path}: {e}")

    # 2.5 Try scipy.io.wavfile
    try:
        import scipy.io.wavfile as wav
        sr, data = wav.read(file_path)
        if data.dtype == np.int16:
            samples = data.astype(np.float32) / 32768.0
        elif data.dtype == np.int32:
            samples = data.astype(np.float32) / 2147483648.0
        elif data.dtype == np.uint8:
            samples = (data.astype(np.float32) - 128.0) / 128.0
        else:
            samples = data.astype(np.float32)
        if samples.ndim > 1:
            samples = samples.mean(axis=1)
        duration = len(samples) / float(sr)
        if sr != SAMPLE_RATE:
            samples = resample_audio(samples, sr, SAMPLE_RATE)
        return np.clip(samples, -1.0, 1.0).astype(np.float32), duration
    except Exception as e:
        logger.debug(f"scipy.io.wavfile failed for {file_path}: {e}")

    # 2.6 Try ffmpeg fallback if binary exists
    ffmpeg_exe = _get_ffmpeg_path()
    if ffmpeg_exe:
        try:
            cmd = [
                ffmpeg_exe, "-nostdin", "-threads", "2", "-i", file_path,
                "-f", "s16le", "-ac", "1", "-ar", str(SAMPLE_RATE), "-"
            ]
            proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            out, _ = proc.communicate(timeout=60)
            if proc.returncode == 0 and len(out) > 0:
                samples = np.frombuffer(out, dtype=np.int16).astype(np.float32) / 32768.0
                duration = len(samples) / float(SAMPLE_RATE)
                return np.clip(samples, -1.0, 1.0).astype(np.float32), duration
        except Exception as e:
            logger.warning(f"ffmpeg conversion failed for {file_path}: {e}")

    raise ValueError(f"Could not decode audio from {file_path} using any available decoder.")


def resample_audio(data: np.ndarray, orig_sr: int, target_sr: int) -> np.ndarray:
    """High-quality 1D audio resampler."""
    if orig_sr == target_sr:
        return data

    try:
        import soxr
        return soxr.resample(data, orig_sr, target_sr)
    except Exception:
        pass

    try:
        import librosa
        return librosa.resample(data, orig_sr=orig_sr, target_sr=target_sr)
    except Exception:
        pass

    # Fast linear interpolation fallback
    n_out = int(round(len(data) * target_sr / orig_sr))
    if n_out <= 0:
        return np.zeros(0, dtype=np.float32)
    x_old = np.linspace(0.0, 1.0, len(data), endpoint=False)
    x_new = np.linspace(0.0, 1.0, n_out, endpoint=False)
    return np.interp(x_new, x_old, data).astype(np.float32)


def save_samples_to_wav(samples: np.ndarray, output_path: str, sample_rate: int = SAMPLE_RATE) -> str:
    """Save 16kHz mono float32 samples to standard 16-bit PCM WAV."""
    int16_samples = (np.clip(samples, -1.0, 1.0) * 32767).astype(np.int16)
    with wave.open(output_path, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(int16_samples.tobytes())
    return output_path
