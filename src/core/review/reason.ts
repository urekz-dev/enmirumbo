// The reason the admin writes for a decision that travels to the business in
// a WhatsApp (docs/specs/admin-review.md, "Rejecting requires a reason,
// stores it with its date and offers to notify by WhatsApp" and "A rejection
// reason is never silently trimmed (v2)"; the unpublishing and the discard
// of a pending edit read theirs the same way when they arrive). It is
// required and at most REASON_MAX_LENGTH characters, counted as a person sees
// them written (graphemes, so an emoji or an accented letter is one), and it
// is never trimmed to fit: what is stored is what goes to the business,
// whole. Only the spaces around it are dropped, line breaks are read as the
// browser shows them, and a NUL, which no person types and PostgreSQL cannot
// store, is dropped. Pure.
import { formText } from "../forms/text.ts";

/** The longest reason, in characters. */
export const REASON_MAX_LENGTH = 500;

const GRAPHEMES = new Intl.Segmenter("es-MX", { granularity: "grapheme" });

/** How many characters `text` has, as a person sees them. */
export function characterCount(text: string): number {
  let count = 0;
  for (const _ of GRAPHEMES.segment(text)) count += 1;
  return count;
}

/** Why a reason is refused: nothing was written, or more than the limit. */
export type ReasonError = "required" | "too-long";

export type ReasonReading =
  | { kind: "valid"; reason: string }
  | { kind: "invalid"; error: ReasonError };

/** The reason of the field `name` of `form`, or why it is refused. */
export function readReason(form: FormData, name: string): ReasonReading {
  const reason = formText(form, name).trim();
  if (reason === "") return { kind: "invalid", error: "required" };
  if (characterCount(reason) > REASON_MAX_LENGTH) return { kind: "invalid", error: "too-long" };
  return { kind: "valid", reason };
}
