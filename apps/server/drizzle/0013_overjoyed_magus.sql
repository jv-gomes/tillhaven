CREATE TABLE "milestone_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"milestone_id" text NOT NULL,
	"claimed_at" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "milestone_claims" ADD CONSTRAINT "milestone_claims_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "milestone_claims_player_milestone_key" ON "milestone_claims" USING btree ("player_id","milestone_id");--> statement-breakpoint
CREATE INDEX "milestone_claims_player_idx" ON "milestone_claims" USING btree ("player_id");