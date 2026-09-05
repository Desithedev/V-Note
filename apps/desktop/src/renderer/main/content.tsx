import React, { useEffect } from "react";
import {
  RouterProvider,
  createRouter,
  createHashHistory,
} from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { requestOpenTranscription } from "./utils/transcription-request";

const hashHistory = createHashHistory();

// Create the router instance
const router = createRouter({
  routeTree,
  defaultPreload: "intent",
  history: hashHistory,
});

// Register the router instance for type safety
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

// Root App component with routing
const App: React.FC = () => {
  // Listen for navigation events from the main process (e.g., overlays)
  useEffect(() => {
    const handleNavigate = (route: string) => {
      router.navigate({ to: route });
    };

    // Typed navigation to a note. The "open transcription" signal goes via
    // `requestOpenTranscription` (pending set + DOM event) so it works for
    // both same-note re-triggers (event picked up by an already-mounted
    // listener) and cross-note navigations (new wrapper drains the pending
    // set on mount, even if the event fires before its listener registers).
    const handleNavigateToNote = (payload: {
      noteId: number;
      openTranscription?: boolean;
    }) => {
      if (payload.openTranscription) {
        requestOpenTranscription(payload.noteId);
      }
      router.navigate({
        to: "/notes/$noteId",
        params: { noteId: String(payload.noteId) },
      });
    };

    window.electronAPI?.on?.("navigate", handleNavigate);
    window.electronAPI?.on?.("navigate-to-note", handleNavigateToNote);

    const handleKeyDown = (e: KeyboardEvent) => {
      // Check for Ctrl+Alt+R or Ctrl+Shift+R or F9
      const isCtrlAltR = (e.ctrlKey || e.metaKey) && e.altKey && (e.key === "r" || e.key === "R");
      const isCtrlShiftR = (e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "r" || e.key === "R");
      const isF9 = e.key === "F9";

      if (isCtrlAltR || isCtrlShiftR || isF9) {
        e.preventDefault();
        import("@/trpc/react").then(async ({ trpcClient }) => {
          try {
            const state = await trpcClient.meetings.getMeetingState.query();
            if (state && (state.state === "recording" || state.state === "starting")) {
              await trpcClient.meetings.stopMeeting.mutate();
            } else {
              await trpcClient.meetingWidget.startNoteFromIdle.mutate();
            }
          } catch (err) {
            console.error("Failed to toggle meeting from shortcut", err);
          }
        });
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.electronAPI?.off?.("navigate", handleNavigate);
      window.electronAPI?.off?.("navigate-to-note", handleNavigateToNote);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  return <RouterProvider router={router} />;
};

export default App;
