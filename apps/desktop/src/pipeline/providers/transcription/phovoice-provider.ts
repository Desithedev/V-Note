/**
 * PhoVoice Transcription Provider for V-Note Desktop.
 * Connects to PhoVoice Cloud VPS or PhoVoice Local API Gateway.
 */
import {
  TranscriptionProvider,
  TranscribeParams,
  TranscribeContext,
  TranscriptionChunkResult,
  TranscriptionChunkSegment,
  ProviderPrivacyType,
} from "../../core/pipeline-types";
import { logger } from "../../../main/logger";
import { AppError, ErrorCodes } from "../../../types/error";
import {
  joinVietnameseTranscriptText,
  normalizeVietnameseTranscriptText,
} from "../../../utils/vietnamese-itn";
import { getUserAgent } from "../../../utils/http-client";
import {
  SILENCE_GATE_RMS,
  PHANTOM_GATE_RMS,
} from "../../utils/audio-gate-config";
import { StreamingLinearResampler } from "../../utils/streaming-linear-resampler";

export interface PhoVoiceProviderOptions {
  baseURL: string;
  apiKey?: string;
  mode?: "cloud" | "local";
  model?: string;
  punctuation?: boolean;
  normalization?: boolean;
  timestamps?: boolean;
  diarization?: boolean;
}

export class PhoVoiceProvider implements TranscriptionProvider {
  readonly id = "phovoice";
  readonly name = "PhoVoice ASR";
  readonly privacyType: ProviderPrivacyType = "remote";

  private options: PhoVoiceProviderOptions;
  private audioChunkBuffer: Float32Array[] = [];
  private totalBufferedSamples = 0;
  private bufferStartTimeMs: number | null = null;
  private isLocalMode: boolean = false;
  private ws: any = null;
  private latestPartialText: string = "";
  private wsConnecting: Promise<void> | null = null;
  private resampler = new StreamingLinearResampler(48000, 16000);
  private nextLocalHealthCheckAt = 0;
  private localServerReady = false;
  private nextHttpFallbackAt = 0;

  constructor(options: Partial<PhoVoiceProviderOptions> = {}) {
    this.options = {
      baseURL: options.baseURL?.replace(/\/+$/, "") || "http://127.0.0.1:8000",
      apiKey: options.apiKey || "",
      mode: options.mode || "cloud",
      model: options.model || "68M",
      punctuation: options.punctuation !== false,
      normalization: options.normalization !== false,
      timestamps: options.timestamps !== false,
      diarization: options.diarization || false,
    };
    this.isLocalMode =
      this.options.baseURL.includes("127.0.0.1") ||
      this.options.baseURL.includes("localhost") ||
      this.options.mode === "local";
  }

  public updateOptions(newOptions: Partial<PhoVoiceProviderOptions>): void {
    this.options = { ...this.options, ...newOptions };
    if (this.options.baseURL) {
      this.options.baseURL = this.options.baseURL.replace(/\/+$/, "");
      this.isLocalMode =
        this.options.baseURL.includes("127.0.0.1") ||
        this.options.baseURL.includes("localhost") ||
        this.options.mode === "local";
    }
  }

  public reset(): void {
    this.audioChunkBuffer = [];
    this.totalBufferedSamples = 0;
    this.bufferStartTimeMs = null;
    this.latestPartialText = "";
    this.resampler.reset();
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }
  }

  private lastWsFailureTime = 0;

  private async isLocalServerReady(): Promise<boolean> {
    const now = Date.now();
    if (now < this.nextLocalHealthCheckAt) {
      return this.localServerReady;
    }

    this.nextLocalHealthCheckAt = now + 5000;
    try {
      const response = await fetch("http://127.0.0.1:18765/health", {
        signal: AbortSignal.timeout(800),
      });
      this.localServerReady = response.ok;
    } catch {
      this.localServerReady = false;
    }
    return this.localServerReady;
  }

  private async ensureWebSocket(): Promise<any> {
    if (this.ws && this.ws.readyState === 1) {
      return this.ws;
    }
    if (Date.now() - this.lastWsFailureTime < 5000) {
      return null;
    }
    if (this.isLocalMode && !(await this.isLocalServerReady())) {
      this.lastWsFailureTime = Date.now();
      return null;
    }
    if (this.wsConnecting) {
      await this.wsConnecting;
      return this.ws;
    }

    this.wsConnecting = new Promise((resolve) => {
      try {
        let effectiveBase = this.options.baseURL;
        if (this.isLocalMode) {
          effectiveBase = "http://127.0.0.1:18765";
        }
        const wsUrl =
          effectiveBase.replace(/^http:/, "ws:").replace(/^https:/, "wss:") +
          "/v1/transcribe/stream";

        // Use global WebSocket available in Electron / Node 22
        const WS = globalThis.WebSocket || require("ws");
        const ws = new WS(wsUrl);
        ws.binaryType = "arraybuffer";

        ws.onopen = () => {
          this.ws = ws;
          resolve();
        };

        const handleMsg = (dataRaw: any) => {
          try {
            const raw =
              typeof dataRaw === "string"
                ? dataRaw
                : Buffer.isBuffer(dataRaw)
                  ? dataRaw.toString("utf-8")
                  : dataRaw instanceof ArrayBuffer
                    ? new TextDecoder().decode(dataRaw)
                    : dataRaw?.data
                      ? typeof dataRaw.data === "string"
                        ? dataRaw.data
                        : Buffer.from(dataRaw.data).toString("utf-8")
                      : "";
            if (raw) {
              const data = JSON.parse(raw);
              if (data.type === "partial" || data.type === "final") {
                // Prefer the server's punctuated/normalized full hypothesis.
                // Some PhoVoice gateways send only `delta`; appending that as
                // a full hypothesis used to lose words and create bad spacing.
                const fullText =
                  data.punctuated_text ||
                  data.normalized_text ||
                  data.full_text ||
                  data.text;
                if (typeof fullText === "string" && fullText.trim()) {
                  this.latestPartialText =
                    normalizeVietnameseTranscriptText(fullText);
                } else if (
                  typeof data.delta === "string" &&
                  data.delta.trim()
                ) {
                  this.latestPartialText = joinVietnameseTranscriptText(
                    this.latestPartialText,
                    data.delta,
                  );
                }
              }
            }
          } catch {
            // ignore
          }
        };

        ws.onmessage = handleMsg;
        if (typeof (ws as any).on === "function") {
          (ws as any).on("message", handleMsg);
        }

        ws.onerror = (e: any) => {
          this.lastWsFailureTime = Date.now();
          logger.transcription.debug(
            "[PhoVoiceProvider] Streaming WebSocket error (batch fallback available):",
            e,
          );
          this.ws = null;
          resolve();
        };

        ws.onclose = () => {
          this.ws = null;
        };
      } catch (err) {
        this.lastWsFailureTime = Date.now();
        logger.transcription.debug(
          "[PhoVoiceProvider] Streaming WebSocket unavailable:",
          err,
        );
        resolve();
      }
    });

    await this.wsConnecting;
    this.wsConnecting = null;
    return this.ws;
  }

  /**
   * Check connection and server health.
   */
  public async isAvailable(): Promise<boolean> {
    try {
      const url = `${this.options.baseURL}/health`;
      const response = await fetch(url, {
        method: "GET",
        headers: this.getHeaders(),
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) return false;
      const data = (await response.json()) as { status?: string };
      return data.status === "ok" || data.status === "healthy";
    } catch (e) {
      logger.transcription.warn(
        `[PhoVoiceProvider] isAvailable check failed for ${this.options.baseURL}:`,
        e,
      );
      return false;
    }
  }

  /**
   * Fetch capabilities dynamically from PhoVoice Server.
   */
  public async fetchCapabilities(): Promise<Record<string, any>> {
    try {
      const url = `${this.options.baseURL}/v1/capabilities`;
      const response = await fetch(url, {
        method: "GET",
        headers: this.getHeaders(),
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return await response.json();
    } catch (e) {
      logger.transcription.warn(
        "[PhoVoiceProvider] fetchCapabilities failed:",
        e,
      );
      return {
        provider: "phovoice",
        streaming: true,
        punctuation: true,
        normalization: true,
        timestamps: true,
        diarization: false,
      };
    }
  }

  /**
   * In streaming mode, chunks are streamed over WebSocket if available for instant live text,
   * or processed via VAD/silence-based incremental chunks for responsive meeting transcription.
   */
  public async transcribe(
    params: TranscribeParams,
  ): Promise<TranscriptionChunkResult> {
    const { audioData, sampleRate } = params;
    if (audioData.length === 0) {
      return { text: "", segments: [] };
    }

    if (params.startTimeMs !== undefined && this.bufferStartTimeMs === null) {
      this.bufferStartTimeMs = params.startTimeMs;
    }

    // Downsample 48kHz to 16kHz for speech models
    const samples16k =
      sampleRate === 48000 || audioData.length >= 4800
        ? this.resampler.process(audioData)
        : audioData;

    this.audioChunkBuffer.push(samples16k);
    this.totalBufferedSamples += samples16k.length;

    try {
      const ws = await this.ensureWebSocket();
      if (ws && (ws.readyState === 1 || ws.readyState === ws.OPEN)) {
        const int16 = new Int16Array(samples16k.length);
        for (let i = 0; i < samples16k.length; i++) {
          const s = Math.max(-1, Math.min(1, samples16k[i]));
          int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }
        ws.send(int16.buffer);
      }
    } catch {
      // streaming fallback
    }

    // Energy analysis on latest chunk to detect utterance boundary
    let chunkSq = 0;
    for (let i = 0; i < samples16k.length; i++) {
      chunkSq += samples16k[i] * samples16k[i];
    }
    const chunkRms = Math.sqrt(chunkSq / (samples16k.length || 1));
    const isChunkSilent = chunkRms < SILENCE_GATE_RMS;

    // Trigger chunk inference if:
    // 1. We have at least 2.0s of audio and a natural pause (silence) occurred, OR
    // 2. Buffer exceeds 5.0s (force chunk so live transcript remains responsive)
    const canTranscribeNow = Date.now() >= this.nextHttpFallbackAt;
    const shouldCutUtterance =
      canTranscribeNow &&
      ((this.totalBufferedSamples >= 32000 && isChunkSilent) ||
        this.totalBufferedSamples >= 80000);

    if (shouldCutUtterance) {
      this.nextHttpFallbackAt = Date.now() + 1500; // 1.5s cooldown between HTTP chunk calls

      // Check overall energy of entire buffer
      let totalSq = 0;
      for (const chunk of this.audioChunkBuffer) {
        for (let i = 0; i < chunk.length; i++) {
          totalSq += chunk[i] * chunk[i];
        }
      }
      const totalRms = Math.sqrt(totalSq / (this.totalBufferedSamples || 1));

      if (totalRms < SILENCE_GATE_RMS) {
        // Discard silent buffer so memory stays 0 and we don't spam STT with silence
        this.audioChunkBuffer = [];
        this.totalBufferedSamples = 0;
        this.bufferStartTimeMs = null;
        return { text: "", segments: [] };
      }

      // Valid speech detected! Merge and transcribe chunk
      const merged = new Float32Array(this.totalBufferedSamples);
      let offset = 0;
      for (const chunk of this.audioChunkBuffer) {
        merged.set(chunk, offset);
        offset += chunk.length;
      }
      const baseTimeMs = this.bufferStartTimeMs ?? params.startTimeMs ?? 0;
      this.audioChunkBuffer = [];
      this.totalBufferedSamples = 0;
      this.bufferStartTimeMs = null;

      try {
        const result = await this.transcribeChunk(
          merged,
          16000,
          params.context || {},
          baseTimeMs,
        );
        if (result.text.trim()) {
          this.latestPartialText = "";
          return result;
        }
      } catch (error) {
        logger.transcription.debug(
          "[PhoVoiceProvider] Realtime chunk transcription notice:",
          error,
        );
      }
    }

    return { text: "", segments: [] };
  }

  /**
   * Transcribe one realtime PCM chunk through the same HTTP path used by `flush`.
   */
  private async transcribeChunk(
    samples: Float32Array,
    _sampleRate: number,
    context: TranscribeContext,
    baseTimeMs: number,
  ): Promise<TranscriptionChunkResult> {
    const prevBuffer = this.audioChunkBuffer;
    const prevSamples = this.totalBufferedSamples;
    const prevStartTime = this.bufferStartTimeMs;

    this.audioChunkBuffer = [samples];
    this.totalBufferedSamples = samples.length;
    this.bufferStartTimeMs = baseTimeMs;
    try {
      return await this.flush(context);
    } finally {
      this.audioChunkBuffer = prevBuffer;
      this.totalBufferedSamples = prevSamples;
      this.bufferStartTimeMs = prevStartTime;
    }
  }

  public getPartialText(): string {
    return this.latestPartialText || "";
  }

  /**
   * Flush all buffered audio and send to PhoVoice Gateway API.
   */
  public async flush(
    context: TranscribeContext,
  ): Promise<TranscriptionChunkResult> {
    if (this.audioChunkBuffer.length === 0) {
      return { text: "", segments: [] };
    }

    const tStart = performance.now();
    const baseTimeMs = this.bufferStartTimeMs ?? 0;

    // 1. Merge Float32Array chunks into single buffer (already 16kHz)
    const merged = new Float32Array(this.totalBufferedSamples);
    let offset = 0;
    for (const chunk of this.audioChunkBuffer) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    this.reset();

    // Calculate RMS energy of merged buffer
    let sumSq = 0;
    for (let i = 0; i < merged.length; i++) {
      sumSq += merged[i] * merged[i];
    }
    const rms = Math.sqrt(sumSq / (merged.length || 1));

    // If audio is silence or background noise, skip sending to ASR
    if (rms < SILENCE_GATE_RMS) {
      return { text: "", segments: [] };
    }

    // 2. Encode to 16kHz 16-bit Mono PCM WAV buffer
    const wavBytes = this.float32ToWav(merged, 16000);

    // 3. Send multipart/form-data to /v1/transcribe
    try {
      const formData = new FormData();
      const blob = new Blob([wavBytes], { type: "audio/wav" });
      formData.append("file", blob, `audio_${Date.now()}.wav`);
      formData.append("model", this.options.model || context.modelId || "68M");
      formData.append(
        "punctuation",
        String(this.options.punctuation !== false),
      );
      formData.append(
        "normalize",
        String(this.options.normalization !== false),
      );
      formData.append("timestamps", String(this.options.timestamps !== false));
      formData.append(
        "diarization",
        String(this.options.diarization !== false),
      );
      if (context.sessionId) {
        formData.append("session_id", context.sessionId);
      }
      if (context.aggregatedTranscription) {
        formData.append("context", context.aggregatedTranscription);
      }

      let response: Response | null = null;
      const candidateUrls: string[] = [];
      if (this.isLocalMode) {
        candidateUrls.push("http://127.0.0.1:18765", "http://127.0.0.1:8000");
      }
      if (!candidateUrls.includes(this.options.baseURL)) {
        candidateUrls.push(this.options.baseURL);
      }

      for (const base of candidateUrls) {
        try {
          const transcribeUrl = `${base}/v1/transcribe`;
          const res = await fetch(transcribeUrl, {
            method: "POST",
            headers: this.getHeaders(false),
            body: formData,
            signal: AbortSignal.timeout(300000),
          });
          if (res.ok) {
            response = res;
            if (this.options.baseURL !== base) {
              this.options.baseURL = base;
            }
            break;
          } else if (
            res.status === 401 ||
            res.status === 403 ||
            res.status === 429
          ) {
            response = res;
            break;
          }
        } catch {
          // Try next candidate port
        }
      }

      if (!response) {
        if (this.isLocalMode) {
          throw new AppError(
            "PhoVoice Local Engine chưa sẵn sàng. Vui lòng vào Cài đặt -> Mô hình AI để bấm 'Tải Model (150MB)' hoặc 'Reset Engine'.",
            ErrorCodes.NETWORK_ERROR,
          );
        } else {
          throw new AppError(
            `Không thể kết nối đến máy chủ PhoVoice tại ${this.options.baseURL}. Vui lòng kiểm tra kết nối mạng.`,
            ErrorCodes.NETWORK_ERROR,
          );
        }
      }

      if (!response.ok) {
        const status = response.status;
        let errDetail = "";
        try {
          const errJson = await response.json();
          errDetail = errJson.detail || errJson.message || "";
        } catch {
          errDetail = await response.text();
        }

        if (status === 401 || status === 403) {
          throw new AppError(
            `PhoVoice Authentication Error (401): ${errDetail || "Invalid token/API key."}`,
            ErrorCodes.AUTH_REQUIRED,
          );
        } else if (status === 429) {
          throw new AppError(
            `PhoVoice Quota Exceeded (429): ${errDetail || "Usage quota limit reached."}`,
            ErrorCodes.RATE_LIMIT_EXCEEDED,
          );
        } else if (status >= 500) {
          throw new AppError(
            `PhoVoice Server Error (${status}): ${errDetail || "Service temporarily unavailable."}`,
            ErrorCodes.INTERNAL_SERVER_ERROR,
          );
        } else {
          throw new Error(`PhoVoice HTTP ${status}: ${errDetail}`);
        }
      }

      const result = (await response.json()) as {
        id?: string;
        text?: string;
        language?: string;
        duration?: number;
        processing_time?: number;
        segments?: Array<{
          start: number;
          end: number;
          speaker?: string;
          speaker_label?: string;
          text: string;
          confidence?: number;
          translation?: string;
        }>;
        features?: {
          punctuation?: boolean;
          normalization?: boolean;
          timestamps?: boolean;
          diarization?: boolean;
          translation?: boolean;
        };
      };

      const rawText = (result.text ?? "").trim();
      const normalizedFullText = normalizeVietnameseTranscriptText(rawText);

      const segments: TranscriptionChunkSegment[] = (result.segments ?? []).map(
        (seg) => ({
          text: normalizeVietnameseTranscriptText(seg.text),
          startTimeMs: baseTimeMs + Math.round(seg.start * 1000),
          endTimeMs: baseTimeMs + Math.round(seg.end * 1000),
          speaker: seg.speaker || "SPEAKER_00",
          speakerLabel: seg.speaker_label || "Người 1",
          translation: seg.translation,
          confidence: seg.confidence ?? 0.95,
        }),
      );

      const lower = rawText
        .toLowerCase()
        .replace(/[.,!?;:"]/g, "")
        .trim();
      const PHANTOM_WORDS = new Set([
        "để",
        "ừ",
        "à",
        "hả",
        "ê",
        "ơ",
        "o",
        "a",
        "u",
        "thế",
        "cảm ơn",
        "bye",
        "you",
        "the",
      ]);

      // If low energy and returned text is just a 1-syllable phantom hallucination, discard it
      if (
        rms < PHANTOM_GATE_RMS &&
        (lower.length <= 4 || PHANTOM_WORDS.has(lower))
      ) {
        return { text: "", segments: [] };
      }

      // Drop segments dominated by n-gram repetition (e.g. "hello hello hello hello")
      if (hasExcessiveNgramRepetition(normalizedFullText)) {
        logger.transcription.debug(
          `[PhoVoiceProvider] Dropped repetitive text: "${normalizedFullText.slice(0, 80)}"`,
        );
        return { text: "", segments: [] };
      }

      const procDurationMs = performance.now() - tStart;
      logger.transcription.info(
        `[PhoVoiceProvider] Transcribed in ${procDurationMs.toFixed(0)}ms: "${normalizedFullText.slice(0, 50)}..."`,
      );

      return {
        text: normalizedFullText,
        language: result.language ?? "vi",
        confidence: 0.95,
        processingTimeMs: procDurationMs,
        segments,
      };
    } catch (error) {
      logger.transcription.error(
        "[PhoVoiceProvider] Transcription error:",
        error,
      );
      throw error;
    }
  }

  private getHeaders(includeContentTypeJson: boolean = true): HeadersInit {
    const headers: Record<string, string> = {
      "User-Agent": getUserAgent(),
    };
    if (includeContentTypeJson) {
      headers["Content-Type"] = "application/json";
    }
    if (this.options.apiKey) {
      headers["Authorization"] = `Bearer ${this.options.apiKey}`;
      headers["X-API-Key"] = this.options.apiKey;
    }
    return headers;
  }

  /**
   * Convert Float32Array samples [-1.0, 1.0] to a RIFF WAV Buffer (16-bit PCM, 16kHz mono).
   */
  private float32ToWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
    const numChannels = 1;
    const bytesPerSample = 2;
    const blockAlign = numChannels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const dataSize = samples.length * bytesPerSample;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

    // RIFF chunk descriptor
    this.writeString(view, 0, "RIFF");
    view.setUint32(4, 36 + dataSize, true);
    this.writeString(view, 8, "WAVE");

    // fmt sub-chunk
    this.writeString(view, 12, "fmt ");
    view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
    view.setUint16(20, 1, true); // AudioFormat (1 for PCM)
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true); // BitsPerSample

    // data sub-chunk
    this.writeString(view, 36, "data");
    view.setUint32(40, dataSize, true);

    // Write PCM 16-bit audio samples
    let offset = 44;
    for (let i = 0; i < samples.length; i++, offset += 2) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }

    return buffer;
  }

  private writeString(view: DataView, offset: number, string: string): void {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  }

  public async dispose(): Promise<void> {
    this.reset();
    if (this.ws) {
      try {
        this.ws.close();
      } catch {}
      this.ws = null;
    }
  }
}

/**
 * Detect excessive n-gram repetition in text. Whisper and PhoVoice both
 * sometimes produce repetitive loops like "cảm ơn cảm ơn cảm ơn cảm ơn".
 *
 * Returns true if any n-gram (2-5 words) repeats >= 3 times in the text.
 */
function hasExcessiveNgramRepetition(text: string): boolean {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length < 6) return false;

  for (
    let ngramSize = 2;
    ngramSize <= Math.min(5, Math.floor(words.length / 3));
    ngramSize++
  ) {
    const seen = new Map<string, number>();
    for (let i = 0; i <= words.length - ngramSize; i++) {
      const ngram = words.slice(i, i + ngramSize).join(" ");
      const count = (seen.get(ngram) ?? 0) + 1;
      if (count >= 3) return true;
      seen.set(ngram, count);
    }
  }

  return false;
}
