// The WhatsApp notices of the panel (docs/specs/admin-review.md, "On
// approving, an offer is made to notify the business by WhatsApp with its
// card link and its management link", "Rejecting requires a reason, stores
// it with its date and offers to notify by WhatsApp" and "No panel message
// is presented with the previous brand"): each opens the conversation with
// the business, the message already written; the admin sends it, and the
// system never sends anything by itself (PRD §6.6). The messages are the
// specification's literals. They reach someone the verification message
// already introduced the directory to, so they say plain "enmirumbo", never
// followed by the locality's name. Pure.
import { nationalNumber } from "../business/contact.ts";

/**
 * The conversation with `whatsapp`, with `message` written, or null when the
 * number is not ten national digits: the panel then shows it as stored,
 * without a broken link.
 */
export function panelWhatsappLink(whatsapp: string, message: string): string | null {
  const digits = nationalNumber(whatsapp);
  if (digits === null) return null;
  return `https://wa.me/52${digits}?text=${encodeURIComponent(message)}`;
}

/**
 * The notice of a publication: the card's public link and its management
 * link, both absolute, with the instruction of PRD §6.4. The only message of
 * the panel that carries a management link, on the only screen that shows
 * one.
 */
export function publishedMessage(businessName: string, cardUrl: string, editUrl: string): string {
  return (
    `¡Listo! Ya quedó publicado «${businessName}» en enmirumbo. ` +
    `Esta es tu ficha: ${cardUrl} — compártela con tus clientes. ` +
    `Y este es tu enlace para editarla: ${editUrl} — guarda este mensaje ` +
    "(puedes destacarlo con la estrella), con ese enlace actualizas tus datos cuando quieras."
  );
}

/** The notice of a rejection, with the reason the admin wrote, whole. */
export function rejectedMessage(businessName: string, reason: string): string {
  return (
    `Hola, revisamos el registro de «${businessName}» en enmirumbo y por ahora no lo pudimos ` +
    `publicar: ${reason}. Si lo corriges, lo puedes volver a enviar desde el mismo formulario ` +
    "con este mismo número."
  );
}
