// The detail of a pending edit in the panel, `/admin/ediciones/<id>`
// (docs/specs/admin-review.md, "The pending edit detail compares what is
// published with what is proposed", "A pending edit is resolved only once and
// only if it is still the latest" and "The detail of a pending edit shows the
// photo it proposes (v2)"): the card as it is now beside what its owner sent,
// field by field, and what the edit asks of the photo.
//
// The comparison is made when the admin looks, against the card as it is
// now: an edit stores the whole content it would publish, not a difference.
// Each field is compared as the admin reads it, so "Cambió" marks exactly
// the fields whose text differs.
//
// It reads any edit, in any status: the queue leads only to a pending one,
// and the page checks the card's locality before showing anything. Never the
// card's management link or any other internal data of the card.
//
// Binding: HYPERDRIVE_FRESH, as all of the panel. Nothing here is logged.
import { eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { ZoneNames } from "../catalogue/zone-names.ts";
import type { Db } from "../db/client.ts";
import {
  businesses,
  categories,
  localities,
  municipalities,
  type PendingEditPhotoChange,
  type PendingEditStatus,
  pendingEdits,
  zones,
} from "../db/schema/index.ts";
import { zoneText } from "./localities.ts";
import { FIELD_LABELS, NOT_CAPTURED, yesNo } from "./texts.ts";

/** The fields an owner edits, as a card or an edit holds them. */
export interface EditableCard {
  name: string;
  categoryName: string;
  whatsapp: string;
  zoneSlug: string | null;
  zoneName: string | null;
  zoneOther: string | null;
  /** Null on a card, or an edit, saved before the form asked for it. */
  postalCode: string | null;
  whatYouOffer: string | null;
  homeDelivery: boolean;
  landline: string | null;
  address: string | null;
  openingHours: string | null;
  facebookUrl: string | null;
}

export interface EditDetail {
  id: number;
  businessId: string;
  localityCode: string;
  localityName: string;
  timeZone: string;
  status: PendingEditStatus;
  createdAt: Date;
  /** The card as it is published now. */
  published: EditableCard;
  /** What the owner wants it to say. */
  proposed: EditableCard;
  /** The card's own photo key, uninterpreted. */
  publishedPhotoKey: string | null;
  /** What the edit asks of the photo. */
  photoChange: PendingEditPhotoChange;
  /** The key of the new photo of a `replace`, while the edit still names it. */
  newPhotoKey: string | null;
}

/** An edit's number in its address: a positive whole number, or null. */
export function parseEditId(value: string | undefined): number | null {
  if (value === undefined || !/^[1-9][0-9]{0,15}$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}

const cardZones = alias(zones, "card_zones");
const cardCategories = alias(categories, "card_categories");

/** The pending edit `id`, with its card, or null when there is none. */
export async function editDetail(db: Db, id: number): Promise<EditDetail | null> {
  const [row] = await db
    .select({
      id: pendingEdits.id,
      businessId: pendingEdits.businessId,
      localityCode: pendingEdits.localityCode,
      localityName: municipalities.name,
      timeZone: localities.timeZone,
      status: pendingEdits.status,
      createdAt: pendingEdits.createdAt,
      photoChange: pendingEdits.photoChange,
      newPhotoKey: pendingEdits.newPhotoKey,
      publishedPhotoKey: businesses.photoKey,
      published: {
        name: businesses.name,
        categoryName: cardCategories.name,
        whatsapp: businesses.whatsapp,
        zoneSlug: cardZones.slug,
        zoneName: cardZones.name,
        zoneOther: businesses.zoneOther,
        postalCode: businesses.postalCode,
        whatYouOffer: businesses.whatYouOffer,
        homeDelivery: businesses.homeDelivery,
        landline: businesses.landline,
        address: businesses.address,
        openingHours: businesses.openingHours,
        facebookUrl: businesses.facebookUrl,
      },
      proposed: {
        name: pendingEdits.name,
        categoryName: categories.name,
        whatsapp: pendingEdits.whatsapp,
        zoneSlug: zones.slug,
        zoneName: zones.name,
        zoneOther: pendingEdits.zoneOther,
        postalCode: pendingEdits.postalCode,
        whatYouOffer: pendingEdits.whatYouOffer,
        homeDelivery: pendingEdits.homeDelivery,
        landline: pendingEdits.landline,
        address: pendingEdits.address,
        openingHours: pendingEdits.openingHours,
        facebookUrl: pendingEdits.facebookUrl,
      },
    })
    .from(pendingEdits)
    .innerJoin(businesses, eq(businesses.id, pendingEdits.businessId))
    .innerJoin(localities, eq(localities.code, pendingEdits.localityCode))
    .innerJoin(municipalities, eq(municipalities.code, pendingEdits.localityCode))
    .innerJoin(categories, eq(categories.id, pendingEdits.categoryId))
    .innerJoin(cardCategories, eq(cardCategories.id, businesses.categoryId))
    .leftJoin(zones, eq(zones.id, pendingEdits.zoneId))
    .leftJoin(cardZones, eq(cardZones.id, businesses.zoneId))
    .where(eq(pendingEdits.id, id));
  return row ?? null;
}

/** One field of the comparison. */
export interface ComparedField {
  key: keyof EditableCard | "zone";
  label: string;
  published: string;
  proposed: string;
  /** The text the admin reads differs. */
  changed: boolean;
}

/** An optional field as the admin reads it. */
function optional(text: string | null): string {
  const trimmed = text?.trim() ?? "";
  return trimmed === "" ? NOT_CAPTURED : trimmed;
}

/** The fields of the form, in its order, published against proposed (the photo apart). */
export function comparedFields(
  detail: Pick<EditDetail, "published" | "proposed">,
  names: ZoneNames | undefined,
): ComparedField[] {
  const fields: [ComparedField["key"], string, (card: EditableCard) => string][] = [
    ["name", FIELD_LABELS.name, (card) => card.name.trim()],
    ["categoryName", FIELD_LABELS.category, (card) => card.categoryName],
    ["whatsapp", FIELD_LABELS.whatsapp, (card) => card.whatsapp],
    ["postalCode", FIELD_LABELS.postalCode, (card) => optional(card.postalCode)],
    ["zone", FIELD_LABELS.zone, (card) => zoneText(card, names) ?? NOT_CAPTURED],
    ["whatYouOffer", FIELD_LABELS.whatYouOffer, (card) => optional(card.whatYouOffer)],
    ["homeDelivery", FIELD_LABELS.homeDelivery, (card) => yesNo(card.homeDelivery)],
    ["landline", FIELD_LABELS.landline, (card) => optional(card.landline)],
    ["address", FIELD_LABELS.address, (card) => optional(card.address)],
    ["openingHours", FIELD_LABELS.openingHours, (card) => optional(card.openingHours)],
    ["facebookUrl", FIELD_LABELS.facebookUrl, (card) => optional(card.facebookUrl)],
  ];
  return fields.map(([key, label, read]) => {
    const published = read(detail.published);
    const proposed = read(detail.proposed);
    return { key, label, published, proposed, changed: published !== proposed };
  });
}

/** Whether the edit proposes another WhatsApp, which must be confirmed with the new number. */
export function changesWhatsapp(detail: Pick<EditDetail, "published" | "proposed">): boolean {
  return detail.published.whatsapp !== detail.proposed.whatsapp;
}
