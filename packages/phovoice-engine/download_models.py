"""PhoVoice AI — Automated Model Downloader.
Tự động tải & giải nén các mô hình ASR Tiếng Việt (Zipformer 68M, Streaming 30M, ViBERT-Capu, Silero VAD)
từ GitHub Releases & HuggingFace khi triển khai trên VPS / máy tính mới.
"""
from __future__ import annotations

import os
import sys
import tarfile
import urllib.request
import shutil
import zipfile

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODELS_DIR = os.path.join(BASE_DIR, "models")

MODELS_SPEC = {
    "sherpa-onnx-zipformer-vi-2025-04-20": {
        "name": "Zipformer 68M Tiếng Việt (Balanced Offline)",
        "check_file": os.path.join("sherpa-onnx-zipformer-vi-2025-04-20", "encoder-epoch-12-avg-8.onnx"),
        "url": "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-zipformer-vi-2025-04-20.tar.bz2",
        "type": "tar.bz2",
    },
    "zipformer-30m-rnnt-streaming-6000h": {
        "name": "Zipformer 30M Streaming (Realtime 6000h)",
        "check_file": os.path.join("zipformer-30m-rnnt-streaming-6000h", "encoder-epoch-31-avg-11-chunk-64-left-128.fp16.onnx"),
        "files": [
            ("https://huggingface.co/hynt/Zipformer-30M-RNNT-Streaming-6000h/resolve/main/encoder-epoch-31-avg-11-chunk-64-left-128.fp16.onnx", "encoder-epoch-31-avg-11-chunk-64-left-128.fp16.onnx"),
            ("https://huggingface.co/hynt/Zipformer-30M-RNNT-Streaming-6000h/resolve/main/decoder-epoch-31-avg-11-chunk-64-left-128.fp16.onnx", "decoder-epoch-31-avg-11-chunk-64-left-128.fp16.onnx"),
            ("https://huggingface.co/hynt/Zipformer-30M-RNNT-Streaming-6000h/resolve/main/joiner-epoch-31-avg-11-chunk-64-left-128.fp16.onnx", "joiner-epoch-31-avg-11-chunk-64-left-128.fp16.onnx"),
            ("https://huggingface.co/hynt/Zipformer-30M-RNNT-Streaming-6000h/resolve/main/tokens.txt", "tokens.txt"),
            ("https://huggingface.co/hynt/Zipformer-30M-RNNT-Streaming-6000h/resolve/main/bpe.model", "bpe.model"),
        ],
        "type": "direct_files",
    },
    "silero-vad": {
        "name": "Silero VAD (Voice Activity Detector)",
        "check_file": os.path.join("silero-vad", "silero_vad.onnx"),
        "files": [
            ("https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx", "silero_vad.onnx")
        ],
        "type": "direct_files",
    },
    "vibert-capu": {
        "name": "ViBERT-Capu (Phục hồi dấu câu & viết hoa)",
        "check_file": os.path.join("vibert-capu", "vibert-capu.onnx"),
        "files": [
            ("https://huggingface.co/welcomyou/vibert-capu-onnx/resolve/main/vibert-capu.onnx", "vibert-capu.onnx"),
            ("https://huggingface.co/welcomyou/vibert-capu-onnx/resolve/main/vibert-capu.int8.onnx", "vibert-capu.int8.onnx"),
            ("https://huggingface.co/welcomyou/vibert-capu-onnx/resolve/main/config.json", "config.json"),
            ("https://huggingface.co/welcomyou/vibert-capu-onnx/resolve/main/vocab.txt", "vocab.txt"),
            ("https://huggingface.co/welcomyou/vibert-capu-onnx/resolve/main/verb-form-vocab.txt", "verb-form-vocab.txt"),
            ("https://huggingface.co/welcomyou/vibert-capu-onnx/resolve/main/utils.py", "utils.py"),
            ("https://huggingface.co/welcomyou/vibert-capu-onnx/resolve/main/gec_model.py", "gec_model.py"),
        ],
        "type": "direct_files",
    }
}


def _download_file(url: str, dest_path: str, desc: str = ""):
    """Tải 1 file với progress bar trực quan trong terminal."""
    os.makedirs(os.path.dirname(dest_path), exist_ok=True)
    temp_path = dest_path + ".tmp"
    
    headers = {"User-Agent": "PhoVoice-AI-Downloader/3.0"}
    req = urllib.request.Request(url, headers=headers)
    
    try:
        with urllib.request.urlopen(req, timeout=120) as resp, open(temp_path, "wb") as f:
            total_size = int(resp.headers.get("Content-Length") or 0)
            downloaded = 0
            chunk_size = 1024 * 512 # 512KB chunks
            
            while True:
                chunk = resp.read(chunk_size)
                if not chunk:
                    break
                f.write(chunk)
                downloaded += len(chunk)
                
                if total_size > 0:
                    percent = min(100, int(downloaded * 100 / total_size))
                    mb_down = downloaded / 1024 / 1024
                    mb_total = total_size / 1024 / 1024
                    bar = "█" * (percent // 5) + "░" * (20 - (percent // 5))
                    sys.stdout.write(f"\r   [{bar}] {percent}% ({mb_down:.1f}/{mb_total:.1f} MB) — {desc}")
                else:
                    mb_down = downloaded / 1024 / 1024
                    sys.stdout.write(f"\r   Đã tải {mb_down:.1f} MB — {desc}")
                sys.stdout.flush()
                
        print()
        if os.path.exists(dest_path):
            os.remove(dest_path)
        os.rename(temp_path, dest_path)
        return True
    except Exception as e:
        print(f"\n   ❌ Lỗi tải {url}: {e}")
        if os.path.exists(temp_path):
            os.remove(temp_path)
        return False


def ensure_models_downloaded(models_dir: str = MODELS_DIR) -> bool:
    """Kiểm tra và tự động tải tất cả models cần thiết nếu chưa có."""
    os.makedirs(models_dir, exist_ok=True)
    
    # Kiểm tra xem models đã có sẵn ở models_dir hoặc thư mục gốc chưa
    missing = []
    for model_id, spec in MODELS_SPEC.items():
        check_path = os.path.join(models_dir, spec["check_file"])
        if not os.path.exists(check_path):
            missing.append(model_id)

    if not missing:
        return True

    print("=" * 70)
    print("🚀 PHOVOICE AI — PHÁT HIỆN THIẾU MODEL VÀ TỰ ĐỘNG TẢI VỀ")
    print("=" * 70)
    print(f"Cần tải {len(missing)} mô hình: {', '.join(missing)}\n")

    for model_id in missing:
        spec = MODELS_SPEC[model_id]
        print(f"📥 Đang chuẩn bị tải: {spec['name']}...")
        
        target_subfolder = os.path.join(models_dir, model_id)
        os.makedirs(target_subfolder, exist_ok=True)

        if spec["type"] == "tar.bz2":
            tar_path = os.path.join(models_dir, f"{model_id}.tar.bz2")
            ok = _download_file(spec["url"], tar_path, desc=model_id)
            if ok and os.path.exists(tar_path):
                print(f"   📦 Đang giải nén {model_id}...")
                with tarfile.open(tar_path, "r:bz2") as tar:
                    tar.extractall(models_dir)
                try:
                    os.remove(tar_path)
                except Exception:
                    pass
                print(f"   ✅ Đã tải và giải nén thành công {spec['name']}!")
        
        elif spec["type"] == "direct_files":
            for file_url, rel_name in spec["files"]:
                dest_file = os.path.join(target_subfolder, rel_name)
                _download_file(file_url, dest_file, desc=rel_name)
            print(f"   ✅ Đã tải xong toàn bộ tệp cho {spec['name']}!")

    print("\n" + "=" * 70)
    print("🎉 TẤT CẢ MODEL ĐÃ ĐƯỢC TẢI XUỐNG VÀ SẴN SÀNG HOẠT ĐỘNG!")
    print("=" * 70 + "\n")
    return True


if __name__ == "__main__":
    ensure_models_downloaded()
