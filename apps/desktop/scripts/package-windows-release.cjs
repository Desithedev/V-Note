const { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { resolve } = require("node:path");

const appDir = resolve(__dirname, "..");
const repoDir = resolve(appDir, "../..");
const templateDir = [
  resolve(appDir, "out/V-Note-win32-x64"),
  resolve(repoDir, "out-installer-manual/V-Note-win32-x64"),
  resolve(repoDir, "out-installer-manual/Prismical-win32-x64"),
].find((dir) => existsSync(dir)) || resolve(appDir, "out/V-Note-win32-x64");
const releaseDir = resolve(repoDir, "out-release-ready/V-Note-win32-x64");
const packageJsonPath = resolve(appDir, "package.json");
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));

if (!existsSync(templateDir)) {
  throw new Error(`Missing packaging template: ${templateDir}`);
}

rmSync(releaseDir, { recursive: true, force: true });
mkdirSync(resolve(repoDir, "out-release-ready"), { recursive: true });
cpSync(templateDir, releaseDir, { recursive: true, dereference: true, force: true });

const appOutputDir = resolve(releaseDir, "resources/app");
rmSync(resolve(appOutputDir, ".vite"), { recursive: true, force: true });
cpSync(resolve(appDir, ".vite"), resolve(appOutputDir, ".vite"), {
  recursive: true,
  dereference: true,
  force: true,
});
cpSync(packageJsonPath, resolve(appOutputDir, "package.json"));

const nativeResources = [
  ["../../packages/native-helpers/audio-capture/bin/audio-capture.exe", "resources/audio-capture.exe"],
  ["../../packages/native-helpers/mic-detector/bin/prismical-mic-detector.exe", "resources/prismical-mic-detector.exe"],
  ["../../packages/native-helpers/audio-capture/bin/prismical_webrtc_aec3.dll", "resources/prismical_webrtc_aec3.dll"],
];
for (const [source, destination] of nativeResources) {
  const sourcePath = resolve(appDir, source);
  if (existsSync(sourcePath)) cpSync(sourcePath, resolve(releaseDir, destination));
}

const vnoteExe = resolve(releaseDir, "V-Note.exe");
const prismicalExe = resolve(releaseDir, "Prismical.exe");
if (existsSync(prismicalExe) && !existsSync(vnoteExe)) {
  cpSync(prismicalExe, vnoteExe);
}

writeFileSync(
  resolve(repoDir, "out-release-ready/release-manifest.json"),
  JSON.stringify({ name: "V-Note", version: packageJson.version, platform: "win32", arch: "x64" }, null, 2) + "\n",
);
console.log(`Release ready: ${existsSync(vnoteExe) ? vnoteExe : prismicalExe}`);
