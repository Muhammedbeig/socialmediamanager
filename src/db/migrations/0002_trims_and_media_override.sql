ALTER TABLE "deliveries" ADD COLUMN "approved_trims" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "media_override" jsonb;