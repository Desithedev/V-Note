"use client";

import React, { useMemo } from "react";
import { format, isToday, isTomorrow, isYesterday } from "date-fns";
import { vi } from "date-fns/locale";
import {
  CalendarDays,
  Clock,
  Video,
  FileText,
  Pencil,
  Trash2,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { getMeetingIcon } from "@/utils/meeting-icons";
import { formatEventTimeRange } from "@/utils/event-time";
import type { EventFormData } from "./event-form-dialog";

interface EventListViewProps {
  events: EventFormData[];
  searchQuery: string;
  onEditEvent: (event: EventFormData) => void;
  onDeleteEvent: (event: EventFormData) => void;
  onTakeNotes: (event: EventFormData) => void;
  onOpenMeeting: (url: string | null) => void;
  onAddEvent: () => void;
}

interface DateGroup {
  dateKey: string;
  label: string;
  date: Date;
  events: EventFormData[];
}

function getDateGroupLabel(date: Date): string {
  if (isToday(date)) return "Hôm nay";
  if (isTomorrow(date)) return "Ngày mai";
  if (isYesterday(date)) return "Hôm qua";
  return format(date, "EEEE, 'ngày' dd 'tháng' MM, yyyy", { locale: vi });
}

export function EventListView({
  events,
  searchQuery,
  onEditEvent,
  onDeleteEvent,
  onTakeNotes,
  onOpenMeeting,
  onAddEvent,
}: EventListViewProps) {
  // Filter by search query
  const filteredEvents = useMemo(() => {
    if (!searchQuery.trim()) return events;
    const q = searchQuery.toLowerCase().trim();
    return events.filter((e) => {
      const matchTitle = e.title.toLowerCase().includes(q);
      const matchUrl = e.meetingUrl?.toLowerCase().includes(q);
      return matchTitle || matchUrl;
    });
  }, [events, searchQuery]);

  // Group events by date (YYYY-MM-DD)
  const dateGroups = useMemo<DateGroup[]>(() => {
    const groups = new Map<string, DateGroup>();

    for (const evt of filteredEvents) {
      const start = new Date(evt.startAt);
      const key = format(start, "yyyy-MM-dd");

      if (!groups.has(key)) {
        groups.set(key, {
          dateKey: key,
          label: getDateGroupLabel(start),
          date: start,
          events: [],
        });
      }
      groups.get(key)!.events.push(evt);
    }

    // Sort groups ascending by date
    return Array.from(groups.values()).sort(
      (a, b) => a.date.getTime() - b.date.getTime(),
    );
  }, [filteredEvents]);

  if (filteredEvents.length === 0) {
    return (
      <div className="border border-dashed rounded-xl p-8 text-center space-y-4 bg-card/50">
        <CalendarDays className="w-9 h-9 text-muted-foreground mx-auto" />
        <div className="space-y-1.5">
          <p className="text-sm font-medium text-muted-foreground">
            {searchQuery
              ? `Không tìm thấy sự kiện nào khớp với "${searchQuery}"`
              : "Chưa có sự kiện nào"}
          </p>
          <p className="text-xs text-muted-foreground">
            {searchQuery
              ? "Hãy thử tìm kiếm với từ khóa khác hoặc xóa bộ lọc."
              : "Tạo sự kiện hoặc cuộc họp đầu tiên để bắt đầu theo dõi lịch trình của bạn."}
          </p>
        </div>
        {!searchQuery && (
          <Button size="sm" onClick={onAddEvent} className="text-xs">
            + Thêm sự kiện đầu tiên
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-8">
      {dateGroups.map((group) => (
        <section key={group.dateKey} className="space-y-2">
          <div className="flex items-center gap-2 px-1">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider capitalize">
              {group.label}
            </h3>
            <span className="text-[11px] text-muted-foreground/60 font-mono">
              ({group.events.length})
            </span>
          </div>

          <div className="bg-card border rounded-xl overflow-hidden divide-y divide-border shadow-2xs">
            {group.events.map((evt) => (
              <div
                key={evt.id}
                className="group flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-3.5 transition-colors hover:bg-accent/40"
              >
                <div className="flex items-start gap-3 min-w-0">
                  <span
                    className="mt-1 h-8 w-1.5 shrink-0 rounded-full"
                    style={{ backgroundColor: evt.calendarColor }}
                  />

                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-medium leading-tight text-foreground truncate">
                        {evt.title}
                      </h4>
                      {evt.meetingUrl &&
                        getMeetingIcon(evt.meetingUrl, {
                          className: "h-3.5 w-3.5 text-muted-foreground shrink-0",
                        })}
                    </div>

                    <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                      <span className="inline-flex items-center gap-1 font-mono text-[11px]">
                        <Clock className="size-3 text-muted-foreground/80" />
                        {formatEventTimeRange(
                          new Date(evt.startAt),
                          new Date(evt.endAt),
                          evt.isAllDay,
                        )}
                      </span>

                      {evt.meetingUrl && (
                        <>
                          <span>•</span>
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 text-primary hover:underline cursor-pointer truncate max-w-[240px]"
                            onClick={() => onOpenMeeting(evt.meetingUrl ?? null)}
                          >
                            <ExternalLink className="size-3 shrink-0" />
                            <span className="truncate text-[11px]">
                              {evt.meetingUrl}
                            </span>
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1.5 shrink-0 self-end sm:self-center">
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="h-7 text-xs px-2.5 bg-indigo-500/10 text-indigo-600 hover:bg-indigo-500/20 dark:text-indigo-400 cursor-pointer"
                    onClick={() => onTakeNotes(evt)}
                    title="Tạo ghi chú cho cuộc họp này"
                  >
                    <FileText className="size-3 mr-1" />
                    Tạo Note
                  </Button>

                  {evt.meetingUrl && (
                    <Button
                      type="button"
                      size="sm"
                      className="h-7 text-xs px-2.5 bg-primary text-primary-foreground hover:bg-primary/80 cursor-pointer"
                      onClick={() => onOpenMeeting(evt.meetingUrl ?? null)}
                    >
                      <Video className="size-3 mr-1" />
                      Vào họp
                    </Button>
                  )}

                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 text-muted-foreground hover:text-foreground"
                    onClick={() => onEditEvent(evt)}
                    title="Chỉnh sửa sự kiện"
                  >
                    <Pencil className="size-3.5" />
                  </Button>

                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                    onClick={() => onDeleteEvent(evt)}
                    title="Xóa sự kiện"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
