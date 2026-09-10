CREATE TABLE "decor_owned" (
	"player_id" uuid NOT NULL,
	"decor_id" text NOT NULL,
	"quantity" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "decor_placements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"decor_id" text NOT NULL,
	"x" integer NOT NULL,
	"y" integer NOT NULL,
	"placed_at" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "decor_owned" ADD CONSTRAINT "decor_owned_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decor_placements" ADD CONSTRAINT "decor_placements_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "decor_owned_pk" ON "decor_owned" USING btree ("player_id","decor_id");--> statement-breakpoint
CREATE INDEX "decor_player_idx" ON "decor_placements" USING btree ("player_id");