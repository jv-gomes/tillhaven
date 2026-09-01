ALTER TABLE "plots" ADD COLUMN "grown_ms" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "plots" ADD COLUMN "tilled_at" bigint;