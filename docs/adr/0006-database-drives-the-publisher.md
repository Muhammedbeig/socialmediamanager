# 6. The database decides what is due; pg-boss runs one job per Delivery

Date: 2026-11-11

## Decision

- The web app only saves Deliveries. The background worker checks the database every 5 seconds
  for due Deliveries (scheduled time passed, or a retry's wait over) and sends one pg-boss job per
  Delivery, keyed by the Delivery's ID on a `stately` queue, so a Delivery is never queued twice.
- The job claims the Delivery with one conditional update. Only a due Delivery that is not in
  flight can be claimed, so two jobs can never both send it.
- Retries are decided by the runner per error kind, not by pg-boss: retryable errors wait about
  2, 4 and 8 minutes; refused content, expired logins and unanswered sends fail at once. A worker
  that dies mid-call leaves the Delivery Failed as "may or may not be live".

## Why

- A Delivery due while the laptop slept, or saved while the worker was off, is simply due when
  the worker next looks. No job can be lost between the web app and the queue.
- The web app never needs a queue connection.
- "A live Delivery is never sent twice" is enforced by the database, where it can be tested.
