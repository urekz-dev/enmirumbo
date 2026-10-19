// The ARCO data copy is an explicit allowlist: no lifecycle, reports, reasons,
// photo address or management-link material leaves in the WhatsApp message.
import { asc, eq } from "drizzle-orm";
import { can } from "../access/queries.ts";
import type { Db } from "../db/client.ts";
import { businessTrades, trades } from "../db/schema/index.ts";
import { isPhotoKey } from "../photos/photo.ts";
import { panelWhatsappLink } from "./notices.ts";
import type { RegistrationDetail } from "./registration.ts";
import { panelDateTime } from "./time.ts";

export type CopyFields = Pick<
  RegistrationDetail,
  | "name"
  | "categoryName"
  | "localityName"
  | "whatsapp"
  | "landline"
  | "postalCode"
  | "address"
  | "openingHours"
  | "whatYouOffer"
  | "facebookUrl"
  | "homeDelivery"
  | "photoKey"
  | "timeZone"
  | "consentedToNoticeAt"
  | "consentedToNoticeVersion"
  | "reconsentedToNoticeAt"
  | "reconsentedToNoticeVersion"
>;

export function dataCopyMessage(
  card: CopyFields,
  zone: string | null,
  tradeNames: readonly string[],
): string {
  const captured = (text: string | null) => text ?? "No capturado";
  const accepted = (at: Date, version: string | null) =>
    `${panelDateTime(at, card.timeZone)}; versión ${version ?? "no registrada"}`;
  return [
    "Hola, esta es la copia de los datos de tu ficha que guardamos en enmirumbo:",
    `Nombre: ${card.name}`,
    `Categoría: ${card.categoryName}`,
    `Municipio: ${card.localityName}`,
    `WhatsApp: ${card.whatsapp}`,
    `Teléfono fijo: ${captured(card.landline)}`,
    `Colonia: ${captured(zone)}`,
    `Código postal: ${captured(card.postalCode)}`,
    `Dirección o referencias: ${captured(card.address)}`,
    `Horario: ${captured(card.openingHours)}`,
    `¿Qué ofreces?: ${captured(card.whatYouOffer)}`,
    `Link de Facebook: ${captured(card.facebookUrl)}`,
    `Entregas o servicio a domicilio: ${card.homeDelivery ? "Sí" : "No"}`,
    ...(tradeNames.length === 0 ? [] : [`Giros: ${tradeNames.join(", ")}`]),
    `Aviso de privacidad aceptado: ${accepted(card.consentedToNoticeAt, card.consentedToNoticeVersion)}`,
    ...(card.reconsentedToNoticeAt === null
      ? []
      : [
          `Aviso de privacidad aceptado de nuevo: ${accepted(card.reconsentedToNoticeAt, card.reconsentedToNoticeVersion)}`,
        ]),
    `Foto guardada: ${isPhotoKey(card.photoKey) ? "Sí" : "No"}`,
  ].join("\n");
}

/** Checked in the card's locality before reading its trades or building the copy. */
export async function dataCopyLink(
  db: Db,
  email: string,
  card: RegistrationDetail,
  zone: string | null,
): Promise<string | null> {
  if (!(await can(db, email, "businesses.edit", card.localityCode))) return null;
  const rows = await db
    .select({ name: trades.name })
    .from(businessTrades)
    .innerJoin(trades, eq(trades.id, businessTrades.tradeId))
    .where(eq(businessTrades.businessId, card.id))
    .orderBy(asc(trades.name), asc(trades.id));
  return panelWhatsappLink(
    card.whatsapp,
    dataCopyMessage(
      card,
      zone,
      rows.map(({ name }) => name),
    ),
  );
}
