"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Sidebar row from DESIGN.md: 34px high, 13px/500 label, 6px corners, 12px horizontal padding,
// 10px icon gap. The active row uses a neutral surface.

const ICONS = {
  dashboard: "M3 3h4v6H3zM9 3h4v3H9zM9 8h4v5H9zM3 11h4v2H3z",
  compose: "M3 13h2.5L13 5.5 10.5 3 3 10.5zM9.5 4l2.5 2.5",
  posts: "M3 4h10M3 8h10M3 12h6",
  media: "M2.5 3.5h11v9h-11zM2.5 10.5l3-3 2.5 2.5 2-2 3.5 3.5M10.5 6.2a.7.7 0 1 0 0-.01",
  channels: "M8 2.5v11M2.5 8h11M4.2 4.2l7.6 7.6M11.8 4.2l-7.6 7.6",
  brands: "M2.5 5.5l5.5-3 5.5 3v5l-5.5 3-5.5-3zM2.5 5.5l5.5 3 5.5-3M8 8.5v5",
  attention: "M8 2.5l6 10.5H2zM8 6.5v3M8 11.2v.1",
  settings: "M3 5h10M3 11h10M6 3.5v3M10 9.5v3",
} as const;

export type NavIcon = keyof typeof ICONS;

export function NavLink({ href, icon, badge, children }: { href: string; icon: NavIcon; badge?: number; children: React.ReactNode }) {
  const pathname = usePathname();
  const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`flex h-[34px] shrink-0 items-center gap-2.5 rounded-md px-3 text-sm font-medium whitespace-nowrap transition-colors ${
        active ? "bg-hover text-foreground" : "text-muted hover:bg-hover hover:text-foreground"
      }`}
    >
      <svg aria-hidden viewBox="0 0 16 16" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
        <path d={ICONS[icon]} />
      </svg>
      <span className="min-w-0 md:flex-1 md:truncate">{children}</span>
      {badge ? (
        <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-parrot px-1 text-xs font-medium text-parrot-ink tabular-nums">
          {badge}
        </span>
      ) : null}
    </Link>
  );
}
