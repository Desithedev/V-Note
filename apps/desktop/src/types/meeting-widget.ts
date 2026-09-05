import type { AudioSource, MeetingRuntimeState } from "./meeting";
import type { MeetingStartNotificationPayload } from "./meeting-start-notifications";

export type MeetingWidgetVisibility = "never" | "while-recording" | "always";
export type MeetingWidgetEdge = "right" | "bottom";
export type MeetingTranscriptMode = "full" | "caption";
export type MeetingTranscriptFontSize = "sm" | "md" | "lg";

export interface MeetingWidgetState {
  visibility: MeetingWidgetVisibility;
  visible: boolean;
  meetingState: MeetingRuntimeState;
  noteId: number | null;
  meetingDetection: MeetingStartNotificationPayload | null;
  edge: MeetingWidgetEdge;
  showTranscript: boolean;
  transcriptMode: MeetingTranscriptMode;
  transcriptFontSize: MeetingTranscriptFontSize;
  mutedSources: Record<AudioSource, boolean>;
}
