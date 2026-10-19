-- EMR-48. The addresses of deleted photos that wait for their purge from the
-- cache of the media hostname: deleting a photo deletes its objects from R2
-- and purges both of its addresses from Cloudflare's cache; when the purge
-- fails, the addresses wait here and the hourly job retries them, forgetting
-- each one once purged. The CHECK admits only the address of a variant of a
-- photo, so nothing about a card can be kept. Additive: a new table that no
-- other table references.
CREATE TABLE "photo_cache_purges" (
	"url" text PRIMARY KEY NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "photo_cache_purges_url_check" CHECK ("photo_cache_purges"."url" ~ '^https://[a-z0-9.-]+/photos/[23456789abcdefghjkmnpqrstuvwxyz]{24}/(card\.webp|full\.webp)$')
);
