/**
 * Transcription Provider Registry & Fallback Coordinator
 */

import { TranscriptionProvider } from "./pipeline-types";
import { logger } from "../../main/logger";

export class TranscriptionProviderRegistry {
  private providers = new Map<string, TranscriptionProvider>();
  private defaultProviderId: string = "whisper";

  /**
   * Đăng ký một transcription provider vào hệ thống
   */
  registerProvider(provider: TranscriptionProvider): void {
    this.providers.set(provider.id, provider);
    logger.transcription.info(`[ProviderRegistry] Registered provider '${provider.id}' (${provider.name})`);
  }

  /**
   * Lấy provider theo ID
   */
  getProvider(id: string): TranscriptionProvider | undefined {
    return this.providers.get(id);
  }

  /**
   * Lấy danh sách tất cả các provider đã đăng ký
   */
  getAllProviders(): TranscriptionProvider[] {
    return Array.from(this.providers.values());
  }

  /**
   * Chọn provider phù hợp kèm cơ chế tự động Fallback Chain nếu provider chính không khả dụng
   */
  async selectProviderWithFallback(
    primaryId: string,
    fallbackId?: string
  ): Promise<{ provider: TranscriptionProvider; isFallback: boolean }> {
    // 1. Thử Primary Provider
    const primary = this.providers.get(primaryId);
    if (primary) {
      const isAvail = primary.isAvailable ? await primary.isAvailable() : true;
      if (isAvail) {
        return { provider: primary, isFallback: false };
      }
      logger.transcription.warn(
        `[ProviderRegistry] Primary provider '${primaryId}' is unavailable. Attempting fallback...`
      );
    } else {
      logger.transcription.warn(
        `[ProviderRegistry] Primary provider '${primaryId}' not found in registry.`
      );
    }

    // 2. Thử Fallback Provider
    if (fallbackId && fallbackId !== primaryId) {
      const fallback = this.providers.get(fallbackId);
      if (fallback) {
        const isAvail = fallback.isAvailable ? await fallback.isAvailable() : true;
        if (isAvail) {
          logger.transcription.info(
            `[ProviderRegistry] Successfully switched to fallback provider '${fallbackId}'.`
          );
          return { provider: fallback, isFallback: true };
        }
      }
    }

    // 3. Fallback cuối cùng: Whisper Local
    const defaultProv = this.providers.get(this.defaultProviderId) || this.providers.get("whisper-local");
    if (defaultProv) {
      logger.transcription.info(
        `[ProviderRegistry] Falling back to default system provider '${defaultProv.id}'.`
      );
      return { provider: defaultProv, isFallback: true };
    }

    // 4. Nếu không có provider nào khả dụng
    const anyProv = this.providers.values().next().value;
    if (!anyProv) {
      throw new Error("No transcription providers registered in registry.");
    }
    return { provider: anyProv, isFallback: true };
  }

  /**
   * Reset tất cả providers
   */
  resetAll(): void {
    for (const provider of this.providers.values()) {
      try {
        provider.reset();
      } catch (e) {
        logger.transcription.error(`[ProviderRegistry] Error resetting provider '${provider.id}':`, e);
      }
    }
  }

  /**
   * Giải phóng tài nguyên khi tắt app
   */
  async disposeAll(): Promise<void> {
    for (const provider of this.providers.values()) {
      if (provider.dispose) {
        try {
          await provider.dispose();
        } catch (e) {
          logger.transcription.error(`[ProviderRegistry] Error disposing provider '${provider.id}':`, e);
        }
      }
    }
  }
}
