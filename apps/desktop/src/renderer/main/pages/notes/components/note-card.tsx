"use client";

import { useState } from "react";
import {
  File,
  Calendar,
  Folder,
  FolderMinus,
  Tag,
  Trash2,
  Star,
  StarOff,
  Copy,
  ExternalLink,
  Check,
} from "lucide-react";
import { cn, formatDate, formatTime24 } from "@/lib/utils";
import { Note } from "../types";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
  ContextMenuCheckboxItem,
} from "@/components/ui/context-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { api } from "@/trpc/react";
import { toast } from "sonner";
import { copyToClipboard } from "@/lib/clipboard";

interface RecentNoteCardProps {
  note: Note;
  onNoteClick: (noteId: number) => void;
  showTimeOnly?: boolean;
}

export function NoteCard({
  note,
  onNoteClick,
  showTimeOnly = false,
}: RecentNoteCardProps) {
  const utils = api.useUtils();
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  // Queries for folders and tags
  const treeQ = api.folders.tree.useQuery();
  const tagsQ = api.tags.list.useQuery({});
  const noteTagsQ = api.tags.getForNote.useQuery({ noteId: note.id });

  const folders = treeQ.data?.folders ?? [];
  const tags = tagsQ.data ?? [];
  const attachedTagIds = new Set(noteTagsQ.data?.map((t) => t.id) ?? []);

  // Mutations
  const updateOrgMutation = api.notes.updateNoteOrganization.useMutation({
    onSuccess: () => {
      utils.notes.getNotes.invalidate();
      utils.notes.getNoteById.invalidate({ id: note.id });
      utils.folders.tree.invalidate();
    },
    onError: (err) => {
      toast.error(`Lỗi cập nhật: ${err.message}`);
    },
  });

  const attachTagMutation = api.tags.attach.useMutation({
    onSuccess: () => {
      utils.tags.getForNote.invalidate({ noteId: note.id });
      utils.notes.getNotes.invalidate();
      utils.tags.listWithCounts.invalidate();
      toast.success("Đã gắn thẻ");
    },
    onError: (err) => {
      toast.error(`Lỗi gắn thẻ: ${err.message}`);
    },
  });

  const detachTagMutation = api.tags.detach.useMutation({
    onSuccess: () => {
      utils.tags.getForNote.invalidate({ noteId: note.id });
      utils.notes.getNotes.invalidate();
      utils.tags.listWithCounts.invalidate();
      toast.success("Đã gỡ thẻ");
    },
    onError: (err) => {
      toast.error(`Lỗi gỡ thẻ: ${err.message}`);
    },
  });

  const deleteNoteMutation = api.notes.deleteNote.useMutation({
    onSuccess: () => {
      utils.notes.getNotes.invalidate();
      utils.folders.tree.invalidate();
      utils.tags.listWithCounts.invalidate();
      toast.success("Đã xóa ghi chú");
    },
    onError: (err) => {
      toast.error(`Lỗi xóa ghi chú: ${err.message}`);
    },
  });

  const handleToggleTag = (tagId: number, isAttached: boolean) => {
    if (isAttached) {
      detachTagMutation.mutate({ noteId: note.id, tagId });
    } else {
      attachTagMutation.mutate({ noteId: note.id, tagId });
    }
  };

  const handleMoveToFolder = (folderId: number | null) => {
    updateOrgMutation.mutate(
      { id: note.id, folderId },
      {
        onSuccess: () => {
          toast.success(
            folderId === null ? "Đã gỡ khỏi thư mục" : "Đã chuyển vào thư mục",
          );
        },
      },
    );
  };

  const handleToggleFavorite = () => {
    const next = !note.starred;
    updateOrgMutation.mutate(
      { id: note.id, starred: next },
      {
        onSuccess: () => {
          toast.success(next ? "Đã thêm vào Yêu thích" : "Đã bỏ khỏi Yêu thích");
        },
      },
    );
  };

  const handleCopyTitle = async () => {
    const ok = await copyToClipboard(note.title);
    if (ok) {
      toast.success("Đã sao chép tiêu đề");
    } else {
      toast.error("Không thể sao chép");
    }
  };

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            onClick={() => onNoteClick(note.id)}
            className={cn(
              "flex items-start gap-3 py-2 px-3 rounded-lg transition-colors group cursor-pointer",
              "hover:bg-accent/50 hover:text-accent-foreground",
            )}
            tabIndex={0}
            role="button"
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onNoteClick(note.id);
              }
            }}
          >
            {/* Note Icon */}
            <div className="flex-shrink-0 mt-0.5">
              {note.icon ? (
                <span className="text-lg">{note.icon}</span>
              ) : (
                <File className="w-5 h-5 text-muted-foreground" />
              )}
            </div>

            {/* Note Content */}
            <div className="flex-1 min-w-0">
              {/* Note Name & Audio Badge */}
              <div className="flex items-center justify-between gap-1.5">
                <div className="font-medium text-foreground text-sm leading-tight truncate flex items-center gap-1.5">
                  {note.starred && (
                    <Star className="size-3 shrink-0 fill-yellow-400 text-yellow-400" />
                  )}
                  <span className="truncate">{note.title}</span>
                </div>
                {(note.audioFile || note.title?.startsWith("🎙️")) && (
                  <span className="shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-500/15 text-amber-300 border border-amber-500/25">
                    🎙️ Audio
                  </span>
                )}
              </div>

              {/* Date and Meeting Info */}
              <div className="flex items-center gap-1.5 mt-1 text-xs text-muted-foreground">
                <span>
                  {showTimeOnly
                    ? formatTime24(new Date(note.updatedAt))
                    : formatDate(new Date(note.updatedAt))}
                </span>

                {note.eventData && (
                  <>
                    <span className="w-1 h-1 bg-muted-foreground rounded-full"></span>
                    <div className="flex items-center gap-1">
                      <Calendar
                        className="w-3 h-3"
                        style={{ color: note.eventData.calendarColor }}
                      />
                      <span className="">{note.eventData.title}</span>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </ContextMenuTrigger>

        <ContextMenuContent className="w-56">
          <ContextMenuItem onClick={() => onNoteClick(note.id)}>
            <ExternalLink className="mr-2 size-4" />
            <span>Mở ghi chú</span>
          </ContextMenuItem>

          <ContextMenuSeparator />

          {/* Submenu: Move to Folder */}
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <Folder className="mr-2 size-4 text-sky-500" />
              <span>Thư mục</span>
            </ContextMenuSubTrigger>
            <ContextMenuSubContent className="w-48 max-h-60 overflow-y-auto">
              {note.folderId && (
                <>
                  <ContextMenuItem onClick={() => handleMoveToFolder(null)}>
                    <FolderMinus className="mr-2 size-4 text-muted-foreground" />
                    <span>Gỡ khỏi thư mục</span>
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                </>
              )}
              {folders.length === 0 ? (
                <div className="px-2 py-1.5 text-xs text-muted-foreground">
                  Chưa có thư mục nào
                </div>
              ) : (
                folders.map((f) => {
                  const isSelected = note.folderId === f.id;
                  return (
                    <ContextMenuItem
                      key={f.id}
                      onClick={() => handleMoveToFolder(f.id)}
                      className="justify-between"
                    >
                      <div className="flex items-center gap-2 truncate">
                        <Folder className="size-4 shrink-0 text-muted-foreground" />
                        <span className="truncate">{f.name}</span>
                      </div>
                      {isSelected && (
                        <Check className="size-3.5 shrink-0 text-primary" />
                      )}
                    </ContextMenuItem>
                  );
                })
              )}
            </ContextMenuSubContent>
          </ContextMenuSub>

          {/* Submenu: Tags */}
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <Tag className="mr-2 size-4 text-emerald-500" />
              <span>Thẻ</span>
            </ContextMenuSubTrigger>
            <ContextMenuSubContent className="w-48 max-h-60 overflow-y-auto">
              {tags.length === 0 ? (
                <div className="px-2 py-1.5 text-xs text-muted-foreground">
                  Chưa có thẻ nào
                </div>
              ) : (
                tags.map((t) => {
                  const isAttached = attachedTagIds.has(t.id);
                  return (
                    <ContextMenuCheckboxItem
                      key={t.id}
                      checked={isAttached}
                      onCheckedChange={() => handleToggleTag(t.id, isAttached)}
                    >
                      <span
                        className="size-2 rounded-full mr-1.5 shrink-0"
                        style={{ backgroundColor: t.color || "#888888" }}
                      />
                      <span className="truncate">{t.name}</span>
                    </ContextMenuCheckboxItem>
                  );
                })
              )}
            </ContextMenuSubContent>
          </ContextMenuSub>

          {/* Favorite Toggle */}
          <ContextMenuItem onClick={handleToggleFavorite}>
            {note.starred ? (
              <>
                <StarOff className="mr-2 size-4 text-yellow-500" />
                <span>Bỏ yêu thích</span>
              </>
            ) : (
              <>
                <Star className="mr-2 size-4 text-yellow-500" />
                <span>Thêm vào Yêu thích</span>
              </>
            )}
          </ContextMenuItem>

          <ContextMenuSeparator />

          {/* Copy Title */}
          <ContextMenuItem onClick={handleCopyTitle}>
            <Copy className="mr-2 size-4 text-muted-foreground" />
            <span>Sao chép tiêu đề</span>
          </ContextMenuItem>

          {/* Delete Note */}
          <ContextMenuItem
            onClick={() => setShowDeleteDialog(true)}
            className="text-destructive focus:bg-destructive/10 focus:text-destructive"
          >
            <Trash2 className="mr-2 size-4" />
            <span>Xóa ghi chú</span>
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      {/* Delete Confirmation Alert Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Xóa ghi chú?</AlertDialogTitle>
            <AlertDialogDescription>
              Bạn có chắc chắn muốn xóa ghi chú &quot;{note.title}&quot; không?
              Thao tác này sẽ xóa vĩnh viễn và không thể hoàn tác.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Hủy</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteNoteMutation.mutate({ id: note.id })}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Xóa
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
