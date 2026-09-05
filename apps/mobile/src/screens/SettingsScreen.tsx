import React, { useState, useEffect } from "react";
import { StyleSheet, Text, View, ScrollView } from "react-native";
import { phovoice, PhoVoiceModelStatus } from "../services/phovoice";

export function SettingsScreen() {
  const [status, setStatus] = useState<PhoVoiceModelStatus | null>(null);

  useEffect(() => {
    phovoice.getStatus().then(setStatus);
  }, []);

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>Cài Đặt & Cấu Hình</Text>

      {/* PhoVoice Engine Status */}
      <View style={styles.card}>
        <Text style={styles.cardHeader}>ĐỘNG CƠ PHOVOICE TIẾNG VIỆT</Text>

        <View style={styles.row}>
          <Text style={styles.label}>Trạng thái STT:</Text>
          <View style={styles.badgeSuccess}>
            <Text style={styles.badgeSuccessText}>100% Offline (Không cần mạng)</Text>
          </View>
        </View>

        <View style={styles.row}>
          <Text style={styles.label}>Tên mô hình:</Text>
          <Text style={styles.value}>{status?.modelName || "PhoVoice Zipformer 30M"}</Text>
        </View>

        <View style={styles.row}>
          <Text style={styles.label}>Lõi suy luận:</Text>
          <Text style={styles.value}>{status?.engine || "Sherpa-ONNX Native C++"}</Text>
        </View>

        <View style={styles.row}>
          <Text style={styles.label}>Tần số lấy mẫu:</Text>
          <Text style={styles.value}>16.000 Hz Mono</Text>
        </View>

        <View style={styles.row}>
          <Text style={styles.label}>Ngôn ngữ:</Text>
          <Text style={styles.value}>Tiếng Việt (Vietnamese)</Text>
        </View>
      </View>

      {/* App Information */}
      <View style={styles.card}>
        <Text style={styles.cardHeader}>THÔNG TIN ỨNG DỤNG</Text>

        <View style={styles.row}>
          <Text style={styles.label}>Phiên bản:</Text>
          <Text style={styles.value}>V-Note Android v0.1.0</Text>
        </View>

        <View style={styles.row}>
          <Text style={styles.label}>Lưu trữ:</Text>
          <Text style={styles.value}>Nội bộ trên thiết bị (SQLite)</Text>
        </View>

        <View style={styles.row}>
          <Text style={styles.label}>Quyền riêng tư:</Text>
          <Text style={styles.value}>Toàn bộ âm thanh xử lý cục bộ</Text>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0B0F17",
    padding: 16,
  },
  title: {
    color: "#F8FAFC",
    fontSize: 20,
    fontWeight: "700",
    marginBottom: 16,
  },
  card: {
    backgroundColor: "#111827",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#1F2937",
    padding: 16,
    marginBottom: 16,
  },
  cardHeader: {
    color: "#38BDF8",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.5,
    marginBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#1F2937",
    paddingBottom: 6,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 8,
  },
  label: {
    color: "#94A3B8",
    fontSize: 14,
  },
  value: {
    color: "#F1F5F9",
    fontSize: 14,
    fontWeight: "500",
  },
  badgeSuccess: {
    backgroundColor: "rgba(16, 185, 129, 0.15)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  badgeSuccessText: {
    color: "#10B981",
    fontSize: 12,
    fontWeight: "600",
  },
});
