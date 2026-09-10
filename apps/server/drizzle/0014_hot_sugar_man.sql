ALTER TABLE "players" ADD COLUMN "energy_spent" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "sleeping_since" bigint;