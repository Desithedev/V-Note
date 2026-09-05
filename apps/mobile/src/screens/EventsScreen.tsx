import React, { useState, useEffect } from "react";
import {
  StyleSheet,
  Text,
  View,
  FlatList,
  TouchableOpacity,
  Alert,
} from "react-native";
import { storage, MobileEvent } from "../services/storage";

export function EventsScreen() {
  const [events, setEvents] = useState<MobileEvent[]>([]);

  const loadEvents = async () => {
    const list = await storage.getEvents();
    setEvents(list);
  };

  useEffect(() => {
    loadEvents();
  }, []);

  const handleAddSampleEvent = async () => {
    const now = new Date();
    const eventTime = new Date(now.getTime() + 2 * 60 * 60 * 1000);
    await storage.saveEvent({
      title: "Cuộc họp mới với đối tác",
      startAt: eventTime.toISOString(),
      meetingLink: "https://meet.google.com/xyz-uvw",
    });
    loadEvents();
    Alert.alert("Thành công", "Đã thêm sự kiện lịch mới.");
  };

  const formatDate = (iso: string) => {
    try {
      const d = new Date(iso);
      return `${d.getHours()}:${d.getMinutes().toString().padStart(2, "0")} - Ngày ${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
    } catch {
      return iso;
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.headerTitle}>Sự Kiện & Lịch Họp</Text>
        <TouchableOpacity style={styles.addBtn} onPress={handleAddSampleEvent}>
          <Text style={styles.addBtnText}>+ Thêm sự kiện</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={events}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View style={styles.eventCard}>
            <Text style={styles.eventTitle}>{item.title}</Text>
            <Text style={styles.eventTime}>⏰ {formatDate(item.startAt)}</Text>
            {item.meetingLink && (
              <Text style={styles.eventLink} numberOfLines={1}>
                🔗 {item.meetingLink}
              </Text>
            )}
          </View>
        )}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>Chưa có sự kiện nào sắp tới.</Text>
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
    marginBottom: 16,
  },
  headerTitle: {
    color: "#F8FAFC",
    fontSize: 20,
    fontWeight: "700",
  },
  addBtn: {
    backgroundColor: "#2563EB",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  addBtnText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "600",
  },
  eventCard: {
    backgroundColor: "#111827",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#1F2937",
    padding: 14,
    marginBottom: 12,
  },
  eventTitle: {
    color: "#F1F5F9",
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 6,
  },
  eventTime: {
    color: "#38BDF8",
    fontSize: 13,
    marginBottom: 4,
  },
  eventLink: {
    color: "#94A3B8",
    fontSize: 12,
  },
  emptyContainer: {
    alignItems: "center",
    paddingVertical: 60,
  },
  emptyText: {
    color: "#64748B",
    fontSize: 15,
  },
});
