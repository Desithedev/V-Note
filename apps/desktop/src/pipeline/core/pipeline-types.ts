/**
 * Core pipeline types - Modular Transcription Provider Architecture
 */

import { PipelineContext } from "./context";
import { GetAccessibilityContextResult } from "@prismical/types";
export { PipelineContext, SharedPipelineData } from "./context";

// Context for transcription operations (shared between transcribe and flush)
export interface TranscribeContext {
  sessionId?: string;
  vocabulary?: string[];
  accessibilityContext?: GetAccessibilityContextResult | null;
  previousChunk?: string;
  aggregatedTranscription?: string;
  language?: string;
  modelId?: string;
}

// Transcription input parameters
export interface TranscribeParams {
  audioData: Float32Array;
  sampleRate: number;
  startTimeMs?: number;
  context: TranscribeContext;
}

export interface TranscriptionChunkSegment {
  text: string;
  startTimeMs: number;
  endTimeMs: number;
  speaker?: string;
  speakerLabel?: string;
  translation?: string;
  confidence?: number;
}

export interface TranscriptionChunkResult {
  text: string;
  language?: string;
  confidence?: number;
  processingTimeMs?: number;
  segments?: TranscriptionChunkSegment[];
}

export type ProviderPrivacyType = "local" | "remote";

// Universal Transcription Provider Interface
export interface TranscriptionProvider {
  readonly id: string;
  readonly name: string;
  readonly privacyType?: ProviderPrivacyType;
  transcribe(params: TranscribeParams): Promise<TranscriptionChunkResult>;
  flush(context: TranscribeContext): Promise<TranscriptionChunkResult>;
  reset(): void; // Clear internal buffers without transcribing
  getPartialText?(): string; // Real-time interim/partial recognition text
  isAvailable?(): Promise<boolean>;
  preloadModel?(): Promise<void>;
  dispose?(): Promise<void>;
}

// Streaming context for pipeline processing
export interface StreamingPipelineContext extends PipelineContext {
  sessionId: string;
  isPartial: boolean;
  isFinal: boolean;
  accumulatedTranscription?: string[]; // Store all partial results
}

// Session data for streaming transcription
export interface StreamingSession {
  context: StreamingPipelineContext;
  transcriptionResults: string[]; // Accumulate all transcription chunks
  firstChunkReceivedAt?: number; // When first audio chunk arrived at transcription service
  recordingStartedAt?: number; // When user pressed record button (from RecordingManager)
  recordingStoppedAt?: number; // When user released record button (from RecordingManager)
  finalizationStartedAt?: number; // When finalizeSession() was called
}
