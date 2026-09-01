ALTER TABLE "farms" ADD COLUMN "idle_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "farms" ADD COLUMN "idle_tasks" text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE "farms" ADD COLUMN "idle_crop_id" text;--> statement-breakpoint
ALTER TABLE "farms" ADD COLUMN "idle_processed_at" bigint;