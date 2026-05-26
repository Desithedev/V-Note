// @vitest-environment happy-dom

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The dock pulls in skill-sparkle-button (which talks to tRPC) only when a
// noteId is passed. All tests below omit noteId, so the sparkle branch is
// skipped at render time — but the module is still statically imported.
// Stub it out to avoid Vite eagerly walking into the renderer's tRPC client
// at transform time (the same pattern used by skill-sparkle-button.test.tsx).
vi.mock(
  "../../src/renderer/main/pages/notes/components/skill-sparkle-button",
  () => ({
    SkillSparkleButton: () => null,
  }),
);

async function renderDock(
  meetingState: "idle" | "recording",
  extra: Record<string, unknown> = {},
) {
  const { NoteRecordingDock } = await import(
    "../../src/renderer/main/pages/notes/components/note-recording-dock"
  );
  const html = renderToStaticMarkup(
    React.createElement(NoteRecordingDock, {
      meetingState,
      level: 0,
      onStartMeeting: () => {},
      onStopMeeting: () => {},
      ...extra,
    }),
  );
  // happy-dom's DOMParser turns the SSR string into a queryable Document
  // without needing innerHTML.
  return new DOMParser().parseFromString(html, "text/html");
}

describe("NoteRecordingDock accessibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("inerts the recording controls when idle so Stop is not in the AX tree", async () => {
    const doc = await renderDock("idle");

    const stopBtn = doc.querySelector('[aria-label="Stop recording"]');
    const startBtn = doc.querySelector('[aria-label="Start recording"]');
    expect(stopBtn).not.toBeNull();
    expect(startBtn).not.toBeNull();

    // Stop sits inside the inactive (recording-controls) container, which
    // must be inert + aria-hidden in idle. Start sits inside the active
    // (idle-controls) container, which must NOT be inert.
    expect(stopBtn!.closest("[inert]")).not.toBeNull();
    expect(stopBtn!.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(startBtn!.closest("[inert]")).toBeNull();
    expect(startBtn!.closest('[aria-hidden="true"]')).toBeNull();
  });

  it("inerts the idle controls when recording so Start is not in the AX tree", async () => {
    const doc = await renderDock("recording");

    const stopBtn = doc.querySelector('[aria-label="Stop recording"]');
    const startBtn = doc.querySelector('[aria-label="Start recording"]');
    expect(stopBtn).not.toBeNull();
    expect(startBtn).not.toBeNull();

    expect(startBtn!.closest("[inert]")).not.toBeNull();
    expect(startBtn!.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(stopBtn!.closest("[inert]")).toBeNull();
    expect(stopBtn!.closest('[aria-hidden="true"]')).toBeNull();
  });

  it("inerts the Show transcription chevron when recording", async () => {
    const doc = await renderDock("recording", {
      onToggleTranscription: () => {},
      isTranscriptionOpen: false,
    });

    const toggleBtn = doc.querySelector(
      '[aria-label="Show transcription"]',
    );
    expect(toggleBtn).not.toBeNull();
    expect(toggleBtn!.closest("[inert]")).not.toBeNull();
  });
});
