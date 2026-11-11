"use client";

import { buttonClass } from "@/ui/primitives";

export default function ErrorScreen({ reset }: { error: Error; reset: () => void }) {
  return (
    <div role="alert" className="border border-border bg-page p-4">
      <h1 className="text-lg font-medium">This screen could not load</h1>
      <p className="mt-1 max-w-2xl text-base text-muted">
        The usual cause is that the app cannot reach its database. Check that PostgreSQL is running and that
        DATABASE_URL in .env.local is right (steps in docs/setup.md), then try again.
      </p>
      <button type="button" onClick={reset} className={`${buttonClass.primary} mt-4`}>
        Try again
      </button>
    </div>
  );
}
