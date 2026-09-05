"""
Fallback Audio Capture Client for V-Note on Windows/macOS/Linux.
Streams 48kHz Mono Float32 PCM audio with 32-byte binary header over stdout.
Supports:
  --mode mic (Source ID 1)
  --mode system (Source ID 2)
  --mode dual (Both Mic & System)
"""
import sys
import time
import struct
import threading
import argparse

def run_audio_capture():
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", default="dual", choices=["mic", "system", "dual"])
    parser.add_argument("--debug-artifacts-dir", default=None)
    parser.add_argument("--aec-render-holdback-ms", type=int, default=0)
    parser.add_argument("--aec-render-wait-timeout-ms", type=int, default=0)
    parser.add_argument("--check-system-audio-permission", action="store_true")
    args, _ = parser.parse_known_args()

    if args.check_system_audio_permission:
        sys.exit(0)

    import os
    if sys.platform == "win32":
        try:
            import msvcrt
            msvcrt.setmode(sys.stdout.fileno(), os.O_BINARY)
            msvcrt.setmode(sys.stdin.fileno(), os.O_BINARY)
        except Exception:
            pass

    try:
        import sounddevice as sd
        import numpy as np
    except ImportError:
        try:
            import subprocess
            subprocess.check_call([sys.executable, "-m", "pip", "install", "sounddevice", "numpy"])
            import sounddevice as sd
            import numpy as np
        except Exception as e:
            sys.stderr.write(f"Error importing sounddevice/numpy: {e}\n")
            sys.stderr.flush()
            sys.exit(1)

    SAMPLE_RATE = 48000
    CHANNELS = 1
    BLOCK_SIZE = 4800  # 100ms per packet at 48kHz
    PACKET_VERSION = 1
    SOURCE_ID_MIC = 1
    SOURCE_ID_SYSTEM = 2
    FORMAT_FLOAT32 = 1

    mic_seq = 0
    mic_sample_idx = 0
    sys_seq = 0
    sys_sample_idx = 0
    running = True

    # Stdin listener for graceful shutdown
    def stdin_listener():
        nonlocal running
        try:
            for line in sys.stdin:
                cmd = line.strip().lower()
                if cmd in ["stop", "shutdown", "exit", "quit"]:
                    running = False
                    break
        except Exception:
            running = False

    listener_thread = threading.Thread(target=stdin_listener, daemon=True)
    listener_thread.start()

    sys.stderr.write("Capture binary ready\n")
    sys.stderr.write("Dual mode capture started: aec=none\n")
    sys.stderr.flush()

    write_lock = threading.Lock()

    def send_packet(source_id: int, sequence_num: int, frames: int, sample_idx: int, mono_float32: np.ndarray):
        payload = mono_float32.tobytes()
        frame_bytes = len(payload)
        duration_ms = int(round((frames / SAMPLE_RATE) * 1000))
        timestamp_ms = int(round((sample_idx / SAMPLE_RATE) * 1000))

        # 32-byte header struct (Little-Endian)
        # B = uint8, I = uint32, Q = uint64
        # Offset 0: version (B) = 1
        # Offset 1: sourceId (B) = source_id (1: mic, 2: system)
        # Offset 2: format (B) = 1 (Float32)
        # Offset 3: channels (B) = 1
        # Offset 4..7: sampleRate (I) = 48000
        # Offset 8..11: sequenceNum (I)
        # Offset 12..15: durationMs (I)
        # Offset 16..23: timestampMs (Q)
        # Offset 24..27: frameBytes (I)
        # Offset 28..31: sampleStartIndex (I)
        header = struct.pack(
            "<BBBBIIIQII",
            PACKET_VERSION,
            source_id,
            FORMAT_FLOAT32,
            CHANNELS,
            SAMPLE_RATE,
            sequence_num,
            duration_ms,
            timestamp_ms,
            frame_bytes,
            sample_idx,
        )

        with write_lock:
            try:
                sys.stdout.buffer.write(header)
                sys.stdout.buffer.write(payload)
                sys.stdout.buffer.flush()
            except Exception:
                pass

    def mic_callback(indata, frames, time_info, status):
        nonlocal mic_seq, mic_sample_idx
        if not running:
            raise sd.CallbackStop()

        if indata.ndim > 1 and indata.shape[1] > 1:
            mono = np.mean(indata, axis=1).astype(np.float32)
        else:
            mono = indata.flatten().astype(np.float32)

        # Dynamic gain boost for mic
        if len(mono) > 0:
            max_amp = float(np.max(np.abs(mono)))
            if 0.0001 < max_amp < 0.40:
                gain = min(5.0, 0.65 / max_amp)
                mono = np.clip(mono * gain, -1.0, 1.0)

        send_packet(SOURCE_ID_MIC, mic_seq, frames, mic_sample_idx, mono)
        mic_seq += 1
        mic_sample_idx += frames

    sys_native_sr = SAMPLE_RATE

    def system_callback(indata, frames, time_info, status):
        nonlocal sys_seq, sys_sample_idx
        if not running:
            raise sd.CallbackStop()

        if indata.ndim > 1 and indata.shape[1] > 1:
            mono = np.mean(indata, axis=1).astype(np.float32)
        else:
            mono = indata.flatten().astype(np.float32)

        # Resample to strict 48kHz if playback endpoint runs at 44.1kHz / 96kHz etc.
        if sys_native_sr != SAMPLE_RATE and len(mono) > 0:
            target_len = int(round(len(mono) * (SAMPLE_RATE / sys_native_sr)))
            indices = np.linspace(0, len(mono) - 1, target_len)
            mono = np.interp(indices, np.arange(len(mono)), mono).astype(np.float32)
            frames = len(mono)

        # Dynamic Gain Boost & AGC for System Loopback Audio (Boost quiet video/call audio up to 8x)
        if len(mono) > 0:
            max_amp = float(np.max(np.abs(mono)))
            if 0.0001 < max_amp < 0.50:
                gain = min(8.0, 0.75 / max_amp)
                mono = np.clip(mono * gain, -1.0, 1.0)

        send_packet(SOURCE_ID_SYSTEM, sys_seq, frames, sys_sample_idx, mono)
        sys_seq += 1
        sys_sample_idx += frames

    streams = []
    try:
        if args.mode in ["mic", "dual"]:
            try:
                mic_stream = sd.InputStream(
                    samplerate=SAMPLE_RATE,
                    channels=1,
                    dtype="float32",
                    blocksize=BLOCK_SIZE,
                    callback=mic_callback,
                )
                mic_stream.start()
                streams.append(mic_stream)
                sys.stderr.write("Microphone capture started\n")
                sys.stderr.flush()
            except Exception as e:
                sys.stderr.write(f"Microphone capture error: {e}\n")
                sys.stderr.flush()

        if args.mode in ["system", "dual"]:
            # On Windows, WASAPI loopback attaches to the default output endpoint (requires 2 channels / Stereo)
            system_started = False
            if sys.platform == "win32":
                try:
                    # Find default WASAPI output device index
                    wasapi_hostapi_idx = None
                    for idx, api in enumerate(sd.query_hostapis()):
                        if "WASAPI" in api.get("name", "").upper():
                            wasapi_hostapi_idx = idx
                            break

                    wasapi_output_idx = None
                    devices = sd.query_devices()
                    if wasapi_hostapi_idx is not None:
                        default_out = sd.default.device[1]
                        if default_out is not None and default_out >= 0 and default_out < len(devices):
                            if devices[default_out]["hostapi"] == wasapi_hostapi_idx and devices[default_out]["max_output_channels"] > 0:
                                wasapi_output_idx = default_out
                            else:
                                def_name = devices[default_out]["name"]
                                for dev_idx, dev in enumerate(devices):
                                    if dev.get("hostapi") == wasapi_hostapi_idx and dev.get("name") == def_name and dev.get("max_output_channels", 0) > 0:
                                        wasapi_output_idx = dev_idx
                                        break
                        if wasapi_output_idx is None:
                            for dev_idx, dev in enumerate(devices):
                                if dev.get("hostapi") == wasapi_hostapi_idx and dev.get("max_output_channels", 0) > 0:
                                    wasapi_output_idx = dev_idx
                                    break

                    if wasapi_output_idx is not None:
                        dev_info = devices[wasapi_output_idx]
                        sys_native_sr = int(dev_info.get("default_samplerate", 48000))
                    else:
                        sys_native_sr = SAMPLE_RATE

                    block_samples = int(round(sys_native_sr * 0.1))  # 100ms at native rate
                    extra = sd.WasapiSettings(loopback=True)
                    sys_stream = sd.InputStream(
                        device=wasapi_output_idx,
                        samplerate=sys_native_sr,
                        channels=2,  # WASAPI loopback requires 2 channels
                        dtype="float32",
                        blocksize=block_samples,
                        extra_settings=extra,
                        callback=system_callback,
                    )
                    sys_stream.start()
                    streams.append(sys_stream)
                    system_started = True
                    sys.stderr.write(f"WASAPI system loopback capture started on device {wasapi_output_idx} ({sys_native_sr}Hz)\n")
                    sys.stderr.flush()
                except Exception as e:
                    sys.stderr.write(f"WASAPI loopback error: {e}\n")
                    sys.stderr.flush()

            if not system_started:
                # Fallback: query any device with Stereo Mix / Loopback in name
                try:
                    devices = sd.query_devices()
                    loopback_dev = None
                    for idx, d in enumerate(devices):
                        if d.get("max_input_channels", 0) > 0 and ("STEREO MIX" in d.get("name", "").upper() or "LOOPBACK" in d.get("name", "").upper()):
                            loopback_dev = idx
                            break
                    if loopback_dev is not None:
                        sys_stream = sd.InputStream(
                            device=loopback_dev,
                            samplerate=SAMPLE_RATE,
                            channels=2,
                            dtype="float32",
                            blocksize=BLOCK_SIZE,
                            callback=system_callback,
                        )
                        sys_stream.start()
                        streams.append(sys_stream)
                        sys.stderr.write(f"Stereo Mix system capture started on device {loopback_dev}\n")
                        sys.stderr.flush()
                except Exception as e:
                    sys.stderr.write(f"Stereo Mix fallback error: {e}\n")
                    sys.stderr.flush()

        while running:
            time.sleep(0.05)

    except Exception as e:
        sys.stderr.write(f"Capture error: {e}\n")
        sys.stderr.flush()
    finally:
        for s in streams:
            try:
                s.stop()
                s.close()
            except Exception:
                pass

if __name__ == "__main__":
    run_audio_capture()
