CREATE TABLE "casts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"cast_at" bigint NOT NULL,
	"bite_at" bigint NOT NULL,
	"fish_id" text NOT NULL,
	"reeled_at" bigint,
	"landed" boolean
);
--> statement-breakpoint
ALTER TABLE "casts" ADD CONSTRAINT "casts_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "casts_one_open_per_player" ON "casts" USING btree ("player_id") WHERE "casts"."reeled_at" is null;--> statement-breakpoint
CREATE INDEX "casts_player_idx" ON "casts" USING btree ("player_id");