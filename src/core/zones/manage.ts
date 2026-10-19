// The zones of a locality in the panel (docs/specs/admin-review.md, "The
// admin can hide and rename the zones of a locality (v2)" and "The admin can
// add a zone to a locality (v2)"): what the zones screen lists, and its three
// writes. Hiding and showing change only whether the registration and the
// edit offer the zone; renaming changes only its name, never its slug; adding
// creates a visible zone whose slug comes from its name and never changes.
// None of them touches a card, and none writes to the audit log, which
// records only what is done to a card (data-model, "The audit log records the
// destructive actions of the admin (v2)").
//
// Binding: the panel reads and writes through HYPERDRIVE_FRESH. The public
// pages read zones through the cached HYPERDRIVE, so a change may take up to
// a minute to show there, and the panel says so.
//
// Who may do it is the caller's to check (`can`, `zones.manage` in the
// locality): this module only reads and writes.
import { and, asc, eq } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { categories, localities, municipalities, trades, zones } from "../db/schema/index.ts";
import { zoneDisplayNames } from "../catalogue/zone-names.ts";
import { checkNewZone, checkRename, type ZoneFormErrors, type ZoneRow } from "./rules.ts";

/** A zone as the screen lists it. */
export interface PanelZone extends ZoneRow {
  visible: boolean;
  /** The name the public pages show it with, unique in its locality. */
  displayName: string;
}

const collator = new Intl.Collator("es-MX", { sensitivity: "base", numeric: true });

/** A transaction of `Db`, which reads and writes the same way. */
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Every zone of `localityCode`, hidden ones included. */
function localityZones(db: Db | Tx, localityCode: string) {
  return db
    .select({
      id: zones.id,
      slug: zones.slug,
      name: zones.name,
      type: zones.type,
      visible: zones.visible,
    })
    .from(zones)
    .where(eq(zones.localityCode, localityCode));
}

/** The settlement types the zones use, in alphabetical order: those a new zone may take. */
export function zoneTypes(rows: readonly { type: string }[]): string[] {
  return [...new Set(rows.map(({ type }) => type))].toSorted(collator.compare);
}

/** What the zones screen shows of a locality. */
export interface LocalityZones {
  /** Every zone, hidden ones included, by display name. */
  zones: PanelZone[];
  /** The settlement types a new zone may take. */
  types: string[];
}

/** The zones of the locality `localityCode`, named `localityName`, for the screen. */
export async function panelZones(
  db: Db,
  localityCode: string,
  localityName: string,
): Promise<LocalityZones> {
  const rows = await localityZones(db, localityCode);
  const names = zoneDisplayNames(rows, localityName);
  return {
    zones: rows
      .map((row) => ({ ...row, displayName: names.get(row.slug) ?? row.name }))
      .toSorted((a, b) => collator.compare(a.displayName, b.displayName) || a.id - b.id),
    types: zoneTypes(rows),
  };
}

/** What a write of the zones screen did. */
export type ZoneWriteOutcome =
  /** Saved: the zone it changed or created. */
  | { kind: "done"; zoneId: number }
  /** No such zone in the locality, or no such locality. */
  | { kind: "not-found" }
  /** Nothing saved: the errors of the form. */
  | { kind: "invalid"; errors: ZoneFormErrors };

const NOT_FOUND: ZoneWriteOutcome = { kind: "not-found" };

/** Hides (`visible` false) or shows the zone `zoneId` of `localityCode`. */
export async function setZoneVisibility(
  db: Db,
  localityCode: string,
  zoneId: number,
  visible: boolean,
): Promise<ZoneWriteOutcome> {
  const [row] = await db
    .update(zones)
    .set({ visible })
    .where(and(eq(zones.id, zoneId), eq(zones.localityCode, localityCode)))
    .returning({ id: zones.id });
  return row === undefined ? NOT_FOUND : { kind: "done", zoneId: row.id };
}

/**
 * The name of `localityCode`, locking its row against another write of its
 * zones until the transaction ends, so two admins cannot each pass the checks
 * with a change the other one makes unsafe. Registrations, which only
 * reference the locality, are not held up. Null when there is no locality.
 */
async function lockLocality(tx: Tx, localityCode: string): Promise<string | null> {
  const [locked] = await tx
    .select({ code: localities.code })
    .from(localities)
    .where(eq(localities.code, localityCode))
    .for("no key update");
  if (locked === undefined) return null;
  const [municipality] = await tx
    .select({ name: municipalities.name })
    .from(municipalities)
    .where(eq(municipalities.code, localityCode));
  return municipality?.name ?? null;
}

/**
 * Renames the zone `zoneId` of `localityCode` to `name`, already clean
 * (cleanZoneName). Its slug, and so every URL of it, stays as it was.
 */
export function renameZone(
  db: Db,
  localityCode: string,
  zoneId: number,
  name: string,
): Promise<ZoneWriteOutcome> {
  return db.transaction(async (tx) => {
    const localityName = await lockLocality(tx, localityCode);
    if (localityName === null) return NOT_FOUND;
    const rows = await localityZones(tx, localityCode);
    const zone = rows.find((row) => row.id === zoneId);
    if (zone === undefined) return NOT_FOUND;
    const problem = checkRename(zone, name, rows, localityName);
    if (problem !== null) return { kind: "invalid", errors: { name: problem } };
    if (name !== zone.name) await tx.update(zones).set({ name }).where(eq(zones.id, zone.id));
    return { kind: "done", zoneId: zone.id };
  });
}

/**
 * Adds a visible zone to `localityCode`, named `name` (already clean) with
 * the settlement type `type`, after every check of src/core/zones/rules.ts
 * against the catalogues as they are.
 */
export function addZone(
  db: Db,
  localityCode: string,
  name: string,
  type: string,
): Promise<ZoneWriteOutcome> {
  return db.transaction(async (tx) => {
    const localityName = await lockLocality(tx, localityCode);
    if (localityName === null) return NOT_FOUND;
    const [rows, categoryRows, tradeRows] = await Promise.all([
      localityZones(tx, localityCode),
      tx
        .select({ name: categories.name, slug: categories.slug })
        .from(categories)
        .orderBy(asc(categories.id)),
      tx.select({ name: trades.name, slug: trades.slug }).from(trades).orderBy(asc(trades.id)),
    ]);
    const check = checkNewZone(name, type, {
      zones: rows,
      localityName,
      categories: categoryRows,
      trades: tradeRows,
      types: zoneTypes(rows),
    });
    if (!check.ok) return { kind: "invalid", errors: check.errors };
    const [created] = await tx
      .insert(zones)
      .values({ localityCode, ...check.zone })
      .returning({ id: zones.id });
    return created === undefined ? NOT_FOUND : { kind: "done", zoneId: created.id };
  });
}
