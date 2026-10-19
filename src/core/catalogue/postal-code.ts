// A Mexican postal code, as SEPOMEX writes it (`d_codigo`): exactly five
// digits, the same pattern the database checks on a zone, a business and a
// pending edit. The registration and edit forms ask for one and narrow their
// zones by it (docs/specs/business-registration.md), and a zone the admin
// adds needs one (docs/specs/admin-review.md). Pure.
import { POSTAL_CODE_PATTERN } from "../db/schema/checks.ts";

/** How many digits a postal code has. */
export const POSTAL_CODE_LENGTH = 5;

const POSTAL_CODE = new RegExp(POSTAL_CODE_PATTERN);

/** Whether `text` is a postal code: exactly five digits, nothing else. */
export function isPostalCode(text: string): boolean {
  return POSTAL_CODE.test(text);
}
