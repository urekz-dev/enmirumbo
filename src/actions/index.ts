// The Astro Actions of the site. Every mutation is one, posted by a form that
// works without JavaScript (`accept: "form"`). An action is reachable from any
// page (`?_action=<name>`) and at `/_actions/<name>`, so each one checks for
// itself where it was called from and what it may do: the middleware does not
// protect it. Admin actions live under the `admin` key and start with
// `requireAdmin` (src/lib/access/require-admin.ts).
import { ActionError, defineAction } from "astro:actions";
import { env, waitUntil } from "cloudflare:workers";
import { withDb } from "../core/db/client.ts";
import { submitRegistration } from "../core/registration/submit.ts";
import { submitReport } from "../core/report/submit.ts";
import { takeQuota } from "../lib/quota/quota.ts";
import { registrationActionError, registrationLocality } from "../lib/registration.ts";
import { reportActionError, reportTarget } from "../lib/report.ts";

export const server = {
  // A resident's report about a card (docs/specs/public-directory.md, the
  // report requirements), posted by the report form of that card. The card
  // is the one the page's address names (reportTarget): no field of the
  // submission chooses it. The core reads the submission and decides
  // (src/core/report/submit.ts); a write and the reads that lead to it go
  // through HYPERDRIVE_FRESH, and the quota is the `report` purpose. Nothing
  // about the sender is read but the address the quota counts in memory.
  report: defineAction({
    accept: "form",
    handler: async (form, context) => {
      const target = reportTarget(context);
      if (target === null) throw new ActionError({ code: "NOT_FOUND" });
      const outcome = await submitReport(form, target, {
        useDb: (run) => withDb(env, "HYPERDRIVE_FRESH", { waitUntil }, run),
        takeQuota: () => takeQuota(env, context.request.headers, "report"),
      });
      const error = reportActionError(outcome);
      if (error !== null) throw error;
    },
  }),

  // A business registering itself (docs/specs/business-registration.md),
  // posted by the registration form of a locality. The locality is the one
  // of the page's address (registrationLocality): no field of the submission
  // chooses it. The core reads the submission and decides
  // (src/core/registration/submit.ts); the write and the reads that lead to
  // it go through HYPERDRIVE_FRESH, and the quota is the `registration`
  // purpose. Nothing about the sender is read but the address the quota
  // counts in memory.
  register: defineAction({
    accept: "form",
    handler: async (form, context) => {
      const locality = registrationLocality(context);
      if (locality === null) throw new ActionError({ code: "NOT_FOUND" });
      const outcome = await submitRegistration(form, locality, {
        useDb: (run) => withDb(env, "HYPERDRIVE_FRESH", { waitUntil }, run),
        takeQuota: () => takeQuota(env, context.request.headers, "registration"),
      });
      const error = registrationActionError(outcome);
      if (error !== null) throw error;
    },
  }),
};
