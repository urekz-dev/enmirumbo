# Spec: base-layout

## Requirements

### Requirement: Global layout with header and footer on every page

Every page of the site MUST render inside a global layout with a header that shows the brand as the typographic wordmark "enmirumbo", and a footer at the end of the page. The footer MUST include the links to the two legal pages, with the literal texts "Aviso de privacidad" and "Términos y condiciones", each pointing to a page that exists and with a touch area of at least 44px. The dynamic root home and root 404 omit those footer links while no locality is active; the prerendered legal pages remain as they are and keep their footer links.

Amended on 2026-10-31 (EMR-61) by decision of the product owner: when no locality is active, the coming-soon root and the root 404 omit the footer links to the draft privacy notice and terms. The root locality list shows them when it has active localities, and pages of an active locality keep them. The legal pages remain prerendered, directly reachable and unchanged.

AMENDED (founder's request: "el header se ve limpio con solo el wordmark"): the header NO LONGER carries "Tizayuca" next to the wordmark. Hyperlocal positioning is still mandatory in the product, but it is required on other surfaces: the `h1` of the home, the footer (with the line "Hecho para los vecinos de Tizayuca, Hidalgo.") and all the SEO metadata (`title`, `description`, Open Graph) of the requirement "Server Component with a document in es-MX and base metadata".

AMENDED (rebrand approved by the founder on 2026-09-04, T-019): the brand of the site is **"enmirumbo"**, written as one word, always lowercase, and **no locality attached**. A compound form like "«brand» + Tizayuca" MUST NOT exist on any surface: where the geographic context is needed, it is written as a descriptor —"enmirumbo, el directorio de negocios de Tizayuca"— and from the second mention on, plain "enmirumbo" is used. Geography is what the site says about itself, not part of its name. The line "Hecho para los vecinos de Tizayuca, Hidalgo." does NOT change.

#### Scenario: header with the wordmark

- **WHEN** a resident opens any page of the site on their phone
- **THEN** they see at the top the wordmark "enmirumbo", linked to the home, with no locality attached to the name

#### Scenario: hyperlocal positioning stays visible outside the header

- **WHEN** a resident opens the home or reaches the end of any page
- **THEN** they see "Tizayuca" in the `h1` of the home and in the footer, in the line "Hecho para los vecinos de Tizayuca, Hidalgo.", and not as a surname of the brand

#### Scenario: the footer closing line did not change with the rebrand

- **WHEN** the resident reaches the end of any page after the rebrand
- **THEN** they still read, word for word, "Hecho para los vecinos de Tizayuca, Hidalgo."

#### Scenario: footer with the legal links and no dead links

- **WHEN** the resident reaches the end of a page of an active locality, or the root locality list
- **THEN** they see the footer with the site identification ("enmirumbo") and the links "Aviso de privacidad" and "Términos y condiciones", each pointing to a page that really exists, and no link that leads to a nonexistent page

#### Scenario: no legal footer links before a locality is active

- **WHEN** no locality is active and a resident reaches the end of the coming-soon root or a root 404
- **THEN** they see the brand in the footer without links to the draft privacy notice or terms

#### Scenario: the footer links can be tapped on a phone

- **WHEN** the owner of a business taps "Aviso de privacidad" or "Términos y condiciones" on their phone
- **THEN** each link measures at least 44px in its smaller dimension and takes them to the corresponding page

### Requirement: Palette and typography as reusable tokens with WhatsApp green as the primary action

The color palette and the typography MUST be defined as named tokens in the Tailwind configuration (`@theme` block of `globals.css`), so that future screens consume them by name and not with loose values. The WhatsApp green MUST exist as a token and be documented in the file itself as the primary action color of the site; no other palette token MUST compete with it as an action color.

#### Scenario: the action green is tokenized and documented

- **WHEN** a developer opens the token configuration to style an action button
- **THEN** they find the WhatsApp green token with a comment that documents it as the primary action color, and can use it as a Tailwind class without writing the hexadecimal value

#### Scenario: the layout consumes only tokens

- **WHEN** the layout, the header, the footer and the provisional home are reviewed
- **THEN** all colors and font families come from the defined tokens, with no loose hexadecimal values in the components

### Requirement: Mobile-first design with no horizontal scroll

The layout MUST look correct in a 390px-wide viewport and scale up (tablet and desktop) without producing horizontal scroll at any width.

AMENDED (amendment approved by the founder, visual review batch 2): "no horizontal scroll" MUST hold by construction and be verified, not just claimed. On the public screens, no class that prevents responsive collapse MUST be used: text forced onto a single line (`whitespace-nowrap`, `text-nowrap`), label clipping (`truncate`), minimum widths other than `min-w-0`, or fixed pixel widths. Every grid MUST declare a single column as its base and add columns per breakpoint. The test suite MUST include a guard that checks the served HTML of the public screens and fails if any class breaks these rules.

Visual verification at 390px MUST be done with real device emulation (the page viewport set to 390px). A screenshot requested only with the browser window size is NOT valid proof: the browser may refuse to shrink the window below the system minimum (measured: 500px on macOS), lay out at that wider width and crop the image to the requested size, which makes content that fits completely on a real phone look like "overflow".

#### Scenario: no public screen blocks responsive collapse

- **WHEN** the served HTML of the home, the listing, the card, the registration, the search results and the legal pages is reviewed
- **THEN** no class forces a single line, clips labels, sets a minimum width or sets columns without a breakpoint

#### Scenario: width measurement does not depend on the window size

- **WHEN** someone verifies that a screen does not overflow at 390px
- **THEN** they do it with the viewport emulated at 390px and comparing the document's scroll width against the viewport width, not with a screenshot requested by window size

#### Scenario: phone at 390px

- **WHEN** the site is opened in a 390px-wide viewport
- **THEN** the header, the content and the footer look complete and legible, with no horizontal scroll

#### Scenario: desktop adaptation

- **WHEN** the site is opened in a tablet or desktop viewport
- **THEN** the content adapts (for example, with a centered maximum width) keeping the same structure and with no horizontal scroll

### Requirement: Base accessibility from PRD §8

The layout MUST use semantic HTML with landmarks (`header`, `main`, `footer`) and a correct heading hierarchy (a single `h1` per page). All color token combinations used for text MUST meet AA contrast (WCAG 2.1: ≥4.5:1 for normal text). Every interactive element of the layout MUST have a touch area of at least 44px.

AMENDED (non-text contrast fix reported by the founder): the outlines of form controls (inputs, selects, textareas and input checkboxes/radios, on any screen of the site) MUST reach a contrast ratio of at least 3:1 against the background they sit on (WCAG 2.1, criterion 1.4.11). Purely decorative borders (cards, separators, navigation pills) are outside this rule.

AMENDED (amendment approved by the founder, visual review batch 2): the **secondary action button/link** —"Buscar", "Llamar", "Cómo llegar", "Ver su página", "Ver clubes y escuelas deportivas"— is a control, not an ornament: its outline MUST meet the same 3:1 minimum against the background. That stronger outline MUST NOT break the hierarchy: the secondary still does not use the action green in any role (neither background nor text nor border), so the only green-filled action on the screen is still the primary one.

#### Scenario: secondary button outline

- **WHEN** the border color of the secondary action button is checked against the background it sits on
- **THEN** the contrast ratio is at least 3:1 and the button still does not use the action green

#### Scenario: form control outline

- **WHEN** the border color of an input, select, textarea or input checkbox/radio is checked against the background it sits on
- **THEN** the contrast ratio is at least 3:1

#### Scenario: semantic structure

- **WHEN** the HTML of any page is inspected
- **THEN** the content is inside `header`, `main` and `footer` landmarks, and the headings follow a hierarchy with no skipped levels (a single `h1`)

#### Scenario: AA contrast of the tokens

- **WHEN** the text/background combinations defined by the palette tokens are checked (including the text on the action green)
- **THEN** all of them reach a contrast ratio of at least 4.5:1

#### Scenario: touch areas

- **WHEN** a resident uses the site on their phone
- **THEN** any tappable element of the header or the footer measures at least 44px in its smaller dimension

### Requirement: Server Component with a document in es-MX and base metadata

The global layout MUST be a Server Component that sends no client JavaScript of its own. The ONLY exception is the script of the cookieless analytics provider: it is third-party JavaScript, conditional on configuration, deferred, absent from `/admin` and with no own code around it; justified by PRD §9 ("analítica desde el día 1") and ADR-005. The document MUST declare `lang="es-MX"` and expose base site metadata: title "enmirumbo — Encuentra negocios y servicios en Tizayuca" and description "Encuentra negocios, servicios y deporte en Tizayuca y contáctalos directo por WhatsApp. Registro gratis para negocios locales." The geography of the title still lives in the descriptor ("en Tizayuca"), which is where it already was; what disappears is the locality attached to the name.

That title MUST remain the one for pages that do not declare their own (the home, among them), and pages that do declare one MUST be presented in the document as `«Page title» — enmirumbo`, so that a search result says first what the page is about and then whose it is.

The layout MUST also declare the **public URL of the site as the base of all absolute URLs** (canonicals, sitemap and share preview), taken from the same environment variable the admin panel already uses to build the card link (`SITIO_URL`). Outside production, with no variable declared, the local development address MUST be used. In production, if the variable is not declared or is unreadable, the site MUST NOT publish absolute URLs pointing to the local address: the canonicals and the absolute preview are omitted and a record is left in the server log (once per process, never per request).

The layout MUST also declare the identity of the share preview that all pages inherit: the site name "enmirumbo", the Mexican Spanish language and a brand image of the site itself. That image MUST show the current wordmark —"enmirumbo", with "Tizayuca" below it in the context line, smaller and separate, as a descriptor and not as part of the name— and its alt text MUST name the site with the same brand alone; a preview with the previous brand is the hardest surface to notice and the one that travels the farthest.

#### Scenario: document in Mexican Spanish with metadata

- **WHEN** any page of the site is loaded
- **THEN** the HTML declares `lang="es-MX"` and the `<title>` and the meta description include "Tizayuca"

#### Scenario: the home keeps the site title

- **WHEN** the root route is opened
- **THEN** the document title is "enmirumbo — Encuentra negocios y servicios en Tizayuca"

#### Scenario: a page with its own title carries the brand at the end

- **WHEN** a category listing is opened, whose own title is "Servicios del hogar en Tizayuca"
- **THEN** the document title is "Servicios del hogar en Tizayuca — enmirumbo"

#### Scenario: the card shared through WhatsApp arrives with the new brand

- **WHEN** a resident shares any page of the site and the app renders the preview
- **THEN** the site name says plain "enmirumbo", the image shows that wordmark with "Tizayuca" below it as a context line, and the previous name or a brand with the locality attached appears nowhere

#### Scenario: base URL declared

- **WHEN** the site runs with the public URL declared in its environment variable
- **THEN** the canonicals, the sitemap URLs and the preview image are absolute and use that origin

#### Scenario: production without a declared public URL

- **WHEN** the site runs in production without the public URL variable
- **THEN** no absolute URL pointing to the local address is published, the fact is recorded in the server log and no page fails because of it

#### Scenario: no client JS in the layout

- **WHEN** the site is built and the layout, the header and the footer are reviewed
- **THEN** none of them uses the `"use client"` directive or adds client bundles of its own

#### Scenario: the only script is the analytics one

- **WHEN** the HTML of a public page with analytics measurement configured is reviewed
- **THEN** the only external JavaScript it loads is the analytics provider's; without configuration, it loads none

### Requirement: No surface of the site names the previous brand or attaches the locality to the name

No served surface of the site —public pages, admin panel, metadata, share preview, legal texts and WhatsApp messages the site builds— MUST contain **the previous brand** (the name the directory was launched with, replaced by "EnMiRumbo" on 2026-09-04 in T-019, in any combination of upper and lower case, standalone or attached to a domain; and the spellings "EnMiRumbo" and "En Mi Rumbo", replaced by "enmirumbo" on 2026-10-12) **nor the compound form** that attaches the locality to the wordmark as a surname ("enmirumbo" followed by "Tizayuca", with no comma or descriptor), which the founder discarded together with the old name. The project's automated verification MUST include a guard that checks the code of the site surfaces and fails naming the file when either of the two reappears, so that a new literal written by another change does not resurrect them without anyone noticing. The two exact strings the guard looks for live in its own test suite and in the archived change `renombrar-sitio-enmirumbo`; this spec does not reproduce them, because it describes what the site says today.

The guard MUST NOT reach the repository's historical documentation —devlog, decisions (ADR), already closed tickets and archived changes—, which names the previous brand on purpose because it tells what happened when it happened. Rewriting that history to pass the verification would be worse than the problem it avoids.

#### Scenario: a new literal brings the old brand

- **WHEN** someone adds to the site a text, a title or a WhatsApp message with the directory's previous name
- **THEN** the automated verification fails and indicates in which file and on which line it appeared

#### Scenario: someone attaches the locality to the brand again

- **WHEN** someone writes in the site a literal that puts "Tizayuca" attached after the wordmark, as if it were part of the name
- **THEN** the automated verification fails just as with the previous brand, and indicates that the locality goes as a descriptor and not attached to the name

#### Scenario: the legal pages do not name it in their metadata either

- **WHEN** the title and description of `/aviso-de-privacidad`, of `/terminos`, of the search results page and of the admin panel are reviewed
- **THEN** none mentions the previous brand and all use "enmirumbo"

#### Scenario: the repository history stays as it is

- **WHEN** the verification is run with the devlogs, the ADRs, the closed tickets and the archived changes naming the previous brand
- **THEN** the verification passes: those documents are outside its scope

### Requirement: Home of the site inside the layout, with the entry to registration

The root route (`/`) MUST show the real home of the site inside the global layout, with a single welcome `h1` in colloquial Mexican Spanish —the literal text "¿Qué necesitas en Tizayuca?"— accompanied by the phrase "Encuentra negocios y servicios de aquí cerquita y contáctalos directo por WhatsApp.". The home MUST keep the entry to the Flow A registration (PRD §7) with the literal text "Registra tu negocio gratis", with the primary action style (WhatsApp green) and a touch area of at least 44px, presented under the question "¿Tienes un negocio en Tizayuca?". The directory content of the home (categories and sports block) is specified by the `public-directory` capability; here it is only required that it live inside the layout, with header and footer, and with the correct heading hierarchy (one `h1` and the sections as `h2`). The provisional phrase "Muy pronto vas a poder encontrar aquí los negocios y servicios de Tizayuca." MUST disappear, because the directory already exists. All residual text from the create-next-app template MUST remain absent.

#### Scenario: home inside the layout

- **WHEN** a resident opens the root route of the site on their phone
- **THEN** they see, inside the layout with header and footer, the heading "¿Qué necesitas en Tizayuca?" and the phrase "Encuentra negocios y servicios de aquí cerquita y contáctalos directo por WhatsApp."

#### Scenario: the home no longer announces that the directory is coming later

- **WHEN** the root route is opened
- **THEN** the phrase "Muy pronto vas a poder encontrar aquí los negocios y servicios de Tizayuca." does not appear

#### Scenario: entry to registration from the home

- **WHEN** the owner of a business opens the root route on their phone
- **THEN** they see the question "¿Tienes un negocio en Tizayuca?" and a visible link with the text "Registra tu negocio gratis", with the primary action style, that takes them to the registration page

#### Scenario: heading hierarchy

- **WHEN** the HTML of the home is inspected
- **THEN** there is exactly one `h1` and the category and sports sections are second-level headings, with no skipped levels

#### Scenario: no traces of the template

- **WHEN** the root route is opened
- **THEN** no text, logo or link from the Next.js/Vercel template appears

### Requirement: 404 page in Spanish inside the layout

The site MUST have its own "not found" page, in colloquial Mexican Spanish and inside the global layout, shown for any unknown URL and for the cases the directory marks as nonexistent (category or business). It MUST respond with a 404 status code, be headed with the literal text "No encontramos esta página", explain with the phrase "A lo mejor el negocio ya no está publicado o la dirección quedó mal escrita." and offer a link back with the text "Ir al inicio". It MUST NOT show technical details, template traces or links to nonexistent pages.

#### Scenario: unknown URL

- **WHEN** someone opens a URL that does not correspond to any page of the site
- **THEN** they see, inside the layout with header and footer, the heading "No encontramos esta página", the phrase "A lo mejor el negocio ya no está publicado o la dirección quedó mal escrita." and the link "Ir al inicio", and the response has a 404 status code

#### Scenario: the 404 is neither an English page nor a technical dump

- **WHEN** the not found page is reviewed
- **THEN** all its text is in Spanish, no technical error message or Next.js template message appears, and the only link leads to the home

### Requirement: Internal links to existing routes and protected external links

Every internal link of the site MUST point to a route that exists, including dynamic routes, whose destinations are resolved from the catalogs (categories, trades and trade+zone pairs) or from the published businesses. The same rule MUST apply to the destination of the site's forms (the `action` of the search form, for example): a form that submits to a route that does not exist is a dead control just like a broken link, and the automated verification MUST flag it. The route allowlist of the automated verification MUST recognize the legal routes `/aviso-de-privacidad` and `/terminos`, which already exist. Every link that leaves the site and opens in a new tab (WhatsApp, maps, the page that registered a business) MUST carry `rel="noopener noreferrer"`. Call links (`tel:`) MUST NOT open a new tab and therefore do not require that attribute.

#### Scenario: internal link to a nonexistent route

- **WHEN** a link to a route the site does not have is added in the interface code
- **THEN** the site's automated verification fails, flagging that link

#### Scenario: the legal routes exist and the verification recognizes them

- **WHEN** the links of the footer, of the registration consent block and of the legal pages themselves are reviewed
- **THEN** `/aviso-de-privacidad` and `/terminos` pass the verification as existing routes, and a misspelled legal route (for example `/terminos-y-condiciones`) still fails

#### Scenario: links to dynamic routes

- **WHEN** the links to category listings, to trade pages and trade+zone pages, and to business cards are reviewed
- **THEN** each one corresponds to a declared dynamic route of the site, whose destination exists (a slug from one of the three catalogs, a published business)

#### Scenario: search form destination

- **WHEN** the search form of the home and the one on the results page are reviewed
- **THEN** their submission destination is a route that exists in the site, and the automated verification fails if it is changed to a nonexistent route

#### Scenario: protected external links

- **WHEN** any link that opens in a new tab to WhatsApp, Google Maps or the page that registered a business is reviewed
- **THEN** it carries `rel="noopener noreferrer"`

#### Scenario: call link

- **WHEN** the "Llamar" button of a card is reviewed
- **THEN** it uses a `tel:` link that does not open a new tab

### Requirement: The site publishes a `robots.txt` that allows what is public and excludes what is not relevant

Superseded in v2 by The open `robots.txt` allows the public site and excludes what is not relevant (v2) — source: ADR 0007, ADR 0008.

The site MUST serve a `robots.txt` at its root that allows crawling the public site and excludes `/admin` (the review panel), `/buscar` (the URLs with a query, which already declare `noindex`) and `/registro/gracias` (the registration confirmation screen). It MUST NOT list the management link routes (`/editar/...`) or any other route the site does not serve: announcing in a public file where the secret links live is worse than not excluding them, and those screens are already protected with `noindex, nofollow` and with no public link leading to them. The file MUST point to the site's sitemap with its absolute URL, unless the public URL of the site is not declared, in which case that line is omitted instead of pointing to a local address.

This `robots.txt` is a request to well-behaved crawlers, not a defense against mass harvesting of the directory (finding M5 of T-004), which remains pending debt (E5-5).

#### Scenario: what is public can be crawled

- **WHEN** a search engine requests `/robots.txt`
- **THEN** it gets a file that allows crawling the site and that does not block the home, the category listings, the trade pages or the cards

#### Scenario: the panel and the results stay out

- **WHEN** the `robots.txt` is reviewed
- **THEN** it excludes `/admin`, `/buscar` and `/registro/gracias`

#### Scenario: secret routes are not announced

- **WHEN** the `robots.txt` is reviewed
- **THEN** no management link route appears, nor any other route the site does not serve

#### Scenario: the sitemap is announced with an absolute URL

- **WHEN** the site has its public URL declared
- **THEN** the `robots.txt` includes the sitemap line with the absolute URL of `/sitemap.xml`

### Requirement: The site publishes a `sitemap.xml` that updates itself

Superseded in v2 by The sitemap lists the pages that exist, from the database (v2) — source: ADR 0007, ADR 0008.

The site MUST serve a `sitemap.xml` at its root, generated from the database on every request and with no manual step, that includes: the home, the registration page (`/registro`), the listings of the 8 categories, **every trade page and trade+zone page that has at least one published business** and the card of each published business. Each card MUST declare its publication date as its last modification date.

The sitemap MUST NOT include the panel (`/admin`), the results page (`/buscar`), the registration confirmation (`/registro/gracias`) or any trade or trade+zone page without published businesses. It MUST NOT include either businesses that are not in `published` status, nor leak any of their data. When the public URL of the site is not declared in production, the sitemap MUST respond with a valid, empty document rather than publish local addresses.

The 8 categories are included even when empty —they are the fixed navigation of the site, they are linked from the home and their empty state invites people to register—; what is excluded for being empty are the trade and zone combinations, which number over a thousand and would indeed produce thin content.

#### Scenario: the sitemap brings what is published

- **WHEN** a search engine requests `/sitemap.xml` with published businesses in the database
- **THEN** it finds the home, `/registro`, the 8 category URLs, the URL of each trade and of each trade+zone pair with published businesses, and the URL of each published card

#### Scenario: nothing that is not published

- **WHEN** there are businesses in `in_review` and `rejected` with trades and zone assigned
- **THEN** neither their cards nor the trade+zone combinations occupied only by them appear in the sitemap, and none of their data is in the response

#### Scenario: no private or search pages

- **WHEN** the sitemap is reviewed
- **THEN** `/admin`, `/buscar` and `/registro/gracias` do not appear

#### Scenario: it updates without anyone touching it

- **WHEN** the admin publishes a new business with a trade that until then had none
- **THEN** the next read of the sitemap already brings its card and the URL of that trade, without anyone having edited a file

#### Scenario: card date

- **WHEN** the entry of a published card is reviewed
- **THEN** its last modification date is the date the business was published

### Requirement: Cookieless analytics measurement is loaded only if configured, and without it the site works the same

Superseded in v2 by Cookieless measurement is loaded only in production and only when configured (v2) — source: ADR 0014.

The site MUST load the cookieless analytics provider's script (ADR-005) ONLY when the two environment variables `NEXT_PUBLIC_UMAMI_SRC` (absolute URL with the `https:` scheme of the provider's script) and `NEXT_PUBLIC_UMAMI_WEBSITE_ID` (identifier of the site at the provider, non-empty) are configured. If either of them is missing, if they are empty or only spaces, or if `NEXT_PUBLIC_UMAMI_SRC` is not an absolute `https:` URL, the site MUST NOT include any third-party `<script>` tag, MUST NOT make any request to an external domain and MUST respond exactly as if the measurement did not exist: with no errors, no broken pages and no additional JavaScript. When the configuration is half-set or invalid (one variable set and the other not, or a `src` that is not `https:`), the server MUST leave a warning in its log once per process, without blocking startup or any page. No screen of the site MUST show a banner, notice or switch for cookies or measurement consent (PRD §9: cookieless provider, no banner).

#### Scenario: with no variables configured nothing is loaded

- **WHEN** the site runs without `NEXT_PUBLIC_UMAMI_SRC` or `NEXT_PUBLIC_UMAMI_WEBSITE_ID` and a resident opens the home, a listing, a card or the form
- **THEN** the response HTML contains no `<script>` tag to an external domain, the browser requests nothing outside the site and all pages look and work the same

#### Scenario: with both variables the provider's script is loaded

- **WHEN** the site runs with `NEXT_PUBLIC_UMAMI_SRC="https://cloud.umami.is/script.js"` and `NEXT_PUBLIC_UMAMI_WEBSITE_ID` with an identifier, and a resident opens a public page
- **THEN** the HTML includes that provider script with the site identifier, and the page still looks the same

#### Scenario: half-set configuration

- **WHEN** the site runs with only one of the two variables, or with `NEXT_PUBLIC_UMAMI_SRC="/script.js"` (not absolute `https:`)
- **THEN** no script is injected, the pages respond normally and a warning is left in the server log saying what is missing, without stopping startup

#### Scenario: there is never a cookie banner

- **WHEN** a resident browses the site with the measurement configured
- **THEN** they see no banner, notice or switch for cookies or measurement consent, and do not have to accept anything to use the directory

### Requirement: The admin panel and edit mode stay out of the measurement

Superseded in v2 by The admin panel and the edit mode stay out of the measurement by where they live (v2) — source: ADR 0014, ADR 0007.

No page under `/admin` and no edit mode screen (`/editar/<token>` and its confirmation) MUST load the measurement script or send visits or events to the provider, even if the variables are configured. The exclusion MUST be a property of the site structure —the script is injected from the trunk of the measured public pages, not from the root layout that also wraps those others— and not a route list that someone must remember to update. The reasons: the panel is not resident traffic and would pollute the PRD §10 metrics; its URLs (`/admin/registros/<id>`) point to a specific person's registration; and in edit mode the route **is** the business's credential, so sending it to the provider would hand a third party the key to a card (PRD §8, LFPDPPP). Each excluded trunk MUST have written down why it is excluded, and the automated verification MUST fail if an exclusion is left with no pages or if one appears without justification.

#### Scenario: the panel does not load the script

- **WHEN** the admin opens `/admin`, the queue or the detail of a registration, with the measurement configured
- **THEN** the HTML of those pages contains neither the provider script nor any event attribute, and the provider receives no visit and no registration identifier

#### Scenario: edit mode does not load the script either

- **WHEN** the owner opens their management link and submits their changes, with the measurement configured
- **THEN** neither the edit screen nor the confirmation one loads the provider script, and no route with the token leaves the site

#### Scenario: a new public page is measured

- **WHEN** a new public page is added to the trunk of the measured pages
- **THEN** it inherits the measurement without touching any route list, and the rest of the site (home, registration and cards) keeps being measured normally even though excluded trunks exist

### Requirement: The measurement carries no personal data or text typed by people

The events the site sends to the provider MUST be limited to an event name from the contract (`whatsapp-listing`, `whatsapp-card`, `call`, `directions`) and, at most, two properties: `category` and `zone`, both with the **catalog slug** as value. No other property MUST travel. The business name, its WhatsApp, its phone, its address or references, its schedule, its identifier and the free zone text it entered MUST NEVER travel: when the business's zone is not from the catalog ("Otra" case, or business with no zone), the `zone` property MUST be `other`. In addition, the measurement MUST NOT send the query string of the URLs (`?q=…` of the search, `?colonia=…` of the filter), because `q` is free text typed by the resident: only the public route of the page travels, the same one anyone shares through WhatsApp.

The data channels to the provider are **four, not two**: besides the event name with its properties and the URL, the provider receives on every send the **document title** and the page **referrer**. All four are subject to the same rule, and the last two are named here so that nobody leaves them out of the count when touching metadata or adding links:

- **Title.** No title of a public page MUST contain text typed by a visitor or data that the rule above forbids. In particular, the results page (`/buscar`) MUST declare a **static** title, without the term the resident typed: it is the same protection as the exclusion of the query string, which by itself does not cover the title. Since that page is not indexable, a dynamic title adds nothing for SEO and would leak free text; whoever gives their own metadata to the directory pages MUST respect this exception.
- **Referrer.** The panel screens (`/admin`) and the edit mode ones (`/editar/<token>`) MUST declare a referrer policy that prevents the **route** from leaving as a referrer: when going from the panel to a public page, the provider MUST NOT be able to know which panel URL the visit came from. Without that, `/admin/registros/<id>` —which points to a specific person's registration— would reach a third party, because the provider forwards same-origin referrers as a route. In edit mode the reason is even more direct: the route carries the token, so letting it leave as a referrer would hand over the key to the card. That policy MUST NOT nullify the `Origin` header of form submissions: both the panel and edit mode are promised to work without client JavaScript (requirements "The panel is operated from the phone and with no unnecessary client JavaScript" of `admin-review` and "The management link opens the card in edit mode with the same prefilled form" of `business-registration`), and a nullified `Origin` makes the server reject their submissions. The two conditions together rule out both `no-referrer` (nullifies the `Origin`) and `same-origin` (lets the route through between own pages); `strict-origin` —the current value— and `origin` meet them. The policy MUST live in the trunk of each of those groups, not in each header or footer link: that way it also covers links that are added later (PRD §8, LFPDPPP). If one day it is also declared as a hosting header, it MUST carry the same value and for the same reason.

#### Scenario: properties of an event

- **WHEN** an instrumented button of a listing card or of a card is inspected in the HTML
- **THEN** it carries the event name and only two properties, `category` and `zone`, whose values are catalog slugs (letters, digits and hyphens), and no other property

#### Scenario: business with unnormalized "Otra" zone

- **WHEN** the business has no catalog zone, only the free text it typed (for example "atrás del panteón viejo")
- **THEN** the attribute of the `zone` property is `other` and that text appears in no measurement attribute

#### Scenario: what the resident types does not travel

- **WHEN** the resident searches for something at `/buscar?q=…` or filters a listing by zone
- **THEN** the provider receives the route of the page without the query string, so the text the resident typed does not leave the site

#### Scenario: no business data inside a measurement attribute

- **WHEN** the HTML of a listing, of the results page and of a published business card is reviewed
- **THEN** no measurement attribute contains the business name, its WhatsApp, its phone, its address, its schedule or its identifier

#### Scenario: what the resident searches for does not travel through the title either

- **WHEN** the resident searches for "quiero abogado por mi divorcio" and the results page loads with the measurement configured
- **THEN** the document title is the static one of that page, with no trace of what they typed, and the provider receives that text neither through the URL nor through the title

#### Scenario: the admin goes from the panel to the public site

- **WHEN** the admin is reviewing `/admin/registros/<id>` and opens a public page from the header or the footer, in the same tab or a new one
- **THEN** the public page receives at most the origin of the site, never the panel route, so the provider never learns which registration the visit came from

#### Scenario: a new link in the panel does not reopen the channel

- **WHEN** one more link from the panel to a public page is added
- **THEN** it inherits the policy of the panel trunk without anyone having to mark it link by link

#### Scenario: a nonexistent panel URL does not leak either

- **WHEN** someone manually opens an address that does not exist but hangs from the panel and carries a registration identifier (for example `/admin/registros/<id>/loquesea`), and from there navigates to the public site
- **THEN** that "not found" page is also under the panel policy, so the address does not travel as a referrer

#### Scenario: closing the referrer cannot break the panel without JavaScript

- **WHEN** the admin uses the panel with JavaScript disabled —or before it finishes loading— and submits the password, approves or rejects a registration
- **THEN** the submission works as always, because the panel's referrer policy preserves the request's `Origin`; a policy that nullified it would make the server reject the submission

### Requirement: A single deferred script and zero own client JavaScript

The measurement MUST add at most **one** external `<script>` tag, loaded in a deferred way (`defer` or `async`) so as not to block painting, and MUST NOT be introduced through a tag manager or load chained scripts (PRD §8, <2s on 4G goal). The site MUST NOT add client JavaScript of its own to measure: events are declared with `data-*` attributes in the markup, which are inert without the script, and no file of the measurement MUST declare `"use client"`.

Not adding own JavaScript is not enough to make the measurement invisible, because the provider's script **does** intervene in the click: when the element that declares an event is a link with a destination that does **not** open a new tab, the provider cancels the click, sends the event and navigates once it gets a response, so on a slow network the resident's action is left waiting (measured: 3.0 s of delay with 3 s of provider latency). Therefore, **no link that does not open a new tab MUST carry the event on the link itself**; in those cases —today the "Llamar" button, which uses `tel:` and by design does not open a tab— the event MUST be declared on a wrapping element that is not a link, so that the provider registers the same event without touching navigation. The wrapper MUST NOT change the design or the accessibility of the button, and the accepted failure mode is the benign one: if the provider changed how it reads events, that click would stop being registered, but the button would never break or be delayed.

#### Scenario: a single deferred script

- **WHEN** the HTML of a public page with the measurement configured is reviewed
- **THEN** there is exactly one external `<script>` tag, with deferred loading, pointing to the provider domain documented in `.env.example`

#### Scenario: the attributes execute nothing on their own

- **WHEN** the site runs without configuration and the resident taps the WhatsApp button of a listing card
- **THEN** the button behaves as always (opens the conversation), no measurement JavaScript is executed and no request leaves the site

#### Scenario: no client components

- **WHEN** the files that implement the measurement are reviewed
- **THEN** none declares `"use client"` or adds a client bundle of its own

#### Scenario: calling by phone with the measurement on

- **WHEN** the resident taps "Llamar" on a card, with the measurement configured and a slow network
- **THEN** the phone starts dialing immediately, without waiting for the provider to answer, and the `call` event is registered all the same

#### Scenario: a new button that does not open a new tab

- **WHEN** a button whose link does not open a new tab is instrumented
- **THEN** the event is declared on a wrapping element and not on the link, so that the provider cannot postpone the resident's action

### Requirement: Counts exclude bots and crawlers

Visit counts MUST exclude bots and crawlers (PRD §9: SEO traffic itself would inflate the views and pollute the §10 conversion). The site MUST NOT keep its own counts on the server: a visit is registered only from the browser, when the provider's script runs, so a crawler that does not execute JavaScript generates no visit. The provider's bot filtering MUST be active and verified before taking the §10 metrics as good, and that step MUST be written in `.env.example` next to the variables.

#### Scenario: a crawler that does not execute JavaScript

- **WHEN** a search engine crawls a card or a listing without executing JavaScript
- **THEN** no visit is registered, because the site counts nothing on the server

#### Scenario: the server keeps no counters

- **WHEN** the code of the public pages is reviewed
- **THEN** no view writes counts to the database or records the visit in the log

### Requirement: `.env.example` explains the analytics and the step that falls to the human

Superseded in v2 by Cookieless measurement is loaded only in production and only when configured (v2) — source: ADR 0014, ADR 0019.

`.env.example` MUST document, in its own block, the two measurement variables: what they are for, that they are **not secrets** (they travel in the HTML of all public pages), the typical value of the provider's script, the link to create the free account, that they are injected when the site is built (changing them requires redeploying), that without them the site runs the same without measuring anything, and the reminder to verify in the provider's panel that bot filtering is active.

#### Scenario: the human knows what to do

- **WHEN** the human opens `.env.example` to connect the analytics
- **THEN** they find the two variables commented, with the link to create the account, the typical value of the script, the warning that they must redeploy when changing them and the note that without them nothing is measured but nothing breaks

### Requirement: Every text that names the locality reads it from the locality record (v2)

Added in v2 — source: PRD §5, ADR 0006.

No locality name MAY be hard-coded in any surface. Every text that names the locality MUST read it from the locality record. This covers: the footer line "Hecho para los vecinos de {municipio}, {estado}.", the home block "Deporte en {municipio}", the descriptor "enmirumbo, el directorio de negocios de {municipio}" (only on first mention in long texts), the metadata of every page and the locality suffix of the directions link. For the active locality of Tizayuca the published texts are the same as the ones written in this specification. A test MUST fail if a locality name is written in the code outside the locality data.

#### Scenario: the footer

- **WHEN** the footer of a page of Tizayuca is read
- **THEN** it reads "Hecho para los vecinos de Tizayuca, Hidalgo."

#### Scenario: a second locality

- **WHEN** the same pages are rendered for a fixture locality with another municipality and state
- **THEN** the footer, the sports block, the metadata, the descriptor and the directions link show that municipality and state, and "Tizayuca" appears nowhere

#### Scenario: the guard test

- **WHEN** the source code is scanned for the name of a municipality outside the locality data and the seeds
- **THEN** the test fails if it finds one

#### Scenario: the brand stays alone

- **WHEN** any surface of any locality is reviewed
- **THEN** none says "enmirumbo" with the locality glued to it, as already required by "No surface of the site names the previous brand or attaches the locality to the name"

### Requirement: Pages outside a locality name no locality (v2)

Added in v2 — source: decision of the product owner, 2026-10-14.

The pages that belong to no locality (the site root, the admin panel, a 404 outside a locality and the legal pages, which every locality shares) MUST NOT name any locality, not even while only one is active: the footer keeps the brand and its links but leaves out the line "Hecho para los vecinos de {municipio}, {estado}.", the title is the brand alone, the wordmark leads to the root and there is no locality description. The site root carries its own description, which names no locality (amended on 2026-10-15 by decision of the product owner): "Encuentra negocios, servicios y deporte de tu municipio y contáctalos directo por WhatsApp. Registro gratis para negocios locales." Naming one would be wrong as soon as a second locality is active, and the legal pages are prerendered without reading the database. The list of localities that the root shows while two or more are active (`public-directory`, "With two or more active localities the root lists them and never redirects by location (v2)") names each of them only as an entry of the list; its title, description, wordmark and footer follow this rule like any other page outside a locality.

#### Scenario: a page without a locality

- **WHEN** the footer and the metadata of the site root, of `/admin` or of a 404 outside a locality are read
- **THEN** no locality is named and the footer has no line for the neighbours

#### Scenario: the root's description

- **WHEN** the metadata of the site root are read, with no active locality or with two or more
- **THEN** its description is "Encuentra negocios, servicios y deporte de tu municipio y contáctalos directo por WhatsApp. Registro gratis para negocios locales." and names no locality

#### Scenario: a page of a locality

- **WHEN** the footer of a page under `/hidalgo/tizayuca` is read
- **THEN** it reads "Hecho para los vecinos de Tizayuca, Hidalgo."

### Requirement: Canonical URLs, share previews and the sitemap use the full locality path (v2)

Added in v2 — source: ADR 0007, ADR 0008. Amended on 2026-10-29 (EMR-63) by decision of the product owner: the dev and stage `SITE_URL` values use `dev.enmirumbo.com` and `stage.enmirumbo.com`; EMR-61 later amended production's `SITE_URL` as described below. Amended on 2026-10-31 (EMR-61) by decision of the product owner: production's `SITE_URL` is `https://enmirumbo.com` on its Custom Domain; `www.enmirumbo.com` permanently redirects to the apex through a Cloudflare Redirect Rule managed outside the repository.

Canonical URLs, Open Graph URLs and the entries of `sitemap.xml` MUST be absolute, MUST include the `/{estado}/{municipio}/` prefix and MUST be built from the site URL variable of the environment. The sitemap MUST list the pages of every active locality.

#### Scenario: canonical of a card

- **WHEN** the canonical URL of a published card of Tizayuca is read
- **THEN** it is the site URL of the environment followed by `/hidalgo/tizayuca/negocio/<slug>-<id>`

#### Scenario: sitemap entries

- **WHEN** the sitemap is read with two active localities
- **THEN** every entry includes its own state and municipality, and the pages of both localities are present

### Requirement: The base of absolute URLs is `SITE_URL`, and only the local environment falls back to the local address (v2)

Added in v2 — source: ADR 0007, ADR 0008.

In "Server Component with a document in es-MX and base metadata", and in `deployment`, "In production no required configuration goes missing silently", the public URL of the site is the variable `SITE_URL` of each environment (`deployment`, "Three deployed environments, each with its own Worker, bindings and variables (v2)"), and production is every environment whose `ENVIRONMENT` is not `local`: as in "Deployed environments stay out of search engines until the cut-over (v2)", a missing or unknown `ENVIRONMENT` counts as deployed. There, a `SITE_URL` that is missing, is not `https`, carries a path, a query or credentials, or names this machine gives no base: pages omit their canonical and their Open Graph URL, never fail because of it, and the Worker logs it once per isolate, never per request. Locally, a `SITE_URL` that is missing or cannot be read gives `http://localhost:4321`. A trailing slash in `SITE_URL` does not double the slash of the paths.

#### Scenario: each environment with its own base

- **WHEN** the canonical of the home of Tizayuca is read on `stage`
- **THEN** it is `https://stage.enmirumbo.com/hidalgo/tizayuca`

#### Scenario: a deployed environment without a usable `SITE_URL`

- **WHEN** `ENVIRONMENT` is `prod`, `dev`, `stage`, missing or unknown and `SITE_URL` is missing, uses `http`, carries a path or names `localhost`
- **THEN** no absolute URL is built, the log has a single line that names the environment however many pages are requested, and the pages answer as usual

#### Scenario: local without `SITE_URL`

- **WHEN** `ENVIRONMENT` is `local` and `SITE_URL` is missing
- **THEN** the absolute URLs start with `http://localhost:4321`

### Requirement: `robots.txt` also excludes the report routes and the thank-you pages (v2)

Added in v2 — source: PRD §8 (minor debt), prototype debt (docs/backlog.md, O1 of T-011).

In addition to what "The site publishes a `robots.txt` that allows what is public and excludes what is not relevant" excludes, the file MUST exclude the report routes of the cards (`/negocio/<slug>-<id>/reportar`) and the report thank-you page (`/reportar/gracias`), under the prefix of every active locality, and the registration thank-you page of every active locality.

#### Scenario: report routes

- **WHEN** `/robots.txt` is reviewed
- **THEN** the report routes and the thank-you pages are excluded for the active locality

#### Scenario: public pages stay crawlable

- **WHEN** `/robots.txt` is reviewed
- **THEN** the home, listings, trade pages and cards are not blocked

### Requirement: The sitemap includes the two legal pages (v2)

Added in v2 — source: PRD §8 (minor debt), prototype debt (docs/backlog.md).

`sitemap.xml` MUST include `/aviso-de-privacidad` and `/terminos`, which are indexable.

#### Scenario: legal pages in the sitemap

- **WHEN** the sitemap is read
- **THEN** it contains the absolute URLs of `/aviso-de-privacidad` and `/terminos`

### Requirement: Phone number auto-detection is turned off (v2)

Added in v2 — source: PRD §8 (minor debt), prototype debt (docs/backlog.md).

The document head MUST carry `<meta name="format-detection" content="telephone=no">`, so that mobile browsers do not turn numbers in the text into call links. Only the explicit `tel:` links of the "Llamar" button MAY call.

#### Scenario: the meta tag

- **WHEN** the head of any page is read
- **THEN** it contains the `format-detection` meta tag with `telephone=no`

#### Scenario: numbers in text

- **WHEN** a card shows a landline as plain text ("Teléfono: …")
- **THEN** the text is not wrapped in a `tel:` link by the site

### Requirement: Two product events and the no-results tag are recorded, only in production (v2)

Added in v2 — source: PRD §6.4, ADR 0014. Amended on 2026-10-15 by decision of the product owner (ADR 0014, amended): a fourth event, the WhatsApp click from a listing card, kept apart from the card's; until then there were three events and this requirement was named "Three product events are recorded, only in production (v2)". Amended again on 2026-10-15 by decision of the product owner (ADR 0014, amended; EMR-36): the search with no results is no longer an event but a tag of the page view (`public-directory`, "A search with no results tags its page view (v2)"); until then there were four events and this requirement was named "Four product events are recorded, only in production (v2)". Amended on 2026-10-18 (EMR-45) by decision of the product owner (ADR 0014, amended): the registration submitted is no longer an event. Umami sends a declared event on a click, so it could only come from the form's submit button, which also counts a submission that comes back with errors, or from JavaScript of the site, and `business-registration` forbids both ("The registration funnel is measured with the views of its two screens"); the funnel is the page views of the registration page and its thank-you page, and the exact count of registrations per locality and category is the database's. Until then there were three events and this requirement was named "Three product events and the no-results tag are recorded, only in production (v2)".

The analytics (Umami Cloud) MUST record two product events —a WhatsApp click from a listing card and a WhatsApp click from a card— and MUST tag the page view of a search with no results. Each event MUST carry the locality and the category as its only properties. No cookie is set and no personal data travels. The script, the events and the tag MUST exist only in production: `stage` and `dev` load no analytics. The admin panel and the management-link screens stay outside the measurement.

The two events are named `whatsapp-listing` and `whatsapp-card`, and no page sends any other name. The two WhatsApp events stay apart: most contacts may start from a listing, and the card's own clicks over its views are a metric of their own (PRD §10). They are declared as attributes of the element that triggers them, read from one place in the code: `data-umami-event` with the name, `data-umami-event-locality` with the locality as `{estado}/{municipio}` (its two slugs, as in its URLs) and `data-umami-event-category` with the slug of the business's category. Where the measurement is off (every environment but production with a Website ID, the panel and the edit mode) the element carries none of them. Only the WhatsApp buttons of the listing card and of the card declare one (`public-directory`, "Only the WhatsApp buttons of the card and the listing card are measured (v2)"). The registration page, its form, its submit button and its thank-you page declare none and add no script to measure: the registration is measured by the page views of `/{estado}/{municipio}/registro` and `/{estado}/{municipio}/registro/gracias`, whose addresses carry nothing the owner wrote (`business-registration`, "No form data travels to the measurement" and "The registration page of a locality lives under it, and lands on its thank-you page (v2)").

The tag is `search-no-results`, the only value a page view may carry, declared as the `data-tag` attribute of the Umami script, read from the same place in the code. The results page sets it when its search found nothing, since the server knows it when it renders the page; the page's address names the locality, and the tag is a fixed word, so no text a person typed travels. Where the measurement is off there is no script, so there is no tag.

#### Scenario: WhatsApp click from a listing card

- **WHEN** a resident taps the WhatsApp button of a listing card in production
- **THEN** `whatsapp-listing` is recorded with the locality and the category of the business

#### Scenario: WhatsApp click

- **WHEN** a resident taps the WhatsApp button of a card in production
- **THEN** `whatsapp-card` is recorded with the locality and the category of the business

#### Scenario: search with no results

- **WHEN** a search in production returns no results
- **THEN** its page view is recorded with the tag `search-no-results` and the address of the results page of its locality, and no query text

#### Scenario: a registration is measured by its page views

- **WHEN** an owner opens the registration page of a locality in production, sends the form with an error, corrects it and lands on the thank-you page
- **THEN** no event is recorded: Umami records the page views of `/{estado}/{municipio}/registro` and `/{estado}/{municipio}/registro/gracias`, with no query and none of the form data, and the form and its button carry no event attribute

#### Scenario: other environments and excluded screens

- **WHEN** a page of `stage` or `dev`, the admin panel, or a management-link screen is opened
- **THEN** no analytics script is loaded

#### Scenario: no cookies

- **WHEN** a production page with the analytics is loaded
- **THEN** the analytics set no cookie

### Requirement: Every surface writes the brand as enmirumbo (v2)

Added in v2 — source: brand decision of 2026-10-12, PRD §5.

Every surface of the site —public pages, admin panel, metadata, share preview, legal texts and WhatsApp messages the site builds— MUST write the brand as `enmirumbo`: lowercase, one word, also at the start of a sentence or in a title. No surface MUST show "EnMiRumbo" or "En Mi Rumbo". The domain `enmirumbo.com` is unchanged.

#### Scenario: the wordmark and the title are lowercase

- **WHEN** a resident opens the home
- **THEN** the header wordmark and the document title say "enmirumbo", in lowercase and in one word

#### Scenario: a message that starts with the brand

- **WHEN** the admin opens a WhatsApp message whose sentence begins with the brand
- **THEN** the message writes "enmirumbo" in lowercase, not "Enmirumbo"

#### Scenario: no old spelling on any surface

- **WHEN** the HTML of the public pages, the admin panel and the legal pages is reviewed
- **THEN** neither "EnMiRumbo" nor "En Mi Rumbo" appears

### Requirement: Deployed environments stay out of search engines until the cut-over (v2)

Added in v2 — source: ADR 0008.

Amended on 2026-10-31 (EMR-61) by decision of the product owner: production keeps `X-Robots-Tag: noindex` and a closed `robots.txt` while the catalogue is empty and the legal review is pending, even though `enmirumbo.com` is already its Custom Domain. Attaching the Custom Domain is not the cut-over and does not lift this requirement.

In `dev`, `stage` and production, every response of the Worker —pages, errors, `/robots.txt` and any other route— MUST carry `X-Robots-Tag: noindex`, and `/robots.txt` MUST close the whole site (`User-agent: *` and `Disallow: /`). Production remains noindex until the cut-over; attaching its Custom Domain does not lift this rule. Until then this requirement wins over the ones that make pages indexable (the legal pages, trade pages with published businesses) and over the open `robots.txt` of "The site publishes a `robots.txt` that allows what is public and excludes what is not relevant". A response that already carries a stricter value, such as the admin panel's `noindex, nofollow`, MUST keep it. An `ENVIRONMENT` that is missing or is not exactly `local`, `dev`, `stage` or `prod` MUST count as deployed. Locally nothing changes: no header, and `/robots.txt` is the open one of "The open `robots.txt` allows the public site and excludes what is not relevant (v2)" (amended on 2026-10-15, EMR-30: until then it excluded `/admin` alone). Cloudflare serves the static files of the build —the prerendered legal pages and the hashed CSS and JavaScript under `/_astro/`— without invoking the Worker, so they MUST get the header from the `_headers` file of the build: the build of an environment that blocks indexing, by the same rule as the Worker, adds a rule that gives every static file `X-Robots-Tag: noindex`, and a local build adds none. The deploy MUST refuse a build without that rule, and its smoke test checks a prerendered page. When the cut-over lets production be indexed, its builds stop adding the rule with no other change.

#### Scenario: any response of a deployed environment

- **WHEN** a page, a nonexistent address or any other route of `dev`, `stage` or production is requested
- **THEN** the response carries `X-Robots-Tag: noindex`

#### Scenario: a prerendered page of a deployed environment

- **WHEN** `/aviso-de-privacidad` or `/terminos` of `dev`, `stage` or production is requested
- **THEN** the response carries `X-Robots-Tag: noindex`, although Cloudflare serves it without the Worker

#### Scenario: the panel keeps its stricter value

- **WHEN** an `/admin` address of a deployed environment is requested
- **THEN** the response carries `X-Robots-Tag: noindex, nofollow`, not the weaker global value

#### Scenario: robots.txt closes the site

- **WHEN** `/robots.txt` of `dev`, `stage` or production is requested
- **THEN** it says `User-agent: *` and `Disallow: /`, and nothing else

#### Scenario: an unknown environment

- **WHEN** `ENVIRONMENT` is missing or says something other than `local`, `dev`, `stage` or `prod`
- **THEN** the site behaves as a deployed environment

#### Scenario: local

- **WHEN** the site runs locally (`ENVIRONMENT` is `local`)
- **THEN** no response carries `X-Robots-Tag`, not even a prerendered page, and `/robots.txt` is the open one, which disallows `/admin` and points to the sitemap

### Requirement: The open `robots.txt` allows the public site and excludes what is not relevant (v2)

Added in v2 — source: ADR 0007, ADR 0008, PRD §8.

Where indexing is allowed (locally today, and production once the cut-over lifts "Deployed environments stay out of search engines until the cut-over (v2)"), `/robots.txt` MUST allow crawling the public site and MUST disallow, for every user agent: `/admin`, and, under the prefix `/{estado}/{municipio}` of every active locality, the search results (`/buscar`), the report form of every card (`/negocio/*/reportar`), the report thank-you page (`/reportar/gracias`) and the registration thank-you page (`/registro/gracias`). It MUST NOT name the edit mode (`/editar/...`) or any other secret route. The exclusions of every active locality are listed from the start, also before the pages they name exist, so that no open version of the file ever lacks them. The localities are read from the database through the cached connection, like every public read. The file MUST end with the line `Sitemap:` followed by the absolute URL of `/sitemap.xml`, built from `SITE_URL`, unless the environment has no base for absolute URLs, in which case that line is left out. This requirement takes the place of "The site publishes a `robots.txt` that allows what is public and excludes what is not relevant", and keeps what "`robots.txt` also excludes the report routes and the thank-you pages (v2)" adds.

#### Scenario: the open file

- **WHEN** `/robots.txt` is requested locally while Tizayuca is the only active locality
- **THEN** it says `User-agent: *`, disallows `/admin`, `/hidalgo/tizayuca/buscar`, `/hidalgo/tizayuca/negocio/*/reportar`, `/hidalgo/tizayuca/reportar/gracias` and `/hidalgo/tizayuca/registro/gracias`, and ends with `Sitemap: http://localhost:4321/sitemap.xml`

#### Scenario: public pages stay crawlable

- **WHEN** the rules are applied to the root, the home of a locality, a listing, a trade page, a trade and zone page, a card, the registration page and the legal pages
- **THEN** none of them is disallowed

#### Scenario: two active localities

- **WHEN** a second locality is active
- **THEN** each locality has its own exclusions under its own prefix, and no other

#### Scenario: the edit mode is not announced

- **WHEN** the open file is read
- **THEN** no line names `/editar`

#### Scenario: closed until the cut-over

- **WHEN** `/robots.txt` of `dev`, `stage` or production is requested before the cut-over
- **THEN** it is the closed file of "Deployed environments stay out of search engines until the cut-over (v2)", without reading the database

### Requirement: The sitemap lists the pages that exist, from the database (v2)

Added in v2 — source: ADR 0007, ADR 0008, PRD §8. Amended on 2026-10-15 by EMR-34: the published cards are listed; until then the only indexable page of a locality was its home. Amended on 2026-10-15 by EMR-33: the listings of the categories and the trade pages with published businesses are listed, each list by its first page. Amended on 2026-10-18 by EMR-39: the registration page of each active locality is listed.

The site MUST serve `/sitemap.xml`, generated from the database on every request through the cached connection, with no manual step. It MUST list, with absolute URLs built from `SITE_URL`, exactly the indexable pages that exist: for every active locality, the pages of that locality under its `/{estado}/{municipio}`, and once each, the two legal pages ("The sitemap includes the two legal pages (v2)"). Today the indexable pages of a locality are its home; its registration page (`/registro`, `business-registration`, "The registration page of a locality lives under it, and lands on its thank-you page (v2)"); the listings of the 8 categories, even when empty; the trade pages and the trade and zone pages with at least one published business; and its published cards, each card at its current URL (`public-directory`, "An outdated card URL redirects to its current URL (v2)") with its publication date as its last modification date. A list is listed by its first page, the URL without `pagina` (`public-directory`, "Directory lists show 20 cards per page, with "Ver más" to the next (v2)"). Each indexable page of a locality that a later story adds MUST add its kind to the same single list, so the sitemap grows with the site. The sitemap MUST NOT list the panel, the search results, the report form and the thank-you pages, the edit mode, an inactive locality, a business that is not published, a trade or trade and zone page without published businesses, a category listing with a zone filter or a page of a list after the first, nor leak any of their data. In an environment without a base for absolute URLs it MUST be a valid, empty sitemap, never a local address. Until the cut-over, its response in a deployed environment carries `X-Robots-Tag: noindex` like every other one, and the closed `robots.txt` does not announce it. A test MUST fail when any URL of the served sitemap does not answer 200.

#### Scenario: what exists today

- **WHEN** the sitemap is read with Tizayuca as the only active locality
- **THEN** it lists the home of Tizayuca, its registration page, the listings of its 8 categories, its trade pages and trade and zone pages with published businesses, each published card of Tizayuca with its publication date, `/aviso-de-privacidad` and `/terminos`, each once and absolute, and no card in review or rejected, no trade page without published businesses and no `?colonia=` or `?pagina=`

#### Scenario: every URL answers

- **WHEN** each URL of the served sitemap is requested
- **THEN** each one answers 200, without a redirect

#### Scenario: a locality is activated

- **WHEN** a second locality is activated
- **THEN** the next read of the sitemap lists its home too, with its own state and municipality, without anyone editing a file

#### Scenario: nothing that is not a public page

- **WHEN** the sitemap is reviewed
- **THEN** no URL of the panel, the search, a report, a thank-you page, the edit mode or an inactive locality appears

#### Scenario: no base for absolute URLs

- **WHEN** a deployed environment has no usable `SITE_URL`
- **THEN** the sitemap is a valid document with no URL

### Requirement: Every page declares its title, description, canonical and share preview (v2)

Added in v2 — source: ADR 0007, ADR 0008, PRD §8, PRD §9. Amended on 2026-10-15 by EMR-33: a page of a list after the first keeps its `pagina` in its canonical, and a page that must not be indexed says so with `noindex, follow`. Amended on 2026-10-18 by EMR-35: a published card with a photo shares its photo instead of its locality's image. Amended on 2026-10-29 (EMR-63) by decision of the product owner: the dev and stage canonicals use their `enmirumbo.com` Custom Domains.

Every page MUST declare its title and, when it has one, its description, as "Server Component with a document in es-MX and base metadata" and "Pages outside a locality name no locality (v2)" describe, and the same title and description as `og:title` and `og:description`. Every page that search engines may index MUST declare its absolute canonical URL, its own address without a query, as `<link rel="canonical">` and `og:url`: the root, the home of each locality, the legal pages and, as they land, the directory pages of `public-directory`. Two cases keep part of the query or none of it, as `public-directory` describes: a page of a list after the first keeps its `pagina`, and a category listing with a zone filter declares the listing without it. A page that must not be indexed or that answers 404 (a not-found page, the panel, a trade page without published businesses) declares no canonical; one that must not be indexed and answers 200 declares `<meta name="robots" content="noindex, follow">`, so its links are still followed. Every page MUST declare its share image (`og:image`, absolute) with its media type, its width, its height and its alt text, as "Each locality has its own share image, one static image per locality (v2)" describes; the card of a published business with a photo declares its photo instead (`public-directory`, "The card looks good when shared over WhatsApp or Facebook"): its 1200×900 WebP variant from the media hostname, with the alt text "Foto de <nombre del negocio>". Without a base for absolute URLs, the canonical, `og:url` and `og:image` are left out and the page still answers. The prerendered legal pages take the base of the environment their build targets.

#### Scenario: the home of a locality

- **WHEN** the home of Tizayuca is read on `stage`
- **THEN** its canonical and `og:url` are `https://stage.enmirumbo.com/hidalgo/tizayuca`, and its `og:title` and `og:description` are its title and description

#### Scenario: every page of the sitemap

- **WHEN** each page that the sitemap lists is opened
- **THEN** it declares as canonical exactly the URL the sitemap lists for it, and a share image of 1200×630, or, on a card with a photo, its photo of 1200×900

#### Scenario: a not-found page

- **WHEN** a 404 is read
- **THEN** it declares no canonical

#### Scenario: a page outside a locality

- **WHEN** the metadata of the root or a legal page is read
- **THEN** it names no locality, and its share image is the generic one

### Requirement: Each locality has its own share image, one static image per locality (v2)

Added in v2 — source: decision of the product owner, 2026-10-14; PRD §9.

In "Server Component with a document in es-MX and base metadata", the brand image of the share preview is one static PNG of 1200×630 per locality, made once with the design tokens: the wordmark "enmirumbo" and, below it, smaller and separate, the context line "{municipio}, {estado}" read from the locality ("Tizayuca, Hidalgo"). The site MUST find a locality's image by the slugs of its state and municipality, never by a name written in the code, and MUST serve it as a static asset. Its alt text names the brand alone and the locality only as the descriptor ("enmirumbo, el directorio de negocios de Tizayuca, Hidalgo"). A locality without an image, and every page outside a locality, MUST use the generic image: the wordmark alone, naming no locality, with the alt text "enmirumbo". Adding a locality's image adds a file and no code. No tool to generate them is kept in the repository; the README says how they were made.

#### Scenario: a link to Tizayuca shared on WhatsApp

- **WHEN** the home of Tizayuca is shared and the app reads its preview
- **THEN** the image is Tizayuca's, 1200×630, with the wordmark and "Tizayuca, Hidalgo", and its alt text is "enmirumbo, el directorio de negocios de Tizayuca, Hidalgo"

#### Scenario: a locality without an image

- **WHEN** a page of a fixture locality with no image of its own is read
- **THEN** its share image is the generic one, with the alt text "enmirumbo", and "Tizayuca" appears nowhere

#### Scenario: the image is served

- **WHEN** the address of any share image is requested
- **THEN** it answers 200 with `image/png`

### Requirement: Cookieless measurement is loaded only in production and only when configured (v2)

Added in v2 — source: ADR 0014, decision of the product owner (measurement stays off until the launch of 2026-10-15).

The site MUST load the script of Umami Cloud (`https://cloud.umami.is/script.js`) ONLY when the environment is `prod` and its Worker variable `UMAMI_WEBSITE_ID` holds a Website ID of Umami (a UUID). The variable is declared, empty, at the top level and in `dev`, `stage` and `prod`; only production may ever carry a value, which the cut-over sets. It is not a secret: it travels in the HTML of every measured page, and changing it takes a deploy. Empty, as it is everywhere until the launch, the site MUST NOT include any third-party `<script>` tag, MUST NOT make any request to another domain and MUST respond exactly as if the measurement did not exist. A value that is not a Website ID, or a value outside `prod`, loads nothing and is logged once per isolate, never per request and never stopping a page. The script MUST be the only external script of the page, loaded with `defer`, with the attributes `data-website-id` and `data-exclude-search="true"`, so the query string of the URL never travels. No screen shows a banner, notice or switch for cookies or measurement consent. The README says how to turn it on and reminds that bot filtering must be verified in Umami's panel before the PRD §10 metrics are taken as good.

#### Scenario: production with a Website ID

- **WHEN** a public page of production is opened with `UMAMI_WEBSITE_ID` set to a Website ID
- **THEN** its HTML has exactly one external script, `https://cloud.umami.is/script.js`, deferred, with that Website ID and `data-exclude-search="true"`

#### Scenario: no Website ID

- **WHEN** any page of any environment is opened while `UMAMI_WEBSITE_ID` is empty
- **THEN** the HTML contains no script, the browser requests nothing outside the site, and the page looks and works the same

#### Scenario: another environment

- **WHEN** `UMAMI_WEBSITE_ID` holds a Website ID in `local`, `dev`, `stage` or an unknown environment
- **THEN** nothing is loaded and the log says once that the value is ignored

#### Scenario: a value that is not a Website ID

- **WHEN** `UMAMI_WEBSITE_ID` in production is not a UUID
- **THEN** nothing is loaded, the pages answer normally, and the log says so once

### Requirement: The admin panel and the edit mode stay out of the measurement by where they live (v2)

Added in v2 — source: ADR 0014, ADR 0007. Amended on 2026-10-18 by EMR-43: the edit mode's referrer policy is also sent as the `Referrer-Policy: strict-origin` header of every response at `/{estado}/{municipio}/editar/` and below, with `X-Robots-Tag: noindex, nofollow` and `Cache-Control: no-store`, and its pages declare it in their markup by where they live (`business-registration`, "The edit mode of a locality lives under it, and lands on its confirmation (v2)").

No page of the admin panel and no screen of the edit mode MUST load the measurement script or carry an event attribute, even in production with a Website ID. The exclusion MUST follow from where a page lives, not from a list of pages: everything at `/admin` and below (whatever its case or URL encoding, and also an address there that does not exist, which answers the site's 404), the admin actions, and everything at `/{estado}/{municipio}/editar/` and below. The reasons are written next to the rule: the panel is not resident traffic and its addresses point to a person's registration; in the edit mode the address is the card's credential. Every other page, a new public page included, is measured without being listed anywhere. The panel's referrer policy of "The measurement carries no personal data or text typed by people" is also sent as the `Referrer-Policy: strict-origin` header of every panel response, with the same value and for the same reason (deployment, "Every response carries the security headers and the content security policy (v2)").

#### Scenario: the panel

- **WHEN** `/admin`, or an address under it that does not exist, is opened in production with a Website ID
- **THEN** its HTML contains neither the script nor any event attribute

#### Scenario: the edit mode

- **WHEN** a page under `/{estado}/{municipio}/editar/` is opened in production with a Website ID
- **THEN** it loads no script, so no address with the token leaves the site

#### Scenario: a new public page

- **WHEN** a public page is added anywhere else
- **THEN** it is measured in production with a Website ID, without touching any list
