"use client";

import { useMemo, useState } from "react";
import {
  Search,
  Copy,
  Check,
  FileText,
  User,
  Users,
  Play,
  ArrowUpDown,
  Download,
  PlusCircle,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { api } from "@/trpc/react";
import { toast } from "sonner";
import { copyToClipboard } from "@/lib/clipboard";
import type { TranscriptEvent } from "@/types/meeting";
import {
  normalizeVietnameseNumbers,
  formatVietnamesePunctuation,
} from "@/utils/vietnamese-itn";
import { getSpeakerTheme } from "@/renderer/shared/speaker-theme";

interface NoteTranscriptDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  noteId: number;
  noteTitle?: string;
  initialSessionId?: string | null;
  sessionKeys?: string[];
  onPlayAtTime?: (timeSec: number, sessionId?: string) => void;
  onInsertToNote?: (text: string) => void;
}

function formatTime(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "00:00";
  const totalSeconds = Math.floor(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = Math.floor(totalSeconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

type GroupedBlock = {
  id: string;
  meetingId?: string;
  speaker: "you" | "them";
  speakerLabel: string;
  speakerColor?: string;
  startTimeMs: number;
  endTimeMs: number;
  text: string;
};

export function NoteTranscriptDialog({
  open,
  onOpenChange,
  noteId,
  noteTitle,
  initialSessionId,
  sessionKeys = [],
  onPlayAtTime,
  onInsertToNote,
}: NoteTranscriptDialogProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedSessionFilter, setSelectedSessionFilter] = useState<
    string | null
  >(initialSessionId ?? null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const transcriptQuery = api.meetings.getNoteTranscript.useQuery(
    { noteId },
    { enabled: open && !!noteId },
  );

  const rawTranscript: TranscriptEvent[] = transcriptQuery.data ?? [];

  // Group raw segments by speaker turns
  const groupedBlocks: GroupedBlock[] = useMemo(() => {
    if (!rawTranscript.length) return [];

    const sorted = [...rawTranscript].sort(
      (a, b) => (a.startTimeMs || 0) - (b.startTimeMs || 0),
    );

    const blocks: GroupedBlock[] = [];

    for (const seg of sorted) {
      const rawText = (seg.text || "").trim();
      if (!rawText) continue;

      const punctuated = formatVietnamesePunctuation(
        normalizeVietnameseNumbers(rawText),
      );

      const speakerType = seg.speaker === "you" ? "you" : "them";
      const speakerTheme = getSpeakerTheme(
        seg.speakerId || (speakerType === "you" ? "you" : "SPEAKER_00"),
        0,
        seg.speakerLabel,
      );

      const label =
        seg.speakerLabel ||
        (speakerType === "you" ? "Bạn (Micro)" : speakerTheme.name || "Đối phương / Hệ thống");

      const last = blocks[blocks.length - 1];
      const gap = seg.startTimeMs - (last?.endTimeMs ?? 0);

      // Merge if same speaker, same session, and small gap (< 15s)
      if (
        last &&
        last.speaker === speakerType &&
        last.meetingId === seg.meetingId &&
        gap < 15000
      ) {
        last.text = `${last.text} ${punctuated}`;
        last.endTimeMs = Math.max(last.endTimeMs, seg.endTimeMs || seg.startTimeMs);
      } else {
        blocks.push({
          id: seg.id || `${seg.startTimeMs}_${Math.random()}`,
          meetingId: seg.meetingId,
          speaker: speakerType,
          speakerLabel: label,
          speakerColor: speakerTheme.badgeBg,
          startTimeMs: seg.startTimeMs || 0,
          endTimeMs: seg.endTimeMs || seg.startTimeMs || 0,
          text: punctuated,
        });
      }
    }

    return blocks;
  }, [rawTranscript]);

  // Filter by session (if selected) and by search query
  const filteredBlocks = useMemo(() => {
    return groupedBlocks.filter((b) => {
      if (selectedSessionFilter && b.meetingId && b.meetingId !== selectedSessionFilter) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          b.text.toLowerCase().includes(q) ||
          b.speakerLabel.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [groupedBlocks, selectedSessionFilter, searchQuery]);

  const handleCopyAll = async () => {
    if (!filteredBlocks.length) return;
    const fullText = filteredBlocks
      .map(
        (b) =>
          `[${formatTime(b.startTimeMs)} - ${formatTime(b.endTimeMs)}] ${b.speakerLabel}:\n${b.text}`,
      )
      .join("\n\n");

    const ok = await copyToClipboard(fullText);
    if (ok) {
      toast.success("Đã sao chép toàn bộ bản phiên âm vào Clipboard!");
    } else {
      toast.error("Không thể sao chép");
    }
  };

  const handleCopyBlock = async (block: GroupedBlock) => {
    const text = `[${formatTime(block.startTimeMs)}] ${block.speakerLabel}: ${block.text}`;
    const ok = await copyToClipboard(text);
    if (ok) {
      setCopiedId(block.id);
      setTimeout(() => setCopiedId(null), 1500);
      toast.success("Đã sao chép đoạn này");
    }
  };

  const handleInsert = () => {
    if (!onInsertToNote || !filteredBlocks.length) return;
    const fullText = filteredBlocks
      .map((b) => `**${b.speakerLabel}** (${formatTime(b.startTimeMs)}):\n${b.text}`)
      .join("\n\n");
    onInsertToNote(fullText);
    toast.success("Đã chèn nội dung phiên âm vào ghi chú");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-3xl max-h-[85vh] flex flex-col p-0 gap-0"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        <DialogHeader className="p-4 pb-3 border-b shrink-0">
          <div className="flex items-center justify-between gap-3 pr-6">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary border border-primary/20">
                <FileText className="size-4.5" />
              </div>
              <div className="min-w-0">
                <DialogTitle className="text-base font-semibold truncate">
                  Bản phiên âm: {noteTitle || "Ghi chú"}
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">
                  {rawTranscript.length} đoạn âm thanh • {groupedBlocks.length} lượt nói
                </DialogDescription>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {onInsertToNote && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleInsert}
                  className="h-8 text-xs gap-1.5 cursor-pointer"
                  title="Chèn nội dung phiên âm vào tài liệu ghi chú"
                >
                  <PlusCircle className="size-3.5" />
                  <span>Chèn vào Note</span>
                </Button>
              )}
              <Button
                variant="default"
                size="sm"
                onClick={handleCopyAll}
                className="h-8 text-xs gap-1.5 cursor-pointer"
                title="Sao chép toàn bộ văn bản có mốc thời gian"
              >
                <Copy className="size-3.5" />
                <span>Sao chép tất cả</span>
              </Button>
            </div>
          </div>

          {/* Search & Filter Bar */}
          <div className="flex flex-wrap items-center gap-2 mt-3 pt-2 border-t border-border/50">
            <div className="relative flex-1 min-w-[180px]">
              <Search className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
              <Input
                placeholder="Tìm kiếm trong bản phiên âm…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-8 pl-8 text-xs bg-muted/40"
              />
            </div>

            {/* Session Filter Tabs */}
            {sessionKeys.length > 1 && (
              <div className="flex items-center gap-1 overflow-x-auto py-0.5">
                <Button
                  variant={selectedSessionFilter === null ? "secondary" : "ghost"}
                  size="sm"
                  onClick={() => setSelectedSessionFilter(null)}
                  className="h-7 px-2 text-[11px] cursor-pointer"
                >
                  Tất cả ({sessionKeys.length})
                </Button>
                {sessionKeys.map((sId, idx) => (
                  <Button
                    key={sId}
                    variant={selectedSessionFilter === sId ? "secondary" : "ghost"}
                    size="sm"
                    onClick={() => setSelectedSessionFilter(sId)}
                    className="h-7 px-2 text-[11px] cursor-pointer"
                  >
                    Đoạn #{idx + 1}
                  </Button>
                ))}
              </div>
            )}
          </div>
        </DialogHeader>

        {/* Content Body */}
        <ScrollArea className="flex-1 p-4 overflow-y-auto max-h-[58vh]">
          {transcriptQuery.isLoading ? (
            <div className="py-16 text-center text-sm text-muted-foreground">
              Đang tải bản phiên âm…
            </div>
          ) : filteredBlocks.length === 0 ? (
            <div className="py-16 text-center flex flex-col items-center gap-2 text-muted-foreground">
              <FileText className="size-8 stroke-1 text-muted-foreground/60" />
              <span className="text-sm font-medium">
                {rawTranscript.length === 0
                  ? "Chưa có nội dung phiên âm cho ghi chú này."
                  : "Không tìm thấy đoạn nào phù hợp với bộ lọc."}
              </span>
              <span className="text-xs text-muted-foreground/70">
                {rawTranscript.length === 0
                  ? "Khi bạn ghi âm, lời nói từ Micro và Âm thanh hệ thống sẽ tự động được chuyển thành văn bản tại đây."
                  : "Hãy thử từ khóa tìm kiếm khác."}
              </span>
            </div>
          ) : (
            <div className="flex flex-col gap-3.5 pb-2">
              {filteredBlocks.map((block) => {
                const isYou = block.speaker === "you";
                const isCopied = copiedId === block.id;

                return (
                  <div
                    key={block.id}
                    className={`group relative flex flex-col gap-1.5 p-3 rounded-xl border transition-colors ${
                      isYou
                        ? "bg-primary/5 border-primary/20 hover:border-primary/35"
                        : "bg-muted/30 border-border/60 hover:border-border"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Badge
                          variant={isYou ? "default" : "secondary"}
                          className="text-[10px] font-medium h-5 px-1.5 gap-1"
                        >
                          {isYou ? (
                            <User className="size-2.5" />
                          ) : (
                            <Users className="size-2.5" />
                          )}
                          <span>{block.speakerLabel}</span>
                        </Badge>

                        <button
                          type="button"
                          onClick={() =>
                            onPlayAtTime?.(
                              block.startTimeMs / 1000,
                              block.meetingId,
                            )
                          }
                          className="inline-flex items-center gap-1 font-mono text-[11px] text-muted-foreground hover:text-primary transition-colors cursor-pointer bg-accent/40 px-1.5 py-0.5 rounded"
                          title="Nhấp để nghe lại từ thời điểm này"
                        >
                          <Play className="size-2.5 fill-current" />
                          <span>
                            {formatTime(block.startTimeMs)} -{" "}
                            {formatTime(block.endTimeMs)}
                          </span>
                        </button>
                      </div>

                      <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleCopyBlock(block)}
                          className="h-6 w-6 text-muted-foreground hover:text-foreground cursor-pointer"
                          title="Sao chép câu này"
                        >
                          {isCopied ? (
                            <Check className="size-3 text-emerald-500" />
                          ) : (
                            <Copy className="size-3" />
                          )}
                        </Button>
                      </div>
                    </div>

                    <p className="text-sm leading-relaxed text-foreground font-normal whitespace-pre-wrap pl-0.5">
                      {block.text}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
