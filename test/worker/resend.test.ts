import { afterEach, expect, it, vi } from "vite-plus/test";
import {
  sendResendBatch,
  EMAIL_FROM,
  EMAIL_REPLY_TO,
  RESEND_BATCH_URL,
} from "../../src/lib/resend.ts";
import type { DailyEmailBatch } from "../../src/core/notifications/daily.ts";

const key = crypto.randomUUID();
const batch: DailyEmailBatch = {
  idempotencyKey: "daily/local/99001/2030-01-10",
  recipients: ["one@example.test", "two@example.test"],
  subject: "Pendientes de hoy",
  text: "Registros por revisar: 2",
};
afterEach(() => vi.restoreAllMocks());

it("sends one strict batch request with private individual recipients, sender and reply-to", async () => {
  // The fake builds a Request first, as Workers' fetch does, so an option
  // workerd refuses (such as the redirect mode "error") fails here too.
  const request = vi.fn<typeof fetch>(async (url, init) => {
    new Request(url, init);
    return Response.json({ data: batch.recipients.map(() => ({ id: crypto.randomUUID() })) });
  });
  expect(await sendResendBatch(batch, key, { fetch: request })).toBe(true);
  expect(request).toHaveBeenCalledTimes(1);
  const [url, init] = request.mock.calls[0]!;
  expect(url).toBe(RESEND_BATCH_URL);
  expect(init?.headers).toEqual(
    expect.objectContaining({
      Authorization: `Bearer ${key}`,
      "Idempotency-Key": batch.idempotencyKey,
    }),
  );
  expect(init?.redirect).toBe("manual");
  expect(JSON.parse(typeof init?.body === "string" ? init.body : "null")).toEqual(
    batch.recipients.map((to) => ({
      from: EMAIL_FROM,
      reply_to: EMAIL_REPLY_TO,
      to: [to],
      subject: batch.subject,
      text: batch.text,
    })),
  );
  expect(init?.signal).toBeInstanceOf(AbortSignal);
});

it("logs only the kind of HTTP, redirect, malformed or network failures, never the key or the provider's words", async () => {
  const log = vi.spyOn(console, "log");
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  for (const request of [
    vi.fn<typeof fetch>(async () => Response.json({ message: key }, { status: 403 })),
    vi.fn<typeof fetch>(
      async () =>
        new Response(key, { status: 302, headers: { Location: "https://example.test/" } }),
    ),
    vi.fn<typeof fetch>(async () => new Response(key)),
    vi.fn<typeof fetch>(async () => Response.json({ data: [] })),
    vi.fn<typeof fetch>(async () => {
      throw new Error(key);
    }),
  ]) {
    expect(await sendResendBatch(batch, key, { fetch: request })).toBe(false);
  }
  expect(log).not.toHaveBeenCalled();
  expect(error.mock.calls.map(([line]) => line)).toEqual([
    "resend: the batch was refused (HTTP 403)",
    "resend: the batch was refused (HTTP 302)",
    "resend: the batch could not be sent (SyntaxError)",
    "resend: the answer did not confirm every email",
    "resend: the batch could not be sent (Error)",
  ]);
  for (const [line] of error.mock.calls) {
    expect(String(line)).not.toContain(key);
    for (const recipient of batch.recipients) expect(String(line)).not.toContain(recipient);
  }
});

it("aborts a slow provider", async () => {
  const request = vi.fn<typeof fetch>(
    (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error(key)), { once: true });
      }),
  );
  expect(await sendResendBatch(batch, key, { fetch: request, timeoutMs: 1 })).toBe(false);
});
