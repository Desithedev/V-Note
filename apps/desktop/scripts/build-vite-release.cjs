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
    const extraOptions =
      configFile === "vite.main.config.mts"
        ? {
            define: {
              MAIN_WINDOW_VITE_DEV_SERVER_URL: "undefined",
              MAIN_WINDOW_VITE_NAME: JSON.stringify("main_window"),
              ONBOARDING_WINDOW_VITE_DEV_SERVER_URL: "undefined",
              ONBOARDING_WINDOW_VITE_NAME: JSON.stringify("onboarding_window"),
              RECORDING_WIDGET_WINDOW_VITE_DEV_SERVER_URL: "undefined",
              RECORDING_WIDGET_WINDOW_VITE_NAME: JSON.stringify(
                "recording_widget_window",
              ),
            },
          }
        : {};
    await build({
      configFile: resolve(__dirname, "..", configFile),
      mode: "production",
      ...extraOptions,
    });
  }
  console.log("Vite release bundles completed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
