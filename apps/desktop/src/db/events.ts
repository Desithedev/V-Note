import { and, asc, eq, gte, lte } from "drizzle-orm";
import * as crypto from "crypto";
import { db } from "./index";
import { events, type NewEvent, type Event } from "./schema";

export async function upsertEvent(
  data: Omit<NewEvent, "createdAt" | "updatedAt">,
) {
  const now = new Date();

  await db
    .insert(events)
    .values({
      ...data,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: events.id,
      set: {
        title: data.title,
        calendarColor: data.calendarColor,
        meetingUrl: data.meetingUrl,
        calendarEventUrl: data.calendarEventUrl,
        startAt: data.startAt,
        endAt: data.endAt,
        isAllDay: data.isAllDay,
        updatedAt: now,
      },
    });
}

export async function getEventById(id: string) {
  const result = await db.select().from(events).where(eq(events.id, id));
  return result[0] || null;
}

export async function getUpcomingEvents(limit?: number) {
  const now = new Date();

  const base = db
    .select()
    .from(events)
    .where(gte(events.endAt, now))
    .orderBy(asc(events.startAt));

  return limit !== undefined ? await base.limit(limit) : await base;
}

export async function getAllEvents(options?: {
  from?: Date;
  to?: Date;
  limit?: number;
}) {
  const conditions = [];

  if (options?.from) {
    conditions.push(gte(events.endAt, options.from));
  }
  if (options?.to) {
    conditions.push(lte(events.startAt, options.to));
  }

  const base = db.select().from(events);
  const filtered =
    conditions.length > 0 ? base.where(and(...conditions)) : base;

  const ordered = filtered.orderBy(asc(events.startAt));

  return options?.limit !== undefined
    ? await ordered.limit(options.limit)
    : await ordered;
}

export async function createEvent(data: {
  title: string;
  startAt: Date;
  endAt: Date;
  isAllDay?: boolean;
  meetingUrl?: string | null;
  calendarEventUrl?: string | null;
  calendarColor?: string;
}): Promise<Event> {
  const now = new Date();
  const id = `evt_${crypto.randomUUID()}`;
  const color = data.calendarColor || "#3b82f6";

  const newEvent = {
    id,
    title: data.title.trim(),
    startAt: data.startAt,
    endAt: data.endAt,
    isAllDay: data.isAllDay ?? false,
    meetingUrl: data.meetingUrl?.trim() || null,
    calendarEventUrl: data.calendarEventUrl?.trim() || null,
    calendarColor: color,
    createdAt: now,
    updatedAt: now,
  };

  await db.insert(events).values(newEvent);

  return newEvent;
}

export async function updateEvent(
  id: string,
  data: Partial<{
    title: string;
    startAt: Date;
    endAt: Date;
    isAllDay: boolean;
    meetingUrl: string | null;
    calendarEventUrl: string | null;
    calendarColor: string;
  }>,
): Promise<Event | null> {
  const now = new Date();
  const updateData: Record<string, unknown> = {
    updatedAt: now,
  };

  if (data.title !== undefined) updateData.title = data.title.trim();
  if (data.startAt !== undefined) updateData.startAt = data.startAt;
  if (data.endAt !== undefined) updateData.endAt = data.endAt;
  if (data.isAllDay !== undefined) updateData.isAllDay = data.isAllDay;
  if (data.meetingUrl !== undefined) {
    updateData.meetingUrl = data.meetingUrl ? data.meetingUrl.trim() : null;
  }
  if (data.calendarEventUrl !== undefined) {
    updateData.calendarEventUrl = data.calendarEventUrl
      ? data.calendarEventUrl.trim()
      : null;
  }
  if (data.calendarColor !== undefined) {
    updateData.calendarColor = data.calendarColor;
  }

  await db.update(events).set(updateData).where(eq(events.id, id));

  return await getEventById(id);
}

export async function deleteEvent(id: string): Promise<boolean> {
  await db.delete(events).where(eq(events.id, id));
  return true;
}
