ALTER TABLE "deliveries" ADD COLUMN "in_flight_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "next_attempt_at" timestamp with time zone;