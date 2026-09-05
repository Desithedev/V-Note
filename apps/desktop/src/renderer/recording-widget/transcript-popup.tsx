import React, {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Captions,
  ExternalLink,
  List,
  Minus,
  Pencil,
  Plus,
  X,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
} from "lucide-react";
import { motion } from "framer-motion";
import { api } from "@/trpc/react";
import {
  extractVietnameseTranscriptDelta,
  joinVietnameseTranscriptText,
  normalizeVietnameseTranscriptText,
} from "@/utils/vietnamese-itn";
import {
  getSpeakerTheme,
  type SpeakerTheme,
} from "@/renderer/shared/speaker-theme";
import type {
  MeetingTranscriptFontSize,
  MeetingTranscriptMode,
  MeetingWidgetEdge,
} from "@/types/meeting-widget";
import type { AudioSource, TranscriptEvent, TranscriptSpeaker } from "@/types/meeting";

const MAX_VISIBLE_SEGMENTS = 50;
const FONT_SIZE_ORDER: MeetingTranscriptFontSize[] = ["sm", "md", "lg"];

const FULL_TEXT_CLASS: Record<MeetingTranscriptFontSize, string> = {
  sm: "text-[12.5px] leading-relaxed",
  md: "text-sm leading-relaxed",
  lg: "text-base leading-relaxed",
};

const CAPTION_TEXT_CLASS: Record<MeetingTranscriptFontSize, string> = {
  sm: "text-base leading-snug",
  md: "text-lg leading-snug",
  lg: "text-xl leading-snug",
};

function formatTimestamp(milliseconds: number): string {
  if (
    !Number.isFinite(milliseconds) ||
    isNaN(milliseconds) ||
    milliseconds < 0
  ) {
    return "00:00";
  }
  const totalSeconds = Math.floor(milliseconds / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = Math.floor(totalSeconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function resolveTheme(segment: TranscriptEvent): SpeakerTheme {
  const speakerKey = segment.speakerId || segment.speaker || "SPEAKER_00";
  return getSpeakerTheme(speakerKey, 0, segment.speakerLabel);
}

interface TranscriptRowProps {
  segment: TranscriptEvent;
  fontSize: MeetingTranscriptFontSize;
  onRenameSpeaker?: (
    meetingId: string,
    speakerId: string,
    newLabel: string,
  ) => void;
}

const TranscriptRow = memo(function TranscriptRow({
  segment,
  fontSize,
  onRenameSpeaker,
}: TranscriptRowProps) {
  const theme = resolveTheme(segment);
  const text = useMemo(
    () => normalizeVietnameseTranscriptText(segment.text),
    [segment.text],
  );
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(theme.name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      setDraft(theme.name);
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing, theme.name]);

  const commitRename = useCallback(() => {
    setEditing(false);
    const trimmed = draft.trim();
    if (
      trimmed &&
      trimmed !== theme.name &&
      onRenameSpeaker &&
      segment.meetingId &&
      segment.speakerId
    ) {
      onRenameSpeaker(segment.meetingId, segment.speakerId, trimmed);
    }
  }, [
    draft,
    theme.name,
    onRenameSpeaker,
    segment.meetingId,
    segment.speakerId,
  ]);

  return (
    <div
      data-hit-zone="true"
      className={`group flex w-full flex-col gap-1 rounded-xl border p-2 ${theme.cardBorder} ${theme.cardBg}`}
    >
      <div className="flex items-center justify-between gap-1.5">
        {editing ? (
          <input
            ref={inputRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commitRename}
            onKeyDown={(event) => {
              if (event.key === "Enter") commitRename();
              if (event.key === "Escape") setEditing(false);
            }}
            onClick={(event) => event.stopPropagation()}
            className="min-w-0 shrink-0 rounded border border-white/20 bg-white/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-white outline-none focus:border-white/40"
          />
        ) : (
          <span
            role="button"
            tabIndex={0}
            title="Đổi tên speaker"
            onClick={(event) => {
              event.stopPropagation();
              setEditing(true);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") setEditing(true);
            }}
            className={`group/name flex shrink-0 cursor-pointer items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold transition-colors hover:brightness-110 ${theme.badgeBg}`}
          >
            {theme.name}
            <Pencil className="hidden h-2.5 w-2.5 text-zinc-400 group-hover/name:inline-block" />
          </span>
        )}
        <span className="shrink-0 font-mono text-[10px] tabular-nums text-zinc-400">
          {formatTimestamp(segment.startTimeMs)}
        </span>
      </div>
      <span
        className={`min-w-0 break-words text-zinc-100 ${FULL_TEXT_CLASS[fontSize]}`}
      >
        {text}
      </span>
    </div>
  );
});

interface PartialRowProps {
  speaker: TranscriptSpeaker;
  speakerId?: string;
  speakerLabel?: string;
  text: string;
  fontSize: MeetingTranscriptFontSize;
}

const PartialRow = memo(function PartialRow({
  speaker,
  speakerId,
  speakerLabel,
  text,
  fontSize,
}: PartialRowProps) {
  const theme = getSpeakerTheme(speakerId || speaker, 0, speakerLabel);

  return (
    <div
      data-hit-zone="true"
      className={`flex w-full flex-col gap-1 rounded-xl border p-2 ${theme.cardBorder} ${theme.cardBg}`}
    >
      <div className="flex items-center gap-1.5">
        <span
          className={`font-mono text-[10px] font-semibold ${theme.badgeText}`}
        >
          {theme.name}
        </span>
        <span
          className={`h-1.5 w-1.5 animate-pulse rounded-full ${theme.indicatorColor}`}
        />
      </div>
      <span
        className={`break-words text-zinc-100 ${FULL_TEXT_CLASS[fontSize]}`}
      >
        {text}
        <span className="ml-0.5 inline-block h-[1em] w-px animate-pulse bg-current align-[-0.15em]" />
      </span>
    </div>
  );
});

export interface TranscriptPopupProps {
  edge: MeetingWidgetEdge;
  noteId: number | null;
  mode: MeetingTranscriptMode;
  fontSize: MeetingTranscriptFontSize;
  onClose: () => void;
  onOpenNote: () => void;
  onModeChange: (mode: MeetingTranscriptMode) => void;
  onFontSizeChange: (fontSize: MeetingTranscriptFontSize) => void;
  mutedSources: Record<AudioSource, boolean>;
  onToggleSourceMute: (source: AudioSource) => void;
}

export const TranscriptPopup = memo(function TranscriptPopup({
  edge,
  noteId,
  mode,
  fontSize,
  onClose,
  onOpenNote,
  onModeChange,
  onFontSizeChange,
  mutedSources,
  onToggleSourceMute,
}: TranscriptPopupProps) {
  const [sourceFilter, setSourceFilter] = useState<"all" | AudioSource>("all");
  const [transcript, setTranscript] = useState<TranscriptEvent[]>([]);
  const [livePartial, setLivePartial] = useState<Record<string, string>>({});
  const deferredLivePartial = useDeferredValue(livePartial);
  const scrollRef = useRef<HTMLDivElement>(null);
  const followLatestRef = useRef(true);

  const validNoteId = typeof noteId === "number" && noteId > 0 ? noteId : 1;
  const dbTranscriptQuery = api.meetings.getNoteTranscript.useQuery(
    { noteId: validNoteId },
    { enabled: typeof noteId === "number" && noteId > 0 },
  );
  const utils = api.useUtils();
  const renameSpeakerMutation = api.meetings.renameSpeaker.useMutation({
    onSuccess: () => {
      void utils.meetings.getNoteTranscript.invalidate({ noteId: validNoteId });
    },
  });

  useEffect(() => {
    setTranscript([]);
    setLivePartial({});
    followLatestRef.current = true;
  }, [noteId]);

  useEffect(() => {
    if (dbTranscriptQuery.data) {
      setTranscript(dbTranscriptQuery.data.slice(-MAX_VISIBLE_SEGMENTS));
    }
  }, [dbTranscriptQuery.data]);

  api.meetings.transcriptUpdates.useSubscription(undefined, {
    onData: (event) => {
      if (noteId !== null && event.noteId !== noteId) {
        return;
      }

      setTranscript((previous) => {
        const index = previous.findIndex((item) => item.id === event.id);
        if (index >= 0) {
          if (previous[index] === event) {
            return previous;
          }
          const next = [...previous];
          next[index] = event;
          return next;
        }
        return [...previous, event].slice(-MAX_VISIBLE_SEGMENTS);
      });
      setLivePartial((previous) => {
        if (!(event.speaker in previous)) {
          return previous;
        }
        const next = { ...previous };
        delete next[event.speaker];
        return next;
      });
    },
    onError: () => {},
  });

  api.meetings.partialTranscriptUpdates.useSubscription(undefined, {
    onData: (event) => {
      if (noteId !== null && event.noteId !== noteId) {
        return;
      }

      const normalizedText = normalizeVietnameseTranscriptText(event.text);
      setLivePartial((previous) => {
        if ((previous[event.speaker] ?? "") === normalizedText) {
          return previous;
        }
        const next = { ...previous };
        if (normalizedText) {
          next[event.speaker] = normalizedText;
        } else {
          delete next[event.speaker];
        }
        return next;
      });
    },
    onError: () => {},
  });

  useEffect(() => {
    if (!followLatestRef.current) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      if (scrollRef.current && followLatestRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
    });

    return () => window.cancelAnimationFrame(frame);
  }, [transcript, deferredLivePartial, mode]);

  const groupedBlocks = useMemo(() => {
    const blocks: Array<{
      id: string;
      speaker: TranscriptEvent["speaker"];
      source: AudioSource;
      speakerId?: string;
      meetingId?: string;
      speakerLabel?: string;
      text: string;
      isLive?: boolean;
    }> = [];

    for (const segment of transcript) {
      if (sourceFilter !== "all" && segment.source !== sourceFilter) continue;
      const cleanText = normalizeVietnameseTranscriptText(segment.text);
      const last = blocks[blocks.length - 1];
      if (last && last.speaker === segment.speaker && last.source === segment.source) {
        last.text = joinVietnameseTranscriptText(last.text, cleanText);
      } else {
        blocks.push({
          id: segment.id,
          speaker: segment.speaker,
          source: segment.source,
          speakerId: segment.speakerId,
          meetingId: segment.meetingId,
          speakerLabel: segment.speakerLabel,
          text: cleanText,
        });
      }
    }

    const partialEntries = Object.entries(deferredLivePartial).filter(
      (entry): entry is [TranscriptSpeaker, string] => Boolean(entry[1]),
    );

    for (const [speaker, text] of partialEntries) {
      const cleanPartial = normalizeVietnameseTranscriptText(text);
      const last = blocks[blocks.length - 1];
      if (last && last.speaker === speaker) {
        const delta = extractVietnameseTranscriptDelta(last.text, cleanPartial);
        if (delta) {
          last.text = joinVietnameseTranscriptText(last.text, delta);
          last.isLive = true;
        }
      } else {
        blocks.push({
          id: `partial-${speaker}`,
          speaker: speaker as any,
          source: speaker === "them" ? "system" : "mic",
          text: cleanPartial,
          isLive: true,
        });
      }
    }

    return blocks;
  }, [transcript, deferredLivePartial, sourceFilter]);

  const visibleBlocks = useMemo(
    () => (mode === "caption" ? groupedBlocks.slice(-1) : groupedBlocks),
    [groupedBlocks, mode],
  );

  const hasContent = groupedBlocks.length > 0;
  const isVertical = edge === "right";
  const fontIndex = FONT_SIZE_ORDER.indexOf(fontSize);
  const canDecreaseFont = fontIndex > 0;
  const canIncreaseFont = fontIndex < FONT_SIZE_ORDER.length - 1;
  const popupStyle: React.CSSProperties = isVertical
    ? {
        position: "absolute",
        right: 46,
        top: "50%",
        width: 380,
        minWidth: 320,
        maxWidth: 440,
        maxHeight: 420,
        transform: "translateY(-50%)",
      }
    : {
        position: "absolute",
        bottom: 46,
        left: "50%",
        width: 380,
        minWidth: 320,
        maxWidth: 440,
        maxHeight: 420,
        transform: "translateX(-50%)",
      };

  const setAdjacentFontSize = (delta: -1 | 1) => {
    const next = FONT_SIZE_ORDER[fontIndex + delta];
    if (next) {
      onFontSizeChange(next);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.94 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.94 }}
      transition={{ duration: 0.16, ease: "easeOut" }}
      style={popupStyle}
      data-hit-zone="true"
      className="pointer-events-auto z-50 flex select-none flex-col overflow-hidden rounded-2xl border border-white/15 bg-zinc-950 text-white shadow-[0_10px_35px_rgba(0,0,0,0.6)] resize"
    >
      <div
        className="flex items-center justify-between border-b border-white/10 bg-white/5 px-3 py-2"
        data-hit-zone="true"
      >
        <div className="flex min-w-0 items-center gap-1.5" data-hit-zone="true">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
          </span>
          <span className="truncate text-xs font-semibold tracking-wide text-zinc-200">
            {mode === "caption" ? "Phụ đề trực tiếp" : "Phiên âm trực tiếp"}
          </span>
          {transcript.length > 0 ? (
            <span className="rounded-full bg-white/10 px-1.5 py-0.5 text-[10px] tabular-nums text-zinc-400">
              {transcript.length} đoạn
            </span>
          ) : null}
        </div>

        <div className="flex items-center gap-0.5" data-hit-zone="true">
          <button
            type="button"
            onClick={() => setAdjacentFontSize(-1)}
            disabled={!canDecreaseFont}
            title="Giảm cỡ chữ"
            aria-label="Giảm cỡ chữ"
            data-hit-zone="true"
            className="rounded-lg p-1 text-zinc-400 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-default disabled:opacity-30"
          >
            <Minus className="h-3.5 w-3.5" />
          </button>
          <span className="w-4 text-center text-[10px] font-semibold text-zinc-400">
            A
          </span>
          <button
            type="button"
            onClick={() => setAdjacentFontSize(1)}
            disabled={!canIncreaseFont}
            title="Tăng cỡ chữ"
            aria-label="Tăng cỡ chữ"
            data-hit-zone="true"
            className="rounded-lg p-1 text-zinc-400 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-default disabled:opacity-30"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onModeChange(mode === "full" ? "caption" : "full")}
            title={
              mode === "full"
                ? "Chuyển sang chế độ phụ đề"
                : "Xem toàn bộ phiên âm"
            }
            aria-label={
              mode === "full"
                ? "Chuyển sang chế độ phụ đề"
                : "Xem toàn bộ phiên âm"
            }
            data-hit-zone="true"
            className="rounded-lg p-1 text-zinc-400 transition-colors hover:bg-white/10 hover:text-white"
          >
            {mode === "full" ? (
              <Captions className="h-3.5 w-3.5" />
            ) : (
              <List className="h-3.5 w-3.5" />
            )}
          </button>
          <button
            type="button"
            onClick={onOpenNote}
            title="Mở bản phiên âm đầy đủ để sửa và phát lại audio"
            aria-label="Mở bản phiên âm đầy đủ"
            data-hit-zone="true"
            className="rounded-lg p-1 text-zinc-400 transition-colors hover:bg-white/10 hover:text-white"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onClose}
            title="Ẩn phụ đề"
            aria-label="Ẩn phụ đề"
            data-hit-zone="true"
            className="rounded-lg p-1 text-zinc-400 transition-colors hover:bg-white/10 hover:text-white"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <div className="flex items-center gap-1 border-b border-white/10 bg-black/20 px-2 py-1.5">
        {(["all", "mic", "system"] as const).map((source) => {
          const active = sourceFilter === source;
          const label = source === "all" ? "Tất cả" : source === "mic" ? "Micro" : "Hệ thống";
          return (
            <button key={source} type="button" onClick={() => setSourceFilter(source)}
              className={`rounded-md px-2 py-1 text-[10px] transition-colors ${active ? "bg-white/15 text-white" : "text-zinc-400 hover:bg-white/10 hover:text-white"}`}>
              {label}
            </button>
          );
        })}
        <div className="ml-auto flex items-center gap-1">
          <button type="button" title="Bật/tắt micro" aria-label="Bật/tắt micro" onClick={() => onToggleSourceMute("mic")}
            className={`rounded-md p-1 transition-colors ${mutedSources.mic ? "bg-red-500/20 text-red-300" : "text-sky-300 hover:bg-white/10"}`}>
            {mutedSources.mic ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
          </button>
          <button type="button" title="Bật/tắt âm thanh hệ thống" aria-label="Bật/tắt âm thanh hệ thống" onClick={() => onToggleSourceMute("system")}
            className={`rounded-md p-1 transition-colors ${mutedSources.system ? "bg-red-500/20 text-red-300" : "text-emerald-300 hover:bg-white/10"}`}>
            {mutedSources.system ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      <div
        ref={scrollRef}
        onScroll={(event) => {
          const { scrollTop, scrollHeight, clientHeight } = event.currentTarget;
          followLatestRef.current =
            scrollHeight - scrollTop - clientHeight < 32;
        }}
        data-hit-zone="true"
        className={`flex flex-col gap-2 p-2.5 scrollbar-thin scrollbar-thumb-white/20 ${
          mode === "caption"
            ? "h-[112px] overflow-hidden"
            : "h-[365px] overflow-y-auto"
        }`}
      >
        {!hasContent ? (
          <div className="py-4 text-center text-xs italic text-zinc-400">
            Đang lắng nghe giọng nói trên màn hình...
          </div>
        ) : null}

        {visibleBlocks.map((block, idx) => {
          const isUser = block.speaker === "you";
          const isLast = idx === visibleBlocks.length - 1;
          return (
            <div
              key={block.id}
              className="flex items-start gap-2.5 rounded-xl border border-white/10 bg-black/60 p-2.5 shadow-sm"
            >
              <span
                className={`inline-flex shrink-0 items-center gap-1 rounded-lg border px-2 py-0.5 text-xs font-semibold select-none mt-0.5 ${
                  isUser
                    ? "border-sky-500/30 bg-sky-950/80 text-sky-400"
                    : "border-emerald-500/30 bg-emerald-950/80 text-emerald-400"
                }`}
              >
                {block.source === "mic" ? "🎙️ Bạn · Mic" : "🔊 Hệ thống"}
              </span>
              <p
                className={`flex-1 italic font-normal text-zinc-100 break-words m-0 pt-0.5 ${FULL_TEXT_CLASS[fontSize]}`}
              >
                {block.text}
                {isLast && block.isLive && (
                  <span
                    className={`ml-1.5 inline-block h-3.5 w-1.5 animate-pulse rounded-xs align-middle ${
                      isUser ? "bg-sky-400" : "bg-emerald-400"
                    }`}
                  />
                )}
              </p>
            </div>
          );
        })}
      </div>
    </motion.div>
  );
});
