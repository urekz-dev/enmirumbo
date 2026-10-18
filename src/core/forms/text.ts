// How a public form reads its text fields on the server. A submission can
// arrive without the form, so nothing about its shape is trusted: a field is
// its first value when that is text, and anything else (a missing field, a
// file) is empty. Pure.

/**
 * The text of the field `name` as it arrived: its first value, when it is
 * text. Browsers send a line break as CRLF but `maxlength` counts it as one
 * character, so line breaks become LF. A NUL character, which no person
 * types and PostgreSQL cannot store, is dropped.
 */
export function formText(form: FormData, name: string): string {
  const value = form.get(name);
  if (typeof value !== "string") return "";
  return value.replace(/\r\n?/g, "\n").replaceAll("\0", "");
}

/**
 * The first `max` characters of `text`, in the units `maxlength` counts,
 * never cutting a character in two: what a form shows again of a submission,
 * so a forged one cannot make the page echo a large body.
 */
export function boundedText(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = text.slice(0, max);
  return /[\uD800-\uDBFF]$/.test(head) ? head.slice(0, -1) : head;
}

/** What a checkbox sends when it is checked and declares no value of its own. */
export const CHECKED = "on";

/** Whether the checkbox `name` arrived checked: exactly what a browser sends, nothing else. */
export function isChecked(form: FormData, name: string): boolean {
  return form.get(name) === CHECKED;
}
