import { EventEmitter } from "node:events";
import type { AudioSource } from "@/types/meeting";
import { CHUNKER_SILENCE_RMS } from "../utils/audio-gate-config";

export interface SmartAudioChunkOptions {
  targetChunkDurationMs?: number; // Target duration before looking for silence (default: 12000ms)
  maxChunkDurationMs?: number;    // Forced finalize ceiling (default: 30000ms)
  silenceFinalizeMs?: number;     // Silence duration to trigger boundary (default: 700ms)
  overlapMs?: number;             // Audio overlap prepended to next chunk (default: 800ms)
  sampleRate?: number;            // Standard target sample rate (default: 16000)
  energyThreshold?: number;       // RMS energy threshold below which frame is silence (default: 0.012)
}

export interface AudioChunkPayload {
  chunkIndex: number;
  source: AudioSource;
  audioBuffer: Buffer;           // 16kHz mono 16-bit PCM WAV
  durationMs: number;
  startTimeMs: number;
  endTimeMs: number;
  overlapMs: number;
  isForced: boolean;
}

export interface SmartAudioChunkerEvents {
  chunk: (payload: AudioChunkPayload) => void;
}

export class SmartAudioChunker extends EventEmitter {
  private targetChunkDurationMs: number;
  private maxChunkDurationMs: number;
  private silenceFinalizeMs: number;
  private overlapMs: number;
  private targetSampleRate: number;
  private energyThreshold: number;

  private buffer: Float32Array = new Float32Array(0);
  private chunkIndex = 0;
  private streamStartMs = 0;
  private currentChunkStartMs = 0;
  private continuousSilenceMs = 0;
  private overlapBuffer: Float32Array = new Float32Array(0);
  private isFirstFrame = true;

  constructor(
    private readonly source: AudioSource,
    options: SmartAudioChunkOptions = {},
  ) {
    super();
    this.targetChunkDurationMs = options.targetChunkDurationMs ?? 13000;
    this.maxChunkDurationMs = options.maxChunkDurationMs ?? 30000;
    this.silenceFinalizeMs = options.silenceFinalizeMs ?? 700;
    this.overlapMs = options.overlapMs ?? 800;
    this.targetSampleRate = options.sampleRate ?? 16000;
    this.energyThreshold = options.energyThreshold ?? CHUNKER_SILENCE_RMS;
  }

  on<U extends keyof SmartAudioChunkerEvents>(
    event: U,
    listener: SmartAudioChunkerEvents[U],
  ): this {
    return super.on(event, listener);
  }

  emit<U extends keyof SmartAudioChunkerEvents>(
    event: U,
    ...args: Parameters<SmartAudioChunkerEvents[U]>
  ): boolean {
    return super.emit(event, ...args);
  }

  public appendSamples(
    inputSamples: Float32Array,
    inputSampleRate: number,
    timestampMs: number,
  ): void {
    if (this.isFirstFrame) {
      this.streamStartMs = timestampMs;
      this.currentChunkStartMs = timestampMs;
      this.isFirstFrame = false;
    }

    // 1. Resample to 16000Hz mono if needed
    const resampled = this.resampleTo16k(inputSamples, inputSampleRate);
    if (resampled.length === 0) return;

    // 2. Concatenate into buffer
    const nextBuf = new Float32Array(this.buffer.length + resampled.length);
    nextBuf.set(this.buffer, 0);
    nextBuf.set(resampled, this.buffer.length);
    this.buffer = nextBuf;

    // 3. Compute frame energy & silence duration
    const frameDurationMs = (resampled.length / this.targetSampleRate) * 1000;
    const rms = this.calculateRMS(resampled);

    if (rms < this.energyThreshold) {
      this.continuousSilenceMs += frameDurationMs;
    } else {
      this.continuousSilenceMs = 0;
    }

    const currentDurationMs = (this.buffer.length / this.targetSampleRate) * 1000;

    // 4. Decision: Finalize chunk?
    // Condition A: Silence detected after reaching target duration
    const reachedTarget = currentDurationMs >= this.targetChunkDurationMs;
    const isSilenceBoundary = this.continuousSilenceMs >= this.silenceFinalizeMs;

    // Condition B: Reached max duration limit
    const reachedMax = currentDurationMs >= this.maxChunkDurationMs;

    if ((reachedTarget && isSilenceBoundary) || reachedMax) {
      this.finalizeChunk(reachedMax);
    }
  }

  public flush(): void {
    if (this.buffer.length > 0) {
      this.finalizeChunk(false);
    }
  }

  public reset(): void {
    this.buffer = new Float32Array(0);
    this.overlapBuffer = new Float32Array(0);
    this.chunkIndex = 0;
    this.continuousSilenceMs = 0;
    this.isFirstFrame = true;
  }

  private finalizeChunk(isForced: boolean): void {
    const rawChunkLength = this.buffer.length;
    if (rawChunkLength === 0) return;

    // Prepend overlap from previous chunk if available
    const totalSamples = this.overlapBuffer.length + rawChunkLength;
    const fullAudioSamples = new Float32Array(totalSamples);
    fullAudioSamples.set(this.overlapBuffer, 0);
    fullAudioSamples.set(this.buffer, this.overlapBuffer.length);

    const chunkDurationMs = (totalSamples / this.targetSampleRate) * 1000;
    const overlapDurationMs = (this.overlapBuffer.length / this.targetSampleRate) * 1000;
    const chunkEndTimeMs = this.currentChunkStartMs + (rawChunkLength / this.targetSampleRate) * 1000;

    // Convert to 16-bit PCM WAV buffer
    const wavBuffer = this.encodeWAV(fullAudioSamples, this.targetSampleRate);

    this.emit("chunk", {
      chunkIndex: this.chunkIndex++,
      source: this.source,
      audioBuffer: wavBuffer,
      durationMs: chunkDurationMs,
      startTimeMs: Math.max(0, this.currentChunkStartMs - overlapDurationMs),
      endTimeMs: chunkEndTimeMs,
      overlapMs: overlapDurationMs,
      isForced,
    });

    // Save overlap tail (800ms) for the next chunk
    const overlapSampleCount = Math.min(
      Math.floor((this.overlapMs / 1000) * this.targetSampleRate),
      this.buffer.length,
    );
    this.overlapBuffer = this.buffer.slice(this.buffer.length - overlapSampleCount);

    // Reset buffer for next chunk
    this.buffer = new Float32Array(0);
    this.currentChunkStartMs = chunkEndTimeMs;
    this.continuousSilenceMs = 0;
  }

  private calculateRMS(samples: Float32Array): number {
    let sum = 0;
    for (let i = 0; i < samples.length; i++) {
      sum += samples[i] * samples[i];
    }
    return Math.sqrt(sum / (samples.length || 1));
  }

  private resampleTo16k(samples: Float32Array, srcRate: number): Float32Array {
    if (srcRate === this.targetSampleRate || srcRate <= 0) {
      return samples;
    }
    const ratio = this.targetSampleRate / srcRate;
    const outLength = Math.round(samples.length * ratio);
    const out = new Float32Array(outLength);
    for (let i = 0; i < outLength; i++) {
      const srcIdx = i / ratio;
      const idx0 = Math.floor(srcIdx);
      const idx1 = Math.min(idx0 + 1, samples.length - 1);
      const frac = srcIdx - idx0;
      out[i] = samples[idx0] * (1 - frac) + samples[idx1] * frac;
    }
    return out;
  }

  private encodeWAV(samples: Float32Array, sampleRate: number): Buffer {
    const numChannels = 1;
    const bytesPerSample = 2; // 16-bit PCM
    const dataSize = samples.length * bytesPerSample;
    const buffer = Buffer.alloc(44 + dataSize);

    // RIFF Header
    buffer.write("RIFF", 0);
    buffer.writeUInt32LE(36 + dataSize, 4);
    buffer.write("WAVE", 8);

    // fmt subchunk
    buffer.write("fmt ", 12);
    buffer.writeUInt32LE(16, 16); // subchunk1 size
    buffer.writeUInt16LE(1, 20);  // PCM format
    buffer.writeUInt16LE(numChannels, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(sampleRate * numChannels * bytesPerSample, 28); // byte rate
    buffer.writeUInt16LE(numChannels * bytesPerSample, 32); // block align
    buffer.writeUInt16LE(bytesPerSample * 8, 34); // bits per sample

    // data subchunk
    buffer.write("data", 36);
    buffer.writeUInt32LE(dataSize, 40);

    // PCM 16-bit samples
    let offset = 44;
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      const val = s < 0 ? s * 0x8000 : s * 0x7fff;
      buffer.writeInt16LE(Math.floor(val), offset);
      offset += 2;
    }

    return buffer;
  }
}
