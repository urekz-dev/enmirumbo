CREATE TABLE "orphan_photo_sweep_state" (
	"singleton" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"cursor" text,
	"completed_on" date,
	CONSTRAINT "orphan_photo_sweep_state_singleton_check" CHECK ("orphan_photo_sweep_state"."singleton")
);
--> statement-breakpoint
INSERT INTO "orphan_photo_sweep_state" ("singleton") VALUES (true);
