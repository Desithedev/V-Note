/**
 * Universal clipboard helper for V-Note.
 * Prioritizes Electron's native clipboard IPC (which never fails due to document focus),
 * falling back to navigator.clipboard and document.execCommand.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (!text) return true;

  // 1. Electron native clipboard IPC
  if (
    typeof window !== "undefined" &&
    window.electronAPI &&
    (window.electronAPI as any).clipboard?.writeText
  ) {
    try {
      const ok = await (window.electronAPI as any).clipboard.writeText(text);
      if (ok !== false) return true;
    } catch {
      // Continue to next fallback
    }
  }

  // 2. Browser Clipboard API
  if (
    typeof navigator !== "undefined" &&
    navigator.clipboard &&
    typeof navigator.clipboard.writeText === "function"
  ) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Continue to next fallback
    }
  }

  // 3. Document execCommand fallback (older browser / unfocused window)
  try {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.style.position = "fixed";
    textArea.style.left = "-999999px";
    textArea.style.top = "-999999px";
    textArea.style.opacity = "0";
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    const successful = document.execCommand("copy");
    document.body.removeChild(textArea);
    return successful;
  } catch {
    return false;
  }
}
