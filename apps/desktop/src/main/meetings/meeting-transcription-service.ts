import { Mutex } from "async-mutex";
import type { TranscriptionProvider } from "@/pipeline/core/pipeline-types";
import type { ModelService } from "@/services/model-service";
import type {
  AudioFrame,
  AudioSource,
  TranscriptSpeaker,
} from "@/types/meeting";
import {
  joinVietnameseTranscriptText,
  normalizeVietnameseTranscriptText,
} from "@/utils/vietnamese-itn";
import {
  createMeetingTranscriptionProvider,
  type MeetingTranscriptionSelection,
} from "./meeting-transcription-provider-registry";

export interface MeetingTranscriptionChunk {
  source: AudioSource;
  speaker: TranscriptSpeaker;
  speakerId?: string;
  speakerLabel?: string;
  text: string;
  translation?: string;
  confidence?: number;
  startTimeMs: number;
  endTimeMs: number;
  isFinal: boolean;
}

interface CreateMeetingSourceRuntimeOptions {
  meetingId: string;
  source: AudioSource;
  speaker: TranscriptSpeaker;
  language?: string;
  confidenceThreshold?: number;
}

export class MeetingTranscriptionService {
  constructor(private readonly modelService: ModelService) {}

  async createSourceRuntime(
    options: CreateMeetingSourceRuntimeOptions,
  ): Promise<MeetingSourceTranscriptionRuntime> {
    const { provider, selection } = await createMeetingTranscriptionProvider(
      this.modelService,
    );

    provider.reset();

    return new MeetingSourceTranscriptionRuntime(provider, selection, options);
  }
}

export class MeetingSourceTranscriptionRuntime {
  private readonly mutex = new Mutex();
  private aggregatedText = "";
  private lastProviderChunk: string | undefined;
  private pendingStartTimeMs: number | null = null;
  private pendingEndTimeMs = 0;
  private emittedTexts: string[] = [];
  /**
   * PhoVoice may finish a request successfully but the client can lose the
   * response and submit the same request again.  Keep the last complete
   * result so a retry cannot be persisted as a second transcript.
   */
  private lastOutputSignature: string | null = null;

  constructor(
    private readonly provider: TranscriptionProvider,
    private readonly selection: MeetingTranscriptionSelection,
    private readonly options: CreateMeetingSourceRuntimeOptions,
  ) {}

  getMetadata(): MeetingTranscriptionSelection {
    return this.selection;
  }

  async ingestFrame(frame: AudioFrame): Promise<MeetingTranscriptionChunk[]> {
    return this.mutex.runExclusive(async () => {
      if (this.pendingStartTimeMs === null) {
        this.pendingStartTimeMs = frame.timestampMs;
      }

      this.pendingEndTimeMs = Math.max(
        this.pendingEndTimeMs,
        frame.timestampMs + frame.durationMs,
      );

      try {
        const providerText = await this.provider.transcribe({
          audioData: frame.samples,
          sampleRate: frame.sampleRate,
          startTimeMs: frame.timestampMs,
          context: {
            sessionId: this.options.meetingId,
            language: this.options.language ?? "auto",
            previousChunk: this.lastProviderChunk,
            aggregatedTranscription: this.aggregatedText || undefined,
          },
        });

        return this.consumeProviderOutput(providerText, false);
      } catch {
        return [];
      }
    });
  }

  async flush(): Promise<MeetingTranscriptionChunk[]> {
    return this.mutex.runExclusive(async () => {
      try {
        const providerText = await this.provider.flush({
          sessionId: this.options.meetingId,
          language: this.options.language ?? "auto",
          previousChunk: this.lastProviderChunk,
          aggregatedTranscription: this.aggregatedText || undefined,
        });

        return this.consumeProviderOutput(providerText, true);
      } catch {
        return [];
      }
    });
  }

  async dispose(): Promise<void> {
    if (
      "dispose" in this.provider &&
      typeof this.provider.dispose === "function"
    ) {
      await this.provider.dispose();
      return;
    }

    this.provider.reset();
  }

  getPartialText(): string {
    if (
      "getPartialText" in this.provider &&
      typeof this.provider.getPartialText === "function"
    ) {
      return this.provider.getPartialText() ?? "";
    }
    return "";
  }

  private consumeProviderOutput(
    providerOutput: Awaited<ReturnType<TranscriptionProvider["flush"]>>,
    isFinal: boolean,
  ): MeetingTranscriptionChunk[] {
    const emittedText = this.extractEmittedText(providerOutput.text);
    this.lastProviderChunk = providerOutput.text;

    const outputSignature = this.createOutputSignature(providerOutput);
    if (outputSignature && outputSignature === this.lastOutputSignature) {
      // The audio has already been committed by the first successful response.
      // Advance the pending window so this retry cannot be merged into the next
      // genuine chunk.
      this.resetPendingRange();
      return [];
    }

    const confidenceThreshold = this.options.confidenceThreshold ?? 0;
    const emittedSegments =
      providerOutput.segments?.filter((segment) => segment.text.trim()) ?? [];

    if (emittedSegments.length > 0) {
      this.resetPendingRange();
      const chunks = emittedSegments
        .filter((segment) => {
          if (confidenceThreshold > 0 && segment.confidence != null) {
            return segment.confidence >= confidenceThreshold;
          }
          return true;
        })
        .map((segment) => {
          const dedupedText = this.deduplicateOverlap(
            normalizeVietnameseTranscriptText(segment.text),
          );
          return {
            source: this.options.source,
            speaker: this.options.speaker,
            speakerId:
              this.options.source === "mic"
                ? "you"
                : segment.speaker || "SPEAKER_00",
            speakerLabel:
              this.options.source === "mic"
                ? "Bạn (Mic)"
                : (segment.speakerLabel && segment.speakerLabel !== "Người 1"
                    ? segment.speakerLabel
                    : "Đối phương (Hệ thống)"),
            translation: segment.translation,
            confidence: segment.confidence,
            text: dedupedText,
            startTimeMs: segment.startTimeMs,
            endTimeMs: segment.endTimeMs,
            isFinal,
          };
        })
        .filter((chunk) => chunk.text.length > 0);

      for (const chunk of chunks) {
        this.emittedTexts.push(chunk.text);
        if (this.emittedTexts.length > 20) {
          this.emittedTexts.shift();
        }
      }

      if (chunks.length > 0) {
        this.lastOutputSignature = outputSignature;
      }

      return chunks;
    }

    if (!emittedText.trim() || this.pendingStartTimeMs === null) {
      return [];
    }

    const dedupedText = this.deduplicateOverlap(
      normalizeVietnameseTranscriptText(emittedText),
    );

    const chunk: MeetingTranscriptionChunk = {
      source: this.options.source,
      speaker: this.options.speaker,
      speakerId: this.options.source === "mic" ? "you" : "SPEAKER_00",
      speakerLabel:
        this.options.source === "mic"
          ? "Bạn (Mic)"
          : "Đối phương (Hệ thống)",
      text: dedupedText,
      startTimeMs: this.pendingStartTimeMs,
      endTimeMs: this.pendingEndTimeMs,
      isFinal,
    };

    this.emittedTexts.push(dedupedText);
    if (this.emittedTexts.length > 20) {
      this.emittedTexts.shift();
    }

    this.resetPendingRange();

    if (dedupedText.length > 0) {
      this.lastOutputSignature = outputSignature;
    }

    return dedupedText.length > 0 ? [chunk] : [];
  }

  private extractEmittedText(providerText: string): string {
    const normalizedText = normalizeVietnameseTranscriptText(providerText);
    this.aggregatedText = joinVietnameseTranscriptText(
      this.aggregatedText,
      normalizedText,
    );
    return normalizedText;
  }

  private createOutputSignature(
    providerOutput: Awaited<ReturnType<TranscriptionProvider["flush"]>>,
  ): string | null {
    const parts = providerOutput.segments?.length
      ? providerOutput.segments.map((segment) => segment.text).join("\u001f")
      : providerOutput.text;
    const normalized = parts
      .toLocaleLowerCase("vi")
      .replace(/\s+/g, " ")
      .replace(/[.,!?;:]+/g, "")
      .trim();

    return normalized || null;
  }

  /**
   * Detect and strip overlap text that was already emitted in a previous chunk.
   * The SmartAudioChunker prepends 800ms of overlap audio to each chunk, so
   * the ASR may return the same trailing text from the previous chunk.
   */
  private deduplicateOverlap(text: string): string {
    if (!text || this.emittedTexts.length === 0) return text;

    const lastEmitted = this.emittedTexts[this.emittedTexts.length - 1] ?? "";
    if (!lastEmitted) return text;

    const lowerText = text.toLowerCase();
    const lowerLast = lastEmitted.toLowerCase();

    // Check if the start of new text overlaps with the end of previous text
    const maxOverlapLen = Math.min(lowerLast.length, lowerText.length);
    for (let overlapLen = maxOverlapLen; overlapLen >= 3; overlapLen--) {
      if (
        lowerLast.endsWith(lowerText.slice(0, overlapLen)) &&
        overlapLen < lowerText.length
      ) {
        return text.slice(overlapLen).trim();
      }
    }

    return text;
  }

  private resetPendingRange(): void {
    this.pendingStartTimeMs = null;
    this.pendingEndTimeMs = 0;
  }
}
