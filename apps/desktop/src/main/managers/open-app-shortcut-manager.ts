import { app, globalShortcut } from "electron";
import type { SettingsService } from "@/services/settings-service";
import type { WindowManager } from "../core/window-manager";
import type { MeetingManager } from "./meeting-manager";
import { createNote } from "@/db/notes";
import { logger } from "../logger";
import { keycodesToAccelerator } from "@/utils/keycodes-to-accelerator";

const log = logger.main;

/**
 * Registers global shortcuts via Electron's globalShortcut module:
 * 1. "Open V-Note": Brings main app window forward or toggles it.
 * 2. "Quick Record New Note": Automatically creates a new note, starts dual recording,
 *    and displays the floating popup pill widget on top across all apps (Zen Browser, YouTube, etc.).
 */
export class OpenAppShortcutManager {
  private registeredAccelerator: string | null = null;
  private registeredRecordingAccelerators: string[] = [];

  constructor(
    private settingsService: SettingsService,
    private windowManager: WindowManager,
    private meetingManager?: MeetingManager | null,
  ) {}

  async initialize(): Promise<void> {
    await app.whenReady();
    await this.reload();
  }

  async reload(): Promise<void> {
    this.unregister();

    const shortcuts = await this.settingsService.getShortcuts();

    // 1. Register "Open App" Shortcut
    const keys = shortcuts.openApp;
    if (keys && keys.length > 0) {
      const accelerator = keycodesToAccelerator(keys);
      if (accelerator) {
        const ok = globalShortcut.register(accelerator, () => {
          this.toggleMainWindow().catch((err) =>
            log.error("Failed to toggle main window from shortcut", { err }),
          );
        });

        if (ok) {
          this.registeredAccelerator = accelerator;
          log.info("openApp shortcut registered", { accelerator });
        } else {
          log.warn("openApp shortcut could not be registered (already in use)", {
            accelerator,
          });
        }
      }
    }

    // 2. Register "Quick Record New Note & Show Floating Widget" Shortcuts
    const recKeys = shortcuts.toggleRecording;
    const configuredRec =
      recKeys && recKeys.length > 0
        ? keycodesToAccelerator(recKeys)
        : null;

    const candidates = [
      configuredRec,
      "CommandOrControl+Alt+R",
      "CommandOrControl+Shift+R",
      "F9",
    ].filter(Boolean) as string[];

    this.registeredRecordingAccelerators = [];
    for (const acc of candidates) {
      try {
        if (!globalShortcut.isRegistered(acc)) {
          const recOk = globalShortcut.register(acc, () => {
            this.toggleQuickRecordingNote().catch((err) =>
              log.error("Failed to toggle quick recording note from shortcut", {
                err,
              }),
            );
          });

          if (recOk) {
            this.registeredRecordingAccelerators.push(acc);
            log.info(`[QuickRecord] Shortcut registered: ${acc}`);
          }
        }
      } catch (err) {
        log.warn(`Could not register shortcut ${acc}: ${err}`);
      }
    }
  }

  /**
   * Toggle quick recording:
   * - If currently recording -> Stop recording.
   * - If idle -> Create a new note with timestamp title, start dual audio capture,
   *   and show the floating popup pill widget on top across all apps.
   */
  private async toggleQuickRecordingNote(): Promise<void> {
    if (!this.meetingManager) {
      log.warn("Cannot toggle quick recording: meetingManager not attached");
      return;
    }

    const state = this.meetingManager.getState();
    if (state.state === "recording" || state.state === "starting") {
      log.info("[QuickRecord] Stopping recording from global shortcut");
      await this.meetingManager.stop();
      return;
    }

    log.info("[QuickRecord] Creating new note & starting recording from global shortcut");
    const now = new Date();
    const day = now.getDate();
    const month = now.getMonth() + 1;
    const hours = String(now.getHours()).padStart(2, "0");
    const minutes = String(now.getMinutes()).padStart(2, "0");
    const title = `Ghi chú - ${day} thg ${month} (${hours}:${minutes})`;

    try {
      const newNote = await createNote({ title });
      if (newNote) {
        await this.meetingManager.start(newNote.id, "dual");
        // The widget manager handles showing the window in response to
        // the meeting state change, so no direct windowManager call is
        // needed here. Calling it directly would bypass popup bounds
        // tracking and could show the widget at the wrong size.
        log.info(`[QuickRecord] Note #${newNote.id} created and recording started with floating popup`);
      }
    } catch (err) {
      log.error("[QuickRecord] Failed to start quick recording session", { err });
    }
  }

  /**
   * Temporarily unregister the global shortcut so the user can rebind it
   * from the Shortcuts settings page.
   */
  suspend(): void {
    this.unregister();
  }

  private async toggleMainWindow(): Promise<void> {
    const mainWindow = this.windowManager.getMainWindow();

    if (!mainWindow || mainWindow.isDestroyed()) {
      await this.windowManager.createOrShowMainWindow();
      return;
    }

    if (mainWindow.isMinimized()) {
      mainWindow.restore();
      mainWindow.focus();
      return;
    }

    if (mainWindow.isVisible() && mainWindow.isFocused()) {
      if (process.platform === "darwin") {
        app.hide();
      } else {
        mainWindow.minimize();
      }
      return;
    }

    if (process.platform === "darwin") {
      app.show();
    }
    mainWindow.show();
    mainWindow.focus();
  }

  cleanup(): void {
    this.unregister();
  }

  private unregister(): void {
    if (this.registeredAccelerator) {
      globalShortcut.unregister(this.registeredAccelerator);
      this.registeredAccelerator = null;
    }
    if (this.registeredRecordingAccelerators && this.registeredRecordingAccelerators.length > 0) {
      for (const acc of this.registeredRecordingAccelerators) {
        try {
          globalShortcut.unregister(acc);
        } catch {}
      }
      this.registeredRecordingAccelerators = [];
    }
  }
}
