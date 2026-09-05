import { trpcClient } from "@/trpc/react";
import { getSystemLocale, initRendererI18n } from "@/i18n/renderer";

export const initializeRendererI18n = async () => {
  const systemLocale = getSystemLocale();
  let preferredLocale: string | null | undefined;

  try {
    const timeoutPromise = new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), 1000),
    );
    const settings = (await Promise.race([
      trpcClient.settings.getSettings.query(),
      timeoutPromise,
    ])) as any;
    preferredLocale = settings?.ui?.locale;
  } catch (error) {
    console.warn(
      "Failed to load locale from settings, using system locale",
      error,
    );
  }

  const resolvedLocale = preferredLocale ?? systemLocale;
  try {
    return await initRendererI18n(resolvedLocale);
  } catch (error) {
    console.warn("Failed to initialize i18n, falling back to default", error);
    return await initRendererI18n();
  }
};
