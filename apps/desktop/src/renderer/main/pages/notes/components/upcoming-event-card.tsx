"use client";

import React from "react";
import { NotebookPen, MoreVertical, Pencil, Trash2, Copy, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getMeetingIcon } from "@/utils/meeting-icons";
import { formatEventTimeRange } from "@/utils/event-time";
import { useTranslation } from "react-i18next";
import { copyToClipboard } from "@/lib/clipboard";
import { toast } from "sonner";
import type { UpcomingEvent } from "../types";

interface UpcomingEventCardProps {
  event: UpcomingEvent;
  onTakeNotes?: (event: UpcomingEvent) => void;
  onEdit?: (event: UpcomingEvent) => void;
  onDelete?: (event: UpcomingEvent) => void;
}

const UpcomingEventCard = ({
  event,
  onTakeNotes,
  onEdit,
  onDelete,
}: UpcomingEventCardProps) => {
  const { t } = useTranslation();

  const handleLinkClick = () => {
    if (event.meetingUrl) {
      window.electronAPI.openExternal(event.meetingUrl);
    }
  };

  const handleTakeNotes = () => {
    onTakeNotes?.(event);
  };

  const handleCopyLink = async () => {
    if (!event.meetingUrl) return;
    const ok = await copyToClipboard(event.meetingUrl);
    if (ok) {
      toast.success("Đã sao chép link cuộc họp");
    }
  };

  const leadingIcon = event.meetingUrl ? (
    getMeetingIcon(event.meetingUrl, {
      className: "w-4.5 h-4.5 text-muted-foreground",
    })
  ) : (
    <Calendar className="w-4.5 h-4.5 text-muted-foreground" />
  );

  return (
    <div className="bg-transparent border-none group hover:bg-accent/60 transition-colors relative py-2.5 px-3.5">
      <div className="flex items-center gap-3">
        {/* Color bar indicator */}
        <span
          className="h-7 w-1 shrink-0 rounded-full"
          style={{ backgroundColor: event.calendarColor || "#3b82f6" }}
        />

        {/* Leading icon */}
        <div className="shrink-0">{leadingIcon}</div>

        <div className="flex-1 min-w-0 space-y-0.5">
          {/* Event title */}
          <h3 className="text-foreground text-sm font-medium leading-tight truncate">
            {event.title}
          </h3>

          {/* Time and meeting url */}
          <div className="flex items-center gap-1.5 text-muted-foreground text-xs truncate">
            <span className="whitespace-nowrap font-mono text-[11px]">
              {formatEventTimeRange(
                new Date(event.startAt),
                new Date(event.endAt),
                event.isAllDay,
              )}
            </span>
            {event.meetingUrl && (
              <>
                <span>•</span>
                <button
                  type="button"
                  onClick={handleLinkClick}
                  className="text-muted-foreground text-xs truncate hover:text-primary hover:underline cursor-pointer transition-colors text-left"
                >
                  {event.meetingUrl}
                </button>
              </>
            )}
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-1 shrink-0">
          {/* Take notes button */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                variant="ghost"
                onClick={handleTakeNotes}
                className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <NotebookPen className="w-3.5 h-3.5 text-muted-foreground" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>{t("settings.notes.upcomingEvents.takeNotes", "Tạo ghi chú")}</p>
            </TooltipContent>
          </Tooltip>

          {/* More options menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
              >
                <MoreVertical className="w-3.5 h-3.5" />
                <span className="sr-only">Tùy chọn sự kiện</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onClick={handleTakeNotes} className="cursor-pointer">
                <NotebookPen className="mr-2 h-3.5 w-3.5" />
                Tạo ghi chú
              </DropdownMenuItem>

              {event.meetingUrl && (
                <DropdownMenuItem onClick={handleCopyLink} className="cursor-pointer">
                  <Copy className="mr-2 h-3.5 w-3.5" />
                  Sao chép link họp
                </DropdownMenuItem>
              )}

              {onEdit && (
                <DropdownMenuItem
                  onClick={() => onEdit(event)}
                  className="cursor-pointer"
                >
                  <Pencil className="mr-2 h-3.5 w-3.5" />
                  Sửa sự kiện
                </DropdownMenuItem>
              )}

              {onDelete && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => onDelete(event)}
                    className="cursor-pointer text-destructive focus:text-destructive"
                  >
                    <Trash2 className="mr-2 h-3.5 w-3.5" />
                    Xóa sự kiện
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
};

export default UpcomingEventCard;
