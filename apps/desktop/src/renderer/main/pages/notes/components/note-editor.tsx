import { useState, useEffect, useRef, useMemo } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import { DragHandle } from "@tiptap/extension-drag-handle-react";
import { Loader2, GripVertical } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { NoteSyncProvider } from "@/renderer/main/providers/sync-provider";
import { useSkillDiffDecorations } from "@/renderer/main/components/editor/diff/use-skill-diff-decorations";
import { SkillDiffEditorLock } from "@/renderer/main/components/editor/diff/skill-diff-editor-lock";
import { useSkillDiffStore } from "@/renderer/main/components/editor/diff/skill-diff-store";
import { useSkillDiffToastStore } from "@/renderer/main/components/editor/diff/skill-diff-toast-store";
import { InlineSkillPopoverPlugin } from "@/renderer/main/components/editor/inline-skill-popover/inline-skill-popover-plugin";
import { FindInPagePlugin } from "@/renderer/main/components/editor/find-in-page-plugin";
import { useRegisterNoteEditor } from "@/renderer/main/components/note-editor-context";
import { buildRendererExtensions } from "../utils/editor-shared";

// Keys whose default behaviour mutates the document. Used to gate the
// attention-pulse so navigation / modifier / system keys don't shake
// the dock bar.
function isContentMutatingKey(event: KeyboardEvent): boolean {
  if (event.metaKey || event.ctrlKey || event.altKey) return false;
  switch (event.key) {
    case "ArrowLeft":
    case "ArrowRight":
    case "ArrowUp":
    case "ArrowDown":
    case "Home":
    case "End":
    case "PageUp":
    case "PageDown":
    case "Escape":
    case "Shift":
    case "CapsLock":
    case "Meta":
    case "Control":
    case "Alt":
      return false;
    default:
      return true;
  }
}

interface NoteEditorProps {
  noteId: number;
  onReady?: () => void;
}

interface NoteEditorInnerProps {
  noteId: number;
  syncProvider: NoteSyncProvider;
  onReady?: () => void;
}

function NoteEditorInner({
  noteId,
  syncProvider,
  onReady,
}: NoteEditorInnerProps) {
  const { t } = useTranslation();
  const placeholder = t("settings.notes.note.bodyPlaceholder");

  const extensions = useMemo(
    () => [
      ...buildRendererExtensions({
        placeholder,
        ydoc: syncProvider.getDoc(),
      }),
      SkillDiffEditorLock.configure({ noteId }),
    ],
    [placeholder, noteId, syncProvider],
  );

  const editor = useEditor(
    {
      extensions,
      editorProps: {
        attributes: {
          class:
            "min-h-[500px] w-full px-4 py-2 outline-none text-base leading-normal text-note-foreground selection:bg-indigo-500/20 cursor-text",
          "aria-placeholder": placeholder,
          spellcheck: "false",
          autocorrect: "off",
          autocapitalize: "off",
        },
        handleKeyDown(_view, event) {
          const candidate = useSkillDiffStore
            .getState()
            .candidatesByNote.get(noteId);
          if (!candidate || candidate.isAccepting) return false;
          if (isContentMutatingKey(event)) {
            useSkillDiffToastStore.getState().pulseAttention();
          }
          return false;
        },
        handlePaste() {
          const candidate = useSkillDiffStore
            .getState()
            .candidatesByNote.get(noteId);
          if (!candidate || candidate.isAccepting) return false;
          useSkillDiffToastStore.getState().pulseAttention();
          return false;
        },
      },
      autofocus: "start",
      content: undefined,
    },
    [noteId, syncProvider],
  );

  useRegisterNoteEditor(noteId, editor);

  useEffect(() => {
    if (editor) {
      syncProvider.setEditor(editor);
    }
  }, [syncProvider, editor]);

  useSkillDiffDecorations(editor, noteId);

  const onReadyCalledRef = useRef(false);
  useEffect(() => {
    if (editor && !onReadyCalledRef.current) {
      onReadyCalledRef.current = true;
      onReady?.();
    }
  }, [editor, onReady]);

  const handleContainerClick = () => {
    if (editor && !editor.isFocused) {
      editor.commands.focus("end");
    }
  };

  return (
    <div
      className="relative cursor-text min-h-[500px]"
      onClick={handleContainerClick}
    >
      <EditorContent editor={editor} />
      {editor ? (
        <DragHandle editor={editor} className="vnote-drag-handle">
          <GripVertical className="size-3" />
        </DragHandle>
      ) : null}
      {editor ? (
        <InlineSkillPopoverPlugin editor={editor} noteId={noteId} />
      ) : null}
      {editor ? <FindInPagePlugin editor={editor} /> : null}
    </div>
  );
}

export function NoteEditor({
  noteId,
  onReady,
}: NoteEditorProps): React.ReactNode {
  const { t } = useTranslation();
  const [isLoading, setIsLoading] = useState(true);
  const [syncProvider, setSyncProvider] = useState<NoteSyncProvider | null>(null);
  const providerRef = useRef<NoteSyncProvider | null>(null);
  const destroyQueueRef = useRef<Array<NoteSyncProvider>>([]);
  const onSaveErrorRef = useRef(() =>
    toast.error(t("settings.notes.toast.saveFailed")),
  );

  useEffect(() => {
    onSaveErrorRef.current = () =>
      toast.error(t("settings.notes.toast.saveFailed"));
  }, [t]);

  useEffect(() => {
    if (destroyQueueRef.current.length === 0) return;
    const providersToDestroy = destroyQueueRef.current;
    destroyQueueRef.current = [];
    providersToDestroy.forEach((provider) => provider.destroy());
  }, [syncProvider]);

  useEffect(() => {
    let mounted = true;

    const initProvider = async () => {
      setIsLoading(true);
      setSyncProvider(null);

      if (providerRef.current) {
        destroyQueueRef.current.push(providerRef.current);
        providerRef.current = null;
      }

      const provider = new NoteSyncProvider({
        noteId,
        onSaveError: () => onSaveErrorRef.current(),
      });

      providerRef.current = provider;

      try {
        await provider.loadFromLocal();
      } catch (error) {
        console.error("Failed to load note content:", error);
      }

      if (mounted) {
        setSyncProvider(provider);
        setIsLoading(false);
      }
    };

    initProvider();

    return () => {
      mounted = false;
    };
  }, [noteId]);

  useEffect(() => {
    return () => {
      if (providerRef.current) {
        providerRef.current.destroy();
        providerRef.current = null;
      }
      destroyQueueRef.current.forEach((provider) => provider.destroy());
      destroyQueueRef.current = [];
    };
  }, []);

  if (isLoading || !syncProvider) {
    return (
      <div className="flex items-center justify-center min-h-[200px]">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <NoteEditorInner
      key={noteId}
      noteId={noteId}
      syncProvider={syncProvider}
      onReady={onReady}
    />
  );
}
