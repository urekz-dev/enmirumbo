// What a failed write may say about itself in the log: the kind of failure,
// never the data it carried. The public forms (the report, the registration)
// log a failure with this alone, so nothing a person wrote, no address and
// no card reaches the log. Pure.

/** The kind of a failure, for the log: a PostgreSQL error code, or the error's name. */
export function failureKind(error: unknown): string {
  for (let cause: unknown = error; cause instanceof Error; cause = cause.cause) {
    const code = (cause as Error & { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return `PostgreSQL ${code}`;
  }
  return error instanceof Error ? error.name : "unknown";
}
