// The token of a management link (PRD §6.4; docs/specs/data-model.md, "The
// business stores its management link as a fingerprint, never in plain";
// docs/specs/admin-review.md, "Approving a registration generates its
// management link, unique and unrepeatable"; docs/specs/business-registration.md,
// "A token that is not exactly the current one opens nothing and gives nothing
// away"). Pure: it never reads the environment or the database.
//
// - A token is 32 bytes from the platform's cryptographic random source (256
//   bits), written in base64url without padding: 43 characters of
//   `A-Za-z0-9_-`, which travel in a URL segment as they are. It derives from
//   nothing about the business.
// - The database keeps only its SHA-256 fingerprint, in hexadecimal. No salt
//   and no slow key derivation, on purpose: those protect secrets of low
//   entropy against dictionaries; 256 random bits have none to guess, and a
//   slow function would only slow every opening of the link. What matters is
//   that the token cannot be recovered from the fingerprint.
// - Two fingerprints are compared in constant time: JavaScript's `===` stops
//   at the first character that differs.
//
// Nothing here writes to the log, so no token or fingerprint ever reaches it.

/** How many random bytes a token has: 256 bits (admin-review: "at least 256 bits"). */
export const MANAGEMENT_TOKEN_BYTES = 32;

/** The shape of every token newManagementToken gives: 43 characters of base64url. */
export const MANAGEMENT_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** The shape of a fingerprint: SHA-256 in lowercase hexadecimal. */
export const TOKEN_FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/;

/** `bytes` in base64url, without padding. */
function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

/** A new token, from the cryptographic random source. It is never stored in plain. */
export function newManagementToken(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(MANAGEMENT_TOKEN_BYTES)));
}

/**
 * The fingerprint of `token`: SHA-256 of its UTF-8 bytes, in lowercase
 * hexadecimal. Any string has one, so a link is always looked up by its
 * fingerprint, whatever arrived in the address.
 */
export async function tokenFingerprint(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Whether two fingerprints are the same, in a time that depends only on
 * their length, which is always 64 for a fingerprint: every character is
 * compared, wherever the first difference is.
 */
export function sameFingerprint(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return difference === 0;
}
