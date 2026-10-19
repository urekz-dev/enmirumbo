-- EMR-43 (ADR 0011). A pending edit may change the photo of its card: leave
-- it (`keep`, what every edit that already exists does), put in its place the
-- new photo the edit uploaded (`replace`, under `new_photo_key`, a key the
-- server generates) or leave the card without one (`remove`). A waiting
-- `replace` always names its key; a superseded edit gives it up, to the newer
-- edit that keeps that photo or because its objects were deleted, so one edit
-- names a photo at a time. The card's photo changes only when the admin
-- applies the edit. Additive: two columns and their constraints, which every
-- existing row already meets.
ALTER TABLE "pending_edits" ADD COLUMN "photo_change" text DEFAULT 'keep' NOT NULL;--> statement-breakpoint
ALTER TABLE "pending_edits" ADD COLUMN "new_photo_key" text;--> statement-breakpoint
ALTER TABLE "pending_edits" ADD CONSTRAINT "pending_edits_new_photo_key_unique" UNIQUE("new_photo_key");--> statement-breakpoint
ALTER TABLE "pending_edits" ADD CONSTRAINT "pending_edits_photo_change_check" CHECK ("pending_edits"."photo_change" IN ('keep', 'replace', 'remove'));--> statement-breakpoint
ALTER TABLE "pending_edits" ADD CONSTRAINT "pending_edits_new_photo_check" CHECK (("pending_edits"."new_photo_key" IS NULL OR "pending_edits"."photo_change" = 'replace') AND ("pending_edits"."status" <> 'pending' OR "pending_edits"."photo_change" <> 'replace' OR "pending_edits"."new_photo_key" IS NOT NULL) AND "pending_edits"."new_photo_key" ~ '^[23456789abcdefghjkmnpqrstuvwxyz]{24}$');