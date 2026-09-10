CREATE TABLE "trees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"farm_id" uuid NOT NULL,
	"x" integer NOT NULL,
	"y" integer NOT NULL,
	"chopped_at" bigint
);
--> statement-breakpoint
ALTER TABLE "trees" ADD CONSTRAINT "trees_farm_id_farms_id_fk" FOREIGN KEY ("farm_id") REFERENCES "public"."farms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trees_farm_idx" ON "trees" USING btree ("farm_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trees_farm_pos_idx" ON "trees" USING btree ("farm_id","x","y");