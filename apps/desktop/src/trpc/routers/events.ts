import { z } from "zod";
import { createRouter, procedure } from "../trpc";
import {
  getUpcomingEvents,
  getAllEvents,
  getEventById,
  createEvent,
  updateEvent,
  deleteEvent,
} from "../../db/events";

export const eventsRouter = createRouter({
  getAll: procedure
    .input(
      z
        .object({
          from: z.coerce.date().optional(),
          to: z.coerce.date().optional(),
          limit: z.number().int().positive().optional(),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      return await getAllEvents(input);
    }),

  getUpcoming: procedure
    .input(
      z.object({ limit: z.number().int().positive().optional() }).optional(),
    )
    .query(async ({ input }) => {
      return await getUpcomingEvents(input?.limit);
    }),

  getById: procedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }) => {
      return await getEventById(input.id);
    }),

  create: procedure
    .input(
      z.object({
        title: z.string().min(1, "Tiêu đề không được để trống"),
        startAt: z.coerce.date(),
        endAt: z.coerce.date(),
        isAllDay: z.boolean().default(false),
        meetingUrl: z.string().nullable().optional(),
        calendarEventUrl: z.string().nullable().optional(),
        calendarColor: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      return await createEvent(input);
    }),

  update: procedure
    .input(
      z.object({
        id: z.string(),
        title: z.string().min(1).optional(),
        startAt: z.coerce.date().optional(),
        endAt: z.coerce.date().optional(),
        isAllDay: z.boolean().optional(),
        meetingUrl: z.string().nullable().optional(),
        calendarEventUrl: z.string().nullable().optional(),
        calendarColor: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      return await updateEvent(id, data);
    }),

  delete: procedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      return await deleteEvent(input.id);
    }),
});
