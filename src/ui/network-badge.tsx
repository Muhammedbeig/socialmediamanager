import { networkName } from "@/connectors/registry";
import type { Network } from "@/db/schema";

/** A neutral label for the network a Channel is on. */
export function NetworkBadge({ network }: { network: Network }) {
  return (
    <span className="inline-flex h-5 shrink-0 items-center rounded-sm border border-border bg-hover px-1.5 text-xs font-medium text-muted">
      {networkName(network)}
    </span>
  );
}
