CREATE SCHEMA "homefax";
--> statement-breakpoint
CREATE TABLE "homefax"."assignments" (
	"id" text PRIMARY KEY NOT NULL,
	"record_id" text NOT NULL,
	"assignee_user_id" text,
	"assignee_org_id" text,
	"task" text NOT NULL,
	"stage" text,
	"status" text DEFAULT 'open' NOT NULL,
	"assigned_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "homefax"."captures" (
	"id" text PRIMARY KEY NOT NULL,
	"record_id" text NOT NULL,
	"stage" text NOT NULL,
	"job_id" text,
	"state" text DEFAULT 'queued' NOT NULL,
	"source_url" text,
	"frames" jsonb DEFAULT '[]'::jsonb,
	"glb_url" text,
	"job" jsonb,
	"quality" jsonb,
	"parts" jsonb DEFAULT '[]'::jsonb,
	"score" real,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "homefax"."hires" (
	"id" text PRIMARY KEY NOT NULL,
	"from_org_id" text NOT NULL,
	"to_user_id" text,
	"to_org_id" text,
	"task" text NOT NULL,
	"record_id" text,
	"note" text,
	"status" text DEFAULT 'offered' NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "homefax"."memberships" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"title" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "homefax"."orgs" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"headline" text,
	"bio" text,
	"is_public" boolean DEFAULT false NOT NULL,
	"hfx_key" text NOT NULL,
	"owner_user_id" text NOT NULL,
	"claimed_key_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "homefax"."project_access" (
	"id" text PRIMARY KEY NOT NULL,
	"record_id" text NOT NULL,
	"org_id" text NOT NULL,
	"role" text DEFAULT 'collaborator' NOT NULL,
	"added_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "homefax"."records" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"address" text NOT NULL,
	"owner" text,
	"contractor" text,
	"key_id" text,
	"org_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "homefax"."users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"name" text NOT NULL,
	"handle" text NOT NULL,
	"headline" text,
	"bio" text,
	"is_public" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "homefax"."assignments" ADD CONSTRAINT "assignments_record_id_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "homefax"."records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "homefax"."assignments" ADD CONSTRAINT "assignments_assignee_user_id_users_id_fk" FOREIGN KEY ("assignee_user_id") REFERENCES "homefax"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "homefax"."assignments" ADD CONSTRAINT "assignments_assignee_org_id_orgs_id_fk" FOREIGN KEY ("assignee_org_id") REFERENCES "homefax"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "homefax"."captures" ADD CONSTRAINT "captures_record_id_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "homefax"."records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "homefax"."hires" ADD CONSTRAINT "hires_from_org_id_orgs_id_fk" FOREIGN KEY ("from_org_id") REFERENCES "homefax"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "homefax"."hires" ADD CONSTRAINT "hires_to_user_id_users_id_fk" FOREIGN KEY ("to_user_id") REFERENCES "homefax"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "homefax"."hires" ADD CONSTRAINT "hires_to_org_id_orgs_id_fk" FOREIGN KEY ("to_org_id") REFERENCES "homefax"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "homefax"."hires" ADD CONSTRAINT "hires_record_id_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "homefax"."records"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "homefax"."memberships" ADD CONSTRAINT "memberships_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "homefax"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "homefax"."memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "homefax"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "homefax"."orgs" ADD CONSTRAINT "orgs_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "homefax"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "homefax"."project_access" ADD CONSTRAINT "project_access_record_id_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "homefax"."records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "homefax"."project_access" ADD CONSTRAINT "project_access_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "homefax"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "captures_record_stage_idx" ON "homefax"."captures" USING btree ("record_id","stage");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_org_user_idx" ON "homefax"."memberships" USING btree ("org_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orgs_slug_idx" ON "homefax"."orgs" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "orgs_hfx_key_idx" ON "homefax"."orgs" USING btree ("hfx_key");--> statement-breakpoint
CREATE UNIQUE INDEX "project_access_record_org_idx" ON "homefax"."project_access" USING btree ("record_id","org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "records_slug_idx" ON "homefax"."records" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_idx" ON "homefax"."users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "users_handle_idx" ON "homefax"."users" USING btree ("handle");