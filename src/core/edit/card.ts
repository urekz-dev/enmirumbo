// What the edit form of a card is built from (docs/specs/business-registration.md,
// "The management link opens the card in edit mode with the same prefilled
// form" and "Sending changes when others are already waiting replaces the
// previous ones"): the card's editable fields as they are published, the edit
// it has waiting for review, if any, and the catalogue its submissions are
// checked against. The page reads it to render the form, and the action to
// validate a submission, so both see the same catalogue.
//
// Only the fields of the form are read: never the status, the origin, the
// trades, the dates, the consent record, the link fingerprint or the photo
// key, so nothing the form does not show can leave in its page.
//
// Binding: HYPERDRIVE_FRESH. The edit mode is a verification flow and
// follows writes: the owner's own last edit must be there when they come back.
import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { businesses, pendingEdits } from "../db/schema/index.ts";
import type { ServedLocality } from "../locality/served.ts";
import { type RegistrationCatalogue, registrationCatalogue } from "../registration/catalogue.ts";
import type { EditableFields, WaitingEditFields } from "./submission.ts";

/** The columns of the form, in a business or a pending edit. */
function formColumns(table: typeof businesses | typeof pendingEdits) {
  return {
    name: table.name,
    categoryId: table.categoryId,
    whatsapp: table.whatsapp,
    postalCode: table.postalCode,
    zoneId: table.zoneId,
    zoneOther: table.zoneOther,
    whatYouOffer: table.whatYouOffer,
    homeDelivery: table.homeDelivery,
    landline: table.landline,
    address: table.address,
    openingHours: table.openingHours,
    facebookUrl: table.facebookUrl,
  };
}

export interface EditForm {
  /** The card's editable fields, as they are published. */
  card: EditableFields;
  /** The edit the card has waiting for review, or null. */
  waiting: WaitingEditFields | null;
  /**
   * The categories and the visible zones of the locality, and the zones the
   * card and its waiting edit name even when hidden since: a field left as it
   * was keeps its zone.
   */
  catalogue: RegistrationCatalogue;
}

/**
 * The edit form of the card `businessId` of `locality`, or null when it is
 * not there any more. It is called only with a card a link just opened
 * (src/core/management-link/link.ts).
 */
export async function editForm(
  db: Db,
  locality: Pick<ServedLocality, "code" | "name">,
  businessId: string,
): Promise<EditForm | null> {
  const [card] = await db
    .select(formColumns(businesses))
    .from(businesses)
    .where(and(eq(businesses.id, businessId), eq(businesses.localityCode, locality.code)));
  if (card === undefined) return null;
  const [waiting] = await db
    .select({ ...formColumns(pendingEdits), photoChange: pendingEdits.photoChange })
    .from(pendingEdits)
    .where(and(eq(pendingEdits.businessId, businessId), eq(pendingEdits.status, "pending")));
  const catalogue = await registrationCatalogue(db, locality, [
    card.zoneId,
    waiting?.zoneId ?? null,
  ]);
  return { card, waiting: waiting ?? null, catalogue };
}
