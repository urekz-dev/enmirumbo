// What the legal pages still lack before launch (docs/specs/legal-pages.md,
// "Visible placeholders and a draft mark while the responsible party's data is
// missing"), declared once so that the launch checklist and the tests can list
// it instead of looking for it by eye.
//
// Every datum that only a person can provide is a visible placeholder in
// square brackets, never an invented value. While one is left, both pages show
// the draft mark. Filling a placeholder of the notice, or removing the draft
// mark, changes the published notice and so releases a new notice version
// (src/core/legal/version.ts); the terms are not versioned.

export const RESPONSIBLE_NAME =
  "[NOMBRE O RAZÓN SOCIAL DEL RESPONSABLE — completar antes del lanzamiento]";
export const RESPONSIBLE_ADDRESS = "[DOMICILIO DEL RESPONSABLE — completar antes del lanzamiento]";
export const DIRECTORY_WHATSAPP = "[WHATSAPP DEL DIRECTORIO — completar antes del lanzamiento]";
export const PUBLICATION_DATE = "[FECHA DE PUBLICACIÓN]";
export const JURISDICTION = "[JURISDICCIÓN PARA CONTROVERSIAS — confirmar en la revisión legal]";

/** The placeholders still published. Empty once a person fills them all in. */
export const PENDING_PLACEHOLDERS: readonly string[] = [
  RESPONSIBLE_NAME,
  RESPONSIBLE_ADDRESS,
  DIRECTORY_WHATSAPP,
  PUBLICATION_DATE,
  JURISDICTION,
];

/**
 * The contact for data matters and for ARCO rights (PRD §7). It is no longer
 * a placeholder: the mailbox must exist and receive mail before the text is
 * published.
 */
export const DIRECTORY_EMAIL = "contacto@enmirumbo.com";

export const DRAFT_MARK =
  "Ojo: este texto todavía es un borrador. Nos faltan los datos que ves entre corchetes y la revisión legal antes de que el directorio se lance.";

/** The draft mark both pages show, or null once no placeholder is left. */
export const PUBLISHED_DRAFT_MARK: string | null =
  PENDING_PLACEHOLDERS.length > 0 ? DRAFT_MARK : null;

/**
 * Something the legal review and the launch checklist must see before the
 * draft mark goes: a commitment of the published text that the system does
 * not yet keep on its own, one it keeps short on purpose, or a processing of
 * personal data the text does not mention. Never published on the pages.
 */
export interface OperationalPendingItem {
  /** What the published text says, or what the system does that it does not mention. */
  commitment: string;
  /** What the system does today. */
  today: string;
  /** The Plane work items that resolve it. */
  tickets: string;
}

/**
 * The operational pending items (docs/specs/legal-pages.md, "The list of
 * operational pending items reflects v2 (v2)"). A row leaves when it stops
 * being true and enters as soon as it is. The prototype's rows on the unnamed
 * processors and on the stored attempts to enter the panel left: the notice
 * names the processors, and the panel has no login of its own.
 */
export const OPERATIONAL_PENDING_ITEMS: readonly OperationalPendingItem[] = [
  {
    commitment:
      'The notice says the four ARCO rights are served from the admin panel: the admin sends the business a copy of its data by WhatsApp, corrects its card, unpublishes it or deletes it ("Los atiende quien administra el directorio desde su panel").',
    today:
      "The panel has none of those actions yet: unpublishing and deleting arrive with F3, and editing any card and sending a copy of its data with F6. Until then a request of access, rectification, cancellation or opposition is served by hand against the database.",
    tickets: "EMR-48 (F3) and EMR-51 (F6, access and rectification from the panel)",
  },
  {
    commitment:
      'The notice says the IP address is used for less than an hour, only in memory, as a code made with a secret key, and never written to the database ("ese código vive solo en su memoria y por menos de una hora").',
    today:
      "The quotas of the search (EMR-36, 10 minutes) and of the reports (EMR-37, an hour) turn the IP address into an HMAC with a key the single quota Durable Object generates in its memory, keep the counter in that memory only, never in its storage, the database or a log, and delete it when its window ends (ADR 0012, EMR-71). The quotas of the forms arrive in the same object and must keep their counters the same way, in windows of an hour at most, for the sentence to stay true. A counter in memory is lost when the object restarts, so a quota can only count less than it should. The wording waits for the legal review.",
    tickets: "EMR-58 (H1, legal review of the wording), then EMR-42 (E4)",
  },
  {
    commitment:
      'The notice says a deletion is permanent ("eliminamos tu registro de forma definitiva, no solo lo escondemos") and gives the retention periods.',
    today:
      "The nightly backup of production (backup.yml) keeps a full copy of the database for 30 days in the private R2 bucket enmirumbo-backups, under a bucket lock that prevents deleting it earlier, so a card deleted or purged today survives in the backups of the 30 days before. The notice does not mention the backups.",
    tickets: "EMR-58 (H1, the legal review decides whether the notice needs a line)",
  },
];
