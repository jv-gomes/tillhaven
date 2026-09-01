CREATE TABLE "furniture_placements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"furniture_id" text NOT NULL,
	"x" integer NOT NULL,
	"y" integer NOT NULL,
	"placed_at" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "furniture_placements" ADD CONSTRAINT "furniture_placements_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "furniture_player_idx" ON "furniture_placements" USING btree ("player_id");