// The detail of a card in the panel, `/admin/registros/<id>`
// (docs/specs/admin-review.md, "Registration detail with all the captured
// data, only inside the panel", "The business detail lists its unattended
// reports" and "Approving a registration generates its management link,
// unique and unrepeatable"): everything the business captured, its photo
// included, and the internal data the admin decides with: status, origin,
// the dates of its life, the consent record, the trace of its last
// unpublishing and since when it has a management link.
//
// It reads any card, in any status, of any locality: the page has already
// checked who may see it (./scope.ts) and checks the card's locality before
// showing anything. Never the fingerprint of the management link, which the
// panel cannot show (it stores only the fingerprint), and never a pending
// edit: those have their own detail (./edit.ts).
//
// Binding: HYPERDRIVE_FRESH, as all of the panel. Nothing here is logged.
import { and, asc, eq } from "drizzle-orm";
import { isBusinessId } from "../business/id.ts";
import type { ShowsZone } from "../catalogue/zone-names.ts";
import type { Db } from "../db/client.ts";
import {
  type BusinessOrigin,
  type BusinessStatus,
  businesses,
  categories,
  localities,
  municipalities,
  type ReportReason,
  reports,
  zones,
} from "../db/schema/index.ts";

export interface RegistrationDetail extends ShowsZone {
  id: string;
  localityCode: string;
  /** The municipality of its locality, for the verification message. */
  localityName: string;
  timeZone: string;
  name: string;
  categoryName: string;
  /** As stored: ten digits, or what an older write left. */
  whatsapp: string;
  /** The free text of "Otra" while no catalogue zone was chosen; null otherwise. */
  zoneOther: string | null;
  whatYouOffer: string | null;
  homeDelivery: boolean;
  landline: string | null;
  address: string | null;
  openingHours: string | null;
  facebookUrl: string | null;
  /** The stored photo reference, uninterpreted: only src/lib/media.ts turns it into an address. */
  photoKey: string | null;
  status: BusinessStatus;
  origin: BusinessOrigin;
  registeredAt: Date;
  publishedAt: Date | null;
  rejectedAt: Date | null;
  rejectionReason: string | null;
  unpublishedAt: Date | null;
  unpublishReason: string | null;
  consentedToNoticeAt: Date;
  consentedToNoticeVersion: string | null;
  reconsentedToNoticeAt: Date | null;
  reconsentedToNoticeVersion: string | null;
  /** When its current management link was generated; null without one. */
  managementLinkCreatedAt: Date | null;
}

/** A text left blank is a field the business did not capture. */
function captured(text: string | null): string | null {
  const trimmed = text?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

/** The card `id`, or null when no card has it (or `id` cannot be one). */
export async function registrationDetail(db: Db, id: string): Promise<RegistrationDetail | null> {
  if (!isBusinessId(id)) return null;
  const [row] = await db
    .select({
      id: businesses.id,
      localityCode: businesses.localityCode,
      localityName: municipalities.name,
      timeZone: localities.timeZone,
      name: businesses.name,
      categoryName: categories.name,
      whatsapp: businesses.whatsapp,
      zoneSlug: zones.slug,
      zoneName: zones.name,
      zoneOther: businesses.zoneOther,
      whatYouOffer: businesses.whatYouOffer,
      homeDelivery: businesses.homeDelivery,
      landline: businesses.landline,
      address: businesses.address,
      openingHours: businesses.openingHours,
      facebookUrl: businesses.facebookUrl,
      photoKey: businesses.photoKey,
      status: businesses.status,
      origin: businesses.origin,
      registeredAt: businesses.registeredAt,
      publishedAt: businesses.publishedAt,
      rejectedAt: businesses.rejectedAt,
      rejectionReason: businesses.rejectionReason,
      unpublishedAt: businesses.unpublishedAt,
      unpublishReason: businesses.unpublishReason,
      consentedToNoticeAt: businesses.consentedToNoticeAt,
      consentedToNoticeVersion: businesses.consentedToNoticeVersion,
      reconsentedToNoticeAt: businesses.reconsentedToNoticeAt,
      reconsentedToNoticeVersion: businesses.reconsentedToNoticeVersion,
      managementLinkCreatedAt: businesses.managementTokenCreatedAt,
    })
    .from(businesses)
    .innerJoin(localities, eq(localities.code, businesses.localityCode))
    .innerJoin(municipalities, eq(municipalities.code, businesses.localityCode))
    .innerJoin(categories, eq(categories.id, businesses.categoryId))
    .leftJoin(zones, eq(zones.id, businesses.zoneId))
    .where(eq(businesses.id, id));
  if (row === undefined) return null;
  return {
    ...row,
    zoneOther: row.zoneSlug === null ? captured(row.zoneOther) : null,
    whatYouOffer: captured(row.whatYouOffer),
    landline: captured(row.landline),
    address: captured(row.address),
    openingHours: captured(row.openingHours),
    facebookUrl: captured(row.facebookUrl),
  };
}

/** An unattended report, as the detail shows it: never anything about who sent it. */
export interface PendingReport {
  id: number;
  reason: ReportReason;
  /** As the resident wrote it, shown as plain text; null without one. */
  comment: string | null;
  createdAt: Date;
}

/** The pending reports of the card `businessId`, oldest first. */
export async function pendingReports(db: Db, businessId: string): Promise<PendingReport[]> {
  const rows = await db
    .select({
      id: reports.id,
      reason: reports.reason,
      comment: reports.comment,
      createdAt: reports.createdAt,
    })
    .from(reports)
    .where(and(eq(reports.businessId, businessId), eq(reports.status, "pending")))
    .orderBy(asc(reports.createdAt), asc(reports.id));
  return rows.map((row) => ({
    ...row,
    comment: captured(row.comment) === null ? null : row.comment,
  }));
}
