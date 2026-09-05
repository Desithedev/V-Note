import { app, dialog } from "electron";
import { observable } from "@trpc/server/observable";
import * as fs from "node:fs";
import * as path from "node:path";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { getAppSettings } from "@/db/app-settings";
import { meetings, notes } from "@/db/schema";
import {
  deleteMeeting,
  deleteTranscriptByNoteId,
  getMeetingById,
  getMeetings,
  getNoteAudioArtifacts,
  getNoteTranscript,
  updateTranscriptSegment,
} from "@/db/meetings";
import type {
  MeetingLevels,
  MeetingRuntimeSnapshot,
  TranscriptEvent,
} from "@/types/meeting";
import { createRouter, procedure } from "../trpc";

const StartMeetingSchema = z.object({
  noteId: z.number().int().positive(),
  mode: z.enum(["mic", "system", "dual"]).default("dual"),
});

const SetSourceMutedSchema = z.object({
  source: z.enum(["mic", "system"]),
  muted: z.boolean(),
});

const ExportMeetingSchema = z.object({
  id: z.string(),
  format: z.enum(["txt", "json", "srt"]),
});

export const meetingsRouter = createRouter({
  startMeeting: procedure
    .input(StartMeetingSchema)
    .mutation(async ({ ctx, input }) => {
      const meetingManager = ctx.serviceManager.getService("meetingManager");
      return await meetingManager.start(input.noteId, input.mode);
    }),

  stopMeeting: procedure.mutation(async ({ ctx }) => {
    const meetingManager = ctx.serviceManager.getService("meetingManager");
    return await meetingManager.stop();
  }),

  setSourceMuted: procedure
    .input(SetSourceMutedSchema)
    .mutation(({ ctx, input }) => {
      const meetingManager = ctx.serviceManager.getService("meetingManager");
      meetingManager.setSourceMuted(input.source, input.muted);
      return meetingManager.getState();
    }),

  getMeetingState: procedure.query(({ ctx }) => {
    const meetingManager = ctx.serviceManager.getService("meetingManager");
    return meetingManager.getState();
  }),

  getMeetings: procedure
    .input(
      z.object({
        limit: z.number().optional(),
        offset: z.number().optional(),
        noteId: z.number().int().positive().optional(),
      }),
    )
    .query(async ({ input }) => {
      return await getMeetings(input);
    }),

  getNoteTranscript: procedure
    .input(z.object({ noteId: z.number().int().positive() }))
    .query(async ({ input }) => {
      return await getNoteTranscript(input.noteId);
    }),

  updateTranscriptSegment: procedure
    .input(
      z.object({
        id: z.string(),
        text: z.string(),
      }),
    )
    .mutation(async ({ input }) => {
      return await updateTranscriptSegment(input.id, input.text);
    }),

  renameSpeaker: procedure
    .input(
      z.object({
        meetingId: z.string(),
        speakerId: z.string(),
        newLabel: z.string().min(1),
      }),
    )
    .mutation(async ({ input }) => {
      const { renameSpeakerSegments } = await import("@/db/meetings");
      const updatedCount = await renameSpeakerSegments(
        input.meetingId,
        input.speakerId,
        input.newLabel,
      );
      return { success: true, updatedCount };
    }),

  getMeetingById: procedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }) => {
      return await getMeetingById(input.id);
    }),

  deleteMeeting: procedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const meeting = await getMeetingById(input.id);
      const deleted = await deleteMeeting(input.id);

      if (meeting) {
        for (const artifact of meeting.artifacts) {
          try {
            await fs.promises.rm(artifact.path, { force: true });
          } catch (error) {
            ctx.serviceManager
              .getLogger()
              .main.warn("Failed to remove meeting artifact", {
                meetingId: input.id,
                path: artifact.path,
                error,
              });
          }
        }
      }

      return deleted;
    }),

  exportMeeting: procedure
    .input(ExportMeetingSchema)
    .mutation(async ({ input }) => {
      const meeting = await getMeetingById(input.id);
      if (!meeting) {
        throw new Error("Meeting not found.");
      }

      const defaultPath = `${sanitizeFilename(meeting.title)}.${input.format}`;
      const result = await dialog.showSaveDialog({
        defaultPath,
        filters: [
          {
            name:
              input.format === "json"
                ? "JSON"
                : input.format === "srt"
                  ? "SubRip"
                  : "Text",
            extensions: [input.format],
          },
        ],
      });

      if (result.canceled || !result.filePath) {
        return {
          canceled: true,
        };
      }

      const content =
        input.format === "json"
          ? JSON.stringify(meeting, null, 2)
          : input.format === "srt"
            ? toSrt(meeting.transcript)
            : toText(meeting.transcript);

      await fs.promises.writeFile(result.filePath, content, "utf8");
      return {
        canceled: false,
        filePath: result.filePath,
      };
    }),

  // eslint-disable-next-line deprecation/deprecation
  stateUpdates: procedure.subscription(({ ctx }) => {
    return observable<MeetingRuntimeSnapshot>((emit) => {
      const meetingManager = ctx.serviceManager.getService("meetingManager");
      const handleStateChange = (snapshot: MeetingRuntimeSnapshot) => {
        emit.next(snapshot);
      };

      emit.next(meetingManager.getState());
      meetingManager.on("state-changed", handleStateChange);

      return () => {
        meetingManager.off("state-changed", handleStateChange);
      };
    });
  }),

  // Per-source mic/system amplitude levels for waveform visualisation.
  // Throttled to ~30Hz on the main side — native frames arrive at 50-100Hz
  // and the visual difference of dropping every other one is imperceptible.
  // eslint-disable-next-line deprecation/deprecation
  levelUpdates: procedure.subscription(({ ctx }) => {
    return observable<MeetingLevels>((emit) => {
      const meetingManager = ctx.serviceManager.getService("meetingManager");
      const THROTTLE_MS = 33;
      let lastEmit = 0;

      const handleLevel = (levels: { mic?: number; system?: number }) => {
        const now = Date.now();
        if (now - lastEmit < THROTTLE_MS) return;
        lastEmit = now;
        emit.next({ mic: levels.mic ?? 0, system: levels.system ?? 0 });
      };

      // Seed an initial zeroed level so consumers don't have to special-case
      // the pre-first-frame moment.
      emit.next({ mic: 0, system: 0 });
      meetingManager.on("level", handleLevel);
      return () => {
        meetingManager.off("level", handleLevel);
      };
    });
  }),

  // eslint-disable-next-line deprecation/deprecation
  transcriptUpdates: procedure.subscription(({ ctx }) => {
    return observable<TranscriptEvent>((emit) => {
      const meetingManager = ctx.serviceManager.getService("meetingManager");
      const handleTranscriptEvent = (event: TranscriptEvent) => {
        emit.next(event);
      };

      meetingManager.on("transcript-event", handleTranscriptEvent);
      return () => {
        meetingManager.off("transcript-event", handleTranscriptEvent);
      };
    });
  }),

  // Real-time interim/partial recognition text stream (near instantaneous speech-to-text feedback)
  // eslint-disable-next-line deprecation/deprecation
  partialTranscriptUpdates: procedure.subscription(({ ctx }) => {
    return observable<{
      noteId: number | null;
      speaker: "you" | "them";
      text: string;
    }>((emit) => {
      const meetingManager = ctx.serviceManager.getService("meetingManager");
      const handlePartial = (data: {
        noteId: number | null;
        speaker: "you" | "them";
        text: string;
      }) => {
        emit.next(data);
      };

      meetingManager.on("partial-transcript", handlePartial);
      return () => {
        meetingManager.off("partial-transcript", handlePartial);
      };
    });
  }),

  clearNoteTranscript: procedure
    .input(z.object({ noteId: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      await deleteTranscriptByNoteId(input.noteId);
      return { success: true };
    }),

  getNoteAudio: procedure
    .input(z.object({ noteId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const fileToMediaUrl = (filePath: string): string => {
        const normalized = filePath.replace(/\\/g, "/");
        return `media://local-file/${normalized}`;
      };

      // 1. Fetch all meetings for this note
      const noteMeetings = await db
        .select()
        .from(meetings)
        .where(eq(meetings.noteId, input.noteId))
        .orderBy(asc(meetings.startedAt));

      const settings = await getAppSettings();
      const customStorage = settings.recording?.storagePath?.trim();
      const candidateBases = [
        customStorage && fs.existsSync(customStorage) ? customStorage : null,
        (settings as any).audioStoragePath,
        path.join(app.getPath("userData"), "meetings"),
        path.join(process.env.APPDATA || "", "prismical", "meetings"),
        path.join(process.env.APPDATA || "", "V-Note", "meetings"),
        path.join(process.env.APPDATA || "", "v-note", "meetings"),
        path.join(process.env.APPDATA || "", "Electron", "meetings"),
        path.join(process.cwd(), "meetings"),
      ].filter(Boolean) as string[];

      const artifacts = await getNoteAudioArtifacts(input.noteId);
      const sessionsMap: Record<
        string,
        {
          meetingId: string;
          micDataUrl: string | null;
          systemDataUrl: string | null;
          dataUrl: string;
          durationMs?: number | null;
        }
      > = {};

      const meetingIdsToScan = new Set<string>(noteMeetings.map((m) => m.id));
      for (const a of artifacts) {
        if (a.meetingId) meetingIdsToScan.add(a.meetingId);
      }

      const findAudioFile = (mId: string, candidates: string[]): string | null => {
        for (const base of candidateBases) {
          for (const cand of candidates) {
            const fullPath = path.join(base, mId, cand);
            if (fs.existsSync(fullPath)) {
              try {
                const stat = fs.statSync(fullPath);
                if (stat.size > 100) return fullPath;
              } catch {}
            }
          }
        }
        return null;
      };

      for (const mId of meetingIdsToScan) {
        let micPath: string | null = null;
        let systemPath: string | null = null;

        // Check artifacts for this meeting
        const mArtifacts = artifacts.filter((a) => a.meetingId === mId);
        const micArt = mArtifacts.find(
          (a) =>
            (a.artifactType === "mic_processed_wav" ||
              a.artifactType === "mic_wav") &&
            fs.existsSync(a.path),
        );
        if (micArt) micPath = micArt.path;

        const sysArt = mArtifacts.find(
          (a) => a.artifactType === "system_wav" && fs.existsSync(a.path),
        );
        if (sysArt) systemPath = sysArt.path;

        // Fallback: Check candidate bases (including trace folder)
        if (!systemPath) {
          systemPath = findAudioFile(mId, [
            "system.wav",
            "audio.wav",
            path.join("trace", "transcription-system.wav"),
            path.join("trace", "app-frame-system.wav"),
          ]);
        }

        if (!micPath) {
          micPath = findAudioFile(mId, [
            "mic_processed.wav",
            "mic.wav",
            "audio.wav",
            path.join("trace", "transcription-mic.wav"),
            path.join("trace", "app-frame-mic_processed.wav"),
          ]);
        }

        const micDataUrl = micPath ? fileToMediaUrl(micPath) : null;
        const systemDataUrl = systemPath ? fileToMediaUrl(systemPath) : null;
        const dataUrl = systemDataUrl || micDataUrl;

        if (dataUrl) {
          const mRow = noteMeetings.find((m) => m.id === mId);
          sessionsMap[mId] = {
            meetingId: mId,
            micDataUrl,
            systemDataUrl,
            dataUrl,
            durationMs: mRow?.durationMs,
          };
        }
      }

      // 3. Fallback: Scan latest meeting directories in candidateBases if still empty
      if (Object.keys(sessionsMap).length === 0) {
        const foundMeetingDirs: { dir: string; mtime: number }[] = [];
        for (const storageBase of candidateBases) {
          if (!fs.existsSync(storageBase)) continue;
          try {
            const entries = await fs.promises.readdir(storageBase, { withFileTypes: true });
            for (const entry of entries) {
              if (entry.isDirectory()) {
                const fullDir = path.join(storageBase, entry.name);
                const stat = await fs.promises.stat(fullDir);
                foundMeetingDirs.push({ dir: fullDir, mtime: stat.mtimeMs });
              }
            }
          } catch {}
        }

        foundMeetingDirs.sort((a, b) => b.mtime - a.mtime);
        for (const { dir } of foundMeetingDirs.slice(0, 5)) {
          const mId = path.basename(dir);
          let micPath: string | null = null;
          let systemPath: string | null = null;
          for (const cand of [
            "system.wav",
            "mic_processed.wav",
            "mic.wav",
            "audio.wav",
            path.join("trace", "transcription-system.wav"),
            path.join("trace", "transcription-mic.wav"),
            path.join("trace", "app-frame-system.wav"),
            path.join("trace", "app-frame-mic_processed.wav"),
          ]) {
            const p = path.join(dir, cand);
            if (fs.existsSync(p)) {
              try {
                if (fs.statSync(p).size > 100) {
                  if (cand.includes("system")) systemPath = p;
                  else if (!micPath) micPath = p;
                }
              } catch {}
            }
          }
          if (micPath || systemPath) {
            const micDataUrl = micPath ? fileToMediaUrl(micPath) : null;
            const systemDataUrl = systemPath ? fileToMediaUrl(systemPath) : null;
            const dataUrl = systemDataUrl || micDataUrl;
            if (dataUrl) {
              sessionsMap[mId] = {
                meetingId: mId,
                micDataUrl,
                systemDataUrl,
                dataUrl,
              };
              break;
            }
          }
        }
      }

      // Check fallback note.audioFile
      const [note] = await db
        .select({ audioFile: notes.audioFile })
        .from(notes)
        .where(eq(notes.id, input.noteId))
        .limit(1);

      if (note?.audioFile && fs.existsSync(note.audioFile)) {
        const importUrl = fileToMediaUrl(note.audioFile);
        for (const m of noteMeetings) {
          sessionsMap[m.id] = {
            meetingId: m.id,
            micDataUrl: importUrl,
            systemDataUrl: importUrl,
            dataUrl: importUrl,
            durationMs: m.durationMs,
          };
        }
        sessionsMap["note_import"] = {
          meetingId: "note_import",
          micDataUrl: importUrl,
          systemDataUrl: importUrl,
          dataUrl: importUrl,
        };
      }

      const sessionKeys = Object.keys(sessionsMap);
      if (sessionKeys.length === 0) {
        return {
          hasAudio: false,
          dataUrl: null,
          micDataUrl: null,
          systemDataUrl: null,
          sessions: {},
          artifacts,
        };
      }

      const primarySession = sessionsMap[sessionKeys[0]];

      return {
        hasAudio: true,
        dataUrl: primarySession.dataUrl,
        micDataUrl: primarySession.micDataUrl,
        systemDataUrl: primarySession.systemDataUrl,
        sessions: sessionsMap,
        sessionKeys,
        artifacts,
      };
    }),
});

function sanitizeFilename(value: string): string {
  return value.replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-");
}

function toText(events: TranscriptEvent[]): string {
  return events
    .map(
      (event) =>
        `[${event.speaker === "you" ? "You" : "Them"} ${formatTimestamp(event.startTimeMs)}]\n${event.text}`,
    )
    .join("\n\n");
}

function toSrt(events: TranscriptEvent[]): string {
  return events
    .map((event, index) => {
      return [
        String(index + 1),
        `${formatSrtTimestamp(event.startTimeMs)} --> ${formatSrtTimestamp(event.endTimeMs)}`,
        `${event.speaker === "you" ? "You" : "Them"}: ${event.text}`,
      ].join("\n");
    })
    .join("\n\n");
}

function formatTimestamp(timestampMs: number): string {
  const totalSeconds = Math.floor(timestampMs / 1000);
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function formatSrtTimestamp(timestampMs: number): string {
  const hours = Math.floor(timestampMs / 3_600_000)
    .toString()
    .padStart(2, "0");
  const minutes = Math.floor((timestampMs % 3_600_000) / 60_000)
    .toString()
    .padStart(2, "0");
  const seconds = Math.floor((timestampMs % 60_000) / 1000)
    .toString()
    .padStart(2, "0");
  const milliseconds = Math.floor(timestampMs % 1000)
    .toString()
    .padStart(3, "0");
  return `${hours}:${minutes}:${seconds},${milliseconds}`;
}
