/**
 * PhoVoice Local Engine Service for V-Note Desktop.
 * Manages the lifecycle (spawn, healthcheck, auto-shutdown) of the local PhoVoice ASR engine.
 */
import { ChildProcess, spawn } from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { app } from "electron";
import { EventEmitter } from "events";
import { logger } from "../logger";

export interface PhoVoiceEngineStatus {
  isRunning: boolean;
  port: number;
  baseURL: string;
  isReady: boolean;
  modelLoaded: boolean;
  device: string;
  error?: string;
}

export class PhoVoiceLocalService extends EventEmitter {
  private static instance: PhoVoiceLocalService | null = null;
  private process: ChildProcess | null = null;
  private port: number = 18765;
  private isReady: boolean = false;
  private isShuttingDown: boolean = false;
  private healthCheckTimer: NodeJS.Timeout | null = null;
  private detectedDevice: string = "CPU";
  private logs: string[] = [];
  private startPromise: Promise<boolean> | null = null;

  private constructor() {
    super();
    this.detectHardwareCapabilities();
    this.setupAppLifecycleHooks();
    this.addLog("[System] PhoVoiceLocalService initialized");
  }

  public addLog(msg: string): void {
    const timestamp = new Date().toLocaleTimeString();
    const entry = `[${timestamp}] ${msg}`;
    this.logs.push(entry);
    if (this.logs.length > 200) {
      this.logs.shift();
    }
    this.emit("log", entry);
  }

  public getLogs(): string[] {
    return [...this.logs];
  }

  public clearLogs(): void {
    this.logs = [];
  }

  public async restartEngine(): Promise<boolean> {
    this.addLog("[System] Manual restart requested...");
    this.stopEngine();
    await new Promise((r) => setTimeout(r, 1000));
    return await this.startEngine();
  }

  public static getInstance(): PhoVoiceLocalService {
    if (!PhoVoiceLocalService.instance) {
      PhoVoiceLocalService.instance = new PhoVoiceLocalService();
    }
    return PhoVoiceLocalService.instance;
  }

  public getBaseURL(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  public getStatus(): PhoVoiceEngineStatus {
    return {
      isRunning: this.process !== null && !this.process.killed,
      port: this.port,
      baseURL: this.getBaseURL(),
      isReady: this.isReady,
      modelLoaded: this.isReady,
      device: this.detectedDevice,
    };
  }

  private detectHardwareCapabilities(): void {
    const cpus = os.cpus();
    const threadCount = cpus.length;
    this.detectedDevice = `CPU (${threadCount} Threads)`;
    logger.main.info("[PhoVoiceLocalService] Detected hardware environment", {
      platform: process.platform,
      arch: process.arch,
      threads: threadCount,
      device: this.detectedDevice,
    });
  }

  private setupAppLifecycleHooks(): void {
    app.on("before-quit", () => {
      this.stopEngine();
    });

    process.on("exit", () => {
      this.stopEngine();
    });

    process.on("SIGINT", () => {
      this.stopEngine();
      process.exit(0);
    });

    process.on("SIGTERM", () => {
      this.stopEngine();
      process.exit(0);
    });
  }

  /**
   * Resolve path to python runtime and phovoice server entry point.
   */
  private resolveEnginePaths(): {
    pythonExecutable: string;
    serverScriptPath: string;
    modelsDir: string;
    cwd: string;
  } | null {
    const isPackaged = app.isPackaged;
    const userDataPath = app.getPath("userData");
    const modelsDir = path.join(userDataPath, "models", "phovoice");

    if (isPackaged) {
      // Production paths inside resourcesPath
      const resourcesPath = process.resourcesPath;
      const bundledEngineDir = path.join(resourcesPath, "phovoice-engine");
      const standaloneExe = path.join(
        bundledEngineDir,
        process.platform === "win32" ? "phovoice-engine.exe" : "phovoice-engine",
      );
      if (fs.existsSync(standaloneExe)) {
        return {
          pythonExecutable: standaloneExe,
          serverScriptPath: "",
          modelsDir,
          cwd: bundledEngineDir,
        };
      }

      const pythonCandidates = [
        path.join(bundledEngineDir, "python", "Scripts", "python.exe"),
        path.join(bundledEngineDir, ".venv", "Scripts", "python.exe"),
        path.join(bundledEngineDir, "python", "python.exe"),
        path.join(bundledEngineDir, "python", "bin", "python3"),
        path.join(bundledEngineDir, ".venv", "bin", "python3"),
        path.join(bundledEngineDir, "python", "bin", "python"),
      ];
      const bundledPython = pythonCandidates.find((c) => fs.existsSync(c));
      const bundledServer = path.join(bundledEngineDir, "server.py");

      if (bundledPython && fs.existsSync(bundledServer)) {
        return {
          pythonExecutable: bundledPython,
          serverScriptPath: bundledServer,
          modelsDir,
          cwd: bundledEngineDir,
        };
      }
    }

    const configuredDevDir = process.env.PHOVOICE_DEV_DIR?.trim();
    // Development fallback within monorepo packages/phovoice-engine
    const devCandidates = [
      configuredDevDir ? path.resolve(configuredDevDir) : null,
      path.resolve(app.getAppPath(), "../../packages/phovoice-engine"),
      path.resolve(process.cwd(), "../../packages/phovoice-engine"),
      path.resolve(process.cwd(), "packages/phovoice-engine"),
      path.resolve(app.getAppPath(), "../../../phovoice-engine"),
      path.resolve(process.cwd(), "../../../phovoice-engine"),
      path.resolve(process.cwd(), "../phovoice-engine"),
      "D:/Code/phovoice-engine",
    ];
    const localDevPhovoiceDir = devCandidates.find(
      (candidate) =>
        candidate && fs.existsSync(path.join(candidate, "server.py")),
    );
    if (localDevPhovoiceDir) {
      const serverPy = path.join(localDevPhovoiceDir, "server.py");
      const devPythonCandidates = [
        path.join(localDevPhovoiceDir, "python", "Scripts", "python.exe"),
        path.join(localDevPhovoiceDir, ".venv", "Scripts", "python.exe"),
        path.join(localDevPhovoiceDir, "venv", "Scripts", "python.exe"),
        path.join(localDevPhovoiceDir, "python", "python.exe"),
        path.join(localDevPhovoiceDir, "python", "bin", "python3"),
        path.join(localDevPhovoiceDir, ".venv", "bin", "python3"),
        path.join(localDevPhovoiceDir, "venv", "bin", "python3"),
        path.join(localDevPhovoiceDir, "python", "bin", "python"),
      ];
      const pythonExecutable =
        devPythonCandidates.find((c) => fs.existsSync(c)) || "python";

      return {
        pythonExecutable,
        serverScriptPath: serverPy,
        modelsDir,
        cwd: localDevPhovoiceDir,
      };
    }

    return null;
  }

  /**
   * Start PhoVoice Local Engine background process.
   */
  public async startEngine(): Promise<boolean> {
    if (this.startPromise) {
      return this.startPromise;
    }

    this.startPromise = this.startEngineOnce();
    try {
      return await this.startPromise;
    } finally {
      this.startPromise = null;
    }
  }

  private async startEngineOnce(): Promise<boolean> {
    if (this.process && !this.process.killed && this.isReady) {
      return true;
    }

    // Native libraries can take a while to import on the first launch. Keep
    // waiting for that process instead of spawning another one on the port.
    if (this.process && !this.process.killed) {
      const ready = await this.waitForServerReady(60000);
      this.isReady = ready;
      if (ready) {
        this.emit("ready", this.getStatus());
      }
      return ready;
    }

    // Check if an existing server is already running on this port
    const alreadyAlive = await this.pingHealth();
    if (alreadyAlive) {
      logger.main.info(
        "[PhoVoiceLocalService] Detected existing healthy PhoVoice instance on port",
        { port: this.port },
      );
      this.isReady = true;
      this.emit("ready", this.getStatus());
      return true;
    }

    const paths = this.resolveEnginePaths();
    if (!paths) {
      logger.main.warn(
        "[PhoVoiceLocalService] Could not resolve PhoVoice engine executable paths",
      );
      return false;
    }

    logger.main.info(
      "[PhoVoiceLocalService] Launching PhoVoice Local Engine...",
      {
        python: paths.pythonExecutable,
        script: paths.serverScriptPath,
        cwd: paths.cwd,
        port: this.port,
      },
    );

    try {
      const env = {
        ...process.env,
        PHOVOICE_PORT: String(this.port),
        PHOVOICE_MODELS_DIR: paths.modelsDir,
        PYTHONUNBUFFERED: "1",
      };

      const args = paths.serverScriptPath
        ? [
            paths.serverScriptPath,
            "--port",
            String(this.port),
            "--host",
            "127.0.0.1",
            "--models-dir",
            paths.modelsDir,
          ]
        : [
            "--port",
            String(this.port),
            "--host",
            "127.0.0.1",
            "--models-dir",
            paths.modelsDir,
          ];

      this.process = spawn(paths.pythonExecutable, args, {
        cwd: paths.cwd,
        env,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });

      this.process.stdout?.on("data", (data: Buffer) => {
        const lines = data.toString().split(/\r?\n/);
        for (const l of lines) {
          const trimmed = l.trim();
          if (trimmed) {
            this.addLog(trimmed);
            logger.main.debug(`[PhoVoiceEngine] ${trimmed}`);
          }
        }
      });

      this.process.stderr?.on("data", (data: Buffer) => {
        const lines = data.toString().split(/\r?\n/);
        for (const l of lines) {
          const trimmed = l.trim();
          if (trimmed) {
            this.addLog(`[STDERR] ${trimmed}`);
            logger.main.debug(`[PhoVoiceEngine STDERR] ${trimmed}`);
          }
        }
      });

      this.process.on("error", (err) => {
        this.addLog(`[ERROR] Process error: ${err.message}`);
        logger.main.error("[PhoVoiceLocalService] Process spawn error:", err);
        this.isReady = false;
        this.emit("error", err);
      });

      this.process.on("exit", (code, signal) => {
        this.addLog(
          `[EXIT] Process stopped (code: ${code}, signal: ${signal})`,
        );
        logger.main.info("[PhoVoiceLocalService] Process exited", {
          code,
          signal,
        });
        this.process = null;
        this.isReady = false;
        this.emit("stopped", { code, signal });
      });

      // Poll healthcheck until server responds
      const ready = await this.waitForServerReady(60000);
      if (ready) {
        this.isReady = true;
        logger.main.info(
          "[PhoVoiceLocalService] PhoVoice Local Engine is READY!",
        );
        this.emit("ready", this.getStatus());
        return true;
      } else {
        logger.main.warn(
          "[PhoVoiceLocalService] Server did not respond to healthcheck in time",
        );
        return false;
      }
    } catch (err) {
      logger.main.error(
        "[PhoVoiceLocalService] Failed to start PhoVoice engine:",
        err,
      );
      return false;
    }
  }

  /**
   * Ping /health endpoint.
   */
  public async pingHealth(): Promise<boolean> {
    try {
      const res = await fetch(`${this.getBaseURL()}/health`, {
        signal: AbortSignal.timeout(1500),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Wait for server to become responsive.
   */
  private async waitForServerReady(
    timeoutMs: number = 15000,
  ): Promise<boolean> {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      if (!this.process) {
        return false;
      }
      if (await this.pingHealth()) {
        return true;
      }
      await new Promise((r) => setTimeout(r, 400));
    }
    return false;
  }

  /**
   * Cleanly stop the background engine.
   */
  public stopEngine(): void {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;

    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }

    if (this.process) {
      logger.main.info(
        "[PhoVoiceLocalService] Stopping PhoVoice Local Engine process...",
      );
      try {
        if (process.platform === "win32") {
          spawn("taskkill", ["/pid", String(this.process.pid), "/T", "/F"], {
            windowsHide: true,
          });
        } else {
          this.process.kill("SIGTERM");
        }
      } catch (e) {
        // ignore
      }
      this.process = null;
      this.isReady = false;
    }
    this.isShuttingDown = false;
  }
}

export const phovoiceLocalService = PhoVoiceLocalService.getInstance();
