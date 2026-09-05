"use client";

import React from "react";
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
import { Loader2 } from "lucide-react";

interface EventDeleteDialogProps {
  eventId: string | null;
  eventTitle?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted?: () => void;
}

export function EventDeleteDialog({
  eventId,
  eventTitle,
  open,
  onOpenChange,
  onDeleted,
}: EventDeleteDialogProps) {
  const utils = api.useUtils();

  const deleteMutation = api.events.delete.useMutation({
    onSuccess: () => {
      toast.success("Đã xóa sự kiện thành công");
      utils.events.getAll.invalidate();
      utils.events.getUpcoming.invalidate();
      onOpenChange(false);
      onDeleted?.();
    },
    onError: (err) => {
      toast.error(`Không thể xóa sự kiện: ${err.message}`);
    },
  });

  const handleDelete = () => {
    if (!eventId) return;
    deleteMutation.mutate({ id: eventId });
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Xóa sự kiện?</AlertDialogTitle>
          <AlertDialogDescription>
            Bạn có chắc chắn muốn xóa sự kiện{" "}
            {eventTitle ? (
              <strong className="text-foreground">"{eventTitle}"</strong>
            ) : (
              "này"
            )}{" "}
            khỏi lịch không? Hành động này không thể hoàn tác.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleteMutation.isPending}>
            Hủy
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              handleDelete();
            }}
            disabled={deleteMutation.isPending}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {deleteMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Đang xóa...
              </>
            ) : (
              "Xác nhận xóa"
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
