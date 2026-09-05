"use client";

import React, { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import {
  Calendar as CalendarIcon,
  List as ListIcon,
  Plus,
  Search,
  CalendarDays,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/trpc/react";
import {
  EventFormDialog,
  type EventFormData,
  type EventFormMode,
} from "./components/event-form-dialog";
import { EventDeleteDialog } from "./components/event-delete-dialog";
import { EventCalendarView } from "./components/event-calendar-view";
import { EventListView } from "./components/event-list-view";

export default function EventsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const utils = api.useUtils();

  const [viewMode, setViewMode] = useState<"calendar" | "list">("calendar");
  const [searchQuery, setSearchQuery] = useState("");
  const [formMode, setFormMode] = useState<EventFormMode | null>(null);
  const [deleteEventTarget, setDeleteEventTarget] = useState<EventFormData | null>(null);

  // Fetch all events
  const { data: eventRows = [], isLoading } = api.events.getAll.useQuery();

  const events: EventFormData[] = useMemo(
    () =>
      (eventRows ?? []).map((evt) => ({
        id: evt.id,
        title: evt.title,
        calendarColor: evt.calendarColor,
        startAt: new Date(evt.startAt),
        endAt: new Date(evt.endAt),
        isAllDay: evt.isAllDay,
        meetingUrl: evt.meetingUrl,
        calendarEventUrl: evt.calendarEventUrl,
      })),
    [eventRows],
  );

  const createNoteFromEvent = api.notes.createNoteFromEvent.useMutation({
    onSuccess: (data) => {
      utils.notes.getNotes.invalidate();
      navigate({
        to: "/notes/$noteId",
        params: { noteId: String(data.note.id) },
      });
    },
  });

  const handleOpenMeeting = (url: string | null) => {
    if (!url) return;
    window.electronAPI.openExternal(url);
  };

  const handleTakeNotes = (event: EventFormData) => {
    if (createNoteFromEvent.isPending) return;
    createNoteFromEvent.mutate({
      title: event.title,
      eventData: {
        eventId: event.id || `evt_${Date.now()}`,
        title: event.title,
        calendarColor: event.calendarColor,
        meetingUrl: event.meetingUrl ?? undefined,
        calendarEventUrl: event.calendarEventUrl ?? undefined,
        startAt: event.startAt,
        endAt: event.endAt,
        isAllDay: event.isAllDay,
      },
    });
  };

  const handleAddEvent = (initialDate?: Date) => {
    setFormMode({ kind: "create", initialDate });
  };

  const handleEditEvent = (event: EventFormData) => {
    setFormMode({ kind: "edit", event });
  };

  const handleDeleteEvent = (event: EventFormData) => {
    setDeleteEventTarget(event);
  };

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 pb-12">
      {/* Top Header & Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b pb-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <CalendarDays className="size-6 text-primary" />
            <h1 className="text-2xl font-bold tracking-tight">
              {t("settings.events.title", "Sự kiện & Lịch")}
            </h1>
          </div>
          <p className="text-xs text-muted-foreground">
            Quản lý lịch làm việc, theo dõi cuộc họp và ghi chú thông minh
          </p>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* View mode toggle */}
          <div className="flex items-center rounded-lg border bg-muted/50 p-0.5">
            <button
              type="button"
              onClick={() => setViewMode("calendar")}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                viewMode === "calendar"
                  ? "bg-background text-foreground shadow-2xs"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <CalendarIcon className="size-3.5" />
              <span>{t("settings.events.calendarView", "Lịch")}</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode("list")}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                viewMode === "list"
                  ? "bg-background text-foreground shadow-2xs"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <ListIcon className="size-3.5" />
              <span>{t("settings.events.listView", "Danh sách")}</span>
            </button>
          </div>

          {/* Add Event Button */}
          <Button
            size="sm"
            onClick={() => handleAddEvent()}
            className="h-8 gap-1.5 text-xs font-medium"
          >
            <Plus className="size-3.5" />
            <span>{t("settings.events.addEvent", "Thêm sự kiện")}</span>
          </Button>
        </div>
      </div>

      {/* Optional Search filter when in list mode */}
      {viewMode === "list" && (
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <Input
            placeholder={t("settings.events.searchPlaceholder", "Tìm kiếm sự kiện...")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-8 pl-8 text-xs bg-card"
          />
        </div>
      )}

      {/* Main Content: Calendar vs List */}
      {viewMode === "calendar" ? (
        <EventCalendarView
          events={events}
          onAddEvent={handleAddEvent}
          onEditEvent={handleEditEvent}
          onDeleteEvent={handleDeleteEvent}
          onTakeNotes={handleTakeNotes}
          onOpenMeeting={handleOpenMeeting}
        />
      ) : (
        <EventListView
          events={events}
          searchQuery={searchQuery}
          onAddEvent={() => handleAddEvent()}
          onEditEvent={handleEditEvent}
          onDeleteEvent={handleDeleteEvent}
          onTakeNotes={handleTakeNotes}
          onOpenMeeting={handleOpenMeeting}
        />
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
