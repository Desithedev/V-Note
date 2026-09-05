import { z } from "zod";
import { app, dialog } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import { eq } from "drizzle-orm";
import { createRouter, procedure } from "../trpc";
import {
  getTranscriptions,
  getTranscriptionById,
  createTranscription,
  updateTranscription,
  deleteTranscription,
  getTranscriptionsCount,
  searchTranscriptions,
} from "../../db/transcriptions.js";
import { createNote, saveYjsUpdate } from "../../db/notes.js";
import { db } from "../../db/index.js";
import { getNoteAudioArtifacts, createTranscriptSegments } from "../../db/meetings.js";
import { markdownToYDocUpdate } from "../../services/notes/markdown-to-ydoc.js";
import { getAppSettings } from "../../db/app-settings.js";
import { getInstanceById, getInstancesByProvider } from "../../db/instances.js";
import { PROVIDER_TYPES } from "../../constants/provider-types.js";
import { type PhoVoiceConfig, notes, meetings, meetingArtifacts } from "../../db/schema.js";
import { deleteAudioFile } from "../../utils/audio-file-cleanup.js";
import { phovoiceLocalService } from "../../main/services/phovoice-local-service.js";

// Input schemas
const GetTranscriptionsSchema = z.object({
  limit: z.number().optional(),
  offset: z.number().optional(),
  sortBy: z.enum(["timestamp", "createdAt"]).optional(),
  sortOrder: z.enum(["asc", "desc"]).optional(),
  search: z.string().optional(),
});

const CreateTranscriptionSchema = z.object({
  text: z.string(),
  timestamp: z.date().optional(),
  audioFile: z.string().optional(),
  language: z.string().optional(),
});

const UpdateTranscriptionSchema = z.object({
  text: z.string().optional(),
  timestamp: z.date().optional(),
  audioFile: z.string().optional(),
  language: z.string().optional(),
});

const ReportTranscriptionSchema = z.object({
  transcriptionId: z.number(),
  feedbackText: z.string().min(1).max(2000),
});

interface PhoVoiceApiResponse {
  id?: string;
  text?: string;
  duration?: number;
  language?: string;
  rtf?: number;
  dual_channel?: boolean;
  segments?: Array<{
    start: number;
    end: number;
    speaker?: string;
    speaker_label?: string;
    source?: string;
    channel?: number;
    text: string;
    confidence?: number;
  }>;
}

async function resolvePhoVoiceConfig() {
  const settings = await getAppSettings();
  const transcriptionDefault = settings.modelDefaults?.transcription;
  let baseURL = "http://127.0.0.1:8000";
  let apiKey = "";
  let model = transcriptionDefault?.modelId || "68M";
  let punctuation = true;
  let normalize = true;
  let timestamps = true;

  if (transcriptionDefault?.instanceId) {
    const instance = await getInstanceById(transcriptionDefault.instanceId);
    if (instance && instance.provider === PROVIDER_TYPES.phovoice) {
      const cfg = instance.config as PhoVoiceConfig & Record<string, any>;
      baseURL = cfg.baseURL?.replace(/\/+$/, "") || baseURL;
      apiKey = cfg.apiKey || apiKey;
      if (cfg.punctuation !== undefined) punctuation = cfg.punctuation;
      if (cfg.normalization !== undefined) normalize = cfg.normalization;
      if (cfg.timestamps !== undefined) timestamps = cfg.timestamps;
    }
  } else {
    const phovoiceInstances = await getInstancesByProvider(PROVIDER_TYPES.phovoice);
    if (phovoiceInstances.length > 0) {
      const instance = phovoiceInstances[0];
      const cfg = instance.config as PhoVoiceConfig & Record<string, any>;
      baseURL = cfg.baseURL?.replace(/\/+$/, "") || baseURL;
      apiKey = cfg.apiKey || apiKey;
      if (cfg.punctuation !== undefined) punctuation = cfg.punctuation;
      if (cfg.normalization !== undefined) normalize = cfg.normalization;
      if (cfg.timestamps !== undefined) timestamps = cfg.timestamps;
    }
  }

  return { baseURL, apiKey, model, punctuation, normalize, timestamps };
}

async function callPhoVoiceTranscribe(
  fileBuffer: Buffer,
  filename: string,
  cfg: {
    baseURL: string;
    apiKey: string;
    model: string;
    punctuation: boolean;
    normalize: boolean;
    timestamps: boolean;
    dualChannel?: boolean;
  },
  logger: any,
): Promise<PhoVoiceApiResponse> {
  const formData = new FormData();
  const blob = new Blob([fileBuffer]);
  formData.append("file", blob, filename);
  formData.append("model", cfg.model);
  formData.append("punctuation", String(cfg.punctuation));
  formData.append("normalize", String(cfg.normalize));
  formData.append("timestamps", String(cfg.timestamps));
  formData.append("diarization", "true");
  formData.append("dual_channel", String(cfg.dualChannel ?? true));

  const headers: Record<string, string> = {};
  if (cfg.apiKey) {
    headers["Authorization"] = `Bearer ${cfg.apiKey}`;
    headers["X-API-Key"] = cfg.apiKey;
  }

  const candidateUrls = [cfg.baseURL];
  if (cfg.baseURL.includes("127.0.0.1") || cfg.baseURL.includes("localhost")) {
    if (!candidateUrls.includes("http://127.0.0.1:18765")) candidateUrls.push("http://127.0.0.1:18765");
    if (!candidateUrls.includes("http://127.0.0.1:8000")) candidateUrls.push("http://127.0.0.1:8000");
  }

  let res: Response | null = null;
  for (const testUrl of candidateUrls) {
    try {
      const response = await fetch(`${testUrl}/v1/transcribe`, {
        method: "POST",
        headers,
        body: formData,
        signal: AbortSignal.timeout(300000), // 5 min timeout for big recordings
      });
      if (response.ok) {
        res = response;
        break;
      } else if (response.status === 401 || response.status === 403 || response.status === 429) {
        res = response;
        break;
      }
    } catch {
      // Try next candidate URL
    }
  }

  // If all candidate URLs failed, try auto-starting local engine once
  if (!res && (cfg.baseURL.includes("127.0.0.1") || cfg.baseURL.includes("localhost"))) {
    logger.main.info("PhoVoice endpoints down, attempting auto-start of local engine...");
    const started = await phovoiceLocalService.startEngine();
    if (started) {
      try {
        const retryRes = await fetch(`${phovoiceLocalService.getBaseURL()}/v1/transcribe`, {
          method: "POST",
          headers,
          body: formData,
          signal: AbortSignal.timeout(300000),
        });
        if (retryRes.ok) {
          res = retryRes;
        }
      } catch {}
    }
  }

  if (!res) {
    throw new Error(
      "Không thể kết nối đến PhoVoice AI Engine. Vui lòng vào Cài đặt -> Mô hình AI để bấm 'Reset Engine' hoặc 'Tải Model'!",
    );
  }

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`PhoVoice Server returned HTTP ${res.status}: ${errText}`);
  }

  return (await res.json()) as PhoVoiceApiResponse;
}

export const transcriptionsRouter = createRouter({
  // Get transcriptions list with pagination and filtering
  getTranscriptions: procedure
    .input(GetTranscriptionsSchema)
    .query(async ({ input }) => {
      return await getTranscriptions(input);
    }),

  // Get transcriptions count
  getTranscriptionsCount: procedure
    .input(z.object({ search: z.string().optional() }))
    .query(async ({ input }) => {
      return await getTranscriptionsCount(input.search);
    }),

  // Get transcription by ID
  getTranscriptionById: procedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      return await getTranscriptionById(input.id);
    }),

  // Search transcriptions
  searchTranscriptions: procedure
    .input(
      z.object({
        searchTerm: z.string(),
        limit: z.number().optional(),
      }),
    )
    .query(async ({ input }) => {
      return await searchTranscriptions(input.searchTerm, input.limit);
    }),

  // Create transcription
  createTranscription: procedure
    .input(CreateTranscriptionSchema)
    .mutation(async ({ input }) => {
      return await createTranscription(input);
    }),

  // Update transcription
  updateTranscription: procedure
    .input(
      z.object({
        id: z.number(),
        data: UpdateTranscriptionSchema,
      }),
    )
    .mutation(async ({ input }) => {
      return await updateTranscription(input.id, input.data);
    }),

  // Delete transcription
  deleteTranscription: procedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      // Get transcription to check for audio file
      const transcription = await getTranscriptionById(input.id);

      // Delete the transcription
      const result = await deleteTranscription(input.id);

      // Delete associated audio file if it exists
      if (transcription?.audioFile) {
        try {
          await deleteAudioFile(transcription.audioFile);
        } catch (error) {
          const logger = ctx.serviceManager.getLogger();
          logger.main.warn(
            "Failed to delete audio file during transcription deletion",
            {
              transcriptionId: input.id,
              audioFile: transcription.audioFile,
              error,
            },
          );
        }
      }

      return result;
    }),

  // Get audio file for playback
  getAudioFile: procedure
    .input(z.object({ transcriptionId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const transcription = await getTranscriptionById(input.transcriptionId);

      if (!transcription?.audioFile) {
        throw new Error("No audio file associated with this transcription");
      }

      try {
        await fs.promises.access(transcription.audioFile);
        const audioData = await fs.promises.readFile(transcription.audioFile);
        const filename = path.basename(transcription.audioFile);
        const ext = path.extname(transcription.audioFile).toLowerCase();
        let mimeType = "audio/wav";

        const mimeTypes: Record<string, string> = {
          ".wav": "audio/wav",
          ".mp3": "audio/mpeg",
          ".webm": "audio/webm",
          ".ogg": "audio/ogg",
          ".m4a": "audio/mp4",
          ".flac": "audio/flac",
        };

        if (ext in mimeTypes) {
          mimeType = mimeTypes[ext];
        }

        return {
          data: audioData.toString("base64"),
          filename,
          mimeType,
        };
      } catch (error) {
        const logger = ctx.serviceManager.getLogger();
        logger.main.error("Failed to read audio file", {
          transcriptionId: input.transcriptionId,
          audioFile: transcription.audioFile,
          error,
        });
        throw new Error("Audio file not found or inaccessible");
      }
    }),

  // Retry transcription using current model and settings
  retryTranscription: procedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const transcriptionService = ctx.serviceManager.getService(
        "transcriptionService",
      );
      return await transcriptionService.retryTranscription(input.id);
    }),

  // Report a transcription issue (telemetry only)
  reportTranscription: procedure
    .input(ReportTranscriptionSchema)
    .mutation(async ({ input, ctx }) => {
      const logger = ctx.serviceManager.getLogger();
      const telemetryService =
        ctx.serviceManager.getService("telemetryService");
      const transcription = await getTranscriptionById(input.transcriptionId);

      if (!transcription) {
        throw new Error("Transcription not found");
      }

      logger.main.info("Transcription report captured via telemetry", {
        transcriptionId: input.transcriptionId,
      });

      const speechModelForTelemetry =
        transcription.speechModel?.trim() || undefined;

      telemetryService.trackTranscriptionReported({
        transcription_id: transcription.id,
        feedback_text: input.feedbackText,
        feedback_length: input.feedbackText.length,
        ...(speechModelForTelemetry
          ? { speech_model: speechModelForTelemetry }
          : {}),
        language: transcription.language || undefined,
        report_channel: "history",
      });

      return { success: true };
    }),

  // Download audio file with save dialog
  downloadAudioFile: procedure
    .input(z.object({ transcriptionId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const transcription = await getTranscriptionById(input.transcriptionId);

      if (!transcription?.audioFile) {
        throw new Error("No audio file associated with this transcription");
      }

      try {
        const audioData = await fs.promises.readFile(transcription.audioFile);
        const filename = path.basename(transcription.audioFile);

        const result = await dialog.showSaveDialog({
          defaultPath: filename,
          filters: [
            { name: "WAV Audio", extensions: ["wav"] },
            { name: "All Files", extensions: ["*"] },
          ],
        });

        if (result.canceled || !result.filePath) {
          return { success: false, canceled: true };
        }

        await fs.promises.writeFile(result.filePath, audioData);

        const logger = ctx.serviceManager.getLogger();
        logger.main.info("Audio file downloaded", {
          transcriptionId: input.transcriptionId,
          savedTo: result.filePath,
          size: audioData.length,
        });

        return {
          success: true,
          filePath: result.filePath,
        };
      } catch (error) {
        const logger = ctx.serviceManager.getLogger();
        logger.main.error("Failed to download audio file", {
          transcriptionId: input.transcriptionId,
          audioFile: transcription.audioFile,
          error,
        });
        throw new Error("Failed to download audio file");
      }
    }),

  // Import and transcribe audio file (WAV, MP3, M4A, AAC, WEBM, OGG, FLAC) via PhoVoice
  importAndTranscribeAudioFile: procedure.mutation(async ({ ctx }) => {
    const logger = ctx.serviceManager.getLogger();

    // 1. Show Open File Dialog
    const result = await dialog.showOpenDialog({
      title: "Chọn tệp âm thanh để trích xuất văn bản (PhoVoice)",
      properties: ["openFile"],
      filters: [
        {
          name: "Audio Files (*.wav, *.mp3, *.m4a, *.aac, *.webm, *.ogg, *.flac)",
          extensions: ["wav", "mp3", "m4a", "aac", "webm", "ogg", "flac"],
        },
        { name: "All Files", extensions: ["*"] },
      ],
    });

    if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
      return { success: false, canceled: true };
    }

    const filePath = result.filePaths[0];
    const filename = path.basename(filePath);
    const fileBuffer = await fs.promises.readFile(filePath);

    const cfg = await resolvePhoVoiceConfig();

    logger.main.info("Importing and transcribing audio file with PhoVoice", {
      filename,
      baseURL: cfg.baseURL,
      model: cfg.model,
      size: fileBuffer.length,
    });

    const data = await callPhoVoiceTranscribe(
      fileBuffer,
      filename,
      { ...cfg, dualChannel: true },
      logger,
    );

    const extractedText = data.text || "";
    const duration = data.duration || 0;
    const isDualChannel =
      Boolean(data.dual_channel) ||
      Boolean(
        data.segments?.some(
          (s) => s.speaker === "you" || s.channel === 0 || s.source === "mic",
        ),
      );

    const meetingId = crypto.randomUUID();

    const mappedSegments = (data.segments || []).map((seg, idx) => {
      const isMic =
        seg.speaker === "you" ||
        seg.channel === 0 ||
        seg.source === "mic";
      const source = isMic ? ("mic" as const) : ("system" as const);
      const speaker = isMic ? ("you" as const) : ("them" as const);
      const speakerId = isMic ? "you" : (seg.speaker || "SPEAKER_00");
      const defaultLabel = isMic ? "Bạn (Mic)" : "Đối phương (Hệ thống)";
      const speakerLabel =
        seg.speaker_label ||
        (seg.speaker && seg.speaker !== "you" && seg.speaker !== "them"
          ? seg.speaker.replace("SPEAKER_", "Người ")
          : defaultLabel);

      return {
        id: crypto.randomUUID(),
        meetingId,
        source,
        speaker,
        speakerId,
        speakerLabel,
        text: seg.text,
        startTimeMs: Math.round(seg.start * 1000),
        endTimeMs: Math.round(seg.end * 1000),
        segmentOrder: idx,
        isFinal: true,
        confidence: (seg as any).confidence ?? 0.95,
      };
    });

    let noteFormattedText = extractedText;
    if (mappedSegments.length > 0) {
      noteFormattedText = mappedSegments
        .map((seg) => {
          const m = Math.floor(seg.startTimeMs / 60000);
          const s = Math.floor((seg.startTimeMs % 60000) / 1000);
          const timeStr = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
          return `**${seg.speakerLabel}** (${timeStr}): ${seg.text}`;
        })
        .join("\n\n");
    }

    // 4. Save to database
    await createTranscription({
      text: noteFormattedText,
      audioFile: filePath,
      language: data.language || "vi",
      speechModel: `PhoVoice (${cfg.model})`,
    });

    const cleanTitle = filename.replace(/\.[^/.]+$/, "");
    const note = await createNote({
      title: `🎙️ ${cleanTitle}`,
      content: noteFormattedText,
      audioFile: filePath,
    });

    // 5. Create Meeting Record and Structured Transcript Segments
    await db.insert(meetings).values({
      id: meetingId,
      noteId: note.id,
      title: note.title || `🎙️ ${cleanTitle}`,
      captureMode: isDualChannel ? "dual" : "system",
      state: "completed",
      transcriptionModel: `PhoVoice (${cfg.model})`,
      startedAt: new Date(),
      endedAt: new Date(),
      durationMs: Math.round(duration * 1000),
      createdAt: new Date(),
    });

    await db.insert(meetingArtifacts).values({
      id: crypto.randomUUID(),
      meetingId,
      artifactType: isDualChannel ? "system_wav" : "system_wav",
      path: filePath,
      sizeBytes: fs.existsSync(filePath) ? fs.statSync(filePath).size : null,
      createdAt: new Date(),
    });

    if (mappedSegments.length > 0) {
      await createTranscriptSegments(mappedSegments);
    } else if (extractedText) {
      await createTranscriptSegments([
        {
          id: crypto.randomUUID(),
          meetingId,
          source: "system" as const,
          speaker: "them" as const,
          speakerId: "SPEAKER_00",
          speakerLabel: "Đối phương (Hệ thống)",
          text: extractedText,
          startTimeMs: 0,
          endTimeMs: Math.round(duration * 1000),
          segmentOrder: 0,
          isFinal: true,
          confidence: 0.95,
        },
      ]);
    }

    if (noteFormattedText && noteFormattedText.trim().length > 0) {
      try {
        const update = markdownToYDocUpdate(noteFormattedText);
        await saveYjsUpdate(db, note.id, update);
      } catch (err) {
        logger.main.warn("Failed to generate Yjs document for note:", err);
      }
    }

    logger.main.info("Audio file transcription completed, meeting segments created and saved to Note", {
      noteId: note.id,
      meetingId,
      isDualChannel,
      textLength: noteFormattedText.length,
      model: cfg.model,
      segmentsCount: mappedSegments.length || 1,
    });

    return {
      success: true,
      noteId: note.id,
      title: note.title,
      duration,
      segmentsCount: mappedSegments.length || 1,
    };
  }),

  // Import dual separate audio files (Mic file + System audio file) with 100% channel separation
  importDualAudioFiles: procedure
    .input(
      z
        .object({
          micFilePath: z.string().optional(),
          systemFilePath: z.string().optional(),
        })
        .optional(),
    )
    .mutation(async ({ input, ctx }) => {
      const logger = ctx.serviceManager.getLogger();

      let micPath = input?.micFilePath;
      let systemPath = input?.systemFilePath;

      // 1. Pick mic file if not provided
      if (!micPath) {
        const micResult = await dialog.showOpenDialog({
          title: "Chọn tệp âm thanh Mic ngoài (Bạn nói)",
          properties: ["openFile"],
          filters: [
            {
              name: "Audio Files (*.wav, *.mp3, *.m4a, *.aac, *.webm, *.ogg, *.flac)",
              extensions: ["wav", "mp3", "m4a", "aac", "webm", "ogg", "flac"],
            },
            { name: "All Files", extensions: ["*"] },
          ],
        });
        if (micResult.canceled || !micResult.filePaths?.length) {
          return { success: false, canceled: true };
        }
        micPath = micResult.filePaths[0];
      }

      // 2. Pick system audio file if not provided
      if (!systemPath) {
        const sysResult = await dialog.showOpenDialog({
          title: "Chọn tệp âm thanh Mic Hệ thống (Đối phương / Loa)",
          properties: ["openFile"],
          filters: [
            {
              name: "Audio Files (*.wav, *.mp3, *.m4a, *.aac, *.webm, *.ogg, *.flac)",
              extensions: ["wav", "mp3", "m4a", "aac", "webm", "ogg", "flac"],
            },
            { name: "All Files", extensions: ["*"] },
          ],
        });
        if (sysResult.canceled || !sysResult.filePaths?.length) {
          return { success: false, canceled: true };
        }
        systemPath = sysResult.filePaths[0];
      }

      logger.main.info("Importing dual audio files with PhoVoice", {
        micPath,
        systemPath,
      });

      const [micBuffer, systemBuffer] = await Promise.all([
        fs.promises.readFile(micPath),
        fs.promises.readFile(systemPath),
      ]);

      const cfg = await resolvePhoVoiceConfig();

      // Transcribe both tracks concurrently with PhoVoice STT
      const [micData, sysData] = await Promise.all([
        callPhoVoiceTranscribe(
          micBuffer,
          path.basename(micPath),
          { ...cfg, dualChannel: false },
          logger,
        ),
        callPhoVoiceTranscribe(
          systemBuffer,
          path.basename(systemPath),
          { ...cfg, dualChannel: false },
          logger,
        ),
      ]);

      const meetingId = crypto.randomUUID();
      const maxDuration = Math.max(micData.duration || 0, sysData.duration || 0);

      // Map mic segments (Track 0)
      const micSegments = (micData.segments && micData.segments.length > 0
        ? micData.segments
        : (micData.text?.trim()
            ? [{ start: 0, end: micData.duration || 1, text: micData.text, confidence: 0.95 }]
            : [])
      ).map((seg) => ({
        id: crypto.randomUUID(),
        meetingId,
        source: "mic" as const,
        speaker: "you" as const,
        speakerId: "you",
        speakerLabel: "Bạn (Mic)",
        text: seg.text,
        startTimeMs: Math.round(seg.start * 1000),
        endTimeMs: Math.round(seg.end * 1000),
        segmentOrder: 0,
        isFinal: true,
        confidence: (seg as any).confidence ?? 0.95,
      }));

      // Map system audio segments (Track 1)
      const sysSegments = (sysData.segments && sysData.segments.length > 0
        ? sysData.segments
        : (sysData.text?.trim()
            ? [{ start: 0, end: sysData.duration || 1, text: sysData.text, confidence: 0.95 }]
            : [])
      ).map((seg) => ({
        id: crypto.randomUUID(),
        meetingId,
        source: "system" as const,
        speaker: "them" as const,
        speakerId: "them",
        speakerLabel: "Đối phương (Hệ thống)",
        text: seg.text,
        startTimeMs: Math.round(seg.start * 1000),
        endTimeMs: Math.round(seg.end * 1000),
        segmentOrder: 0,
        isFinal: true,
        confidence: (seg as any).confidence ?? 0.95,
      }));

      // Merge and sort strictly by startTimeMs
      const mergedSegments = [...micSegments, ...sysSegments].sort(
        (a, b) => a.startTimeMs - b.startTimeMs,
      );
      mergedSegments.forEach((seg, idx) => {
        seg.segmentOrder = idx;
      });

      const noteFormattedText = mergedSegments
        .map((seg) => {
          const m = Math.floor(seg.startTimeMs / 60000);
          const s = Math.floor((seg.startTimeMs % 60000) / 1000);
          const timeStr = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
          return `**${seg.speakerLabel}** (${timeStr}): ${seg.text}`;
        })
        .join("\n\n");

      const cleanTitle = path.basename(micPath).replace(/\.[^/.]+$/, "");
      const note = await createNote({
        title: `🎙️ [Dual Track] ${cleanTitle}`,
        content: noteFormattedText,
        audioFile: micPath,
      });

      await db.insert(meetings).values({
        id: meetingId,
        noteId: note.id,
        title: note.title || `🎙️ [Dual Track] ${cleanTitle}`,
        captureMode: "dual",
        state: "completed",
        transcriptionModel: `PhoVoice (${cfg.model})`,
        startedAt: new Date(),
        endedAt: new Date(),
        durationMs: Math.round(maxDuration * 1000),
        createdAt: new Date(),
      });

      // Insert both artifacts so audio player can play either or both
      await db.insert(meetingArtifacts).values([
        {
          id: crypto.randomUUID(),
          meetingId,
          artifactType: "mic_wav",
          path: micPath,
          sizeBytes: fs.existsSync(micPath) ? fs.statSync(micPath).size : null,
          createdAt: new Date(),
        },
        {
          id: crypto.randomUUID(),
          meetingId,
          artifactType: "system_wav",
          path: systemPath,
          sizeBytes: fs.existsSync(systemPath) ? fs.statSync(systemPath).size : null,
          createdAt: new Date(),
        },
      ]);

      if (mergedSegments.length > 0) {
        await createTranscriptSegments(mergedSegments);
      }

      if (noteFormattedText && noteFormattedText.trim().length > 0) {
        try {
          const update = markdownToYDocUpdate(noteFormattedText);
          await saveYjsUpdate(db, note.id, update);
        } catch (err) {
          logger.main.warn("Failed to generate Yjs document for dual note:", err);
        }
      }

      logger.main.info("Dual audio files transcription completed", {
        noteId: note.id,
        meetingId,
        segmentsCount: mergedSegments.length,
      });

      return {
        success: true,
        noteId: note.id,
        meetingId,
        title: note.title,
        duration: maxDuration,
        segmentsCount: mergedSegments.length,
      };
    }),

  // Get audio data URL for in-app audio playback
  getAudioDataUrl: procedure
    .input(
      z.object({
        noteId: z.number().optional(),
        filePath: z.string().optional(),
      }),
    )
    .query(async ({ input }) => {
      let targetPath = input.filePath;

      // 1. Check note.audioFile in DB
      if (!targetPath && input.noteId) {
        const [note] = await db
          .select({ audioFile: notes.audioFile })
          .from(notes)
          .where(eq(notes.id, input.noteId))
          .limit(1);
        if (note?.audioFile && fs.existsSync(note.audioFile)) {
          targetPath = note.audioFile;
        }
      }

      // 2. Check meeting artifacts in DB
      if (!targetPath && input.noteId) {
        const artifacts = await getNoteAudioArtifacts(input.noteId);
        const priorityOrder = ["mic_processed_wav", "mic_wav", "system_wav"];
        for (const p of priorityOrder) {
          const found = artifacts.find(
            (a) => a.artifactType === p && fs.existsSync(a.path),
          );
          if (found) {
            targetPath = found.path;
            break;
          }
        }
        if (!targetPath && artifacts.length > 0) {
          const found = artifacts.find((a) => fs.existsSync(a.path));
          if (found) targetPath = found.path;
        }
      }

      // 3. Check meetings storage directory
      if (!targetPath && input.noteId) {
        const noteMeetings = await db
          .select({ id: meetings.id })
          .from(meetings)
          .where(eq(meetings.noteId, input.noteId));

        const settings = await getAppSettings();
        const storageBase =
          (settings as any).audioStoragePath ||
          path.join(app.getPath("userData"), "meetings");

        for (const m of noteMeetings) {
          const meetingDir = path.join(storageBase, m.id);
          for (const cand of [
            "mic_processed.wav",
            "mic.wav",
            "system.wav",
            "audio.wav",
          ]) {
            const p = path.join(meetingDir, cand);
            if (fs.existsSync(p)) {
              targetPath = p;
              break;
            }
          }
          if (targetPath) break;
        }
      }

      if (targetPath && fs.existsSync(targetPath)) {
        try {
          const buf = await fs.promises.readFile(targetPath);
          const ext = path.extname(targetPath).toLowerCase().replace(".", "");
          const mime =
            ext === "mp3"
              ? "audio/mpeg"
              : ext === "m4a"
                ? "audio/mp4"
                : ext === "ogg"
                  ? "audio/ogg"
                  : ext === "flac"
                    ? "audio/flac"
                    : "audio/wav";
          return {
            dataUrl: `data:${mime};base64,${buf.toString("base64")}`,
            fileName: path.basename(targetPath),
            sizeBytes: buf.length,
          };
        } catch {
          return null;
        }
      }
      return null;
    }),
});
