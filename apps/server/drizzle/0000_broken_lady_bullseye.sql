CREATE TABLE "animals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"farm_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"variant" text NOT NULL,
	"name" text,
	"acquired_at" bigint NOT NULL,
	"matures_at" bigint NOT NULL,
	"last_collected_at" bigint NOT NULL,
	"fed_until" bigint
);
--> statement-breakpoint
CREATE TABLE "farms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"house_tier" integer DEFAULT 0 NOT NULL,
	"chest_tier" integer DEFAULT 0 NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"key" text NOT NULL,
	"player_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"response" text NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"container" text NOT NULL,
	"slot_index" integer NOT NULL,
	"item_id" text NOT NULL,
	"quantity" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "players" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"gold" integer DEFAULT 0 NOT NULL,
	"farm_level" integer DEFAULT 1 NOT NULL,
	"vip_until" bigint,
	"flagged_at" bigint,
	"created_at" bigint NOT NULL,
	"last_seen_at" bigint
);
--> statement-breakpoint
CREATE TABLE "plots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"farm_id" uuid NOT NULL,
	"x" integer NOT NULL,
	"y" integer NOT NULL,
	"unlocked" boolean DEFAULT false NOT NULL,
	"crop_id" text,
	"planted_at" bigint,
	"growth_duration_ms" bigint,
	"watered_at" bigint,
	"withered_at" bigint,
	"harvested_at" bigint
);
--> statement-breakpoint
CREATE TABLE "purchases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"stripe_session_id" text NOT NULL,
	"stripe_payment_intent_id" text,
	"amount" integer NOT NULL,
	"currency" text NOT NULL,
	"status" text NOT NULL,
	"created_at" bigint NOT NULL,
	"refunded_at" bigint
);
--> statement-breakpoint
CREATE TABLE "security_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid,
	"event" text NOT NULL,
	"ip" text,
	"detail" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"player_id" uuid NOT NULL,
	"created_at" bigint NOT NULL,
	"expires_at" bigint NOT NULL,
	"revoked_at" bigint
);
--> statement-breakpoint
CREATE TABLE "trade_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trade_id" uuid NOT NULL,
	"initiator_id" uuid NOT NULL,
	"recipient_id" uuid NOT NULL,
	"initiator_items" text NOT NULL,
	"recipient_items" text NOT NULL,
	"initiator_gold" integer NOT NULL,
	"recipient_gold" integer NOT NULL,
	"completed_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" text NOT NULL,
	"initiator_id" uuid NOT NULL,
	"recipient_id" uuid NOT NULL,
	"initiator_items" text DEFAULT '[]' NOT NULL,
	"recipient_items" text DEFAULT '[]' NOT NULL,
	"initiator_gold" integer DEFAULT 0 NOT NULL,
	"recipient_gold" integer DEFAULT 0 NOT NULL,
	"initiator_confirmed" boolean DEFAULT false NOT NULL,
	"recipient_confirmed" boolean DEFAULT false NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	"expires_at" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "animals" ADD CONSTRAINT "animals_farm_id_farms_id_fk" FOREIGN KEY ("farm_id") REFERENCES "public"."farms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "farms" ADD CONSTRAINT "farms_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plots" ADD CONSTRAINT "plots_farm_id_farms_id_fk" FOREIGN KEY ("farm_id") REFERENCES "public"."farms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_initiator_id_players_id_fk" FOREIGN KEY ("initiator_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_recipient_id_players_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "animals_farm_idx" ON "animals" USING btree ("farm_id");--> statement-breakpoint
CREATE UNIQUE INDEX "farms_player_idx" ON "farms" USING btree ("player_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_pk" ON "idempotency_keys" USING btree ("player_id","key");--> statement-breakpoint
CREATE INDEX "inventory_player_idx" ON "inventory_items" USING btree ("player_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_slot_idx" ON "inventory_items" USING btree ("player_id","container","slot_index");--> statement-breakpoint
CREATE UNIQUE INDEX "players_username_lower_idx" ON "players" USING btree (lower("username"));--> statement-breakpoint
CREATE UNIQUE INDEX "players_email_lower_idx" ON "players" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "plots_farm_idx" ON "plots" USING btree ("farm_id");--> statement-breakpoint
CREATE UNIQUE INDEX "plots_farm_pos_idx" ON "plots" USING btree ("farm_id","x","y");--> statement-breakpoint
CREATE UNIQUE INDEX "purchases_session_idx" ON "purchases" USING btree ("stripe_session_id");--> statement-breakpoint
CREATE INDEX "purchases_player_idx" ON "purchases" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "security_log_event_idx" ON "security_log" USING btree ("event");--> statement-breakpoint
CREATE INDEX "sessions_player_idx" ON "sessions" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "trade_log_initiator_idx" ON "trade_log" USING btree ("initiator_id");--> statement-breakpoint
CREATE INDEX "trade_log_recipient_idx" ON "trade_log" USING btree ("recipient_id");--> statement-breakpoint
CREATE INDEX "trade_log_completed_idx" ON "trade_log" USING btree ("completed_at");--> statement-breakpoint
CREATE INDEX "trades_initiator_idx" ON "trades" USING btree ("initiator_id");--> statement-breakpoint
CREATE INDEX "trades_recipient_idx" ON "trades" USING btree ("recipient_id");