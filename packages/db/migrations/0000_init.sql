CREATE TYPE "public"."asn_claim_status" AS ENUM('pending', 'verified', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."asn_proof_method" AS ENUM('email_domain', 'ripe', 'peeringdb');--> statement-breakpoint
CREATE TYPE "public"."measurement_source" AS ENUM('game', 'probe');--> statement-breakpoint
CREATE TYPE "public"."member_role" AS ENUM('owner', 'admin', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."route_zone" AS ENUM('home', 'isp', 'transit', 'service');--> statement-breakpoint
CREATE TABLE "asn_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"asn" bigint NOT NULL,
	"proof_method" "asn_proof_method" NOT NULL,
	"status" "asn_claim_status" DEFAULT 'pending' NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asn_claims_verified_at_check" CHECK (("asn_claims"."status" = 'verified') = ("asn_claims"."verified_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "autonomous_systems" (
	"asn" bigint PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"country" char(2)
);
--> statement-breakpoint
CREATE TABLE "games" (
	"slug" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hops" (
	"route_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"ip" "inet",
	"asn" bigint,
	"rtt_ms" real,
	"loss_pct" real,
	"zone" "route_zone" NOT NULL,
	CONSTRAINT "hops_route_id_position_pk" PRIMARY KEY("route_id","position"),
	CONSTRAINT "hops_ip_public_check" CHECK ("hops"."ip" is null or not ("hops"."ip" <<= any (array['0.0.0.0/8'::inet, '10.0.0.0/8'::inet, '100.64.0.0/10'::inet, '127.0.0.0/8'::inet, '169.254.0.0/16'::inet, '172.16.0.0/12'::inet, '192.168.0.0/16'::inet, '::1/128'::inet, 'fc00::/7'::inet, 'fe80::/10'::inet]))),
	CONSTRAINT "hops_position_check" CHECK ("hops"."position" > 0)
);
--> statement-breakpoint
CREATE TABLE "installs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"app_version" text NOT NULL,
	"country" char(2)
);
--> statement-breakpoint
CREATE TABLE "magic_link_tokens" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"member_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"install_id" uuid NOT NULL,
	"game_slug" text NOT NULL,
	"asn" bigint,
	"zone_cell_id" text,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"verdict_codes" text[] DEFAULT '{}'::text[] NOT NULL,
	"ping_median_ms" real,
	"ping_p95_ms" real,
	"loss_pct" real,
	"jitter_ms" real,
	"source" "measurement_source" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "matches_time_order_check" CHECK ("matches"."ended_at" is null or "matches"."ended_at" >= "matches"."started_at")
);
--> statement-breakpoint
CREATE TABLE "members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" "member_role" DEFAULT 'viewer' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organisations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" text PRIMARY KEY NOT NULL,
	"payload" jsonb NOT NULL,
	"game_slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone DEFAULT now() + interval '90 days' NOT NULL,
	"delete_token_hash" text NOT NULL,
	"exact_times" boolean DEFAULT false NOT NULL,
	CONSTRAINT "reports_id_length_check" CHECK (char_length("reports"."id") >= 16)
);
--> statement-breakpoint
CREATE TABLE "routes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_id" uuid NOT NULL,
	"target_ip" "inet" NOT NULL,
	"measured_at" timestamp with time zone NOT NULL,
	CONSTRAINT "routes_target_ip_public_check" CHECK (not ("routes"."target_ip" <<= any (array['0.0.0.0/8'::inet, '10.0.0.0/8'::inet, '100.64.0.0/10'::inet, '127.0.0.0/8'::inet, '169.254.0.0/16'::inet, '172.16.0.0/12'::inet, '192.168.0.0/16'::inet, '::1/128'::inet, 'fc00::/7'::inet, 'fe80::/10'::inet])))
);
--> statement-breakpoint
CREATE TABLE "topology_links" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "topology_links_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"from_ip" "inet" NOT NULL,
	"to_ip" "inet" NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"latency_ms" real,
	"loss_pct" real,
	"game_slug" text NOT NULL,
	"zone_cell_id" text,
	CONSTRAINT "topology_links_distinct_check" CHECK ("topology_links"."from_ip" <> "topology_links"."to_ip")
);
--> statement-breakpoint
CREATE TABLE "topology_nodes" (
	"ip" "inet" PRIMARY KEY NOT NULL,
	"asn" bigint,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "topology_nodes_ip_public_check" CHECK (not ("topology_nodes"."ip" <<= any (array['0.0.0.0/8'::inet, '10.0.0.0/8'::inet, '100.64.0.0/10'::inet, '127.0.0.0/8'::inet, '169.254.0.0/16'::inet, '172.16.0.0/12'::inet, '192.168.0.0/16'::inet, '::1/128'::inet, 'fc00::/7'::inet, 'fe80::/10'::inet])))
);
--> statement-breakpoint
CREATE TABLE "zone_cells" (
	"id" text PRIMARY KEY NOT NULL,
	"resolution" smallint NOT NULL,
	"country" char(2) NOT NULL,
	CONSTRAINT "zone_cells_resolution_check" CHECK ("zone_cells"."resolution" between 0 and 5)
);
--> statement-breakpoint
ALTER TABLE "asn_claims" ADD CONSTRAINT "asn_claims_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asn_claims" ADD CONSTRAINT "asn_claims_asn_autonomous_systems_asn_fk" FOREIGN KEY ("asn") REFERENCES "public"."autonomous_systems"("asn") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hops" ADD CONSTRAINT "hops_route_id_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."routes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hops" ADD CONSTRAINT "hops_asn_autonomous_systems_asn_fk" FOREIGN KEY ("asn") REFERENCES "public"."autonomous_systems"("asn") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "magic_link_tokens" ADD CONSTRAINT "magic_link_tokens_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_install_id_installs_id_fk" FOREIGN KEY ("install_id") REFERENCES "public"."installs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_game_slug_games_slug_fk" FOREIGN KEY ("game_slug") REFERENCES "public"."games"("slug") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_asn_autonomous_systems_asn_fk" FOREIGN KEY ("asn") REFERENCES "public"."autonomous_systems"("asn") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_zone_cell_id_zone_cells_id_fk" FOREIGN KEY ("zone_cell_id") REFERENCES "public"."zone_cells"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_game_slug_games_slug_fk" FOREIGN KEY ("game_slug") REFERENCES "public"."games"("slug") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routes" ADD CONSTRAINT "routes_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topology_links" ADD CONSTRAINT "topology_links_from_ip_topology_nodes_ip_fk" FOREIGN KEY ("from_ip") REFERENCES "public"."topology_nodes"("ip") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topology_links" ADD CONSTRAINT "topology_links_to_ip_topology_nodes_ip_fk" FOREIGN KEY ("to_ip") REFERENCES "public"."topology_nodes"("ip") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topology_links" ADD CONSTRAINT "topology_links_game_slug_games_slug_fk" FOREIGN KEY ("game_slug") REFERENCES "public"."games"("slug") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topology_links" ADD CONSTRAINT "topology_links_zone_cell_id_zone_cells_id_fk" FOREIGN KEY ("zone_cell_id") REFERENCES "public"."zone_cells"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topology_nodes" ADD CONSTRAINT "topology_nodes_asn_autonomous_systems_asn_fk" FOREIGN KEY ("asn") REFERENCES "public"."autonomous_systems"("asn") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "asn_claims_organisation_asn_idx" ON "asn_claims" USING btree ("organisation_id","asn");--> statement-breakpoint
CREATE UNIQUE INDEX "asn_claims_verified_asn_idx" ON "asn_claims" USING btree ("asn") WHERE "asn_claims"."status" = 'verified';--> statement-breakpoint
CREATE INDEX "hops_asn_idx" ON "hops" USING btree ("asn");--> statement-breakpoint
CREATE INDEX "magic_link_tokens_member_idx" ON "magic_link_tokens" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "magic_link_tokens_expires_at_idx" ON "magic_link_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "matches_game_asn_zone_started_idx" ON "matches" USING btree ("game_slug","asn","zone_cell_id","started_at");--> statement-breakpoint
CREATE INDEX "matches_asn_started_idx" ON "matches" USING btree ("asn","started_at");--> statement-breakpoint
CREATE INDEX "matches_zone_started_idx" ON "matches" USING btree ("zone_cell_id","started_at");--> statement-breakpoint
CREATE INDEX "matches_install_idx" ON "matches" USING btree ("install_id");--> statement-breakpoint
CREATE UNIQUE INDEX "members_organisation_email_idx" ON "members" USING btree ("organisation_id",lower("email"));--> statement-breakpoint
CREATE INDEX "members_email_idx" ON "members" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "reports_expires_at_idx" ON "reports" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "routes_match_idx" ON "routes" USING btree ("match_id");--> statement-breakpoint
CREATE INDEX "routes_target_ip_idx" ON "routes" USING btree ("target_ip");--> statement-breakpoint
CREATE INDEX "topology_links_edge_observed_idx" ON "topology_links" USING btree ("from_ip","to_ip","observed_at");--> statement-breakpoint
CREATE INDEX "topology_links_to_idx" ON "topology_links" USING btree ("to_ip");--> statement-breakpoint
CREATE INDEX "topology_links_game_zone_observed_idx" ON "topology_links" USING btree ("game_slug","zone_cell_id","observed_at");--> statement-breakpoint
CREATE INDEX "topology_nodes_asn_idx" ON "topology_nodes" USING btree ("asn");--> statement-breakpoint
CREATE INDEX "zone_cells_country_idx" ON "zone_cells" USING btree ("country");