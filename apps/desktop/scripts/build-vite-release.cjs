const { build } = require("vite");
const { resolve } = require("node:path");

const configs = [
  "vite.main.config.mts",
  "vite.preload.config.mts",
  "vite.onboarding-preload.config.mts",
  "vite.renderer.config.mts",
  "vite.onboarding.config.mts",
  "vite.recording-widget.config.mts",
];

(async () => {
  for (const configFile of configs) {
    console.log(`Building Vite target: ${configFile}`);
    await build({ configFile: resolve(__dirname, "..", configFile), mode: "production" });
  }
  console.log("Vite release bundles completed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
