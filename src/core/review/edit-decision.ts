// The pending edit an action of the panel resolves (ADR 0021;
// docs/specs/admin-review.md, "Each review screen checks its permission in
// the locality of what it shows (v2)" and "Attending a report and resolving
// a pending edit are forms of their details, and their action checks
// everything again (v2)"). Applying and discarding find their edit by the
// number of their page's address, never by a field, and check `edits.review`
// again in the locality of its card, the way the detail of the edit does
// (src/pages/admin/ediciones/[id].astro):
//
// - a user who resolves edits in no locality, or is not a panel user:
//   forbidden, the panel's 403, before any edit is read;
// - an address that is no edit number, an edit that does not exist, and an
//   edit of a locality where the user may not resolve edits: not found, the
//   same 404, so the panel never tells a user that an edit exists.
//
// Binding: HYPERDRIVE_FRESH, as all of the panel. Nothing here is logged.
import { eq } from "drizzle-orm";
import { permittedLocalities } from "../access/queries.ts";
import type { Db } from "../db/client.ts";
import {
  type BusinessStatus,
  businesses,
  type PendingEditStatus,
  pendingEdits,
} from "../db/schema/index.ts";
import { parseEditId } from "./edit.ts";

/** Who resolves, and which edit: the Access email and the number of the page's address. */
export interface EditTarget {
  email: string;
  /** The `<n>` of `/admin/ediciones/<n>`, as the address wrote it. */
  editId: string;
}

/** What an action needs to know of its edit before resolving it. */
export interface EditToResolve {
  id: number;
  businessId: string;
  localityCode: string;
  status: PendingEditStatus;
  /** The catalogue zone the edit proposes; null while it proposes the free text of "Otra". */
  zoneId: number | null;
  /** The free text of "Otra" the owner wrote, when the edit proposes one. */
  zoneOther: string | null;
  /** The status of its card now. */
  cardStatus: BusinessStatus;
}

export type EditAccess =
  | { kind: "edit"; edit: EditToResolve }
  | { kind: "not-found" }
  | { kind: "forbidden" };

const NOT_FOUND: EditAccess = { kind: "not-found" };
const FORBIDDEN: EditAccess = { kind: "forbidden" };

/** The edit of `target`, if its user may resolve it. */
export async function editToResolve(db: Db, target: EditTarget): Promise<EditAccess> {
  const granted = (await permittedLocalities(db, target.email, ["edits.review"])).get(
    "edits.review",
  );
  if (granted === undefined || granted.size === 0) return FORBIDDEN;
  const id = parseEditId(target.editId);
  if (id === null) return NOT_FOUND;
  const [edit] = await db
    .select({
      id: pendingEdits.id,
      businessId: pendingEdits.businessId,
      localityCode: pendingEdits.localityCode,
      status: pendingEdits.status,
      zoneId: pendingEdits.zoneId,
      zoneOther: pendingEdits.zoneOther,
      cardStatus: businesses.status,
    })
    .from(pendingEdits)
    .innerJoin(businesses, eq(businesses.id, pendingEdits.businessId))
    .where(eq(pendingEdits.id, id));
  if (edit === undefined || !granted.has(edit.localityCode)) return NOT_FOUND;
  return { kind: "edit", edit };
}

/** What an edit that is no longer pending says: superseded by a newer one, or already resolved. */
export function noLongerPending(status: PendingEditStatus): "superseded" | "resolved" {
  return status === "superseded" ? "superseded" : "resolved";
}
