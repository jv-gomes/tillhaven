CREATE TABLE "shipments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"item_id" text NOT NULL,
	"quantity" integer NOT NULL,
	"deposited_at" bigint NOT NULL,
	"paid_at" bigint,
	"payout" integer
);
--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "shipments_player_idx" ON "shipments" USING btree ("player_id");