"use client";

import { useRef, useState } from "react";
import type { TrimRange } from "@/db/schema";
import { defaultTrim, trimIsValid } from "@/domain/checks";
import { type ClientAsset, formatDuration, originalUrl } from "@/media/client-asset";
import { Dialog } from "@/ui/dialog";
import { buttonClass, inputClass } from "@/ui/primitives";

/**
 * The trim preview. Nothing is cut until the Member approves the part they chose here.
 * Play the video, then set the start and end from where it is, or type the seconds.
 */
export function TrimDialog({
  asset,
  network,
  minSeconds,
  maxSeconds,
  initial,
  onApprove,
  onClose,
}: {
  asset: ClientAsset;
  network: string;
  minSeconds: number;
  maxSeconds: number;
  initial?: TrimRange;
  onApprove: (trim: TrimRange) => void;
  onClose: () => void;
}) {
  const durationMs = asset.durationMs ?? 0;
  const video = useRef<HTMLVideoElement>(null);
  const [trim, setTrim] = useState<TrimRange>(() =>
    initial && trimIsValid(initial, durationMs, minSeconds, maxSeconds) ? initial : defaultTrim(durationMs, maxSeconds),
  );
  const keptSeconds = (trim.endMs - trim.startMs) / 1000;
  const valid = trimIsValid(trim, durationMs, minSeconds, maxSeconds);

  const setPoint = (point: "startMs" | "endMs", ms: number) =>
    setTrim((current) => ({ ...current, [point]: Math.round(Math.min(Math.max(0, ms), durationMs)) }));
  const fromPlayer = (point: "startMs" | "endMs") => setPoint(point, (video.current?.currentTime ?? 0) * 1000);
  const playKept = () => {
    const player = video.current;
    if (!player) return;
    player.currentTime = trim.startMs / 1000;
    void player.play();
    const stop = () => {
      if (player.currentTime * 1000 >= trim.endMs) {
        player.pause();
        player.removeEventListener("timeupdate", stop);
      }
    };
    player.addEventListener("timeupdate", stop);
  };

  return (
    <Dialog
      title={`Trim for ${network}`}
      description={`${network} takes videos up to ${maxSeconds} seconds; this one runs ${formatDuration(durationMs)}. Choose the part to keep. The original file is not changed.`}
      width={768}
      onClose={onClose}
      footer={
        <>
          <p className={`mr-auto text-xs tabular-nums ${valid ? "text-muted" : "text-danger"}`}>
            Keeps {keptSeconds.toFixed(1)} s{valid ? "" : ` (must be ${minSeconds > 0 ? `${minSeconds} to ` : "up to "}${maxSeconds} s)`}
          </p>
          <button type="button" className={buttonClass.secondary} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={buttonClass.primary} disabled={!valid} onClick={() => onApprove(trim)}>
            Approve trim
          </button>
        </>
      }
    >
      <video ref={video} src={originalUrl(asset.id)} controls preload="metadata" className="max-h-[50vh] w-full bg-black" />
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {(["startMs", "endMs"] as const).map((point) => (
          <div key={point} className="flex items-end gap-2">
            <label className="flex flex-1 flex-col gap-1.5 text-sm font-medium">
              {point === "startMs" ? "Start (seconds)" : "End (seconds)"}
              <input
                type="number"
                min={0}
                max={durationMs / 1000}
                step={0.1}
                value={(trim[point] / 1000).toFixed(1)}
                onChange={(event) => setPoint(point, Number(event.target.value) * 1000)}
                className={inputClass}
              />
            </label>
            <button type="button" className={buttonClass.secondary} onClick={() => fromPlayer(point)}>
              Use player time
            </button>
          </div>
        ))}
      </div>
      <button type="button" className={`${buttonClass.smallSecondary} mt-3`} onClick={playKept}>
        Play the kept part
      </button>
    </Dialog>
  );
}
