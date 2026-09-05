import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { api, trpcClient } from "@/trpc/react";
import { combinedLevel, useMeetingLevel } from "@/hooks/useMeetingLevel";
import { TooltipProvider } from "@/components/ui/tooltip";
import type {
  MeetingTranscriptFontSize,
  MeetingTranscriptMode,
  MeetingWidgetEdge,
  MeetingWidgetState,
} from "@/types/meeting-widget";
import type { AudioSource } from "@/types/meeting";
import { IdlePill } from "./idle-pill";
import { DetectionPill } from "./detection-pill";
import { RecordingPill } from "./recording-pill";
import "@/styles/globals.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, refetchOnWindowFocus: false },
  },
});

type DragState = { pointerOffsetX: number; pointerOffsetY: number };

function RecordingWidgetWindow() {
  const initialStateQuery = api.meetingWidget.getState.useQuery();
  const [liveState, setLiveState] = useState<MeetingWidgetState | null>(null);
  const [isHovered, setIsHovered] = useState(false);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const interactiveRef = useRef(false);

  api.meetingWidget.stateUpdates.useSubscription(undefined, {
    onData: (nextState) => setLiveState(nextState),
  });

  const meetingLevels = useMeetingLevel();
  const waveformLevel = combinedLevel(meetingLevels);

  const startNoteFromIdleMutation = api.meetingWidget.startNoteFromIdle.useMutation();
  const startRecordingForNoteMutation = api.meetingWidget.startRecordingForNote.useMutation();
  const startNoteFromDetectionMutation =
    api.meetingWidget.startNoteFromDetection.useMutation();
  const dismissDetectionMutation = api.meetingWidget.dismissDetection.useMutation();
  const createBlankNoteMutation = api.meetingWidget.createBlankNote.useMutation();
  const updateWidgetSettingsMutation =
    api.settings.updateMeetingWidgetSettings.useMutation();
  const utils = api.useUtils();
  const setSourceMutedMutation = api.meetings.setSourceMuted.useMutation({
    onSuccess: (next) => setLiveState((current) => current ? { ...current, mutedSources: next.mutedSources } : current),
  });

  const state = liveState ?? initialStateQuery.data ?? null;
  const widgetVisible = state?.visible ?? false;
  const meetingState = state?.meetingState ?? "idle";
  const meetingDetection = state?.meetingDetection ?? null;
  const currentNoteId = state?.noteId ?? null;
  const edge: MeetingWidgetEdge = state?.edge ?? "right";
  const showTranscript = state?.showTranscript ?? true;
  const transcriptMode: MeetingTranscriptMode = state?.transcriptMode ?? "full";
  const transcriptFontSize: MeetingTranscriptFontSize =
    state?.transcriptFontSize ?? "sm";

  const isRecording =
    meetingState === "recording" ||
    meetingState === "starting" ||
    meetingState === "stopping" ||
    meetingState === "error";
  const isDetection = !isRecording && meetingDetection !== null;

  const isInteractive = isHovered || dragState !== null;

  const syncInteractive = useCallback((nextInteractive: boolean) => {
    if (interactiveRef.current === nextInteractive) {
      return;
    }
    interactiveRef.current = nextInteractive;
    void window.electronAPI.recordingWidget.setInteractive(nextInteractive);
  }, []);

  useEffect(() => {
    if (!widgetVisible && dragState === null) {
      syncInteractive(false);
    }
  }, [dragState, syncInteractive, widgetVisible]);

  useEffect(() => {
    syncInteractive(isInteractive);
  }, [isInteractive, syncInteractive]);

  useEffect(() => {
    if (!dragState) {
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      void window.electronAPI.recordingWidget.dragMove(
        event.screenX,
        event.screenY,
        dragState.pointerOffsetX,
        dragState.pointerOffsetY,
      );
    };

    const handlePointerUp = (event: PointerEvent) => {
      void window.electronAPI.recordingWidget.dragEnd(
        event.screenX,
        event.screenY,
        dragState.pointerOffsetX,
        dragState.pointerOffsetY,
      );
      setDragState(null);
      setIsHovered(false);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [dragState]);

  const handleMouseMove = useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      const target = event.target as HTMLElement | null;
      const nextHovered = !!target?.closest("[data-hit-zone='true']");
      setIsHovered(nextHovered);
    },
    [],
  );

  const handleMouseLeave = useCallback(() => {
    if (!dragState) {
      setIsHovered(false);
    }
  }, [dragState]);

  const handleDragStart = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      setDragState({
        pointerOffsetX: event.clientX,
        pointerOffsetY: event.clientY,
      });
      setIsHovered(true);
    },
    [],
  );

  const handleStop = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      void window.electronAPI.recordingWidget.stopMeeting();
    },
    [],
  );

  const handleOpenNote = useCallback(() => {
    void window.electronAPI.recordingWidget.openNote({
      noteId: currentNoteId,
      openTranscription: isRecording && currentNoteId !== null,
    });
  }, [currentNoteId, isRecording]);

  const handleStartRecording = useCallback(() => {
    startNoteFromIdleMutation.mutate();
  }, [startNoteFromIdleMutation]);

  const handleStartRecordingForNote = useCallback((noteId: number) => {
    startRecordingForNoteMutation.mutate({ noteId });
  }, [startRecordingForNoteMutation]);

  const handleTakeNotes = useCallback(() => {
    createBlankNoteMutation.mutate();
  }, [createBlankNoteMutation]);

  const handleTakeNotesDetection = useCallback(() => {
    startNoteFromDetectionMutation.mutate();
  }, [startNoteFromDetectionMutation]);

  const handleDismissDetection = useCallback(() => {
    dismissDetectionMutation.mutate();
  }, [dismissDetectionMutation]);

  const handleShowTranscriptChange = useCallback(
    (nextShow: boolean) => {
      updateWidgetSettingsMutation.mutate(
        { showTranscript: nextShow },
        { onSuccess: () => utils.settings.getMeetingWidgetSettings.invalidate() },
      );
    },
    [updateWidgetSettingsMutation, utils],
  );

  const handleTranscriptModeChange = useCallback(
    (nextMode: MeetingTranscriptMode) => {
      updateWidgetSettingsMutation.mutate(
        { transcriptMode: nextMode },
        { onSuccess: () => utils.settings.getMeetingWidgetSettings.invalidate() },
      );
    },
    [updateWidgetSettingsMutation, utils],
  );

  const handleTranscriptFontSizeChange = useCallback(
    (nextFontSize: MeetingTranscriptFontSize) => {
      updateWidgetSettingsMutation.mutate(
        { transcriptFontSize: nextFontSize },
        { onSuccess: () => utils.settings.getMeetingWidgetSettings.invalidate() },
      );
    },
    [updateWidgetSettingsMutation, utils],
  );

  const handleToggleSourceMute = useCallback((source: AudioSource) => {
    const muted = !(state?.mutedSources?.[source] ?? false);
    setSourceMutedMutation.mutate({ source, muted });
  }, [setSourceMutedMutation, state?.mutedSources]);

  // While recording, the widget rests in its expanded layout (Open Note +
  // waveform anchor + drag handle), so the handle is always visible.
  // Idle keeps the original hover-to-reveal behavior.
  const showHandle = isRecording || isHovered || dragState !== null;

  // Outer container anchors the pill's 36×36 frame to the active edge.
  // Each pill owns its own absolutely-positioned drag handle + secondary
  // button around that frame, so no inner-flex / layout-shift dance.
  const outerJustify =
    edge === "right"
      ? "items-center justify-end pr-1"
      : "items-end justify-center pb-1";

  return (
    <main
      className="h-screen w-screen bg-transparent"
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      <div className={`flex h-full w-full ${outerJustify}`}>
        <motion.div
          initial={false}
          animate={widgetVisible ? { opacity: 1 } : { opacity: 0 }}
          transition={{ type: "spring", stiffness: 280, damping: 26, mass: 0.7 }}
        >
          <AnimatePresence mode="wait" initial={false}>
            {isRecording ? (
              <RecordingPill
                key="recording"
                edge={edge}
                noteId={currentNoteId}
                showTranscript={showTranscript}
                transcriptMode={transcriptMode}
                transcriptFontSize={transcriptFontSize}
                mutedSources={state?.mutedSources ?? { mic: false, system: false }}
                onToggleSourceMute={handleToggleSourceMute}
                meetingState={meetingState}
                level={waveformLevel}
                onStop={handleStop}
                onOpenNote={handleOpenNote}
                onShowTranscriptChange={handleShowTranscriptChange}
                onTranscriptModeChange={handleTranscriptModeChange}
                onTranscriptFontSizeChange={handleTranscriptFontSizeChange}
                showHandle={showHandle}
                onDragStart={handleDragStart}
              />
            ) : isDetection && meetingDetection ? (
              <DetectionPill
                key="detection"
                payload={meetingDetection}
                onTakeNotes={handleTakeNotesDetection}
                onDismiss={handleDismissDetection}
                takingNotes={startNoteFromDetectionMutation.isPending}
                dismissing={dismissDetectionMutation.isPending}
              />
            ) : (
              <IdlePill
                key="idle"
                edge={edge}
                hovered={isHovered || dragState !== null}
                onTakeNotes={handleTakeNotes}
                takingNotes={createBlankNoteMutation.isPending}
                onStartRecording={handleStartRecording}
                onStartRecordingForNote={handleStartRecordingForNote}
                startingRecording={startNoteFromIdleMutation.isPending}
                showHandle={showHandle}
                onDragStart={handleDragStart}
              />
            )}
          </AnimatePresence>
        </motion.div>
      </div>
    </main>
  );
}

const container = document.getElementById("root");
if (container) {
  createRoot(container).render(
    <api.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider delayDuration={200}>
          <RecordingWidgetWindow />
        </TooltipProvider>
      </QueryClientProvider>
    </api.Provider>,
  );
}
