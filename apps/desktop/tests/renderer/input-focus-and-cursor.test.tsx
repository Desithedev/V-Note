import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import fs from "node:fs";
import path from "node:path";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

describe("Input & Textarea Focus, Caret, and Window Manager Tests", () => {
  it("Input renders with cursor-text class and style attribute", () => {
    const html = renderToStaticMarkup(
      <Input placeholder="Tiêu đề sự kiện" />,
    );

    // Verify cursor-text class exists in rendered markup
    expect(html).toContain("cursor-text");
    expect(html).toContain("placeholder=\"Tiêu đề sự kiện\"");
  });

  it("Input triggers onMouseDown and element focus properly", () => {
    const focusSpy = vi.fn();
    const onMouseDownSpy = vi.fn();

    // Directly test the component's onMouseDown handler contract
    const inputElement = Input({
      placeholder: "Tiêu đề sự kiện",
      onMouseDown: onMouseDownSpy,
    });

    const fakeTarget = {
      focus: focusSpy,
    };

    const fakeEvent = {
      currentTarget: fakeTarget,
    } as unknown as React.MouseEvent<HTMLInputElement>;

    // Invoke onMouseDown
    inputElement.props.onMouseDown?.(fakeEvent);

    expect(focusSpy).toHaveBeenCalledTimes(1);
    expect(onMouseDownSpy).toHaveBeenCalledTimes(1);
  });

  it("Textarea renders with cursor-text class", () => {
    const html = renderToStaticMarkup(
      <Textarea placeholder="Nội dung chi tiết" />,
    );

    expect(html).toContain("cursor-text");
    expect(html).toContain("placeholder=\"Nội dung chi tiết\"");
  });

  it("Textarea triggers onMouseDown and element focus properly", () => {
    const focusSpy = vi.fn();
    const onMouseDownSpy = vi.fn();

    const textareaElement = Textarea({
      placeholder: "Nội dung chi tiết",
      onMouseDown: onMouseDownSpy,
    });

    const fakeTarget = {
      focus: focusSpy,
    };

    const fakeEvent = {
      currentTarget: fakeTarget,
    } as unknown as React.MouseEvent<HTMLTextAreaElement>;

    textareaElement.props.onMouseDown?.(fakeEvent);

    expect(focusSpy).toHaveBeenCalledTimes(1);
    expect(onMouseDownSpy).toHaveBeenCalledTimes(1);
  });

  it("globals.css contains mandatory text-cursor, user-select, and no-drag rules", () => {
    const globalsCssPath = path.resolve(__dirname, "../../src/styles/globals.css");
    const content = fs.readFileSync(globalsCssPath, "utf-8");

    // Check that -webkit-app-region: no-drag !important is enforced on text elements
    expect(content).toContain("-webkit-app-region: no-drag !important");
    expect(content).toContain("cursor: text !important");
    expect(content).toContain("user-select: text !important");
    expect(content).toContain("-webkit-user-select: text !important");
  });

  it("window-manager.ts configures meetingWidgetWindow with focusable: false and showInactive", () => {
    const windowManagerPath = path.resolve(__dirname, "../../src/main/core/window-manager.ts");
    const content = fs.readFileSync(windowManagerPath, "utf-8");

    // Verify focusable: false is set to avoid stealing foreground focus on Windows
    expect(content).toContain("focusable: false");
    // Verify showInactive is called instead of show()
    expect(content).toContain("this.meetingWidgetWindow?.showInactive()");
    // Verify mainWindow is re-enabled on onboarding close
    expect(content).toContain("this.mainWindow.setEnabled(true)");
  });

  it("editor-styles.css enforces cursor: text on tiptap and ProseMirror", () => {
    const editorStylesPath = path.resolve(
      __dirname,
      "../../src/renderer/main/components/editor/editor-styles.css",
    );
    const content = fs.readFileSync(editorStylesPath, "utf-8");

    expect(content).toContain(".tiptap");
    expect(content).toContain(".ProseMirror");
    expect(content).toContain("cursor: text !important");
  });

  it("event-form-dialog.tsx has titleInputRef auto-focus mechanism on open", () => {
    const eventFormDialogPath = path.resolve(
      __dirname,
      "../../src/renderer/main/pages/events/components/event-form-dialog.tsx",
    );
    const content = fs.readFileSync(eventFormDialogPath, "utf-8");

    expect(content).toContain("titleInputRef");
    expect(content).toContain("ref={titleInputRef}");
    expect(content).toContain("titleInputRef.current?.focus()");
  });
});
