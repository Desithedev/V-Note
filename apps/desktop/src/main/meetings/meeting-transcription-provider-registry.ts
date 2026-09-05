import type { TranscriptionProvider } from "@/pipeline/core/pipeline-types";
import { WhisperProvider } from "@/pipeline/providers/transcription/whisper-provider";
import { PhoVoiceProvider } from "@/pipeline/providers/transcription/phovoice-provider";
import type { ModelService } from "@/services/model-service";
import { getAppSettings } from "@/db/app-settings";
import { getInstanceById, getInstancesByProvider } from "@/db/instances";
import { PROVIDER_TYPES } from "@/constants/provider-types";
import type { PhoVoiceConfig } from "@/db/schema";

export const MEETING_TRANSCRIPTION_PROVIDER_TYPES = {
  localWhisper: "local-whisper",
  phovoice: "phovoice",
} as const;

export type MeetingTranscriptionProviderType =
  (typeof MEETING_TRANSCRIPTION_PROVIDER_TYPES)[keyof typeof MEETING_TRANSCRIPTION_PROVIDER_TYPES];

export type MeetingTranscriptionTransport = "local" | "remote";

export interface MeetingTranscriptionSelection {
  providerType: MeetingTranscriptionProviderType;
  transport: MeetingTranscriptionTransport;
  modelId: string | null;
  modelName: string;
}

interface MeetingTranscriptionProviderFactory {
  createProvider(modelService: ModelService): Promise<TranscriptionProvider>;
}

const registry: Record<
  MeetingTranscriptionProviderType,
  MeetingTranscriptionProviderFactory
> = {
  [MEETING_TRANSCRIPTION_PROVIDER_TYPES.localWhisper]: {
    async createProvider(modelService) {
      return new WhisperProvider(modelService);
    },
  },
  [MEETING_TRANSCRIPTION_PROVIDER_TYPES.phovoice]: {
    async createProvider() {
      const settings = await getAppSettings();
      const transcriptionDefault = settings.modelDefaults?.transcription;
      let baseURL = "http://127.0.0.1:8000";
      let apiKey = "";
      let mode: "cloud" | "local" = "local";
      if (transcriptionDefault?.instanceId) {
        const instance = await getInstanceById(transcriptionDefault.instanceId);
        if (instance && instance.provider === PROVIDER_TYPES.phovoice) {
          const cfg = instance.config as PhoVoiceConfig;
          baseURL = cfg.baseURL || baseURL;
          apiKey = cfg.apiKey || apiKey;
          mode = cfg.mode || mode;
        }
      } else {
        const phovoiceInstances = await getInstancesByProvider(PROVIDER_TYPES.phovoice);
        if (phovoiceInstances.length > 0) {
          const cfg = phovoiceInstances[0].config as PhoVoiceConfig;
          baseURL = cfg.baseURL || baseURL;
          apiKey = cfg.apiKey || apiKey;
          mode = cfg.mode || mode;
        }
      }
      return new PhoVoiceProvider({
        baseURL,
        apiKey,
        mode,
        model: transcriptionDefault?.modelId || "68M",
      });
    },
  },
};

export async function resolveMeetingTranscriptionSelection(
  modelService: ModelService,
): Promise<MeetingTranscriptionSelection> {
  try {
    const settings = await getAppSettings();
    const transcriptionDefault = settings.modelDefaults?.transcription;
    if (transcriptionDefault?.instanceId) {
      const instance = await getInstanceById(transcriptionDefault.instanceId);
      if (instance && instance.provider === PROVIDER_TYPES.phovoice) {
        return {
          providerType: MEETING_TRANSCRIPTION_PROVIDER_TYPES.phovoice,
          transport: "remote",
          modelId: transcriptionDefault.modelId || "68M",
          modelName: `PhoVoice (${transcriptionDefault.modelId || "Zipformer 68M"})`,
        };
      }
    }
    const phovoiceInstances = await getInstancesByProvider(PROVIDER_TYPES.phovoice);
    if (phovoiceInstances.length > 0) {
      return {
        providerType: MEETING_TRANSCRIPTION_PROVIDER_TYPES.phovoice,
        transport: "remote",
        modelId: "68M",
        modelName: "PhoVoice (Zipformer 68M)",
      };
    }
  } catch {
    // fallback
  }

  const selectedModelId = await modelService.getSelectedModel();
  return {
    providerType: MEETING_TRANSCRIPTION_PROVIDER_TYPES.localWhisper,
    transport: "local",
    modelId: selectedModelId,
    modelName: "Local Whisper",
  };
}

export async function createMeetingTranscriptionProvider(
  modelService: ModelService,
): Promise<{
  provider: TranscriptionProvider;
  selection: MeetingTranscriptionSelection;
}> {
  const selection = await resolveMeetingTranscriptionSelection(modelService);
  const provider =
    await registry[selection.providerType].createProvider(modelService);

  return {
    provider,
    selection,
  };
}
