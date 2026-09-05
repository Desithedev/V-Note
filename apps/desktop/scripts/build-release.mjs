import { spawnSync } from "node:child_process";

const isWindows = process.platform === "win32";
const target = isWindows ? "make:windows:installer" : "make:macos";

console.log(`Building ${isWindows ? "Windows Squirrel installer" : "macOS DMG/ZIP"}...`);
const result = spawnSync("pnpm", ["run", target], {
  stdio: "inherit",
  shell: isWindows,
});

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

console.log("Build complete. Android APK is not generated because this repository has no Android application module.");
