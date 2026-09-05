import { FileAudio, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { api } from "@/trpc/react";
import { toast } from "sonner";
import { useNavigate } from "@tanstack/react-router";

export function HeaderImportAudioButton() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const utils = api.useUtils();

  const importMutation = api.transcriptions.importAndTranscribeAudioFile.useMutation({
    onMutate: () => {
      toast.loading("Đang đọc file âm thanh & gửi lên PhoVoice VPS...", {
        id: "import-audio-toast",
      });
    },
    onSuccess: (data) => {
      if (data.canceled) {
        toast.dismiss("import-audio-toast");
        return;
      }

      toast.success(`✅ Đã trích xuất thành công: ${data.title || "ghi chú mới"} (${data.duration}s)`, {
        id: "import-audio-toast",
      });

      utils.notes.getNotes.invalidate();
      utils.notes.getNoteById.invalidate();
      utils.transcriptions.getTranscriptions.invalidate();

      if (data.noteId) {
        navigate({
          to: "/notes/$noteId",
          params: { noteId: String(data.noteId) },
        });
      }
    },
    onError: (err) => {
      toast.error(`❌ Trích xuất thất bại: ${err.message}`, {
        id: "import-audio-toast",
        duration: 5000,
      });
    },
  });

  return (
    <Button
      variant="outline"
      size="sm"
      className="h-7 gap-1.5 px-2.5 text-xs font-medium text-foreground bg-background hover:bg-accent hover:text-accent-foreground border-input shadow-xs transition-colors cursor-pointer"
      onClick={() => importMutation.mutate()}
      disabled={importMutation.isPending}
      title="Chọn tệp âm thanh (MP3, WAV, M4A, AAC, WEBM, OGG, FLAC) để PhoVoice phiên âm thành Note"
    >
      {importMutation.isPending ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
      ) : (
        <FileAudio className="h-3.5 w-3.5 text-muted-foreground" />
      )}
      <span>
        {importMutation.isPending
          ? t("settings.notes.importingAudio", "Đang xử lý...")
          : t("settings.notes.importAudio", "Nhập âm thanh")}
      </span>
    </Button>
  );
}
