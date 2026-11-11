"use client";

import { useEffect, useRef, useState } from "react";
import type { CropRect } from "@/db/schema";
import { cropIsValid, defaultCrop } from "@/domain/checks";
import { type ClientAsset, originalUrl } from "@/media/client-asset";
import { buttonClass } from "@/ui/primitives";

const PREVIEW_MAX = 440;

/**
 * The crop preview. Nothing is cropped until the Member approves what they see here.
 * The frame is the largest one the network allows; drag it (or use the arrow keys) to choose what stays.
 */
export function CropDialog({
  asset,
  network,
  minAspect,
  maxAspect,
  initial,
  onApprove,
  onClose,
}: {
  asset: ClientAsset;
  network: string;
  minAspect: number;
  maxAspect: number;
  initial?: CropRect;
  onApprove: (crop: CropRect) => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const width = asset.width ?? 1;
  const height = asset.height ?? 1;
  const min = minAspect > 0 ? minAspect : undefined;
  const max = Number.isFinite(maxAspect) ? maxAspect : undefined;
  const [crop, setCrop] = useState<CropRect>(() =>
    initial && cropIsValid(initial, width, height, min, max) ? initial : defaultCrop(width, height, min, max),
  );
  const drag = useRef<{ pointerX: number; pointerY: number; cropX: number; cropY: number } | null>(null);
  const scale = Math.min(PREVIEW_MAX / width, PREVIEW_MAX / height, 1);

  useEffect(() => {
    // No close() on cleanup: that fires onClose, which would dismiss the dialog the moment it
    // opens (React runs effects twice in development). Unmounting removes the dialog anyway.
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  function moveTo(x: number, y: number) {
    setCrop((current) => ({
      ...current,
      x: Math.round(Math.min(Math.max(0, x), width - current.width)),
      y: Math.round(Math.min(Math.max(0, y), height - current.height)),
    }));
  }

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      aria-labelledby="crop-title"
      className="m-auto mt-16 w-[512px] max-w-[calc(100vw-32px)] rounded-xl border border-border bg-floating p-0 text-foreground shadow-xl backdrop:bg-black/50"
    >
      <div className="border-b border-border px-5 py-4">
        <h2 id="crop-title" className="text-lg font-medium">
          Crop for {network}
        </h2>
        <p className="mt-1 text-base text-muted">
          {network} does not take this image&apos;s shape. Drag the frame to choose what stays. The original file is
          not changed.
        </p>
      </div>

      <div className="flex justify-center bg-surface px-5 py-5">
        <div
          className="relative touch-none overflow-hidden select-none"
          style={{ width: width * scale, height: height * scale }}
        >
          <img src={originalUrl(asset.id)} alt="" draggable={false} className="block size-full" />
          <div
            role="slider"
            tabIndex={0}
            aria-label="Crop frame position"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(
              (crop.width === width ? crop.y / Math.max(1, height - crop.height) : crop.x / Math.max(1, width - crop.width)) * 100,
            )}
            className="absolute cursor-move border-2 border-parrot shadow-[0_0_0_9999px_rgb(0_0_0/0.6)]"
            style={{
              left: crop.x * scale,
              top: crop.y * scale,
              width: crop.width * scale,
              height: crop.height * scale,
            }}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              drag.current = { pointerX: event.clientX, pointerY: event.clientY, cropX: crop.x, cropY: crop.y };
            }}
            onPointerMove={(event) => {
              const start = drag.current;
              if (!start) return;
              moveTo(
                start.cropX + (event.clientX - start.pointerX) / scale,
                start.cropY + (event.clientY - start.pointerY) / scale,
              );
            }}
            onPointerUp={() => {
              drag.current = null;
            }}
            onKeyDown={(event) => {
              const step = Math.max(1, Math.round(Math.max(width, height) / 50));
              const moves: Record<string, [number, number]> = {
                ArrowLeft: [-step, 0],
                ArrowRight: [step, 0],
                ArrowUp: [0, -step],
                ArrowDown: [0, step],
              };
              const move = moves[event.key];
              if (!move) return;
              event.preventDefault();
              moveTo(crop.x + move[0], crop.y + move[1]);
            }}
          />
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-4">
        <p className="text-xs text-muted tabular-nums">
          Keeps {crop.width} × {crop.height} of {width} × {height} pixels
        </p>
        <div className="flex gap-2">
          <button type="button" className={buttonClass.secondary} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={buttonClass.primary} onClick={() => onApprove(crop)}>
            Approve crop
          </button>
        </div>
      </div>
    </dialog>
  );
}
