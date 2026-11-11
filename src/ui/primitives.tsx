import type { ReactNode } from "react";

// Component families from DESIGN.md: 36px controls with 6px corners, flat square panels,
// quiet 1px boundaries, parrot for selection and focus.

const buttonBase =
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-md font-medium whitespace-nowrap transition-colors disabled:pointer-events-none disabled:opacity-50";
const standardSize = "h-9 px-3 pb-0.5 text-base";
const smallSize = "h-[26px] px-2 pb-px text-xs";
const primaryTone = "bg-primary text-primary-foreground hover:bg-parrot hover:text-parrot-ink";
const secondaryTone = "border border-input bg-page text-foreground hover:bg-hover";
const dangerTone = "border border-input bg-page text-danger hover:bg-hover";

export const buttonClass = {
  primary: `${buttonBase} ${standardSize} ${primaryTone}`,
  secondary: `${buttonBase} ${standardSize} ${secondaryTone}`,
  danger: `${buttonBase} ${standardSize} ${dangerTone}`,
  dangerFill: `${buttonBase} ${standardSize} bg-danger text-danger-foreground hover:opacity-90`,
  smallPrimary: `${buttonBase} ${smallSize} ${primaryTone}`,
  smallSecondary: `${buttonBase} ${smallSize} ${secondaryTone}`,
  smallDanger: `${buttonBase} ${smallSize} ${dangerTone}`,
};

export const inputClass =
  "h-9 rounded-md border border-input bg-page px-3 text-base text-foreground placeholder:text-placeholder disabled:opacity-50";

export const textareaClass =
  "rounded-md border border-input bg-page px-3 py-2 text-base text-foreground placeholder:text-placeholder disabled:opacity-50";

export const labelClass = "flex flex-col gap-1.5 text-sm font-medium";

export function PageHeader({ title, description, children }: { title: string; description?: string; children?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-xl font-medium tracking-tight">{title}</h1>
        {description ? <p className="mt-1 max-w-2xl text-base text-muted">{description}</p> : null}
      </div>
      {children}
    </header>
  );
}

/** A flat data panel: square corners, quiet 1px boundary. */
export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`border border-border bg-page ${className}`}>{children}</section>;
}

export function PanelHeading({ children }: { children: ReactNode }) {
  return <h2 className="text-base font-medium">{children}</h2>;
}

const NOTE_TONES = {
  // Information notes use the selected family: parrot boundary, selected wash, parrot dot.
  info: { box: "border-selected-border bg-selected-soft", dot: "bg-parrot" },
  warning: { box: "border-warning/50 bg-warning/10", dot: "bg-warning" },
  error: { box: "border-danger/50 bg-danger/10", dot: "bg-danger" },
};

export function Notice({
  tone,
  live = false,
  children,
}: {
  tone: keyof typeof NOTE_TONES;
  /** Pulses the dot while work is running. */
  live?: boolean;
  children: ReactNode;
}) {
  const styles = NOTE_TONES[tone];
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={`mb-5 flex items-start gap-2.5 rounded-md border px-3 py-2 text-xs leading-5 text-foreground ${styles.box}`}
    >
      <span aria-hidden className={`mt-[7px] size-1.5 shrink-0 rounded-full ${styles.dot} ${live ? "note-dot-live" : ""}`} />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

const PILL_TONES = {
  ok: { box: "border-selected-border bg-selected-soft text-foreground", dot: "bg-parrot" },
  warn: { box: "border-warning/50 bg-warning/10 text-foreground", dot: "bg-warning" },
  danger: { box: "border-danger/50 bg-danger/10 text-foreground", dot: "bg-danger" },
  neutral: { box: "border-border bg-hover text-muted", dot: "bg-muted" },
};

export function Pill({ tone, live = false, children }: { tone: keyof typeof PILL_TONES; live?: boolean; children: ReactNode }) {
  const styles = PILL_TONES[tone];
  return (
    <span className={`inline-flex h-5 items-center gap-1.5 rounded-full border px-2 text-xs font-medium whitespace-nowrap ${styles.box}`}>
      <span aria-hidden className={`size-1.5 rounded-full ${styles.dot} ${live ? "note-dot-live" : ""}`} />
      {children}
    </span>
  );
}

/** Messages passed back from a form action or a network login, read from the page's query. */
export function FlashMessages({ query }: { query: Record<string, string | string[] | undefined> }) {
  const one = (key: string) => {
    const value = query[key];
    return Array.isArray(value) ? value[0] : value;
  };
  const error = one("error");
  const notice = one("notice");
  const connected = one("connected");
  const reconnected = one("reconnected");
  return (
    <>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {notice ? <Notice tone="info">{notice}</Notice> : null}
      {connected ? <Notice tone="info">Connected: {connected}.</Notice> : null}
      {reconnected ? <Notice tone="info">Reconnected: {reconnected}.</Notice> : null}
    </>
  );
}
