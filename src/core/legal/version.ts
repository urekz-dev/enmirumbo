// The version of the privacy notice (docs/specs/legal-pages.md, "The privacy
// notice has a stable version declared in a single place" and "Changing the
// notice text without bumping the version breaks the verification").
//
// This module is the single source of the version: the notice page, the
// consent block of the registration form, the server that stores the consent
// record and the fictitious seed read it from here, with no copies. It also
// says which content the version identifies, which the guard in
// test/scripts/notice-version.test.ts fingerprints. The fingerprint table
// lives next to that guard, not here, so that fixing the text and "fixing"
// its fingerprint are never the same absent-minded edit.
//
// Pure TypeScript with no Astro import (ADR 0019): Node scripts import it.
import { lastUpdatedLine, type LegalBlock, type LegalDocument } from "./document.ts";
import { PUBLISHED_DRAFT_MARK } from "./placeholders.ts";
import { CONSENT_CHECKBOX, PRIVACY_NOTICE, SIMPLIFIED_NOTICE_TEMPLATE } from "./privacy-notice.ts";

/**
 * The current version of the privacy notice: a whole number written as a
 * string, which only moves forward. A version already published is never
 * reused for another text. Raising it means anchoring its fingerprint in
 * test/scripts/notice-version.test.ts.
 *
 * `2` is the text of the rebuild (PRD §7): the processors by name, the IP
 * address, the two cookies, the Turnstile addendum, the retention periods,
 * the rights served from the panel and no locality named.
 */
export const NOTICE_VERSION = "2";

/** A version as a number, or null when it is none (missing, or not a whole number). */
function versionNumber(version: string | null): number | null {
  return version !== null && /^[0-9]+$/.test(version) ? Number(version) : null;
}

/**
 * Whether `current` is later than `earlier` (docs/specs/business-registration.md,
 * "One card per WhatsApp number": when a resubmission records a
 * re-acceptance). An ordering, not an inequality: an earlier version (a
 * rolled-back deployment) is not later, and a consent record without a
 * version, from before versioning, is comparable with none.
 */
export function isLaterNoticeVersion(current: string, earlier: string | null): boolean {
  const now = versionNumber(current);
  const before = versionNumber(earlier);
  return now !== null && before !== null && now > before;
}

/** What the notice page prepends to its last-update line. */
export function versionPrefix(version: string): string {
  return `Versión ${version} · `;
}

/**
 * The three inseparable pieces the version identifies, plus the draft mark the
 * page shows while placeholders are left: it is published content, and it
 * warns that the text has not passed the legal review.
 */
export interface NoticePieces {
  /** The simplified notice of the form, with the municipality as a mark. */
  simplifiedNotice: string;
  /** The literal of the consent checkbox. */
  consentCheckbox: string;
  /** The full notice at /aviso-de-privacidad. */
  fullNotice: LegalDocument;
  /** The draft mark the page publishes, or null. */
  draftMark: string | null;
}

export const CURRENT_NOTICE_PIECES: NoticePieces = {
  simplifiedNotice: SIMPLIFIED_NOTICE_TEMPLATE,
  consentCheckbox: CONSENT_CHECKBOX,
  fullNotice: PRIVACY_NOTICE,
  draftMark: PUBLISHED_DRAFT_MARK,
};

/** Whitespace collapses in HTML, so it never changes what a person reads. */
function normalized(text: string): string {
  return text.normalize("NFC").replace(/\s+/gu, " ").trim();
}

function blockContent(block: LegalBlock): string[] {
  switch (block.kind) {
    case "paragraph":
      return [`p ${block.text}`];
    case "list":
      return ["ul", ...block.items.map((item) => `li ${item}`)];
    case "link":
      return [`a ${block.href} ${block.text}`];
  }
}

/**
 * Everything the version identifies, in reading order, one entry per piece,
 * each tagged with its role (heading, paragraph, list item, link with its
 * destination). It is the published content as data, not the source file or
 * the HTML: reformatting the code, or changing the markup or the styles, does
 * not change it, while any change to what a person reads does. The version
 * line itself is left out, or raising the version would change the
 * fingerprint and the guard would prove nothing about the text.
 */
export function versionedNoticeContent(pieces: NoticePieces = CURRENT_NOTICE_PIECES): string[] {
  const { fullNotice } = pieces;
  const content = [
    `simplified ${pieces.simplifiedNotice}`,
    `checkbox ${pieces.consentCheckbox}`,
    `h1 ${fullNotice.title}`,
  ];
  // Where the page shows it: between the h1 and the last-update line.
  if (pieces.draftMark !== null) content.push(`draft ${pieces.draftMark}`);
  content.push(`updated ${lastUpdatedLine(fullNotice)}`, `intro ${fullNotice.introduction}`);
  for (const section of fullNotice.sections) {
    content.push(`h2 ${section.heading}`, ...section.blocks.flatMap(blockContent));
  }
  if (fullNotice.closingLink) {
    content.push(`a ${fullNotice.closingLink.href} ${fullNotice.closingLink.text}`);
  }
  return content.map(normalized);
}
