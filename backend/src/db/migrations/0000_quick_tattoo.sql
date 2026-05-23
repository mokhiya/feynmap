CREATE TYPE "public"."audit_action" AS ENUM('user.create', 'user.update', 'user.block', 'user.unblock', 'user.password_reset', 'user.import', 'role.assign', 'role.revoke', 'mentor.bind', 'mentor.unbind', 'auth.login', 'auth.login_failed', 'auth.logout', 'kb.upload', 'kb.delete', 'kb.reindex', 'assignment.create', 'assessment.override', 'session.convert_to_assessment');--> statement-breakpoint
CREATE TYPE "public"."permission_scope" AS ENUM('own', 'team', 'org');--> statement-breakpoint
CREATE TYPE "public"."role_code" AS ENUM('super_admin', 'admin', 'assessor', 'hr', 'mentor', 'learner_free', 'learner_assigned');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('active', 'blocked', 'invited');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"action" "audit_action" NOT NULL,
	"target_type" text,
	"target_id" text,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mentor_bindings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"mentor_id" uuid NOT NULL,
	"learner_id" uuid NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"description" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "role_permissions" (
	"role_id" uuid NOT NULL,
	"permission_id" uuid NOT NULL,
	"scope" "permission_scope" DEFAULT 'own' NOT NULL,
	CONSTRAINT "role_permissions_role_id_permission_id_scope_pk" PRIMARY KEY("role_id","permission_id","scope")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"code" "role_code" NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_roles" (
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"assigned_by" uuid,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_roles_user_id_role_id_pk" PRIMARY KEY("user_id","role_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"full_name" text NOT NULL,
	"locale" text DEFAULT 'ru' NOT NULL,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mentor_bindings" ADD CONSTRAINT "mentor_bindings_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mentor_bindings" ADD CONSTRAINT "mentor_bindings_mentor_id_users_id_fk" FOREIGN KEY ("mentor_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mentor_bindings" ADD CONSTRAINT "mentor_bindings_learner_id_users_id_fk" FOREIGN KEY ("learner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "roles" ADD CONSTRAINT "roles_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "users" ADD CONSTRAINT "users_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_logs_org_created_idx" ON "audit_logs" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_logs_actor_idx" ON "audit_logs" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_logs_action_idx" ON "audit_logs" USING btree ("action");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mentor_bindings_pair_idx" ON "mentor_bindings" USING btree ("mentor_id","learner_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mentor_bindings_learner_idx" ON "mentor_bindings" USING btree ("learner_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mentor_bindings_org_idx" ON "mentor_bindings" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "organizations_slug_idx" ON "organizations" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "permissions_code_idx" ON "permissions" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "roles_org_code_idx" ON "roles" USING btree ("org_id","code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_roles_user_idx" ON "user_roles" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "users_org_email_idx" ON "users" USING btree ("org_id","email");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_org_idx" ON "users" USING btree ("org_id");