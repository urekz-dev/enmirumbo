// The Astro Actions of the site. Every mutation is one, posted by a form that
// works without JavaScript (`accept: "form"`). An action is reachable from any
// page (`?_action=<name>`) and at `/_actions/<name>`, so each one checks for
// itself where it was called from and what it may do: the middleware does not
// protect it. Admin actions live under the `admin` key and start with
// `requireAdmin` (src/lib/access/require-admin.ts).
import { ActionError, defineAction } from "astro:actions";
import { env, waitUntil } from "cloudflare:workers";
import {
  assignRole,
  createPanelUser,
  removeRoleAssignment,
  saveRole,
  setUserActive,
} from "../core/access/manage.ts";
import { managementId } from "../core/access/paths.ts";
import { formText } from "../core/forms/text.ts";
import {
  managedRole,
  managedUser,
  managementData,
  managementRoute,
  roleInput,
} from "../lib/panel-management.ts";
import { can } from "../core/access/queries.ts";
import { type Db, withDb } from "../core/db/client.ts";
import { submitRectification } from "../core/review/rectification.ts";
import { rectificationActionError, rectificationTarget } from "../lib/rectification.ts";
import { submitEdit } from "../core/edit/submit.ts";
import { submitRegistration } from "../core/registration/submit.ts";
import { submitReport } from "../core/report/submit.ts";
import { submitApplyEdit } from "../core/review/apply.ts";
import { submitApproval } from "../core/review/approval.ts";
import { submitAttendReport } from "../core/review/attend.ts";
import { submitDiscardEdit } from "../core/review/discard.ts";
import { submitDeletion } from "../core/review/deletion.ts";
import { submitNewLink } from "../core/review/new-link.ts";
import { submitRejection } from "../core/review/rejection.ts";
import { submitUnpublish } from "../core/review/unpublish.ts";
import {
  addZone,
  renameZone,
  setZoneVisibility,
  type ZoneWriteOutcome,
} from "../core/zones/manage.ts";
import { requireAdmin } from "../lib/access/require-admin.ts";
import { editActionError, editTarget } from "../lib/edit.ts";
import { applyActionError, discardActionError, editReviewTarget } from "../lib/edit-review.ts";
import { mediaBucket } from "../lib/media-bucket.ts";
import { takeQuota } from "../lib/quota/quota.ts";
import { registrationActionError, registrationLocality } from "../lib/registration.ts";
import { reportActionError, reportTarget } from "../lib/report.ts";
import { attendActionError } from "../lib/report-review.ts";
import {
  approvalActionError,
  approvalNotice,
  deletionActionError,
  deletionTarget,
  newLinkActionError,
  newLinkNotice,
  rejectionActionError,
  reviewTarget,
  unpublishActionError,
} from "../lib/review.ts";
import { siteOrigin } from "../lib/site-url.ts";
import { submitManualTask } from "../lib/manual-tasks.ts";
import { taskTimeZones } from "../core/tasks/access.ts";
import { turnstileVerifier } from "../lib/turnstile.ts";
import {
  submittedName,
  submittedPostalCode,
  submittedType,
  submittedVisibility,
  submittedZone,
  zoneActionData,
  zonesActionLocality,
} from "../lib/zones.ts";

/**
 * Runs `write` on the zones of `locality` through HYPERDRIVE_FRESH, when
 * `email` may manage them there (`zones.manage`, ADR 0021); a locality where
 * it may not is not found, as if it did not exist.
 */
function withZonesOf(
  email: string,
  locality: string,
  write: (db: Db) => Promise<ZoneWriteOutcome>,
): Promise<ZoneWriteOutcome> {
  return withDb(env, "HYPERDRIVE_FRESH", { waitUntil }, async (db) =>
    (await can(db, email, "zones.manage", locality)) ? write(db) : { kind: "not-found" },
  );
}

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
  // it go through HYPERDRIVE_FRESH, the switch of Turnstile included, so
  // turning it off lets submissions through at once; the token is checked
  // with siteverify (src/lib/turnstile.ts), and the quota is the
  // `registration` purpose. A photo goes through the Images binding (IMAGES)
  // to the public media bucket (MEDIA, with the cache of its media hostname:
  // src/lib/media-bucket.ts), only after every other check.
  // Nothing about the sender is read but the address the quota counts in
  // memory, which siteverify is never sent.
  register: defineAction({
    accept: "form",
    handler: async (form, context) => {
      const locality = registrationLocality(context);
      if (locality === null) throw new ActionError({ code: "NOT_FOUND" });
      const outcome = await submitRegistration(form, locality, {
        useDb: (run) => withDb(env, "HYPERDRIVE_FRESH", { waitUntil }, run),
        takeQuota: () => takeQuota(env, context.request.headers, "registration"),
        verifyTurnstile: turnstileVerifier(env),
        photos: { images: env.IMAGES, bucket: mediaBucket(env) },
      });
      const error = registrationActionError(outcome);
      if (error !== null) throw error;
    },
  }),

  // An owner sending changes to their published card from its management link
  // (docs/specs/business-registration.md, the edit requirements), posted by
  // the edit form of `/{estado}/{municipio}/editar/<token>`. The locality and
  // the token are those of the page's address (editTarget): no field of the
  // submission chooses the card, and a token that opens none is not found.
  // The core decides (src/core/edit/submit.ts) in the registration's order,
  // with Turnstile's action `edit` and the `edit` quota, and saves a pending
  // edit through HYPERDRIVE_FRESH, which touches nothing of the card. A
  // photo goes through IMAGES to MEDIA (mediaBucket) under a key no public
  // page names.
  // The token is never logged.
  edit: defineAction({
    accept: "form",
    handler: async (form, context) => {
      const target = editTarget(context);
      if (target === null) throw new ActionError({ code: "NOT_FOUND" });
      const outcome = await submitEdit(form, target, {
        useDb: (run) => withDb(env, "HYPERDRIVE_FRESH", { waitUntil }, run),
        takeQuota: () => takeQuota(env, context.request.headers, "edit"),
        verifyTurnstile: turnstileVerifier(env),
        photos: { images: env.IMAGES, bucket: mediaBucket(env) },
      });
      const error = editActionError(outcome);
      if (error !== null) throw error;
    },
  }),

  // The actions of the admin panel. Each starts with requireAdmin, which
  // verifies the request's own Access token, posts to a page under /admin
  // (Access adds its token only there) and checks its own permission in the
  // locality of what it touches (the decisions on a card in
  // src/core/review/decision.ts, the resolutions of a pending edit in
  // src/core/review/edit-decision.ts, the zones with withZonesOf). Reads and
  // writes go through HYPERDRIVE_FRESH.
  admin: {
    runTask: defineAction({
      accept: "form",
      handler: async (form, context) => {
        const admin = await requireAdmin(context);
        const outcome = await submitManualTask(
          form,
          env.ENVIRONMENT,
          context.routePattern,
          () =>
            withDb(env, "HYPERDRIVE_FRESH", { waitUntil }, (db) => taskTimeZones(db, admin.email)),
          env,
          { waitUntil },
        );
        if (outcome.kind === "not_found") throw new ActionError({ code: "NOT_FOUND" });
        if (outcome.kind === "forbidden") throw new ActionError({ code: "FORBIDDEN" });
        return outcome;
      },
    }),
    createUser: defineAction({
      accept: "form",
      handler: async (form, context) => {
        const admin = await requireAdmin(context);
        managementRoute(context, "/admin/usuarios");
        return managementData(
          await withDb(env, "HYPERDRIVE_FRESH", { waitUntil }, (db) =>
            createPanelUser(db, admin.email, {
              email: formText(form, "email"),
              name: formText(form, "name"),
            }),
          ),
        );
      },
    }),
    deactivateUser: defineAction({
      accept: "form",
      handler: async (_form, context) => {
        const admin = await requireAdmin(context);
        const id = managedUser(context);
        return managementData(
          await withDb(env, "HYPERDRIVE_FRESH", { waitUntil }, (db) =>
            setUserActive(db, admin.email, id, false),
          ),
        );
      },
    }),
    reactivateUser: defineAction({
      accept: "form",
      handler: async (_form, context) => {
        const admin = await requireAdmin(context);
        const id = managedUser(context);
        return managementData(
          await withDb(env, "HYPERDRIVE_FRESH", { waitUntil }, (db) =>
            setUserActive(db, admin.email, id, true),
          ),
        );
      },
    }),
    assignRole: defineAction({
      accept: "form",
      handler: async (form, context) => {
        const admin = await requireAdmin(context);
        const id = managedUser(context);
        const role = managementId(formText(form, "role"));
        // Even malformed forms recheck the global permission before validation.
        return managementData(
          await withDb(env, "HYPERDRIVE_FRESH", { waitUntil }, async (db) => {
            if (!(await can(db, admin.email, "users.manage", null))) return { kind: "forbidden" };
            if (role === null) return { kind: "invalid", errors: { role: "Elige un rol." } };
            return assignRole(db, admin.email, id, role, formText(form, "locality") || null);
          }),
        );
      },
    }),
    removeRole: defineAction({
      accept: "form",
      handler: async (_form, context) => {
        const admin = await requireAdmin(context);
        const id = managedUser(context, true);
        const assignment = managementId(context.params.assignment);
        if (assignment === null) throw new ActionError({ code: "NOT_FOUND" });
        return managementData(
          await withDb(env, "HYPERDRIVE_FRESH", { waitUntil }, (db) =>
            removeRoleAssignment(db, admin.email, id, assignment),
          ),
        );
      },
    }),
    createRole: defineAction({
      accept: "form",
      handler: async (form, context) => {
        const admin = await requireAdmin(context);
        managementRoute(context, "/admin/roles");
        return managementData(
          await withDb(env, "HYPERDRIVE_FRESH", { waitUntil }, (db) =>
            saveRole(db, admin.email, null, roleInput(form)),
          ),
        );
      },
    }),
    updateRole: defineAction({
      accept: "form",
      handler: async (form, context) => {
        const admin = await requireAdmin(context);
        const id = managedRole(context);
        return managementData(
          await withDb(env, "HYPERDRIVE_FRESH", { waitUntil }, (db) =>
            saveRole(db, admin.email, id, roleInput(form)),
          ),
        );
      },
    }),

    rectify: defineAction({
      accept: "form",
      handler: async (form, context) => {
        const admin = await requireAdmin(context);
        const businessId = rectificationTarget(context);
        if (businessId === null) throw new ActionError({ code: "NOT_FOUND" });
        const outcome = await submitRectification(
          form,
          { email: admin.email, businessId },
          {
            useDb: (run) => withDb(env, "HYPERDRIVE_FRESH", { waitUntil }, run),
            photos: { images: env.IMAGES, bucket: mediaBucket(env) },
          },
        );
        const error = rectificationActionError(outcome);
        if (error !== null) throw error;
      },
    }),
    // Approving a registration from its detail, /admin/registros/<id>
    // (docs/specs/admin-review.md, the approval requirements): trades, the
    // zone of an "Otra", the origin, the publication and the management link,
    // in one transaction only while the card is in review
    // (src/core/review/approval.ts), with `businesses.review` in its
    // locality. The card is the one of the page's address (reviewTarget).
    // It answers the page with the notice of its confirmation, which carries
    // the management link: the page shows it in that one answer, and it is
    // never logged or stored (src/lib/review.ts).
    approve: defineAction({
      accept: "form",
      handler: async (form, context) => {
        const admin = await requireAdmin(context);
        const businessId = reviewTarget(context);
        if (businessId === null) throw new ActionError({ code: "NOT_FOUND" });
        const outcome = await submitApproval(
          form,
          { email: admin.email, businessId },
          { useDb: (run) => withDb(env, "HYPERDRIVE_FRESH", { waitUntil }, run) },
        );
        if (outcome.kind === "approved") return approvalNotice(env, outcome);
        throw approvalActionError(outcome) ?? new ActionError({ code: "INTERNAL_SERVER_ERROR" });
      },
    }),

    // Rejecting a registration from its detail, with a reason of up to 500
    // characters that is never trimmed, only while the card is in review,
    // writing its entry of the audit log with the Access email in the same
    // transaction (src/core/review/rejection.ts), with `businesses.review`
    // in its locality. The page then answers a 303 to its confirmation.
    reject: defineAction({
      accept: "form",
      handler: async (form, context) => {
        const admin = await requireAdmin(context);
        const businessId = reviewTarget(context);
        if (businessId === null) throw new ActionError({ code: "NOT_FOUND" });
        const outcome = await submitRejection(
          form,
          { email: admin.email, businessId },
          { useDb: (run) => withDb(env, "HYPERDRIVE_FRESH", { waitUntil }, run) },
        );
        const error = rejectionActionError(outcome);
        if (error !== null) throw error;
      },
    }),

    // Marking a report of a card as attended from the card's detail,
    // /admin/registros/<id> (docs/specs/admin-review.md, "Marking a report as
    // attended, only once"): only while it is still pending and of that card
    // (src/core/review/attend.ts), with `reports.manage` in its locality. The
    // card is the one of the page's address (reviewTarget); the report, the
    // one the form names. The page paints the detail again with its notice.
    attendReport: defineAction({
      accept: "form",
      handler: async (form, context) => {
        const admin = await requireAdmin(context);
        const businessId = reviewTarget(context);
        if (businessId === null) throw new ActionError({ code: "NOT_FOUND" });
        const outcome = await submitAttendReport(
          form,
          { email: admin.email, businessId },
          { useDb: (run) => withDb(env, "HYPERDRIVE_FRESH", { waitUntil }, run) },
        );
        const error = attendActionError(outcome);
        if (error !== null) throw error;
      },
    }),

    // Applying a pending edit from its detail, /admin/ediciones/<n>
    // (docs/specs/admin-review.md, "Applying the pending edit updates the
    // published card and only that"): the form's fields and what it asks of
    // the photo, to the card, in one transaction only while the edit is still
    // pending and the card published, the zone of an "Otra" normalized and
    // the WhatsApp checked again (src/core/review/apply.ts), with
    // `edits.review` in its locality. The edit is the one of the page's
    // address (editReviewTarget). The photo the card no longer names is
    // deleted once it is saved, and purged from the cache of the media
    // hostname (mediaBucket). The page then answers a 303 to its
    // confirmation.
    applyEdit: defineAction({
      accept: "form",
      handler: async (form, context) => {
        const admin = await requireAdmin(context);
        const editId = editReviewTarget(context);
        if (editId === null) throw new ActionError({ code: "NOT_FOUND" });
        const outcome = await submitApplyEdit(
          form,
          { email: admin.email, editId },
          {
            useDb: (run) => withDb(env, "HYPERDRIVE_FRESH", { waitUntil }, run),
            bucket: mediaBucket(env),
          },
        );
        const error = applyActionError(outcome);
        if (error !== null) throw error;
      },
    }),

    // Discarding a pending edit from its detail, with a reason of up to 500
    // characters that is never trimmed, only while the edit is still pending
    // (src/core/review/discard.ts), with `edits.review` in its locality. The
    // card does not change; the new photo the edit carried is deleted once
    // it is discarded, and purged from the cache of the media hostname
    // (mediaBucket). The page then answers a 303 to its confirmation.
    discardEdit: defineAction({
      accept: "form",
      handler: async (form, context) => {
        const admin = await requireAdmin(context);
        const editId = editReviewTarget(context);
        if (editId === null) throw new ActionError({ code: "NOT_FOUND" });
        const outcome = await submitDiscardEdit(
          form,
          { email: admin.email, editId },
          {
            useDb: (run) => withDb(env, "HYPERDRIVE_FRESH", { waitUntil }, run),
            bucket: mediaBucket(env),
          },
        );
        const error = discardActionError(outcome);
        if (error !== null) throw error;
      },
    }),

    // Unpublishing a published card from its detail, with a reason of up to
    // 500 characters that travels to the business and is never trimmed,
    // only while the card is published, writing its entry of the audit log
    // with the Access email in the same transaction
    // (src/core/review/unpublish.ts), with `businesses.unpublish` in its
    // locality. The page then answers a 303 to its confirmation.
    unpublish: defineAction({
      accept: "form",
      handler: async (form, context) => {
        const admin = await requireAdmin(context);
        const businessId = reviewTarget(context);
        if (businessId === null) throw new ActionError({ code: "NOT_FOUND" });
        const outcome = await submitUnpublish(
          form,
          { email: admin.email, businessId },
          { useDb: (run) => withDb(env, "HYPERDRIVE_FRESH", { waitUntil }, run) },
        );
        const error = unpublishActionError(outcome);
        if (error !== null) throw error;
      },
    }),

    // "Generar un enlace nuevo" from the detail of a published card
    // (src/core/review/new-link.ts), with `links.manage` in its locality: the
    // previous link stops opening the card at once. It answers the page with
    // the notice of its confirmation, which carries the new link, absolute
    // from SITE_URL: the page shows it in that one answer, and it is never
    // logged or stored. Without a public origin nothing is issued, so the
    // owner keeps the link they have.
    newLink: defineAction({
      accept: "form",
      handler: async (form, context) => {
        const admin = await requireAdmin(context);
        const businessId = reviewTarget(context);
        if (businessId === null) throw new ActionError({ code: "NOT_FOUND" });
        const outcome = await submitNewLink(
          form,
          { email: admin.email, businessId },
          {
            useDb: (run) => withDb(env, "HYPERDRIVE_FRESH", { waitUntil }, run),
            hasPublicOrigin: siteOrigin(env) !== null,
          },
        );
        if (outcome.kind === "issued") {
          const notice = newLinkNotice(env, outcome);
          if (notice !== null) return notice;
        }
        throw newLinkActionError(outcome) ?? new ActionError({ code: "INTERNAL_SERVER_ERROR" });
      },
    }),

    // The permanent deletion of a card, posted by its confirmation,
    // /admin/registros/<id>/borrar, with BORRAR typed
    // (src/core/review/deletion.ts), with `businesses.delete` in its
    // locality: its photos first, from the bucket and from the cache of the
    // media hostname (mediaBucket), then its rows and the entry of the audit
    // log in one transaction. The card is the one of that page's address
    // (deletionTarget). It answers whether the photo may still be cached;
    // the page then answers a 303 to a screen under no card's address.
    deleteCard: defineAction({
      accept: "form",
      handler: async (form, context) => {
        const admin = await requireAdmin(context);
        const businessId = deletionTarget(context);
        if (businessId === null) throw new ActionError({ code: "NOT_FOUND" });
        const outcome = await submitDeletion(
          form,
          { email: admin.email, businessId },
          {
            useDb: (run) => withDb(env, "HYPERDRIVE_FRESH", { waitUntil }, run),
            bucket: mediaBucket(env),
          },
        );
        if (outcome.kind === "deleted") return { photoCached: outcome.photoCached };
        throw deletionActionError(outcome) ?? new ActionError({ code: "INTERNAL_SERVER_ERROR" });
      },
    }),

    // The zones screen of the panel (docs/specs/admin-review.md, "The admin
    // can hide and rename the zones of a locality (v2)" and "The admin can
    // add a zone to a locality (v2)"), posted by the forms of
    // /admin/colonias?localidad=<code>. Each takes the locality from that
    // address (src/lib/zones.ts), checks `zones.manage` there and calls the
    // core (src/core/zones/manage.ts) through HYPERDRIVE_FRESH. A saved
    // change answers the zone it touched; a form with errors, its errors.

    // Hides or shows a zone of the locality: only whether the registration
    // and the edit offer it.
    setZoneVisibility: defineAction({
      accept: "form",
      handler: async (form, context) => {
        const admin = await requireAdmin(context);
        const locality = zonesActionLocality(context);
        const zoneId = submittedZone(form);
        const visible = submittedVisibility(form);
        if (locality === null || zoneId === null || visible === null) {
          throw new ActionError({ code: "NOT_FOUND" });
        }
        return zoneActionData(
          await withZonesOf(admin.email, locality, (db) =>
            setZoneVisibility(db, locality, zoneId, visible),
          ),
        );
      },
    }),

    // Renames a zone of the locality; its slug and its URLs stay.
    renameZone: defineAction({
      accept: "form",
      handler: async (form, context) => {
        const admin = await requireAdmin(context);
        const locality = zonesActionLocality(context);
        const zoneId = submittedZone(form);
        if (locality === null || zoneId === null) throw new ActionError({ code: "NOT_FOUND" });
        const name = submittedName(form);
        return zoneActionData(
          await withZonesOf(admin.email, locality, (db) => renameZone(db, locality, zoneId, name)),
        );
      },
    }),

    // Adds a zone to the locality, with its postal code and a slug from its
    // name that never changes.
    addZone: defineAction({
      accept: "form",
      handler: async (form, context) => {
        const admin = await requireAdmin(context);
        const locality = zonesActionLocality(context);
        if (locality === null) throw new ActionError({ code: "NOT_FOUND" });
        const name = submittedName(form);
        const type = submittedType(form);
        const postalCode = submittedPostalCode(form);
        return zoneActionData(
          await withZonesOf(admin.email, locality, (db) =>
            addZone(db, locality, name, type, postalCode),
          ),
        );
      },
    }),
  },
};
