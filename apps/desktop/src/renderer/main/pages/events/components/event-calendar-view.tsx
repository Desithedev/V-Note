"use client";

import React, { useState, useMemo } from "react";
import {
  format,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameMonth,
  isSameDay,
  isToday,
  addMonths,
  subMonths,
} from "date-fns";
import { vi } from "date-fns/locale";
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Video,
  Clock,
  Pencil,
  Trash2,
  FileText,
  CalendarDays,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { getMeetingIcon } from "@/utils/meeting-icons";
import { formatEventTimeRange } from "@/utils/event-time";
import type { EventFormData } from "./event-form-dialog";

interface EventCalendarViewProps {
  events: EventFormData[];
  onAddEvent: (date?: Date) => void;
  onEditEvent: (event: EventFormData) => void;
  onDeleteEvent: (event: EventFormData) => void;
  onTakeNotes: (event: EventFormData) => void;
  onOpenMeeting: (url: string | null) => void;
}

const WEEKDAYS = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];

export function EventCalendarView({
  events,
  onAddEvent,
  onEditEvent,
  onDeleteEvent,
  onTakeNotes,
  onOpenMeeting,
}: EventCalendarViewProps) {
  const [currentMonth, setCurrentMonth] = useState<Date>(new Date());
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(monthStart);
  const startDate = startOfWeek(monthStart, { weekStartsOn: 1 });
  const endDate = endOfWeek(monthEnd, { weekStartsOn: 1 });

  const calendarDays = useMemo(() => {
    return eachDayOfInterval({ start: startDate, end: endDate });
  }, [startDate, endDate]);

  // Index events by YYYY-MM-DD
  const eventsByDay = useMemo(() => {
    const map = new Map<string, EventFormData[]>();

    for (const evt of events) {
      const start = new Date(evt.startAt);
      const end = new Date(evt.endAt);

      // Simple start day mapping
      const key = format(start, "yyyy-MM-dd");
      if (!map.has(key)) {
        map.set(key, []);
      }
      map.get(key)!.push(evt);

      // If multi-day, also map to other days
      if (!isSameDay(start, end)) {
        const intervalDays = eachDayOfInterval({ start, end });
        for (let i = 1; i < intervalDays.length; i++) {
          const multiKey = format(intervalDays[i], "yyyy-MM-dd");
          if (!map.has(multiKey)) {
            map.set(multiKey, []);
          }
          if (!map.get(multiKey)!.some((e) => e.id === evt.id)) {
            map.get(multiKey)!.push(evt);
          }
        }
      }
    }

    return map;
  }, [events]);

  const selectedDateKey = format(selectedDate, "yyyy-MM-dd");
  const selectedDayEvents = eventsByDay.get(selectedDateKey) ?? [];

  const handlePrevMonth = () => setCurrentMonth((prev) => subMonths(prev, 1));
  const handleNextMonth = () => setCurrentMonth((prev) => addMonths(prev, 1));
  const handleToday = () => {
    const today = new Date();
    setCurrentMonth(today);
    setSelectedDate(today);
  };

  return (
    <div className="space-y-6">
      {/* Calendar Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-card border rounded-xl p-3 shadow-2xs">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={handlePrevMonth}
            title="Tháng trước"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={handleNextMonth}
            title="Tháng sau"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <h2 className="text-base font-semibold capitalize min-w-[160px]">
            {format(currentMonth, "MMMM, yyyy", { locale: vi })}
          </h2>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs font-medium"
            onClick={handleToday}
          >
            Hôm nay
          </Button>
          <Button
            size="sm"
            className="h-8 text-xs font-medium gap-1.5"
            onClick={() => onAddEvent(selectedDate)}
          >
            <Plus className="h-3.5 w-3.5" />
            Thêm sự kiện
          </Button>
        </div>
      </div>

      {/* Month Calendar Grid */}
      <div className="bg-card border rounded-xl overflow-hidden shadow-2xs">
        {/* Day headers */}
        <div className="grid grid-cols-7 border-b bg-muted/40 text-center text-xs font-semibold text-muted-foreground py-2.5">
          {WEEKDAYS.map((day) => (
            <div key={day}>{day}</div>
          ))}
        </div>

        {/* Days grid */}
        <div className="grid grid-cols-7 divide-x divide-y divide-border">
          {calendarDays.map((day) => {
            const dayKey = format(day, "yyyy-MM-dd");
            const dayEvents = eventsByDay.get(dayKey) ?? [];
            const isCurrentMonthDay = isSameMonth(day, currentMonth);
            const isSelected = isSameDay(day, selectedDate);
            const isCurrentToday = isToday(day);

            return (
              <div
                key={dayKey}
                onClick={() => setSelectedDate(day)}
                className={`group relative min-h-[90px] p-1.5 transition-colors cursor-pointer flex flex-col justify-between ${
                  !isCurrentMonthDay
                    ? "bg-muted/15 text-muted-foreground/60"
                    : "hover:bg-accent/40"
                } ${isSelected ? "ring-2 ring-inset ring-primary bg-accent/30" : ""}`}
              >
                {/* Day number & Quick add */}
                <div className="flex items-center justify-between mb-1">
                  <span
                    className={`inline-flex items-center justify-center text-xs font-medium size-6 rounded-full ${
                      isCurrentToday
                        ? "bg-primary text-primary-foreground font-bold"
                        : isSelected
                          ? "text-primary font-bold"
                          : ""
                    }`}
                  >
                    {format(day, "d")}
                  </span>

                  <button
                    type="button"
                    title={`Thêm sự kiện ngày ${format(day, "dd/MM")}`}
                    className="opacity-0 group-hover:opacity-100 hover:bg-accent text-muted-foreground hover:text-foreground rounded-sm p-0.5 transition-opacity"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedDate(day);
                      onAddEvent(day);
                    }}
                  >
                    <Plus className="size-3.5" />
                  </button>
                </div>

                {/* Event pills */}
                <div className="space-y-1 overflow-hidden flex-1">
                  {dayEvents.slice(0, 2).map((evt) => (
                    <div
                      key={evt.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedDate(day);
                      }}
                      className="text-[11px] leading-tight px-1.5 py-0.5 rounded truncate font-medium flex items-center gap-1 shadow-2xs transition-transform hover:scale-[1.02]"
                      style={{
                        backgroundColor: `${evt.calendarColor}25`,
                        color: evt.calendarColor,
                        borderLeft: `3px solid ${evt.calendarColor}`,
                      }}
                      title={`${evt.title} (${evt.isAllDay ? "Cả ngày" : format(new Date(evt.startAt), "HH:mm")})`}
                    >
                      {!evt.isAllDay && (
                        <span className="font-mono text-[9px] opacity-80 shrink-0">
                          {format(new Date(evt.startAt), "HH:mm")}
                        </span>
                      )}
                      <span className="truncate">{evt.title}</span>
                    </div>
                  ))}

                  {dayEvents.length > 2 && (
                    <div className="text-[10px] font-medium text-muted-foreground px-1">
                      +{dayEvents.length - 2} sự kiện nữa
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Selected Day Details Panel */}
      <div className="bg-card border rounded-xl p-4 shadow-2xs space-y-4">
        <div className="flex items-center justify-between border-b pb-3">
          <div className="flex items-center gap-2">
            <CalendarDays className="size-4 text-primary" />
            <h3 className="text-sm font-semibold capitalize">
              {format(selectedDate, "EEEE, 'ngày' dd 'tháng' MM, yyyy", {
                locale: vi,
              })}
            </h3>
            {isToday(selectedDate) && (
              <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded-full bg-primary/15 text-primary">
                Hôm nay
              </span>
            )}
          </div>

          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs gap-1"
            onClick={() => onAddEvent(selectedDate)}
          >
            <Plus className="size-3" />
            Thêm sự kiện
          </Button>
        </div>

        {selectedDayEvents.length === 0 ? (
          <div className="text-center py-6 text-muted-foreground text-xs space-y-1">
            <p>Không có sự kiện nào trong ngày này.</p>
            <p className="text-[11px] opacity-70">
              Nhấp vào nút "Thêm sự kiện" ở trên để lên lịch cuộc họp hoặc sự kiện mới.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {selectedDayEvents.map((evt) => (
              <div
                key={evt.id}
                className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 group hover:bg-muted/20 px-2 rounded-lg transition-colors"
              >
                <div className="flex items-start gap-3 min-w-0">
                  <span
                    className="mt-1 h-7 w-1 shrink-0 rounded-full"
                    style={{ backgroundColor: evt.calendarColor }}
                  />
                  <div className="min-w-0 space-y-1">
                    <h4 className="text-sm font-medium leading-tight text-foreground truncate">
                      {evt.title}
                    </h4>
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
                        <div className="flex items-center gap-1">
                          <span>•</span>
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 text-primary hover:underline cursor-pointer"
                            onClick={() => onOpenMeeting(evt.meetingUrl ?? null)}
                          >
                            {getMeetingIcon(evt.meetingUrl, {
                              className: "size-3 shrink-0",
                            })}
                            <span className="text-[11px]">Tham gia họp</span>
                          </button>
                        </div>
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
                    className="h-7 text-xs px-2.5 gap-1"
                    onClick={() => onTakeNotes(evt)}
                    title="Tạo ghi chú nhanh cho sự kiện này"
                  >
                    <FileText className="size-3.5" />
                    Tạo ghi chú
                  </Button>

                  {evt.meetingUrl && (
                    <Button
                      type="button"
                      size="sm"
                      className="h-7 text-xs px-2.5 gap-1"
                      onClick={() => onOpenMeeting(evt.meetingUrl ?? null)}
                    >
                      <Video className="size-3.5" />
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
        )}
      </div>
    </div>
  );
}
