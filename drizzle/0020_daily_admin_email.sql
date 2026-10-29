CREATE TABLE "daily_admin_email_state" (
	"locality_code" char(5) PRIMARY KEY NOT NULL,
	"environment" text NOT NULL,
	"day" date NOT NULL,
	"completed" boolean DEFAULT false NOT NULL,
	"first_attempt_at" timestamp with time zone NOT NULL,
	"batch" jsonb
);
--> statement-breakpoint
ALTER TABLE "localities" ADD COLUMN "daily_registration_alert_snapshots" jsonb;--> statement-breakpoint
ALTER TABLE "orphan_photo_sweep_state" ADD COLUMN "started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "daily_admin_email_state" ADD CONSTRAINT "daily_admin_email_state_locality_code_localities_code_fk" FOREIGN KEY ("locality_code") REFERENCES "public"."localities"("code") ON DELETE cascade ON UPDATE no action;