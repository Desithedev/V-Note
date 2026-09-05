import AsyncStorage from "@react-native-async-storage/async-storage";

export interface MobileNote {
  id: string;
  title: string;
  content: string;
  audioPath?: string;
  durationMs?: number;
  tags: string[];
  folder?: string;
  createdAt: number;
  updatedAt: number;
}

export interface MobileEvent {
  id: string;
  title: string;
  startAt: string;
  meetingLink?: string;
  noteId?: string;
  createdAt: number;
}

const NOTES_STORAGE_KEY = "@vnote_mobile_notes";
const EVENTS_STORAGE_KEY = "@vnote_mobile_events";

export class MobileStorageService {
  private memoryStore: Map<string, string> = new Map();

  private async safeGetItem(key: string): Promise<string | null> {
    try {
      if (AsyncStorage && AsyncStorage.getItem) {
        return await AsyncStorage.getItem(key);
      }
    } catch (e) {
      console.warn("[Storage] AsyncStorage.getItem failed, using memory store:", e);
    }
    return this.memoryStore.get(key) || null;
  }

  private async safeSetItem(key: string, value: string): Promise<void> {
    this.memoryStore.set(key, value);
    try {
      if (AsyncStorage && AsyncStorage.setItem) {
        await AsyncStorage.setItem(key, value);
      }
    } catch (e) {
      console.warn("[Storage] AsyncStorage.setItem failed, using memory store:", e);
    }
  }

  async getNotes(): Promise<MobileNote[]> {
    try {
      const json = await this.safeGetItem(NOTES_STORAGE_KEY);
      if (!json) {
        return this.getDefaultNotes();
      }
      return JSON.parse(json);
    } catch (e) {
      console.error("[Storage] getNotes error:", e);
      return this.getDefaultNotes();
    }
  }

  async saveNote(note: Omit<MobileNote, "id" | "createdAt" | "updatedAt">): Promise<MobileNote> {
    const notes = await this.getNotes();
    const newNote: MobileNote = {
      ...note,
      id: "note_" + Date.now() + "_" + Math.random().toString(36).substring(2, 6),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const updated = [newNote, ...notes];
    await this.safeSetItem(NOTES_STORAGE_KEY, JSON.stringify(updated));
    return newNote;
  }

  async deleteNote(id: string): Promise<void> {
    const notes = await this.getNotes();
    const filtered = notes.filter((n) => n.id !== id);
    await this.safeSetItem(NOTES_STORAGE_KEY, JSON.stringify(filtered));
  }

  async getEvents(): Promise<MobileEvent[]> {
    try {
      const json = await this.safeGetItem(EVENTS_STORAGE_KEY);
      if (!json) {
        return this.getDefaultEvents();
      }
      return JSON.parse(json);
    } catch (e) {
      console.error("[Storage] getEvents error:", e);
      return this.getDefaultEvents();
    }
  }

  async saveEvent(event: Omit<MobileEvent, "id" | "createdAt">): Promise<MobileEvent> {
    const events = await this.getEvents();
    const newEvent: MobileEvent = {
      ...event,
      id: "event_" + Date.now() + "_" + Math.random().toString(36).substring(2, 6),
      createdAt: Date.now(),
    };
    const updated = [newEvent, ...events];
    await this.safeSetItem(EVENTS_STORAGE_KEY, JSON.stringify(updated));
    return newEvent;
  }

  private getDefaultNotes(): MobileNote[] {
    return [
      {
        id: "default-note-1",
        title: "Chào mừng đến với V-Note Android (PhoVoice)",
        content: "Ứng dụng ghi âm thông minh hỗ trợ nhận diện giọng nói tiếng Việt hoàn toàn offline bằng công nghệ PhoVoice AI (Sherpa-ONNX Zipformer). Không cần kết nối mạng hay internet.",
        tags: ["Hướng dẫn", "PhoVoice"],
        folder: "Chung",
        createdAt: Date.now() - 3600000,
        updatedAt: Date.now() - 3600000,
      },
    ];
  }

  private getDefaultEvents(): MobileEvent[] {
    const now = new Date();
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    return [
      {
        id: "default-event-1",
        title: "Họp triển khai ứng dụng V-Note di động",
        startAt: tomorrow.toISOString(),
        meetingLink: "https://meet.google.com/abc-defg-hij",
        createdAt: Date.now(),
      },
    ];
  }
}

export const storage = new MobileStorageService();
