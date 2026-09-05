import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlignLeft,
  Bot,
  ChevronDown,
  ClipboardCopy,
  FileText,
  ListFilter,
  Maximize2,
  MessageSquareQuote,
  Mic,
  Minimize2,
  MoreVertical,
  Pause,
  Pencil,
  Play,
  RotateCcw,
  RotateCw,
  Send,
  Sparkles,
  Trash2,
  User,
  Users,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { api } from "@/trpc/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useNoteEditor } from "@/renderer/main/components/note-editor-context";
import { normalizeVietnameseNumbers, formatVietnamesePunctuation } from "@/utils/vietnamese-itn";
import type { MeetingRuntimeState, TranscriptEvent } from "@/types/meeting";
import type { NoteAssetKind } from "../types";
import {
  type SpeakerTheme,
  SPEAKER_THEMES,
  getSpeakerTheme,
} from "@/renderer/shared/speaker-theme";

export type { SpeakerTheme };
export { SPEAKER_THEMES, getSpeakerTheme };

const SCROLLBAR_WHILE_SCROLLING_CLASS =
  "data-[state=hidden]:opacity-0 data-[state=visible]:opacity-100 transition-opacity duration-150";
const TRANSCRIPTION_CONTENT_SHOW_DELAY_MS = 120;

function formatTimestamp(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || isNaN(milliseconds) || milliseconds < 0) {
    return "00:00";
  }
  const totalSeconds = Math.floor(milliseconds / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = Math.floor(totalSeconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export type TranscriptSentence = {
  id: string;
  meetingId?: string;
  speaker: TranscriptEvent["speaker"];
  speakerTheme: SpeakerTheme;
  speakerId?: string;
  speakerLabel?: string;
  translation?: string;
  confidence?: number;
  startTimeMs: number;
  endTimeMs: number;
  rawStartTimeMs?: number;
  rawEndTimeMs?: number;
  text: string;
};

export type GroupedTranscriptBlock = {
  id: string;
  meetingId?: string;
  speaker: TranscriptEvent["speaker"];
  speakerTheme: SpeakerTheme;
  speakerId?: string;
  speakerLabel?: string;
  translationText?: string;
  startTimeMs: number;
  endTimeMs: number;
  rawStartTimeMs?: number;
  rawEndTimeMs?: number;
  sentences: TranscriptSentence[];
  paragraphText: string;
};

// Chuẩn hóa câu đơn theo thứ tự thời gian thực
// Chuẩn hóa câu đơn theo thứ tự thời gian thực, giữ nguyên vẹn danh tính người nói
function prepareTranscriptSentences(transcript: TranscriptEvent[]): TranscriptSentence[] {
  const sorted = [...transcript].sort((a, b) => (a.startTimeMs || 0) - (b.startTimeMs || 0));
  const list: TranscriptSentence[] = [];

  for (let i = 0; i < sorted.length; i++) {
    const seg = sorted[i];
    const raw = seg.text.trim();
    if (!raw) continue;
    const normalized = normalizeVietnameseNumbers(raw);
    const punctuated = formatVietnamesePunctuation(normalized);

    // Xác định chỉ số người nói thực tế từ backend speakerId / speakerLabel
    let speakerIdx = 0;
    if (seg.speaker === "them") {
      const spkKey = seg.speakerId || seg.speakerLabel || "";
      const numMatch = spkKey.match(/\d+/);
      if (numMatch) {
        const parsed = parseInt(numMatch[0], 10);
        speakerIdx = spkKey.startsWith("SPEAKER_") ? parsed : (parsed > 0 ? parsed - 1 : 0);
      }
    }

    const theme =
      seg.speaker === "you"
        ? getSpeakerTheme("you", 0, seg.speakerLabel)
        : getSpeakerTheme(seg.speakerId || `SPEAKER_${speakerIdx.toString().padStart(2, "0")}`, speakerIdx, seg.speakerLabel);

    const actualSpeakerId =
      seg.speakerId || (seg.speaker === "you" ? "you" : `SPEAKER_${speakerIdx.toString().padStart(2, "0")}`);
    const actualSpeakerLabel = seg.speakerLabel || theme.name;

    // One rendered sentence maps to exactly one persisted segment.  Splitting
    // a segment into artificial sub-sentences looks nicer, but makes edits and
    // selected-audio ranges ambiguous (and could overwrite neighbouring text).
    list.push({
      id: seg.id,
      meetingId: seg.meetingId,
      speaker: seg.speaker,
      speakerTheme: theme,
      speakerId: actualSpeakerId,
      speakerLabel: actualSpeakerLabel,
      translation: seg.translation,
      confidence: seg.confidence,
      startTimeMs: seg.startTimeMs,
      endTimeMs: seg.endTimeMs,
      rawStartTimeMs: seg.rawStartTimeMs ?? seg.startTimeMs,
      rawEndTimeMs: seg.rawEndTimeMs ?? seg.endTimeMs,
      text: punctuated,
    });
  }
  return list;
}

// Phục hồi dấu câu thông minh khi kết thúc ghi âm
function punctuateSentenceGroup(sentences: TranscriptSentence[]): string {
  if (!sentences.length) return "";
  const parts: string[] = [];

  for (let i = 0; i < sentences.length; i++) {
    const t = formatVietnamesePunctuation(sentences[i].text);
    if (t) {
      parts.push(t);
    }
  }

  return parts.join(" ");
}

// Gộp các câu thành từng lượt nói hoàn chỉnh của người dùng / hệ thống (dễ đọc toàn bộ dòng, không ngắt câu)
function groupCompletedTranscript(transcript: TranscriptEvent[]): GroupedTranscriptBlock[] {
  const sentences = prepareTranscriptSentences(transcript);
  const groups: GroupedTranscriptBlock[] = [];
  const MAX_SILENCE_GAP_MS = 20000; // Chỉ ngắt khi khoảng lặng giữa 2 câu > 20s

  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i];
    const last = groups[groups.length - 1];

    // Gộp toàn bộ các câu của cùng người nói vào một đoạn văn duy nhất
    if (
      last &&
      last.speaker === sentence.speaker &&
      last.speakerId === sentence.speakerId &&
      sentence.startTimeMs - last.endTimeMs < MAX_SILENCE_GAP_MS
    ) {
      last.sentences.push(sentence);
      last.endTimeMs = Math.max(last.endTimeMs, sentence.endTimeMs);
      last.rawEndTimeMs = Math.max(
        last.rawEndTimeMs ?? last.endTimeMs,
        sentence.rawEndTimeMs ?? sentence.endTimeMs,
      );
    } else {
      groups.push({
        id: sentence.id,
        meetingId: sentence.meetingId,
        speaker: sentence.speaker,
        speakerTheme: sentence.speakerTheme,
        speakerId: sentence.speakerId,
        speakerLabel: sentence.speakerLabel,
        startTimeMs: sentence.startTimeMs,
        endTimeMs: sentence.endTimeMs,
        rawStartTimeMs: sentence.rawStartTimeMs,
        rawEndTimeMs: sentence.rawEndTimeMs,
        sentences: [sentence],
        paragraphText: "",
      });
    }
  }

  for (const g of groups) {
    g.paragraphText = punctuateSentenceGroup(g.sentences);
    const trans = g.sentences.map((s) => s.translation).filter(Boolean);
    if (trans.length > 0) {
      g.translationText = trans.join(" ");
    }
  }

  return groups;
}

function formatTranscriptAsText(transcript: TranscriptEvent[]): string {
  const blocks = groupCompletedTranscript(transcript);
  return blocks
    .map(
      (b) =>
        `**${b.speakerTheme.name}** (${formatTimestamp(b.startTimeMs)} - ${formatTimestamp(b.endTimeMs)}):\n${b.paragraphText}`,
    )
    .join("\n\n");
}

function getUncommittedPartial(
  lastSentenceText: string,
  partialText: string | undefined,
): string {
  if (!partialText) return "";
  const cleanBlock = lastSentenceText.trim();
  const cleanPartial = partialText.trim();
  if (!cleanPartial) return "";

  const normBlock = cleanBlock
    .toLowerCase()
    .replace(/[.,!?;:"'“”]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const normPartial = cleanPartial
    .toLowerCase()
    .replace(/[.,!?;:"'“”]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normBlock || !normPartial) return "";

  if (normBlock === normPartial || normBlock.endsWith(normPartial)) {
    return "";
  }

  const blockWords = normBlock.split(" ");
  const partialWords = cleanPartial.split(/\s+/);
  const normPartialWords = normPartial.split(" ");

  const lastN = Math.min(3, normPartialWords.length, blockWords.length);
  const partialTail = normPartialWords.slice(normPartialWords.length - lastN).join(" ");
  const blockTail = blockWords.slice(blockWords.length - lastN).join(" ");
  if (partialTail === blockTail) {
    return "";
  }

  for (let len = Math.min(8, blockWords.length); len >= 2; len--) {
    const needle = blockWords.slice(blockWords.length - len).join(" ");
    const idx = normPartial.indexOf(needle);
    if (idx !== -1) {
      const afterMatch = normPartial.slice(idx + needle.length).trim();
      if (!afterMatch) return "";
      const matchedWordCount = normPartial
        .slice(0, idx + needle.length)
        .trim()
        .split(/\s+/).length;
      return partialWords.slice(matchedWordCount).join(" ");
    }
  }

  const blockWordSet = new Set(blockWords);
  let sharedCount = 0;
  for (const w of normPartialWords) {
    if (blockWordSet.has(w)) sharedCount++;
  }
  if (sharedCount / normPartialWords.length >= 0.6) {
    return "";
  }

  return cleanPartial;
}

interface NoteAssetsPanelProps {
  activeAsset: NoteAssetKind | null;
  isOpen: boolean;
  isExpanded: boolean;
  onClose: () => void;
  onToggleExpanded: () => void;
  transcript?: TranscriptEvent[];
  meetingState?: MeetingRuntimeState;
  noteId?: number;
}

export function NoteAssetsPanel({
  activeAsset,
  isOpen,
  isExpanded,
  onClose,
  onToggleExpanded,
  transcript: propTranscript,
  meetingState: propMeetingState,
  noteId,
}: NoteAssetsPanelProps) {
  const { t } = useTranslation();
  const noteEditor = useNoteEditor();
  const [liveTranscript, setLiveTranscript] = useState<TranscriptEvent[]>([]);
  const [livePartial, setLivePartial] = useState<{
    you?: string;
    them?: string;
  }>({});
  const [isContentVisible, setIsContentVisible] = useState(isOpen);
  const contentVisibilityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const scrollEndRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const isStuckToBottomRef = useRef(true);
  const prevTranscriptLenRef = useRef(0);
  const playStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Prevent the periodic live refresh from moving the caret while editing.
  const editingSegmentRef = useRef<string | null>(null);

  // Auto-play on Click / Selection Toggle (ON by default, user-configurable)
  const [autoPlayOnClick, setAutoPlayOnClick] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem("vnote_autoplay_on_select");
      if (stored !== null) return stored !== "false";
      return localStorage.getItem("prismical_autoplay_on_select") !== "false";
    } catch {
      return true;
    }
  });

  const toggleAutoPlay = () => {
    const next = !autoPlayOnClick;
    setAutoPlayOnClick(next);
    try {
      localStorage.setItem("vnote_autoplay_on_select", String(next));
    } catch {}
    if (next) {
      toast.success("🔊 Đã BẬT phát âm thanh khi bôi đen chữ");
    } else {
      toast.info("🔇 Đã TẮT phát khi bôi đen (Chỉ phát khi bấm nút Play ▶)");
    }
  };

  // Audio Playback Player State
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [currentAudioSrc, setCurrentAudioSrc] = useState<string | null>(null);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [currentAudioTime, setCurrentAudioTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1.0);

  const effectiveNoteId = noteId ?? noteEditor?.noteId;

  // Reset audio state when switching notes
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.pause();
    }
    setIsPlayingAudio(false);
    setCurrentAudioTime(0);
    setAudioDuration(0);
    setCurrentAudioSrc(null);
  }, [effectiveNoteId]);

  // Real-time live partial text subscription
  api.meetings.partialTranscriptUpdates.useSubscription(undefined, {
    onData: (event) => {
      if (effectiveNoteId === undefined || event.noteId === effectiveNoteId || event.noteId === null) {
        setLivePartial((prev) => ({
          ...prev,
          [event.speaker]: normalizeVietnameseNumbers(event.text),
        }));
      }
    },
    onError: () => {},
  });

  const meetingStateQuery = api.meetings.getMeetingState.useQuery(undefined, {
    refetchInterval: 1000,
  });
  const meetingState: MeetingRuntimeState =
    propMeetingState ?? meetingStateQuery.data?.state ?? "idle";

  useEffect(() => {
    if (meetingState === "idle") {
      setLivePartial({});
    }
  }, [meetingState]);

  const dbTranscriptQuery = api.meetings.getNoteTranscript.useQuery(
    { noteId: effectiveNoteId! },
    {
      enabled: effectiveNoteId !== undefined,
      refetchInterval: meetingState === "recording" ? 2000 : false,
    },
  );

  const noteAudioQuery = api.meetings.getNoteAudio.useQuery(
    { noteId: effectiveNoteId! },
    {
      enabled: effectiveNoteId !== undefined,
      refetchInterval: meetingState === "recording" ? 3000 : false,
    },
  );

  useEffect(() => {
    if (meetingState === "idle" && effectiveNoteId) {
      noteAudioQuery.refetch();
      dbTranscriptQuery.refetch();
    }
  }, [meetingState, effectiveNoteId]);

  // Sync initial / default audio source when audio data arrives
  useEffect(() => {
    if (noteAudioQuery.data?.hasAudio) {
      const defaultSrc =
        (noteAudioQuery.data as any).mixedDataUrl ||
        noteAudioQuery.data.dataUrl ||
        noteAudioQuery.data.micDataUrl ||
        noteAudioQuery.data.systemDataUrl ||
        null;
      if (defaultSrc && !currentAudioSrc) {
        setCurrentAudioSrc(defaultSrc);
      }
    }
  }, [noteAudioQuery.data, currentAudioSrc]);

  const hasAudio = Boolean(
    noteAudioQuery.data?.hasAudio &&
      ((noteAudioQuery.data as any)?.mixedDataUrl ||
        noteAudioQuery.data?.dataUrl ||
        noteAudioQuery.data?.micDataUrl ||
        noteAudioQuery.data?.systemDataUrl ||
        (noteAudioQuery.data?.sessionKeys &&
          noteAudioQuery.data.sessionKeys.length > 0)),
  );

  const updateSegmentMutation = api.meetings.updateTranscriptSegment.useMutation({
    onSuccess: () => {
      if (effectiveNoteId !== undefined) {
        dbTranscriptQuery.refetch();
      }
    },
  });

  const clearTranscriptMutation = api.meetings.clearNoteTranscript.useMutation({
    onSuccess: () => {
      setLiveTranscript([]);
      setLivePartial({});
      if (effectiveNoteId !== undefined) {
        dbTranscriptQuery.refetch();
        noteAudioQuery.refetch();
      }
      toast.success("Đã xóa toàn bộ bản phiên âm");
    },
  });

  // Chế độ hiển thị bản phiên âm: "paragraph" (đoạn văn) hoặc "sentence" (từng câu)
  const [transcriptViewMode, setTranscriptViewMode] = useState<"paragraph" | "sentence">("paragraph");

  // Chế độ Hỏi đáp thông minh với LLM
  const [showAiChat, setShowAiChat] = useState<boolean>(false);
  const [chatInput, setChatInput] = useState<string>("");
  const [chatMessages, setChatMessages] = useState<
    Array<{ role: "user" | "assistant"; content: string }>
  >([
    {
      role: "assistant",
      content:
        "Xin chào! Tôi là trợ lý AI phân tích của bạn. Bạn có thể hỏi tôi bất kỳ điều gì về nội dung cuộc họp hoặc ghi chú này (ví dụ: tóm tắt ý chính, trích xuất việc cần làm, giải thích nội dung...).",
    },
  ]);
  const chatScrollRef = useRef<HTMLDivElement>(null);

  const askAiMutation = api.notes.askAi.useMutation();

  const handleSendChatMessage = async (customPrompt?: string) => {
    const queryText = (customPrompt || chatInput).trim();
    if (!queryText || !effectiveNoteId || askAiMutation.isPending) return;

    const nextHistory = [
      ...chatMessages,
      { role: "user" as const, content: queryText },
    ];
    setChatMessages(nextHistory);
    setChatInput("");

    setTimeout(() => {
      chatScrollRef.current?.scrollIntoView({ behavior: "smooth" });
    }, 50);

    try {
      const res = await askAiMutation.mutateAsync({
        noteId: effectiveNoteId,
        question: queryText,
        history: chatMessages.slice(-6),
      });
      setChatMessages([
        ...nextHistory,
        { role: "assistant", content: res.answer },
      ]);
    } catch (err: any) {
      setChatMessages([
        ...nextHistory,
        {
          role: "assistant",
          content: `Đã xảy ra lỗi khi gửi câu hỏi: ${err?.message || "Không thể kết nối AI"}`,
        },
      ]);
    }

    setTimeout(() => {
      chatScrollRef.current?.scrollIntoView({ behavior: "smooth" });
    }, 50);
  };

  const handleClearTranscript = () => {
    if (!effectiveNoteId) return;
    clearTranscriptMutation.mutate({ noteId: effectiveNoteId });
  };

  const [editingSpeaker, setEditingSpeaker] = useState<{
    meetingId: string;
    speakerId: string;
    currentName: string;
  } | null>(null);
  const [newSpeakerName, setNewSpeakerName] = useState("");

  const renameSpeakerMutation = api.meetings.renameSpeaker.useMutation({
    onSuccess: () => {
      toast.success(`Đã đổi tên người nói thành "${newSpeakerName}"`);
      setEditingSpeaker(null);
      if (effectiveNoteId !== undefined) {
        dbTranscriptQuery.refetch();
      }
    },
    onError: (err) => {
      toast.error(`Không thể đổi tên: ${err.message}`);
    },
  });

  const handleSaveSpeakerName = () => {
    if (!editingSpeaker || !newSpeakerName.trim()) return;
    renameSpeakerMutation.mutate({
      meetingId: editingSpeaker.meetingId,
      speakerId: editingSpeaker.speakerId,
      newLabel: newSpeakerName.trim(),
    });
  };

  const handleSegmentEdit = (segmentId: string, newText: string, oldText: string) => {
    editingSegmentRef.current = null;
    const trimmed = newText.trim();
    if (!trimmed || trimmed === oldText.trim()) return;
    updateSegmentMutation.mutate({ id: segmentId, text: trimmed });
  };

  const playAudio = useCallback(
    (src: string, targetSec: number = 0) => {
      const audio = audioRef.current;
      if (!audio) return;

      if (playStopTimerRef.current) {
        clearTimeout(playStopTimerRef.current);
        playStopTimerRef.current = null;
      }

      const clampedSec = Math.max(0, targetSec);

      if (currentAudioSrc !== src || audio.src !== src) {
        setCurrentAudioSrc(src);
        audio.src = src;

        const onReady = () => {
          audio.removeEventListener("loadedmetadata", onReady);
          audio.removeEventListener("canplay", onReady);
          try {
            audio.currentTime = clampedSec;
          } catch {}
          audio
            .play()
            .then(() => setIsPlayingAudio(true))
            .catch((err) => {
              console.warn("[AudioPlayer] Play failed after metadata loaded:", err);
            });
        };

        if (audio.readyState >= 1) {
          try {
            audio.currentTime = clampedSec;
          } catch {}
          audio
            .play()
            .then(() => setIsPlayingAudio(true))
            .catch((err) => {
              console.warn("[AudioPlayer] Play failed:", err);
            });
        } else {
          audio.addEventListener("loadedmetadata", onReady, { once: true });
          audio.addEventListener("canplay", onReady, { once: true });
          audio.load();
        }
      } else {
        try {
          audio.currentTime = clampedSec;
        } catch {}
        audio
          .play()
          .then(() => setIsPlayingAudio(true))
          .catch((err) => {
            console.warn("[AudioPlayer] Play failed:", err);
          });
      }
    },
    [currentAudioSrc],
  );

  const handlePlayFromTime = (
    timeMs: number,
    speaker?: TranscriptEvent["speaker"],
    meetingId?: string,
    rawStartTimeMs?: number,
  ) => {
    const exactMs = rawStartTimeMs !== undefined ? rawStartTimeMs : timeMs;
    const targetSec = Math.max(0, exactMs / 1000);

    const audioData = noteAudioQuery.data;
    const sessions = audioData?.sessions as
      | Record<
          string,
          {
            meetingId: string;
            micDataUrl: string | null;
            systemDataUrl: string | null;
            mixedDataUrl?: string | null;
            dataUrl: string;
            durationMs?: number | null;
          }
        >
      | undefined;
    const session = meetingId && sessions ? sessions[meetingId] : null;

    let chosenSrc =
      session?.mixedDataUrl ??
      session?.dataUrl ??
      (audioData as any)?.mixedDataUrl ??
      audioData?.dataUrl ??
      session?.micDataUrl ??
      session?.systemDataUrl ??
      audioData?.micDataUrl ??
      audioData?.systemDataUrl ??
      null;

    if (!session?.mixedDataUrl && !(audioData as any)?.mixedDataUrl) {
      if (speaker === "them" && (session?.systemDataUrl || audioData?.systemDataUrl)) {
        chosenSrc = session?.systemDataUrl ?? audioData?.systemDataUrl ?? chosenSrc;
      } else if (speaker === "you" && (session?.micDataUrl || audioData?.micDataUrl)) {
        chosenSrc = session?.micDataUrl ?? audioData?.micDataUrl ?? chosenSrc;
      }
    }

    if (!chosenSrc) {
      toast.info("Đang nạp tệp âm thanh...");
      noteAudioQuery.refetch().then((res) => {
        const freshData = res.data;
        const freshSessions = freshData?.sessions as
          | Record<
              string,
              {
                meetingId: string;
                micDataUrl: string | null;
                systemDataUrl: string | null;
                mixedDataUrl?: string | null;
                dataUrl: string;
                durationMs?: number | null;
              }
            >
          | undefined;
        const freshSession =
          meetingId && freshSessions ? freshSessions[meetingId] : null;
        let freshSrc =
          freshSession?.mixedDataUrl ??
          freshSession?.dataUrl ??
          (freshData as any)?.mixedDataUrl ??
          freshData?.dataUrl ??
          freshSession?.micDataUrl ??
          freshSession?.systemDataUrl ??
          freshData?.micDataUrl ??
          freshData?.systemDataUrl ??
          null;
        if (!freshSession?.mixedDataUrl && !(freshData as any)?.mixedDataUrl) {
          if (speaker === "them" && (freshSession?.systemDataUrl || freshData?.systemDataUrl)) {
            freshSrc = freshSession?.systemDataUrl ?? freshData?.systemDataUrl ?? freshSrc;
          } else if (speaker === "you" && (freshSession?.micDataUrl || freshData?.micDataUrl)) {
            freshSrc = freshSession?.micDataUrl ?? freshData?.micDataUrl ?? freshSrc;
          }
        }
        if (freshSrc) {
          playAudio(freshSrc, targetSec);
        }
      });
      return;
    }

    playAudio(chosenSrc, targetSec);
  };

  // Play a specific time range (e.g. highlighted text region)
  const handlePlayRange = (
    startTimeMs: number,
    endTimeMs?: number,
    speaker?: TranscriptEvent["speaker"],
    meetingId?: string,
    rawStartTimeMs?: number,
    rawEndTimeMs?: number,
  ) => {
    handlePlayFromTime(startTimeMs, speaker, meetingId, rawStartTimeMs);
    const startMs = rawStartTimeMs !== undefined ? rawStartTimeMs : startTimeMs;
    const endMs = rawEndTimeMs !== undefined ? rawEndTimeMs : endTimeMs;
    if (endMs && endMs > startMs) {
      if (playStopTimerRef.current) {
        clearTimeout(playStopTimerRef.current);
      }
      const durationSec = (endMs - startMs) / 1000;
      playStopTimerRef.current = setTimeout(() => {
        if (audioRef.current) {
          audioRef.current.pause();
          setIsPlayingAudio(false);
        }
      }, (durationSec / playbackSpeed) * 1000 + 400);
    }
  };

  // Handle Text Selection / Bôi đen để phát âm thanh
  const handleTextSelection = (
    startTimeMs: number,
    endTimeMs: number,
    speaker: TranscriptEvent["speaker"],
    meetingId?: string,
    rawStartTimeMs?: number,
    rawEndTimeMs?: number,
    sentences?: TranscriptSentence[],
  ) => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return;
    const selectedText = selection.toString().trim();
    if (!selectedText || selectedText.length < 2) return;

    let targetStartTime = startTimeMs;
    let targetEndTime = endTimeMs;
    let targetRawStart = rawStartTimeMs;
    let targetRawEnd = rawEndTimeMs;

    if (sentences && sentences.length > 0) {
      for (const s of sentences) {
        if (s.text.includes(selectedText) || selectedText.includes(s.text)) {
          targetStartTime = s.startTimeMs;
          targetEndTime = s.endTimeMs;
          targetRawStart = s.rawStartTimeMs;
          targetRawEnd = s.rawEndTimeMs;
          break;
        }
      }
    }

    if (autoPlayOnClick) {
      handlePlayRange(
        targetStartTime,
        targetEndTime,
        speaker,
        meetingId,
        targetRawStart,
        targetRawEnd,
      );
      toast.success(
        `Đang phát đoạn bôi đen (${formatTimestamp(targetStartTime)} - ${formatTimestamp(targetEndTime)})`,
      );
    }
  };

  const handleTogglePlayPause = () => {
    if (!audioRef.current) return;
    const audioData = noteAudioQuery.data;
    const src =
      currentAudioSrc ||
      (audioData as any)?.mixedDataUrl ||
      audioData?.dataUrl ||
      audioData?.micDataUrl ||
      audioData?.systemDataUrl;

    if (!src) {
      toast.info("Đang nạp tệp âm thanh...");
      noteAudioQuery.refetch().then((res) => {
        const freshSrc =
          (res.data as any)?.mixedDataUrl ||
          res.data?.dataUrl ||
          res.data?.micDataUrl ||
          res.data?.systemDataUrl;
        if (freshSrc) {
          playAudio(freshSrc, currentAudioTime);
        }
      });
      return;
    }

    if (isPlayingAudio) {
      audioRef.current.pause();
      setIsPlayingAudio(false);
    } else {
      playAudio(src, currentAudioTime);
    }
  };

  const handleSeek = (seconds: number) => {
    if (!audioRef.current) return;
    try {
      audioRef.current.currentTime = seconds;
    } catch {}
    setCurrentAudioTime(seconds);
  };

  const handleCycleSpeed = () => {
    const speeds = [1.0, 1.25, 1.5, 2.0];
    const nextIdx = (speeds.indexOf(playbackSpeed) + 1) % speeds.length;
    const nextSpeed = speeds[nextIdx];
    setPlaybackSpeed(nextSpeed);
    if (audioRef.current) {
      audioRef.current.playbackRate = nextSpeed;
    }
  };

  const handleSkip = (deltaSec: number) => {
    if (!audioRef.current || !hasAudio) return;
    const safeMax = Number.isFinite(audioDuration) && audioDuration > 0 ? audioDuration : 999999;
    const newTime = Math.min(Math.max(0, audioRef.current.currentTime + deltaSec), safeMax);
    audioRef.current.currentTime = newTime;
    setCurrentAudioTime(newTime);
  };

  useEffect(() => {
    if (dbTranscriptQuery.data && editingSegmentRef.current === null) {
      setLiveTranscript(dbTranscriptQuery.data);
    }
  }, [dbTranscriptQuery.data]);

  api.meetings.transcriptUpdates.useSubscription(undefined, {
    onData: (event) => {
      if (effectiveNoteId === undefined || event.noteId === effectiveNoteId || event.noteId === null) {
        setLiveTranscript((prev) => {
          const index = prev.findIndex((item) => item.id === event.id);
          if (index >= 0) {
            const next = [...prev];
            next[index] = event;
            return next;
          }
          return [...prev, event];
        });
      }
    },
    onError: () => {},
  });

  const transcript = (propTranscript && propTranscript.length > 0) ? propTranscript : liveTranscript;
  const hasTranscript = transcript.length > 0;

  const handleCopyTranscript = async () => {
    if (!hasTranscript) return;
    const text = formatTranscriptAsText(transcript);
    await navigator.clipboard.writeText(text);
    toast.success("Đã sao chép toàn bộ bản phiên âm vào Clipboard");
  };

  const handleAddToNote = () => {
    if (!hasTranscript) return;
    const formattedText = formatTranscriptAsText(transcript);

    if (noteEditor?.editor) {
      const editor = noteEditor.editor;
      const endPos = editor.state.doc.content.size;
      editor
        .chain()
        .focus()
        .insertContentAt(endPos, `\n\n${formattedText}\n`)
        .run();
      toast.success("Đã thêm toàn bộ bản phiên âm vào ghi chú");
    } else {
      navigator.clipboard.writeText(formattedText);
      toast.success("Đã sao chép nội dung phiên âm vào Clipboard");
    }
  };

  useEffect(() => {
    if (contentVisibilityTimerRef.current) {
      clearTimeout(contentVisibilityTimerRef.current);
      contentVisibilityTimerRef.current = null;
    }
    if (isOpen) {
      contentVisibilityTimerRef.current = setTimeout(() => {
        setIsContentVisible(true);
        contentVisibilityTimerRef.current = null;
      }, TRANSCRIPTION_CONTENT_SHOW_DELAY_MS);
    } else {
      setIsContentVisible(false);
    }
    return () => {
      if (contentVisibilityTimerRef.current) {
        clearTimeout(contentVisibilityTimerRef.current);
        contentVisibilityTimerRef.current = null;
      }
    };
  }, [isOpen]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = viewport;
      isStuckToBottomRef.current = scrollHeight - scrollTop - clientHeight < 40;
    };

    viewport.addEventListener("scroll", handleScroll, { passive: true });
    return () => viewport.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    if (
      (transcript.length > prevTranscriptLenRef.current || livePartial.you || livePartial.them) &&
      isOpen &&
      isStuckToBottomRef.current
    ) {
      const timer = setTimeout(() => {
        scrollEndRef.current?.scrollIntoView({ behavior: "smooth" });
      }, 50);
      prevTranscriptLenRef.current = transcript.length;
      return () => clearTimeout(timer);
    }
    prevTranscriptLenRef.current = transcript.length;
  }, [transcript.length, livePartial, isOpen]);

  useEffect(() => {
    if (isContentVisible && (transcript.length > 0 || livePartial.you || livePartial.them)) {
      isStuckToBottomRef.current = true;
      const timer = setTimeout(() => {
        scrollEndRef.current?.scrollIntoView({ behavior: "auto" });
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isContentVisible]);

  switch (activeAsset) {
    case "transcription": {
      const isProcessing =
        meetingState === "starting" ||
        meetingState === "recording" ||
        meetingState === "stopping";

      const sentences = prepareTranscriptSentences(transcript);
      const completedBlocks = groupCompletedTranscript(transcript);

      const transcriptDurationSec =
        transcript.length > 0
          ? Math.max(...transcript.map((t) => t.endTimeMs || 0)) / 1000
          : 0;

      const safeDuration =
        Number.isFinite(audioDuration) && !isNaN(audioDuration) && audioDuration > 0
          ? audioDuration
          : transcriptDurationSec;

      return (
        <div className="flex h-full min-h-0">
          <div
            className={`flex h-full min-h-0 w-full flex-col overflow-hidden rounded-2xl bg-card/95 dark:bg-zinc-950/85 backdrop-blur-xl border border-border dark:border-white/10 shadow-2xl transition-[opacity,transform,box-shadow] duration-120 ease-out ${
              isOpen
                ? "translate-x-0 opacity-100"
                : "translate-x-2 opacity-0 shadow-none"
            }`}
          >
            {/* Header */}
            <div
              className={`flex items-center justify-between gap-2 px-3.5 py-2.5 border-b border-border/50 dark:border-white/5 transition-opacity duration-100 ${
                isContentVisible ? "opacity-100" : "opacity-0"
              }`}
            >
              <div className="flex min-w-0 items-center gap-2">
                <h2 className="min-w-0 truncate text-sm font-semibold text-foreground">
                  {showAiChat ? "Hỏi đáp AI" : t("settings.notes.note.transcription")}
                </h2>
                {isProcessing ? (
                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium bg-red-500/15 text-red-600 dark:text-red-400 border border-red-500/30 animate-pulse">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                    Đang lắng nghe...
                  </span>
                ) : hasTranscript && !showAiChat ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
                    Đã hoàn tất
                  </span>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {/* Switcher chế độ xem: Đoạn văn vs Từng câu (ở góc trên màn transcript) */}
                {!showAiChat && !isProcessing && (
                  <div className="flex items-center bg-muted/60 p-0.5 rounded-lg border border-border/40 text-[11px]">
                    <button
                      onClick={() => setTranscriptViewMode("paragraph")}
                      className={`px-2 py-0.5 rounded-md font-medium transition-colors cursor-pointer flex items-center gap-1 ${
                        transcriptViewMode === "paragraph"
                          ? "bg-background text-foreground shadow-xs font-semibold"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                      title="Hiển thị gộp theo đoạn văn đối thoại liền mạch"
                    >
                      <AlignLeft className="h-3 w-3" />
                      <span>Đoạn văn</span>
                    </button>
                    <button
                      onClick={() => setTranscriptViewMode("sentence")}
                      className={`px-2 py-0.5 rounded-md font-medium transition-colors cursor-pointer flex items-center gap-1 ${
                        transcriptViewMode === "sentence"
                          ? "bg-background text-foreground shadow-xs font-semibold"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                      title="Hiển thị chi tiết từng câu kèm mốc thời gian"
                    >
                      <ListFilter className="h-3 w-3" />
                      <span>Từng câu</span>
                    </button>
                  </div>
                )}

                {/* Nút bật/tắt chế độ Hỏi đáp AI với LLM */}
                <Button
                  variant="ghost"
                  size="sm"
                  className={`h-7 px-2.5 rounded-lg text-xs font-medium cursor-pointer transition-colors gap-1.5 border shadow-xs ${
                    showAiChat
                      ? "bg-primary/20 text-primary border-primary/40 font-semibold"
                      : "text-muted-foreground hover:text-foreground border-border/40 hover:bg-muted"
                  }`}
                  onClick={() => setShowAiChat(!showAiChat)}
                  title={showAiChat ? "Quay lại bản phiên âm" : "Hỏi đáp thông minh với LLM về cuộc họp này"}
                >
                  <Sparkles className={`h-3.5 w-3.5 ${showAiChat ? "text-primary fill-primary" : "text-amber-500"}`} />
                  <span>{showAiChat ? "Bản phiên âm" : "Hỏi đáp AI"}</span>
                </Button>

                {/* Auto-play on Click/Selection Toggle Button */}
                {!showAiChat && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className={`h-8 w-8 cursor-pointer transition-colors ${
                      autoPlayOnClick
                        ? "text-primary hover:bg-primary/15"
                        : "text-muted-foreground hover:bg-muted"
                    }`}
                    onClick={toggleAutoPlay}
                    title={
                      autoPlayOnClick
                        ? "Tự động phát âm thanh khi bôi đen chữ (Đang BẬT)"
                        : "Tự động phát âm thanh khi bôi đen chữ (Đang TẮT)"
                    }
                  >
                    {autoPlayOnClick ? (
                      <Volume2 className="h-4 w-4 text-primary" />
                    ) : (
                      <VolumeX className="h-4 w-4 text-muted-foreground" />
                    )}
                  </Button>
                )}

                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer"
                  onClick={onToggleExpanded}
                  aria-label={isExpanded ? "Shrink transcription" : "Expand transcription"}
                  title={isExpanded ? "Thu nhỏ" : "Mở rộng"}
                >
                  {isExpanded ? (
                    <Minimize2 className="h-4 w-4" />
                  ) : (
                    <Maximize2 className="h-4 w-4" />
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer"
                  onClick={onClose}
                  aria-label={t("settings.notes.note.actions.minimizeTranscription")}
                  title={t("settings.notes.note.actions.minimizeTranscription")}
                >
                  <ChevronDown className="h-4 w-4" />
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40 cursor-pointer"
                      aria-label={t("settings.notes.note.transcriptionMenu.trigger")}
                      title={t("settings.notes.note.transcriptionMenu.trigger")}
                      disabled={!hasTranscript}
                    >
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-52">
                    <DropdownMenuItem
                      className="gap-2 cursor-pointer"
                      onSelect={toggleAutoPlay}
                    >
                      {autoPlayOnClick ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                      {autoPlayOnClick ? "Tắt tự động phát khi nhấp" : "Bật tự động phát khi nhấp"}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="gap-2 cursor-pointer"
                      onSelect={handleCopyTranscript}
                    >
                      <ClipboardCopy className="h-4 w-4" />
                      {t("settings.notes.note.transcriptionMenu.copy")}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="gap-2 cursor-pointer"
                      disabled={!noteEditor}
                      onSelect={handleAddToNote}
                    >
                      <FileText className="h-4 w-4" />
                      {t("settings.notes.note.transcriptionMenu.addToNote")}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="gap-2 cursor-pointer text-red-400 focus:bg-red-500/15 focus:text-red-300"
                      onSelect={handleClearTranscript}
                    >
                      <Trash2 className="h-4 w-4 text-red-400" />
                      Xóa toàn bộ phiên âm
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            {/* Transcript Content Area */}
            <ScrollArea
              className="min-h-0 flex-1"
              type="scroll"
              scrollBarClassName={SCROLLBAR_WHILE_SCROLLING_CLASS}
              viewportRef={viewportRef}
            >
              <div
                className={`flex flex-col gap-2 px-4 pt-3.5 pb-2.5 transition-[opacity,transform] duration-120 ${
                  isContentVisible
                    ? "translate-x-0 opacity-100"
                    : "translate-x-2 opacity-0"
                }`}
              >
                {!hasTranscript ? (
                  <div className="px-2 py-8 text-center text-sm text-zinc-400/80">
                    {isProcessing
                      ? "Đang lắng nghe giọng nói... Nội dung sẽ xuất hiện từng câu tại đây."
                      : "Bấm nút Micro 🎙️ ở thanh dock để bắt đầu ghi âm và phiên âm cuộc trò chuyện."}
                  </div>
                ) : null}

                {showAiChat ? (
                  /* 0. CHẾ ĐỘ HỎI ĐÁP THÔNG MINH VỚI LLM */
                  <div className="flex flex-col h-full gap-3 py-1">
                    {/* Quick suggestion chips */}
                    <div className="flex flex-wrap gap-1.5 pb-2.5 border-b border-border/40">
                      {[
                        "✨ Tóm tắt ý chính cuộc họp",
                        "📋 Liệt kê các việc cần làm (Action Items)",
                        "💡 Các quyết định & ý kiến quan trọng",
                        "❓ Những vấn đề còn tồn đọng",
                      ].map((promptText) => (
                        <button
                          key={promptText}
                          disabled={askAiMutation.isPending}
                          onClick={() => handleSendChatMessage(promptText)}
                          className="text-[11.5px] px-2.5 py-1 rounded-full bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 transition-colors cursor-pointer text-left disabled:opacity-50 active:scale-95 shadow-2xs font-medium"
                        >
                          {promptText}
                        </button>
                      ))}
                    </div>

                    {/* Messages conversation list */}
                    <div className="flex flex-col gap-3 min-h-[160px]">
                      {chatMessages.map((msg, idx) => (
                        <div
                          key={idx}
                          className={`flex gap-2 text-[13px] leading-relaxed ${
                            msg.role === "user" ? "justify-end" : "justify-start"
                          }`}
                        >
                          {msg.role === "assistant" && (
                            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/20 text-primary mt-0.5">
                              <Bot className="h-3.5 w-3.5" />
                            </div>
                          )}
                          <div
                            className={`rounded-2xl px-3.5 py-2 max-w-[85%] select-text ${
                              msg.role === "user"
                                ? "bg-primary text-primary-foreground font-medium rounded-tr-xs shadow-xs"
                                : "bg-muted/70 dark:bg-zinc-900 border border-border/50 text-foreground rounded-tl-xs whitespace-pre-wrap shadow-xs"
                            }`}
                          >
                            {msg.content}
                          </div>
                          {msg.role === "user" && (
                            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sky-500/20 text-sky-500 mt-0.5">
                              <User className="h-3.5 w-3.5" />
                            </div>
                          )}
                        </div>
                      ))}

                      {askAiMutation.isPending && (
                        <div className="flex gap-2 items-center text-xs text-muted-foreground italic pl-1">
                          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/20 text-primary">
                            <Sparkles className="h-3.5 w-3.5 animate-spin" />
                          </div>
                          <span>AI đang phân tích nội dung cuộc họp và suy nghĩ câu trả lời...</span>
                        </div>
                      )}
                      <div ref={chatScrollRef} />
                    </div>
                  </div>
                ) : isProcessing ? (
                  /* 1. KHI ĐANG GHI ÂM: Hiển thị giao diện liền mạch không ngắt dòng với Header pill phía trên */
                  <div className="flex flex-col gap-3 w-full">
                    {(() => {
                      const liveBlocks: Array<{
                        id: string;
                        speaker: TranscriptEvent["speaker"];
                        speakerLabel?: string;
                        startTimeMs: number;
                        endTimeMs: number;
                        text: string;
                        isLive?: boolean;
                      }> = [];

                      for (const sent of sentences) {
                        const last = liveBlocks[liveBlocks.length - 1];
                        if (last && last.speaker === sent.speaker) {
                          last.text = `${last.text} ${sent.text}`.trim();
                          last.endTimeMs = Math.max(last.endTimeMs, sent.endTimeMs);
                        } else {
                          liveBlocks.push({
                            id: sent.id,
                            speaker: sent.speaker,
                            speakerLabel: sent.speakerLabel,
                            startTimeMs: sent.startTimeMs,
                            endTimeMs: sent.endTimeMs,
                            text: sent.text,
                          });
                        }
                      }

                      // Gắn phần chữ đang được nhận diện tức thì vào khối cuối cùng hoặc tạo khối mới
                      const activePartials: Array<{ speaker: "you" | "them"; text: string }> = [];
                      if (livePartial.you?.trim()) {
                        activePartials.push({ speaker: "you", text: livePartial.you.trim() });
                      }
                      if (livePartial.them?.trim()) {
                        activePartials.push({ speaker: "them", text: livePartial.them.trim() });
                      }

                      for (const partial of activePartials) {
                        const last = liveBlocks[liveBlocks.length - 1];
                        if (last && last.speaker === partial.speaker) {
                          last.text = `${last.text} ${partial.text}`.trim();
                          last.isLive = true;
                          last.endTimeMs = Math.max(last.endTimeMs, safeDuration * 1000);
                        } else {
                          liveBlocks.push({
                            id: `partial-${partial.speaker}`,
                            speaker: partial.speaker,
                            startTimeMs: liveBlocks.length > 0 ? liveBlocks[liveBlocks.length - 1].endTimeMs : 0,
                            endTimeMs: safeDuration * 1000,
                            text: partial.text,
                            isLive: true,
                          });
                        }
                      }

                      if (liveBlocks.length === 0) {
                        return (
                          <div className="flex items-center gap-3 p-4 rounded-2xl bg-zinc-950/80 border border-zinc-800/80 text-zinc-400 text-[13px] italic shadow-xs">
                            <span className="relative flex h-2.5 w-2.5 shrink-0">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                            </span>
                            <span>Đang lắng nghe âm thanh từ Micro và Hệ thống... Lời nói sẽ xuất hiện tại đây.</span>
                          </div>
                        );
                      }

                      return liveBlocks.map((block, idx) => {
                        const isUser = block.speaker === "you";
                        const isLastBlock = idx === liveBlocks.length - 1;

                        return (
                          <div key={block.id} className="flex flex-col my-1 w-full">
                            {/* Header trên cùng: Pill Người nói + Khoảng thời gian */}
                            <div className="mb-1.5 flex items-center justify-between gap-2 px-0.5">
                              <div className="flex items-center gap-2">
                                <span
                                  className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[12px] font-semibold tracking-wide border shadow-xs select-none ${
                                    isUser
                                      ? "bg-sky-950/80 text-sky-400 border-sky-500/40"
                                      : "bg-emerald-950/80 text-emerald-400 border-emerald-500/40"
                                  }`}
                                >
                                  {isUser ? (
                                    <Mic className="h-3.5 w-3.5 text-sky-400 shrink-0" />
                                  ) : (
                                    <Volume2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                                  )}
                                  <span>{isUser ? "Bạn (Mic)" : (block.speakerLabel || "Người 1")}</span>
                                </span>

                                <span className="text-[11px] tabular-nums font-mono px-2.5 py-0.5 rounded-lg bg-zinc-900/90 text-zinc-400 border border-zinc-800 select-none">
                                  {formatTimestamp(block.startTimeMs)}
                                  {block.endTimeMs > block.startTimeMs
                                    ? ` - ${formatTimestamp(block.endTimeMs)}`
                                    : ""}
                                </span>
                              </div>

                              {isLastBlock && (
                                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10.5px] font-medium bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 animate-pulse">
                                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                                  Trực tiếp
                                </span>
                              )}
                            </div>

                            {/* Card văn bản chạy liền mạch không xuống dòng */}
                            <div
                              className={`w-full rounded-2xl p-4 text-[13.5px] leading-relaxed shadow-md select-text border bg-zinc-950/90 ${
                                isUser
                                  ? "border-sky-950/80 text-zinc-200"
                                  : "border-emerald-950/80 text-zinc-200"
                              }`}
                            >
                              <p className="m-0 select-text break-words">
                                {block.text}
                                {isLastBlock && (
                                  <span
                                    className={`inline-block w-1.5 h-4 ml-1.5 align-middle rounded-xs animate-pulse ${
                                      isUser ? "bg-sky-400" : "bg-emerald-400"
                                    }`}
                                  />
                                )}
                              </p>
                            </div>
                          </div>
                        );
                      });
                    })()}
                  </div>
                ) : transcriptViewMode === "sentence" ? (
                  /* 2A. CHẾ ĐỘ HIỂN THỊ TỪNG CÂU (SENTENCE-BY-SENTENCE CARDS) */
                  <AnimatePresence initial={false}>
                    {sentences.map((sentence) => {
                      const isUser = sentence.speaker === "you";
                      const sStartMs = sentence.rawStartTimeMs ?? sentence.startTimeMs;
                      const sEndMs = sentence.rawEndTimeMs ?? sentence.endTimeMs;
                      const isCurrentlyPlaying =
                        isPlayingAudio &&
                        currentAudioTime * 1000 >= sStartMs &&
                        currentAudioTime * 1000 <= sEndMs;

                      return (
                        <motion.div
                          key={sentence.id}
                          initial={{ opacity: 0, y: 3 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="flex flex-col my-1 w-full"
                        >
                          <div className="mb-1 flex items-center justify-between gap-2 px-1">
                            <div className="flex items-center gap-2">
                              <span
                                className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11.5px] font-semibold tracking-wide border shadow-xs ${sentence.speakerTheme.badgeBg}`}
                              >
                                {isUser ? (
                                  <Mic className="h-3 w-3 text-sky-500 dark:text-sky-400 shrink-0" />
                                ) : (
                                  <Volume2 className="h-3 w-3 text-emerald-500 dark:text-emerald-400 shrink-0" />
                                )}
                                <span>{sentence.speakerTheme.name}</span>
                              </span>
                              <span className="text-[11px] tabular-nums font-mono px-2 py-0.5 rounded-md bg-muted/80 text-muted-foreground border border-border/40 select-none">
                                {formatTimestamp(sentence.startTimeMs)}
                                {sentence.endTimeMs > sentence.startTimeMs
                                  ? ` - ${formatTimestamp(sentence.endTimeMs)}`
                                  : ""}
                              </span>
                            </div>

                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 shrink-0 rounded-full text-muted-foreground hover:text-foreground hover:bg-background/60 cursor-pointer"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (isCurrentlyPlaying) {
                                  audioRef.current?.pause();
                                  setIsPlayingAudio(false);
                                } else {
                                  handlePlayFromTime(
                                    sentence.startTimeMs,
                                    sentence.speaker,
                                    sentence.meetingId,
                                    sentence.rawStartTimeMs,
                                  );
                                }
                              }}
                              title={isCurrentlyPlaying ? "Tạm dừng" : "Phát câu này"}
                            >
                              {isCurrentlyPlaying ? (
                                <Pause className="h-3.5 w-3.5 text-primary fill-current" />
                              ) : (
                                <Play className="h-3 w-3 opacity-70 hover:opacity-100 fill-current" />
                              )}
                            </Button>
                          </div>

                          <div
                            onMouseUp={() =>
                              handleTextSelection(
                                sentence.startTimeMs,
                                sentence.endTimeMs,
                                sentence.speaker,
                                sentence.meetingId,
                                sentence.rawStartTimeMs,
                                sentence.rawEndTimeMs,
                                [sentence],
                              )
                            }
                            className={`group/sent relative w-full rounded-xl p-2.5 text-[13.5px] leading-relaxed shadow-xs transition-all select-text border ${
                              isCurrentlyPlaying
                                ? sentence.speakerTheme.cardActiveRing
                                : `${sentence.speakerTheme.cardBg} ${sentence.speakerTheme.cardBorder} ${sentence.speakerTheme.cardHoverBorder} text-foreground`
                            }`}
                          >
                            <span
                              contentEditable
                              suppressContentEditableWarning
                              spellCheck={false}
                              onClick={(e) => e.stopPropagation()}
                              onFocus={() => {
                                editingSegmentRef.current = sentence.id;
                              }}
                              onBlur={(e) =>
                                handleSegmentEdit(
                                  sentence.id,
                                  e.currentTarget.innerText ?? "",
                                  sentence.text,
                                )
                              }
                              onKeyDown={(e) => {
                                if (e.key === "Enter" && !e.shiftKey) {
                                  e.preventDefault();
                                  e.currentTarget.blur();
                                }
                              }}
                              className="focus:bg-background/90 focus:ring-1 focus:ring-primary/40 rounded px-0.5 cursor-text inline outline-none"
                              title="Nhấp để sửa. Bôi đen chữ để phát lại đoạn âm thanh tương ứng."
                            >
                              {sentence.text}
                            </span>
                          </div>
                        </motion.div>
                      );
                    })}
                  </AnimatePresence>
                ) : (
                  /* 2B. CHẾ ĐỘ HIỂN THỊ ĐOẠN VĂN GỘP (PARAGRAPH VIEW - COMPLETED BLOCKS THEO ẢNH MẪU) */
                  <AnimatePresence initial={false}>
                    {completedBlocks.map((block) => {
                      const isUser = block.speaker === "you";
                      const bStartMs = block.rawStartTimeMs ?? block.startTimeMs;
                      const bEndMs = block.rawEndTimeMs ?? block.endTimeMs;
                      const isCurrentlyPlaying =
                        isPlayingAudio &&
                        currentAudioTime * 1000 >= bStartMs &&
                        currentAudioTime * 1000 <= bEndMs;

                      return (
                        <motion.div
                          key={block.id}
                          initial={{ opacity: 0, y: 4 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="flex flex-col my-2 w-full"
                        >
                          {/* Header trên cùng: Pill Người nói + Khoảng thời gian + Nút Play ▶ */}
                          <div className="mb-1.5 flex items-center justify-between gap-2 px-0.5">
                            <div className="flex items-center gap-2 min-w-0">
                              <div
                                className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[12px] font-semibold tracking-wide border shadow-xs ${
                                  isUser
                                    ? "bg-sky-950/80 text-sky-400 border-sky-500/35"
                                    : "bg-emerald-950/80 text-emerald-400 border-emerald-500/35"
                                }`}
                              >
                                {isUser ? (
                                  <Mic className="h-3.5 w-3.5 text-sky-400 shrink-0" />
                                ) : (
                                  <Volume2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                                )}
                                <span>{block.speakerTheme.name}</span>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setEditingSpeaker({
                                      meetingId:
                                        block.meetingId ||
                                        (dbTranscriptQuery.data as any)?.meetingId ||
                                        "",
                                      speakerId:
                                        block.speakerId ||
                                        (block.speaker === "you" ? "you" : "SPEAKER_00"),
                                      currentName: block.speakerTheme.name,
                                    });
                                    setNewSpeakerName(block.speakerTheme.name);
                                  }}
                                  className="ml-0.5 opacity-60 hover:opacity-100 hover:text-primary transition-opacity cursor-pointer p-0.5 rounded"
                                  title="Đổi tên người nói"
                                >
                                  <Pencil className="h-3 w-3" />
                                </button>
                              </div>

                              <span className="text-[11px] tabular-nums font-mono px-2.5 py-0.5 rounded-lg bg-zinc-900/90 text-zinc-400 border border-zinc-800 select-none">
                                {formatTimestamp(block.startTimeMs)}
                                {block.endTimeMs > block.startTimeMs
                                  ? ` - ${formatTimestamp(block.endTimeMs)}`
                                  : ""}
                              </span>
                            </div>

                            {/* Play turn button */}
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 shrink-0 rounded-full text-zinc-400 hover:text-zinc-100 hover:bg-white/10 cursor-pointer transition-colors"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (isCurrentlyPlaying) {
                                  audioRef.current?.pause();
                                  setIsPlayingAudio(false);
                                } else {
                                  handlePlayFromTime(
                                    block.startTimeMs,
                                    block.speaker,
                                    block.meetingId,
                                    block.rawStartTimeMs,
                                  );
                                }
                              }}
                              title={isCurrentlyPlaying ? "Tạm dừng" : "Phát đoạn này"}
                            >
                              {isCurrentlyPlaying ? (
                                <Pause className="h-4 w-4 text-emerald-400 fill-current" />
                              ) : (
                                <Play className="h-3.5 w-3.5 opacity-70 hover:opacity-100 fill-current" />
                              )}
                            </Button>
                          </div>

                          {/* Card văn bản chạy liền mạch toàn chiều ngang theo mẫu ảnh */}
                          <div
                            onMouseUp={() =>
                              handleTextSelection(
                                block.startTimeMs,
                                block.endTimeMs,
                                block.speaker,
                                block.meetingId,
                                block.rawStartTimeMs,
                                block.rawEndTimeMs,
                                block.sentences,
                              )
                            }
                            className={`group/block relative w-full rounded-2xl p-4 text-[13.5px] leading-relaxed shadow-md transition-all select-text border bg-zinc-950/90 ${
                              isCurrentlyPlaying
                                ? isUser
                                  ? "border-sky-500 ring-2 ring-sky-500/30 text-zinc-100"
                                  : "border-emerald-500 ring-2 ring-emerald-500/30 text-zinc-100"
                                : isUser
                                  ? "border-sky-950/80 hover:border-sky-800/80 text-zinc-200"
                                  : "border-emerald-950/80 hover:border-emerald-800/80 text-zinc-200"
                            }`}
                          >
                            <div className="flex flex-col gap-1">
                              <div className="min-w-0 outline-none select-text break-words">
                                {block.sentences.map((sentence) => (
                                  <span
                                    key={sentence.id}
                                    contentEditable
                                    suppressContentEditableWarning
                                    spellCheck={false}
                                    onClick={(e) => e.stopPropagation()}
                                    onFocus={() => {
                                      editingSegmentRef.current = sentence.id;
                                    }}
                                    onBlur={(e) =>
                                      handleSegmentEdit(
                                        sentence.id,
                                        e.currentTarget.innerText ?? "",
                                        sentence.text,
                                      )
                                    }
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter" && !e.shiftKey) {
                                        e.preventDefault();
                                        e.currentTarget.blur();
                                      }
                                    }}
                                    className="focus:bg-zinc-800/80 focus:ring-1 focus:ring-emerald-400/40 rounded px-0.5 cursor-text mr-1 inline"
                                    title="Nhấp để sửa. Bôi đen chữ để phát lại đoạn âm thanh tương ứng."
                                  >
                                    {sentence.text}
                                  </span>
                                ))}
                              </div>

                              {block.translationText && (
                                <div className="mt-2 text-[12.5px] text-zinc-400 font-normal italic border-t border-zinc-800/60 pt-1.5">
                                  {block.translationText}
                                </div>
                              )}
                            </div>

                            <div className="pointer-events-none absolute top-3 right-3 opacity-0 group-hover/block:opacity-30 transition-opacity">
                              <Pencil className="h-3.5 w-3.5 text-zinc-400" />
                            </div>
                          </div>
                        </motion.div>
                      );
                    })}
                  </AnimatePresence>
                )}
                <div ref={scrollEndRef} />
              </div>
            </ScrollArea>

            {/* Audio Playback Player Bar / AI Q&A Input Bar Docked at Bottom */}
            {showAiChat ? (
              <div className="shrink-0 px-3.5 py-2.5 bg-card/95 dark:bg-zinc-900/95 backdrop-blur-md border-t border-border/50 dark:border-white/5 flex items-center gap-2 shadow-lg">
                <Input
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSendChatMessage();
                    }
                  }}
                  placeholder="Hỏi AI về cuộc họp này... (Enter để gửi)"
                  className="flex-1 text-[13px] rounded-xl h-9 bg-background/80"
                  disabled={askAiMutation.isPending}
                />
                <Button
                  size="sm"
                  className="h-9 px-3.5 rounded-xl gap-1.5 cursor-pointer"
                  disabled={!chatInput.trim() || askAiMutation.isPending}
                  onClick={() => handleSendChatMessage()}
                >
                  <Send className="h-3.5 w-3.5" />
                  <span>Gửi</span>
                </Button>
              </div>
            ) : (hasAudio || transcript.length > 0) && (
              <div className="shrink-0 px-4 py-2.5 bg-card/95 dark:bg-zinc-900/95 backdrop-blur-md border-t border-border/50 dark:border-white/5 flex flex-col gap-1.5 shadow-lg">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-1.5">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 rounded-full bg-primary/15 hover:bg-primary/25 text-primary cursor-pointer transition-colors"
                      onClick={handleTogglePlayPause}
                      title={isPlayingAudio ? "Tạm dừng" : "Phát lại"}
                    >
                      {isPlayingAudio ? (
                        <Pause className="h-4 w-4 fill-current" />
                      ) : (
                        <Play className="h-4 w-4 fill-current ml-0.5" />
                      )}
                    </Button>

                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-foreground cursor-pointer"
                      onClick={() => handleSkip(-5)}
                      title="Lùi lại 5 giây"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                    </Button>

                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-foreground cursor-pointer"
                      onClick={() => handleSkip(5)}
                      title="Tua tới 5 giây"
                    >
                      <RotateCw className="h-3.5 w-3.5" />
                    </Button>

                    <div className="text-[11.5px] font-mono tabular-nums text-muted-foreground ml-1.5">
                      <span className="font-semibold text-foreground">
                        {formatTimestamp(currentAudioTime * 1000)}
                      </span>
                      {" / "}
                      <span>{formatTimestamp(safeDuration * 1000)}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="icon"
                      className={`h-7 w-7 cursor-pointer transition-colors ${
                        autoPlayOnClick
                          ? "text-primary hover:bg-primary/15"
                          : "text-muted-foreground hover:bg-muted"
                      }`}
                      onClick={toggleAutoPlay}
                      title={
                        autoPlayOnClick
                          ? "Tự động phát khi bôi đen / nhấp chữ (Đang BẬT)"
                          : "Tự động phát khi bôi đen / nhấp chữ (Đang TẮT)"
                      }
                    >
                      {autoPlayOnClick ? (
                        <Volume2 className="h-3.5 w-3.5 text-primary" />
                      ) : (
                        <VolumeX className="h-3.5 w-3.5 text-muted-foreground" />
                      )}
                    </Button>

                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 px-2 text-[11px] font-mono text-muted-foreground hover:text-foreground border-border/50 cursor-pointer"
                      onClick={handleCycleSpeed}
                      title="Tốc độ phát lại"
                    >
                      {playbackSpeed}x
                    </Button>
                  </div>
                </div>

                {/* Progress Scrubber Slider */}
                <div className="relative w-full flex items-center h-2 group/slider">
                  <input
                    type="range"
                    min={0}
                    max={safeDuration || 100}
                    step={0.1}
                    value={currentAudioTime}
                    onChange={(e) => handleSeek(parseFloat(e.target.value))}
                    className="w-full h-1.5 bg-muted rounded-lg appearance-none cursor-pointer accent-primary focus:outline-none"
                  />
                </div>
              </div>
            )}

            {/* Native HTML5 Audio Controller (Always mounted) */}
            <audio
              ref={audioRef}
              src={
                currentAudioSrc ||
                (noteAudioQuery.data as any)?.mixedDataUrl ||
                noteAudioQuery.data?.dataUrl ||
                noteAudioQuery.data?.micDataUrl ||
                noteAudioQuery.data?.systemDataUrl ||
                undefined
              }
              preload="auto"
              onTimeUpdate={() => {
                if (audioRef.current) {
                  setCurrentAudioTime(audioRef.current.currentTime);
                }
              }}
              onLoadedMetadata={() => {
                if (audioRef.current) {
                  const d = audioRef.current.duration;
                  if (Number.isFinite(d) && !isNaN(d)) {
                    setAudioDuration(d);
                  }
                }
              }}
              onDurationChange={() => {
                if (audioRef.current) {
                  const d = audioRef.current.duration;
                  if (Number.isFinite(d) && !isNaN(d)) {
                    setAudioDuration(d);
                  }
                }
              }}
              onEnded={() => setIsPlayingAudio(false)}
              onPause={() => setIsPlayingAudio(false)}
              onPlay={() => setIsPlayingAudio(true)}
            />

            {/* Rename Speaker Modal */}
            {editingSpeaker && (
              <div
                className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4"
                onClick={() => setEditingSpeaker(null)}
              >
                <motion.div
                  initial={{ scale: 0.95, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className="w-full max-w-sm rounded-2xl bg-card p-5 border shadow-xl flex flex-col gap-4"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-[15px] flex items-center gap-2">
                      <Users className="h-4 w-4 text-primary" />
                      <span>Đổi tên người nói</span>
                    </h3>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 rounded-full"
                      onClick={() => setEditingSpeaker(null)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label className="text-[12px] text-muted-foreground">Tên người nói mới:</label>
                    <Input
                      autoFocus
                      value={newSpeakerName}
                      onChange={(e) => setNewSpeakerName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          handleSaveSpeakerName();
                        } else if (e.key === "Escape") {
                          setEditingSpeaker(null);
                        }
                      }}
                      placeholder="Ví dụ: Thầy Minh, Anh Hùng, Khách hàng..."
                      className="rounded-xl text-[13.5px]"
                    />
                  </div>

                  <div className="flex items-center justify-end gap-2 mt-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="rounded-xl"
                      onClick={() => setEditingSpeaker(null)}
                    >
                      Hủy
                    </Button>
                    <Button
                      size="sm"
                      className="rounded-xl bg-primary text-primary-foreground font-medium"
                      disabled={!newSpeakerName.trim() || renameSpeakerMutation.isPending}
                      onClick={handleSaveSpeakerName}
                    >
                      {renameSpeakerMutation.isPending ? "Đang lưu..." : "Lưu thay đổi"}
                    </Button>
                  </div>
                </motion.div>
              </div>
            )}
          </div>
        </div>
      );
    }
    default:
      return null;
  }
}
