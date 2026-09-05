"use client";

import React, { useState } from "react";
import { Calendar, Plus, ChevronRight } from "lucide-react";
import UpcomingEventCard from "./upcoming-event-card";
import { UpcomingEvent } from "../types";
import { useTranslation } from "react-i18next";
import { useNavigate, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { api } from "@/trpc/react";
import {
  EventFormDialog,
  type EventFormData,
  type EventFormMode,
} from "../../events/components/event-form-dialog";
import { EventDeleteDialog } from "../../events/components/event-delete-dialog";

export function UpcomingEvents() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const utils = api.useUtils();

  const [formMode, setFormMode] = useState<EventFormMode | null>(null);
  const [deleteEventTarget, setDeleteEventTarget] = useState<UpcomingEvent | null>(null);

  const { data: eventRows } = api.events.getUpcoming.useQuery({ limit: 4 });

  const upcomingEvents: UpcomingEvent[] = (eventRows ?? []).map((event) => ({
    id: event.id,
    title: event.title,
    startAt: new Date(event.startAt),
    endAt: new Date(event.endAt),
    isAllDay: event.isAllDay,
    meetingUrl: event.meetingUrl,
    calendarEventUrl: event.calendarEventUrl ?? undefined,
    calendarColor: event.calendarColor,
  }));

  const createNoteFromEvent = api.notes.createNoteFromEvent.useMutation({
    onSuccess: (data) => {
      utils.notes.getNotes.invalidate();
      navigate({
        to: "/notes/$noteId",
        params: { noteId: String(data.note.id) },
      });
    },
  });

  const handleTakeNotes = (event: UpcomingEvent) => {
    if (createNoteFromEvent.isPending) return;
    createNoteFromEvent.mutate({
      title: event.title,
      eventData: {
        eventId: event.id,
        title: event.title,
        calendarColor: event.calendarColor ?? "#0A84FF",
        meetingUrl: event.meetingUrl ?? undefined,
        calendarEventUrl: event.calendarEventUrl ?? undefined,
        startAt: event.startAt,
        endAt: event.endAt,
        isAllDay: event.isAllDay,
      },
    });
  };

  const handleEdit = (event: UpcomingEvent) => {
    setFormMode({
      kind: "edit",
      event: {
        id: event.id,
        title: event.title,
        startAt: event.startAt,
        endAt: event.endAt,
        isAllDay: event.isAllDay,
        meetingUrl: event.meetingUrl,
        calendarEventUrl: event.calendarEventUrl,
        calendarColor: event.calendarColor || "#3b82f6",
      },
    });
  };

  const handleDelete = (event: UpcomingEvent) => {
    setDeleteEventTarget(event);
  };

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Calendar className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-medium text-foreground">
            {t("settings.notes.upcomingEvents.title", "Sự kiện sắp diễn ra")}
          </h2>
          {upcomingEvents.length > 0 && (
            <span className="text-[11px] font-mono px-1.5 py-0.2 rounded-full bg-accent text-muted-foreground">
              {upcomingEvents.length}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setFormMode({ kind: "create" })}
            className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground gap-1"
          >
            <Plus className="w-3.5 h-3.5" />
            Thêm
          </Button>

          <Link
            to="/events"
            className="inline-flex items-center text-xs text-muted-foreground hover:text-foreground transition-colors ml-1"
          >
            <span>Tất cả</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>

      {/* Events List or Empty State */}
      {upcomingEvents.length === 0 ? (
        <div className="rounded-xl border border-dashed p-4 text-center space-y-2 bg-accent/20">
          <p className="text-xs text-muted-foreground">
            Không có sự kiện nào sắp tới
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setFormMode({ kind: "create" })}
            className="h-7 text-xs gap-1"
          >
            <Plus className="w-3 h-3" />
            Lên lịch sự kiện mới
          </Button>
        </div>
      ) : (
        <div className="bg-accent/40 rounded-xl overflow-clip divide-y divide-border/50 border shadow-2xs">
          {upcomingEvents.map((event) => (
            <div key={event.id}>
              <UpcomingEventCard
                event={event}
                onTakeNotes={handleTakeNotes}
                onEdit={handleEdit}
                onDelete={handleDelete}
              />
            </div>
          ))}
        </div>
      )}

      {/* Add / Edit Event Dialog */}
      <EventFormDialog
        open={!!formMode}
        onOpenChange={(open) => {
          if (!open) setFormMode(null);
        }}
        mode={formMode}
      />

      {/* Delete Confirmation Dialog */}
      <EventDeleteDialog
        open={!!deleteEventTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteEventTarget(null);
        }}
        eventId={deleteEventTarget?.id ?? null}
        eventTitle={deleteEventTarget?.title}
      />
    </div>
  );
}
