// The guard of the management links in the code (AGENTS.md, "Management
// links"; docs/specs/data-model.md, "The management link is issued by the
// panel alone and resolved by its fingerprint (v2)"; docs/specs/admin-review.md,
// "On approving, an offer is made to notify the business by WhatsApp with its
// card link and its management link" and "The admin can generate a new link,
// and the previous one stops working"): only the panel issues a link, today
// the approval of a registration and "Generar un enlace nuevo", and nothing
// on the way of a token writes to the log. It reads every file under src/
// and scripts/, so a new caller fails here naming its file until the
// specification gives it that right.
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { filesUnder, ROOT } from "./source-files.ts";

/** The code of the site and of its scripts. */
const FILES = ["src", "scripts"].flatMap((folder) => filesUnder(join(ROOT, folder)));

const source = (file: string) => readFileSync(file, "utf8");
const name = (file: string) => relative(ROOT, file);

/** The files that call issueManagementLink, its own module left out. */
const ISSUERS = FILES.filter((file) => /\bissueManagementLink\s*\(/.test(source(file)))
  .map(name)
  .filter((file) => file !== "src/core/management-link/link.ts");

/**
 * The files a token travels through on its way from the approval, or from
 * "Generar un enlace nuevo", to its one screen.
 */
const TOKEN_PATH = [
  "src/core/management-link/link.ts",
  "src/core/management-link/token.ts",
  "src/core/review/approval.ts",
  "src/core/review/new-link.ts",
  "src/lib/review.ts",
  "src/actions/index.ts",
  "src/pages/admin/registros/[id].astro",
  "src/components/admin/ApprovalConfirmation.astro",
  "src/components/admin/NewLinkConfirmation.astro",
  "src/components/admin/NoticeButton.astro",
  "src/core/review/notices.ts",
];

describe("Only the panel issues a management link, and nothing logs a token", () => {
  it("the approval of a registration and a new link are the only callers of issueManagementLink", () => {
    expect(ISSUERS.toSorted()).toEqual([
      "src/core/review/approval.ts",
      "src/core/review/new-link.ts",
    ]);
  });

  it("no file a token travels through writes to the log", () => {
    for (const file of TOKEN_PATH) {
      expect(source(join(ROOT, file)), file).not.toMatch(/\bconsole\s*\.\s*\w+\s*\(/);
    }
  });
});
