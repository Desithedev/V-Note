import { and, asc, count, desc, eq, inArray } from "drizzle-orm";
import { db } from ".";
import {
  meetingArtifacts,
  meetings,
  transcriptSegments,
  type Meeting,
  type MeetingArtifact,
  type NewMeeting,
  type NewMeetingArtifact,
  type NewTranscriptSegment,
  type TranscriptSegment,
} from "./schema";
import type {
  MeetingDetail,
  MeetingListItem,
  TranscriptEvent,
} from "../types/meeting";

export async function createMeeting(
  data: Omit<NewMeeting, "createdAt" | "updatedAt">,
): Promise<Meeting> {
  const now = new Date();
  const [meeting] = await db
    .insert(meetings)
    .values({
      ...data,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  return meeting;
}

export async function updateMeeting(
  id: string,
  data: Partial<Omit<Meeting, "id" | "createdAt">>,
): Promise<Meeting | null> {
  const [meeting] = await db
    .update(meetings)
    .set({
      ...data,
      updatedAt: new Date(),
    })
    .where(eq(meetings.id, id))
    .returning();

  return meeting ?? null;
}

let columnsChecked = false;
export async function ensureTranscriptSegmentColumns(): Promise<void> {
  if (columnsChecked) return;
  try {
    await db.$client.execute("ALTER TABLE transcript_segments ADD COLUMN speaker_id TEXT;");
  } catch {}
  try {
    await db.$client.execute("ALTER TABLE transcript_segments ADD COLUMN speaker_label TEXT;");
  } catch {}
  try {
    await db.$client.execute("ALTER TABLE transcript_segments ADD COLUMN translation TEXT;");
  } catch {}
  try {
    await db.$client.execute("ALTER TABLE transcript_segments ADD COLUMN confidence REAL;");
  } catch {}
  columnsChecked = true;
}

export async function createTranscriptSegments(
  segments: Array<Omit<NewTranscriptSegment, "createdAt">>,
): Promise<TranscriptSegment[]> {
  if (segments.length === 0) {
    return [];
  }

  await ensureTranscriptSegmentColumns();

  try {
    return await db
      .insert(transcriptSegments)
      .values(
        segments.map((segment) => ({
          ...segment,
          id: (segment as any).id || crypto.randomUUID(),
          createdAt: new Date(),
        })),
      )
      .returning();
  } catch (error) {
    // If insert fails due to missing columns, force patch and retry once
    await db.$client.execute("ALTER TABLE transcript_segments ADD COLUMN speaker_id TEXT;").catch(() => {});
    await db.$client.execute("ALTER TABLE transcript_segments ADD COLUMN speaker_label TEXT;").catch(() => {});
    await db.$client.execute("ALTER TABLE transcript_segments ADD COLUMN translation TEXT;").catch(() => {});
    await db.$client.execute("ALTER TABLE transcript_segments ADD COLUMN confidence REAL;").catch(() => {});

    return await db
      .insert(transcriptSegments)
      .values(
        segments.map((segment) => ({
          ...segment,
          id: (segment as any).id || crypto.randomUUID(),
          createdAt: new Date(),
        })),
      )
      .returning();
  }
}

export async function replaceNonFinalTranscriptSegments(
  meetingId: string,
  segments: Array<Omit<NewTranscriptSegment, "createdAt">>,
): Promise<TranscriptSegment[]> {
  await db
    .delete(transcriptSegments)
    .where(
      and(
        eq(transcriptSegments.meetingId, meetingId),
        eq(transcriptSegments.isFinal, false),
      ),
    );

  return createTranscriptSegments(segments);
}

export async function updateTranscriptSegment(
  id: string,
  text: string,
): Promise<TranscriptSegment | null> {
  const [segment] = await db
    .update(transcriptSegments)
    .set({ text })
    .where(eq(transcriptSegments.id, id))
    .returning();
  return segment ?? null;
}

export async function renameSpeakerSegments(
  meetingId: string,
  speakerId: string,
  newLabel: string,
): Promise<number> {
  const result = await db
    .update(transcriptSegments)
    .set({ speakerLabel: newLabel })
    .where(
      and(
        eq(transcriptSegments.meetingId, meetingId),
        eq(transcriptSegments.speakerId, speakerId),
      ),
    )
    .returning();
  return result.length;
}

export async function createMeetingArtifacts(
  artifacts: Array<Omit<NewMeetingArtifact, "createdAt">>,
): Promise<MeetingArtifact[]> {
  if (artifacts.length === 0) {
    return [];
  }

  return await db
    .insert(meetingArtifacts)
    .values(
      artifacts.map((artifact) => ({
        ...artifact,
        createdAt: new Date(),
      })),
    )
    .returning();
}

export async function getMeetings(
  options: {
    limit?: number;
    offset?: number;
    noteId?: number;
  } = {},
): Promise<MeetingListItem[]> {
  const { limit = 50, offset = 0, noteId } = options;

  let query = db
    .select({
      id: meetings.id,
      noteId: meetings.noteId,
      title: meetings.title,
      startedAt: meetings.startedAt,
      endedAt: meetings.endedAt,
      durationMs: meetings.durationMs,
      captureMode: meetings.captureMode,
      state: meetings.state,
      transcriptSegmentCount: count(transcriptSegments.id),
    })
    .from(meetings)
    .leftJoin(transcriptSegments, eq(transcriptSegments.meetingId, meetings.id))
    .groupBy(meetings.id)
    .orderBy(desc(meetings.startedAt)) as any;

  if (noteId !== undefined) {
    query = query.where(eq(meetings.noteId, noteId)) as any;
  }

  const rows = (await query.limit(limit).offset(offset)) as Array<
    Omit<MeetingListItem, "transcriptSegmentCount"> & {
      transcriptSegmentCount: number | null;
    }
  >;

  return rows.map((row) => ({
    ...row,
    transcriptSegmentCount: row.transcriptSegmentCount ?? 0,
  }));
}

export async function getMeetingById(
  id: string,
): Promise<MeetingDetail | null> {
  const [meeting] = await db
    .select()
    .from(meetings)
    .where(eq(meetings.id, id))
    .limit(1);

  if (!meeting) {
    return null;
  }

  const [artifacts, transcript] = await Promise.all([
    db
      .select()
      .from(meetingArtifacts)
      .where(eq(meetingArtifacts.meetingId, id))
      .orderBy(asc(meetingArtifacts.createdAt)),
    db
      .select()
      .from(transcriptSegments)
      .where(eq(transcriptSegments.meetingId, id))
      .orderBy(
        asc(transcriptSegments.startTimeMs),
        asc(transcriptSegments.createdAt),
      ),
  ]);

  return {
    id: meeting.id,
    noteId: meeting.noteId,
    title: meeting.title,
    startedAt: meeting.startedAt,
    endedAt: meeting.endedAt,
    durationMs: meeting.durationMs,
    captureMode: meeting.captureMode as MeetingDetail["captureMode"],
    state: meeting.state as MeetingDetail["state"],
    transcriptSegmentCount: transcript.length,
    transcriptionModel: meeting.transcriptionModel,
    metadata:
      meeting.metadata && typeof meeting.metadata === "object"
        ? (meeting.metadata as Record<string, unknown>)
        : null,
    artifacts: artifacts.map((artifact) => ({
      id: artifact.id,
      artifactType:
        artifact.artifactType as MeetingDetail["artifacts"][number]["artifactType"],
      path: artifact.path,
      sizeBytes: artifact.sizeBytes,
      createdAt: artifact.createdAt,
    })),
    transcript: transcript.map((segment) => toTranscriptEvent(segment)),
  };
}

export async function getNoteTranscript(
  noteId: number,
): Promise<TranscriptEvent[]> {
  const sessions = await db
    .select({
      id: meetings.id,
      noteId: meetings.noteId,
      startedAt: meetings.startedAt,
      durationMs: meetings.durationMs,
      state: meetings.state,
    })
    .from(meetings)
    .where(
      and(
        eq(meetings.noteId, noteId),
        inArray(meetings.state, [
          "recording",
          "starting",
          "stopping",
          "error",
          "completed",
        ]),
      ),
    )
    .orderBy(asc(meetings.startedAt), asc(meetings.createdAt));

  if (sessions.length === 0) {
    return [];
  }

  const sessionIds = sessions.map((session) => session.id);
  const segments = await db
    .select()
    .from(transcriptSegments)
    .where(inArray(transcriptSegments.meetingId, sessionIds))
    .orderBy(
      asc(transcriptSegments.meetingId),
      asc(transcriptSegments.startTimeMs),
      asc(transcriptSegments.createdAt),
      asc(transcriptSegments.segmentOrder),
    );

  const segmentsBySession = new Map<string, TranscriptSegment[]>();
  for (const segment of segments) {
    const current = segmentsBySession.get(segment.meetingId) ?? [];
    current.push(segment);
    segmentsBySession.set(segment.meetingId, current);
  }

  let runningOffsetMs = 0;
  const events: TranscriptEvent[] = [];

  for (const session of sessions) {
    const rawSegments = segmentsBySession.get(session.id) ?? [];
    if (rawSegments.length === 0) {
      continue;
    }

    const hasFinal = rawSegments.some((s) => s.isFinal);
    const sessionSegments = hasFinal ? rawSegments.filter((s) => s.isFinal) : rawSegments;

    for (const segment of sessionSegments) {
      events.push(
        toTranscriptEvent(segment, {
          noteId,
          offsetMs: runningOffsetMs,
        }),
      );
    }

    const maxSegmentEndMs = sessionSegments.reduce(
      (max, segment) => Math.max(max, segment.endTimeMs),
      0,
    );
    runningOffsetMs += session.durationMs ?? maxSegmentEndMs;
  }

  return events;
}

export async function getMeetingTranscript(
  meetingId: string,
): Promise<TranscriptEvent[]> {
  const [meeting] = await db
    .select({
      noteId: meetings.noteId,
    })
    .from(meetings)
    .where(eq(meetings.id, meetingId))
    .limit(1);

  const segments = await db
    .select()
    .from(transcriptSegments)
    .where(eq(transcriptSegments.meetingId, meetingId))
    .orderBy(
      asc(transcriptSegments.startTimeMs),
      asc(transcriptSegments.createdAt),
      asc(transcriptSegments.segmentOrder),
    );

  return segments.map((segment) =>
    toTranscriptEvent(segment, {
      noteId: meeting?.noteId ?? null,
    }),
  );
}

export async function deleteMeeting(id: string): Promise<Meeting | null> {
  const [meeting] = await db
    .delete(meetings)
    .where(eq(meetings.id, id))
    .returning();

  return meeting ?? null;
}

export async function deleteTranscriptByNoteId(noteId: number): Promise<void> {
  const noteMeetings = await db
    .select({ id: meetings.id })
    .from(meetings)
    .where(eq(meetings.noteId, noteId));

  const meetingIds = noteMeetings.map((m) => m.id);
  if (meetingIds.length > 0) {
    await db
      .delete(transcriptSegments)
      .where(inArray(transcriptSegments.meetingId, meetingIds));
  }
}

export interface NoteAudioArtifact {
  id: string;
  meetingId: string;
  artifactType: "mic_wav" | "mic_processed_wav" | "system_wav" | "debug_json";
  path: string;
  sizeBytes: number;
}

export async function getNoteAudioArtifacts(
  noteId: number,
): Promise<NoteAudioArtifact[]> {
  const sessions = await db
    .select({ id: meetings.id })
    .from(meetings)
    .where(eq(meetings.noteId, noteId))
    .orderBy(desc(meetings.startedAt));

  if (sessions.length === 0) return [];
  const sessionIds = sessions.map((s) => s.id);

  const artifacts = await db
    .select()
    .from(meetingArtifacts)
    .where(inArray(meetingArtifacts.meetingId, sessionIds))
    .orderBy(asc(meetingArtifacts.createdAt));

  return artifacts.map((a) => ({
    id: a.id,
    meetingId: a.meetingId,
    artifactType: a.artifactType as NoteAudioArtifact["artifactType"],
    path: a.path,
    sizeBytes: a.sizeBytes ?? 0,
  }));
}

function toTranscriptEvent(
  segment: TranscriptSegment,
  options: {
    noteId?: number | null;
    offsetMs?: number;
  } = {},
): TranscriptEvent {
  const offsetMs = options.offsetMs ?? 0;
  return {
    id: segment.id,
    meetingId: segment.meetingId,
    noteId: options.noteId ?? null,
    source: segment.source as TranscriptEvent["source"],
    speaker: segment.speaker as TranscriptEvent["speaker"],
    speakerId: segment.speakerId ?? undefined,
    speakerLabel: segment.speakerLabel ?? undefined,
    text: segment.text,
    translation: segment.translation ?? undefined,
    confidence: segment.confidence ?? undefined,
    startTimeMs: segment.startTimeMs + offsetMs,
    endTimeMs: segment.endTimeMs + offsetMs,
    rawStartTimeMs: segment.startTimeMs,
    rawEndTimeMs: segment.endTimeMs,
    segmentOrder: segment.segmentOrder,
    isFinal: segment.isFinal,
    createdAt: segment.createdAt,
  };
}
