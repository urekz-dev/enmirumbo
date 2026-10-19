// The verification button of the panel (docs/specs/admin-review.md,
// "Verification button that opens WhatsApp with a prefilled message", "No
// panel message is presented with the previous brand" and "The pending edit
// detail compares what is published with what is proposed"): it opens the
// conversation with the number to verify, the message already written, and
// the admin sends it; the system never sends anything by itself.
//
// It is the first contact with the business, so the directory introduces
// itself with its descriptor, "enmirumbo, el directorio de negocios de …",
// the locality read from the card's record, never written here; the brand is
// never followed by the locality's name. Pure.
import { panelWhatsappLink } from "./notices.ts";

/** The message of the first contact, with the card's name and its locality. */
export function verificationMessage(businessName: string, localityName: string): string {
  return (
    `Hola, te escribo de enmirumbo, el directorio de negocios de ${localityName}. ` +
    `Recibimos el registro de «${businessName}». ` +
    "¿Nos confirmas que el negocio es tuyo y que este es tu WhatsApp?"
  );
}

/**
 * The conversation with `whatsapp` with the verification message written, or
 * null when the number is not ten national digits: the panel then shows it
 * as stored, without a broken link.
 */
export function verificationLink(
  whatsapp: string,
  businessName: string,
  localityName: string,
): string | null {
  return panelWhatsappLink(whatsapp, verificationMessage(businessName, localityName));
}
