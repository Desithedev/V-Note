import { BrowserWindow, screen, nativeTheme, shell } from "electron";
import path from "node:path";
import { logger } from "../logger";
import { getAppIconPath } from "./icon";
import type { SettingsService } from "../../services/settings-service";
import type { createIPCHandler } from "electron-trpc-experimental/main";
import type { MeetingWidgetEdge } from "../../types/meeting-widget";

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string;
declare const MAIN_WINDOW_VITE_NAME: string;
declare const ONBOARDING_WINDOW_VITE_DEV_SERVER_URL: string;
declare const ONBOARDING_WINDOW_VITE_NAME: string;
declare const RECORDING_WIDGET_WINDOW_VITE_DEV_SERVER_URL: string;
declare const RECORDING_WIDGET_WINDOW_VITE_NAME: string;

export class WindowManager {
  private static readonly MEETING_WIDGET_WINDOW_WIDTH = 380 as const;
  private static readonly MEETING_WIDGET_WINDOW_HEIGHT = 240 as const;
  private static readonly MEETING_WIDGET_POPUP_WINDOW_WIDTH = 456 as const;
  private static readonly MEETING_WIDGET_POPUP_WINDOW_HEIGHT = 480 as const;
  private static readonly MEETING_WIDGET_EDGE_MARGIN = 6 as const;
  private static readonly MEETING_WIDGET_PARALLEL_MARGIN = 24 as const;
  private mainWindow: BrowserWindow | null = null;
  private onboardingWindow: BrowserWindow | null = null;
  private meetingWidgetWindow: BrowserWindow | null = null;
  private meetingWidgetPopupOpen = false;
  private meetingWidgetEdge: MeetingWidgetEdge = "right";
  private meetingWidgetNormalizedPosition = 0.5;
  private meetingWidgetDisplayPoint: Electron.Point | null = null;
  private themeListenerSetup: boolean = false;

  private getTrafficLightPosition(): { x: number; y: number } {
    if (process.platform !== "darwin") {
      return { x: 20, y: 16 }; // Not used on non-macOS, but return default
    }
    return { x: 16, y: 16 };
  }

  private getMeetingWidgetWindowBounds(
    edge: MeetingWidgetEdge = "right",
    normalizedPosition: number = 0.5,
    displayPoint: Electron.Point = screen.getCursorScreenPoint(),
    popupOpen: boolean = this.meetingWidgetPopupOpen,
  ): Electron.Rectangle {
    const display = screen.getDisplayNearestPoint(displayPoint);
    const workArea = display.workArea;
    const requestedWidth =
      popupOpen
        ? WindowManager.MEETING_WIDGET_POPUP_WINDOW_WIDTH
        : WindowManager.MEETING_WIDGET_WINDOW_WIDTH;
    const requestedHeight =
      popupOpen
        ? WindowManager.MEETING_WIDGET_POPUP_WINDOW_HEIGHT
        : WindowManager.MEETING_WIDGET_WINDOW_HEIGHT;
    const width = Math.min(requestedWidth, workArea.width);
    const height = Math.min(requestedHeight, workArea.height);
    const edgeMargin = WindowManager.MEETING_WIDGET_EDGE_MARGIN;
    const parallelMargin = WindowManager.MEETING_WIDGET_PARALLEL_MARGIN;
    const clamped = clampNormalizedPosition(normalizedPosition);

    if (edge === "right") {
      const compactHeight = Math.min(
        WindowManager.MEETING_WIDGET_WINDOW_HEIGHT,
        workArea.height,
      );
      const minAnchorY = workArea.y + parallelMargin + compactHeight / 2;
      const maxAnchorY =
        workArea.y + workArea.height - parallelMargin - compactHeight / 2;
      const anchorY =
        maxAnchorY <= minAnchorY
          ? workArea.y + workArea.height / 2
          : Math.round(minAnchorY + (maxAnchorY - minAnchorY) * clamped);
      return {
        x: workArea.x + workArea.width - width - edgeMargin,
        y: clamp(
          Math.round(anchorY - height / 2),
          workArea.y,
          workArea.y + workArea.height - height,
        ),
        width,
        height,
      };
    }

    // edge === "bottom"
    const compactWidth = Math.min(
      WindowManager.MEETING_WIDGET_WINDOW_WIDTH,
      workArea.width,
    );
    const minAnchorX = workArea.x + parallelMargin + compactWidth / 2;
    const maxAnchorX =
      workArea.x + workArea.width - parallelMargin - compactWidth / 2;
    const anchorX =
      maxAnchorX <= minAnchorX
        ? workArea.x + workArea.width / 2
        : Math.round(minAnchorX + (maxAnchorX - minAnchorX) * clamped);
    return {
      x: clamp(
        Math.round(anchorX - width / 2),
        workArea.x,
        workArea.x + workArea.width - width,
      ),
      y: workArea.y + workArea.height - height - edgeMargin,
      width,
      height,
    };
  }

  constructor(
    private settingsService: SettingsService,
    private trpcHandler: ReturnType<typeof createIPCHandler>,
  ) {
    logger.main.info("WindowManager created with dependencies");
  }

  private async getThemeColors(): Promise<{
    backgroundColor: string;
    symbolColor: string;
  }> {
    const uiSettings = await this.settingsService.getUISettings();
    const theme = uiSettings?.theme || "system";

    // Determine if we should use dark colors
    let isDark = false;
    if (theme === "dark") {
      isDark = true;
    } else if (theme === "light") {
      isDark = false;
    } else if (theme === "system") {
      isDark = nativeTheme.shouldUseDarkColors;
    }

    // Return appropriate colors
    return isDark
      ? { backgroundColor: "#181818", symbolColor: "#fafafa" }
      : { backgroundColor: "#ffffff", symbolColor: "#0a0a0a" };
  }

  private async syncNativeThemeSource(): Promise<void> {
    const uiSettings = await this.settingsService.getUISettings();
    const desiredThemeSource = uiSettings?.theme ?? "system";

    if (nativeTheme.themeSource === desiredThemeSource) {
      return;
    }

    nativeTheme.themeSource = desiredThemeSource;
    logger.main.info("Synced native theme source", {
      themeSource: desiredThemeSource,
    });
  }

  async updateAllWindowThemes(): Promise<void> {
    await this.syncNativeThemeSource();
    const colors = await this.getThemeColors();

    // Update main window (macOS uses vibrancy, no title bar overlay)
    if (
      process.platform !== "darwin" &&
      this.mainWindow &&
      !this.mainWindow.isDestroyed()
    ) {
      this.mainWindow.setTitleBarOverlay({
        color: colors.backgroundColor,
        symbolColor: colors.symbolColor,
        height: 32,
      });
    }

    // Update onboarding window if it exists
    // Note: onboarding window has frame: false, so no title bar to update

    logger.main.info("Updated window themes", colors);
  }

  private setupThemeListener(): void {
    if (this.themeListenerSetup) return;

    // Listen for system theme changes
    nativeTheme.on("updated", async () => {
      const uiSettings = await this.settingsService.getUISettings();
      const theme = uiSettings?.theme || "system";

      // Only update if theme is set to "system"
      if (theme === "system") {
        await this.updateAllWindowThemes();
        logger.main.info("System theme changed, updating windows");
      }
    });

    this.themeListenerSetup = true;
    logger.main.info("Theme listener setup complete");
  }

  /**
   * Creates a new main window or shows existing one.
   * @param initialRoute - Optional route to navigate to when creating a NEW window.
   *                       This is passed as a URL hash to avoid race conditions where
   *                       the renderer isn't ready to receive IPC navigation events.
   *                       If window already exists, caller should use webContents.send()
   *                       to navigate (renderer is already loaded and listening).
   */
  async createOrShowMainWindow(initialRoute?: string): Promise<void> {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.show();
      this.mainWindow.focus();
      return;
    }

    // Setup theme listener on first window creation
    this.setupThemeListener();

    await this.syncNativeThemeSource();

    // Get theme colors before creating window
    const colors = await this.getThemeColors();

    const primaryDisplay = screen.getPrimaryDisplay();
    const windowHeight = Math.min(800, primaryDisplay.workAreaSize.height - 40);

    this.mainWindow = new BrowserWindow({
      width: 1200,
      height: windowHeight,
      frame: true,
      icon: getAppIconPath(),
      backgroundColor:
        process.platform === "darwin" ? "#00000000" : colors.backgroundColor,
      ...(process.platform === "darwin"
        ? {
            titleBarStyle: "hiddenInset",
            vibrancy: "menu",
          }
        : {
            titleBarStyle: "hidden",
            titleBarOverlay: {
              color: colors.backgroundColor,
              symbolColor: colors.symbolColor,
              height: 32,
            },
          }),
      trafficLightPosition: this.getTrafficLightPosition(),
      useContentSize: true,
      webPreferences: {
        preload: path.join(__dirname, "preload.js"),
        nodeIntegration: false,
        contextIsolation: true,
        spellcheck: false,
      },
    });

    const shouldOpenExternally = (url: string) => {
      try {
        const parsed = new URL(url);
        return ["http:", "https:", "mailto:", "tel:"].includes(parsed.protocol);
      } catch {
        return false;
      }
    };

    // Open external links in the default browser
    this.mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (shouldOpenExternally(url)) {
        shell.openExternal(url);
      }
      return { action: "deny" };
    });

    // Intercept navigation to external URLs
    this.mainWindow.webContents.on("will-navigate", (event, url) => {
      if (shouldOpenExternally(url)) {
        event.preventDefault();
        shell.openExternal(url);
      }
    });

    // Load the window URL, appending initial route as hash if provided
    // This avoids race conditions when the renderer isn't ready for IPC events
    if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
      const url = initialRoute
        ? `${MAIN_WINDOW_VITE_DEV_SERVER_URL}#${initialRoute}`
        : MAIN_WINDOW_VITE_DEV_SERVER_URL;
      this.mainWindow.loadURL(url);
    } else {
      this.mainWindow.loadFile(
        path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
        initialRoute ? { hash: initialRoute } : undefined,
      );
    }

    this.mainWindow.on("close", () => {
      // Detach window before it's destroyed
      this.trpcHandler.detachWindow(this.mainWindow!);
    });

    this.mainWindow.on("closed", () => {
      // Window is already destroyed, just clean up reference
      this.mainWindow = null;
    });

    this.trpcHandler.attachWindow(this.mainWindow!);
  }

  async createOrShowOnboardingWindow(): Promise<void> {
    if (this.onboardingWindow && !this.onboardingWindow.isDestroyed()) {
      this.onboardingWindow.show();
      this.onboardingWindow.focus();
      return;
    }

    // Setup theme listener if not already done
    this.setupThemeListener();

    await this.syncNativeThemeSource();

    // Get theme colors before creating window
    const colors = await this.getThemeColors();

    const primaryDisplay = screen.getPrimaryDisplay();
    const windowHeight = Math.min(928, primaryDisplay.workAreaSize.height - 40);

    this.onboardingWindow = new BrowserWindow({
      width: 800,
      height: windowHeight,
      frame: true,
      titleBarStyle: "hidden",
      titleBarOverlay: {
        color: colors.backgroundColor,
        symbolColor: colors.symbolColor,
        height: 32,
      },
      trafficLightPosition: this.getTrafficLightPosition(),
      resizable: false,
      center: true,
      modal: true,
      webPreferences: {
        preload: path.join(__dirname, "onboarding-preload.js"),
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
      const devUrl = new URL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
      devUrl.pathname = "onboarding.html";
      this.onboardingWindow.loadURL(devUrl.toString());
    } else {
      this.onboardingWindow.loadFile(
        path.join(
          __dirname,
          `../renderer/${ONBOARDING_WINDOW_VITE_NAME}/onboarding.html`,
        ),
      );
    }

    this.onboardingWindow.on("close", () => {
      this.trpcHandler.detachWindow(this.onboardingWindow!);
    });

    this.onboardingWindow.on("closed", () => {
      this.onboardingWindow = null;
    });

    // Disable main window while onboarding is open
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.setEnabled(false);
    }

    this.trpcHandler.attachWindow(this.onboardingWindow!);
    logger.main.info("Onboarding window created");
  }

  async createOrShowMeetingWidgetWindow(
    edge: MeetingWidgetEdge = "right",
    normalizedPosition: number = 0.5,
  ): Promise<void> {
    this.meetingWidgetEdge = edge;
    this.meetingWidgetNormalizedPosition = clampNormalizedPosition(normalizedPosition);

    const displayPoint = this.meetingWidgetDisplayPoint ?? screen.getCursorScreenPoint();
    this.meetingWidgetDisplayPoint = displayPoint;
    const bounds = this.getMeetingWidgetWindowBounds(
      edge,
      this.meetingWidgetNormalizedPosition,
      displayPoint,
    );

    if (this.meetingWidgetWindow && !this.meetingWidgetWindow.isDestroyed()) {
      this.meetingWidgetWindow.setBounds(bounds);
      this.meetingWidgetWindow.show();
      this.meetingWidgetWindow.setAlwaysOnTop(true, "screen-saver", 1);
      this.meetingWidgetWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      this.meetingWidgetWindow.moveTop();
      return;
    }

    this.meetingWidgetWindow = new BrowserWindow({
      ...bounds,
      show: true,
      frame: false,
      transparent: true,
      backgroundColor: "#00000000",
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      hasShadow: false,
      alwaysOnTop: true,
      acceptFirstMouse: true,
      ...(process.platform === "darwin" && {
        type: "panel" as const,
      }),
      webPreferences: {
        preload: path.join(__dirname, "preload.js"),
        nodeIntegration: false,
        contextIsolation: true,
        backgroundThrottling: false,
      },
    });

    this.meetingWidgetWindow.setAlwaysOnTop(true, "screen-saver", 1);
    this.meetingWidgetWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    this.meetingWidgetWindow.moveTop();

    this.meetingWidgetWindow.once("ready-to-show", () => {
      this.meetingWidgetWindow?.show();
      this.meetingWidgetWindow?.setAlwaysOnTop(true, "screen-saver", 1);
      this.meetingWidgetWindow?.moveTop();
    });

    if (typeof RECORDING_WIDGET_WINDOW_VITE_DEV_SERVER_URL !== "undefined" && RECORDING_WIDGET_WINDOW_VITE_DEV_SERVER_URL) {
      const devUrl = new URL(RECORDING_WIDGET_WINDOW_VITE_DEV_SERVER_URL);
      devUrl.pathname = "recording-widget.html";
      this.meetingWidgetWindow.loadURL(devUrl.toString());
    } else if (typeof MAIN_WINDOW_VITE_DEV_SERVER_URL !== "undefined" && MAIN_WINDOW_VITE_DEV_SERVER_URL) {
      const devUrl = new URL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
      devUrl.pathname = "recording-widget.html";
      this.meetingWidgetWindow.loadURL(devUrl.toString());
    } else {
      this.meetingWidgetWindow.loadFile(
        path.join(
          __dirname,
          `../renderer/${RECORDING_WIDGET_WINDOW_VITE_NAME}/recording-widget.html`,
        ),
      );
    }

    this.meetingWidgetWindow.on("close", () => {
      this.trpcHandler.detachWindow(this.meetingWidgetWindow!);
    });

    this.meetingWidgetWindow.on("closed", () => {
      this.meetingWidgetWindow = null;
      this.meetingWidgetDisplayPoint = null;
    });

    this.trpcHandler.attachWindow(this.meetingWidgetWindow);

    logger.main.info("Meeting recording widget window created", {
      bounds,
    });
  }

  setMeetingWidgetPopupOpen(open: boolean): void {
    if (this.meetingWidgetPopupOpen === open) {
      return;
    }

    this.meetingWidgetPopupOpen = open;
    if (!this.meetingWidgetWindow || this.meetingWidgetWindow.isDestroyed()) {
      return;
    }

    const currentBounds = this.meetingWidgetWindow.getBounds();
    const displayPoint = this.meetingWidgetDisplayPoint ?? {
      x: currentBounds.x + currentBounds.width / 2,
      y: currentBounds.y + currentBounds.height / 2,
    };
    this.meetingWidgetDisplayPoint = displayPoint;
    this.meetingWidgetWindow.setBounds(
      this.getMeetingWidgetWindowBounds(
        this.meetingWidgetEdge,
        this.meetingWidgetNormalizedPosition,
        displayPoint,
        open,
      ),
    );
  }

  hideMeetingWidgetWindow(): void {
    if (!this.meetingWidgetWindow || this.meetingWidgetWindow.isDestroyed()) {
      return;
    }

    this.meetingWidgetWindow.setIgnoreMouseEvents(true, { forward: true });
    this.meetingWidgetWindow.hide();
  }

  setMeetingWidgetWindowIgnoreMouseEvents(ignore: boolean): void {
    if (!this.meetingWidgetWindow || this.meetingWidgetWindow.isDestroyed()) {
      return;
    }

    this.meetingWidgetWindow.setIgnoreMouseEvents(
      ignore,
      ignore ? { forward: true } : undefined,
    );
  }

  /**
   * Move the widget window to follow the cursor freely during a drag.
   * No edge constraint — the window is wherever the cursor is. Returns the
   * top-left bounds we set, useful for tests.
   */
  updateMeetingWidgetWindowPositionFree(
    screenX: number,
    screenY: number,
    pointerOffsetX: number,
    pointerOffsetY: number,
  ): Electron.Rectangle | null {
    if (!this.meetingWidgetWindow || this.meetingWidgetWindow.isDestroyed()) {
      return null;
    }

    const currentBounds = this.meetingWidgetWindow.getBounds();
    const targetX = Math.round(screenX - pointerOffsetX);
    const targetY = Math.round(screenY - pointerOffsetY);
    const display = screen.getDisplayNearestPoint({ x: screenX, y: screenY });
    this.meetingWidgetDisplayPoint = { x: screenX, y: screenY };
    const workArea = display.workArea;
    const x = clamp(
      targetX,
      workArea.x,
      workArea.x + workArea.width - currentBounds.width,
    );
    const y = clamp(
      targetY,
      workArea.y,
      workArea.y + workArea.height - currentBounds.height,
    );

    const next = { ...currentBounds, x, y };
    this.meetingWidgetWindow.setBounds(next);
    return next;
  }

  /**
   * Snap the widget to the nearest edge of the display currently under the
   * cursor. Returns the resolved { edge, normalizedPosition } so the manager
   * can persist them.
   */
  snapMeetingWidgetToEdge(
    _screenX: number,
    _screenY: number,
  ): { edge: MeetingWidgetEdge; normalizedPosition: number } | null {
    if (!this.meetingWidgetWindow || this.meetingWidgetWindow.isDestroyed()) {
      return null;
    }

    const bounds = this.meetingWidgetWindow.getBounds();
    // Dragging is performed in the compact layout, so the window center is
    // also the pill anchor used for edge selection and persistence.
    const centerX = bounds.x + bounds.width / 2;
    const centerY = bounds.y + bounds.height / 2;
    const display = screen.getDisplayNearestPoint({ x: centerX, y: centerY });
    this.meetingWidgetDisplayPoint = { x: centerX, y: centerY };
    const workArea = display.workArea;
    const distanceToRight = Math.max(
      0,
      workArea.x + workArea.width - centerX,
    );
    const distanceToBottom = Math.max(
      0,
      workArea.y + workArea.height - centerY,
    );
    const edge: MeetingWidgetEdge =
      distanceToBottom < distanceToRight ? "bottom" : "right";

    const parallelMargin = WindowManager.MEETING_WIDGET_PARALLEL_MARGIN;
    let normalizedPosition: number;

    if (edge === "right") {
      const minY = workArea.y + parallelMargin + bounds.height / 2;
      const maxY =
        workArea.y + workArea.height - parallelMargin - bounds.height / 2;
      normalizedPosition =
        maxY <= minY
          ? 0.5
          : clampNormalizedPosition((centerY - minY) / (maxY - minY));
    } else {
      const minX = workArea.x + parallelMargin + bounds.width / 2;
      const maxX =
        workArea.x + workArea.width - parallelMargin - bounds.width / 2;
      normalizedPosition =
        maxX <= minX
          ? 0.5
          : clampNormalizedPosition((centerX - minX) / (maxX - minX));
    }

    const target = this.getMeetingWidgetWindowBounds(
      edge,
      normalizedPosition,
      { x: centerX, y: centerY },
      false,
    );
    this.meetingWidgetPopupOpen = false;
    this.meetingWidgetEdge = edge;
    this.meetingWidgetNormalizedPosition = normalizedPosition;
    this.meetingWidgetWindow.setBounds(target);
    return { edge, normalizedPosition };
  }

  async navigateMainWindow(route: string): Promise<void> {
    const windowExisted = this.getMainWindow() !== null;

    await this.createOrShowMainWindow(route);

    if (windowExisted) {
      const mainWindow = this.getMainWindow();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("navigate", route);
      }
    }
  }

  /**
   * Navigate the main window to a specific note. Uses a typed IPC payload
   * instead of a raw URL string so the renderer can call `router.navigate`
   * with structured params/search — avoids any reliance on hash-history
   * URL string parsing for query params.
   */
  async navigateToNote(
    noteId: number,
    options: { openTranscription?: boolean } = {},
  ): Promise<void> {
    const windowExisted = this.getMainWindow() !== null;
    // For the cold-start path the route still travels via URL hash. The
    // renderer's hash-history parser handles the search portion correctly.
    const search = options.openTranscription ? "?openTranscription=true" : "";
    const initialRoute = `/notes/${noteId}${search}`;

    await this.createOrShowMainWindow(initialRoute);

    if (windowExisted) {
      const mainWindow = this.getMainWindow();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("navigate-to-note", {
          noteId,
          openTranscription: !!options.openTranscription,
        });
      }
    }
  }

  closeOnboardingWindow(): void {
    if (this.onboardingWindow && !this.onboardingWindow.isDestroyed()) {
      this.onboardingWindow.close();
    }

    // Re-enable main window
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.setEnabled(true);
      this.mainWindow.show();
      this.mainWindow.focus();
    }
  }

  getMainWindow(): BrowserWindow | null {
    return this.mainWindow;
  }

  getOnboardingWindow(): BrowserWindow | null {
    return this.onboardingWindow;
  }

  getMeetingWidgetWindow(): BrowserWindow | null {
    return this.meetingWidgetWindow;
  }

  getAllWindows(): (BrowserWindow | null)[] {
    return [
      this.mainWindow,
      this.onboardingWindow,
      this.meetingWidgetWindow,
    ];
  }

  openAllDevTools(): void {
    const windows = this.getAllWindows().filter(
      (window): window is BrowserWindow =>
        window !== null && !window.isDestroyed(),
    );

    windows.forEach((window) => {
      if (window.webContents && !window.webContents.isDevToolsOpened()) {
        window.webContents.openDevTools();
      }
    });

    logger.main.info(`Opened dev tools for ${windows.length} windows`);
  }

  cleanup(): void {
    logger.main.info("Window manager cleanup complete");
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clampNormalizedPosition(value: number): number {
  if (!Number.isFinite(value)) {
    return 0.5;
  }

  return Math.min(1, Math.max(0, value));
}
