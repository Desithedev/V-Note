/**
 * Centralized audio gate thresholds for the transcription pipeline.
 *
 * All RMS energy thresholds live here so they stay consistent across
 * providers, chunkers, and UI indicators. Individual consumers import
 * only the constants they need.
 */

/** RMS below which a chunk is considered complete silence (pre-send gate). */
export const SILENCE_GATE_RMS = 0.007;

/** RMS below which a short or phantom transcription is discarded. */
export const PHANTOM_GATE_RMS = 0.015;

/** RMS below which the chunker counts a frame as silence for boundary detection. */
export const CHUNKER_SILENCE_RMS = 0.012;

/**
 * Minimum confidence a segment must have to be kept.
 * Segments below this threshold are dropped during finalization.
 */
export const DEFAULT_CONFIDENCE_THRESHOLD = 0.8;
