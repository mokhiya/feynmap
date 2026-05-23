CREATE TYPE "public"."appeal_status" AS ENUM('open', 'accepted', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."assessment_status" AS ENUM('auto', 'pending_review', 'approved', 'overridden');--> statement-breakpoint
CREATE TYPE "public"."assignment_status" AS ENUM('assigned', 'in_progress', 'completed', 'overdue', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."assignment_target_type" AS ENUM('topic', 'lesson');--> statement-breakpoint
CREATE TYPE "public"."document_status" AS ENUM('uploaded', 'parsing', 'indexed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."lesson_status" AS ENUM('draft', 'published', 'archived');--> statement-breakpoint
CREATE TYPE "public"."session_mode" AS ENUM('practice', 'assessment');--> statement-breakpoint
CREATE TYPE "public"."session_status" AS ENUM('in_progress', 'auto_scored', 'pending_review', 'finalized', 'abandoned');--> statement-breakpoint
CREATE TYPE "public"."topic_status" AS ENUM('draft', 'published', 'archived');--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'assignment.complete' BEFORE 'assessment.override';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'assessment.appeal' BEFORE 'session.convert_to_assessment';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'assessment.appeal_resolve' BEFORE 'session.convert_to_assessment';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'topic.create' BEFORE 'session.convert_to_assessment';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'topic.update' BEFORE 'session.convert_to_assessment';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'topic.delete' BEFORE 'session.convert_to_assessment';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'lesson.create' BEFORE 'session.convert_to_assessment';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'lesson.update' BEFORE 'session.convert_to_assessment';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'lesson.delete' BEFORE 'session.convert_to_assessment';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'session.start' BEFORE 'session.convert_to_assessment';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'session.finalize' BEFORE 'session.convert_to_assessment';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'session.flag_suspicious' BEFORE 'session.convert_to_assessment';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "assessment_appeals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"result_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"status" "appeal_status" DEFAULT 'open' NOT NULL,
	"resolved_by" uuid,
	"resolution" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "assessment_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"competencies" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"strengths" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"gaps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"recommendations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"next_focus" text,
	"source_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "assessment_status" DEFAULT 'auto' NOT NULL,
	"overridden_by" uuid,
	"override_comment" text,
	"overridden_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"assigner_id" uuid NOT NULL,
	"assignee_id" uuid NOT NULL,
	"target_type" "assignment_target_type" NOT NULL,
	"target_id" uuid NOT NULL,
	"due_at" timestamp with time zone,
	"status" "assignment_status" DEFAULT 'assigned' NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"lesson_id" uuid,
	"name" text NOT NULL,
	"mime" text NOT NULL,
	"size_bytes" bigint DEFAULT 0 NOT NULL,
	"storage_path" text NOT NULL,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "competencies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"topic_id" uuid,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"weight" double precision DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "document_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"chunk_index" integer NOT NULL,
	"text" text NOT NULL,
	"tokens" integer DEFAULT 0 NOT NULL,
	"page" integer,
	"heading" text,
	"embedding" vector(1024),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"mime" text NOT NULL,
	"size_bytes" bigint DEFAULT 0 NOT NULL,
	"storage_path" text NOT NULL,
	"plain_text" text,
	"status" "document_status" DEFAULT 'uploaded' NOT NULL,
	"error" text,
	"version" integer DEFAULT 1 NOT NULL,
	"chunk_count" integer DEFAULT 0 NOT NULL,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lesson_topics" (
	"lesson_id" uuid NOT NULL,
	"topic_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "lesson_topics_lesson_id_topic_id_pk" PRIMARY KEY("lesson_id","topic_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lessons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"intro_content" text DEFAULT '' NOT NULL,
	"status" "lesson_status" DEFAULT 'draft' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "role_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"role_label" text NOT NULL,
	"competency_id" uuid,
	"competency_name" text NOT NULL,
	"target_score" integer DEFAULT 70 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"topic_id" uuid,
	"topic_label" text DEFAULT '' NOT NULL,
	"mode" "session_mode" DEFAULT 'practice' NOT NULL,
	"status" "session_status" DEFAULT 'in_progress' NOT NULL,
	"locale" text DEFAULT 'ru' NOT NULL,
	"transcript" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"flags" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"wellbeing" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"doc_versions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"assignment_id" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finalized_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "spaced_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"topic_id" uuid,
	"competency_name" text NOT NULL,
	"last_score" integer DEFAULT 0 NOT NULL,
	"review_at" timestamp with time zone NOT NULL,
	"interval_days" integer DEFAULT 1 NOT NULL,
	"ease_factor" double precision DEFAULT 2.5 NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "topic_documents" (
	"topic_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "topic_documents_topic_id_document_id_pk" PRIMARY KEY("topic_id","document_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "topics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"locale" text DEFAULT 'ru' NOT NULL,
	"status" "topic_status" DEFAULT 'draft' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "assessment_appeals" ADD CONSTRAINT "assessment_appeals_result_id_assessment_results_id_fk" FOREIGN KEY ("result_id") REFERENCES "public"."assessment_results"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "assessment_appeals" ADD CONSTRAINT "assessment_appeals_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "assessment_appeals" ADD CONSTRAINT "assessment_appeals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "assessment_appeals" ADD CONSTRAINT "assessment_appeals_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "assessment_results" ADD CONSTRAINT "assessment_results_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "assessment_results" ADD CONSTRAINT "assessment_results_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "assessment_results" ADD CONSTRAINT "assessment_results_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "assessment_results" ADD CONSTRAINT "assessment_results_overridden_by_users_id_fk" FOREIGN KEY ("overridden_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "assignments" ADD CONSTRAINT "assignments_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "assignments" ADD CONSTRAINT "assignments_assigner_id_users_id_fk" FOREIGN KEY ("assigner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "assignments" ADD CONSTRAINT "assignments_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "attachments" ADD CONSTRAINT "attachments_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "attachments" ADD CONSTRAINT "attachments_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "attachments" ADD CONSTRAINT "attachments_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "competencies" ADD CONSTRAINT "competencies_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "competencies" ADD CONSTRAINT "competencies_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "documents" ADD CONSTRAINT "documents_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "documents" ADD CONSTRAINT "documents_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lesson_topics" ADD CONSTRAINT "lesson_topics_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lesson_topics" ADD CONSTRAINT "lesson_topics_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lessons" ADD CONSTRAINT "lessons_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lessons" ADD CONSTRAINT "lessons_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "role_targets" ADD CONSTRAINT "role_targets_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "role_targets" ADD CONSTRAINT "role_targets_competency_id_competencies_id_fk" FOREIGN KEY ("competency_id") REFERENCES "public"."competencies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sessions" ADD CONSTRAINT "sessions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sessions" ADD CONSTRAINT "sessions_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sessions" ADD CONSTRAINT "sessions_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "spaced_reviews" ADD CONSTRAINT "spaced_reviews_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "spaced_reviews" ADD CONSTRAINT "spaced_reviews_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "spaced_reviews" ADD CONSTRAINT "spaced_reviews_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "topic_documents" ADD CONSTRAINT "topic_documents_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "topic_documents" ADD CONSTRAINT "topic_documents_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "topics" ADD CONSTRAINT "topics_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "topics" ADD CONSTRAINT "topics_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "appeals_result_idx" ON "assessment_appeals" USING btree ("result_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "appeals_status_idx" ON "assessment_appeals" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "assessment_results_session_idx" ON "assessment_results" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assessment_results_user_idx" ON "assessment_results" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assessment_results_status_idx" ON "assessment_results" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assignments_org_idx" ON "assignments" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assignments_assignee_idx" ON "assignments" USING btree ("assignee_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assignments_status_idx" ON "assignments" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "attachments_lesson_idx" ON "attachments" USING btree ("lesson_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "competencies_org_idx" ON "competencies" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "competencies_topic_idx" ON "competencies" USING btree ("topic_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "document_chunks_doc_idx_idx" ON "document_chunks" USING btree ("document_id","chunk_index");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_chunks_org_idx" ON "document_chunks" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "documents_org_idx" ON "documents" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "documents_status_idx" ON "documents" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lessons_org_idx" ON "lessons" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "role_targets_org_role_idx" ON "role_targets" USING btree ("org_id","role_label");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sessions_org_idx" ON "sessions" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sessions_mode_status_idx" ON "sessions" USING btree ("mode","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "spaced_reviews_user_review_idx" ON "spaced_reviews" USING btree ("user_id","review_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "topic_documents_doc_idx" ON "topic_documents" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "topics_org_idx" ON "topics" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "topics_org_status_idx" ON "topics" USING btree ("org_id","status");