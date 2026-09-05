"use client";
import { useState, useEffect, useRef } from "react";
import {
  Cpu,
  Download,
  CheckCircle2,
  Loader2,
  Sparkles,
  RotateCw,
  Terminal,
  ChevronDown,
  ChevronUp,
  Copy,
  Trash2,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { api } from "@/trpc/react";
import { toast } from "sonner";

export default function PhoVoiceManageCard() {
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadPercent, setDownloadPercent] = useState(0);
  const [showLogs, setShowLogs] = useState(false);
  const [isRestarting, setIsRestarting] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);

  const utils = api.useUtils();

  const statusQuery = api.models.getPhoVoiceStatus.useQuery(undefined, {
    refetchInterval: 3000,
  });

  const isDownloadedQuery = api.models.isPhoVoiceModelDownloaded.useQuery(undefined, {
    refetchInterval: isDownloading ? 1500 : 5000,
  });

  const logsQuery = api.models.getPhoVoiceLogs.useQuery(undefined, {
    enabled: showLogs,
    refetchInterval: showLogs ? 1500 : false,
  });

  const clearLogsMutation = api.models.clearPhoVoiceLogs.useMutation({
    onSuccess: () => {
      utils.models.getPhoVoiceLogs.invalidate();
      toast.success("Đã xóa nhật ký");
    },
  });

  const restartMutation = api.models.restartPhoVoiceEngine.useMutation({
    onMutate: () => {
      setIsRestarting(true);
      toast.loading("Đang khởi động lại PhoVoice Local Engine...", {
        id: "restart-toast",
      });
    },
    onSuccess: (success) => {
      setIsRestarting(false);
      if (success) {
        toast.success("✅ Đã khởi động lại PhoVoice Engine thành công!", {
          id: "restart-toast",
        });
      } else {
        toast.error("⚠️ Khởi động lại chưa phản hồi, vui lòng kiểm tra Log.", {
          id: "restart-toast",
        });
      }
      statusQuery.refetch();
      logsQuery.refetch();
    },
    onError: (err) => {
      setIsRestarting(false);
      toast.error(`❌ Lỗi khởi động lại: ${err.message}`, {
        id: "restart-toast",
      });
    },
  });

  const downloadMutation = api.models.downloadPhoVoiceModel.useMutation({
    onMutate: () => {
      setIsDownloading(true);
      setDownloadPercent(5);
      toast.loading("Đang tải bộ mô hình PhoVoice Local (150MB)...", {
        id: "phovoice-download-toast",
      });
    },
    onSuccess: () => {
      setIsDownloading(false);
      setDownloadPercent(100);
      toast.success("✅ Đã tải và khởi động PhoVoice Local Engine thành công!", {
        id: "phovoice-download-toast",
      });
      isDownloadedQuery.refetch();
      statusQuery.refetch();
    },
    onError: (err) => {
      setIsDownloading(false);
      toast.error(`❌ Tải thất bại: ${err.message}`, {
        id: "phovoice-download-toast",
      });
    },
  });

  // Track download progress event
  api.models.onDownloadProgress.useSubscription(undefined, {
    onData: (data) => {
      if (data.modelId.includes("phovoice")) {
        setDownloadPercent(data.progress?.progress ?? 0);
      }
    },
    onError: () => {},
  });

  // Auto-scroll terminal log to bottom
  useEffect(() => {
    if (showLogs && logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logsQuery.data, showLogs]);

  const isReady = isDownloadedQuery.data && (statusQuery.data?.isReady || statusQuery.data?.isRunning);
  const logs = logsQuery.data || [];

  const handleCopyLogs = () => {
    if (logs.length === 0) return;
    navigator.clipboard.writeText(logs.join("\n"));
    toast.success("Đã sao chép toàn bộ nhật ký vào Clipboard!");
  };

  return (
    <div className="rounded-2xl border bg-card/60 p-4 shadow-xs flex flex-col gap-3 transition-all">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary border border-primary/20">
            <Sparkles className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-sm text-foreground">PhoVoice AI Tiếng Việt (100% Local)</h3>
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10.5px] font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                Mặc định
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Nhận dạng giọng nói Zipformer ASR, tách nhiều người nói CAM++ và phục hồi dấu câu ViBERT-Capu chạy trực tiếp trên máy.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Nút Reset Engine thủ công */}
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 px-2.5 text-xs font-medium border-border/80 hover:bg-accent cursor-pointer"
            onClick={() => restartMutation.mutate()}
            disabled={isRestarting}
            title="Khởi động lại tiến trình PhoVoice Local Engine"
          >
            <RotateCw className={`h-3.5 w-3.5 ${isRestarting ? "animate-spin text-primary" : "text-muted-foreground"}`} />
            <span>{isRestarting ? "Đang Reset..." : "Reset Engine"}</span>
          </Button>

          {isReady ? (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/25 text-emerald-600 dark:text-emerald-400 text-xs font-semibold">
              <CheckCircle2 className="h-3.5 w-3.5" />
              <span>Sẵn sàng (Offline)</span>
            </div>
          ) : isDownloading ? (
            <Button size="sm" variant="outline" disabled className="h-8 gap-1.5 text-xs font-medium">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
              <span>Đang tải {downloadPercent}%</span>
            </Button>
          ) : (
            <Button
              size="sm"
              className="h-8 gap-1.5 text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 cursor-pointer shadow-xs"
              onClick={() => downloadMutation.mutate()}
            >
              <Download className="h-3.5 w-3.5" />
              <span>Tải Model (150MB)</span>
            </Button>
          )}
        </div>
      </div>

      {isDownloading && (
        <div className="flex flex-col gap-1.5 mt-1 bg-muted/40 p-2.5 rounded-xl border border-border/40">
          <div className="flex items-center justify-between text-xs text-muted-foreground font-mono">
            <span>Tiến độ tải các thành phần (ASR, VAD, Diarization, Punctuation)...</span>
            <span>{downloadPercent}%</span>
          </div>
          <Progress value={downloadPercent} className="h-2" />
        </div>
      )}

      {/* Footer bar with Hardware info & Log Toggle */}
      <div className="flex items-center justify-between pt-2 border-t border-border/40 text-[11.5px] text-muted-foreground">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <Cpu className="h-3.5 w-3.5 text-muted-foreground/80" />
            <span>Phần cứng: {statusQuery.data?.device || "CPU Multi-threads"}</span>
          </div>
          <span className="text-border">•</span>
          <span>Cổng: {statusQuery.data?.baseURL || "http://127.0.0.1:18765"}</span>
        </div>

        <Button
          variant="ghost"
          size="sm"
          className="h-6 gap-1 px-2 text-[11px] text-muted-foreground hover:text-foreground font-medium cursor-pointer"
          onClick={() => setShowLogs(!showLogs)}
        >
          <Terminal className="h-3 w-3" />
          <span>{showLogs ? "Ẩn Nhật ký (Logs)" : "Xem Nhật ký (Logs)"}</span>
          {showLogs ? <ChevronUp className="h-3 w-3 ml-0.5" /> : <ChevronDown className="h-3 w-3 ml-0.5" />}
        </Button>
      </div>

      {/* Realtime Terminal Console Box */}
      {showLogs && (
        <div className="flex flex-col gap-2 p-3 bg-zinc-950 text-zinc-100 rounded-xl border border-zinc-800 shadow-inner mt-1 animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="flex items-center justify-between border-b border-zinc-800 pb-2 text-[11px]">
            <div className="flex items-center gap-2">
              <div className="flex gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-red-500/80 inline-block" />
                <span className="w-2.5 h-2.5 rounded-full bg-yellow-500/80 inline-block" />
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/80 inline-block" />
              </div>
              <span className="font-mono text-zinc-400">PhoVoice Local Engine Console Output</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Button
                variant="ghost"
                size="sm"
                className="h-5 px-1.5 text-[10px] text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"
                onClick={handleCopyLogs}
                title="Sao chép toàn bộ nhật ký"
              >
                <Copy className="h-3 w-3 mr-1" />
                <span>Sao chép</span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-5 px-1.5 text-[10px] text-zinc-400 hover:text-red-400 hover:bg-zinc-800"
                onClick={() => clearLogsMutation.mutate()}
                title="Xóa nhật ký hiển thị"
              >
                <Trash2 className="h-3 w-3 mr-1" />
                <span>Xóa log</span>
              </Button>
            </div>
          </div>

          <div className="font-mono text-[11px] leading-relaxed max-h-52 overflow-y-auto pr-1 space-y-0.5 select-text">
            {logs.length === 0 ? (
              <div className="text-zinc-500 italic py-2">Chưa có nhật ký hoạt động mới nào.</div>
            ) : (
              logs.map((line, idx) => {
                const isInfo = line.includes("[INFO]");
                const isErr = (line.includes("ERROR") || line.includes("Failed") || line.includes("Error") || line.includes("Traceback")) && !isInfo;
                const isSuccess = line.includes("200 OK") || line.includes("READY") || line.includes("ready") || line.includes("success") || line.includes("loaded OK");
                const isSys = line.includes("[System]");
                return (
                  <div
                    key={idx}
                    className={`break-all ${
                      isErr
                        ? "text-red-400"
                        : isSuccess
                          ? "text-emerald-400"
                          : isInfo
                            ? "text-cyan-400"
                            : isSys
                              ? "text-blue-400"
                              : "text-zinc-300"
                    }`}
                  >
                    {line}
                  </div>
                );
              })
            )}
            <div ref={logEndRef} />
          </div>
        </div>
      )}
    </div>
  );
}
