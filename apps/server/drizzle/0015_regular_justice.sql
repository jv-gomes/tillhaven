CREATE TABLE "quest_progress" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"quest_id" text NOT NULL,
	"accepted_at" bigint NOT NULL,
	"completed_at" bigint
);
--> statement-breakpoint
ALTER TABLE "quest_progress" ADD CONSTRAINT "quest_progress_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "quest_progress_player_quest_key" ON "quest_progress" USING btree ("player_id","quest_id");--> statement-breakpoint
CREATE INDEX "quest_progress_player_idx" ON "quest_progress" USING btree ("player_id");