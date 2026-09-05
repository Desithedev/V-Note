import React, { useState, useEffect, useRef } from "react";
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ScrollView,
  Alert,
  Animated,
  ActivityIndicator,
} from "react-native";
import { phovoice, PhoVoiceTranscription } from "../services/phovoice";
import { storage } from "../services/storage";

interface RecordScreenProps {
  onNoteCreated?: () => void;
}

export function RecordScreen({ onNoteCreated }: RecordScreenProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState("");
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);

  const pulseAnim = useRef(new Animated.Value(1)).current;
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    // Lắng nghe sự kiện nhận diện realtime từ PhoVoice Engine
    const unsubscribe = phovoice.onTranscription((data: PhoVoiceTranscription) => {
      setLiveTranscript(data.text);
    });

    return () => {
      unsubscribe();
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // Animation nhịp đập khi đang thu âm
  useEffect(() => {
    if (isRecording) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.15,
            duration: 800,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1.0,
            duration: 800,
            useNativeDriver: true,
          }),
        ]),
      ).start();
    } else {
      pulseAnim.setValue(1);
    }
  }, [isRecording]);

  const handleToggleRecord = async () => {
    if (!isRecording) {
      // Bắt đầu ghi âm
      try {
        setLiveTranscript("");
        setRecordSeconds(0);
        await phovoice.startRecording();
        setIsRecording(true);

        timerRef.current = setInterval(() => {
          setRecordSeconds((prev) => prev + 1);
        }, 1000);
      } catch (err: any) {
        Alert.alert("Lỗi Ghi Âm", err?.message || "Không thể khởi động microphone");
      }
    } else {
      // Dừng ghi âm
      try {
        setIsProcessing(true);
        if (timerRef.current) clearInterval(timerRef.current);
        const result = await phovoice.stopRecording();
        setIsRecording(false);
        setIsProcessing(false);

        const finalText = result.text || liveTranscript;

        if (finalText.trim().length > 0) {
          // Lưu vào Ghi chú
          const title = "Ghi âm " + new Date().toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
          await storage.saveNote({
            title,
            content: finalText,
            audioPath: result.audioPath,
            durationMs: result.durationMs,
            tags: ["PhoVoice", "Offline"],
            folder: "Ghi âm",
          });

          Alert.alert(
            "Đã Lưu Ghi Chú",
            `Đã ghi nhận thành công ${finalText.length} ký tự bằng PhoVoice Offline.`,
            [
              {
                text: "Xem ghi chú",
                onPress: () => onNoteCreated?.(),
              },
              { text: "Đóng", style: "cancel" },
            ],
          );
        }
      } catch (err: any) {
        setIsProcessing(false);
        Alert.alert("Lỗi", err?.message || "Lỗi khi xử lý âm thanh");
      }
    }
  };

  const formatTime = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const remainingSecs = secs % 60;
    return `${mins.toString().padStart(2, "0")}:${remainingSecs.toString().padStart(2, "0")}`;
  };

  return (
    <View style={styles.container}>
      {/* Header Badge */}
      <View style={styles.badgeContainer}>
        <View style={styles.badge}>
          <View style={[styles.statusDot, isRecording ? styles.dotRecording : styles.dotReady]} />
          <Text style={styles.badgeText}>PhoVoice AI • 100% Offline</Text>
        </View>
        <Text style={styles.subBadgeText}>Sherpa-ONNX Zipformer 30M Tiếng Việt</Text>
      </View>

      {/* Transcript Box */}
      <View style={styles.transcriptCard}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>NỘI DUNG NHẬN DIỆN THỰC THỜI</Text>
          {isRecording && <Text style={styles.listeningText}>Đang nghe...</Text>}
        </View>

        <ScrollView style={styles.scrollArea} contentContainerStyle={styles.scrollContent}>
          {liveTranscript.length > 0 ? (
            <Text style={styles.transcriptText}>{liveTranscript}</Text>
          ) : (
            <Text style={styles.placeholderText}>
              {isRecording
                ? "Hãy nói tiếng Việt... PhoVoice đang giải mã tức thì không cần internet."
                : "Nhấn nút micro bên dưới để bắt đầu ghi âm và nhận diện tiếng Việt ngoại tuyến."}
            </Text>
          )}
        </ScrollView>
      </View>

      {/* Timer & Controls */}
      <View style={styles.controlArea}>
        <Text style={styles.timerText}>{formatTime(recordSeconds)}</Text>

        <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
          <TouchableOpacity
            style={[styles.micButton, isRecording ? styles.micButtonRecording : styles.micButtonIdle]}
            onPress={handleToggleRecord}
            disabled={isProcessing}
            activeOpacity={0.8}
          >
            {isProcessing ? (
              <ActivityIndicator size="large" color="#ffffff" />
            ) : (
              <View style={isRecording ? styles.stopIcon : styles.micIcon} />
            )}
          </TouchableOpacity>
        </Animated.View>

        <Text style={styles.instructionText}>
          {isRecording ? "Chạm để Dừng & Lưu vào Note" : "Chạm để Bắt đầu Ghi âm"}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0B0F17",
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  badgeContainer: {
    alignItems: "center",
    marginBottom: 16,
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#161E2E",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#1E293B",
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  dotReady: {
    backgroundColor: "#10B981",
  },
  dotRecording: {
    backgroundColor: "#EF4444",
  },
  badgeText: {
    color: "#E2E8F0",
    fontSize: 12,
    fontWeight: "600",
  },
  subBadgeText: {
    color: "#64748B",
    fontSize: 11,
    marginTop: 4,
  },
  transcriptCard: {
    flex: 1,
    backgroundColor: "#111827",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#1F2937",
    padding: 16,
    marginBottom: 20,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#1F2937",
    paddingBottom: 8,
  },
  cardTitle: {
    color: "#94A3B8",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  listeningText: {
    color: "#38BDF8",
    fontSize: 11,
    fontWeight: "600",
  },
  scrollArea: {
    flex: 1,
  },
  scrollContent: {
    paddingVertical: 4,
  },
  transcriptText: {
    color: "#F8FAFC",
    fontSize: 18,
    lineHeight: 28,
    fontWeight: "500",
  },
  placeholderText: {
    color: "#475569",
    fontSize: 15,
    lineHeight: 24,
    fontStyle: "italic",
  },
  controlArea: {
    alignItems: "center",
    paddingBottom: 32,
  },
  timerText: {
    color: "#94A3B8",
    fontSize: 24,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
    marginBottom: 16,
  },
  micButton: {
    width: 76,
    height: 76,
    borderRadius: 38,
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  micButtonIdle: {
    backgroundColor: "#2563EB",
  },
  micButtonRecording: {
    backgroundColor: "#DC2626",
  },
  micIcon: {
    width: 24,
    height: 32,
    borderRadius: 12,
    backgroundColor: "#FFFFFF",
  },
  stopIcon: {
    width: 24,
    height: 24,
    borderRadius: 4,
    backgroundColor: "#FFFFFF",
  },
  instructionText: {
    color: "#94A3B8",
    fontSize: 13,
    marginTop: 14,
    fontWeight: "500",
  },
});
