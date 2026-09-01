CREATE TABLE "furniture_owned" (
	"player_id" uuid NOT NULL,
	"furniture_id" text NOT NULL,
	"quantity" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "furniture_owned" ADD CONSTRAINT "furniture_owned_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "furniture_owned_pk" ON "furniture_owned" USING btree ("player_id","furniture_id");