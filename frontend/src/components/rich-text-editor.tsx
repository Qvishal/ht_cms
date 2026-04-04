"use client";

import { useEffect, useRef } from "react";

export function RichTextEditor({
  value,
  onChange,
  placeholder
}: {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Only overwrite if external value differs to preserve cursor position during typing.
    if (el.innerHTML !== value) el.innerHTML = value || "";
  }, [value]);

  function exec(command: string, arg?: string) {
    if (typeof document === "undefined") return;
    // Basic formatting; supported broadly and keeps dependencies minimal.
    document.execCommand(command, false, arg);
    const el = ref.current;
    if (el) onChange(el.innerHTML);
  }

  return (
    <div className="rounded-md border bg-card">
      <div className="flex flex-wrap items-center gap-1 border-b bg-background/40 p-2">
        <button
          type="button"
          className="text-xs rounded-md px-2 py-1 hover:bg-muted"
          onClick={() => exec("bold")}
        >
          Bold
        </button>
        <button
          type="button"
          className="text-xs rounded-md px-2 py-1 hover:bg-muted"
          onClick={() => exec("italic")}
        >
          Italic
        </button>
        <button
          type="button"
          className="text-xs rounded-md px-2 py-1 hover:bg-muted"
          onClick={() => exec("underline")}
        >
          Underline
        </button>
        <button
          type="button"
          className="text-xs rounded-md px-2 py-1 hover:bg-muted"
          onClick={() => exec("insertUnorderedList")}
        >
          • List
        </button>
        <button
          type="button"
          className="text-xs rounded-md px-2 py-1 hover:bg-muted"
          onClick={() => exec("insertOrderedList")}
        >
          1. List
        </button>
        <button
          type="button"
          className="text-xs rounded-md px-2 py-1 hover:bg-muted"
          onClick={() => {
            const url = prompt("Link URL");
            if (url) exec("createLink", url);
          }}
        >
          Link
        </button>
        <button
          type="button"
          className="ml-auto text-xs rounded-md px-2 py-1 hover:bg-muted"
          onClick={() => exec("removeFormat")}
        >
          Clear
        </button>
      </div>
      <div
        ref={ref}
        className="min-h-[120px] p-3 text-sm outline-none"
        contentEditable
        suppressContentEditableWarning
        data-placeholder={placeholder ?? "Write…"}
        onInput={() => onChange(ref.current?.innerHTML ?? "")}
      />
    </div>
  );
}
