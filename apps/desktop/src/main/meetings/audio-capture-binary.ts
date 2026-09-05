import * as fs from "node:fs";
import * as path from "node:path";
import { app } from "electron";

export interface AudioCaptureSpawnConfig {
  executable: string;
  args: string[];
}

function resolveAudioCaptureFallbackScript(): string | null {
  const configuredScript = process.env.PRISMICAL_AUDIO_CAPTURE_SCRIPT?.trim();
  const candidates = [
    configuredScript ? path.resolve(configuredScript) : null,
    path.join(
      app.getAppPath(),
      "..",
      "..",
      "packages",
      "native-helpers",
      "audio-capture",
      "scripts",
      "audio_capture.py",
    ),
    path.join(
      process.cwd(),
      "..",
      "..",
      "packages",
      "native-helpers",
      "audio-capture",
      "scripts",
      "audio_capture.py",
    ),
  ];

  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) ?? null;
}

export function resolveAudioCaptureBinaryPath(): string {
  const binaryName =
    process.platform === "win32" ? "audio-capture.exe" : "audio-capture";

  if (app.isPackaged) {
    return path.join(process.resourcesPath, binaryName);
  }

  return path.join(
    process.cwd(),
    "..",
    "..",
    "packages",
    "native-helpers",
    "audio-capture",
    "bin",
    binaryName,
  );
}

export function resolveAudioCaptureBinaryCommand(
  mode: string,
  options?: {
    debugArtifactsDir?: string;
    aecRenderHoldbackMs?: number;
    aecRenderWaitTimeoutMs?: number;
  },
): AudioCaptureSpawnConfig {
  const binaryPath = resolveAudioCaptureBinaryPath();

  const defaultArgs = ["--mode", mode];
  if (options?.debugArtifactsDir) {
    defaultArgs.push("--debug-artifacts-dir", options.debugArtifactsDir);
  }
  if (options?.aecRenderHoldbackMs != null) {
    defaultArgs.push(
      "--aec-render-holdback-ms",
      String(options.aecRenderHoldbackMs),
    );
  }
  if (options?.aecRenderWaitTimeoutMs != null) {
    defaultArgs.push(
      "--aec-render-wait-timeout-ms",
      String(options.aecRenderWaitTimeoutMs),
    );
  }

  if (fs.existsSync(binaryPath)) {
    return {
      executable: binaryPath,
      args: defaultArgs,
    };
  }

  const fallbackScript = resolveAudioCaptureFallbackScript();
  if (fallbackScript) {
    const pythonExecutable =
      process.env.PHOVOICE_PYTHON_PATH ||
      (process.platform === "win32" ? "python" : "python3");
    return {
      executable: pythonExecutable,
      args: ["-u", fallbackScript],
    };
  }

  throw new Error(
    `Native capture binary not found at ${binaryPath}. Run the desktop build dependencies first.`,
  );
}

export function assertAudioCaptureBinaryExists(): string {
  const binaryPath = resolveAudioCaptureBinaryPath();
  if (!fs.existsSync(binaryPath)) {
    const fallbackScript = resolveAudioCaptureFallbackScript();
    if (fallbackScript) {
      return fallbackScript;
    }
    throw new Error(
      `Native capture binary not found at ${binaryPath}. Run the desktop build dependencies first.`,
    );
  }

  return binaryPath;
}
