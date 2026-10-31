// Resend's HTTP boundary. Provider responses and thrown errors may contain
// addresses or credentials, so none is logged or propagated: a failure logs
// only the HTTP status or the error's kind. Workers' fetch accepts only the
// redirect modes "follow" and "manual" (it throws on "error"), so a redirect
// is not followed and its 3xx answer counts as a failure.
import { failureKind } from "../core/db/failure.ts";
import type { DailyEmailBatch } from "../core/notifications/daily.ts";

export const RESEND_BATCH_URL = "https://api.resend.com/emails/batch";
export const RESEND_TIMEOUT_MS = 5000;
export const EMAIL_FROM = "enmirumbo <avisos@enmirumbo.com>";
export const EMAIL_REPLY_TO = "contacto@enmirumbo.com";

export async function sendResendBatch(
  batch: DailyEmailBatch,
  key: string,
  options: {
    fetch?: typeof fetch;
    timeoutMs?: number;
  } = {},
): Promise<boolean> {
  try {
    const response = await (options.fetch ?? fetch)(RESEND_BATCH_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "Idempotency-Key": batch.idempotencyKey,
      },
      body: JSON.stringify(
        batch.recipients.map((to) => ({
          from: EMAIL_FROM,
          reply_to: EMAIL_REPLY_TO,
          to: [to],
          subject: batch.subject,
          text: batch.text,
        })),
      ),
      signal: AbortSignal.timeout(options.timeoutMs ?? RESEND_TIMEOUT_MS),
      redirect: "manual",
    });
    if (!response.ok) {
      await response.body?.cancel();
      console.error(`resend: the batch was refused (HTTP ${response.status})`);
      return false;
    }
    const body: unknown = await response.json();
    const data = (body as { data?: unknown } | null)?.data;
    const confirmed =
      Array.isArray(data) &&
      data.length === batch.recipients.length &&
      data.every(
        (entry: unknown) =>
          entry !== null &&
          typeof entry === "object" &&
          "id" in entry &&
          typeof entry.id === "string",
      );
    if (!confirmed) console.error("resend: the answer did not confirm every email");
    return confirmed;
  } catch (error) {
    console.error(`resend: the batch could not be sent (${failureKind(error)})`);
    return false;
  }
}
