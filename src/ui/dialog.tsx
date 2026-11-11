"use client";

import { type ReactNode, useEffect, useRef } from "react";

/** A modal dialog (DESIGN.md: 12px corners, 1px boundary, 64px from the top). Escape closes it. */
export function Dialog({
  title,
  description,
  width = 512,
  onClose,
  children,
  footer,
}: {
  title: string;
  description?: ReactNode;
  width?: 384 | 512 | 768;
  onClose: () => void;
  children?: ReactNode;
  footer: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    // No close() on cleanup: it fires onClose, which would dismiss the dialog as it opens
    // (React runs effects twice in development). Unmounting removes it anyway.
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby="dialog-title"
      style={{ width }}
      className="m-auto mt-8 max-h-[calc(100vh-64px)] max-w-[calc(100vw-32px)] flex-col rounded-xl border border-border bg-floating p-0 text-foreground shadow-xl backdrop:bg-black/50 open:flex sm:mt-16"
    >
      <div className="border-b border-border px-5 py-4">
        <h2 id="dialog-title" className="text-lg font-medium">
          {title}
        </h2>
        {description ? <div className="mt-1 text-base text-muted">{description}</div> : null}
      </div>
      {children ? <div className="min-h-0 overflow-y-auto px-5 py-4">{children}</div> : null}
      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-5 py-4">{footer}</div>
    </dialog>
  );
}
