-- EMR-47. The rejection a resubmission answered: when the owner corrects a
-- rejected card and sends it again, the resubmission clears `rejected_at`
-- and `rejection_reason` (the 90-day purge of rejected registrations reads
-- them) and now keeps them here, so the panel labels the card "Reenvío" and
-- says why it was rejected before. The next resubmission overwrites them;
-- nothing else clears them. Additive: two nullable columns, written together,
-- which every existing row meets.
ALTER TABLE "businesses" ADD COLUMN "previous_rejected_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "previous_rejection_reason" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_previous_rejection_check" CHECK (("businesses"."previous_rejected_at" IS NULL) = ("businesses"."previous_rejection_reason" IS NULL));