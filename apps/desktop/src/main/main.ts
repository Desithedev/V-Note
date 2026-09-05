import dotenv from "dotenv";
dotenv.config();

import { app, ipcMain, protocol, net } from "electron";

// Avoid startup crashes on Windows machines with an unavailable Chromium GPU
// driver. This must run before Electron creates any BrowserWindow instances.
if (process.platform === "win32") {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch("disable-gpu");
}
import { pathToFileURL, fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";

// The production main bundle is ESM, where Node does not provide the
// CommonJS `__dirname` global. Several runtime dependencies (notably cron)
// still read it, so define the equivalent once at the entrypoint scope.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
import { logger } from "./logger";

// Register media:// scheme as privileged for streaming local audio files
protocol.registerSchemesAsPrivileged([
  {
    scheme: "media",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

import started from "electron-squirrel-startup";
import { AppManager } from "./core/app-manager";
import { getAppIconPath } from "./core/icon";
import { isWindows } from "../utils/platform";
import { ServiceManager } from "./managers/service-manager";
import { registerSdkWarningHandler } from "../services/ai/sdk-warning-handler";

// Forward AI SDK provider warnings (e.g. "AI SDK Warning: temperature is
// not supported by this model") to the structured pipeline logger. Must
// run before any AI SDK call.
registerSdkWarningHandler();

// Setup renderer logging relay (allows renderer to send logs to main process)
ipcMain.handle(
  "log-message",
  (_event, level: string, scope: string, ...args: unknown[]) => {
    const scopedLogger =
      logger[scope as keyof typeof logger] || logger.renderer;
    const logMethod = scopedLogger[level as keyof typeof scopedLogger];
    if (typeof logMethod === "function") {
      logMethod(...args);
    }
  },
);

if (started) {
  app.quit();
}

// Set App User Model ID for Windows (required for Squirrel.Windows)
if (isWindows()) {
  app.setAppUserModelId("com.v-note.desktop");
}

// Register the v-note:// and legacy prismical:// protocols
const registerCustomProtocol = (scheme: string) => {
  if (process.defaultApp) {
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient(scheme, process.execPath, [
        process.argv[1],
      ]);
    }
  } else {
    app.setAsDefaultProtocolClient(scheme);
  }
};
registerCustomProtocol("v-note");
registerCustomProtocol("prismical");

// Enforce single instance
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  // Another instance is already running, quit this one
  app.quit();
}

const appManager = new AppManager();

// Track initialization state for deep link handling
let isInitialized = false;
let pendingDeepLink: string | null = null;

// Handle protocol on macOS
app.on("open-url", (event, url) => {
  event.preventDefault();
  if (isInitialized) {
    appManager.handleDeepLink(url);
  } else {
    pendingDeepLink = url;
  }
});

// Handle when another instance tries to start (Windows/Linux deep link handling)
app.on("second-instance", (_event, commandLine) => {
  // Someone tried to run a second instance, we should focus our window instead.
  if (isInitialized) {
    appManager.handleSecondInstance();
  }

  // Check if this is a protocol launch on Windows/Linux
  const url = commandLine.find(
    (arg) => arg.startsWith("v-note://") || arg.startsWith("prismical://"),
  );
  if (url) {
    if (isInitialized) {
      appManager.handleDeepLink(url);
    } else {
      pendingDeepLink = url;
    }
  }
});

app.whenReady().then(async () => {
  try {
    // Handle media:// URLs for high-performance audio playback with native Range request streaming
    protocol.handle("media", async (request) => {
      try {
        let filePath = decodeURIComponent(
          request.url.replace(/^media:\/\/local-file\//i, "").replace(/^media:\/\//i, ""),
        );
        if (process.platform === "win32" && filePath.startsWith("/")) {
          filePath = filePath.slice(1);
        }
        const normalized = path.normalize(filePath);
        if (!fs.existsSync(normalized)) {
          logger.main.warn("Media file not found:", normalized);
          return new Response("Not found", { status: 404 });
        }

        const stat = fs.statSync(normalized);
        const fileSize = stat.size;
        const rangeHeader = request.headers.get("Range");

        if (rangeHeader) {
          const parts = rangeHeader.replace(/bytes=/, "").split("-");
          const start = parseInt(parts[0], 10);
          const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
          const chunksize = end - start + 1;

          const stream = fs.createReadStream(normalized, { start, end });
          const webStream = new ReadableStream({
            start(controller) {
              stream.on("data", (chunk) => controller.enqueue(chunk));
              stream.on("end", () => controller.close());
              stream.on("error", (err) => controller.error(err));
            },
            cancel() {
              stream.destroy();
            },
          });

          return new Response(webStream, {
            status: 206,
            statusText: "Partial Content",
            headers: {
              "Content-Range": `bytes ${start}-${end}/${fileSize}`,
              "Accept-Ranges": "bytes",
              "Content-Length": String(chunksize),
              "Content-Type": "audio/wav",
            },
          });
        }

        const stream = fs.createReadStream(normalized);
        const webStream = new ReadableStream({
          start(controller) {
            stream.on("data", (chunk) => controller.enqueue(chunk));
            stream.on("end", () => controller.close());
            stream.on("error", (err) => controller.error(err));
          },
          cancel() {
            stream.destroy();
          },
        });

        return new Response(webStream, {
          status: 200,
          headers: {
            "Accept-Ranges": "bytes",
            "Content-Length": String(fileSize),
            "Content-Type": "audio/wav",
          },
        });
      } catch (err) {
        logger.main.warn("Failed to stream media file:", err);
        return new Response("Not found", { status: 404 });
      }
    });

    // macOS dock icon in dev: packaged builds read the bundle icon from
    // packagerConfig.icon, but electron-forge start shows Electron's default
    // unless we set one explicitly.
    if (process.platform === "darwin") {
      app.dock?.setIcon(getAppIconPath());
    }
    await appManager.initialize();
    isInitialized = true;

    // Process any deep link that was received before initialization completed
    if (pendingDeepLink) {
      appManager.handleDeepLink(pendingDeepLink);
      pendingDeepLink = null;
    }
  } catch (error) {
    logger.main.error("Application failed to initialize", { error });
    const telemetryService = ServiceManager.getInstance().getTelemetryService();
    await telemetryService?.captureExceptionImmediateAndShutdown(error, {
      source: "main_process",
      stage: "app_initialize",
    });
    app.quit();
  }
});
app.on("will-quit", () => appManager.cleanup());
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("activate", () => {
  if (!isInitialized) return;
  appManager.handleActivate();
});
