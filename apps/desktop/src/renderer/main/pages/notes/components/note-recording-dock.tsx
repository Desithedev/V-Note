import { useState } from "react";
import { Mic, MicOff, Square, ChevronUp, Volume2, VolumeX, Radio } from "lucide-react";
import { Waveform } from "@/components/Waveform";
import { toast } from "sonner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { MeetingRuntimeState } from "@/types/meeting";
import { SkillSparkleButton } from "./skill-sparkle-button";

const NUM_WAVEFORM_BARS = 6;

type NoteRecordingDockProps = {
  noteId?: number;
  isTranscriptionOpen?: boolean;
  onToggleTranscription?: () => void;
  meetingState: MeetingRuntimeState;
  // Real-time audio amplitude in [0, 1] (combined mic + system). Owned by
  // the parent via useMeetingLevel so a single subscription feeds every
  // dock instance.
  level: number;
  onStartMeeting: (mode?: "dual" | "mic" | "system") => void;
  onStopMeeting: () => void;
};

export function NoteRecordingDock({
  noteId,
  isTranscriptionOpen = false,
  onToggleTranscription,
  meetingState,
  level,
  onStartMeeting,
  onStopMeeting,
}: NoteRecordingDockProps) {
  const [enableMic, setEnableMic] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem("vnote_mic_enabled");
      if (stored !== null) return stored !== "false";
      return localStorage.getItem("prismical_mic_enabled") !== "false";
    } catch {
      return true;
    }
  });

  const [enableSystemAudio, setEnableSystemAudio] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem("vnote_system_audio_enabled");
      if (stored !== null) return stored === "true";
      return localStorage.getItem("prismical_system_audio_enabled") === "true";
    } catch {
      return false;
    }
  });

  const toggleMic = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const nextVal = !enableMic;
    setEnableMic(nextVal);
    try {
      localStorage.setItem("vnote_mic_enabled", String(nextVal));
    } catch {}
    if (nextVal) {
      toast.success("🎙️ Đã BẬT thu âm Micro");
    } else {
      toast.info("🔇 Đã TẮT thu âm Micro");
    }
  };

  const toggleSystemAudio = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const nextVal = !enableSystemAudio;
    setEnableSystemAudio(nextVal);
    try {
      localStorage.setItem("vnote_system_audio_enabled", String(nextVal));
    } catch {}
    if (nextVal) {
      toast.success("🔊 Đã BẬT thu âm thanh hệ thống (Mọi ứng dụng máy tính)");
    } else {
      toast.info("🔇 Đã TẮT âm thanh hệ thống");
    }
  };

  const isRecording =
    meetingState === "recording" ||
    meetingState === "starting" ||
    meetingState === "error";
  const isBusy = meetingState === "starting" || meetingState === "stopping";
  const isActivelyCapturing =
    meetingState === "recording" || meetingState === "starting";

  const handleStartClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (isBusy) return;

    if (!enableMic && !enableSystemAudio) {
      toast.error("Vui lòng bật ít nhất Micro 🎙️ hoặc Tiếng hệ thống 🔊 để bắt đầu ghi âm!");
      return;
    }

    const mode: "dual" | "mic" | "system" =
      enableMic && enableSystemAudio ? "dual" : enableMic ? "mic" : "system";
    onStartMeeting(mode);
  };

  const handleStopClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isBusy) {
      onStopMeeting();
    }
  };

  return (
    <>
    <div
      className={`
        group
        transition-all duration-200 ease-out overflow-hidden
        h-[42px] hover:scale-105
        ${isRecording ? "w-[160px]" : "w-[148px] hover:w-[154px]"}
        bg-black/80 dark:bg-black/70 rounded-[28px] backdrop-blur-md
        ring-[1px] ring-black/60 shadow-[0px_0px_15px_0px_rgba(0,0,0,0.40)]
        relative select-none
        flex items-center justify-center
      `}
    >
      {/* Idle state — Start Button + Mic Toggle + System Audio Toggle + Chevron */}
      <div
        className={`
          absolute inset-0 flex items-center justify-center gap-1 p-[5px]
          transition-opacity
          ${isRecording ? "opacity-0 duration-75 delay-0 pointer-events-none" : "opacity-100 duration-100 delay-100"}
        `}
        inert={isRecording}
        aria-hidden={isRecording}
      >
        {/* Main Start Recording Action Button */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={handleStartClick}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full cursor-pointer bg-red-500/20 text-red-400 hover:bg-red-500/35 hover:text-red-300 transition-all active:scale-95 disabled:cursor-not-allowed disabled:opacity-60 shadow-xs border border-red-500/30"
              aria-label="Start recording"
              disabled={isBusy}
            >
              <Radio className="w-[16px] h-[16px] animate-pulse" />
            </button>
          </TooltipTrigger>
          <TooltipContent>
            {enableMic && enableSystemAudio
              ? "Bắt đầu ghi âm (Micro + Hệ thống)"
              : enableMic
                ? "Bắt đầu ghi âm (Chỉ Micro)"
                : enableSystemAudio
                  ? "Bắt đầu ghi âm (Chỉ Tiếng hệ thống)"
                  : "Bật Micro hoặc Hệ thống để ghi âm"}
          </TooltipContent>
        </Tooltip>

        {/* Mic Toggle Button */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={toggleMic}
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full cursor-pointer transition-all active:scale-95 ${
                enableMic
                  ? "bg-sky-500/25 text-sky-400 hover:bg-sky-500/40 shadow-xs border border-sky-500/30"
                  : "text-white/40 hover:bg-white/15 hover:text-white/70"
              }`}
              aria-label={enableMic ? "Micro: ĐANG BẬT" : "Micro: ĐANG TẮT"}
              disabled={isBusy}
            >
              {enableMic ? (
                <Mic className="w-[16px] h-[16px]" />
              ) : (
                <MicOff className="w-[16px] h-[16px]" />
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent>
            {enableMic
              ? "🎙️ Micro ngoài: ĐANG BẬT (Nhấp để TẮT)"
              : "🔇 Micro ngoài: ĐANG TẮT (Nhấp để BẬT)"}
          </TooltipContent>
        </Tooltip>

        {/* System Audio Toggle Button */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={toggleSystemAudio}
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full cursor-pointer transition-all active:scale-95 ${
                enableSystemAudio
                  ? "bg-emerald-500/25 text-emerald-400 hover:bg-emerald-500/40 shadow-xs border border-emerald-500/30"
                  : "text-white/40 hover:bg-white/15 hover:text-white/70"
              }`}
              aria-label={
                enableSystemAudio
                  ? "Âm thanh hệ thống: ĐANG BẬT"
                  : "Âm thanh hệ thống: ĐANG TẮT"
              }
              disabled={isBusy}
            >
              {enableSystemAudio ? (
                <Volume2 className="w-[16px] h-[16px]" />
              ) : (
                <VolumeX className="w-[16px] h-[16px]" />
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent>
            {enableSystemAudio
              ? "🔊 Âm thanh hệ thống: ĐANG BẬT (Thu mọi âm thanh từ máy tính)"
              : "🔇 Âm thanh hệ thống: ĐANG TẮT (Nhấp để BẬT)"}
          </TooltipContent>
        </Tooltip>

        {onToggleTranscription && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={onToggleTranscription}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full cursor-pointer text-white/50 transition-colors hover:bg-white/15 hover:text-white/80"
                aria-label={
                  isTranscriptionOpen
                    ? "Hide transcription"
                    : "Show transcription"
                }
              >
                <ChevronUp
                  className={`w-3.5 h-3.5 transition-transform duration-200 ${
                    isTranscriptionOpen ? "rotate-180" : ""
                  }`}
                />
              </button>
            </TooltipTrigger>
            <TooltipContent>
              {isTranscriptionOpen
                ? "Thu gọn bảng phiên âm"
                : "Mở bảng phiên âm"}
            </TooltipContent>
          </Tooltip>
        )}
      </div>

      {/* Recording controls — visible when recording, hides fast when closing.
          See sibling comment above for why `inert` is required alongside the
          opacity transition. */}
      <div
        className={`
          flex h-full w-full items-center justify-center gap-3 pl-7 pr-5
          transition-opacity
          ${isRecording ? "opacity-100 duration-100 delay-75" : "opacity-0 duration-50 delay-0 pointer-events-none"}
        `}
        inert={!isRecording}
        aria-hidden={!isRecording}
      >
        <div className="flex items-center gap-1 h-full">
          {Array.from({ length: NUM_WAVEFORM_BARS }).map((_, index) => (
            <Waveform
              key={index}
              index={index}
              isRecording={isRecording}
              level={level}
              baseHeight={60}
              silentHeight={20}
            />
          ))}
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={handleStopClick}
              className="flex-shrink-0 flex items-center justify-center p-1.5 rounded-full hover:bg-white/15 transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
              aria-label="Stop recording"
              disabled={isBusy}
            >
              <Square className="w-[18px] h-[18px] text-red-500 fill-red-500" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Stop recording</TooltipContent>
        </Tooltip>
      </div>
    </div>
    {noteId !== undefined && !isActivelyCapturing && (
      <SkillSparkleButton noteId={noteId} />
    )}
    </>
  );
}
