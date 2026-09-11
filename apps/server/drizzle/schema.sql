-- Tillhaven schema -- generated from apps/server/drizzle/*.sql
-- 17 migrations, in journal order.
-- Records each migration in drizzle.__drizzle_migrations so that a later
-- `pnpm --filter @tillhaven/server db:migrate` applies only NEW migrations.
-- Run against an EMPTY database. Wrapped in one transaction: all or nothing.

BEGIN;

CREATE SCHEMA IF NOT EXISTS "drizzle";
CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
	id SERIAL PRIMARY KEY,
	hash text NOT NULL,
	created_at bigint
);

-- -------------------------------------------------------------------
-- 0000_broken_lady_bullseye
-- -------------------------------------------------------------------
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

CREATE TABLE "farms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"house_tier" integer DEFAULT 0 NOT NULL,
	"chest_tier" integer DEFAULT 0 NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"created_at" bigint NOT NULL
);

CREATE TABLE "idempotency_keys" (
	"key" text NOT NULL,
	"player_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"response" text NOT NULL,
	"created_at" bigint NOT NULL
);

CREATE TABLE "inventory_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"container" text NOT NULL,
	"slot_index" integer NOT NULL,
	"item_id" text NOT NULL,
	"quantity" integer NOT NULL
);

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

CREATE TABLE "security_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid,
	"event" text NOT NULL,
	"ip" text,
	"detail" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"player_id" uuid NOT NULL,
	"created_at" bigint NOT NULL,
	"expires_at" bigint NOT NULL,
	"revoked_at" bigint
);

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

ALTER TABLE "animals" ADD CONSTRAINT "animals_farm_id_farms_id_fk" FOREIGN KEY ("farm_id") REFERENCES "public"."farms"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "farms" ADD CONSTRAINT "farms_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "plots" ADD CONSTRAINT "plots_farm_id_farms_id_fk" FOREIGN KEY ("farm_id") REFERENCES "public"."farms"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "trades" ADD CONSTRAINT "trades_initiator_id_players_id_fk" FOREIGN KEY ("initiator_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "trades" ADD CONSTRAINT "trades_recipient_id_players_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;
CREATE INDEX "animals_farm_idx" ON "animals" USING btree ("farm_id");
CREATE UNIQUE INDEX "farms_player_idx" ON "farms" USING btree ("player_id");
CREATE UNIQUE INDEX "idempotency_pk" ON "idempotency_keys" USING btree ("player_id","key");
CREATE INDEX "inventory_player_idx" ON "inventory_items" USING btree ("player_id");
CREATE UNIQUE INDEX "inventory_slot_idx" ON "inventory_items" USING btree ("player_id","container","slot_index");
CREATE UNIQUE INDEX "players_username_lower_idx" ON "players" USING btree (lower("username"));
CREATE UNIQUE INDEX "players_email_lower_idx" ON "players" USING btree (lower("email"));
CREATE INDEX "plots_farm_idx" ON "plots" USING btree ("farm_id");
CREATE UNIQUE INDEX "plots_farm_pos_idx" ON "plots" USING btree ("farm_id","x","y");
CREATE UNIQUE INDEX "purchases_session_idx" ON "purchases" USING btree ("stripe_session_id");
CREATE INDEX "purchases_player_idx" ON "purchases" USING btree ("player_id");
CREATE INDEX "security_log_event_idx" ON "security_log" USING btree ("event");
CREATE INDEX "sessions_player_idx" ON "sessions" USING btree ("player_id");
CREATE INDEX "trade_log_initiator_idx" ON "trade_log" USING btree ("initiator_id");
CREATE INDEX "trade_log_recipient_idx" ON "trade_log" USING btree ("recipient_id");
CREATE INDEX "trade_log_completed_idx" ON "trade_log" USING btree ("completed_at");
CREATE INDEX "trades_initiator_idx" ON "trades" USING btree ("initiator_id");
CREATE INDEX "trades_recipient_idx" ON "trades" USING btree ("recipient_id");

INSERT INTO "drizzle"."__drizzle_migrations" ("hash","created_at") VALUES ('f9448c4040227592f3f4f3ca7c81e0c09aac93d1227cfe84feabb1f97a18edbf', 1787339932346);

-- -------------------------------------------------------------------
-- 0001_third_luminals
-- -------------------------------------------------------------------
ALTER TABLE "players" ADD COLUMN "experience" integer DEFAULT 0 NOT NULL;

INSERT INTO "drizzle"."__drizzle_migrations" ("hash","created_at") VALUES ('8e3baa596dd3298783b8d3394b77ce069bbf926e8a85d932b436faddecad74c3', 1787585911256);

-- -------------------------------------------------------------------
-- 0002_right_galactus
-- -------------------------------------------------------------------
ALTER TABLE "players" DROP COLUMN "farm_level";

INSERT INTO "drizzle"."__drizzle_migrations" ("hash","created_at") VALUES ('d151ecf78fa323da06250a23f72fad85137722b8e2158d4fc2a43d552300718f', 1787585918814);

-- -------------------------------------------------------------------
-- 0003_condemned_goliath
-- -------------------------------------------------------------------
CREATE TABLE "furniture_placements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"furniture_id" text NOT NULL,
	"x" integer NOT NULL,
	"y" integer NOT NULL,
	"placed_at" bigint NOT NULL
);

ALTER TABLE "furniture_placements" ADD CONSTRAINT "furniture_placements_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;
CREATE INDEX "furniture_player_idx" ON "furniture_placements" USING btree ("player_id");

INSERT INTO "drizzle"."__drizzle_migrations" ("hash","created_at") VALUES ('8736968a93d6a5ddb09e36acc0719a3c34a8788ad0ffd32705a08038f05c10fd', 1787605043691);

-- -------------------------------------------------------------------
-- 0004_smiling_phil_sheldon
-- -------------------------------------------------------------------
CREATE TABLE "furniture_owned" (
	"player_id" uuid NOT NULL,
	"furniture_id" text NOT NULL,
	"quantity" integer NOT NULL
);

ALTER TABLE "furniture_owned" ADD CONSTRAINT "furniture_owned_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;
CREATE UNIQUE INDEX "furniture_owned_pk" ON "furniture_owned" USING btree ("player_id","furniture_id");

INSERT INTO "drizzle"."__drizzle_migrations" ("hash","created_at") VALUES ('1f4a5c271fbbf3fe04de81e758ebf8ba31c47b5a058de83ad305c95b43c0547b', 1787605910652);

-- -------------------------------------------------------------------
-- 0005_handy_bullseye
-- -------------------------------------------------------------------
ALTER TABLE "players" ADD COLUMN "appearance" text;

INSERT INTO "drizzle"."__drizzle_migrations" ("hash","created_at") VALUES ('237f9e7b35161695cff77fc17dea6b4b7357186f22f84a7b14b5415aaed9bcd8', 1787720216390);

-- -------------------------------------------------------------------
-- 0006_lying_layla_miller
-- -------------------------------------------------------------------
ALTER TABLE "plots" ADD COLUMN "grown_ms" bigint DEFAULT 0 NOT NULL;
ALTER TABLE "plots" ADD COLUMN "tilled_at" bigint;

INSERT INTO "drizzle"."__drizzle_migrations" ("hash","created_at") VALUES ('d2e20a30077d80da934e08a19005b911773a43a2910ddb2c35057950dda7895e', 1787767723480);

-- -------------------------------------------------------------------
-- 0007_thin_valeria_richards
-- -------------------------------------------------------------------
ALTER TABLE "players" ADD COLUMN "backpack_tier" integer DEFAULT 0 NOT NULL;

INSERT INTO "drizzle"."__drizzle_migrations" ("hash","created_at") VALUES ('6c1b0d6bbdc557783ff76e7172146b555be27ac67b8609a6ec3384509287d1eb', 1787789778381);

-- -------------------------------------------------------------------
-- 0008_smiling_yellowjacket
-- -------------------------------------------------------------------
CREATE TABLE "shipments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"item_id" text NOT NULL,
	"quantity" integer NOT NULL,
	"deposited_at" bigint NOT NULL,
	"paid_at" bigint,
	"payout" integer
);

ALTER TABLE "shipments" ADD CONSTRAINT "shipments_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;
CREATE INDEX "shipments_player_idx" ON "shipments" USING btree ("player_id");

INSERT INTO "drizzle"."__drizzle_migrations" ("hash","created_at") VALUES ('0c21e442d684782f5a84ebdf0e4636d91c90b8a1c364b38c25b650570c773216', 1787800995346);

-- -------------------------------------------------------------------
-- 0009_red_bedlam
-- -------------------------------------------------------------------
ALTER TABLE "farms" ADD COLUMN "coop_tier" integer DEFAULT 0 NOT NULL;
ALTER TABLE "farms" ADD COLUMN "barn_tier" integer DEFAULT 0 NOT NULL;

INSERT INTO "drizzle"."__drizzle_migrations" ("hash","created_at") VALUES ('dc497dfe229f32490e668da8d42e417894fa3be794ad1a45dfc14dc1ebb832cf', 1787833733127);

-- -------------------------------------------------------------------
-- 0010_natural_secret_warriors
-- -------------------------------------------------------------------
ALTER TABLE "farms" ADD COLUMN "idle_enabled" boolean DEFAULT false NOT NULL;
ALTER TABLE "farms" ADD COLUMN "idle_tasks" text DEFAULT '[]' NOT NULL;
ALTER TABLE "farms" ADD COLUMN "idle_crop_id" text;
ALTER TABLE "farms" ADD COLUMN "idle_processed_at" bigint;

INSERT INTO "drizzle"."__drizzle_migrations" ("hash","created_at") VALUES ('977b43624730e4fb17b0bd46a661b720893658fff1865469e7308e16c8cce704', 1787888691561);

-- -------------------------------------------------------------------
-- 0011_supreme_mister_sinister
-- -------------------------------------------------------------------
CREATE TABLE "decor_owned" (
	"player_id" uuid NOT NULL,
	"decor_id" text NOT NULL,
	"quantity" integer NOT NULL
);

CREATE TABLE "decor_placements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"decor_id" text NOT NULL,
	"x" integer NOT NULL,
	"y" integer NOT NULL,
	"placed_at" bigint NOT NULL
);

ALTER TABLE "decor_owned" ADD CONSTRAINT "decor_owned_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "decor_placements" ADD CONSTRAINT "decor_placements_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;
CREATE UNIQUE INDEX "decor_owned_pk" ON "decor_owned" USING btree ("player_id","decor_id");
CREATE INDEX "decor_player_idx" ON "decor_placements" USING btree ("player_id");

INSERT INTO "drizzle"."__drizzle_migrations" ("hash","created_at") VALUES ('71f8ce4ae8e17bce082a659667f74ba6d50bf22e32056a24ab7618517632d801', 1788286447000);

-- -------------------------------------------------------------------
-- 0012_condemned_valeria_richards
-- -------------------------------------------------------------------
CREATE TABLE "trees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"farm_id" uuid NOT NULL,
	"x" integer NOT NULL,
	"y" integer NOT NULL,
	"chopped_at" bigint
);

ALTER TABLE "trees" ADD CONSTRAINT "trees_farm_id_farms_id_fk" FOREIGN KEY ("farm_id") REFERENCES "public"."farms"("id") ON DELETE cascade ON UPDATE no action;
CREATE INDEX "trees_farm_idx" ON "trees" USING btree ("farm_id");
CREATE UNIQUE INDEX "trees_farm_pos_idx" ON "trees" USING btree ("farm_id","x","y");

INSERT INTO "drizzle"."__drizzle_migrations" ("hash","created_at") VALUES ('8f35708fcb77654f87808e9235b9f824950dd8186eef6113d4b25b6771b6bd33', 1788566543000);

-- -------------------------------------------------------------------
-- 0013_overjoyed_magus
-- -------------------------------------------------------------------
CREATE TABLE "milestone_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"milestone_id" text NOT NULL,
	"claimed_at" bigint NOT NULL
);

ALTER TABLE "milestone_claims" ADD CONSTRAINT "milestone_claims_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;
CREATE UNIQUE INDEX "milestone_claims_player_milestone_key" ON "milestone_claims" USING btree ("player_id","milestone_id");
CREATE INDEX "milestone_claims_player_idx" ON "milestone_claims" USING btree ("player_id");

INSERT INTO "drizzle"."__drizzle_migrations" ("hash","created_at") VALUES ('a3aaa48b031757af78e7ffa876e5f5af03a5082751d62f20f14dd492951a2182', 1788829978000);

-- -------------------------------------------------------------------
-- 0014_hot_sugar_man
-- -------------------------------------------------------------------
ALTER TABLE "players" ADD COLUMN "energy_spent" integer DEFAULT 0 NOT NULL;
ALTER TABLE "players" ADD COLUMN "sleeping_since" bigint;

INSERT INTO "drizzle"."__drizzle_migrations" ("hash","created_at") VALUES ('a034a605f9bc840baa2df5255ed339ae0560986b6a9ab3448177722956847064', 1788896625216);

-- -------------------------------------------------------------------
-- 0015_regular_justice
-- -------------------------------------------------------------------
CREATE TABLE "quest_progress" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"quest_id" text NOT NULL,
	"accepted_at" bigint NOT NULL,
	"completed_at" bigint
);

ALTER TABLE "quest_progress" ADD CONSTRAINT "quest_progress_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;
CREATE UNIQUE INDEX "quest_progress_player_quest_key" ON "quest_progress" USING btree ("player_id","quest_id");
CREATE INDEX "quest_progress_player_idx" ON "quest_progress" USING btree ("player_id");

INSERT INTO "drizzle"."__drizzle_migrations" ("hash","created_at") VALUES ('e6b2bd13ea4b3efc2084769224849f19399ffd52bc6e662fbb77ea0c19980251', 1788999138307);

-- -------------------------------------------------------------------
-- 0016_absurd_amphibian
-- -------------------------------------------------------------------
CREATE TABLE "casts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"cast_at" bigint NOT NULL,
	"bite_at" bigint NOT NULL,
	"fish_id" text NOT NULL,
	"reeled_at" bigint,
	"landed" boolean
);

ALTER TABLE "casts" ADD CONSTRAINT "casts_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;
CREATE UNIQUE INDEX "casts_one_open_per_player" ON "casts" USING btree ("player_id") WHERE "casts"."reeled_at" is null;
CREATE INDEX "casts_player_idx" ON "casts" USING btree ("player_id");

INSERT INTO "drizzle"."__drizzle_migrations" ("hash","created_at") VALUES ('bb02bdeb3efc3ecc4ac52e654b8bcbc2c67321e7c4b8785f28e4339baa09a091', 1789006537946);

COMMIT;