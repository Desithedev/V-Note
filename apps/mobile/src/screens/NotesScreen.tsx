import React, { useState, useEffect } from "react";
import {
  StyleSheet,
  Text,
  View,
  FlatList,
  TouchableOpacity,
  TextInput,
  Alert,
} from "react-native";
import { storage, MobileNote } from "../services/storage";

export function NotesScreen() {
  const [notes, setNotes] = useState<MobileNote[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedNote, setSelectedNote] = useState<MobileNote | null>(null);

  const loadNotes = async () => {
    const list = await storage.getNotes();
    setNotes(list);
  };

  useEffect(() => {
    loadNotes();
  }, []);

  const handleDelete = (note: MobileNote) => {
    Alert.alert("Xóa Ghi Chú", `Bạn có chắc muốn xóa "${note.title}"?`, [
      { text: "Hủy", style: "cancel" },
      {
        text: "Xóa",
        style: "destructive",
        onPress: async () => {
          await storage.deleteNote(note.id);
          if (selectedNote?.id === note.id) setSelectedNote(null);
          loadNotes();
        },
      },
    ]);
  };

  const filteredNotes = notes.filter(
    (n) =>
      n.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      n.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
      n.tags.some((t) => t.toLowerCase().includes(searchQuery.toLowerCase())),
  );

  const formatDate = (timestamp: number) => {
    const d = new Date(timestamp);
    return `${d.getDate()}/${d.getMonth() + 1} ${d.getHours()}:${d.getMinutes().toString().padStart(2, "0")}`;
  };

  if (selectedNote) {
    return (
      <View style={styles.container}>
        <TouchableOpacity style={styles.backButton} onPress={() => setSelectedNote(null)}>
          <Text style={styles.backButtonText}>← Quay lại danh sách</Text>
        </TouchableOpacity>

        <View style={styles.detailCard}>
          <Text style={styles.detailTitle}>{selectedNote.title}</Text>
          <Text style={styles.detailDate}>Tạo lúc: {formatDate(selectedNote.createdAt)}</Text>

          <View style={styles.tagRow}>
            {selectedNote.tags.map((tag) => (
              <View key={tag} style={styles.tagBadge}>
                <Text style={styles.tagText}>{tag}</Text>
              </View>
            ))}
          </View>

          <View style={styles.divider} />

          <Text style={styles.detailContent}>{selectedNote.content}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.headerTitle}>Ghi Chú PhoVoice ({notes.length})</Text>
        <TouchableOpacity style={styles.refreshBtn} onPress={loadNotes}>
          <Text style={styles.refreshBtnText}>Làm mới</Text>
        </TouchableOpacity>
      </View>

      <TextInput
        style={styles.searchInput}
        placeholder="Tìm kiếm nội dung ghi chú..."
        placeholderTextColor="#64748B"
        value={searchQuery}
        onChangeText={setSearchQuery}
      />

      <FlatList
        data={filteredNotes}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.noteCard}
            activeOpacity={0.7}
            onPress={() => setSelectedNote(item)}
            onLongPress={() => handleDelete(item)}
          >
            <View style={styles.cardTopRow}>
              <Text style={styles.noteTitle} numberOfLines={1}>
                {item.title}
              </Text>
              <Text style={styles.noteDate}>{formatDate(item.createdAt)}</Text>
            </View>

            <Text style={styles.noteSnippet} numberOfLines={3}>
              {item.content}
            </Text>

            <View style={styles.tagRow}>
              {item.tags.map((t) => (
                <View key={t} style={styles.tagBadge}>
                  <Text style={styles.tagText}>{t}</Text>
                </View>
              ))}
            </View>
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>Chưa có ghi chú nào.</Text>
            <Text style={styles.emptySubText}>Hãy chuyển sang tab Ghi âm để bắt đầu thu âm bằng PhoVoice.</Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0B0F17",
    padding: 16,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  headerTitle: {
    color: "#F8FAFC",
    fontSize: 20,
    fontWeight: "700",
  },
  refreshBtn: {
    backgroundColor: "#1E293B",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  refreshBtnText: {
    color: "#38BDF8",
    fontSize: 12,
    fontWeight: "600",
  },
  searchInput: {
    backgroundColor: "#111827",
    borderWidth: 1,
    borderColor: "#1F2937",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: "#F8FAFC",
    fontSize: 14,
    marginBottom: 14,
  },
  listContent: {
    paddingBottom: 24,
  },
  noteCard: {
    backgroundColor: "#111827",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#1F2937",
    padding: 14,
    marginBottom: 12,
  },
  cardTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  noteTitle: {
    color: "#F1F5F9",
    fontSize: 16,
    fontWeight: "600",
    flex: 1,
    marginRight: 8,
  },
  noteDate: {
    color: "#64748B",
    fontSize: 11,
  },
  noteSnippet: {
    color: "#94A3B8",
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 10,
  },
  tagRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  tagBadge: {
    backgroundColor: "#1E293B",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  tagText: {
    color: "#38BDF8",
    fontSize: 11,
    fontWeight: "500",
  },
  emptyContainer: {
    alignItems: "center",
    paddingVertical: 60,
  },
  emptyText: {
    color: "#64748B",
    fontSize: 16,
    fontWeight: "600",
  },
  emptySubText: {
    color: "#475569",
    fontSize: 13,
    marginTop: 6,
    textAlign: "center",
  },
  backButton: {
    paddingVertical: 8,
    marginBottom: 12,
  },
  backButtonText: {
    color: "#38BDF8",
    fontSize: 15,
    fontWeight: "600",
  },
  detailCard: {
    flex: 1,
    backgroundColor: "#111827",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#1F2937",
    padding: 18,
  },
  detailTitle: {
    color: "#F8FAFC",
    fontSize: 22,
    fontWeight: "700",
    marginBottom: 6,
  },
  detailDate: {
    color: "#64748B",
    fontSize: 12,
    marginBottom: 12,
  },
  divider: {
    height: 1,
    backgroundColor: "#1F2937",
    marginVertical: 14,
  },
  detailContent: {
    color: "#E2E8F0",
    fontSize: 16,
    lineHeight: 26,
  },
});
