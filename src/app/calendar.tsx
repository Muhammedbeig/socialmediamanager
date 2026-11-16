import Link from "next/link";
import type { PostStatus } from "@/domain/post-status";
import { type CalendarPost, dayKey, monthKey } from "@/posts/calendar";
import { Panel, buttonClass } from "@/ui/primitives";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const time = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });
const monthTitle = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" });
const dayTitle = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long" });

const DOT: Record<PostStatus, string> = {
  scheduled: "bg-muted",
  publishing: "bg-parrot",
  published: "bg-parrot",
  partly_published: "bg-warning",
  failed: "bg-danger",
  removed: "bg-muted",
};

/** The Dashboard calendar: scheduled and published Posts for one month. */
export function Calendar({ start, days, today }: { start: Date; days: Map<string, CalendarPost[]>; today: Date }) {
  const previous = new Date(start.getFullYear(), start.getMonth() - 1, 1);
  const next = new Date(start.getFullYear(), start.getMonth() + 1, 1);
  // Weeks start on Monday; pad the grid to whole weeks.
  const lead = (start.getDay() + 6) % 7;
  const daysInMonth = new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate();
  const cells = Array.from({ length: Math.ceil((lead + daysInMonth) / 7) * 7 }, (_, index) => {
    const day = index - lead + 1;
    return day >= 1 && day <= daysInMonth ? new Date(start.getFullYear(), start.getMonth(), day) : null;
  });
  const todayKey = dayKey(today);
  const monthDays = cells.filter((cell): cell is Date => cell !== null && (days.get(dayKey(cell))?.length ?? 0) > 0);

  return (
    <Panel className="mb-6">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h2 className="text-base font-medium">{monthTitle.format(start)}</h2>
        <div className="flex gap-1.5">
          <Link href={`/?month=${monthKey(previous)}`} className={buttonClass.smallSecondary} aria-label="Previous month">
            ←
          </Link>
          <Link href="/" className={buttonClass.smallSecondary}>
            Today
          </Link>
          <Link href={`/?month=${monthKey(next)}`} className={buttonClass.smallSecondary} aria-label="Next month">
            →
          </Link>
        </div>
      </div>

      {/* Wide screens: a month grid. */}
      <div className="hidden md:block">
        <div className="grid grid-cols-7 border-b border-border">
          {WEEKDAYS.map((day) => (
            <div key={day} className="px-2 py-1.5 text-xs font-medium text-muted">
              {day}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((cell, index) => {
            const posts = cell ? (days.get(dayKey(cell)) ?? []) : [];
            const isToday = cell !== null && dayKey(cell) === todayKey;
            return (
              <div
                key={index}
                className={`min-h-24 border-border p-1.5 ${index % 7 !== 6 ? "border-r" : ""} ${index < cells.length - 7 ? "border-b" : ""} ${cell ? "" : "bg-surface"}`}
              >
                {cell ? (
                  <>
                    <span
                      className={`inline-flex size-5 items-center justify-center rounded-full text-xs tabular-nums ${isToday ? "bg-parrot font-medium text-parrot-ink" : "text-muted"}`}
                    >
                      {cell.getDate()}
                    </span>
                    <ul className="mt-1 flex flex-col gap-0.5">
                      {posts.slice(0, 3).map((post) => (
                        <li key={post.id}>
                          <Link
                            href={`/posts/${post.id}`}
                            title={post.caption}
                            className="flex items-center gap-1 rounded-sm px-1 py-0.5 text-xs hover:bg-hover"
                          >
                            <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${DOT[post.status]}`} />
                            <span className="text-muted tabular-nums">{time.format(post.time)}</span>
                            <span className="truncate">{post.caption || "No caption"}</span>
                          </Link>
                        </li>
                      ))}
                      {posts.length > 3 ? <li className="px-1 text-xs text-muted">+{posts.length - 3} more</li> : null}
                    </ul>
                  </>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      {/* Phones: the days that have Posts, as a list. */}
      <div className="md:hidden">
        {monthDays.length === 0 ? (
          <p className="px-4 py-3 text-base text-muted">No Posts this month.</p>
        ) : (
          <ul className="divide-y divide-border">
            {monthDays.map((day) => (
              <li key={dayKey(day)} className="px-4 py-2.5">
                <p className="text-xs font-medium text-muted">{dayTitle.format(day)}</p>
                <ul className="mt-1 flex flex-col gap-1">
                  {(days.get(dayKey(day)) ?? []).map((post) => (
                    <li key={post.id}>
                      <Link href={`/posts/${post.id}`} className="flex items-center gap-2 text-sm">
                        <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${DOT[post.status]}`} />
                        <span className="text-muted tabular-nums">{time.format(post.time)}</span>
                        <span className="truncate">{post.caption || "No caption"}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}
