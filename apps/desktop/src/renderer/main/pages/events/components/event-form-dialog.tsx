"use client";

import React, { useEffect, useState } from "react";
import { format } from "date-fns";
import {
  Calendar as CalendarIcon,
  Clock,
  Link as LinkIcon,
  Video,
  Palette,
  Loader2,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { api } from "@/trpc/react";
import { toast } from "sonner";
import { getMeetingIcon } from "@/utils/meeting-icons";

export interface EventFormData {
  id?: string;
  title: string;
  startAt: Date;
  endAt: Date;
  isAllDay: boolean;
  meetingUrl?: string | null;
  calendarEventUrl?: string | null;
  calendarColor: string;
}

export type EventFormMode =
  | { kind: "create"; initialDate?: Date }
  | { kind: "edit"; event: EventFormData };

interface EventFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: EventFormMode | null;
}

const COLOR_PRESETS = [
  { label: "Lam", color: "#3b82f6" },
  { label: "Lục bảo", color: "#10b981" },
  { label: "Tím", color: "#8b5cf6" },
  { label: "Hổ phách", color: "#f59e0b" },
  { label: "Hoa hồng", color: "#f43f5e" },
  { label: "Da trời", color: "#0ea5e9" },
  { label: "Chàm", color: "#6366f1" },
  { label: "Cam", color: "#f97316" },
];

export function EventFormDialog({
  open,
  onOpenChange,
  mode,
}: EventFormDialogProps) {
  const utils = api.useUtils();

  const [title, setTitle] = useState("");
  const [isAllDay, setIsAllDay] = useState(false);
  const [startDateStr, setStartDateStr] = useState("");
  const [startTimeStr, setStartTimeStr] = useState("09:00");
  const [endDateStr, setEndDateStr] = useState("");
  const [endTimeStr, setEndTimeStr] = useState("10:00");
  const [meetingUrl, setMeetingUrl] = useState("");
  const [calendarEventUrl, setCalendarEventUrl] = useState("");
  const [calendarColor, setCalendarColor] = useState("#3b82f6");

  const titleInputRef = React.useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      const timer = setTimeout(() => {
        titleInputRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [open]);

  const createMutation = api.events.create.useMutation({
    onSuccess: () => {
      toast.success("Đã tạo sự kiện mới thành công");
      utils.events.getAll.invalidate();
      utils.events.getUpcoming.invalidate();
      onOpenChange(false);
    },
    onError: (err) => {
      toast.error(`Lỗi tạo sự kiện: ${err.message}`);
    },
  });

  const updateMutation = api.events.update.useMutation({
    onSuccess: () => {
      toast.success("Đã cập nhật sự kiện thành công");
      utils.events.getAll.invalidate();
      utils.events.getUpcoming.invalidate();
      onOpenChange(false);
    },
    onError: (err) => {
      toast.error(`Lỗi cập nhật sự kiện: ${err.message}`);
    },
  });

  const isSaving = createMutation.isPending || updateMutation.isPending;

  useEffect(() => {
    if (!open) return;

    if (mode?.kind === "create") {
      const baseDate = mode.initialDate ? new Date(mode.initialDate) : new Date();
      // Round to next 30 minutes
      const start = new Date(baseDate);
      if (!mode.initialDate) {
        start.setMinutes(Math.ceil(start.getMinutes() / 30) * 30, 0, 0);
      }
      const end = new Date(start.getTime() + 60 * 60 * 1000);

      setTitle("");
      setIsAllDay(false);
      setStartDateStr(format(start, "yyyy-MM-dd"));
      setStartTimeStr(format(start, "HH:mm"));
      setEndDateStr(format(end, "yyyy-MM-dd"));
      setEndTimeStr(format(end, "HH:mm"));
      setMeetingUrl("");
      setCalendarEventUrl("");
      setCalendarColor("#3b82f6");
    } else if (mode?.kind === "edit") {
      const { event } = mode;
      const start = new Date(event.startAt);
      const end = new Date(event.endAt);

      setTitle(event.title);
      setIsAllDay(event.isAllDay);
      setStartDateStr(format(start, "yyyy-MM-dd"));
      setStartTimeStr(format(start, "HH:mm"));
      setEndDateStr(format(end, "yyyy-MM-dd"));
      setEndTimeStr(format(end, "HH:mm"));
      setMeetingUrl(event.meetingUrl || "");
      setCalendarEventUrl(event.calendarEventUrl || "");
      setCalendarColor(event.calendarColor || "#3b82f6");
    }
  }, [open, mode]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      toast.error("Vui lòng nhập tiêu đề sự kiện");
      return;
    }

    let startAt: Date;
    let endAt: Date;

    if (isAllDay) {
      startAt = new Date(`${startDateStr}T00:00:00`);
      endAt = new Date(`${endDateStr || startDateStr}T23:59:59`);
    } else {
      startAt = new Date(`${startDateStr}T${startTimeStr || "00:00"}:00`);
      endAt = new Date(`${endDateStr || startDateStr}T${endTimeStr || "00:00"}:00`);
    }

    if (isNaN(startAt.getTime()) || isNaN(endAt.getTime())) {
      toast.error("Thời gian không hợp lệ");
      return;
    }

    if (endAt < startAt) {
      toast.error("Thời gian kết thúc phải sau thời gian bắt đầu");
      return;
    }

    if (mode?.kind === "create") {
      createMutation.mutate({
        title: title.trim(),
        startAt,
        endAt,
        isAllDay,
        meetingUrl: meetingUrl.trim() || null,
        calendarEventUrl: calendarEventUrl.trim() || null,
        calendarColor,
      });
    } else if (mode?.kind === "edit" && mode.event.id) {
      updateMutation.mutate({
        id: mode.event.id,
        title: title.trim(),
        startAt,
        endAt,
        isAllDay,
        meetingUrl: meetingUrl.trim() || null,
        calendarEventUrl: calendarEventUrl.trim() || null,
        calendarColor,
      });
    }
  };

  const detectedMeetingIcon = meetingUrl
    ? getMeetingIcon(meetingUrl, { className: "size-4 text-primary shrink-0" })
    : null;

  const isEdit = mode?.kind === "edit";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-semibold">
            <CalendarIcon className="size-4.5 text-primary" />
            {isEdit ? "Chỉnh sửa sự kiện" : "Thêm sự kiện mới"}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Cập nhật thời gian, link họp hoặc ghi chú cho sự kiện này."
              : "Thêm sự kiện vào lịch để đồng bộ và tạo ghi chú cuộc họp nhanh chóng."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          {/* Title */}
          <div className="space-y-1.5">
            <Label htmlFor="event-title" className="text-xs font-medium">
              Tiêu đề sự kiện <span className="text-destructive">*</span>
            </Label>
            <Input
              ref={titleInputRef}
              id="event-title"
              placeholder="VD: Họp giao ban tuần, Phỏng vấn ứng viên..."
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
              required
            />
          </div>

          {/* All day checkbox */}
          <div className="flex items-center gap-2 pt-1">
            <Checkbox
              id="event-allday"
              checked={isAllDay}
              onCheckedChange={(checked) => setIsAllDay(checked === true)}
            />
            <Label
              htmlFor="event-allday"
              className="text-xs font-medium cursor-pointer select-none"
            >
              Diễn ra cả ngày
            </Label>
          </div>

          {/* Start date & time */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium flex items-center gap-1.5">
              <Clock className="size-3.5 text-muted-foreground" />
              Bắt đầu
            </Label>
            <div className="grid grid-cols-2 gap-2">
              <Input
                type="date"
                value={startDateStr}
                onChange={(e) => {
                  setStartDateStr(e.target.value);
                  if (!endDateStr || endDateStr < e.target.value) {
                    setEndDateStr(e.target.value);
                  }
                }}
                required
              />
              {!isAllDay && (
                <Input
                  type="time"
                  value={startTimeStr}
                  onChange={(e) => setStartTimeStr(e.target.value)}
                  required
                />
              )}
            </div>
          </div>

          {/* End date & time */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium flex items-center gap-1.5">
              <Clock className="size-3.5 text-muted-foreground" />
              Kết thúc
            </Label>
            <div className="grid grid-cols-2 gap-2">
              <Input
                type="date"
                value={endDateStr}
                min={startDateStr}
                onChange={(e) => setEndDateStr(e.target.value)}
                required
              />
              {!isAllDay && (
                <Input
                  type="time"
                  value={endTimeStr}
                  onChange={(e) => setEndTimeStr(e.target.value)}
                  required
                />
              )}
            </div>
          </div>

          {/* Meeting URL */}
          <div className="space-y-1.5">
            <Label htmlFor="event-meeting-url" className="text-xs font-medium flex items-center gap-1.5">
              <Video className="size-3.5 text-muted-foreground" />
              Link họp trực tuyến (Google Meet, Zoom, Teams...)
            </Label>
            <div className="relative flex items-center">
              <Input
                id="event-meeting-url"
                placeholder="https://meet.google.com/xxx-xxxx-xxx"
                value={meetingUrl}
                onChange={(e) => setMeetingUrl(e.target.value)}
                className={detectedMeetingIcon ? "pr-9" : undefined}
              />
              {detectedMeetingIcon && (
                <div className="absolute right-3 pointer-events-none">
                  {detectedMeetingIcon}
                </div>
              )}
            </div>
          </div>

          {/* Calendar external URL */}
          <div className="space-y-1.5">
            <Label htmlFor="event-cal-url" className="text-xs font-medium flex items-center gap-1.5">
              <LinkIcon className="size-3.5 text-muted-foreground" />
              Link lịch bên ngoài (tùy chọn)
            </Label>
            <Input
              id="event-cal-url"
              placeholder="https://calendar.google.com/..."
              value={calendarEventUrl}
              onChange={(e) => setCalendarEventUrl(e.target.value)}
            />
          </div>

          {/* Color palette */}
          <div className="space-y-2">
            <Label className="text-xs font-medium flex items-center gap-1.5">
              <Palette className="size-3.5 text-muted-foreground" />
              Màu hiển thị
            </Label>
            <div className="flex items-center gap-2 flex-wrap">
              {COLOR_PRESETS.map((preset) => {
                const isSelected = calendarColor === preset.color;
                return (
                  <button
                    key={preset.color}
                    type="button"
                    title={preset.label}
                    className={`size-7 rounded-full transition-all flex items-center justify-center cursor-pointer ${
                      isSelected
                        ? "ring-2 ring-offset-2 ring-primary scale-110"
                        : "hover:scale-105 opacity-80 hover:opacity-100"
                    }`}
                    style={{ backgroundColor: preset.color }}
                    onClick={() => setCalendarColor(preset.color)}
                  >
                    {isSelected && (
                      <span className="size-2 rounded-full bg-white shadow-xs" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <DialogFooter className="pt-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSaving}
            >
              Hủy
            </Button>
            <Button type="submit" disabled={isSaving || !title.trim()}>
              {isSaving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Đang lưu...
                </>
              ) : isEdit ? (
                "Lưu thay đổi"
              ) : (
                "Tạo sự kiện"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
