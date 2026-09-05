import React, { useCallback } from "react";
import { IconNotes } from "@tabler/icons-react";
import { Subtitles } from "lucide-react";
import type {
  AudioSource,
  MeetingTranscriptFontSize,
  MeetingTranscriptMode,
  MeetingWidgetEdge,
} from "@/types/meeting-widget";
import type { MeetingRuntimeState } from "@/types/meeting";
import { IconButton } from "./icon-button";
import { WaveformStopAnchor } from "./waveform-stop-anchor";
import { DragHandle } from "./drag-handle";
import { TranscriptPopup } from "./transcript-popup";

export interface RecordingPillProps {
  edge: MeetingWidgetEdge;
  noteId?: number | null;
  showTranscript: boolean;
  transcriptMode: MeetingTranscriptMode;
  transcriptFontSize: MeetingTranscriptFontSize;
  meetingState: MeetingRuntimeState;
  level: number;
  onStop: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onOpenNote: () => void;
  onShowTranscriptChange: (showTranscript: boolean) => void;
  onTranscriptModeChange: (mode: MeetingTranscriptMode) => void;
  onTranscriptFontSizeChange: (fontSize: MeetingTranscriptFontSize) => void;
  mutedSources: Record<AudioSource, boolean>;
  onToggleSourceMute: (source: AudioSource) => void;
  showHandle: boolean;
  onDragStart: (event: React.PointerEvent<HTMLButtonElement>) => void;
}

// Recording state always lives in its expanded form — same 36×36 frame
// as the idle pill, with Open Note + Subtitle toggle + drag handle around it.
const FRAME = 36;
const GAP = 6;
const OPEN_NOTE = 36;
const HANDLE_SHORT = 18;

export function RecordingPill({
  edge,
  noteId = null,
  showTranscript,
  transcriptMode,
  transcriptFontSize,
  meetingState,
  level,
  onStop,
  onOpenNote,
  onShowTranscriptChange,
  onTranscriptModeChange,
  onTranscriptFontSizeChange,
  mutedSources,
  onToggleSourceMute,
  showHandle,
  onDragStart,
}: RecordingPillProps) {
  const isVertical = edge === "right";
  const tooltipSide = isVertical ? "left" : "top";
  const handleCloseTranscript = useCallback(
    () => onShowTranscriptChange(false),
    [onShowTranscriptChange],
  );

  const openNoteStyle: React.CSSProperties = isVertical
    ? { right: 0, top: -(OPEN_NOTE + GAP) }
    : { right: -(OPEN_NOTE + GAP), top: 0 };

  const subtitleStyle: React.CSSProperties = isVertical
    ? { right: 0, top: -(OPEN_NOTE * 2 + GAP * 2) }
    : { right: -(OPEN_NOTE * 2 + GAP * 2), top: 0 };

  const handleStyle: React.CSSProperties = isVertical
    ? {
        bottom: -(HANDLE_SHORT + GAP),
        left: "50%",
        transform: "translateX(-50%)",
      }
    : {
        left: -(HANDLE_SHORT + GAP),
        top: "50%",
        transform: "translateY(-50%)",
      };

  const hitUnderlayStyle: React.CSSProperties = isVertical
    ? {
        top: -(OPEN_NOTE * 2 + GAP * 2),
        left: 0,
        width: FRAME,
        height: OPEN_NOTE * 2 + GAP * 2 + FRAME + GAP + HANDLE_SHORT,
      }
    : {
        top: 0,
        left: -(HANDLE_SHORT + GAP),
        width: HANDLE_SHORT + GAP + FRAME + GAP + OPEN_NOTE * 2 + GAP,
        height: FRAME,
      };

  return (
    <div
      className="relative"
      style={{ width: FRAME, height: FRAME }}
      data-hit-zone="true"
    >
      {/* Floating Real-time Transcript Subtitle Popup */}
      {showTranscript ? (
        <TranscriptPopup
          edge={edge}
          noteId={noteId}
          mode={transcriptMode}
          fontSize={transcriptFontSize}
          onClose={handleCloseTranscript}
          onOpenNote={onOpenNote}
          onModeChange={onTranscriptModeChange}
          onFontSizeChange={onTranscriptFontSizeChange}
          mutedSources={mutedSources}
          onToggleSourceMute={onToggleSourceMute}
        />
      ) : null}

      {/* Hit-zone underlay — covers all buttons */}
      <div className="absolute" style={hitUnderlayStyle} data-hit-zone="true" />

      {/* Waveform / Stop anchor — always present */}
      <div className="absolute inset-0">
        <WaveformStopAnchor
          meetingState={meetingState}
          level={level}
          onStop={onStop}
          tooltipSide={tooltipSide}
        />
      </div>

      {/* Subtitle toggle button */}
      <div className="absolute" style={subtitleStyle}>
        <IconButton
          tooltip={
            showTranscript
              ? "Ẩn phụ đề ngoài màn hình"
              : "Hiện phụ đề ngoài màn hình"
          }
          icon={
            <Subtitles
              className={`h-4 w-4 ${showTranscript ? "text-emerald-400" : "text-zinc-400"}`}
            />
          }
          onClick={() => onShowTranscriptChange(!showTranscript)}
          tooltipSide={tooltipSide}
        />
      </div>

      {/* Open Note — always rendered while recording */}
      <div className="absolute" style={openNoteStyle}>
        <IconButton
          tooltip="Mở Ghi chú"
          icon={<IconNotes size={16} stroke={2} />}
          onClick={onOpenNote}
          tooltipSide={tooltipSide}
        />
      </div>

      {/* Drag handle — always visible while recording */}
      <div className="absolute" style={handleStyle}>
        <DragHandle
          edge={edge}
          visible={showHandle}
          onPointerDown={onDragStart}
          tooltipSide={tooltipSide}
        />
      </div>
    </div>
  );
}
