// Saving a valid registration (docs/specs/business-registration.md, "A
// successful submission queues the business and shows the thank-you screen",
// "One card per WhatsApp number" and "Consent with a visible simplified
// notice and a consent record"; docs/specs/data-model.md, "One card per
// WhatsApp number within a locality (v2)" and "The consent record stores
// which notice version it was given against").
//
// - A new number in the locality creates the business in `in_review`, with
//   origin `organic`, its consent record (the moment the server saved it and
//   the version of the notice in force) and nothing else the server owns: no
//   trades, no publication date, no management link, no photo. The database
//   derives the search text (`name_normalized`, `what_you_offer_normalized`).
// - A number whose card was rejected is a resubmission: that same card takes
//   the new data and goes back to `in_review`, its rejection trace is
//   cleared and its wait restarts (`registered_at`), and its consent record
//   is kept whole. When the notice in force is later than the record's, the
//   re-acceptance is noted beside it. Its origin, trades, management link,
//   publication date, unpublishing trace and photo do not change.
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
import type { NewRegistration } from "./submission.ts";

/** What happened to a registration. */
export type SaveRegistrationOutcome = "created" | "resubmitted" | "duplicate";

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
  { noticeVersion = NOTICE_VERSION, newId = newBusinessId }: SaveRegistrationOptions = {},
): Promise<SaveRegistrationOutcome> {
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    let created: { id: string }[];
    try {
      created = await db
        .insert(businesses)
        .values({
          id: newId(),
          localityCode,
          ...registration,
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
    if (created.length > 0) return "created";

    // The number already has a card in this locality.
    const [card] = await db
      .select({
        id: businesses.id,
        status: businesses.status,
        consentedToNoticeVersion: businesses.consentedToNoticeVersion,
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
    if (card.status !== "rejected") return "duplicate";

    const reconsent = isLaterNoticeVersion(noticeVersion, card.consentedToNoticeVersion)
      ? { reconsentedToNoticeAt: sql`now()`, reconsentedToNoticeVersion: noticeVersion }
      : {};
    const resubmitted = await db
      .update(businesses)
      .set({
        ...registration,
        ...reconsent,
        status: "in_review",
        rejectedAt: null,
        rejectionReason: null,
        // The wait of the review queue counts from the resubmission.
        registeredAt: sql`now()`,
      })
      .where(and(eq(businesses.id, card.id), eq(businesses.status, "rejected")))
      .returning({ id: businesses.id });
    // Resolved by the admin a moment before: no longer a resubmission.
    return resubmitted.length > 0 ? "resubmitted" : "duplicate";
  }
  throw new Error("registration: the business could not be saved after several attempts");
}
