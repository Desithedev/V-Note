"""Script copy/tải mô hình PhoVoice Zipformer 30M Streaming và native AAR vào Android Assets & Libs.
"""
import os
import urllib.request
import sys
import shutil

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TARGET_DIR = os.path.join(BASE_DIR, "android", "app", "src", "main", "assets", "phovoice")
LIBS_DIR = os.path.join(BASE_DIR, "android", "app", "libs")

os.makedirs(TARGET_DIR, exist_ok=True)
os.makedirs(LIBS_DIR, exist_ok=True)

MODELS = [
    ("https://huggingface.co/hynt/Zipformer-30M-RNNT-Streaming-6000h/resolve/main/encoder-epoch-31-avg-11-chunk-64-left-128.fp16.onnx", "encoder-epoch-31-avg-11-chunk-64-left-128.fp16.onnx"),
    ("https://huggingface.co/hynt/Zipformer-30M-RNNT-Streaming-6000h/resolve/main/decoder-epoch-31-avg-11-chunk-64-left-128.fp16.onnx", "decoder-epoch-31-avg-11-chunk-64-left-128.fp16.onnx"),
    ("https://huggingface.co/hynt/Zipformer-30M-RNNT-Streaming-6000h/resolve/main/joiner-epoch-31-avg-11-chunk-64-left-128.fp16.onnx", "joiner-epoch-31-avg-11-chunk-64-left-128.fp16.onnx"),
    ("https://huggingface.co/hynt/Zipformer-30M-RNNT-Streaming-6000h/resolve/main/tokens.txt", "tokens.txt"),
]

def main():
    print(f"[PhoVoice Mobile] Dang chuan bi model tai: {TARGET_DIR}")
    
    # 1. Chuan bi mo hinh PhoVoice ONNX
    root_dir = os.path.abspath(os.path.join(BASE_DIR, "..", ".."))
    engine_models = os.path.join(root_dir, "packages", "phovoice-engine", "models", "zipformer-30m-rnnt-streaming-6000h")
    
    for url, filename in MODELS:
        target_path = os.path.join(TARGET_DIR, filename)
        if os.path.exists(target_path) and os.path.getsize(target_path) > 100:
            print(f"  [OK] {filename} da co san, bo qua.")
            continue
            
        src_path = os.path.join(engine_models, filename)
        if os.path.exists(src_path) and os.path.getsize(src_path) > 100:
            print(f"  -> Copy {filename} tu phovoice-engine...")
            shutil.copy2(src_path, target_path)
            continue

        print(f"  -> Dang tai {filename}...")
        try:
            urllib.request.urlretrieve(url, target_path)
            print(f"  [OK] Da tai xong {filename}")
        except Exception as e:
            if filename == "tokens.txt":
                print(f"  -> Dang trich xuat tokens.txt tu kho k2-fsa sherpa-onnx...")
                try:
                    import tarfile, io
                    res = urllib.request.urlopen("https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-zipformer-vi-2025-04-20.tar.bz2")
                    tar = tarfile.open(fileobj=io.BytesIO(res.read()), mode="r:bz2")
                    f = tar.extractfile("sherpa-onnx-zipformer-vi-2025-04-20/tokens.txt")
                    if f:
                        with open(target_path, "wb") as out_f:
                            out_f.write(f.read())
                        print(f"  [OK] Da trich xuat xong tokens.txt ({os.path.getsize(target_path)} bytes)")
                except Exception as ex:
                    print(f"  [ERROR] Trich xuat tokens.txt that bai: {ex}")
            else:
                print(f"  [ERROR] Khong the tai {filename}: {e}")

    # 2. Chuan bi Sherpa-ONNX Android AAR
    aar_filename = "sherpa-onnx-1.10.42.aar"
    aar_path = os.path.join(LIBS_DIR, aar_filename)
    if os.path.exists(aar_path) and os.path.getsize(aar_path) > 10000000:
        print(f"  [OK] {aar_filename} ({os.path.getsize(aar_path)} bytes) da co san trong libs.")
    else:
        aar_url = "https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.10.42/sherpa-onnx-1.10.42.aar"
        print(f"  -> Dang tai native library {aar_filename} tu {aar_url}...")
        try:
            urllib.request.urlretrieve(aar_url, aar_path)
            print(f"  [OK] Da tai xong {aar_filename} ({os.path.getsize(aar_path)} bytes)")
        except Exception as e:
            print(f"  [ERROR] Khong the tai {aar_filename}: {e}")

    print("[PhoVoice Mobile] Chuan bi model va native library hoan tat!")

if __name__ == "__main__":
    main()
