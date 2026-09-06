import React, { useState } from "react";
import {
  SafeAreaView,
  StatusBar,
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
} from "react-native";
import { RecordScreen } from "./screens/RecordScreen";
import { NotesScreen } from "./screens/NotesScreen";
import { EventsScreen } from "./screens/EventsScreen";
import { SettingsScreen } from "./screens/SettingsScreen";

type TabType = "record" | "notes" | "events" | "settings";

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: any) {
    console.error("[VNote App] ErrorBoundary caught error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.errorContainer}>
          <Text style={styles.errorTitle}>Đã xảy ra sự cố hiển thị</Text>
          <Text style={styles.errorMessage}>
            {this.state.error?.message || "Không rõ nguyên nhân"}
          </Text>
          <TouchableOpacity
            style={styles.retryBtn}
            onPress={() => this.setState({ hasError: false, error: null })}
          >
            <Text style={styles.retryBtnText}>Thử lại</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  const [activeTab, setActiveTab] = useState<TabType>("record");

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0B0F17" />

      <ErrorBoundary>
        {/* Main Content Area */}
        <View style={styles.content}>
          {activeTab === "record" && (
            <RecordScreen onNoteCreated={() => setActiveTab("notes")} />
          )}
          {activeTab === "notes" && <NotesScreen />}
          {activeTab === "events" && <EventsScreen />}
          {activeTab === "settings" && <SettingsScreen />}
        </View>

        {/* Bottom Navigation Bar */}
        <View style={styles.tabBar}>
          <TouchableOpacity
            style={[styles.tabItem, activeTab === "record" && styles.tabItemActive]}
            onPress={() => setActiveTab("record")}
            activeOpacity={0.7}
          >
            <Text style={[styles.tabIcon, activeTab === "record" && styles.tabIconActive]}>
              🎙️
            </Text>
            <Text style={[styles.tabLabel, activeTab === "record" && styles.tabLabelActive]}>
              Ghi Âm
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.tabItem, activeTab === "notes" && styles.tabItemActive]}
            onPress={() => setActiveTab("notes")}
            activeOpacity={0.7}
          >
            <Text style={[styles.tabIcon, activeTab === "notes" && styles.tabIconActive]}>
              📝
            </Text>
            <Text style={[styles.tabLabel, activeTab === "notes" && styles.tabLabelActive]}>
              Ghi Chú
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.tabItem, activeTab === "events" && styles.tabItemActive]}
            onPress={() => setActiveTab("events")}
            activeOpacity={0.7}
          >
            <Text style={[styles.tabIcon, activeTab === "events" && styles.tabIconActive]}>
              📅
            </Text>
            <Text style={[styles.tabLabel, activeTab === "events" && styles.tabLabelActive]}>
              Sự Kiện
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.tabItem, activeTab === "settings" && styles.tabItemActive]}
            onPress={() => setActiveTab("settings")}
            activeOpacity={0.7}
          >
            <Text style={[styles.tabIcon, activeTab === "settings" && styles.tabIconActive]}>
              ⚙️
            </Text>
            <Text style={[styles.tabLabel, activeTab === "settings" && styles.tabLabelActive]}>
              Cài Đặt
            </Text>
          </TouchableOpacity>
        </View>
      </ErrorBoundary>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0B0F17",
  },
  content: {
    flex: 1,
  },
  tabBar: {
    flexDirection: "row",
    height: 64,
    backgroundColor: "#111827",
    borderTopWidth: 1,
    borderTopColor: "#1F2937",
    paddingBottom: 4,
    paddingTop: 6,
  },
  tabItem: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  tabItemActive: {},
  tabIcon: {
    fontSize: 20,
    opacity: 0.6,
    marginBottom: 2,
  },
  tabIconActive: {
    opacity: 1,
  },
  tabLabel: {
    color: "#64748B",
    fontSize: 11,
    fontWeight: "500",
  },
  tabLabelActive: {
    color: "#38BDF8",
    fontWeight: "700",
  },
  errorContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
    backgroundColor: "#0B0F17",
  },
  errorTitle: {
    color: "#EF4444",
    fontSize: 18,
    fontWeight: "bold",
    marginBottom: 8,
  },
  errorMessage: {
    color: "#94A3B8",
    fontSize: 13,
    textAlign: "center",
    marginBottom: 20,
    lineHeight: 18,
  },
  retryBtn: {
    backgroundColor: "#2563EB",
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  retryBtnText: {
    color: "#FFFFFF",
    fontWeight: "600",
    fontSize: 14,
  },
});
