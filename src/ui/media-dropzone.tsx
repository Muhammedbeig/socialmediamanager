"use client";

import { useId, useRef, useState } from "react";
import type { ClientAsset } from "@/media/client-asset";

type Upload = { key: string; name: string; progress: number; error?: string };

function uploadFile(file: File, onProgress: (fraction: number) => void): Promise<ClientAsset> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", `/api/media?name=${encodeURIComponent(file.name)}`);
    request.responseType = "json";
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    request.onload = () => {
      const body = request.response as { asset?: ClientAsset; error?: string } | null;
      if (request.status === 200 && body?.asset) resolve(body.asset);
      else reject(new Error(body?.error ?? "The upload failed. Try again."));
    };
    request.onerror = () => reject(new Error("The upload failed. Try again."));
    request.send(file);
  });
}

/** Drag-and-drop (or click) upload into the media library. */
export function MediaDropzone({
  onUploaded,
  compact = false,
}: {
  onUploaded: (asset: ClientAsset) => void;
  compact?: boolean;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [uploads, setUploads] = useState<Upload[]>([]);

  async function handleFiles(files: FileList | File[]) {
    for (const file of Array.from(files)) {
      const key = `${file.name}-${file.size}-${Date.now()}`;
      setUploads((current) => [...current, { key, name: file.name, progress: 0 }]);
      try {
        const asset = await uploadFile(file, (progress) =>
          setUploads((current) => current.map((u) => (u.key === key ? { ...u, progress } : u))),
        );
        setUploads((current) => current.filter((u) => u.key !== key));
        onUploaded(asset);
      } catch (error) {
        const message = error instanceof Error ? error.message : "The upload failed.";
        setUploads((current) => current.map((u) => (u.key === key ? { ...u, error: message } : u)));
      }
    }
  }

  return (
    <div>
      <label
        htmlFor={inputId}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          void handleFiles(event.dataTransfer.files);
        }}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-md border border-dashed px-4 text-center transition-colors ${
          compact ? "py-5" : "py-10"
        } ${dragging ? "border-selected-border bg-selected-soft" : "border-input hover:bg-hover"}`}
      >
        <span className="text-base font-medium">Drop photos or videos here</span>
        <span className="mt-1 text-sm text-muted">or click to choose files</span>
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          multiple
          accept="image/*,video/*"
          className="sr-only"
          onChange={(event) => {
            if (event.target.files) void handleFiles(event.target.files);
            event.target.value = "";
          }}
        />
      </label>

      {uploads.length > 0 ? (
        <ul className="mt-2 flex flex-col gap-1.5" aria-live="polite">
          {uploads.map((upload) => (
            <li key={upload.key} className="flex items-center gap-3 text-xs">
              <span className="min-w-0 flex-1 truncate">{upload.name}</span>
              {upload.error ? (
                <>
                  <span className="text-danger">{upload.error}</span>
                  <button
                    type="button"
                    className="font-medium underline"
                    onClick={() => setUploads((current) => current.filter((u) => u.key !== upload.key))}
                  >
                    Dismiss
                  </button>
                </>
              ) : (
                <>
                  <span className="h-1 w-32 overflow-hidden rounded-full bg-hover">
                    <span className="block h-full bg-parrot" style={{ width: `${Math.round(upload.progress * 100)}%` }} />
                  </span>
                  <span className="w-20 text-right text-muted tabular-nums">
                    {upload.progress >= 1 ? "Reading file" : `${Math.round(upload.progress * 100)}%`}
                  </span>
                </>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
