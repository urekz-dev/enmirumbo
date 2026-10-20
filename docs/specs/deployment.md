# Spec: deployment

What the system guarantees so that putting the site into production means setting variables and pressing a button: a single database dialect, what the CI tests, the build, configuration that cannot go missing silently, where photos live, the commands that write to the database, the scheduled tasks that run on their own, the headers on every response, the single deployment document, and how production is watched and backed up.

## Requirements

### Requirement: A single database dialect in all environments

Superseded in v2 by A single database dialect in all environments (v2) — source: ADR 0005, ADR 0019.

The system MUST use the same database engine —PostgreSQL, the one ADR-004 recommends for production— in development, in testing, in continuous integration and in production. There MUST be a single Prisma schema and a single migration tree; the project MUST NOT maintain parallel migrations per dialect. The local database MUST be able to start with a single documented command, with no accounts or paid services, and the same migration tree that is applied locally MUST be the one applied in production.

#### Scenario: local database from a fresh clone

- **WHEN** someone clones the repository, copies `.env.example` to `.env`, starts the local database with the documented command and applies the migrations
- **THEN** they get a PostgreSQL database with all the model's tables, and `npm run db:seed` leaves it with the three catalogues populated (8 categories, 21 zones, 49 trades)

#### Scenario: the same tree in production

- **WHEN** the migrations are applied to the empty production database
- **THEN** exactly the same migration tree as locally is applied, with no manual steps or separately written SQL, and the resulting schema is the same

#### Scenario: there are not two dialects to maintain

- **WHEN** the project is reviewed
- **THEN** there is a single Prisma schema, a single migrations directory and its declared dialect is PostgreSQL; no file in the project declares a different dialect

### Requirement: The CI tests the migrations and the suite against an ephemeral Postgres

Every Pull Request MUST be exercised against a PostgreSQL database created from scratch for that run: apply all the migrations in order, run the catalogue seed and run the whole test suite against it. A migration that does not apply, a seed that fails or a test that depends on a quirk of another dialect MUST fail the PR. The CI MUST NOT use anyone else's database or keep data between runs.

#### Scenario: PR with a migration that does not apply in the production dialect

- **WHEN** a PR adds a migration with SQL that PostgreSQL does not accept
- **THEN** the CI fails at the migrations step and the PR cannot be merged

#### Scenario: the suite runs against the production-equivalent database

- **WHEN** the CI runs the tests
- **THEN** all of them run against the run's ephemeral Postgres, including those for the search, the directory and the admin panel

#### Scenario: clean database on every run

- **WHEN** the same workflows are run twice in a row
- **THEN** the second run starts with an empty database and gives the same result as the first

### Requirement: The production build does not need the database

`next build` MUST complete with no database reachable: no page MUST query the database at build time. Every route that reads the database MUST be rendered per request. The CI MUST build with no database reachable, so that a new route that breaks this rule fails the PR instead of being discovered on the first deploy.

#### Scenario: build without a database

- **WHEN** the production build is run with no database available or reachable
- **THEN** it finishes successfully and does not try to connect

#### Scenario: a new route that reads the database at build time

- **WHEN** someone adds a page that queries the database and is not rendered per request
- **THEN** the automatic check flags it and the PR fails

### Requirement: In production no required configuration goes missing silently

When a variable is missing without which the system cannot fulfil its function, the system MUST say so —in the server log at startup and, where applicable, on the affected screen— and MUST NEVER replace it with a development value. In particular: with no database address configured in production the system MUST NOT fall back to the default local database, and with no `SITIO_URL` in production no screen MUST build links to `localhost`. The same criterion applies to the scheduled tasks' secret and to photo storage, whose own consequences are stated in their requirements. Outside production the default local values are kept, so that a fresh clone starts without configuring anything.

#### Scenario: production without a database address

- **WHEN** the system starts in production without `DATABASE_URL`
- **THEN** it records the problem with the name of the missing variable and does not connect to any default local database

#### Scenario: production without `SITIO_URL`

- **WHEN** the system starts in production without `SITIO_URL`
- **THEN** it records the problem in the server log, and the admin panel visibly warns that it cannot build the card link instead of sending a `localhost` to a real business

#### Scenario: development without configuring anything

- **WHEN** someone starts the project locally with the local database up and with no variables beyond those in the example
- **THEN** the site works with the development defaults and does not demand production configuration

#### Scenario: the warning is not repeated per request

- **WHEN** many pages are requested with incomplete configuration
- **THEN** the warning appears only once per process in the log, not once per request

### Requirement: No database connection leaves the machine unencrypted

When the database address points to a host that is not the machine where the process runs, the connection MUST be encrypted. The system MUST NOT open a cleartext connection to a remote server: it MUST fail visibly and say in the log what is missing, with the same criterion it uses for `SITIO_URL` and `DATABASE_URL`. No message MUST include the database password. The deployment document MUST NOT contain any unencrypted remote example value, and the automatic check MUST fail if one appears.

To decide whether the address is local or remote, the system MUST resolve the host **as the driver resolves it**, not by reading the URL by eye: a connection string can carry parameters that change the real destination. An address that cannot be interpreted safely MUST be treated as remote.

#### Scenario: remote address without encryption

- **WHEN** the system starts pointing to a database that is not on this machine and the address does not ask for TLS
- **THEN** it opens no connection, says so in the log naming what is missing, and the message does not include the database password

#### Scenario: the address disguised as local

- **WHEN** an address says `localhost` in the visible part but the driver would connect to another host
- **THEN** the system treats it as remote: it requires encryption and the commands that write in bulk to the database ask for explicit permission

#### Scenario: the local database does not need encryption

- **WHEN** the address points to the machine where the process runs
- **THEN** TLS is not required, because the bytes do not leave the machine

### Requirement: Commands that write to the database recognize the real environment

The commands that write in bulk to the database (demo seed and search backfill) MUST recognize a dangerous environment: "local database" means a database on the machine of whoever runs the command —the same effective-host criterion that requires encryption—, not a prefix or a piece of text of the address. In production —detected by `NODE_ENV` or by `VERCEL_ENV`— the demo seed MUST NOT seed anything, not even with explicit permission. Against a remote database that is not production, it MUST require explicit permission. Each command MUST say why it did nothing.

#### Scenario: demo seed in the hosting's production environment

- **WHEN** an attempt is made to run the demo seed with `VERCEL_ENV=production`
- **THEN** it seeds nothing and says so

#### Scenario: demo seed pointing to a remote database

- **WHEN** an attempt is made to run the demo seed with the address of a remote database and without the explicit permission
- **THEN** it seeds nothing and explains that the address is not a local database and that the risk must be accepted by hand

#### Scenario: demo seed against the local database

- **WHEN** the demo seed is run against the local development PostgreSQL database
- **THEN** it seeds the fictitious businesses and warns that what it seeded is fake data

### Requirement: Business photos live in the provider's storage, not on the hosting disk

Superseded in v2 by Business photos live in R2, with one bucket and one hostname per environment (v2) — source: ADR 0011.

The system MUST store and serve business photos through a single port, with a production adapter that uses the file storage of the same provider as the database (Supabase Storage, ADR-006 + ADR-004) and NOT the hosting's file system, which is ephemeral. The development adapter (local file system) MUST exist and MUST be the one used on the machine of whoever is developing when there is no provider configuration.

The permanent deletion of a business (ARCO, PRD §8) and the 90-day purge MUST take the files of the configured store with them, whichever it is. The orphan-photo sweep MUST ask the same port what is stored, and NOT the file system: a sweep that looks elsewhere reports success without having checked anything.

A half-done provider configuration —with only one of its two mandatory variables— MUST NOT use the provider and MUST be left in the log; what is done instead is decided by the requirement "Without photo storage configured, a deployment does not silently fall back to disk". `docs/despliegue.md` MUST contain the variables, the human step of creating the **private** bucket and why it has to be private.

#### Scenario: the photo is stored and served from the provider's storage

- **WHEN** the system runs with the provider's storage configured and a business uploads a photo
- **THEN** the files end up in that storage and the published card shows them, without depending on the disk of the instance that handled the upload

#### Scenario: ARCO deletion takes the files with it

- **WHEN** a business that had a photo is permanently deleted
- **THEN** its files disappear from the provider's storage, not just from one instance's disk

#### Scenario: the sweep looks where the photos are

- **WHEN** the orphan sweep runs with the provider's storage configured
- **THEN** it checks what is there; and if the store answers empty while the database has cards that say they have a photo, it does NOT report success: it warns that it is looking at the wrong store

#### Scenario: half-done configuration

- **WHEN** the system starts with only one of the provider's two mandatory variables
- **THEN** it does not use the provider and records in the log which variable is missing and that without it the photos would not survive a deployment

#### Scenario: no account needed in development

- **WHEN** someone clones the project and configures nothing of the provider
- **THEN** the photos go to the usual local directory and everything works the same

### Requirement: Without photo storage configured, a deployment does not silently fall back to disk

When the system runs deployed —the hosting says it is production, or the database is not on the machine that runs it— and there is no usable photo storage configuration, the system MUST NOT use the local file system. It MUST say so in the log at startup, naming the missing variables, and MUST fail visibly when trying to store a photo.

A registration WITHOUT a photo MUST keep working normally. A submission WITH a photo MUST NOT be left half-done: the system MUST NOT create a card that promises an image that was not written, so it MUST return the form with the photo error message that already exists ("No pudimos preparar tu foto. Intenta con otra."), with no card saved and no stray files.

The orphan sweep MUST distinguish "there is nothing stored" from "I could not look": without configured storage it MUST NOT report success. The permanent deletion of a card with a photo in that state is governed by the requirement "Permanent deletion refuses to claim it deleted what it did not delete": from here it cannot be known whether the bucket was configured before and still holds that photo, so the attempt to delete the files MUST fail visibly instead of being taken as good.

Outside a deployment —the machine of whoever is developing— the local store is kept without configuring anything.

#### Scenario: deployed and not configured

- **WHEN** the system starts deployed without the storage variables
- **THEN** it records in the log naming the missing variables, and no photo is stored on the instance's disk

#### Scenario: registration with a photo does not leave a half-done card

- **WHEN** someone registers their business with a photo in that state
- **THEN** they see the form back with "No pudimos preparar tu foto. Intenta con otra.", no card from that submission is saved and no stray file remains, and the log says the photo could not be stored

#### Scenario: registration without a photo keeps working

- **WHEN** someone registers their business without a photo in that state
- **THEN** the registration is saved normally and they see the usual thank-you screen

#### Scenario: the sweep does not report success

- **WHEN** the scheduled sweep task runs in that state
- **THEN** it does not answer "nada que barrer": it answers with an error, so that the task scheduler records it

#### Scenario: development without configuring anything

- **WHEN** someone clones the project and starts it on their machine
- **THEN** the photos go to the usual local directory, with no warnings or configuration

### Requirement: Permanent deletion refuses to claim it deleted what it did not delete

When a business has a photo and the storage cannot be reached, the permanent deletion (ARCO, PRD §8) MUST NOT run: the row MUST NOT be touched and whoever requested it MUST receive a message saying that it was **not** deleted, why, and that it can be retried. The files MUST be attempted BEFORE the row, or in the same unit of work; NEVER the row first, because then the photo —personal data— stays alive with no row naming it, out of reach even of the orphan sweep.

The opposite risk —the files go and the row survives— is accepted in exchange: that card is left without a photo, which is repairable and visible.

A business WITHOUT a photo MUST be deleted normally even if the storage is down: there is nothing to reach, and refusing there would be failing to comply with the deletion because of a configuration that does not affect that card.

In the scheduled purge, a registration in that state MUST be counted as not purged —which makes the task answer with an error— and MUST be retried on the next run.

#### Scenario: the card has a photo and the storage does not respond

- **WHEN** the admin confirms the permanent deletion of a card with a photo and the storage cannot be reached
- **THEN** the card still exists complete, and the screen says it was not deleted, that the photo store could not be reached and to check the configuration and try again

#### Scenario: the card has no photo

- **WHEN** a card without a photo is permanently deleted and the storage is down
- **THEN** it is deleted normally: there was nothing to reach

#### Scenario: the order of the two operations

- **WHEN** a card with a photo is permanently deleted and everything works
- **THEN** the files are deleted before the row

#### Scenario: the scheduled purge facing the same state

- **WHEN** the daily purge finds a registration that has reached 90 days, has a photo, and the storage does not respond
- **THEN** that registration is not deleted, it is counted as not purged —the task answers with an error— and it keeps purging the others

### Requirement: The purge of rejected registrations fires on its own in production

Superseded in v2 by Scheduled work runs from one hourly Cron Trigger per environment (v2) — source: ADR 0013.

The deletion of rejected registrations at 90 days (PRD §8) MUST run without human intervention, through a scheduled task that runs at least once a day in production. The trigger MUST be an HTTP request to a route of the system itself that only acts if it carries the configured secret; with no secret configured, or with a secret that does not match, the route MUST behave as if it did not exist (404) and MUST NOT delete anything. The route MUST NOT be indexable and its response MUST be limited to counts, with no personal data. The mechanism MUST NOT depend on anything exclusive to the hosting: any task scheduler able to make a request with a header MUST be able to trigger it (ADR-007).

#### Scenario: the scheduled task runs

- **WHEN** the task scheduler calls the route with the correct secret
- **THEN** the system deletes the rejected registrations that have reached 90 days, answers with the counts of what it did and records it in the log with no one's names or numbers

#### Scenario: someone finds the route

- **WHEN** anyone requests that route without the secret, or with a wrong one
- **THEN** they receive the same 404 response as a nonexistent route and no registration is deleted

#### Scenario: no secret configured

- **WHEN** the system runs without the tasks secret configured
- **THEN** the route answers 404 to everyone and no purge runs

#### Scenario: declared schedule

- **WHEN** the deployment configuration is reviewed
- **THEN** the task is declared with its daily frequency and `docs/despliegue.md` explains how to trigger it from any other task scheduler if the hosting changes

### Requirement: The orphan-photo sweep also runs on its own, and it shows when it does not sweep

Superseded in v2 by The orphan-photo sweep is a task of the hourly job and a sweep that cannot finish is an error (v2) — source: ADR 0013.

The sweep of photos that no longer belong to any card —personal data that, without a card, falls outside the reach of ARCO deletion (PRD §8)— MUST run without human intervention, with a daily scheduled task, triggered like the purge: an HTTP request to the system itself with the configured secret, which without it answers 404 and does nothing.

When the sweep does NOT complete —because one of its safeguards stopped it—, the response MUST NOT be a success: it MUST carry an error code that the task scheduler records as a failure, and be left in the log as an error. The equivalent console command already says so with its exit code; a scheduled version that answered "all good" would leave orphan photos piling up without anyone noticing. The report MUST be counts only: no photo key appears in the response or in the log.

#### Scenario: normal sweep

- **WHEN** the scheduled task calls the route with the correct secret and the sweep completes
- **THEN** it answers with success and with the counts of what was checked and deleted, without any photo key

#### Scenario: a safeguard stops the sweep

- **WHEN** the sweep stops because it suspects it is pointing at the wrong database
- **THEN** the response is NOT a success, the reason is left in the log as an error and no file is deleted

#### Scenario: someone finds the route

- **WHEN** anyone requests that route without the secret, or with a wrong one
- **THEN** they receive the same 404 response as a nonexistent route and nothing is swept

### Requirement: The 404 of scheduled tasks does not give them away

When a scheduled task route answers as if it did not exist, its response MUST NOT carry any mark of its own —no body of its own, no content type of its own, no headers of its own— that would let it be told apart from the rest of the site's routes in an automated scan. It MUST be the empty 404 that the framework emits when an existing route decides that what was requested is not there, with nothing of its own on top.

The framework returns two different 404s: the full HTML page when the address matches no route, and that empty response. A scheduled route cannot emit the first —the framework does not expose a way to render that page from there—, so what is required is that it emit exactly the second. The other route of the system that emits this empty 404 is the one that serves the photos, and it also adds `cache-control: no-store`: that header is its own, and the tasks route MUST NOT copy it to look similar, because an extra header is precisely a mark of its own.

#### Scenario: a scanner looks for the task routes

- **WHEN** someone requests a task route without the secret, with a wrong secret or with a malformed authorization header
- **THEN** they receive the framework's empty 404 —no body, no content type and no header that the framework does not set—, indistinguishable from the 404 of any other route of the system that answers that what was requested does not exist

### Requirement: What is stored to count quotas is not kept forever

Superseded in v2 by Anti-abuse counters live in a Durable Object and never in PostgreSQL (v2) — source: ADR 0012.

The marks the system stores to enforce an anti-abuse limit MUST be deleted when they no longer serve for counting: they are data derived from third parties' IPs and keeping them without a purpose is what LFPDPPP art. 11 forbids. Deleting only those of the key that is queried again is NOT enough: the source that tries once and does not come back MUST be swept up by a daily scheduled task.

The store of those marks MUST also have a ROW CEILING, because the screen that writes them is public and anonymous: past the ceiling, the oldest MUST be pruned. The retention period MUST be longer than the window of the system's longest limit, so that the cleanup does not silently weaken a quota; the automatic check MUST verify it.

What the task reports MUST be counts, with no key or anyone's data.

#### Scenario: the mark nobody queries again

- **WHEN** a source spends a quota mark and never comes back, and then the daily scheduled task runs
- **THEN** that mark is no longer in the database

#### Scenario: the row ceiling

- **WHEN** the mark store exceeds its ceiling
- **THEN** the oldest are pruned until it is back at the ceiling, and the recent ones are kept

#### Scenario: the cleanup does not weaken any quota

- **WHEN** the retention period is reviewed against the windows of the limits in use
- **THEN** the period is longer than the longest window, so the cleanup never deletes a mark that still counts

### Requirement: Anti-abuse limits that protect credentials are counted in a shared store

Superseded in v2 by The admin panel is protected by Cloudflare Access with one-time email codes (v2), in `admin-review` — source: ADR 0010.

The limit on admin panel login attempts MUST be counted in a store shared by all instances of the system, not in each process's memory: on serverless hosting (ADR-007) an in-memory counter gives an attacker as many attempts as instances they manage to spin up. The check and the recording MUST be a single atomic operation.

What is stored MUST NOT be the IP address: it MUST be a derived value that cannot be reversed without a deployment secret, and it MUST be deleted as soon as it leaves the limit's window. If the shared store does not respond, the limit MUST keep operating with the in-memory counter and the system MUST say so in the log.

The deployment document MUST say, for each anti-abuse limit, whether it is shared between instances or not; it MUST NOT claim that they all operate the same way.

#### Scenario: the attempts survive the recycling of an instance

- **WHEN** the login attempts from a source are exhausted and the process loses its memory
- **THEN** the source remains blocked within the window

#### Scenario: no IP is left in the store

- **WHEN** what the system stored when counting attempts is reviewed
- **THEN** no IP address appears, but a value derived with the deployment secret

#### Scenario: the shared store does not respond

- **WHEN** the database is not available when counting an attempt
- **THEN** the limit keeps operating with that instance's in-memory count and the log records that it is weaker

#### Scenario: the document does not over-promise

- **WHEN** someone reads in the document what each limit protects
- **THEN** they find written which one is shared between instances and which are not, and what to do in the meantime

### Requirement: The per-business report cap holds up under simultaneous requests in the production dialect

The cap on unattended reports per business MUST be enforced even when simultaneous submissions arrive from different connections. The cap check and the write MUST happen inside the same transaction and be serialized per card; a conditional statement MUST NOT be enough, because PostgreSQL's default isolation level does not lock the rows that a `COUNT` reads.

#### Scenario: two simultaneous submissions with the cap at one

- **WHEN** two different connections try at the same time the report that would complete the cap
- **THEN** only one writes, the other receives the usual confirmation, and the business ends up exactly at the cap

### Requirement: The site declares where JavaScript may come from and where data may go

Superseded in v2 by Every response carries the security headers and the content security policy (v2) — source: ADR 0012, ADR 0014, ADR 0011.

The site MUST send a `Content-Security-Policy` header on all its responses. The policy MUST allow the analytics provider's script (`cloud.umami.is`) **and** submissions to its collector (`gateway.umami.is`), which are different domains, and MUST NOT allow any other external script origin. It MUST block framing of the site on other people's pages, plugins and form submission to another domain. `docs/despliegue.md` MUST contain the written policy and how to verify it against the already deployed site.

#### Scenario: analytics measurement works with the policy in place

- **WHEN** a public page is opened with analytics configured and the CSP active
- **THEN** the script loads from the provider's domain and its events reach its collector, without the browser blocking anything

#### Scenario: a script from another origin

- **WHEN** something tries to load JavaScript from a domain that is neither the site's nor the declared provider's
- **THEN** the browser blocks it

#### Scenario: the policy is verified against the site, not against the code

- **WHEN** the deployment document is followed after publishing
- **THEN** it finds the exact command to read the header of the online site and what it must say

### Requirement: Every site response carries the basic security headers

Superseded in v2 by Every response carries the security headers and the content security policy (v2) — source: ADR 0012, ADR 0014, ADR 0011.

In addition to the Content-Security-Policy, EVERY site response —dynamic, static and error— MUST carry: the instruction not to guess the content type (the site serves bytes uploaded by users), the one not to allow being framed in another page, and a referrer policy that does not leak the path to other domains. The site MUST NOT announce in every response which framework it uses.

A screen that needs a STRICTER referrer policy than the global one MUST be able to impose it, and the global one MUST NOT override it.

#### Scenario: any page of the site

- **WHEN** any address of the site is requested, whether or not it exists, whether dynamic or static
- **THEN** the response carries the security headers and carries none that announces the framework

#### Scenario: the admin panel keeps its strict policy

- **WHEN** a screen of the review panel is opened
- **THEN** its referrer policy remains the strict one that screen declares, not the global one, so that the address of a person's card does not leave as a referrer

### Requirement: A single document says how to deploy

The project MUST have a single document, `docs/despliegue.md`, that is enough to put the site into production without looking anything else up. It MUST contain: (a) the complete list of accumulated environment variables, each with what it is for, whether it is mandatory and its exact value when it has one —in particular `REGISTRO_ENCABEZADO_IP`, whose value on Vercel is `x-forwarded-for`—; (b) the order of operations of the deployment: set variables, apply migrations, seed the catalogues, verify; (c) the steps that only a person can do: create the hosting and database accounts, register the domain, configure DNS and confirm that automatic backups are active; (d) what is NEVER run against production (the demo business seed); and (e) a final smoke check with the screens to open. The variables that do not yet exist in the code because their ticket is pending MUST appear named as pending, with the ticket that will bring them, instead of being omitted.

#### Scenario: the human deploys following the document

- **WHEN** a person with the accounts already created follows the document from start to finish
- **THEN** the site ends up online with the database migrated and the catalogues populated, without having had to open the code to find out which variable is missing

#### Scenario: the IP header has an exact value, not a "depende"

- **WHEN** the document is searched for what to put in `REGISTRO_ENCABEZADO_IP`
- **THEN** it finds the literal value for Vercel (`x-forwarded-for`) and the warning that without that variable the limit on registrations per hour and the one on admin panel login attempts do not operate

#### Scenario: a new undocumented variable

- **WHEN** someone adds to the code the reading of an environment variable and does not document it
- **THEN** the automatic check flags it and the PR fails

#### Scenario: variables that a pending ticket will bring

- **WHEN** the document is searched for the configuration of a piece whose implementation does not exist yet
- **THEN** it finds the decision taken and the note that the variables are defined by the corresponding pending ticket, not a silent gap

### Requirement: Business photos live in R2, with one bucket and one hostname per environment (v2)

Superseded in v2 by Public media live in R2, in one bucket for production and one for dev and stage (v2) — source: decision of the product owner, 2026-10-18; ADR 0011 (amended on 2026-10-18).

Added in v2 — source: ADR 0011, PRD §6.8.

Photos MUST be stored in a Cloudflare R2 bucket and served from a dedicated hostname, with one bucket and one hostname per environment: `fotos.enmirumbo.com`, `fotos-stage.enmirumbo.com` and `fotos-dev.enmirumbo.com`. Each environment names its hostname, as an https origin, in its variable `PHOTOS_URL`, the only other origin the content security policy lets images come from; locally it is empty. Serving a photo MUST NOT invoke the Worker. The bucket MUST NOT be shared between environments, and the hostname MUST NOT list the bucket.

#### Scenario: per environment

- **WHEN** the configuration of `dev`, `stage` and production is read
- **THEN** each has its own bucket and its own photo hostname

#### Scenario: serving

- **WHEN** a photo of a published card is requested on its hostname
- **THEN** it is served by the CDN from the bucket, with no Worker invocation

### Requirement: The content security policy allows Turnstile as well as Umami (v2)

Added in v2 — source: PRD §6.7, ADR 0012. Amended on 2026-10-18 by EMR-42, which brings the widget: what Turnstile needs, checked against Cloudflare's "Content Security Policy" page for Turnstile, read on 2026-10-18.

The content security policy MUST allow the scripts of the analytics provider and of the Turnstile widget and no other external script origin. The directives about framing, plugins and forms stay.

Turnstile needs `https://challenges.cloudflare.com` in `script-src` and in `frame-src`, which the policy of "Every response carries the security headers and the content security policy (v2)" already has, and nothing else: `style-src` stays `'self'`, because the widget's styles live in its frame, a document of Cloudflare's under its own policy, and its script on the page writes no inline style the policy forbids; `connect-src` would need `'self'` only for Turnstile's pre-clearance mode, which the widgets of enmirumbo do not use. No nonce is needed: the page loads `api.js` from a bundled script of the site, never inline. Cloudflare's real script is checked under the policy by hand (`test/e2e/turnstile-real.spec.ts`, README); the end-to-end tests of every run answer Turnstile's origin with a local stand-in, so they need no network.

#### Scenario: Turnstile loads

- **WHEN** the registration page is opened with the policy active
- **THEN** the Turnstile widget loads without a violation, and gives its token

#### Scenario: nothing else

- **WHEN** a script from any other external origin is added to a page
- **THEN** the policy blocks it

### Requirement: Scheduled work runs from one hourly Cron Trigger per environment (v2)

Added in v2 — source: ADR 0013, PRD §4. Amended on 2026-10-18 by EMR-42, which brings the first task, the daily registrations alert (`business-registration`, "The daily registrations alert goes out once per local day (v2)"): every task runs at the time the trigger was scheduled for, so a repeated run decides the same. Amended on 2026-10-18 by EMR-48: one more task, the retry of the purges of the media hostname's cache ("A deleted photo is purged from the cache of the media hostname, and a purge that fails is retried every hour (v2)"), which runs every hour whatever the local hour.

`stage` and production MUST each have exactly one Cron Trigger that fires every hour, declared inside its environment block. The `scheduled` handler MUST run every task, and each task MUST decide by the local hour of each locality, using its IANA time zone, whether it is its turn (for example, the pending-items email at 8:00 local time). The tasks are: the daily email to the admin, the purge of rejected registrations at 90 days, the purge at 30 days of pending edits and never-verified registrations, the orphan-photo sweep, the alert of the daily registrations threshold and the retry of the purges of the media hostname's cache. Tasks MUST be idempotent and MUST log what they did and what they could not do, as counts only. `dev` has no trigger; a test-only route runs a task there.

#### Scenario: one trigger

- **WHEN** the configuration of the environments is read
- **THEN** `stage` and production have one hourly Cron Trigger each, and `dev` has none

#### Scenario: the local hour

- **WHEN** the hourly job fires at the hour that is 8:00 in the time zone of a locality
- **THEN** the daily email of that locality is sent, and it is not sent at the other hours

#### Scenario: another time zone

- **WHEN** a locality in another time zone is active
- **THEN** its tasks run at its own local hours with no change in the triggers

#### Scenario: idempotent

- **WHEN** the same hourly run is executed twice
- **THEN** the second changes nothing and does not fail

#### Scenario: a task that fails

- **WHEN** one task fails
- **THEN** the other tasks still run, the failure is logged as an error with counts only, and the run is reported as failed

### Requirement: The orphan-photo sweep is a task of the hourly job and a sweep that cannot finish is an error (v2)

Added in v2 — source: ADR 0013, ADR 0011.

The sweep MUST list the objects of the R2 bucket that no card references and delete them, as a task of the hourly job. It MUST ask the bucket what is stored, not any other place. When a safeguard stops the sweep, the run MUST be reported as an error in the log and as a failed run, never as a success. The report MUST hold counts only: no photo key MUST appear in it.

#### Scenario: an orphan

- **WHEN** the sweep runs with an object no card references
- **THEN** the object is deleted and the report counts it

#### Scenario: a referenced object

- **WHEN** the sweep runs with objects referenced by a card
- **THEN** they are kept

#### Scenario: the sweep stops

- **WHEN** a safeguard stops the sweep before it finishes
- **THEN** the run is reported as failed and logged as an error

#### Scenario: no keys in the report

- **WHEN** the report and the log of the sweep are read
- **THEN** they contain counts and no photo key

### Requirement: The daily email to the admin lists the pending items and what expires within seven days (v2)

Added in v2 — source: PRD §4, ADR 0013, ADR 0018, ADR 0021.

The hourly job MUST send, at 8:00 local time of each locality, an email through Resend from the `enmirumbo.com` domain to every active panel user who may review registrations in that locality (permission `businesses.review`, see `data-model`). It MUST list the pending items (registrations, edits and resubmissions waiting) and what the purges will delete within the next seven days. Non-production environments MUST send only to team mailboxes. The email MUST NOT be sent more than once a day per locality.

#### Scenario: the content

- **WHEN** the email of a locality is built with pending items and cards that expire in five days
- **THEN** it lists the pending items and the cards that will be purged within seven days

#### Scenario: once a day

- **WHEN** the hourly job fires at every hour of a day
- **THEN** one email per locality is sent that day

#### Scenario: non-production

- **WHEN** the email is sent from `stage` or `dev`
- **THEN** its recipients are only team mailboxes

### Requirement: Anti-abuse counters live in a Durable Object and never in PostgreSQL (v2)

Added in v2 — source: ADR 0012, PRD §7. Amended on 2026-10-15 by EMR-36, which brings the first quota (the search): how the counters keep the privacy notice true, how the address is read and what happens when the counter fails. Until then it said only "with a secret per environment" about the key. Amended on 2026-10-15 by EMR-71 (ADR 0012, amended): one object for every purpose instead of one per purpose, and the rules that bound its cost.

The per-IP quotas of registration, edits, reports, search and SMS MUST be kept in one Durable Object keyed by an HMAC of the IP and the purpose, with a secret per environment. The IP MUST be used only in memory and for less than one hour. Each counter MUST be deleted when its window ends. No IP, and no value derived from it, MUST be written to PostgreSQL.

The privacy notice says the IP is turned into a code with a secret key and that "ese código vive solo en su memoria y por menos de una hora" (`legal-pages`, "The privacy notice states how the IP address is used (v2)"), so the counters MUST live in the memory of the Durable Object and never in its storage, the database or a log:

- **One object for every purpose.** The binding `QUOTA_COUNTER` reaches the class `QuotaCounter`, declared with SQLite storage in `exports` (every new Durable Object must be), at the top level and in each environment of `wrangler.jsonc`. Every purpose reaches the same instance, whose name is a constant (`QUOTA_COUNTER_NAME`): never an object per visitor, address, user or purpose. The purpose is part of the code of each counter, so each purpose counts apart, with its own limit and window, at most an hour. The purposes are a fixed list, each named as a literal by the page or the action that takes it, never built from a request. A purpose arrives with the surface it protects.
- **The key.** The secret is an HMAC-SHA-256 key that the object generates in its memory when it starts, cannot export and never writes anywhere: a different secret per environment, and per instance, that no person handles and no deploy needs. The code of an address is the HMAC of the purpose and the address, so neither can be read back from it, and the counters are keyed by it.
- **The window.** A window is fixed: it starts with the first request of an address and ends after the quota's window. A timer deletes each counter when its window ends; while a counter is pending, the timer also keeps the object in memory. A restart of the object (a deploy, a failure, an eviction once it holds no counter) makes a new key and forgets every counter: a quota can only forget, never block more. Past 100,000 counters, of every purpose together, the oldest is forgotten to make room, so a flood of addresses cannot exhaust its memory.
- **A bounded cost.** A Durable Object is billed for the time it stays in memory unable to hibernate, and a pending timer keeps it from hibernating, so the object MUST keep to these rules, and an automatic check MUST read the code and the configuration for each of them: it never uses its storage (`ctx.storage`) and sets no alarm (`setAlarm`, an `alarm()` handler); it has one timer, which exists only while it holds at least one counter, is set at most 10 minutes ahead (`MAX_TIMER_MS`, under the 15 minutes for which a pending timer keeps a Durable Object from being evicted), and is never set again once no counter remains, until a request brings a new one; and `preview_urls` is `false` at the top level and in every environment of `wrangler.jsonc`, written in each. With one object, the most it can be in memory is all the time: about 11,000 GB-s a day, under the 13,000 GB-s a day of Workers Free, and about 332,000 GB-s in a month of 30 days, inside the 400,000 GB-s a month that Workers Paid includes (ADR 0012, amended on 2026-10-15).
- **The address.** It is the one Cloudflare writes in `CF-Connecting-IP`, which a visitor cannot set. An IPv6 address counts by its /64, which a home or a phone receives whole. A request without an address, and one from a loopback address (only possible on the developer's machine, where Miniflare gives one to every request), is not counted.
- **Failure.** When the object cannot answer, the request goes on as if within its quota, and the log says the counter did not answer, without the address.

#### Scenario: the key

- **WHEN** two different purposes count requests from the same IP
- **THEN** each has its own counter, and neither key contains the IP in clear

#### Scenario: the end of the window

- **WHEN** the window of a counter ends
- **THEN** the counter is deleted

#### Scenario: nothing in the database

- **WHEN** the database schema and its data are reviewed after quotas are exhausted
- **THEN** no column or row holds an IP or a value derived from it

#### Scenario: nothing in the storage of the Durable Object

- **WHEN** the storage of the object is read after it has counted requests of the search and the reports
- **THEN** it holds nothing and no alarm is set: the counters and the key are only in its memory

#### Scenario: one object for every purpose

- **WHEN** requests of every purpose arrive from several addresses
- **THEN** each reaches the one object named `QUOTA_COUNTER_NAME`, which keeps a counter apart for each purpose and address

#### Scenario: a purpose outside the list

- **WHEN** the object is asked to count a purpose that is not in the list
- **THEN** it refuses, and keeps no counter and no timer for it

#### Scenario: a timer never set far ahead

- **WHEN** the object counts a report, whose window ends an hour later
- **THEN** its timer is set at most 10 minutes ahead, and set again when it fires while a counter remains

#### Scenario: no timer without a counter

- **WHEN** the last counter of the object is deleted, or a timer fires with no counter left
- **THEN** the object holds no timer and sets none until a request brings a new counter

#### Scenario: the rules are checked

- **WHEN** a change reaches the quota counter by a name other than `QUOTA_COUNTER_NAME`, takes a purpose that is not a literal of the list, uses the storage of the object, sets an alarm or an interval, sets a timer outside its one schedule, or leaves `preview_urls` other than `false` anywhere in `wrangler.jsonc`
- **THEN** an automatic check fails, naming the file and the line, or the environment, where it found it

#### Scenario: a restart

- **WHEN** the object restarts while an address is over its quota
- **THEN** the address may search again: the restart forgot its counter

#### Scenario: one IPv6 network

- **WHEN** two addresses of the same IPv6 /64 search
- **THEN** they share one counter, while an address of another /64 has its own

### Requirement: Three deployed environments, each with its own Worker, bindings and variables (v2)

Added in v2 — source: ADR 0008, ADR 0005, ADR 0010. Amended on 2026-10-15 by EMR-36: the binding of the quota counter and its `exports` entry. Amended on 2026-10-18 by EMR-35 and the decision of the product owner of that date: the `MEDIA` binding of the public media bucket, and `MEDIA_URL`, which replaces `PHOTOS_URL` and which `dev` and `stage` share. Amended on 2026-10-18 by EMR-42: the variable `TURNSTILE_SITE_KEY` and the first Worker secret, `TURNSTILE_SECRET_KEY`. Amended on 2026-10-18 by EMR-40: the `IMAGES` binding of Cloudflare Images, which transforms the uploaded photos (`business-registration`, "Photos are uploaded through the Images binding, within a ceiling of work (v2)"). Amended on 2026-10-18 by EMR-48: the Worker secrets `MEDIA_ZONE_ID` and `MEDIA_CACHE_PURGE_TOKEN`, which purge a deleted photo from the cache of the media hostname ("A deleted photo is purged from the cache of the media hostname, and a purge that fails is retried every hour (v2)").

The Worker configuration (`wrangler.jsonc`) MUST declare the deployed environments `dev`, `stage` and `prod` inside `env`, and each MUST declare for itself, without relying on the top level: its Worker name (`dev-enmirumbo`, `stage-enmirumbo` and `enmirumbo`), the `workers.dev` URL on, Version and Preview URLs off (`preview_urls: false`, so no URL can bypass Access), its `HYPERDRIVE` (cached) and `HYPERDRIVE_FRESH` (caching disabled) bindings with ids of its own, the `QUOTA_COUNTER` binding of the quotas and the `exports` entry of its class `QuotaCounter` ("Anti-abuse counters live in a Durable Object and never in PostgreSQL (v2)"), the `MEDIA` binding of its public media bucket ("Public media live in R2, in one bucket for production and one for dev and stage (v2)"), the `IMAGES` binding of Cloudflare Images, never with `remote`, Workers Logs and traces off ("Workers Logs and traces stay off in every environment (v2)"), and the variables `ENVIRONMENT` (its own identifier), `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, `SITE_URL` (its `workers.dev` URL, `https://<worker>.urekz.workers.dev`, the base of every absolute URL), `MEDIA_URL` (its media hostname, the same for `dev` and `stage`), `UMAMI_WEBSITE_ID` (empty but in production, `base-layout`, "Cookieless measurement is loaded only in production and only when configured (v2)") and `TURNSTILE_SITE_KEY` (the public site key of its Turnstile widget: `enmirumbo` for `prod`, `enmirumbo-dev` for `dev` and `stage`, `business-registration`, "Turnstile is checked on the server, fails closed and has a switch in the database (v2)"); and, in `secrets.required`, the names of its Worker secrets, today `TURNSTILE_SECRET_KEY`, `MEDIA_ZONE_ID` and `MEDIA_CACHE_PURGE_TOKEN`, whose values live in the GitHub Environment of the same name and never in the configuration (ADR 0020). The Cron Trigger follows "Scheduled work runs from one hourly Cron Trigger per environment (v2)"; `dev` MUST declare an empty list, so a deploy also removes a trigger left on its Worker. No route or Custom Domain is declared until the DNS move. The top level is the local Worker (`enmirumbo-local`, `ENVIRONMENT` `local`, Cloudflare's always-pass Turnstile test site key, and the same three secrets required by name, which a fresh clone does not need to set) with the `workers.dev` URL and Version URLs off, so a deploy without an environment by mistake publishes nothing reachable. While the Access application does not exist, `ACCESS_AUD` is empty and the panel stays closed.

#### Scenario: per environment

- **WHEN** the configuration of `dev`, `stage` and `prod` is read as Wrangler resolves it
- **THEN** each has its Worker name, `workers_dev` on, `preview_urls` off, both Hyperdrive bindings with two ids that no other environment uses, the `QUOTA_COUNTER` binding with `QuotaCounter` declared in its own `exports`, the `MEDIA` binding of its media bucket, the `IMAGES` binding, the seven variables with its own `ENVIRONMENT` and `SITE_URL`, the `MEDIA_URL` of its media hostname and the real site key of its Turnstile widget, and `TURNSTILE_SECRET_KEY`, `MEDIA_ZONE_ID` and `MEDIA_CACHE_PURGE_TOKEN` in its own `secrets.required`

#### Scenario: nothing inherited

- **WHEN** a binding or a variable is added at the top level
- **THEN** a check fails until every environment declares it too

#### Scenario: the local Worker

- **WHEN** the top level is read
- **THEN** its name is `enmirumbo-local`, `ENVIRONMENT` is `local`, and the `workers.dev` URL, the Version URLs and the triggers are off

### Requirement: Each environment is built and deployed by its own workflow (v2)

Added in v2 — source: ADR 0008, ADR 0005, ADR 0016. Amended on 2026-10-15 by EMR-36: the check of the quota counter. Amended on 2026-10-18 by EMR-35: the check of the media bucket and `MEDIA_URL`, and the upload of the seed's photos on `dev` and `stage`. Amended on 2026-10-18 by EMR-42: the check of Turnstile's site key and secret, and the Worker secrets uploaded with the deploy (ADR 0020). Amended on 2026-10-18 by EMR-48: the check names every Worker secret the Worker reads, and the Deploy step passes the two of the media hostname's cache. Amended on 2026-10-19 (EMR-73): each deploy checks the catalogue URLs of its target database plus the pending migrations before applying them.

Every deploy MUST build for its target with `CLOUDFLARE_ENV=<env>` and deploy, with the project's Wrangler, the configuration that build generated; a build is never promoted between environments and the top-level Worker is never deployed. Before it changes anything —a database or Cloudflare— the workflow MUST check the ref and the generated configuration, and stop, naming every problem, when the ref is not one the environment accepts, the build targets another environment, its Worker name, variables, `workers.dev`, Version URLs or triggers are not the ones of that environment, `observability` is not Workers Logs and traces off with every key `false`, a Hyperdrive binding is missing, shares its id with the other, or still has a placeholder id, `QUOTA_COUNTER` is not bound to `QuotaCounter` or `exports` does not declare it as a Durable Object with SQLite storage, `MEDIA` is not bound to the media bucket of that environment (`enmirumbo-media` for `prod`, `enmirumbo-media-dev` for `dev` and `stage`) or `MEDIA_URL` is not an https origin, `TURNSTILE_SITE_KEY` is not a real Turnstile site key (`0x` and its characters: never a placeholder or one of Cloudflare's test keys) or `secrets.required` does not name each of `TURNSTILE_SECRET_KEY`, `MEDIA_ZONE_ID` and `MEDIA_CACHE_PURGE_TOKEN`, or the `_headers` file of its static assets does not give every one of them `X-Robots-Tag: noindex` (`base-layout`, "Deployed environments stay out of search engines until the cut-over (v2)") and the security headers ("Every response carries the security headers and the content security policy (v2)"). An empty `ACCESS_AUD` is only a warning.

The Worker secrets travel with the deploy (ADR 0020): the deploy step gets each secret the build names in `secrets.required` from the GitHub Environment, through its own `env:`, and MUST stop before deploying, naming them, when one is missing or empty, or when the build targets another environment. It writes them as JSON to a file of the runner's temporary directory that only its owner can read, takes them out of Wrangler's environment, deploys with `wrangler deploy --secrets-file` and removes the file however the deploy ends; no value is ever an argument or printed (`scripts/deploy/deploy-worker.sh`).

Before it applies the migrations, each workflow MUST run the catalogue URL check (`scripts/check-catalogue-urls.ts`; `data-model`, "The slugs of the catalogues do not produce ambiguous URLs at the root of a locality (v2)") with the same `DATABASE_URL` as the migration step, and stop, before applying anything, when it finds a conflict. A zone the admin added from the panel is data no migration carries, so the check covers the target database plus what the pending migrations would add: the script applies the pending migrations inside a transaction on that database, runs `rootUrlConflicts` on every locality with zones, and rolls the transaction back. It MUST leave the database unchanged whether it passes or fails, so everything it applies is rolled back however it ends; a migration that cannot run inside a transaction fails the check and the deploy. It prints the conflicting segments, their number of readings and the locality, and nothing else: never a card's data or a secret. The conflict stops the deploy, and the migrations do not run.

The build prerenders the legal pages in a local workerd with the bindings of its environment. The Hyperdrive bindings of a deployed environment have no local connection string, so the build gives them an address where nothing answers: no prerendered page reads the database ("The production build does not need the database"), and one that tried would fail the build. The deployed Worker never sees that address.

- `dev` (`deploy-dev.yml`): run by hand from any branch, never from a tag. It resets the Neon branch named `dev` to its parent `stage` and waits until Neon finishes, checks the catalogue URLs, applies the branch's migrations, runs the fictitious seed, uploads the seed's photos, deploys, and writes the branch and the commit to the run summary and to the page footer. The reset MUST touch only the branch named `dev`, and MUST refuse, without writing, unless there is exactly one branch named `dev` and one named `stage`, `dev` is not the default branch, its parent is `stage` and it has no children.
- `stage` (`deploy-stage.yml`): on every push to `main`, or by hand on `main`. It checks the catalogue URLs, applies the migrations, runs the fictitious seed, uploads the seed's photos and deploys.
- `prod` (`deploy-prod.yml`): on a tag `vX.Y.Z` (three numbers without leading zeros and nothing after them), or by hand on such a tag. It checks the catalogue URLs, applies the migrations without seeding, deploys, and then creates the GitHub Release of the tag with generated notes; only that job may write to the repository.

On `dev` and `stage` the seed draws its photos into a directory (`data-model`, "The demo seed draws its photos and writes them where its environment serves media (v2)"), and a step of its own uploads them to `enmirumbo-media-dev` through R2's S3 API with an R2 token that can read and write that bucket only. That step gets the token and no database secret; the seed's step gets the database and no token. The upload refuses production, a build of another environment and a build without its `MEDIA` binding, puts each object with its media type, its caching and its Content-MD5, and fails unless R2 then holds each object's size.

After each deploy a smoke test MUST request the site URL and fail unless the home answers 200, following its redirects only over https, with `X-Robots-Tag: noindex` and the security headers on the page the redirects end at, `/aviso-de-privacidad`, a prerendered page that Cloudflare serves without the Worker, answers 200 with `X-Robots-Tag: noindex` and the security headers, and `/robots.txt` closes the site, retrying for about a minute while the new version spreads. The home redirects while one locality is active (`public-directory`, "While there is one active locality, the root redirects to it (v2)"), as on `dev` and `stage` once the fictitious seed turns Tizayuca on. Two deploys of the same environment never run at the same time, and a running deploy is never cancelled.

#### Scenario: a conflicting catalogue URL before the migrations

- **WHEN** the target database, once its pending migrations are applied, has a segment that reads in more than one way, such as a zone the panel added whose slug a new category or trade takes
- **THEN** the workflow stops before the migrations, names the segment, its number of readings and its locality, and the database is left unchanged

#### Scenario: a placeholder Hyperdrive id

- **WHEN** the build of an environment still has a placeholder Hyperdrive id
- **THEN** the workflow stops before the migrations and the deploy, naming the binding and the environment

#### Scenario: a build for another environment

- **WHEN** the configuration was built for `dev` and the workflow deploys `stage`
- **THEN** the check names the target, the Worker name, `ENVIRONMENT` and the triggers that do not match, and nothing is deployed

#### Scenario: the wrong ref

- **WHEN** the production workflow runs on a branch or on a tag such as `v1.2.3-rc1`, the stage workflow on a branch other than `main`, or the dev workflow on a tag
- **THEN** it stops before building

#### Scenario: resetting dev

- **WHEN** the dev workflow runs
- **THEN** the branch named `dev` is restored from `stage`, the API key never appears in a command line or the log, and the workflow continues only after every Neon operation of the reset has finished

#### Scenario: a branch layout that is not the expected one

- **WHEN** `dev` is not a child of `stage`, is the default branch, has children, or there is not exactly one branch with each name
- **THEN** the reset sends no write to Neon and the workflow fails saying why

#### Scenario: the smoke test

- **WHEN** after a deploy the home, following its redirects over https, does not answer 200, the page it ends at does not carry `X-Robots-Tag: noindex` or a security header, `/aviso-de-privacidad` does not answer 200 with `X-Robots-Tag: noindex` and the security headers, or `/robots.txt` does not close the site
- **THEN** the workflow fails

#### Scenario: a build without its media bucket

- **WHEN** the configuration a build generated lacks the `MEDIA` binding, binds another environment's bucket (such as `dev` bound to `enmirumbo-media`), or has a `MEDIA_URL` that is not an https origin
- **THEN** the workflow stops before the migrations and the deploy, naming the binding or the variable and the environment

#### Scenario: the seed's photos

- **WHEN** the dev or stage workflow seeds
- **THEN** the seed's photos reach `enmirumbo-media-dev` with their media type and caching, the R2 token appears in no command line or log, and a failed upload fails the run before the deploy

#### Scenario: a Turnstile site key that is not a real one

- **WHEN** the configuration a build generated has a placeholder, an empty value or one of Cloudflare's test keys as `TURNSTILE_SITE_KEY`, or does not require `TURNSTILE_SECRET_KEY`
- **THEN** the workflow stops before the migrations and the deploy, naming the variable or the secret and the environment

#### Scenario: a Worker secret

- **WHEN** a deploy runs with `TURNSTILE_SECRET_KEY`, `MEDIA_ZONE_ID` and `MEDIA_CACHE_PURGE_TOKEN` in its GitHub Environment
- **THEN** the Worker is deployed with them, no value appears in a command line or log, and no file holding them remains; without one of them, nothing is deployed and the step names each missing secret

#### Scenario: a build without the quota counter

- **WHEN** the configuration a build generated lacks the `QUOTA_COUNTER` binding, binds it to another class, or does not declare `QuotaCounter` in `exports`
- **THEN** the workflow stops before the migrations and the deploy, naming the binding and the environment

#### Scenario: a build whose static pages would be indexable

- **WHEN** the `_headers` file of a build for `dev`, `stage` or `prod` is missing, or has no rule that gives every static asset `X-Robots-Tag: noindex`
- **THEN** the workflow stops before the migrations and the deploy, naming the file

#### Scenario: a build whose static assets lack the security headers

- **WHEN** the `_headers` file of a build for `dev`, `stage` or `prod` has no rule that gives every static asset the content security policy, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` and the referrer policy
- **THEN** the workflow stops before the migrations and the deploy, naming the file and the missing headers

#### Scenario: a prerendered page that reads the database

- **WHEN** a page that reads the database is prerendered in the build of a deployed environment
- **THEN** the build fails, because the database address it gets answers nothing

#### Scenario: the home redirects to the only active locality

- **WHEN** after a deploy `/` answers a 301 to `/hidalgo/tizayuca`, which answers 200 with `X-Robots-Tag: noindex`, and `/robots.txt` closes the site
- **THEN** the smoke test passes

### Requirement: The dev footer names the branch and commit deployed (v2)

Added in v2 — source: ADR 0008.

On `dev`, the page footer MUST say "Versión de prueba: rama <branch>, commit <first seven characters of the commit>", from the variables `DEPLOY_BRANCH` and `DEPLOY_COMMIT` that the dev workflow sets at deploy time. No other environment MUST show it, even with both variables set, and nothing MUST be shown when a value is missing or the commit is not a hexadecimal SHA. The prerendered pages (the legal pages) are built before the deploy sets those variables, so they carry no deploy footer.

#### Scenario: dev

- **WHEN** the home of `dev` is opened after a deploy of a branch
- **THEN** its footer shows that branch and the first seven characters of the commit

#### Scenario: another environment

- **WHEN** the home of `stage`, production or a local run is opened
- **THEN** there is no deploy footer

#### Scenario: a missing or invalid value

- **WHEN** `DEPLOY_BRANCH` is empty, or `DEPLOY_COMMIT` is empty or not hexadecimal
- **THEN** there is no deploy footer

### Requirement: Every environment answers a health route (v2)

Added in v2 — source: ADR 0016.

`GET /health` MUST answer 200 with the body `ok` when the Worker reaches the database, running `SELECT 1` through `HYPERDRIVE_FRESH`, and 503 with the body `unavailable` when it does not. The body MUST NOT say why it failed; the reason goes to the Worker log. Both answers are plain text with `Cache-Control: no-store`, and the route reads only through `HYPERDRIVE_FRESH`, because a cached answer would hide a database that is down.

#### Scenario: the database answers

- **WHEN** `/health` is requested and the database answers
- **THEN** it answers 200 `ok` with `Cache-Control: no-store`

#### Scenario: the database does not answer

- **WHEN** `/health` is requested and `HYPERDRIVE_FRESH` cannot reach the database
- **THEN** it answers 503 `unavailable` and the body names no host, error or connection string

#### Scenario: only the fresh binding counts

- **WHEN** the cached binding cannot reach the database but `HYPERDRIVE_FRESH` can
- **THEN** `/health` answers 200

### Requirement: Production is checked every 30 minutes (v2)

Added in v2 — source: ADR 0016.

A scheduled workflow (`monitor.yml`) MUST run at minutes 7 and 37 of every hour, and by hand, against the `SITE_URL` of `prod`. It MUST fail unless the home answers 200, following its redirects only over https, and `/health` answers 200 `ok`. Each check is tried up to three times, 20 seconds apart, before it counts as failed, and a failed run names every check that failed. GitHub emails a failed run to the person who last changed the schedule.

#### Scenario: production answers

- **WHEN** the home answers 200 and `/health` answers 200 `ok`
- **THEN** the run passes

#### Scenario: a dropped request

- **WHEN** the home fails once and answers 200 on a later try
- **THEN** the run passes

#### Scenario: production is down

- **WHEN** the home or `/health` keeps failing, or `/health` answers 200 without `ok`
- **THEN** the run fails naming each check that failed

#### Scenario: the address

- **WHEN** the `SITE_URL` of `prod` in `wrangler.jsonc` changes
- **THEN** a test fails until the workflow checks the new address

### Requirement: Production is backed up every night to a private bucket (v2)

Added in v2 — source: ADR 0016.

A scheduled workflow (`backup.yml`) MUST run every night at 03:23 Mexico City time, and by hand, from `main` only, through the `backup` GitHub Environment. It MUST dump production with `pg_dump` 18 or later in the custom format, as the read-only role `enmirumbo_backup` over the direct (not pooled) host with `sslmode=verify-full`, check that the dump reads back with `pg_restore --list` and holds table data, and upload it through R2's S3 API to the private bucket `enmirumbo-backups` as `prod/enmirumbo-<UTC date and time>.dump`, with its Content-MD5 and its SHA-256 as metadata. The run MUST fail if R2 does not then hold the same number of bytes. The password MUST NOT appear on any command line or in the log, and on GitHub Actions the database host is masked in the log. The bucket has no public hostname, a lifecycle rule that deletes each dump after 30 days, and a bucket lock that keeps it at least that long. A restore into the `dev` branch is tested once and written in the README.

#### Scenario: a nightly backup

- **WHEN** the backup runs
- **THEN** one new object under `prod/` holds the dump, the run summary names it with its size and SHA-256, and the dump's password appeared nowhere

#### Scenario: an unsafe or wrong connection

- **WHEN** `DATABASE_URL` does not use `sslmode=verify-full`, uses the pooled host or has no password, or `pg_dump` is older than 18
- **THEN** the run fails before anything is dumped

#### Scenario: a dump that is not usable

- **WHEN** `pg_dump` fails, or the dump does not read back or holds no table data
- **THEN** nothing is uploaded and the run fails

#### Scenario: an upload that is not complete

- **WHEN** R2 refuses the upload or holds a different size afterwards
- **THEN** the run fails

### Requirement: The commands that write in bulk read the environment from `ENVIRONMENT` (v2)

Added in v2 — source: ADR 0008, ADR 0019.

In "Commands that write to the database recognize the real environment", the environment is the variable `ENVIRONMENT` (`dev`, `stage` or `prod`), not `NODE_ENV` or `VERCEL_ENV`, and the explicit permission to write to a remote database is that variable naming the deployed environment the database belongs to. "Local database" keeps the effective-host criterion. The fictitious seed never writes with `ENVIRONMENT=prod`. There is no search backfill: the database derives the search columns (`data-model`, "The database derives the normalized name and "¿Qué ofreces?" of a business for the search (v2)").

#### Scenario: the seed pointing to a remote database

- **WHEN** the fictitious seed is run with the address of a remote database and without `ENVIRONMENT`
- **THEN** it changes nothing, ends with an error and says that the address is not a local database and which variable accepts the risk

#### Scenario: the seed in production

- **WHEN** the fictitious seed is run with `ENVIRONMENT=prod`
- **THEN** it writes nothing and says that seeds never run against production

### Requirement: A single database dialect in all environments (v2)

Added in v2 — source: ADR 0005, ADR 0019.

The system MUST use PostgreSQL 18 in development, in testing, in continuous integration and in production. There MUST be a single Drizzle schema (`src/core/db/schema/`) and a single migration tree (`drizzle/`); the project MUST NOT maintain parallel migrations per dialect. The local database MUST start with a single documented command (`vp run db:up`), with no accounts or paid services, and the migration tree applied locally MUST be the one applied in every deployed environment. The migrations bring the reference data (`data-model`, "Reproducible migrations that carry the reference data (v2)"), so nothing seeds a catalogue: in "The CI tests the migrations and the suite against an ephemeral Postgres" and "A single document says how to deploy", seeding the catalogues means applying the migrations.

#### Scenario: local database from a fresh clone

- **WHEN** someone clones the repository, installs the dependencies, starts the local database with `vp run db:up` and applies the migrations with `vp run db:migrate`
- **THEN** they get a PostgreSQL 18 database with all the model's tables and the reference data, among it the 8 categories, the 49 trades and the 105 zones of Tizayuca, without running any seed

#### Scenario: the same tree in production

- **WHEN** the migrations are applied to the empty production database
- **THEN** exactly the same migration tree as locally is applied, with no separately written SQL, and the resulting schema and reference data are the same

#### Scenario: there are not two dialects to maintain

- **WHEN** the project is reviewed
- **THEN** there is a single Drizzle schema, a single migrations directory and its declared dialect is PostgreSQL; no file in the project declares a different dialect

### Requirement: Every response carries the security headers and the content security policy (v2)

Added in v2 — source: ADR 0011, ADR 0012, ADR 0014, PRD §8. Amended on 2026-10-18 by the decision of the product owner of that date: `img-src` takes `MEDIA_URL`, which replaces `PHOTOS_URL`. Amended on 2026-10-18 by EMR-43: the edit mode of the management link gets the panel's referrer policy (`business-registration`, "The edit mode of a locality lives under it, and lands on its confirmation (v2)").

Every response of the site, in every environment —pages, redirects, errors, `/robots.txt`, `/sitemap.xml`, `/health` and the static assets that Cloudflare serves without the Worker— MUST carry:

- `Content-Security-Policy`, with exactly these directives: `default-src 'self'`; `script-src 'self' https://challenges.cloudflare.com`, plus `https://cloud.umami.is` where the measurement is on (production with a Website ID, `base-layout`, "Cookieless measurement is loaded only in production and only when configured (v2)"); `style-src 'self'`; `img-src 'self'`, plus the environment's `MEDIA_URL` when it is an https origin; `connect-src 'self'`, plus `https://gateway.umami.is` and `https://cloud.umami.is`, Umami Cloud's collectors, where the measurement is on; `frame-src https://challenges.cloudflare.com`; `frame-ancestors 'none'`; `object-src 'none'`; `base-uri 'none'`; and `form-action 'self'`. No inline script or style is allowed, so no page may carry one: every stylesheet and script of the build is a file.
- `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` and `Referrer-Policy: strict-origin-when-cross-origin`, which never sends a path to another site.

The admin panel —every response at `/admin` and below, and the admin actions— and the edit mode of the management link —every response at `/{estado}/{municipio}/editar/` and below— get `Referrer-Policy: strict-origin`, the policy their pages declare (`base-layout`, "The measurement carries no personal data or text typed by people"), and the panel's `form-action` also allows the Access team domain (`https://<team>.cloudflareaccess.com`), where Access sends a panel submission whose session has expired. A response that already declares one of these headers keeps its own value. No response announces the framework (`X-Powered-By`, a `generator` meta tag). The Worker adds the headers to its responses; the build writes the same headers, computed from the vars of the environment it targets, in the `_headers` file of the static assets, in every environment. The dev server leaves out only the content security policy, because Vite's development pages need inline styles and scripts; the preview and every build send it. The README holds the policy and the command that reads it from the deployed site.

#### Scenario: any response

- **WHEN** a page, a redirect, a nonexistent address, `/robots.txt`, `/sitemap.xml`, `/health`, a prerendered page or a stylesheet is requested
- **THEN** the response carries the content security policy, `nosniff`, `X-Frame-Options: DENY` and the referrer policy, and no header or tag names the framework

#### Scenario: a script from another origin

- **WHEN** a page tries to load a script from a domain that is not the site's, Turnstile's or, in production with a Website ID, Umami's
- **THEN** the browser blocks it

#### Scenario: Umami only where it measures

- **WHEN** the policy of `dev`, `stage`, local, or production without a Website ID is read
- **THEN** it names no Umami origin

#### Scenario: the pages load whole under the policy

- **WHEN** the home of a locality, a legal page, a 404 and the panel are opened with the policy active
- **THEN** their stylesheet applies and the browser reports no violation

#### Scenario: the panel

- **WHEN** an address of the panel is requested
- **THEN** its referrer policy is `strict-origin` and its forms may be sent to the site and to the Access team domain only

#### Scenario: the edit mode

- **WHEN** an address at `/{estado}/{municipio}/editar/` or below is requested, whether it opens a card or not
- **THEN** its referrer policy is `strict-origin` and its forms may be sent to the site only

#### Scenario: a static asset

- **WHEN** the build of any environment is read
- **THEN** its `_headers` file gives every static asset the same security headers a page of that environment gets

#### Scenario: verified against the site

- **WHEN** the README is followed after a deploy
- **THEN** it gives the command that reads the headers of the deployed site and what they must say

### Requirement: Public media live in R2, in one bucket for production and one for dev and stage (v2)

Added in v2 — source: decision of the product owner, 2026-10-18; ADR 0011 (amended on 2026-10-18), PRD §6.8.

Business photos MUST be stored in a public media bucket of Cloudflare R2: a bucket that holds only public content people or the admin upload, organized by prefix, with the photos under `photos/` (`public-directory`, "The photo of an unpublished business is referenced on no public surface (v2)"; `data-model`, "A photo key is 24 characters of the identifier alphabet, and names two objects under `photos/` (v2)"). Nothing private MUST go in it: the backups keep their own bucket ("Production is backed up every night to a private bucket (v2)"). There MUST be two media buckets: `enmirumbo-media` for production alone, and `enmirumbo-media-dev`, shared by `dev` and `stage`, so that nothing deployed from a branch can reach production's media, and the cards `dev` copies from `stage` point at photos that exist. The Worker binds its environment's bucket as `MEDIA`.

Each bucket MUST be served from its media hostname, a custom domain of the bucket, named as an https origin in the variable `MEDIA_URL` of the environments that use it: `https://media-enmirumbo.urekz.com` for `prod` and `https://media-dev-enmirumbo.urekz.com` for `dev` and `stage`, temporary hostnames under `urekz.com` until `enmirumbo.com` is on Cloudflare (later `media.enmirumbo.com` and `media-dev.enmirumbo.com`); moving them MUST be a change of configuration and never of code. `MEDIA_URL` is the only other origin the content security policy lets images come from. Serving a photo MUST NOT invoke the Worker: Cloudflare serves it from the bucket and its cache, following the `Cache-Control: public, max-age=31536000, immutable` every object carries. The media hostname MUST NOT list the bucket, and the bucket's `r2.dev` URL MUST stay off.

Locally `MEDIA_URL` is empty and the bucket is Miniflare's: the local Worker MUST serve it on its own origin under `/_media/<object key>`, with each object's media type and caching, so the dev server, the preview and the end-to-end tests show the photos; it MUST answer 404 to an object that does not exist and to any prefix, and the route MUST answer only with `ENVIRONMENT` `local` and on a loopback host, so it does not exist in a deployed Worker. A deployed environment without an https `MEDIA_URL` shows no photo and logs it once.

#### Scenario: per environment

- **WHEN** the configuration of `dev`, `stage` and production is read
- **THEN** production binds `enmirumbo-media` and names `https://media-enmirumbo.urekz.com`, and `dev` and `stage` both bind `enmirumbo-media-dev` and name `https://media-dev-enmirumbo.urekz.com`

#### Scenario: serving

- **WHEN** a photo of a published card is requested on its media hostname
- **THEN** it is served by the CDN from the bucket, with its media type and a year of caching, with no Worker invocation

#### Scenario: locally

- **WHEN** the dev server or the preview runs with the seeded photos in the local bucket
- **THEN** the cards show them from `/_media/photos/…` of the same origin, and `/_media/` and `/_media/photos/` answer 404

#### Scenario: the local route in a deployed Worker

- **WHEN** a deployed environment, or a request to a host that is not a loopback one, asks for `/_media/…`
- **THEN** the Worker does not serve the bucket

### Requirement: Workers Logs and traces stay off in every environment (v2)

Added in v2 — source: decision of the product owner, 2026-10-18 (EMR-43); `business-registration`, "A token that is not exactly the current one opens nothing and gives nothing away" and "The edit mode of a locality lives under it, and lands on its confirmation (v2)"; "Anti-abuse counters live in a Durable Object and never in PostgreSQL (v2)", which keeps the visitor's address in memory only, for less than an hour, as the privacy notice says. It amends ADR 0004, which named Workers Logs as the observability of the Worker.

Cloudflare's Workers Logs keep, for every request, an invocation log with its method, its URL and the metadata of the request, and traces keep the same, persisted in the account for days. The address of the edit mode is the key to a card, the token never goes in a log, and the visitor's address is used only in memory. So the Worker of every environment —the local one, `dev`, `stage` and `prod`— MUST declare Workers Logs and traces off in its own block of `wrangler.jsonc`, every key of them written: `observability.enabled`, `observability.logs.enabled`, `observability.logs.invocation_logs`, `observability.logs.persist`, `observability.traces.enabled` and `observability.traces.persist`, all `false`. Nothing is left to Cloudflare's default, which turns Workers Logs on for a new Worker, or to what the dashboard had: every deploy writes it again. The check of the build refuses any other value before anything is deployed ("Each environment is built and deployed by its own workflow (v2)").

What the Worker writes with `console` is then kept nowhere. Debugging a deployed environment uses `wrangler tail`, or the Worker's real-time logs in the dashboard, which show the live requests and lines and keep nothing; the lines the site writes still say only the kind of a failure, never a token, an address or what a person typed. The daily registrations alert, a line of the Worker log until the email to the admin arrives (EMR-55), is seen only that way until then (`business-registration`, "The daily registrations alert goes out once per local day (v2)").

#### Scenario: every environment

- **WHEN** the configuration of the local Worker, `dev`, `stage` and `prod` is read
- **THEN** each declares, in its own block, Workers Logs and traces off, with every key of them `false`

#### Scenario: a build that would keep logs

- **WHEN** the build of an environment has no `observability`, or has Workers Logs, invocation logs, their persistence or traces on
- **THEN** the check of the build refuses it, naming `observability`, and nothing is deployed

### Requirement: A deleted photo is purged from the cache of the media hostname, and a purge that fails is retried every hour (v2)

Added in v2 — source: decision of the product owner, 2026-10-18 (EMR-48); ADR 0011, ADR 0013 and ADR 0020, amended. The privacy notice promises a real deletion (`legal-pages`), and every object of a photo carries a year of caching ("Public media live in R2, in one bucket for production and one for dev and stage (v2)"), so Cloudflare's cache of the media hostname keeps serving a photo whose objects are gone from R2 (R2, "Consistency model", read on 2026-10-18). It amends "Permanent deletion refuses to claim it deleted what it did not delete" with what a deletion says when only the cache could not be purged.

Every deletion of a photo's objects —the permanent deletion of a card, a resubmission or an edit that replaces or removes a photo, a superseded edit's new photo, an edit applied or discarded, and the purges of the scheduled job when they arrive— MUST go through the one deletion of a photo of the Worker, which deletes both objects and then purges both of its addresses (`card` and `full`) from Cloudflare's cache, with the purge by URL of the zone of the media hostname (`POST https://api.cloudflare.com/client/v4/zones/<zone id>/purge_cache` with `files`, at most 100 addresses a request, Cloudflare's limit on every plan but Enterprise). A photo that was never stored whole was never served, and nothing purges it. The zone's id and an API token with the permission Zone, Cache Purge on that zone alone are the Worker secrets `MEDIA_ZONE_ID` and `MEDIA_CACHE_PURGE_TOKEN` of each deployed environment (the zone's id is a secret because the repository holds no account or zone ids); `dev` and `stage` share the media hostname, and so its zone. The token MUST NOT appear in a log, an error, a page or the repository; what the Worker logs of a failed purge is its HTTP status, Cloudflare's error codes or a fixed reason, never an address. A deployed environment without either secret purges nothing, logs it once per isolate, and keeps every address for the retry. Locally (`ENVIRONMENT` `local`) the Worker serves the local bucket itself, with no cache of Cloudflare's in front: nothing is purged, nothing is kept and no secret is needed; the tests answer Cloudflare's API with a fake, never the network.

A purge that fails MUST keep the photo's two addresses for the retry, and only them (`data-model`, "The photo addresses waiting for their purge are the only thing kept of a deleted photo (v2)"), through a connection of its own, so they stay even if what deleted the photo then fails. The hourly job MUST retry them in its task `photo-cache-purge`, every run whatever the local hour: the oldest first, at most 100 addresses a request and 10 requests a run, forgetting each address Cloudflare purged and leaving the others for the next run. It is idempotent, and it logs counts only (purged, waiting and failed requests); a run in which a purge request fails MUST be reported as failed, so Cloudflare shows it until the purge works. `dev` has no trigger, so its addresses wait until one runs the task there.

The permanent deletion MUST tell what happened (`admin-review`, "Unpublishing, a new link and the permanent deletion are forms of the detail, and their actions check everything again (v2)"): when the objects are deleted and the purge fails but its addresses are kept, the card, its rows and its objects are deleted and the panel says that its photo may still be seen a while and that the purge is retried every hour; when the addresses cannot be kept either, the deletion stops before the rows, like an unreachable photo store, since only the card still knows the key a new attempt needs. Whatever else deletes a photo logs a failure by its kind and goes on.

#### Scenario: the purge after a deletion

- **WHEN** a photo is deleted in a deployed environment with both secrets
- **THEN** both of its objects are deleted first, and then one purge request asks Cloudflare for its two addresses with the token as a bearer

#### Scenario: a purge that fails

- **WHEN** Cloudflare refuses the purge, or does not answer
- **THEN** the photo's objects stay deleted, its two addresses wait in `photo_cache_purges`, and the log says the status or the error codes, never the token or an address

#### Scenario: the retry

- **WHEN** the hourly job runs with addresses waiting and Cloudflare purges them
- **THEN** they are forgotten, the log counts them, and a second run asks nothing

#### Scenario: a retry that still fails

- **WHEN** the hourly job runs and a purge request fails
- **THEN** its addresses keep waiting, the other tasks still run, and the run is reported as failed with counts only

#### Scenario: locally

- **WHEN** a photo is deleted by the local Worker
- **THEN** no purge is asked, nothing is kept and no secret is needed

#### Scenario: a deployed environment without the secrets

- **WHEN** a photo is deleted in a deployed environment whose `MEDIA_ZONE_ID` or `MEDIA_CACHE_PURGE_TOKEN` is not set
- **THEN** nothing is asked of Cloudflare, the problem is logged once, and the photo's addresses wait for the retry
