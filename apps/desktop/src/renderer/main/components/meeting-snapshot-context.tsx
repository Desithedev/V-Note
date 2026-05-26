import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api } from "@/trpc/react";
import type { MeetingRuntimeSnapshot } from "@/types/meeting";

const EMPTY_SNAPSHOT: MeetingRuntimeSnapshot = {
  state: "idle",
  mode: null,
  meetingId: null,
  noteId: null,
  durationMs: 0,
  startedAt: null,
};

type MeetingSnapshotContextValue = {
  snapshot: MeetingRuntimeSnapshot;
  // True once the query OR subscription has delivered at least one value, so
  // callers know the snapshot reflects the backend rather than the default
  // EMPTY_SNAPSHOT. Programmatic starts (autoRecord, detection-driven flows)
  // should wait for this before firing a mutation, otherwise they can race
  // the first paint and dispatch into an already-active session.
  hydrated: boolean;
};

const EMPTY_VALUE: MeetingSnapshotContextValue = {
  snapshot: EMPTY_SNAPSHOT,
  hydrated: false,
};

const MeetingSnapshotContext =
  createContext<MeetingSnapshotContextValue>(EMPTY_VALUE);

export function MeetingSnapshotProvider({ children }: { children: ReactNode }) {
  // Hydrate with a query so we don't render `idle` while the manager is
  // actually recording — the subscription is the source of truth once it
  // delivers a value, but if it drops, races a renderer remount, or otherwise
  // misses the seed emit, the query keeps the dock honest. Mirrors the
  // floating widget's pattern (recording-widget/index.tsx).
  const utils = api.useUtils();
  const initialQuery = api.meetings.getMeetingState.useQuery();
  const [liveSnapshot, setLiveSnapshot] =
    useState<MeetingRuntimeSnapshot | null>(null);

  api.meetings.stateUpdates.useSubscription(undefined, {
    onData: (next) => setLiveSnapshot(next),
    onError: (error) => {
      // Clear the live snapshot so we fall back to a fresh query result
      // instead of serving the last value the dead subscription delivered —
      // which could be arbitrarily stale by the time the user reads it.
      console.error("MeetingSnapshotProvider subscription error:", error);
      setLiveSnapshot(null);
      void utils.meetings.getMeetingState.invalidate();
    },
  });

  const snapshot = liveSnapshot ?? initialQuery.data ?? EMPTY_SNAPSHOT;
  // While the query is in flight (initial load OR a post-error refetch
  // triggered above), treat the provider as un-hydrated even if the cache
  // still holds a previous result — otherwise we'd serve potentially-stale
  // query data with hydrated: true and reopen the race the subscription
  // error was supposed to close.
  const hydrated =
    liveSnapshot !== null ||
    (initialQuery.isSuccess && !initialQuery.isFetching);

  const value = useMemo<MeetingSnapshotContextValue>(
    () => ({ snapshot, hydrated }),
    [snapshot, hydrated],
  );

  return (
    <MeetingSnapshotContext.Provider value={value}>
      {children}
    </MeetingSnapshotContext.Provider>
  );
}

// Returns the most recent meeting runtime snapshot. Defaults to an idle empty
// snapshot before the first emission. Consumers should check `state` for
// "idle" rather than relying on null fields.
export function useMeetingSnapshot(): MeetingRuntimeSnapshot {
  return useContext(MeetingSnapshotContext).snapshot;
}

// True once we've received at least one snapshot from the backend. Gate
// programmatic starts on this to avoid racing the EMPTY_SNAPSHOT default.
export function useMeetingSnapshotHydrated(): boolean {
  return useContext(MeetingSnapshotContext).hydrated;
}
