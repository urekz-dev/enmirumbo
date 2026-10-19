// Saving a valid registration (docs/specs/business-registration.md, "A
// successful submission queues the business and shows the thank-you screen",
// "One card per WhatsApp number" and "Consent with a visible simplified
// notice and a consent record"; docs/specs/data-model.md, "One card per
// WhatsApp number within a locality (v2)" and "The consent record stores
// which notice version it was given against").
//
// - A new number in the locality creates the business in `in_review`, with
//   origin `organic`, its consent record (the moment the server saved it and
//   the version of the notice in force), the photo key of the photo just
//   stored, if any, and nothing else the server owns: no trades, no
//   publication date, no management link. The database derives the search
//   text (`name_normalized`, `what_you_offer_normalized`).
// - A number whose card was rejected is a resubmission: that same card takes
//   the new data and goes back to `in_review`, its rejection trace is
//   cleared and kept as its previous rejection (data-model, "The business
//   keeps the rejection its resubmission answered (v2)"), its wait restarts
//   (`registered_at`), and its consent record is kept whole. When the notice
//   in force is later than the record's, the re-acceptance is noted beside
//   it. Its origin, trades, management link, publication date and
//   unpublishing trace do not change. Its photo is replaced by the one just
//   stored, removed ("Dejar mi ficha sin foto") or kept, as the submission
//   asks; the photo it no longer names is given back so its objects are
//   deleted once the card is saved (business-registration, "Resubmission
//   after a rejection allows changing or removing the photo").
// - A number whose card is in review or published is a duplicate, and
//   nothing changes.
//
// No race window: the database decides uniqueness (`INSERT … ON CONFLICT DO
// NOTHING` on the number of the locality), so the second of two simultaneous
// registrations of one number is a duplicate, never an error; and a
// resubmission only updates a card that is still rejected, so an admin who
// resolved it a moment before is never overridden.
//
// Binding: HYPERDRIVE_FRESH, as every write.
import { and, eq, sql } from "drizzle-orm";
import { newBusinessId } from "../business/id.ts";
import type { Db } from "../db/client.ts";
import { businesses } from "../db/schema/index.ts";
import { isLaterNoticeVersion, NOTICE_VERSION } from "../legal/version.ts";
import { isPhotoKey } from "../photos/photo.ts";
import type { NewRegistration } from "./submission.ts";

/**
 * What a registration does to the card's photo: leave it (a new card has
 * none), name the photo just stored under `key`, or leave the card without
 * one.
 */
export type PhotoChange = { kind: "keep" } | { kind: "set"; key: string } | { kind: "remove" };

/**
 * What happened to a registration. A resubmission that replaced or removed
 * the card's photo gives back the key it no longer names, whose objects are
 * then deleted; a stored value that is not a photo key names no objects.
 */
export type SaveRegistrationOutcome =
  | { kind: "created" }
  | { kind: "resubmitted"; droppedPhotoKey: string | null }
  | { kind: "duplicate" };

const CREATED: SaveRegistrationOutcome = { kind: "created" };
const DUPLICATE: SaveRegistrationOutcome = { kind: "duplicate" };

/** The PostgreSQL code of a unique violation, and the constraint of the identifier. */
const UNIQUE_VIOLATION = "23505";
const PRIMARY_KEY = "businesses_pkey";

/** Whether `error` is a repeated business identifier, which a new one fixes. */
function isRepeatedId(error: unknown): boolean {
  for (let cause: unknown = error; cause instanceof Error; cause = cause.cause) {
    const { code, constraint } = cause as Error & { code?: unknown; constraint?: unknown };
    if (code === UNIQUE_VIOLATION) return constraint === PRIMARY_KEY;
  }
  return false;
}

/** How many times a registration may meet a repeated identifier or a card that vanished. */
const ATTEMPTS = 3;

export interface SaveRegistrationOptions {
  /** What the registration does to the photo; it keeps it unless told otherwise. */
  photo?: PhotoChange;
  /** The version of the notice in force; the server's, never a submission's. */
  noticeVersion?: string;
  /** Where identifiers come from (newBusinessId); tests pass their own. */
  newId?: () => string;
}

/**
 * Saves `registration` in the locality `localityCode`: a new card, the
 * resubmission of a rejected one, or nothing for a duplicate.
 */
export async function saveRegistration(
  db: Db,
  localityCode: string,
  registration: NewRegistration,
  {
    photo = { kind: "keep" },
    noticeVersion = NOTICE_VERSION,
    newId = newBusinessId,
  }: SaveRegistrationOptions = {},
): Promise<SaveRegistrationOutcome> {
  const newPhotoKey = photo.kind === "set" ? photo.key : null;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    let created: { id: string }[];
    try {
      created = await db
        .insert(businesses)
        .values({
          id: newId(),
          localityCode,
          ...registration,
          photoKey: newPhotoKey,
          // The consent record is one pair, written at once: the moment of
          // this statement, the same as `registered_at`, and the version in
          // force on the server.
          consentedToNoticeAt: sql`now()`,
          consentedToNoticeVersion: noticeVersion,
          status: "in_review",
          origin: "organic",
        })
        .onConflictDoNothing({ target: [businesses.localityCode, businesses.whatsapp] })
        .returning({ id: businesses.id });
    } catch (error) {
      if (isRepeatedId(error) && attempt < ATTEMPTS) continue;
      throw error;
    }
    if (created.length > 0) return CREATED;

    // The number already has a card in this locality.
    const [card] = await db
      .select({
        id: businesses.id,
        status: businesses.status,
        consentedToNoticeVersion: businesses.consentedToNoticeVersion,
        photoKey: businesses.photoKey,
      })
      .from(businesses)
      .where(
        and(
          eq(businesses.localityCode, localityCode),
          eq(businesses.whatsapp, registration.whatsapp),
        ),
      );
    // Deleted in the meantime: the number is free again.
    if (card === undefined) continue;
    if (card.status !== "rejected") return DUPLICATE;

    const reconsent = isLaterNoticeVersion(noticeVersion, card.consentedToNoticeVersion)
      ? { reconsentedToNoticeAt: sql`now()`, reconsentedToNoticeVersion: noticeVersion }
      : {};
    const photoChange = photo.kind === "keep" ? {} : { photoKey: newPhotoKey };
    const resubmitted = await db
      .update(businesses)
      .set({
        ...registration,
        ...reconsent,
        ...photoChange,
        status: "in_review",
        // The rejection this resubmission answers moves to the previous
        // rejection, which the panel shows ("Reenvío", "La rechazaste antes
        // por: …"); the rejection itself is cleared, so the 90-day purge of
        // rejected registrations no longer reads it. Each SET reads the row
        // as it was, and a rejection without its pair keeps the earlier one.
        previousRejectedAt: sql`coalesce(${businesses.rejectedAt}, ${businesses.previousRejectedAt})`,
        previousRejectionReason: sql`coalesce(${businesses.rejectionReason}, ${businesses.previousRejectionReason})`,
        rejectedAt: null,
        rejectionReason: null,
        // The wait of the review queue counts from the resubmission.
        registeredAt: sql`now()`,
      })
      .where(and(eq(businesses.id, card.id), eq(businesses.status, "rejected")))
      .returning({ id: businesses.id });
    // Resolved by the admin a moment before: no longer a resubmission.
    if (resubmitted.length === 0) return DUPLICATE;
    const dropped = photo.kind !== "keep" && card.photoKey !== newPhotoKey;
    return {
      kind: "resubmitted",
      droppedPhotoKey: dropped && isPhotoKey(card.photoKey) ? card.photoKey : null,
    };
  }
  throw new Error("registration: the business could not be saved after several attempts");
}
