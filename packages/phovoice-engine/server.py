"""PhoVoice AI — Enterprise VPS Web Server & Multi-Tenant ASR API Gateway.
FastAPI + WebSockets + Sherpa-ONNX + ViBERT-Capu + Silero-VAD + Diarization.
"""
from __future__ import annotations

import asyncio
import io
import json
import logging
import os
import shutil
import sqlite3
import sys
import tempfile
import threading
import time
import uuid
from typing import Any, Dict, List, Optional

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

from fastapi import (
    BackgroundTasks,
    Depends,
    FastAPI,
    File,
    Form,
    Header,
    HTTPException,
    Request,
    UploadFile,
    WebSocket,
    WebSocketDisconnect,
    status,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

import config
from core.audio_utils import decode_audio_to_16k_mono
from core.auth import AuthManager, create_jwt_token
from core.pipeline import MODEL_PROFILES, get_pipeline
from core.queue_worker import get_queue_manager
from core.vietnamese_itn import VietnameseITN

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] [%(levelname)s] [%(name)s]: %(message)s",
)
logger = logging.getLogger("phovoice.server")

app = FastAPI(
    title="PhoVoice AI Cloud & VPS ASR Gateway",
    version="3.1.0",
    description="Enterprise Speech-to-Text API for Vietnamese & Multilingual Audio Processing",
)

# CORS Configuration
ALLOWED_ORIGINS = os.environ.get("PHOVOICE_CORS_ORIGINS", "*").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

import argparse
_early_parser = argparse.ArgumentParser(add_help=False)
_early_parser.add_argument("--models-dir", default=None)
_early_args, _ = _early_parser.parse_known_args()
if _early_args.models_dir:
    config.MODELS_DIR = _early_args.models_dir
    os.environ["PHOVOICE_MODELS_DIR"] = _early_args.models_dir

auth_mgr = AuthManager(config.DB_PATH)
queue_mgr = get_queue_manager()
pipeline = get_pipeline()

# Maximum Audio File Upload Size (default 150 MB)
MAX_FILE_SIZE_BYTES = int(os.environ.get("PHOVOICE_MAX_FILE_SIZE_MB", "150")) * 1024 * 1024


# ─── Authentication Dependency ───────────────────────────────────────────────

async def get_current_user(
    authorization: Optional[str] = Header(None),
    x_api_key: Optional[str] = Header(None),
) -> Dict[str, Any]:
    """Validate Bearer Token or X-API-Key header. Returns user context dict."""
    token = None
    if authorization and authorization.startswith("Bearer "):
        token = authorization[7:].strip()
    elif x_api_key:
        token = x_api_key.strip()

    # If in open local mode and no token provided, allow as anonymous local user
    allow_anonymous = os.environ.get("PHOVOICE_ALLOW_ANONYMOUS", "true").lower() == "true"

    if not token:
        if allow_anonymous:
            return {"user_id": "anon_local", "username": "anonymous", "plan": "admin"}
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required. Please provide a valid Bearer token or API key.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user = auth_mgr.authenticate_token(token)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired authentication credentials.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user


# ─── Startup Event (Model Preloading) ────────────────────────────────────────

@app.on_event("startup")
def on_startup():
    def _warmup():
        try:
            from download_models import ensure_models_downloaded
            ensure_models_downloaded(config.MODELS_DIR)
        except Exception as e:
            logger.warning(f"Auto-download check notice: {e}")

        logger.info("🔥 Initializing PhoVoice Pipeline & Preloading Models...")
        try:
            pipeline.preload_all()
        except Exception as e:
            logger.error(f"Error during model preload: {e}", exc_info=True)

    threading.Thread(target=_warmup, daemon=True).start()


# ─── Health & Capabilities Endpoints (Phase 21) ──────────────────────────────

@app.get("/health")
@app.get("/api/health")
def health_check():
    import psutil
    vm = psutil.virtual_memory()
    return {
        "status": "ok",
        "service": "PhoVoice ASR Gateway",
        "version": "3.1.0",
        "model_loaded": pipeline.is_loaded(),
        "active_workers": queue_mgr.get_active_workers(),
        "queue_length": queue_mgr.get_queue_length(),
        "cpu_usage_pct": psutil.cpu_percent(),
        "ram_usage_pct": vm.percent,
        "ram_available_mb": round(vm.available / (1024 * 1024), 1),
    }


@app.get("/v1/capabilities")
def get_capabilities():
    """Returns dynamic capabilities of PhoVoice Server for client UI construction."""
    models_list = [
        {"id": key, "name": val["name"], "default": val["default"]}
        for key, val in MODEL_PROFILES.items()
    ]
    return {
        "provider": "phovoice",
        "version": "3.1.0",
        "streaming": True,
        "punctuation": True,
        "normalization": True,
        "timestamps": True,
        "diarization": False,  # True when diarization model is loaded
        "models": models_list,
        "supported_formats": ["wav", "mp3", "m4a", "aac", "webm", "ogg", "flac"],
        "max_audio_duration_seconds": 7200,  # 2 hours max per batch request
    }


# ─── Auth & Quota Endpoints (Phase 7, 8, 9) ─────────────────────────────────

@app.post("/v1/auth/token")
@app.post("/v1/auth/login")
async def login_for_access_token(payload: Dict[str, Any]):
    """Issue JWT Token for username/password or generate client token."""
    username = payload.get("username", "").strip()
    password = payload.get("password", "").strip()
    api_key = payload.get("api_key", "").strip()

    if api_key:
        user = auth_mgr.authenticate_token(api_key)
        if user:
            token = create_jwt_token({"user_id": user["user_id"], "username": user["username"], "plan": user["plan"]})
            return {"access_token": token, "token_type": "bearer", "plan": user["plan"]}

    # Fallback to local admin login
    if username == "admin" and (password == "admin123" or not password):
        token = create_jwt_token({"user_id": "user_admin_001", "username": "admin", "plan": "admin"})
        return {"access_token": token, "token_type": "bearer", "plan": "admin"}

    raise HTTPException(status_code=400, detail="Invalid username, password, or API key.")


@app.get("/v1/usage")
def get_usage(current_user: Dict[str, Any] = Depends(get_current_user)):
    """Get current user's usage and quota statistics."""
    return auth_mgr.get_user_usage(current_user["user_id"], current_user["plan"])


# ─── Standard Transcription API (Phase 4, 6, 13, 19, 20) ─────────────────────

@app.post("/v1/transcribe")
@app.post("/api/transcribe")
async def transcribe_audio(
    file: UploadFile = File(...),
    model: str = Form("68M"),
    punctuation: bool = Form(True),
    normalize: bool = Form(True),
    diarization: bool = Form(True),
    timestamps: bool = Form(True),
    session_id: Optional[str] = Form(None),
    translate: bool = Form(False),
    target_language: str = Form("en"),
    current_user: Dict[str, Any] = Depends(get_current_user),
):
    """Universal versioned transcription endpoint.
    Accepts multipart/form-data audio and returns standardized transcript JSON with Speaker Diarization.
    """
    req_id = f"stt_{uuid.uuid4().hex[:10]}"
    t_start = time.perf_counter()

    # 1. Rate limit check
    if not auth_mgr.check_rate_limit(current_user["user_id"], current_user["plan"]):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Rate limit exceeded. Please slow down your requests.",
        )

    # 2. Read file safely in memory / temp file
    try:
        content = await file.read()
        if len(content) > MAX_FILE_SIZE_BYTES:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=f"File too large. Maximum allowed size is {MAX_FILE_SIZE_BYTES // (1024 * 1024)}MB.",
            )

        # 3. Decode & check duration for quota
        samples, duration_s = decode_audio_to_16k_mono(content)

        # 4. Quota check & deduction
        allowed, used_min, max_min = auth_mgr.check_and_deduct_quota(
            current_user["user_id"], current_user["plan"], duration_s
        )
        if not allowed:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Monthly transcription quota exceeded ({used_min:.1f} / {max_min} minutes).",
            )

        # 5. Execute full transcription pipeline with session-consistent diarization
        result = pipeline.transcribe(
            audio_source=samples,
            model=model,
            punctuate=punctuation,
            normalize=normalize,
            diarize=diarization,
            timestamps=timestamps,
            session_id=session_id,
            translate=translate,
            target_language=target_language,
        )

        latency = time.perf_counter() - t_start
        rtf = round(latency / max(duration_s, 1e-6), 3)

        # 6. Observability Logging (Privacy-first: user masked, no transcript logged)
        masked_user = current_user["user_id"][:6] + "***" if len(current_user["user_id"]) > 6 else "***"
        logger.info(
            f"[STT] req_id: {req_id} session_id: {session_id} user_id: {masked_user} provider: phovoice "
            f"model: {model} duration: {duration_s:.1f}s latency: {latency:.2f}s rtf: {rtf} status: success"
        )

        return {
            "id": req_id,
            "session_id": session_id,
            "text": result["text"],
            "language": result["language"],
            "duration": result["duration"],
            "processing_time": result["processing_time"],
            "rtf": rtf,
            "provider": "phovoice",
            "segments": result["segments"],
            "features": result["features"],
        }
    except HTTPException:
        raise
    except Exception as exc:
        latency = time.perf_counter() - t_start
        logger.error(f"[STT Error] req_id: {req_id} latency: {latency:.2f}s error: {exc}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Transcription pipeline failure: {str(exc)}",
        )


@app.post("/v1/sessions/{session_id}/alias")
async def set_speaker_alias(
    session_id: str,
    payload: Dict[str, str],
    current_user: Dict[str, Any] = Depends(get_current_user),
):
    """Assign custom alias name to a speaker ID in an active session."""
    speaker_id = payload.get("speaker_id", "").strip()
    name = payload.get("name", "").strip()
    if not speaker_id or not name:
        raise HTTPException(status_code=400, detail="speaker_id and name are required.")

    from core.speaker_session import get_speaker_session_manager
    session = get_speaker_session_manager().get_or_create_session(session_id)
    session.set_alias(speaker_id, name)
    return {"status": "ok", "session_id": session_id, "speaker_id": speaker_id, "name": name}


@app.get("/v1/sessions/{session_id}/speakers")
def get_session_speakers(
    session_id: str,
    current_user: Dict[str, Any] = Depends(get_current_user),
):
    """Retrieve all identified speakers and aliases for a session."""
    from core.speaker_session import get_speaker_session_manager
    session = get_speaker_session_manager().get_or_create_session(session_id)
    speakers = [
        {
            "speaker_id": c.speaker_id,
            "speaker_label": session.aliases.get(c.speaker_id, c.speaker_label),
            "count": c.count,
            "last_seen": c.last_seen,
        }
        for c in session.clusters
    ]
    return {"session_id": session_id, "speakers": speakers}


# ─── Streaming WebSocket API (Phase 5, 11) ───────────────────────────────────

@app.websocket("/v1/transcribe/stream")
@app.websocket("/api/transcribe/stream")
@app.websocket("/api/ws/stream")
@app.websocket("/ws/stream")
async def websocket_transcribe_stream(websocket: WebSocket):
    """Real-time streaming ASR over WebSocket.
    Clients send raw PCM 16kHz float32 or int16 byte chunks.
    Server responds with partial and final transcription events.
    """
    await websocket.accept()
    stream = pipeline.create_streaming_stream()

    if stream is None:
        await websocket.send_json({
            "type": "error",
            "message": "Streaming model is currently not loaded on server.",
        })
        await websocket.close(code=1011)
        return

    recognizer = pipeline._get_streaming_recognizer()
    session_id = f"stream_{uuid.uuid4().hex[:8]}"
    logger.info(f"[Stream] WebSocket session {session_id} connected.")

    last_partial = ""

    try:
        while True:
            message = await websocket.receive()
            if message.get("type") == "websocket.disconnect":
                break
            if "bytes" in message and message["bytes"]:
                raw_bytes = message["bytes"]
                if len(raw_bytes) % 2 == 0:
                    import numpy as np
                    samples = np.frombuffer(raw_bytes, dtype=np.int16).astype(np.float32) / 32768.0

                    # Far-field Sensitivity & Dynamic Gain Boost (Bắt âm thanh xa & âm lượng nhỏ)
                    if len(samples) > 0:
                        max_amp = float(np.max(np.abs(samples)))
                        if 0.0001 < max_amp < 0.60:
                            gain = min(8.0, 0.75 / max_amp)
                            samples = np.clip(samples * gain, -1.0, 1.0)

                    stream.accept_waveform(16000, samples)

                    while recognizer.is_ready(stream):
                        recognizer.decode_stream(stream)

                    raw_res = recognizer.get_result(stream)
                    current_text = (raw_res.text if hasattr(raw_res, "text") else str(raw_res)).strip()
                    if current_text.isupper():
                        low = current_text.lower()
                        current_text = low[0].upper() + low[1:] if len(low) > 0 else low

                    current_text = VietnameseITN.normalize(current_text)

                    if current_text and current_text != last_partial:
                        last_partial = current_text
                        await websocket.send_json({
                            "type": "partial",
                            "text": current_text,
                            "full_text": current_text,
                            "delta": current_text,
                        })
            elif "text" in message and message["text"]:
                data = json.loads(message["text"])
                msg_type = data.get("type", "")

                if msg_type == "finalize" or msg_type == "close":
                    stream.input_finished()
                    while recognizer.is_ready(stream):
                        recognizer.decode_stream(stream)

                    raw_res = recognizer.get_result(stream)
                    final_raw = (raw_res.text if hasattr(raw_res, "text") else str(raw_res)).strip()
                    if final_raw.isupper():
                        final_raw = final_raw.lower()
                    punct_text, _ = pipeline._restore_punctuation(final_raw)
                    punct_text = VietnameseITN.normalize(punct_text)

                    await websocket.send_json({
                        "type": "final",
                        "text": punct_text,
                        "full_text": punct_text,
                        "raw_text": final_raw,
                    })
                    break
    except (WebSocketDisconnect, RuntimeError):
        logger.info(f"[Stream] WebSocket session {session_id} disconnected.")
    except Exception as e:
        if "disconnect" in str(e).lower():
            logger.info(f"[Stream] WebSocket session {session_id} disconnected.")
        else:
            logger.warning(f"[Stream] WebSocket session {session_id} error: {e}")
            try:
                await websocket.send_json({"type": "error", "message": str(e)})
            except Exception:
                pass


# ─── Legacy Web Studio Static & LLM Endpoints ────────────────────────────────

@app.post("/api/punctuate")
async def punctuate_text(payload: Dict[str, Any]):
    raw = payload.get("text", "")
    punct_text, _ = pipeline._restore_punctuation(raw)
    return {"text": punct_text}


@app.get("/api/models")
def list_models_legacy():
    return [
        {"id": "68M", "name": "⚖️ BALANCED — Zipformer 68M (Chuẩn mực, Đầy đủ)", "profile": "BALANCED"},
        {"id": "30M", "name": "⚡ FAST — Zipformer 30M (Siêu nhanh)", "profile": "FAST"},
        {"id": "VI-EN", "name": "🌐 VI-EN — NghiASR INT8 (Thuật ngữ CNTT)", "profile": "VI-EN"},
        {"id": "MULTILINGUAL", "name": "🌍 MULTILINGUAL — PengCheng Starling", "profile": "MULTILINGUAL"},
    ]


# Mount static web frontend files if directory exists
STATIC_DIR = os.path.join(BASE_DIR, "static")
if os.path.exists(STATIC_DIR):
    app.mount("/assets", StaticFiles(directory=os.path.join(STATIC_DIR, "assets")), name="assets") if os.path.exists(os.path.join(STATIC_DIR, "assets")) else None

    @app.get("/")
    def serve_frontend_index():
        index_file = os.path.join(STATIC_DIR, "index.html")
        if os.path.exists(index_file):
            return FileResponse(index_file)
        return {"service": "PhoVoice AI ASR Gateway", "docs": "/docs"}


if __name__ == "__main__":
    import argparse
    import uvicorn

    parser = argparse.ArgumentParser(description="PhoVoice AI Engine Server")
    parser.add_argument("--host", default=config.HOST, help="Host address to bind")
    parser.add_argument("--port", type=int, default=config.PORT, help="Port to bind")
    parser.add_argument("--models-dir", default=None, help="Directory containing models")
    args, _ = parser.parse_known_args()

    if args.models_dir and os.path.exists(args.models_dir):
        config.MODELS_DIR = args.models_dir
        os.environ["PHOVOICE_MODELS_DIR"] = args.models_dir

    uvicorn.run(
        "server:app",
        host=args.host,
        port=args.port,
        reload=False,
        workers=1,
    )
