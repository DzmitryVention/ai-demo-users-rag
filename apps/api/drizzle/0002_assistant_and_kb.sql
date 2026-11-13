CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE TYPE "public"."bot_decision" AS ENUM('answered', 'escalated', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."bot_mode" AS ENUM('off', 'live');--> statement-breakpoint
CREATE TYPE "public"."bot_state" AS ENUM('idle', 'queued', 'running', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."escalation_reason" AS ENUM('no_relevant_source', 'out_of_scope', 'unsupported_language', 'injection_suspected', 'abusive', 'user_requested', 'not_helpful', 'max_turns', 'quota_exceeded', 'budget_exceeded', 'model_refusal', 'guardrail_failed', 'error');--> statement-breakpoint
CREATE TYPE "public"."feedback_value" AS ENUM('helpful', 'not_helpful');--> statement-breakpoint
CREATE TYPE "public"."kb_article_status" AS ENUM('draft', 'approved', 'archived');--> statement-breakpoint
CREATE TYPE "public"."kb_source_status" AS ENUM('ingesting', 'active', 'retired');--> statement-breakpoint
CREATE TYPE "public"."message_visibility" AS ENUM('public', 'internal');--> statement-breakpoint
ALTER TYPE "public"."author_role" ADD VALUE 'bot';--> statement-breakpoint
ALTER TYPE "public"."ticket_status" ADD VALUE 'pending_human' BEFORE 'closed';--> statement-breakpoint
CREATE TABLE "bot_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"decision" "bot_decision" NOT NULL,
	"escalation_reason" "escalation_reason",
	"triage" jsonb,
	"retrieved" jsonb,
	"guardrails" jsonb,
	"model_answer" text,
	"model_triage" text,
	"prompt_version" text,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(10, 6) DEFAULT 0 NOT NULL,
	"latency_ms" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bot_settings" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"mode" "bot_mode" DEFAULT 'off' NOT NULL,
	"persona_name" text DEFAULT 'Alex Carter' NOT NULL,
	"min_relevance" numeric DEFAULT 0.55 NOT NULL,
	"max_turns_per_ticket" integer DEFAULT 3 NOT NULL,
	"max_runs_per_user_per_day" integer DEFAULT 20 NOT NULL,
	"monthly_budget_usd" numeric DEFAULT 18 NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kb_articles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"question" text NOT NULL,
	"answer" text NOT NULL,
	"source_ticket_id" uuid,
	"status" "kb_article_status" DEFAULT 'draft' NOT NULL,
	"created_by" uuid,
	"approved_by" uuid,
	"embedding" vector(768),
	"tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', "question" || ' ' || "answer")) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "kb_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"section_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"text" text NOT NULL,
	"token_count" integer NOT NULL,
	"embedding" vector(768) NOT NULL,
	"tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', "text")) STORED,
	"content_hash" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kb_links" (
	"from_section_id" uuid NOT NULL,
	"to_section_id" uuid NOT NULL,
	"anchor_text" text DEFAULT '' NOT NULL,
	CONSTRAINT "kb_links_from_section_id_to_section_id_pk" PRIMARY KEY("from_section_id","to_section_id")
);
--> statement-breakpoint
CREATE TABLE "kb_sections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"parent_id" uuid,
	"level" smallint NOT NULL,
	"ordinal" integer NOT NULL,
	"external_key" text NOT NULL,
	"title" text NOT NULL,
	"path" text NOT NULL,
	"url" text,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kb_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"edition" text NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"origin_url" text,
	"content_hash" text NOT NULL,
	"status" "kb_source_status" DEFAULT 'ingesting' NOT NULL,
	"licence_ref" text NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticket_summaries" (
	"ticket_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"summary" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ticket_messages" ALTER COLUMN "author_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "ticket_messages" ADD COLUMN "visibility" "message_visibility" DEFAULT 'public' NOT NULL;--> statement-breakpoint
ALTER TABLE "ticket_messages" ADD COLUMN "persona_name" text;--> statement-breakpoint
ALTER TABLE "ticket_messages" ADD COLUMN "citations" jsonb;--> statement-breakpoint
ALTER TABLE "ticket_messages" ADD COLUMN "notice" text;--> statement-breakpoint
ALTER TABLE "ticket_messages" ADD COLUMN "bot_run_id" uuid;--> statement-breakpoint
ALTER TABLE "ticket_messages" ADD COLUMN "feedback" "feedback_value";--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "bot_state" "bot_state" DEFAULT 'idle' NOT NULL;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "bot_turns" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "escalation_reason" "escalation_reason";--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "escalated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bot_runs" ADD CONSTRAINT "bot_runs_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot_settings" ADD CONSTRAINT "bot_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_articles" ADD CONSTRAINT "kb_articles_source_ticket_id_tickets_id_fk" FOREIGN KEY ("source_ticket_id") REFERENCES "public"."tickets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_articles" ADD CONSTRAINT "kb_articles_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_articles" ADD CONSTRAINT "kb_articles_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_chunks" ADD CONSTRAINT "kb_chunks_section_id_kb_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."kb_sections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_links" ADD CONSTRAINT "kb_links_from_section_id_kb_sections_id_fk" FOREIGN KEY ("from_section_id") REFERENCES "public"."kb_sections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_links" ADD CONSTRAINT "kb_links_to_section_id_kb_sections_id_fk" FOREIGN KEY ("to_section_id") REFERENCES "public"."kb_sections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_sections" ADD CONSTRAINT "kb_sections_source_id_kb_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."kb_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_summaries" ADD CONSTRAINT "ticket_summaries_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_summaries" ADD CONSTRAINT "ticket_summaries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bot_runs_message_uq" ON "bot_runs" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "bot_runs_user_created_idx" ON "bot_runs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "bot_runs_created_idx" ON "bot_runs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "kb_articles_embedding_idx" ON "kb_articles" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "kb_articles_tsv_idx" ON "kb_articles" USING gin ("tsv");--> statement-breakpoint
CREATE INDEX "kb_chunks_section_idx" ON "kb_chunks" USING btree ("section_id");--> statement-breakpoint
CREATE INDEX "kb_chunks_embedding_idx" ON "kb_chunks" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "kb_chunks_tsv_idx" ON "kb_chunks" USING gin ("tsv");--> statement-breakpoint
CREATE UNIQUE INDEX "kb_sections_source_key_uq" ON "kb_sections" USING btree ("source_id","external_key");--> statement-breakpoint
CREATE INDEX "kb_sections_parent_idx" ON "kb_sections" USING btree ("parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "kb_sources_one_active_uq" ON "kb_sources" USING btree ("status") WHERE "kb_sources"."status" = 'active';--> statement-breakpoint
CREATE INDEX "ticket_summaries_user_idx" ON "ticket_summaries" USING btree ("user_id","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "tickets_status_escalated_idx" ON "tickets" USING btree ("status","escalated_at");