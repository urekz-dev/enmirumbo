-- EMR-42 (ADR 0012, ADR 0013). The site's switches, in one row: Turnstile on
-- the registration and edit forms, on by default, which an admin turns off
-- without a deploy. The daily registrations threshold of every locality
-- defaults to 20 registrations of one local day, and the localities that
-- already exist take it too (none disables the alert); the day of the last
-- alert keeps the hourly job to one alert a day.
CREATE TABLE "site_settings" (
	"singleton" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"turnstile_enabled" boolean DEFAULT true NOT NULL,
	CONSTRAINT "site_settings_singleton_check" CHECK ("site_settings"."singleton")
);
--> statement-breakpoint
INSERT INTO "site_settings" ("singleton") VALUES (true) ON CONFLICT DO NOTHING;--> statement-breakpoint
ALTER TABLE "localities" ALTER COLUMN "daily_registration_threshold" SET DEFAULT 20;--> statement-breakpoint
UPDATE "localities" SET "daily_registration_threshold" = 20 WHERE "daily_registration_threshold" IS NULL;--> statement-breakpoint
ALTER TABLE "localities" ADD COLUMN "daily_registration_alerted_on" date;
