# enmirumbo

A hyperlocal business directory, starting in Tizayuca, Hidalgo. Businesses register from a phone, a person verifies each one before it is published, and residents contact them through WhatsApp.

This repository is being rebuilt from scratch. The code is public for reading only; see [LICENSE](LICENSE). External contributions are not accepted; see [CONTRIBUTING.md](CONTRIBUTING.md).

- Product: [docs/PRD.md](docs/PRD.md)
- Specifications: [docs/specs/](docs/specs/)
- Decisions: [docs/adr/](docs/adr/)

## Stack

- [Astro](https://astro.build/) in server mode on Cloudflare Workers, through `@astrojs/cloudflare`. A custom Worker entry (`src/worker.ts`) sends requests to Astro and also handles the scheduled jobs.
- Tailwind CSS 4. The palette and the typography are tokens in `src/styles/global.css`; Tailwind's default palette is removed, so a colour that is not a token does not exist. The font is the system font stack: nothing is downloaded.
- [Vite+](https://viteplus.dev/) (`vp`) as the toolchain: pnpm, Oxlint, Oxfmt, Vitest and Vite Task. Prettier formats `.astro` files until Oxfmt supports them.
- PostgreSQL 18 (Neon in the cloud, Docker locally) through Hyperdrive, with the `pg` driver and Drizzle ORM and Drizzle Kit.
- Tests run inside workerd with `@cloudflare/vitest-plugin`; Astro pages and components are rendered in Node with Astro's Container API (`test/astro/`); end-to-end tests use Playwright.

## Requirements

- [Vite+](https://viteplus.dev/guide/) installed globally. It provides Node.js 24 and pnpm 12, the versions declared in `package.json`.
- Git 2.32 or later.
- [Docker](https://www.docker.com/) with Compose, for the local database.

## Run locally

```sh
vp install                           # dependencies and the pre-commit hook
vp exec playwright install chromium  # once, for the end-to-end tests
vp run dev                           # http://localhost:4321
```

The dev server, the build and the preview run Astro in workerd, the Workers runtime. Astro's commands are tasks: `vp dev`, `vp build` and `vp preview` run plain Vite and do not work in this project.

| Command            | What it does                                                                                                |
| ------------------ | ----------------------------------------------------------------------------------------------------------- |
| `vp run dev`       | Starts the dev server at http://localhost:4321.                                                             |
| `vp run build`     | Builds the site and the Worker into `dist/`.                                                                |
| `vp run preview`   | Serves the build at http://localhost:4321.                                                                  |
| `vp check`         | Formats, lints and type checks.                                                                             |
| `vp run check:all` | Runs `vp check`, Prettier on `.astro` files, `astro check` and a Worker types check.                        |
| `vp test`          | Runs the tests inside workerd.                                                                              |
| `vp run e2e`       | Builds, migrates and seeds the database, then runs the Playwright tests (port `E2E_PORT`, 4321 by default). |
| `vp run fmt:astro` | Formats `.astro` files with Prettier.                                                                       |
| `vp run types`     | Regenerates `worker-configuration.d.ts` after a change to `wrangler.jsonc`.                                 |

### Admin panel

`/admin` is protected by Cloudflare Access ([ADR 0010](docs/adr/0010-admin-access-with-cloudflare-access.md)), and the Worker verifies the Access token on every request. Locally it opens without signing in, as `admin@enmirumbo.test`, because `wrangler.jsonc` sets `ENVIRONMENT` to `local`; that identity works only on `localhost`. The Worker variables that configure it (all of them are in [Deployment](#deployment)):

| Variable             | What it is                                                                    |
| -------------------- | ----------------------------------------------------------------------------- |
| `ENVIRONMENT`        | `local`, `dev`, `stage` or `prod`. Any other value, or none, closes `/admin`. |
| `ACCESS_TEAM_DOMAIN` | The Access team domain, `urekz.cloudflareaccess.com`.                         |
| `ACCESS_AUD`         | The AUD tag of the `enmirumbo admin` Access application. Empty locally.       |

To run the scheduled handler while `vp run dev` is running:

```sh
curl "http://localhost:4321/cdn-cgi/local/scheduled?cron=0+*+*+*+*"
```

The hourly job (`src/scheduled.ts`, [ADR 0013](docs/adr/0013-scheduled-jobs-hourly-cron.md)) runs every task at the time it was scheduled for and logs what each did, as counts; a task that fails is logged by its name and the kind of failure, the others still run, and the run fails. Its one task today is the daily registrations alert (see [Operations](#daily-registrations-alert)).

No secret is needed locally. Wrangler warns that `TURNSTILE_SECRET_KEY` is missing unless a `.dev.vars` file (ignored by git) sets it; without it the local Worker emulates Cloudflare's always-pass test secret, without network (see [Registration](#registration)), and the tests set that same secret. To see the form refused, write in `.dev.vars` the test secret that fails every token (`3x0000000000000000000000000000000AA` answers as if the token were already spent):

```sh
TURNSTILE_SECRET_KEY=2x0000000000000000000000000000000AA
```

### Public URLs

Every public page of a locality lives under `/{estado}/{municipio}/`, in `src/pages/[state]/[municipality]/` ([ADR 0007](docs/adr/0007-single-host-urls-with-state-and-municipality.md)). Before the page runs, the middleware (`src/lib/locality.ts`) resolves the active locality through the cached `HYPERDRIVE`, one small query that Hyperdrive answers from its cache, and hands it to the page as `Astro.locals.locality` (`requireLocality`). An unknown state or municipality, one under another state, or a locality that is not active answers 404 with the site's 404 page. Activating a locality is a data change; no name is written in the code.

Public URLs always carry the state and the municipality: there is no short alias, so `/tizayuca`, like any single segment that is not a page of the site, answers 404.

| Active localities | `/`                                                                                          |
| ----------------- | -------------------------------------------------------------------------------------------- |
| None              | The placeholder, 200                                                                         |
| One               | 301 to its home, such as `/hidalgo/tizayuca`, kept by browsers for an hour at most           |
| Two or more       | The list of localities, or a 302 to the one the visitor chose (`locality` cookie), see below |

With two or more active localities (`src/core/locality/root.ts`, `src/components/LocalityList.astro`):

- `/` lists them, each linking to `/?elegir={estado}/{municipio}`. That answer stores the choice in the `locality` cookie, which holds only the municipality slug (`Path=/`, a year, `HttpOnly`, `SameSite=Lax`, `Secure` over HTTPS), and redirects to the home. Later visits to `/` with the cookie redirect there too; a cookie that names no active locality is ignored.
- Those redirects are a 302 with `Cache-Control: no-store`, and the list carries `no-store` too: what `/` answers depends on each visitor's cookie and location, so no browser or cache may keep it. The 301 of a single locality is the only redirect browsers keep.
- The footer of every page of a locality links to `/?cambiar` ("Cambiar de municipio"), the list even for a visitor who chose. `othersActive`, read with the locality by the middleware, tells it whether another locality is active.
- The root never redirects by the visitor's location. The list highlights, as "Te queda más cerca", the active locality whose municipal seat is nearest to the approximate location Cloudflare attaches to the request (`request.cf`, `src/core/locality/nearest.ts`); the location is used for that answer only. A locality without seat coordinates is listed but never highlighted.

Internal links are built with `localityPath` (`src/core/locality/paths.ts`) and absolute URLs, such as canonicals and share previews, with `absoluteUrl` (`src/lib/site-url.ts`) from `SITE_URL`; outside `local`, without an https `SITE_URL` the pages leave them out. `test/scripts/internal-links.test.ts` fails on a link written in the code that names no page, and `test/e2e/internal-links.spec.ts` follows every link and form of the rendered site. The end-to-end tests migrate and seed `DATABASE_URL`, or the development database when it is unset, so Tizayuca is their only active locality. After them, the `phone, two localities` project of `playwright.config.ts` adds a fictitious second locality (`test/e2e/two-localities/`), tests the list, the cookie and the link to change municipality, crawls the site again and removes it. `astro preview` gives every request the approximate location of the machine; a request with Miniflare's `MF-CF-Blob` header (JSON of the `cf` object) is placed elsewhere.

### Home of a locality

The home of each active locality is `/{estado}/{municipio}` (`src/pages/[state]/[municipality]/index.astro`), rendered inside the layout by `src/components/LocalityHome.astro`. It reads the 8 categories through the cached `HYPERDRIVE` (`catalogueCategories`) and shows, in this order:

- "¿Qué necesitas en {municipio}?", its only `h1`, and "Encuentra negocios y servicios de aquí cerquita y contáctalos directo por WhatsApp.".
- The search box, empty (`src/components/SearchBox.astro`): a GET form to the results page of the locality (see [Search](#search)).
- "Busca por categoría" and the 8 categories as large buttons (`src/components/CategoryGrid.astro`, the same ones the results page offers), each leading to its listing.
- "Deporte en {municipio}", at the level of the categories, which highlights the category "Clubes y escuelas deportivas" (`SPORTS_CATEGORY_SLUG`, `src/core/catalogue/categories.ts`): its phrase and "Ver clubes y escuelas deportivas", a secondary button to that category's listing, the same page its button leads to.
- "¿Tienes un negocio en {municipio}?", at the same level, with "Registra tu negocio gratis", the primary action, to the registration page of the locality (see [Registration](#registration)).

Every name comes from the locality record. The home keeps the site's title and description in the locality, declares its own path as canonical and is in the sitemap. With no active locality, `/` keeps the notice that the directory is coming (`src/components/ComingSoon.astro`).

### Business cards

Each published business has its card at `/{estado}/{municipio}/negocio/<slug>-<id>` (`src/pages/[state]/[municipality]/negocio/[card].astro`): the identifier is the ten characters after the last hyphen, and the slug is the current name of the business (`cardPath`, `src/core/business/card-path.ts`). The page reads only a published card of its locality, through the cached `HYPERDRIVE` (`src/core/business/card.ts`), and never reads pending edits. A segment without an identifier, an unknown identifier, a card of another locality and one in review, rejected or deleted all answer the same 404. A published card asked for with another readable part (an earlier name, the identifier alone) answers a 301 to its current URL, which browsers keep for an hour at most, because a business can be renamed again.

- The card (`src/components/BusinessCard.astro`) shows what the business registered and nothing it left blank: the name as its only `h1`, the "Negocio verificado" seal, "A domicilio", the zone, what it offers, its address or references, its opening hours, its trades with their curated phrases (`src/core/catalogue/trade-phrases.ts`) and the contact buttons. "Enviar WhatsApp" opens the conversation with the message "Hola, te vi en enmirumbo. ¿Me das informes?"; "Llamar", "Cómo llegar" (Google Maps with the reference, the zone and the locality from its record) and "Ver su página (<dominio>)" appear only with their data (`src/core/business/contact.ts`). A landline that is not a number of ten digits is shown as text, with no call link.
- Its title, description, canonical URL and share preview come from the layout; its description hides any number written in "¿Qué ofreces?". Its Schema.org `LocalBusiness` block (`src/core/seo/card.ts`, `src/components/JsonLd.astro`) declares the name, the URL, the catalogue zone inside an address of the locality, the category and the trades, never the address, the numbers or the opening hours.
- Each trade links to its trade page in the card's locality (`src/components/CardTrades.astro`). The card is published, so that page always lists it and is never an empty one.
- After the contact block and apart from it, as small muted links (`src/components/CardSecondaryLinks.astro`): "Reportar este negocio", to the card's report form (see [Reports](#reports)), and "¿Es tu negocio?" with "Perdí mi enlace", which opens WhatsApp to the contact WhatsApp of the card's locality, read from its record, with the message "Hola, soy de «<nombre>» en enmirumbo y perdí el enlace para editar mi ficha. Les escribo desde el número que registré, ¿me lo pueden pasar?" (`lostLinkLink`). A contact WhatsApp that is not ten digits hides that block.
- The listing card (`src/components/ListingCard.astro`, from a `ListingBusiness`, `src/core/business/listing.ts`) is the one card of the listings and the search results: its photo or, without one, the placeholder with the emoji of the category (`src/core/catalogue/category-emoji.ts`), the name as an `h2` linked to the card, the zone, "A domicilio" and a green WhatsApp button with the same message, measured as `whatsapp-listing`. A page passes it its `analytics` (`pageAnalytics`), and the list marks its first card as `firstRow`, the only one whose photo loads at once.
- A card with a photo shows it above its name, shares it as its preview and names it in its Schema.org block; a card without one shows no gap. See [Photos](#photos).

### Search

The results page of a locality is `/{estado}/{municipio}/buscar?q=<query>` (`src/pages/[state]/[municipality]/buscar.astro`), where the search box of the home and of the page itself submits: a GET form that works without JavaScript (`src/components/SearchBox.astro`). The page decides one of four states (`src/core/search/state.ts`) and `src/components/SearchPage.astro` renders it:

| State      | When                                                                   | What it shows                                                                                                                        |
| ---------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Empty      | Nothing searchable is left of the query (`searchTerms`): no query runs | "¿Qué estás buscando?", "Escribe qué necesitas y te decimos quién lo hace en {municipio}.", the empty box and the 8 categories       |
| Results    | The search found published businesses                                  | `Resultados para "…"`, the box with the query, listing cards 20 at a time and "Ver más" to the next page                             |
| No results | The search found nothing                                               | `No encontramos negocios para "…".`, "Prueba con otra palabra o elige una categoría:" and the 8 categories; Umami tags the page view |
| Over quota | The address made more than 100 searches in 10 minutes: no query runs   | A 429 with `Retry-After` and `Cache-Control: no-store`, "Recibimos muchas búsquedas desde aquí. Espera un rato y vuelve a intentar." |

- The search (`src/core/search/`) reads through the cached `HYPERDRIVE`. The page shows what was typed cut to 80 characters and without invisible characters (`displayedQuery`), and Astro escapes it. Its title is static, `Buscar en {municipio}`, so the query never leaves through the title, and it declares `noindex, follow` and no canonical (`BaseLayout`'s `noindex`). The category buttons are `src/components/CategoryGrid.astro`, with the categories in catalogue order (`catalogueCategories`).
- Lists of businesses show `PAGE_SIZE` (20) at a time (`src/core/pagination.ts`): page 1 has no `pagina`, a later page is `?pagina=2` and so on, reached from "Ver más" (`src/components/MoreLink.astro`). A `pagina` that is not an integer above 1 written without leading zeros answers 404, and so does a later page with no rows. Each page reads one row more than it shows to know whether a next page exists.

#### Per-IP quotas

The search, the reports and the registration have per-IP quotas ([ADR 0012](docs/adr/0012-abuse-controls-quotas-and-turnstile.md)): 100 searches in a window of 10 minutes that starts with an address's first search, of which only a request that runs the query counts; 3 reports in an hour, of which only a submission that would save a report counts; and 3 registrations in an hour, of which only a submission that passed the trap field and every field counts. A page or an action asks with `takeQuota(env, request.headers, "<purpose>")` (`src/lib/quota/quota.ts`), the purpose written as a literal; the purposes and their limits are `QUOTAS` (`src/core/quota/quotas.ts`), a fixed list where the edit form and the SMS will add theirs, each counting apart.

The counters live in the `QuotaCounter` Durable Object (`src/lib/quota/counter.ts`, binding `QUOTA_COUNTER`, declared with SQLite storage in `exports` at the top level and in each environment of `wrangler.jsonc`): one single instance for every purpose, named `QUOTA_COUNTER_NAME`, with the purpose in the code of each counter. To keep the privacy notice true, nothing about an address is ever stored: the object turns the address (`CF-Connecting-IP`, an IPv6 address by its /64) into an HMAC with a key it generates in its memory and never exports, counts in memory, and a timer deletes each counter when its window ends, which also keeps the object in memory until then. A restart forgets every counter, so a quota can only count less, never block more. When the object does not answer, the request goes on. Locally Miniflare gives every request a loopback address, which is not counted, so development and the end-to-end tests are never held back; a test of a quota sends an address of its own, from the ranges reserved for documentation, in `CF-Connecting-IP`. The quotas need no secret.

The counter cannot run up a bill (ADR 0012, amended on 2026-10-15). A Durable Object is billed for the time it stays in memory unable to hibernate, and its timer keeps it from hibernating, so the counter keeps to rules that `AGENTS.md` lists and `test/scripts/quota-guardrails.test.ts` (on the source and `wrangler.jsonc`) and `test/worker/quota.test.ts` (on the running object) check: one instance, never one per visitor, address, user or purpose; nothing in its storage and no alarm; one timer, which exists only while a counter exists, is set at most `MAX_TIMER_MS` (10 minutes) ahead and is not set again once no counter remains; and `preview_urls` off everywhere. So at most one object is ever awake: about 11,000 GB-s a day, under the 13,000 of Workers Free, and about 332,000 GB-s in a month of 30 days, inside the 400,000 that Workers Paid includes. Beyond the million requests a month Workers Paid includes, each million costs 0.15 USD.

### Reports

Each published card has a report form at `/{estado}/{municipio}/negocio/<slug>-<id>/reportar` (`src/pages/[state]/[municipality]/negocio/[card]/reportar.astro`, rendered by `src/components/ReportPage.astro` and `ReportForm.astro`): "¿Qué pasa?" with four reasons and none chosen, an optional comment of up to 300 characters and "Enviar reporte". It asks nothing about the resident, never sets a cookie and works without JavaScript.

- The form posts to its own address with the Astro Action `report` (`src/actions/index.ts`), which Astro runs before the page. The action takes the card from the page's address (`reportTarget`, `src/lib/report.ts`), never from a field, and refuses to run from any other page or at `/_actions/report`. The core decides (`submitReport`, `src/core/report/submit.ts`): the trap field (`src/core/forms/honeypot.ts`, `src/components/HoneypotField.astro`), trimmed; the reason and the comment (`src/core/report/submission.ts`); a published card of the locality; the `report` quota (3 an hour per address); and the report, saved through `HYPERDRIVE_FRESH` unless the card already has 10 unattended ones (`saveReport`, `src/core/report/save.ts`).
- No race window: the counter checks and takes the quota in one step, and every report of a card waits for a transaction-level advisory lock on that card (`pg_advisory_xact_lock(1, hashtext(<id>))`), after which one statement decides the cap and inserts.
- A received report (saved, past the cap or caught by the trap, which look the same) answers a 303 to `/{estado}/{municipio}/reportar/gracias?negocio=<id>`, which says "¡Gracias por avisarnos! Vamos a revisar este negocio." and links back to the card. An error renders the form again in the answer to the same submission, with the chosen reason and the comment from that submission, and the status of the error: 400 for the reason or the comment, 429 over the quota, 500 when it could not be saved. A card that cannot be reported answers the same 404 as one that does not exist.
- Both pages are `noindex, follow`, out of the sitemap and disallowed by `robots.txt`. A report changes nothing public, and nothing about its sender is stored or logged: the table has no column for it. How the admin attends reports arrives with the panel (epic F).

### Registration

Each active locality has its registration form at `/{estado}/{municipio}/registro` (`src/pages/[state]/[municipality]/registro.astro`, rendered by `src/components/RegistrationPage.astro`, `RegistrationForm.astro` and `ConsentBlock.astro`): one screen, no account, "Registra tu negocio gratis" as its `h1`. The page is indexable, with its own canonical, and in the sitemap. It reads the categories and the visible zones of the locality through the cached `HYPERDRIVE` (`registrationCatalogue`, `src/core/registration/catalogue.ts`).

- The fields: "¿Cómo se llama tu negocio?", "¿A qué se dedica?" (the 8 categories, sent by slug), "Tu WhatsApp (10 dígitos)", "¿En qué colonia estás?" and the consent checkbox are required; "¿Qué ofreces? (opcional)", "¿Haces entregas o vas a domicilio? (opcional)", "Teléfono fijo (opcional)", "Dirección o referencias (opcional)", "Horario (opcional)" and "Link de tu Facebook (opcional)" are optional. The photo field arrives with EMR-40, between the Facebook link and the consent block. The example inside "¿Qué ofreces?" follows the category (`src/core/registration/examples.ts`).
- The zone is a text field with the browser's own suggestions (a `datalist`) of the visible zones of the locality, by display name, in alphabetical order: typing "hacien" offers "Haciendas de Tizayuca". The server compares what arrives with them ignoring case, accents and punctuation (`chooseZone`, `src/core/registration/zone.ts`): a text that names exactly one zone selects it; any other text is saved as the free text of "Otra", for the admin to normalize.
- The consent block shows the simplified notice with the municipality, "Lee el aviso de privacidad completo", "Estás aceptando la versión <n> del aviso de privacidad." and the checkbox, all read from `src/core/legal/`. The form carries `NOTICE_VERSION` in the hidden field `noticeVersion`: a submission with any other version is the error "El aviso de privacidad cambió mientras llenabas esto…". The record saved is always the server's: `consentedToNoticeAt` (the moment of the insert, the same as `registered_at`) and `consentedToNoticeVersion` (`NOTICE_VERSION`).
- The form posts to its own address with the Astro Action `register` (`src/actions/index.ts`), which refuses to run from any other page or at `/_actions/register` (`registrationLocality`, `src/lib/registration.ts`). The core decides (`submitRegistration`, `src/core/registration/submit.ts`): the trap field; Turnstile, unless its switch is off; every field (`validateRegistration`, `src/core/registration/submission.ts`), with the spec's literal messages and limits; the `registration` quota (3 an hour per address); and the registration, saved through `HYPERDRIVE_FRESH` (`saveRegistration`, `src/core/registration/save.ts`).
- The form leaves every check to the server (`novalidate`): each error comes back next to its field, the first field with one takes the focus (`autofocus`), and what was written comes back from the same submission, bounded to each field's limit, except the consent. The answer carries the status of the error (400 for the fields, 403 when Turnstile refused it, 429 over the quota, 500 when it could not be saved), `Cache-Control: no-store` and no cookie. Its own script, bundled as a file, changes the example of "¿Qué ofreces?" and shows "Enviando..." on the disabled button.
- Turnstile ([ADR 0012](docs/adr/0012-abuse-controls-quotas-and-turnstile.md)), in managed mode, while its switch is on (see [Operations](#turnstiles-switch)). The page reads the switch through `HYPERDRIVE` and renders `src/components/TurnstileWidget.astro` before the submit button, with the environment's `TURNSTILE_SITE_KEY` and the action `registration`; the widget's bundled script loads Cloudflare's `api.js` and enables the button, which the page renders disabled, once the widget has a token. Without JavaScript the button stays disabled and a `<noscript>` above the fields says "Para registrar tu negocio, activa JavaScript en tu navegador. Lo usamos para comprobar que eres una persona." The action reads the switch through `HYPERDRIVE_FRESH` and checks the token with siteverify (`checkTurnstile`, `src/core/turnstile/check.ts`; `verifyTurnstileToken`, `src/core/turnstile/verify.ts`; `turnstileVerifier`, `src/lib/turnstile.ts`): the secret and the token only, never the visitor's address, a timeout of 3 seconds and no retry. Without a valid token (missing, expired, spent, of another form, or Cloudflare not answering) nothing is saved, no quota is spent, and the form comes back, 403, with "No pudimos comprobar que eres una persona. Vuelve a intentarlo." With the switch off there is no widget, the form submits and validates without JavaScript, and the trap field and the quota keep working. The edit form (EMR-43) will render the same widget and call the same check with its own action; the report form and the search have no Turnstile.
- Test keys: locally `TURNSTILE_SITE_KEY` is Cloudflare's always-pass test site key, whose widget gives the dummy token `XXXX.DUMMY.TOKEN.XXXX`, and with no `TURNSTILE_SECRET_KEY`, or a test one, the local Worker (`ENVIRONMENT` `local`) answers as siteverify would, without network. Anywhere else a test secret, or none, refuses every token and is logged once, a real secret never accepts the dummy token, a test site key renders no widget, and the deploy refuses any site key that is not a real one. The end-to-end tests answer every request to `challenges.cloudflare.com` with a local stand-in of `api.js` (`test/e2e/turnstile.ts`, `test/e2e/turnstile-fake.js`). To check Cloudflare's real script under the site's content security policy, which needs the network: `E2E_TURNSTILE_REAL=1 vp run e2e --project "phone, real Turnstile"` (`test/e2e/turnstile-real.spec.ts`).
- A new number in the locality creates the business in `in_review`, origin `organic`, with no trades, no publication date, no management link and no photo, with an identifier from `newBusinessId()`; the database derives its search text. A number whose card is in review or published is told "Este número ya tiene una ficha registrada…" next to the WhatsApp, and nothing changes (`INSERT … ON CONFLICT DO NOTHING`, so a race between two submissions is a duplicate, never an error). A number whose card was rejected is a resubmission: that card takes the new data, goes back to `in_review` with its rejection trace cleared and its wait restarted, keeps its consent record (with the re-acceptance noted when the notice in force is later), its origin, its trades, its management link, its publication date and its photo, and the owner sees the usual thank-you page.
- A received registration (new, resubmitted or caught by the trap) answers a 303 to `/{estado}/{municipio}/registro/gracias`, which says "¡Gracias! Tu negocio está en revisión. Te contactaremos por WhatsApp para confirmar tus datos antes de publicarlo." and links back to the home; it is `noindex, follow`, out of the sitemap and disallowed by `robots.txt`.
- The daily registrations alert, a task of the hourly job, tells the admin when a locality receives more registrations in one of its days than its threshold (see [Operations](#daily-registrations-alert)).
- Still to come: the photo (EMR-40), the edit mode of the management link (EMR-43) and the event `registration-submitted` (EMR-45). Who reviews a registration arrives with the panel (epic F).

### Legal pages

The privacy notice (`/aviso-de-privacidad`) and the terms (`/terminos`) live at the site root and belong to no locality, so they name none; every page links to them from the footer. Their texts are data in `src/core/legal/`, the verbatim blocks of [the legal-pages spec](docs/specs/legal-pages.md), and `src/components/LegalDocument.astro` only renders them. Both pages are prerendered when the site is built (`export const prerender = true`) and written as `aviso-de-privacidad.html` and `terminos.html` (`build.format: "file"`), which Cloudflare serves as static assets at their address without a trailing slash, without running the Worker. They never read the database: the build of a deployed environment gives its Hyperdrive bindings an address where nothing answers (`astro.config.mjs`), so a prerendered page that tried would fail the build.

The notice has a version, `NOTICE_VERSION` in `src/core/legal/version.ts`, the only place it is written: the page shows it ("Versión 2 · Última actualización: …"), and the seed and the registration form read it from there. The version identifies three pieces, the full notice, the simplified notice of the form and the literal of its consent checkbox, plus the draft mark while it is published. `test/scripts/notice-version.test.ts` fingerprints them with SHA-256 and fails when their text changes without a new version:

- The fingerprint covers what a person reads, as data (`versionedNoticeContent`): every heading, paragraph, list item and link with its destination, in order, with whitespace collapsed. Reformatting the code or changing the markup or the styles does not change it; changing a word, the order of the blocks or a link does. `test/astro/legal-pages.test.ts` checks that each page publishes exactly that content, and `test/scripts/legal-texts.test.ts` that the modules match the spec's verbatim blocks.
- To change the notice, change the spec's block and `src/core/legal/` together, raise `NOTICE_VERSION` and add a row to `FINGERPRINTS` in the guard with the fingerprint its failure prints. Never edit the row of a published version: it is the evidence of the text the consent records that cite it were given against. Filling in a placeholder or removing the draft mark changes the notice too. The terms are not versioned.
- The data that only a person can give (the responsible party's name and address, the directory's WhatsApp, the publication date and the jurisdiction) are visible placeholders in square brackets, listed once in `PENDING_PLACEHOLDERS` (`src/core/legal/placeholders.ts`); while one is left, both pages show the draft mark. Next to them, `OPERATIONAL_PENDING_ITEMS` lists, for the legal review (EMR-58) and the launch checklist, what the notice promises that the system does not do yet, or what the system does that it does not mention. The pages never publish it.

Until the cut-over the deployed environments keep these pages out of search engines too. The Worker never sees a request for a static asset, so after each build `src/integrations/static-headers.ts` reads the environment the build targets (`dist/server/wrangler.json`) and writes to `dist/client/_headers`, which Cloudflare applies only to static assets: the security headers for every static asset, in every environment (see [Security headers](#security-headers)), and, when the environment blocks indexing (`blocksIndexing` in `src/lib/robots.ts`, the same rule as the Worker), `X-Robots-Tag: noindex`. A local build adds no noindex, and the pages themselves ask search engines for nothing: once the cut-over lets production be indexed, they are indexable.

### Listings

One route, `src/pages/[state]/[municipality]/[segment].astro`, serves the pages of a locality that are one catalogue slug: the listing of a category (`/hidalgo/tizayuca/servicios-del-hogar`), the page of a trade (`/hidalgo/tizayuca/plomeria`) and the page of a trade in a zone (`/hidalgo/tizayuca/plomeria-haciendas-de-tizayuca`). Astro prefers the site's static routes (`negocio/…`, and `buscar`, `registro`… as they land), whose first segments are `RESERVED_SEGMENTS`. `src/core/business/listing-page.ts` decides everything, through the cached `HYPERDRIVE`:

- The segment is read with `readSegment` (`src/core/catalogue/root-urls.ts`, `src/core/catalogue/pages.ts`): first a category, then a trade, then a trade and a zone of the locality, only when it reads as exactly one pair. Anything else, and a segment that is not a slug (capitals, accents), answers the site's 404.
- Only published cards of the locality, most recently published first, then by name (`src/core/business/listing.ts`), as listing cards (`src/components/BusinessList.astro`), with the heading, title and description of `src/core/seo/listing.ts`. A trade page heads with the trade's curated phrase, and a zone whose name already says the locality's is not followed by it ("Plomería en Haciendas de Tizayuca").
- The zone navigation (`src/components/ZoneNav.astro`) offers, in catalogue order, only the zones with published cards of the page: on a category listing each is the listing with `?colonia=<zona>`, whose canonical is the listing without it; on a trade page each is its trade and zone page. A `colonia` that is not a zone of the locality is ignored.
- A zone is shown with its display name, from `zoneDisplayNames` (`src/core/catalogue/zone-names.ts`): its name, followed by its settlement type in sentence case when another zone of the locality, hidden ones included, or the locality itself has the same name, ignoring case and accents ("El Carmen (Fraccionamiento)", "Tizayuca (Zona industrial)"). It is decided from the data, so no name is listed in the code, and slugs never change. A page reads the names with `localityZoneNames` (`src/core/catalogue/pages.ts`) and applies them with `withZoneName`: the listing cards, the zone navigation, a trade and zone page's texts and the card page.
- A trade or trade and zone page without published cards answers 200 with its empty state, `<meta name="robots" content="noindex, follow">` and no canonical (`noindex` of `BaseLayout`), and nothing links to it. The empty states of a category, a trade and a trade in a zone offer "Registra tu negocio gratis", the primary action, to the registration page of the locality; a category filtered by a zone offers "Ver todas las colonias" alone.
- 20 cards a page (`PAGE_SIZE`, `src/core/pagination.ts`): page n is `?pagina=n` from 2 on, "Ver más" (`src/components/MoreLink.astro`) leads to the next, and any other `pagina` or a page past the last answers 404. Each page after the first is its own canonical, with its `pagina`; the sitemap lists only the first.

### Search engines and share previews

| Environment            | `/robots.txt`                                                                                                                                                 | `X-Robots-Tag` |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| `local`                | Open: disallows `/admin` and, under each active locality, `/buscar`, `/negocio/*/reportar`, `/reportar/gracias` and `/registro/gracias`; names `/sitemap.xml` | none           |
| `dev`, `stage`, `prod` | Closed (`Disallow: /`) until the cut-over, which turns production into the open one                                                                           | `noindex`      |

- `/robots.txt` (`src/pages/robots.txt.ts`, `src/lib/robots.ts`) reads the active localities only when it is open. The exclusions of a locality are `LOCALITY_DISALLOW`; the edit mode is never named.
- `/sitemap.xml` (`src/pages/sitemap.xml.ts`, `src/core/seo/sitemap.ts`) is generated from the database on every request, through the cached `HYPERDRIVE`, with absolute URLs from `SITE_URL`. Today it lists, for every active locality, its home, its registration page, the listings of the 8 categories, even when empty, the trade pages and trade and zone pages with at least one published card, and the published cards, each at its current URL with its publication date; and the two legal pages. A list appears by its first page only. Each indexable page of a locality adds its kind to `LOCALITY_PAGES` when it lands; nothing else lists pages. In a deployed environment without a usable `SITE_URL` it is an empty sitemap. `test/e2e/seo.spec.ts` requests every URL it lists and fails on anything but a 200.
- Every page renders inside `BaseLayout`, which writes the title, the description, `og:title`, `og:description` and the share image. A page that may be indexed passes its own path as `canonicalPath`, and the layout declares its absolute canonical URL and `og:url` with `absoluteUrl`; a 404 or the panel passes none. A page that answers but must not be indexed passes `noindex`: the layout writes `<meta name="robots" content="noindex, follow">` and no canonical.
- The share image is one static 1200×630 PNG per locality, `src/assets/share/{estado}/{municipio}.png`, found by the slugs of the locality (`src/lib/share-image.ts`); the build serves it, hashed, under `/_astro/`. A locality without one, and every page outside a locality, shares `src/assets/share/enmirumbo.png`, the wordmark alone. To add a locality's image, add its file; no code changes. A card with a photo shares its photo instead, 1200×900 WebP from the media hostname (see [Photos](#photos)).

The images were made once, on 2026-10-15, without any tool kept in the repository: an HTML page of 1200×630 with the design tokens of `src/styles/global.css` (background `background`, a 72px band of `surface` with a 2px top border of `line` at the bottom) and the system font stack, with the wordmark "enmirumbo" centred in `ink`, bold, 168px, letter spacing -0.025em, and below it, 28px apart, the line "Tizayuca, Hidalgo" in `ink-muted`, weight 500, 60px; the generic image has no second line. Playwright's Chromium (`vp exec playwright install chromium`) rendered it on macOS with a 1200×630 viewport and a device scale factor of 1, and the screenshot was saved as PNG. A new locality's image follows the same recipe with its own "{municipio}, {estado}".

### Measurement

Umami Cloud measures production only ([ADR 0014](docs/adr/0014-analytics-with-umami-cloud.md)), cookieless and without a banner. The only configuration is `UMAMI_WEBSITE_ID`, the Website ID of the site at Umami Cloud, in `env.prod.vars` of `wrangler.jsonc`: it is not a secret (it travels in every measured page) and changing it takes a release. It is empty everywhere until the launch, so no page loads a script and no request leaves the site. With a Website ID, every page of production except the panel (`/admin` and below) and the edit mode (`/{estado}/{municipio}/editar/` and below) loads `https://cloud.umami.is/script.js`, deferred, with `data-exclude-search="true"` (`src/lib/analytics.ts`); a value elsewhere, or one that is not a Website ID, loads nothing and is logged once. The content security policy then allows Umami's script and collectors, and only then.

The three events are `ANALYTICS_EVENTS` in `src/lib/analytics.ts`: `whatsapp-listing`, `whatsapp-card` and `registration-submitted` (ADR 0014, amended on 2026-10-15). An element declares one with `eventAttributes`, which gives the locality (`{estado}/{municipio}`) and the category slug as its only properties, and nothing while the measurement is off. The WhatsApp button of the listing card declares `whatsapp-listing` and "Enviar WhatsApp" on a card `whatsapp-card`, each with the business's own category; the card's other buttons declare no event. The two stay apart because most contacts may start from a listing, while the card's clicks over its views are a metric of their own. A card view is the page view Umami records by itself. A search with no results is not an event either: its page view carries the tag `search-no-results` (`ANALYTICS_TAGS`), which `BaseLayout` writes as the `data-tag` of the script when a page passes it as `analyticsTag`. To read it, filter the page views of `/{estado}/{municipio}/buscar` by that tag in Umami and compare them with all the views of that page. Before taking the PRD's metrics as good, check in Umami's panel that bot filtering is on.

## Database

PostgreSQL 18 runs in Docker for development and tests (`compose.yaml`; user, password and database are all `enmirumbo`, port 5432). The first start also creates a second database, `enmirumbo_test`, that `vp test` uses, so tests never touch development data.

```sh
vp run db:up        # start PostgreSQL and wait until it is healthy
vp run db:migrate   # apply the migrations in drizzle/ to the development database
vp run db:seed      # insert the fictitious businesses (safe to run again)
```

| Task                 | What it does                                                                                       |
| -------------------- | -------------------------------------------------------------------------------------------------- |
| `vp run db:up`       | Starts PostgreSQL 18 in Docker.                                                                    |
| `vp run db:down`     | Stops it. Data stays in the `enmirumbo-postgres-data` volume; `docker compose down -v` deletes it. |
| `vp run db:generate` | Generates a migration from `src/core/db/schema/`. Add `--custom --name=<name>` for plain SQL.      |
| `vp run db:migrate`  | Applies the migrations to `DATABASE_URL` (default: the local development database).                |
| `vp run db:seed`     | Inserts the fictitious businesses. See [Fictitious seed](#fictitious-seed).                        |
| `vp run db:check`    | Migration guard: fails on destructive SQL without a marker. `vp run check:all` runs it too.        |

- `DATABASE_URL` is a direct connection string used by Drizzle Kit, the seed and the test setup. A database that is not on this machine must use `sslmode=verify-full`; anything else is refused.
- The Worker reaches the database through two Hyperdrive bindings, both pointing at the local database in `wrangler.jsonc` (`localConnectionString`). Each deployed environment has its own pair (see [Deployment](#deployment)). `HYPERDRIVE` is cached and only for public reads; `HYPERDRIVE_FRESH` is for everything else. `withDb` in `src/core/db/client.ts` opens a client per request and closes it with `ctx.waitUntil`.
- `vp test` applies the migrations to `DATABASE_URL`, or to `enmirumbo_test` when it is unset, then runs the workers tests against that database. CI provides PostgreSQL 18 on `localhost:5432` and sets `DATABASE_URL`.
- Migrations are additive only. A destructive statement (`DROP`, `RENAME`, `ALTER ... TYPE`, `SET NOT NULL`, `TRUNCATE`) is allowed only in a file that carries the line `-- destructive-ok: <reason>`, and lands in its own pull request, one version after the code stopped using the column or table.
- The first migration enables the `pg_trgm` and `unaccent` extensions.
- The search (`src/core/search/`) matches the normalized name and "¿Qué ofreces?" of each business (`name_normalized` and `what_you_offer_normalized`, with trigram indexes) and the names of its trades. The database generates those two columns with the SQL function `search_normalize`, so no code writes them; `normalizeText` (`src/core/search/normalize.ts`) normalizes what a resident types the same way. The public search, like every public page, reads through the cached `HYPERDRIVE`: a change made in the panel can take up to a minute to show.
- The data model lives in `src/core/db/schema/` ([data-model spec](docs/specs/data-model.md)): the states and municipalities of the localities the directory serves, those localities, their zones, the global categories and trades, businesses and their trades, pending edits, reports and the admin audit log. Every relation to a business deletes with it, so a permanent deletion leaves nothing behind; the tests fail when one does not, and when the schema changes without its migration.
- Reference data that every environment needs, production included, ships as data migrations, never as seeds: the permission catalogue and the base roles, the state of Hidalgo and the municipality of Tizayuca (see [INEGI catalogue](#inegi-catalogue)), Tizayuca's locality, inactive (see [Panel users and roles](#panel-users-and-roles)), the coordinates of its municipal seat, its zones from SEPOMEX, and the [categories and trades](#categories-and-trades). `vp run db:migrate` alone leaves a database ready to use; the only seed is the [fictitious one](#fictitious-seed).

### INEGI catalogue

The directory serves only Tizayuca, and the database holds only its reference data: the state of Hidalgo (`13`), the municipality of Tizayuca (`13069`), its locality, the coordinates of its municipal seat and its zones ([ADR 0006](docs/adr/0006-locality-data-model-inegi-sepomex.md), amended on 2026-10-15). Cities are added one at a time, on purpose, each with its reference data in its own data migration. How the data of a new city is prepared is decided when one is needed, so the repository keeps no script for INEGI's or SEPOMEX's catalogues. The migrations are the record of where Tizayuca's data came from; the source files are not kept in the repository.

`drizzle/0003_inegi_catalogue.sql` loaded INEGI's complete catalogues of states and municipalities from the [Catálogo Único de Claves de Áreas Geoestadísticas Estatales, Municipales y Localidades](https://www.inegi.org.mx/app/ageeml/), fecha de corte 2026-06, downloaded on 2026-10-14, with Tizayuca's locality. It is applied in every environment and never changes; `drizzle/0010_tizayuca_only.sql` removes every state and municipality that no locality uses, which leaves Hidalgo and Tizayuca. INEGI's [terms of free use](https://www.inegi.org.mx/inegi/terminos.html) ask for this credit, which the migration carries:

> Fuente: INEGI, Catálogo Único de Claves de Áreas Geoestadísticas Estatales, Municipales y Localidades, fecha de corte 2026-06.

The codes and names are INEGI's, unchanged. The slugs are ours, and INEGI does not endorse this product.

The coordinates of Tizayuca's municipal seat, INEGI's locality `130690001` (Tizayuca), place the locality for the suggestion of the nearest one at the root. `drizzle/0009_tizayuca_coordinates.sql` sets them, written by hand from the record of INEGI's web service of the same catalogue, [`wscatgeo/v2/localidades/13/069/U`](https://gaia.inegi.org.mx/wscatgeo/v2/localidades/13/069/U), periodo 2015-06-01, consulted on 2026-10-14: latitude 19.8410889, longitude -98.9815842, INEGI's decimal degrees unchanged. The complete catalogue of localities ([`catun_localidad.zip`](https://www.inegi.org.mx/contenidos/app/ageeml/catun_localidad.zip), generated on 2025-01-14, SHA-256 `927609ed…`) gives the same point, 19°50´27.920 N, 098°58´53.703 W. The migration carries the credit:

> Fuente: INEGI, Catálogo Único de Claves de Áreas Geoestadísticas Estatales, Municipales y Localidades, servicio web wscatgeo v2, localidad 130690001 (periodo 2015-06-01), consultado el 2026-10-14.

The columns are optional (`localities.latitude` and `localities.longitude`, both or neither, within range); another locality's seat ships with that locality's reference data.

### SEPOMEX zones

The zones of Tizayuca are its 105 settlements (fraccionamientos, colonias, barrios, pueblos, ranchos, unidades habitacionales, a ranchería and a zona industrial) in SEPOMEX's [Catálogo Nacional de Códigos Postales](https://www.correosdemexico.gob.mx/SSLServicios/ConsultaCP/CodigoPostal_Exportar.aspx), which Correos de México publishes for download by state or for the whole country. `drizzle/0006_tizayuca_zones.sql` was written from the file of Hidalgo in TXT format (`Hidalgo.txt`, SHA-256 `f0f804a6c554755de076bac3803d0d5f25a86f7b585241d6f554f57a75b08609`), whose last update the page gives as 2026-10-13, downloaded on 2026-10-14, by a script the repository no longer keeps. The migration cites the source:

> Fuente: Servicio Postal Mexicano (Correos de México), Catálogo Nacional de Códigos Postales, última actualización 2026-10-13.

The names and settlement types are SEPOMEX's; the slugs are ours, and SEPOMEX does not endorse this product. Postal codes are not stored. Every zone starts visible; the admin hides or renames zones in the panel, and a renamed zone keeps its slug.

- The migration holds the data; SEPOMEX's file is not kept in the repository. The tests check what it leaves in the database (`test/worker/zones.test.ts`), including the cross-check against the prototype's 21 colonias: 15 are in SEPOMEX with the same name, 5 with another (El Pedregal, Olmos, Tepojaco, Geo Villas, and "Tizayuca" for the Zona Industrial), and Real Toledo is missing.
- Every name is as SEPOMEX writes it, with its spaces trimmed and collapsed and the text garbled by its encoding fixed; settlements whose names differ only in case, accents or spacing are one zone. Four names that SEPOMEX lists with two settlement types, El Carmen, El Chopo, El Manantial and Tizayuca, are two zones each, and their slugs carry the type (`colonia-el-carmen`, `fraccionamiento-el-carmen`, …). The public pages show them, and any zone whose name repeats in its locality or is the locality's, with the type in brackets ("El Carmen (Fraccionamiento)", "Tizayuca (Zona industrial)"); see [Listings](#listings).
- The migration is applied and never changes: zones that SEPOMEX adds later ship in a new data migration. Run `vp test` after writing one: the [URL check](#categories-and-trades) fails when a new zone makes a URL of its locality read in two ways.

### Categories and trades

The 8 categories and the 49 trades are global: every locality shares them. Their names are copy, as the prototype's PRD writes them (§6.1 and Appendix B), and `drizzle/0007_categories_trades.sql` holds them, written by hand because it is a short fixed list with no source file to read. Their slugs follow the slug rule of the states, municipalities and zones ([data-model spec](docs/specs/data-model.md)), which the tests write down in `test/worker/slug.ts`, and never change: a new category or trade ships in a new data migration. `test/worker/catalogues.test.ts` checks every name and slug.

Under `/{estado}/{municipio}/`, one path segment is a category (`servicios-del-hogar`), a trade (`plomeria`) or a trade and a zone joined by a hyphen (`plomeria-haciendas-de-tizayuca`), next to the site's own pages. `rootUrlConflicts` (`src/core/catalogue/root-urls.ts`) lists the segments of a locality that read in more than one way, naming every reading, and `test/worker/root-urls.test.ts` runs it on the migrated database for every locality with zones. The site's own segments are `RESERVED_SEGMENTS`, in the same file: a new page of a locality whose first segment is not a catalogue slug adds it there.

### Fictitious seed

`vp run db:seed` (`src/core/db/seed/`) inserts fourteen fake businesses in Tizayuca: published cards in seven categories (the eighth, "Otro", stays empty) and several zones, one in review and one rejected, with the cases the directory, the search and the panel need. Their names say they are made up, their numbers are of the `771999xxxx` series and their references point nowhere. Two cards of "Salud", the farmacia and the dentista, have a photo, which the seed draws when it runs (see [Photos](#photos)); the rest have none. The command prints that the data is fake.

- It inserts only what is missing and never changes a row that is already there. Each fake business has a fixed identifier; one whose identifier, or whose WhatsApp in Tizayuca, is already taken is left out, and trades are added only to the businesses it inserts. Running it again changes nothing.
- While Tizayuca has no contact WhatsApp, it sets the fake one, `7719990100`, and turns the locality on, so the seeded directory can be seen. A number someone set, and the active flag next to it, are never touched.
- It runs on every deploy to `dev` and `stage`, never on `prod`: with `ENVIRONMENT=prod` it seeds nothing, and against a database that is not on this machine it needs `ENVIRONMENT=dev` or `ENVIRONMENT=stage`.
- Its photos go to the local media bucket, which `vp run dev` and `vp run preview` serve under `/_media/`. With `ENVIRONMENT=dev` or `stage` they go instead to the directory `SEED_MEDIA_DIR`, which the deploy uploads to the media bucket of `dev` and `stage` (`scripts/deploy/upload-seed-media.sh`); without that variable the seed refuses to run there.

## Deployment

Three deployed environments ([ADR 0008](docs/adr/0008-environments-and-deployment-flow.md)), each a Wrangler environment in `wrangler.jsonc` with its own Worker, bindings and variables. The top level of `wrangler.jsonc` is the local Worker, `enmirumbo-local`, which is never deployed.

| Environment | Worker            | URL                                       | Deployed by                                         | Database (Neon branch)    | Cron Trigger |
| ----------- | ----------------- | ----------------------------------------- | --------------------------------------------------- | ------------------------- | ------------ |
| `dev`       | `dev-enmirumbo`   | https://dev-enmirumbo.urekz.workers.dev   | `deploy-dev.yml`, by hand from any branch           | `dev`, reset from `stage` | none         |
| `stage`     | `stage-enmirumbo` | https://stage-enmirumbo.urekz.workers.dev | `deploy-stage.yml`, on every push to `main`         | `stage`                   | hourly       |
| `prod`      | `enmirumbo`       | https://enmirumbo.urekz.workers.dev       | `deploy-prod.yml`, on a tag `vX.Y.Z` (with Release) | `prod`                    | hourly       |

Every deployed environment answers with `X-Robots-Tag: noindex` and a closed `robots.txt` until the cut-over, production included: the Worker adds the header to its responses, and the `_headers` file of the build to the static assets (see [Legal pages](#legal-pages)). Version and Preview URLs are off, so `/admin` is reachable only through Access.

Each workflow checks the ref, builds for its environment, checks the generated configuration (a real Turnstile site key and `TURNSTILE_SECRET_KEY` in `secrets.required` among the rest) and the `_headers` file of the static assets, which must give every one of them noindex and the security headers (`scripts/deploy/check-build.sh`), applies the migrations, seeds (not on `prod`) and uploads the seed's photos (`scripts/deploy/upload-seed-media.sh`), deploys with the project's Wrangler and the Worker secrets (`scripts/deploy/deploy-worker.sh`, see [Secrets](#secrets)) and runs a smoke test (`scripts/deploy/smoke-test.sh`): the home answers 200, following its redirects within https, with `X-Robots-Tag: noindex` and the security headers; so does `/aviso-de-privacidad`, a prerendered page served without the Worker; and `robots.txt` is closed. The dev workflow first resets the Neon `dev` branch from `stage` (`scripts/deploy/reset-neon-dev.sh`), so anything stored in dev is lost on each deploy. Each step receives only the secrets it needs from the GitHub Environment of the same name (see [Secrets](#secrets)). To deploy a branch to dev: Actions, "Deploy dev", "Run workflow", pick the branch. To release: push a tag `vX.Y.Z` from `main`.

The build fixes the environment: `CLOUDFLARE_ENV=<env> vp run build` writes `dist/server/wrangler.json` for that environment only, and `wrangler deploy` refuses to deploy it to another one. Never run `wrangler deploy` by hand.

Worker variables:

| Variable             | What it is                                                                                                                                           |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ENVIRONMENT`        | `local`, `dev`, `stage` or `prod`. Any other value, or none, closes `/admin` and asks not to index.                                                  |
| `ACCESS_TEAM_DOMAIN` | The Access team domain, `urekz.cloudflareaccess.com`.                                                                                                |
| `ACCESS_AUD`         | The AUD tag of the `enmirumbo admin` Access application. While it is empty, `/admin` answers 403.                                                    |
| `SITE_URL`           | The public URL of the environment, without a trailing slash: the base of every absolute URL.                                                         |
| `MEDIA_URL`          | The https origin of the environment's media hostname (ADR 0011), allowed by the CSP. Empty locally.                                                  |
| `UMAMI_WEBSITE_ID`   | `prod` only: the Website ID of Umami Cloud. Empty until the launch, so nothing is measured.                                                          |
| `TURNSTILE_SITE_KEY` | The public site key of the Turnstile widget: `enmirumbo` on `prod`, `enmirumbo-dev` on `dev` and `stage`, Cloudflare's always-pass test key locally. |
| `DEPLOY_BRANCH`      | `dev` only: the branch deployed, set by `deploy-dev.yml` and shown in the page footer.                                                               |
| `DEPLOY_COMMIT`      | `dev` only: the commit deployed, set by `deploy-dev.yml` and shown in the page footer.                                                               |

The prerendered legal pages are built before the deploy sets `DEPLOY_BRANCH` and `DEPLOY_COMMIT`, so on `dev` their footer does not name the branch.

Besides the Hyperdrive bindings, each environment binds `QUOTA_COUNTER`, the Durable Object of the per-IP quotas, and declares its class `QuotaCounter` in `exports` (see [Per-IP quotas](#per-ip-quotas)); Cloudflare creates its namespace on the first deploy of each environment, with nothing to set up by hand. The deploy stops before changing anything if the build lacks either. Each environment also binds `MEDIA`, its public media bucket, which must exist before its first deploy (see [Photos](#photos)); the deploy stops if the build binds another bucket or `MEDIA_URL` is not an https origin.

The Hyperdrive configurations hold the database credentials and are created by hand, two per environment: `enmirumbo-<env>` (cached) and `enmirumbo-<env>-fresh` (caching disabled), both on the direct (non-pooled) host of that environment's Neon branch. Their ids go in `wrangler.jsonc`; while an id is a placeholder, the deploy of that environment stops before changing anything.

### Photos

Business photos live in a public media bucket of R2 ([ADR 0011](docs/adr/0011-photos-in-r2-transformed-on-upload.md), amended): a bucket of public content that people or the admin upload, organized by prefix, never anything private (the backups have their own). Cloudflare serves it from the media hostname, a custom domain of the bucket, without the Worker. Production has its own bucket; `dev` and `stage` share one, because a binding or an R2 token cannot be limited to a prefix (so nothing deployed from a branch can reach production's photos), and because `dev` copies `stage`'s database, whose cards must point at photos that exist.

| Environment       | Bucket (binding `MEDIA`) | `MEDIA_URL`                             | Later                             |
| ----------------- | ------------------------ | --------------------------------------- | --------------------------------- |
| `local`           | `enmirumbo-media-local`  | empty: served under `/_media/`          |                                   |
| `dev` and `stage` | `enmirumbo-media-dev`    | `https://media-dev-enmirumbo.urekz.com` | `https://media-dev.enmirumbo.com` |
| `prod`            | `enmirumbo-media`        | `https://media-enmirumbo.urekz.com`     | `https://media.enmirumbo.com`     |

The hostnames live under `urekz.com` until `enmirumbo.com` is on Cloudflare (EMR-63); moving them is a change of `MEDIA_URL` and of the custom domains, never of code. They are one level below their zone, as the [naming rule](AGENTS.md) asks, so Cloudflare's free Universal SSL certificate covers them.

- A business stores one photo key, 24 random characters of the identifier alphabet (`newPhotoKey`, `src/core/photos/photo.ts`). Its photo is two WebP objects: `photos/<key>/card.webp`, 400×400, for the listing card, and `photos/<key>/full.webp`, 1200×900, for the card, its share preview and its Schema.org block. Each carries `Cache-Control: public, max-age=31536000, immutable`: a key never changes its bytes, so browsers and Cloudflare's cache keep it for a year.
- Pages build a photo's address only through `src/lib/media.ts`, from `MEDIA_URL` and a stored key of a published card; a stored value that is not exactly a key the server generates is no photo, and the listing card shows its placeholder. The listing card shows the `card` variant with its size, and only the first card of a list loads it at once; the card shows the `full` one above its name. A deployed environment without an https `MEDIA_URL` shows no photo and logs it once.
- Locally `MEDIA_URL` is empty: the local Worker (`src/worker.ts`) serves Miniflare's local bucket, in `.wrangler/state`, at `/_media/<object key>`, only with `ENVIRONMENT` `local` and on `localhost`. `vp run db:seed` and the end-to-end setup write the seed's photos there, so `vp run dev` and `vp run preview` show them. To start again without them, delete `.wrangler/state`.
- The seed draws its photos when it runs (`src/core/db/seed/photos.ts`): a coloured rectangle with the made-up name and "FOTO DE MENTIRA", as lossless WebP from a small encoder in plain TypeScript (`src/core/db/seed/webp.ts`), so there is no image file in the repository and no native dependency. Each fake business with a photo has a fixed key, so every run writes the same objects.
- On the deploys to `dev` and `stage`, the seed writes its photos with a manifest to `SEED_MEDIA_DIR`, and the next step uploads them to `enmirumbo-media-dev` through R2's S3 API with `MEDIA_R2_ACCESS_KEY_ID` and `MEDIA_R2_SECRET_ACCESS_KEY`, an R2 token that can read and write that bucket only; that step has no database secret, and the seed's step has no R2 token. Nothing is seeded in production.

Set up once, by hand, before the first deploy that binds `MEDIA` (a deploy fails while its bucket does not exist, and the merge to `main` deploys `stage`):

1. In the Cloudflare dashboard of the account that holds the `urekz.com` zone: R2 object storage, Overview, Create bucket. Name `enmirumbo-media`, location Automatic, default storage class Standard, Create bucket. Repeat for `enmirumbo-media-dev`.
2. In `enmirumbo-media`: Settings, Custom Domains, Add, `media-enmirumbo.urekz.com`, Continue, Connect Domain. Wait until its status is Active. In `enmirumbo-media-dev`, the same with `media-dev-enmirumbo.urekz.com`.
3. In each bucket: Settings, Public Development URL. It must say it is disabled; if it is enabled, Disable, type `disallow`, Disallow.
4. In the `urekz.com` zone: Caching, Configuration, Browser Cache TTL must be "Respect Existing Headers" (the default), so the objects' year of caching reaches browsers. Optionally, Caching, Tiered Cache, Smart Tiered Cache, as R2 recommends; it applies to the whole zone.
5. R2 object storage, Overview, API Tokens (Manage), Create Account API Token. Name `enmirumbo-media-dev-seed`, permission Object Read & Write, Specify bucket(s): Apply to specific buckets only, `enmirumbo-media-dev`, TTL Forever, Create API Token. Copy the Access Key ID and the Secret Access Key, and keep them in the password manager.
6. In GitHub: Settings, Environments, `dev`, Environment secrets, Add environment secret: `MEDIA_R2_ACCESS_KEY_ID` with the Access Key ID, then `MEDIA_R2_SECRET_ACCESS_KEY` with the Secret Access Key. Repeat in `stage` with the same two values.
7. Deploy `dev` (Actions, "Deploy dev", Run workflow). Wrangler does not call the R2 API to deploy, and Cloudflare checks the binding when the Worker is uploaded, so the deploy tokens need no new permission. If a deploy fails with an authentication error about an R2 bucket, edit that environment's `CLOUDFLARE_API_TOKEN` and add Workers R2 Storage Bucket Item Read on its bucket only (`enmirumbo-media` for `prod`, `enmirumbo-media-dev` for `dev` and `stage`).
8. Check the media hostname of `dev` and `stage`: the first request must answer 200 with `content-type: image/webp` and the cache header, a second one `cf-cache-status: HIT`, and the root 404:

```sh
url=https://media-dev-enmirumbo.urekz.com/photos/yya626vdevvbuxa5avc2n8e6/card.webp
curl -sI "$url" | grep -iE '^(HTTP|content-type|cache-control|cf-cache-status)'
curl -sI "$url" | grep -i '^cf-cache-status'
curl -s -o /dev/null -w '%{http_code}\n' https://media-dev-enmirumbo.urekz.com/
```

Production's hostname answers 404 to everything until the registration uploads the first photo.

### Security headers

Every response, in every environment, carries the headers of `src/lib/security-headers.ts`: the Worker adds them to its own (`src/worker.ts`), and the build writes them for the static assets in `_headers` (`src/integrations/static-headers.ts`). A response that already declares one keeps its value.

| Header                    | Value                                                                                                             |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `Content-Security-Policy` | See below.                                                                                                        |
| `X-Content-Type-Options`  | `nosniff`                                                                                                         |
| `X-Frame-Options`         | `DENY`                                                                                                            |
| `Referrer-Policy`         | `strict-origin-when-cross-origin`; `strict-origin` on the panel, whose paths can point to a person's registration |

The content security policy of production without a Website ID (each directive on its own line here; the header is one line separated by `; `):

```text
default-src 'self'
script-src 'self' https://challenges.cloudflare.com
style-src 'self'
img-src 'self' https://media-enmirumbo.urekz.com
connect-src 'self'
frame-src https://challenges.cloudflare.com
frame-ancestors 'none'
object-src 'none'
base-uri 'none'
form-action 'self'
```

`img-src` takes the `MEDIA_URL` of the environment (none locally, where the photos come from the site itself). Turnstile needs only `https://challenges.cloudflare.com` in `script-src` and `frame-src` ([Cloudflare's reference](https://developers.cloudflare.com/turnstile/reference/content-security-policy/)): its styles live in its own frame, so `style-src` stays `'self'`, and `connect-src` would need `'self'` only for pre-clearance, which the widgets do not use. With a Website ID, production adds `https://cloud.umami.is` to `script-src`, and `https://gateway.umami.is https://cloud.umami.is` to `connect-src`. On the panel, `form-action` also allows `https://urekz.cloudflareaccess.com`, where Access sends a submission whose session expired. No inline script or style is allowed, so the build keeps every stylesheet and script in a file (`build.inlineStylesheets: "never"` and `assetsInlineLimit: 0` in `astro.config.mjs`), and no page may carry a `style` attribute or an `is:inline` script of its own. The one exception is a card's Schema.org block, `<script type="application/ld+json">`: a data block that the browser never runs, so the policy does not apply to it. `vp run dev` leaves the policy out, because Vite's development pages need inline styles; `vp run preview` and every build send it.

To read the headers of a deployed environment, for a page of the Worker and for a static asset:

```sh
for path in /hidalgo/tizayuca /aviso-de-privacidad; do
  curl -sI "https://stage-enmirumbo.urekz.workers.dev${path}" |
    grep -iE '^(content-security-policy|x-content-type-options|x-frame-options|referrer-policy|x-robots-tag):'
done
```

Both must print the four security headers with the values above, with that environment's media hostname in `img-src`, and `X-Robots-Tag: noindex`.

## Secrets

Every secret lives in the GitHub Environments of this repository, `dev`, `stage` and `prod`, plus `backup` for the nightly backup ([ADR 0020](docs/adr/0020-secrets-in-github-environments.md)): Settings > Environments. A secret reaches only the jobs that declare its environment; `prod` releases its secrets only to tags `v*`, and `stage` and `backup` only to `main`. GitHub masks their values in the logs and never shows them again, so the originals stay in each provider and in the custodian's password manager.

| Secret                       | Environments                     | What it is                                                                                                                                                                |
| ---------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`       | `dev`, `stage`, `prod`           | An account API token with the Editor role on that environment's Worker only.                                                                                              |
| `CLOUDFLARE_ACCOUNT_ID`      | `dev`, `stage`, `prod`, `backup` | The Cloudflare account id.                                                                                                                                                |
| `DATABASE_URL`               | `dev`, `stage`, `prod`, `backup` | The direct (non-pooled) connection string of that environment's Neon branch, `sslmode=verify-full`. In `backup`, production's, for the read-only role `enmirumbo_backup`. |
| `NEON_API_KEY`               | `dev`                            | A Neon project-scoped API key, to reset the `dev` branch from `stage`.                                                                                                    |
| `NEON_PROJECT_ID`            | `dev`                            | The Neon project id.                                                                                                                                                      |
| `MEDIA_R2_ACCESS_KEY_ID`     | `dev`, `stage`                   | The Access Key ID of the R2 token `enmirumbo-media-dev-seed`, with Object Read & Write on `enmirumbo-media-dev` only (the same token in both).                            |
| `MEDIA_R2_SECRET_ACCESS_KEY` | `dev`, `stage`                   | The Secret Access Key of that token.                                                                                                                                      |
| `R2_ACCESS_KEY_ID`           | `backup`                         | The Access Key ID of an R2 token with Object Read & Write on `enmirumbo-backups` only.                                                                                    |
| `R2_SECRET_ACCESS_KEY`       | `backup`                         | The Secret Access Key of that token.                                                                                                                                      |
| `TURNSTILE_SECRET_KEY`       | `dev`, `stage`, `prod`           | A Worker secret: the secret key of the Turnstile widget of the environment, `enmirumbo` in `prod` and `enmirumbo-dev` in `dev` and `stage` (the same value in both).      |

The Worker secrets are declared by name in `secrets.required` at the top level and in each Wrangler environment of `wrangler.jsonc`, today `TURNSTILE_SECRET_KEY`; the per-IP quotas need none, since their key lives only in the memory of the Durable Object. Their values live in the GitHub Environments. The Deploy step of each workflow gets them through its own `env:` and runs `scripts/deploy/deploy-worker.sh`, which stops if one is missing, writes them to a file in the runner's temporary directory that only its owner can read, deploys with `wrangler deploy --secrets-file` and removes the file. A new Worker secret goes in `secrets.required`, in the GitHub Environments and in the `env:` of the three Deploy steps. Changing a secret takes a new deploy of that environment. Locally no real secret is needed; a `.dev.vars` file, ignored by git, holds any local value.

## Operations

### Availability check

`monitor.yml` requests the home page of production and `/health` at minutes 7 and 37 of every hour ([ADR 0016](docs/adr/0016-ci-cd-monitoring-and-backups.md)). `/health` answers 200 `ok` only when the Worker reaches the database (`SELECT 1` through `HYPERDRIVE_FRESH`), and 503 `unavailable` otherwise. Each check is tried three times, 20 seconds apart, before the run fails, and the run names every check that failed. GitHub emails a failed run to the person who last changed the workflow's schedule.

When it fails: open the run to see which check failed, look at the live logs of the `enmirumbo` Worker in the Cloudflare dashboard (the health route logs why the database did not answer), and at the `prod` branch in the Neon console. To check again by hand: Actions, "Monitor prod", "Run workflow".

Every check wakes production's Neon compute, which then stays up about five minutes: up to about 30 of the 100 compute-unit hours a month of Neon's free plan.

### Backups

`backup.yml` runs every night at 03:23 Mexico City time, from `main`, with the secrets of the `backup` environment. It dumps production with `pg_dump` 18 in the custom format, as the read-only role `enmirumbo_backup`, checks that the dump reads back and holds table data, and uploads it to the private R2 bucket `enmirumbo-backups` as `prod/enmirumbo-<UTC date and time>.dump`. The run summary names the object with its size and SHA-256, which is also stored in the object's metadata. To take a backup by hand: Actions, "Backup prod", "Run workflow".

The bucket has no public hostname. Its lifecycle rule deletes each dump after 30 days, and its bucket lock keeps each dump at least that long, so nobody can delete or overwrite one earlier, not even the backup's token. The R2 token has Object Read & Write on that bucket only.

`enmirumbo_backup` exists only on the production branch. It was created once in the Neon SQL Editor, as the role that runs the migrations (`enmirumbodb_owner`), so the default privileges cover every table and sequence the migrations add to `public` and `drizzle`. A new schema needs the same grants, or the backup fails:

```sql
CREATE ROLE enmirumbo_backup WITH LOGIN PASSWORD '<generated password>';
GRANT USAGE ON SCHEMA public, drizzle TO enmirumbo_backup;
GRANT SELECT ON ALL TABLES IN SCHEMA public, drizzle TO enmirumbo_backup;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public, drizzle TO enmirumbo_backup;
ALTER DEFAULT PRIVILEGES IN SCHEMA public, drizzle GRANT SELECT ON TABLES TO enmirumbo_backup;
ALTER DEFAULT PRIVILEGES IN SCHEMA public, drizzle GRANT SELECT ON SEQUENCES TO enmirumbo_backup;
```

### Panel users and roles

Cloudflare Access lets in the emails on its policy; what each person may do comes from the database ([ADR 0021](docs/adr/0021-panel-users-roles-and-permissions.md)): `users`, `roles` with their `permissions`, and `role_assignments`, global or per locality. The migrations create the permission catalogue and the roles `super_admin` and `locality_admin`. Super admins manage users, roles and assignments from the panel. To add or remove a person, change both the Access policy and their user.

The first super admin of each environment is created by hand in the Neon SQL Editor, on that environment's branch:

```sql
INSERT INTO users (email, name) VALUES ('<email on the Access policy, lowercase>', '<name>');
INSERT INTO role_assignments (user_id, role_id, role_scope)
SELECT u.id, r.id, r.scope FROM users u, roles r
WHERE u.email = '<the same email>' AND r.key = 'super_admin';
```

A locality is served only with its contact WhatsApp, the number "Perdí mi enlace" opens. The migrations create Tizayuca's locality inactive and without one. Until the panel can do it, a super admin sets the number and the active flag in `localities`, in the Neon SQL Editor of each environment:

```sql
UPDATE localities SET contact_whatsapp = '<ten digits>', active = true WHERE code = '13069';
```

On `dev` and `stage`, the [fictitious seed](#fictitious-seed) sets a fake number and turns Tizayuca on while no number is set; this statement replaces it, and the seed leaves it alone from then on.

### Turnstile's switch

Turnstile is on by default on the registration form, and later the edit form ([ADR 0012](docs/adr/0012-abuse-controls-quotas-and-turnstile.md)). It fails closed: when Cloudflare's challenge or siteverify is down, or Turnstile turns away legitimate people, nobody can register until it is turned off. The switch is the column `turnstile_enabled` of the one row of `site_settings`. To turn it off, or on again, run in the Neon SQL Editor of the environment's branch:

```sql
UPDATE site_settings SET turnstile_enabled = false;  -- off
UPDATE site_settings SET turnstile_enabled = true;   -- on again
```

No deploy is needed. The action reads the switch fresh, so it accepts submissions without a token at once; the form page reads it through the cached `HYPERDRIVE`, so it stops showing the widget within a minute (during that minute a person whose widget cannot load waits; turned back on, a form shown without the widget is refused once and comes back with it). With the switch off the trap field and the per-IP quota keep working. The panel will change it later (epic F).

### Daily registrations alert

The hourly job counts, for each active locality, the registrations of its local day (new and resubmitted cards, organic, in the locality's time zone) and alerts once a day when they pass the locality's `daily_registration_threshold`, 20 by default. It blocks nobody. Until the email to the admin arrives (EMR-55), the alert is only a warning in the Worker log, `registration: the daily registrations of a locality passed its threshold`, with the fields `alert: "daily-registrations"`, `locality` (its INEGI code), `day`, `registrations` and `threshold`: look for it in the live logs of the Worker in the Cloudflare dashboard. The day of the last alert is kept in `daily_registration_alerted_on`, so the later runs of the day do not repeat it. To change the threshold of a locality, or turn its alert off with `NULL`, in the Neon SQL Editor:

```sql
UPDATE localities SET daily_registration_threshold = 30 WHERE code = '13069';
```

### Restore

In an incident, first use Neon's instant restore of the `prod` branch (Neon console, Branches, `prod`, Restore), which reaches 6 hours back on the free plan. For anything older, restore a dump. The steps below restore into `dev`, which is how the procedure is rehearsed; the next "Deploy dev" resets `dev` from `stage` again.

1. Download the dump: Cloudflare dashboard, R2, `enmirumbo-backups`, `prod/`, the object, Download. The dashboard saves it with `_` in place of `/`, as `prod_enmirumbo-<UTC date and time>.dump`; that is the `<file>` of the next steps. Compare `shasum -a 256 <file>` with the SHA-256 of its run summary.
2. Copy the direct connection string of the target branch from the Neon console (Connect, connection pooling off) and change `sslmode=require` to `sslmode=verify-full`. Keep it out of the shell history: run `read -rs TARGET_DATABASE_URL && export TARGET_DATABASE_URL`, paste it and press Enter.
3. Restore it with the PostgreSQL 18 client of the `postgres:18` image, from the folder that holds the dump, which the container sees as `/backup`. The image has no certificate authorities, so the machine's are mounted (`/etc/ssl/cert.pem` on macOS, `/etc/ssl/certs/ca-certificates.crt` on Debian and Ubuntu). It runs in a single transaction: on any error nothing changes.

   ```sh
   docker run --rm -e TARGET_DATABASE_URL -e PGSSLROOTCERT=/certs/ca.pem \
     -v /etc/ssl/cert.pem:/certs/ca.pem:ro -v "$PWD:/backup:ro" postgres:18 \
     sh -c 'pg_restore --clean --if-exists --no-owner --no-acl --single-transaction --exit-on-error --dbname "$TARGET_DATABASE_URL" /backup/<file>'
   ```

4. Check it: the migrations the dump knew are there.

   ```sh
   docker run --rm -e TARGET_DATABASE_URL -e PGSSLROOTCERT=/certs/ca.pem \
     -v /etc/ssl/cert.pem:/certs/ca.pem:ro postgres:18 \
     sh -c 'psql "$TARGET_DATABASE_URL" -c "SELECT count(*) FROM drizzle.__drizzle_migrations"'
   ```

5. On `dev`, run "Deploy dev" afterwards. On `prod`, take a backup by hand first, so the broken state is kept too, then restore and run the availability check.
