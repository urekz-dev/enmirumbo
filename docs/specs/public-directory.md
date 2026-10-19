# Spec: public-directory

## Requirements

### Requirement: The home page shows the 8 categories as large buttons

The root route (`/`) MUST show the 8 categories of the catalogue (PRD §6.1) as large buttons, in catalogue order, each with the category name exactly as it is in the database and linked to its listing. The section MUST be headed with the literal text "Busca por categoría". The buttons MUST be at least 44px in their smaller dimension and display fully in a 390px viewport. The categories MUST sit below the search box (PRD §6.2: "buscador + categorías como botones grandes"), without either of the two losing prominence: they are the two entry points of Flow B and both are visible without scrolling on a 390px phone. No control on the home page MUST be left without a destination.

AMENDED (founder's request: "los botones se ven planos"): each button MAY carry a decorative icon (`aria-hidden`) next to the name; the name remains the accessible content.

AMENDED (amendment approved by the founder, visual review batch 2): the category grid MUST really collapse as the screen narrows, without a fixed number of columns: a single column on the narrowest screens, two on a normal phone and three from tablet up. No category name MUST be clipped or forced onto a single line: the text wraps onto several lines and all buttons in a row keep the same height.

#### Scenario: the grid collapses to a single column on very narrow screens

- **WHEN** the resident opens the home page in a 320px viewport
- **THEN** the eight buttons appear one below the other, with the full name of each category, without clipping and without horizontal scroll

#### Scenario: two columns on a phone and three on a wide screen

- **WHEN** the home page is opened in a 390px viewport and then in a tablet or desktop one
- **THEN** the categories are laid out in two columns on the phone and in three on the wide screen, with the full names in both cases

#### Scenario: the eight categories visible

- **WHEN** a resident opens the home page on their phone
- **THEN** they see, under the heading "Busca por categoría", eight large buttons with the names of the catalogue categories ("Restaurantes y fondas", "Servicios del hogar", "Belleza", "Salud", "Abarrotes y comercio", "Talleres", "Clubes y escuelas deportivas" and "Otro")

#### Scenario: tapping a category leads to its listing

- **WHEN** the resident taps the "Servicios del hogar" button
- **THEN** they reach the listing of that category at the route `/servicios-del-hogar`

#### Scenario: the search box comes before the categories

- **WHEN** the resident opens the home page in a 390px viewport
- **THEN** the search field appears above the heading "Busca por categoría", and both the field and the eight buttons are fully visible, without horizontal scroll

#### Scenario: no dead controls on the home page

- **WHEN** the home page is reviewed
- **THEN** every control leads to a page that exists: the category buttons to their listing, the search box to the results page and the registration entry to the form; there are no filters or buttons without a destination

### Requirement: Highlighted "Deporte en Tizayuca" block on the home page

The home page MUST include a dedicated block titled literally "Deporte en Tizayuca" (PRD §6.5), presented at the same visual level as the commercial categories block —same heading weight and same hierarchy, neither smaller nor hidden at the bottom— with an accompanying phrase and an entry to the listing of the category "Clubes y escuelas deportivas". That this category also appears among the 8 buttons is intentional: the block does not replace it, it highlights it.

AMENDED (founder's request, visual cohesion with the categories block): the block MAY carry a decorative `aria-hidden` icon next to the heading; the heading text is literally "Deporte en Tizayuca".

#### Scenario: the sports block is seen at the same level as the categories

- **WHEN** a mom looking for activities for her kids opens the home page on her phone
- **THEN** she sees the "Deporte en Tizayuca" block with the same visual weight as the categories block, with the phrase "Escuelas, clubes y entrenadores para que los niños (y los grandes) se muevan." and an entry with the text "Ver clubes y escuelas deportivas"

#### Scenario: the block leads to the sports listing

- **WHEN** the mom taps "Ver clubes y escuelas deportivas"
- **THEN** she reaches the listing `/clubes-y-escuelas-deportivas`, the same one she reaches from the button of that category

### Requirement: Category listing at a clean URL with the catalogue slug

Each category MUST have a public listing at the site root, with the URL formed by the catalogue slug (for example `/servicios-del-hogar`). The page MUST be headed with the category name followed by "en Tizayuca" (for example "Servicios del hogar en Tizayuca") as the only `h1`, and list the published businesses of that category. The order MUST be deterministic: most recently published first and, on ties, by name.

The site root MUST resolve a slug against the three catalogues in a fixed order and without ambiguity: **first categories, then trades, then the trade+zone pair**. The category always wins, so that **no already published category URL can change meaning** because of what is added to the other catalogues. A slug that matches no category, no trade and no trade+zone pair of the catalogue MUST respond 404, without suggesting similar slugs. No slug of any of the three catalogues MUST be able to shadow a route of the site itself.

#### Scenario: listing of a category with businesses

- **WHEN** the resident opens `/servicios-del-hogar` and there are published businesses in that category
- **THEN** they see the heading "Servicios del hogar en Tizayuca" and one card for each published business of that category

#### Scenario: category URLs are stable

- **WHEN** someone opens a category link that was shared some time ago, for example `/clubes-y-escuelas-deportivas`
- **THEN** they see the listing of that category, with its heading and without any redirect

#### Scenario: the category wins over the trade with the same slug

- **WHEN** the slug of a category matched the slug of a trade in the catalogue
- **THEN** the root shows the category listing, not the trade page

#### Scenario: slug that is in no catalogue

- **WHEN** someone opens `/plomeros-baratos`, which is not a category slug, nor a trade slug, nor a valid trade+zone pair
- **THEN** they see the site's 404 page in Spanish and the response has status code 404

#### Scenario: category with no published businesses yet

- **WHEN** the resident opens the listing of a category that does not have any published business yet
- **THEN** they see the message "Todavía no hay negocios publicados en esta categoría." and the invitation "Registra tu negocio gratis", instead of an empty page

#### Scenario: the dynamic route does not shadow the site's own routes

- **WHEN** the resident opens `/registro` or the card of a business
- **THEN** they reach those pages and not a category listing or a trade page; and no slug of the three catalogues matches a reserved segment of the site

### Requirement: Only what is published is shown

The public directory MUST show only businesses in the `published` state. Businesses in `in_review` or `rejected` MUST NOT appear in any listing, in any count, in the zone filter, or in the search results, and their card MUST respond 404 with the same page and the same code as a nonexistent business, so as not to reveal that a card under review exists (PRD §6.3 and §8).

**That rule also applies at the instant a card stops being published.** When the admin unpublishes a card, it MUST disappear from the directory on the next request, without waiting for any cache to expire or for anything to be regenerated: out of the listing of its category, of its counts, of the zone filter, of the home page block, of its trade and trade+zone pages, of the search results and of `sitemap.xml`. Its URL MUST respond with the same indistinguishable 404 served for a business under review or a nonexistent one: nothing in the response MUST make it possible to tell "this card was unpublished" from "this card never existed". The same applies to a permanently deleted card.

No public surface MUST ever show the date or the reason for an unpublication: they are internal admin panel data, like the reason for a rejection.

#### Scenario: a business under review does not appear in the listing

- **WHEN** a business of the category "Belleza" is in the `in_review` state and the resident opens `/belleza`
- **THEN** that business does not appear in the listing and none of its data is in the page HTML

#### Scenario: a rejected business does not appear in the listing

- **WHEN** a business is in the `rejected` state and the resident opens the listing of its category
- **THEN** that business does not appear and none of its data is in the page HTML

#### Scenario: card of an unpublished business

- **WHEN** someone opens the card URL of a business in `in_review` or `rejected`
- **THEN** they see the 404 page in Spanish, exactly as if the business did not exist, and no business data appears in the response

#### Scenario: the unpublished card leaves the directory on the next request

- **WHEN** the admin unpublishes a business and right away the home page, the listing of its category with and without a zone filter, its trade and trade+zone pages, the results page with a search that used to find it and `sitemap.xml` are opened
- **THEN** it appears in none of them, none of its data is in the HTML and the counts on those screens no longer include it

#### Scenario: the URL of an unpublished card gives nothing away

- **WHEN** someone opens the link they were shared over WhatsApp of a card that has just been unpublished
- **THEN** they see exactly the same 404 page, with the same code, as if the identifier had never existed, without any notice that the card was once published

#### Scenario: the deleted card leaves no trace either

- **WHEN** someone opens the URL of a permanently deleted card
- **THEN** they see the same 404 and no business data appears in the response

#### Scenario: the unpublication is not made public

- **WHEN** the home page, the listings, the results page and the HTML of any card are reviewed after unpublishing a business
- **THEN** neither the date nor the reason for the unpublication appears in any of them

### Requirement: Zone filter in the listing, without client-side JavaScript

The category listing MUST offer a zone filter (PRD §6.2) that works without client-side JavaScript: an option "Todas las colonias" plus one option for each zone that has at least one published business in that category, each linking to the same listing with the filter applied. The active option MUST be visually distinguishable. A filter that matches no zone in the catalogue MUST NOT break the page or respond 404: it is ignored and the full listing is shown. A published business without a catalogue zone (the unnormalized "Otra" case) MUST appear in the unfiltered listing and MUST NOT break any view.

#### Scenario: filtering by a zone

- **WHEN** the resident opens `/servicios-del-hogar` and taps the zone "Haciendas de Tizayuca"
- **THEN** the listing shows only the published businesses of that category in that zone, that option appears as the active one and the URL reflects the filter

#### Scenario: removing the filter

- **WHEN** the resident, with a filter applied, taps "Todas las colonias"
- **THEN** they see all the published businesses of the category again

#### Scenario: only zones with businesses

- **WHEN** the resident sees the filter of a listing
- **THEN** only zones that have at least one published business in that category appear, so that no option leads to an empty listing

#### Scenario: filter with businesses of that category but not in that zone

- **WHEN** the filter leaves the listing without results because the businesses of that category are in other zones
- **THEN** the resident sees the message "No encontramos negocios de esta categoría en esa colonia." and a link "Ver todas las colonias" that removes the filter

#### Scenario: unknown zone in the URL

- **WHEN** someone opens the listing with a zone filter that does not exist in the catalogue
- **THEN** they see the full listing of the category, without error and without 404

#### Scenario: published business with unnormalized "Otra" zone

- **WHEN** a published business has no catalogue zone, only the free text it entered
- **THEN** it appears in the unfiltered listing with that text as its zone, does not appear under any catalogue zone filter, and no view breaks

### Requirement: The listing card brings the essentials and WhatsApp without extra taps

Each business in the listing MUST be presented in a card with: **its photo when it has one** and, when it does not, a neutral placeholder that does not promise an image; the business name; its zone; the tag "A domicilio" only when the business registered that it makes deliveries or goes to the customer's home; and a green WhatsApp button that opens the conversation with that business directly, without going through the card (PRD §6.2). The rest of the card MUST lead to the business's public card. The WhatsApp button MUST have a touch area of at least 44px and an accessible label saying which business is being written to. The photo MUST carry alternative text that names the business ("Foto de <nombre del negocio>"), while the placeholder remains decorative and is not announced. With or without a photo, the card MUST take up the same space and MUST NOT jump when the image finishes loading.

The card's WhatsApp button MUST declare the event `whatsapp-listing` with the properties `category` and `zone`, through markup attributes and without its own JavaScript, according to the single analytics measurement contract set by the `base-layout` capability (requirement "The measurement carries no personal data or text typed by people"): the values are catalogue slugs, and `other` when the zone is not from the catalogue. The `category` MUST be the business's, not the page's, so that the data is also correct on the results page, where businesses of different categories live together. The event MUST remain declared even if the measurement is not configured: the attributes are inert markup and do not change the button's behavior.

AMENDED (amendment approved by the founder, visual review batch 2) — **the placeholder is no longer a mute grey square**: when the business has no photo (or what is stored is not a server reference), the placeholder MUST show the emoji of **that business's category**, large and centered on the surface background. The emoji is decorative: it carries `aria-hidden` and is NOT announced, so the accessibility rule does not change; the business name remains what is read. It is the same emoji used by the category buttons on the home page, and a category the map does not know yet falls back to a generic emoji. This rule applies wherever the placeholder is rendered (category listing, trade and trade+zone pages, and search results); the card without a photo still shows no image block.

AMENDED (same review) — **the card is fluid**: the photo slot MUST keep its square proportion and MUST NOT stretch when the text beside it grows; the tag "A domicilio" MUST take up only what its text measures and never the full width of the card; and the name and the zone MUST be able to wrap onto several lines. Nothing in the card MUST be forced onto a single line.

#### Scenario: the placeholder without a photo shows the category emoji

- **WHEN** the resident sees in the listing a "Servicios del hogar" business that did not register a photo
- **THEN** in the place of the photo they see the emoji of that category, large on the surface background, and the screen reader does not announce it

#### Scenario: the card neither stretches nor squeezes

- **WHEN** the listing is opened in a 390px viewport with a business with a long name and the tag "A domicilio"
- **THEN** the photo slot remains square, the tag measures only what its text does and the name wraps onto several lines, without horizontal scroll

#### Scenario: card content

- **WHEN** the resident sees the listing of a category where there is one business with a photo and another without one
- **THEN** the first one's card shows its photo and the second one's the placeholder, and both show the business name, zone and the green WhatsApp button

#### Scenario: the photo is announced with the business name

- **WHEN** someone goes through the listing with a screen reader
- **THEN** the photo of "Tacos del Güero" is announced as "Foto de Tacos del Güero" and the placeholder of a business without a photo is not announced

#### Scenario: the layout does not jump

- **WHEN** the listing is opened on a slow network and the photos have not finished loading yet
- **THEN** each card already takes up the same space it will take with the photo in place, and nothing moves when the images appear

#### Scenario: "A domicilio" tag only when it applies

- **WHEN** in the listing there is a business that registered that it makes deliveries or goes to the customer's home and another that did not
- **THEN** only the first one's card shows the tag "A domicilio"

#### Scenario: direct WhatsApp from the card

- **WHEN** the resident taps the WhatsApp button of a card
- **THEN** they leave the site to the WhatsApp conversation with that business, in a single tap and without having entered the card

#### Scenario: the card leads to the public card

- **WHEN** the resident taps the card outside the WhatsApp button
- **THEN** they reach the public card of that business

#### Scenario: accessible button label

- **WHEN** someone goes through the listing with a screen reader
- **THEN** each WhatsApp button is announced indicating the business it writes to, not just as "WhatsApp"

#### Scenario: the click from the card is measured with its category and its zone

- **WHEN** the resident taps the WhatsApp button of a "Belleza" business in the zone "Haciendas de Tizayuca", with the measurement configured
- **THEN** the event `whatsapp-listing` is recorded with `category` = `belleza` and `zone` = `haciendas-de-tizayuca`, and nothing else about the business

#### Scenario: on the results page the business's category rules

- **WHEN** the resident searches "plomero" and taps the WhatsApp of a "Servicios del hogar" business in the results
- **THEN** the event carries `category` = `servicios-del-hogar` (the business's), not a value of the search page

#### Scenario: the button behaves the same without measurement

- **WHEN** the site runs without analytics configured and the resident taps the WhatsApp button of a card
- **THEN** it opens the conversation exactly the same, and the event attributes are in the HTML without executing anything

### Requirement: The card shows the business photo when it has one

The public card of a published business MUST show its photo, at a larger size than the listing card, above or next to the business information (PRD §6.2), with the alternative text "Foto de <nombre del negocio>". If the business did not register a photo, the card MUST NOT show any gap, empty frame or text announcing a nonexistent image: there is simply no photo, just like with the rest of the optional fields.

#### Scenario: card with a photo

- **WHEN** the resident opens the card of a published business that uploaded a photo
- **THEN** they see the business photo, larger than on the listing card, announced as "Foto de <nombre del negocio>"

#### Scenario: card without a photo

- **WHEN** the resident opens the card of a published business that did not upload a photo
- **THEN** they see its information without any image gap, without an empty frame and without text that talks about a photo

### Requirement: Only the photo generated by the server is rendered

The directory MUST build the address of each image from the internal reference that the server generated when processing the photo, and MUST NEVER use as the source of an image a value that may come from outside: if the reference stored in a card is not one of those the server generates —an external URL, a `data:`, a `javascript:`, a path with `..` or any arbitrary string—, the view MUST behave as if the business had no photo and show the placeholder, without trying to load anything (finding M1 of T-004). This rule applies equally in the category listing, in the trade and trade+zone pages, in the search results page, in the card, in the share preview image (`og:image`) and in the structured data image (finding M3 of T-009): since the stored reference is no longer an address, there is no domain allowlist to maintain —the allowlist is the construction of the URL—.

#### Scenario: external reference stored by hand

- **WHEN** a published card has `https://evil.example/pixel.png` stored as its photo
- **THEN** its listing card and its public card show the placeholder, and in the response HTML neither that domain nor any request toward it appears, neither in the preview image nor in the structured data

#### Scenario: `data:` or `javascript:` in the reference

- **WHEN** a published card has `data:image/svg+xml,<svg onload=alert(1)>` or `javascript:alert(1)` stored as its photo
- **THEN** no image is rendered: the placeholder is shown and that content does not appear in the served HTML

#### Scenario: attempt to escape the storage

- **WHEN** a published card has stored as its photo a reference with `../` or with an absolute filesystem path
- **THEN** the placeholder is shown and no file outside the photo storage is served

### Requirement: The photo of an unpublished business is not publicly accessible

Superseded in v2 by The photo of an unpublished business is referenced on no public surface (v2) — source: ADR 0011, PRD §6.8.

The public address that serves a photo MUST check, on every request, that the business that owns that photo is in the `published` state. The photo of a business in `in_review` or `rejected`, that of a business that no longer exists and that of an invented reference MUST respond 404, with the same response in all four cases, so as not to reveal that the file exists (PRD §6.3 and §8). A photo that stopped being published MUST NOT remain available because it was previously stored in a public cache. The only way to see the photo of a record that is not published is the admin panel's own address, which requires a valid session and lives in the `admin-review` capability.

#### Scenario: photo of a record under review

- **WHEN** someone directly requests the photo address of a business that is `in_review`
- **THEN** they receive 404 and not a single byte of the image

#### Scenario: photo of a rejected record

- **WHEN** someone requests the photo address of a `rejected` business
- **THEN** they receive 404, just as if the file did not exist

#### Scenario: invented reference

- **WHEN** someone tries random photo addresses or ones built from a business identifier
- **THEN** all respond 404 and no response makes it possible to tell "does not exist" from "exists but is not published"

#### Scenario: the photo of a published card is served

- **WHEN** the resident opens the listing or the card of a published business with a photo
- **THEN** the images load normally

### Requirement: Photo weight does not break the 4G budget

The served photos MUST fit within the performance budget of PRD §8 (page in under 2 seconds on 4G, "imágenes comprimidas"): the variant used in the card MUST have at most 400px on its longer side and weigh at most 60 KB, and the one for the public card at most 1200px on its longer side and weigh at most 250 KB. If with the chosen compression quality a photo exceeds those caps, the server MUST lower the quality until they are met. In a listing, only the first row of cards MUST load its photo immediately; the ones below MUST load lazily, and no page MUST request the public card variant to render a listing card.

#### Scenario: weight of the variants

- **WHEN** any accepted photo of up to 5 MB is processed
- **THEN** the listing card variant that is served weighs 60 KB or less and the public card one 250 KB or less

#### Scenario: the listing does not download what is not seen

- **WHEN** the resident opens on their phone a listing with twelve businesses with photos
- **THEN** on page load only the photos of the cards visible at the start are requested, and the others are requested as they scroll down

#### Scenario: the card does not use the large photo

- **WHEN** the images requested by a listing or a results page are reviewed
- **THEN** all correspond to the listing card variant, none to the public card one

### Requirement: Indexable trade page at the root, generated from the closed catalogue

Each trade of the closed catalogue (PRD Appendix B) MUST have a public page at the site root with the URL formed by its slug (for example `/plomeria`), which lists **all published businesses that have that trade assigned by the admin, regardless of their category**, with the same card and the same deterministic order as the category listing (most recently published first and, on ties, by name). The business's free-form keywords do NOT generate pages: only the catalogue trades do (PRD §8).

The only `h1` of the page MUST be the trade phrase followed by "en Tizayuca". The phrase MUST come from a curated table of phrases per trade, and when a trade has no entry in that table its catalogue name MUST be used as is, so that adding a new trade never breaks the page. The page MUST offer, like the category listing, a zone navigation: "Todas las colonias" plus one option for each catalogue zone that has at least one published business of that trade, and each option MUST lead to the own trade+zone URL, not to a query parameter.

#### Scenario: page of a trade with businesses

- **WHEN** the resident opens `/plomeria` and there are published businesses to which the admin assigned the trade "Plomería"
- **THEN** they see the heading "Plomería en Tizayuca" and one card for each of those businesses, with the same look and the same WhatsApp button as in the category listing

#### Scenario: the sports trade lands the search that PRD §6.5 asks for

- **WHEN** a mom searching "clases de futbol en Tizayuca" opens `/futbol`, where there is a published club with that trade assigned
- **THEN** she sees the heading "Clases de futbol en Tizayuca" —not "Futbol en Tizayuca"— and that club's card

#### Scenario: the trade rules, not the category

- **WHEN** two published businesses of different categories have the same trade assigned
- **THEN** both appear on the page of that trade

#### Scenario: a business without that trade does not appear

- **WHEN** a published business does not have the page's trade assigned (because the admin assigned it others or none)
- **THEN** it does not appear on that page, even if the trade word is in its name or in its "¿Qué ofreces?"

#### Scenario: only what is published, here too

- **WHEN** a business in `in_review` or `rejected` has trades assigned
- **THEN** it does not appear on any trade page and none of its data is in the response HTML

#### Scenario: the zone navigation leads to own URLs

- **WHEN** the resident sees the page `/plomeria` and there are published businesses of that trade in the zone "Huicalco"
- **THEN** they see the option "Huicalco" linked to `/plomeria-huicalco`, and only zones with at least one published business of that trade appear

### Requirement: Indexable trade and zone page

Each trade and zone pair of the catalogue MUST have a public page at the root with the URL formed by the trade slug, a hyphen and the zone slug (for example `/plomeria-haciendas-de-tizayuca`, PRD §8), which lists the published businesses with that trade assigned **and** that catalogue zone, with the same card and the same order. The only `h1` MUST be the trade phrase, "en", the zone name, and "Tizayuca" separated by a comma (for example "Plomería en Huicalco, Tizayuca"); when the zone name already contains the word "Tizayuca" (for example "Haciendas de Tizayuca"), it MUST NOT be repeated: the heading ends in the zone name.

The resolution of the pair MUST be unambiguous: a compound slug that cannot be read as exactly one trade+zone pair of the catalogue MUST respond 404. The page MUST show the same zone navigation as the trade page, with the current zone marked as active and with "Todas las colonias" leading back to the trade page.

#### Scenario: trade and zone page with businesses

- **WHEN** the resident opens `/plomeria-huicalco` and there is a published business with the trade "Plomería" in the zone "Huicalco"
- **THEN** they see the heading "Plomería en Huicalco, Tizayuca" and that business's card

#### Scenario: the zone that already says Tizayuca does not repeat it

- **WHEN** the resident opens the page of the trade "Plomería" in the zone "Haciendas de Tizayuca"
- **THEN** the heading is "Plomería en Haciendas de Tizayuca", without a second "Tizayuca" at the end

#### Scenario: the filter is real

- **WHEN** there are published businesses with that trade in other zones
- **THEN** they do not appear on this page: only those of the URL's zone

#### Scenario: compound that does not exist

- **WHEN** someone opens `/plomeria-colonia-inventada` or `/loquesea-huicalco`, where one of the two parts is not in its catalogue
- **THEN** they see the 404 page in Spanish and the response has status code 404

#### Scenario: going back to the whole trade

- **WHEN** the resident is on `/plomeria-huicalco` and taps "Todas las colonias"
- **THEN** they reach `/plomeria` and see the published businesses of that trade across all of Tizayuca

### Requirement: Trade pages without published businesses are neither indexed nor linked, but are not 404 either

A trade or trade+zone page whose slug is valid but that has **no published business** MUST NOT be indexed or linked from any page of the site or appear in the sitemap (avoiding thin content, PRD §8), and AT THE SAME TIME MUST NOT respond 404: it MUST respond normally, declare `noindex` while allowing its links to be followed, and show a useful empty state with the invitation to register. A trade or trade+zone page **with** published businesses MUST NOT carry `noindex`.

#### Scenario: catalogue trade that does not have businesses yet

- **WHEN** the resident opens the page of a catalogue trade to which no published business is assigned
- **THEN** the response is normal (not a 404), they see the trade heading, the message "Todavía no hay negocios publicados de esto en Tizayuca." and the invitation "Registra tu negocio gratis"

#### Scenario: trade and zone combination without businesses

- **WHEN** the resident opens `/box-huicalco`, with the trade and the zone in their catalogues but without any matching published business
- **THEN** the response is normal, they see the message "Todavía no hay negocios publicados de esto en esta colonia." and a link "Ver todas las colonias" that leads to the whole trade page

#### Scenario: the empty is not indexed

- **WHEN** a search engine crawls a trade or trade+zone page without published businesses
- **THEN** it finds the instruction not to index it, it can follow its links, and that URL is not in the sitemap

#### Scenario: the empty is not linked either

- **WHEN** the links of the home page, the listings, the cards and the trade pages are reviewed
- **THEN** none points to a trade or trade+zone page without published businesses

#### Scenario: what does have content is indexed

- **WHEN** a search engine crawls a trade page and a trade+zone page that do have published businesses
- **THEN** neither declares `noindex`

### Requirement: Business card at its own URL with the registered information and the verified seal

Each published business MUST have a card at its own stable URL, with the business name as the only `h1`, the visible seal "Negocio verificado" (PRD §6.2) and the information the business registered: what it offers, zone, address or references if it entered them, opening hours and the tag "A domicilio" when it applies. Fields the business did not register MUST NOT be shown: no empty labels or texts such as "No disponible". A card URL with a nonexistent identifier MUST respond 404. If the readable part of the URL no longer matches the business's current name, the card MUST still be shown, so as not to break the links people share over WhatsApp.

#### Scenario: complete card

- **WHEN** the resident opens the card of a published business that filled in all the optional fields
- **THEN** they see the name as the heading, the seal "Negocio verificado", what it offers, its zone, its address or references, its opening hours and the tag "A domicilio"

#### Scenario: card of a business that filled in only the required fields

- **WHEN** the resident opens the card of a published business without optional fields
- **THEN** they see the name, the seal "Negocio verificado", its zone and the WhatsApp button, without empty sections or labels without content

#### Scenario: nonexistent card

- **WHEN** someone opens a card URL with an identifier that does not exist
- **THEN** they see the 404 page in Spanish and the response has status code 404

#### Scenario: old link after a name change

- **WHEN** someone opens a card URL whose readable part no longer matches the business's current name, but whose identifier does exist and is published
- **THEN** they see the business's card, not a 404

### Requirement: Contact buttons on the card with WhatsApp as the main action

The card MUST offer the buttons of PRD §6.2, each one only if the business registered the data: "Enviar WhatsApp" (always present and as the only main action, in the site's action green), "Llamar" only if it registered a landline, "Cómo llegar" only if it entered an address or references (it opens Google Maps with that reference and its zone in Tizayuca) and the link to the page it registered, only if it registered one. The link to the registered page MUST NOT claim to lead to Facebook: it MUST show the real domain it points to (finding M4 of T-003). No other control MUST compete in visual hierarchy with the WhatsApp one, **including the controls "Reportar este negocio" and "Perdí mi enlace", which are not contact buttons: they go apart from this block, after it and with lesser visual weight**. The buttons MUST show the action, not the phone number as text. The "Llamar" button is only generated if the landline normalizes to 10 national digits; if it is not normalizable, the card shows the entered data as plain text ("Teléfono: …") without a call link (decision ratified when closing T-004: what was registered is not lost and no hostile dialing code reaches a `tel:`).

The three contact buttons of the card MUST declare their event with markup attributes and without their own JavaScript, according to the single measurement contract of `base-layout`: "Enviar WhatsApp" the event `whatsapp-card`, "Llamar" the event `call` and "Cómo llegar" the event `directions`, all three with the business's `category` and `zone` properties as catalogue slugs (PRD §9). Since the `tel:` link of "Llamar" does not open a new tab, its event MUST be declared on a wrapping element and not on the link itself, so that the provider cannot delay the dialing. The link to the registered page is NOT instrumented.

#### Scenario: WhatsApp as the main action

- **WHEN** the resident opens any published card
- **THEN** they see the "Enviar WhatsApp" button in the action green, bigger or more prominent than any other control on the page —including "Reportar este negocio" and "Perdí mi enlace"—, and tapping it leaves toward the conversation with that business

#### Scenario: buttons that depend on what was registered

- **WHEN** the business registered a landline and an address or references, but no page
- **THEN** the card shows "Llamar" and "Cómo llegar" in addition to "Enviar WhatsApp", and shows no link to an external page

#### Scenario: business without a phone or an address

- **WHEN** the business did not register a landline or an address or references
- **THEN** the card shows neither "Llamar" nor "Cómo llegar", and the only contact is "Enviar WhatsApp"

#### Scenario: "Cómo llegar" opens the map with what the business entered

- **WHEN** the resident taps "Cómo llegar" on the card of a business that wrote "a un lado de la primaria" and is in the zone "Huicalco"
- **THEN** Google Maps opens searching for that reference together with the zone and Tizayuca, in a new tab

#### Scenario: the link to the registered page does not promise Facebook

- **WHEN** a business registered as its page a link that is not a Facebook one (for example `https://mi-negocio.example/perfil`)
- **THEN** the card shows the link indicating the real domain it leads to (`mi-negocio.example`) and nowhere does it say it is their Facebook

#### Scenario: the three contacts of the card are measured separately

- **WHEN** the resident taps "Enviar WhatsApp", "Llamar" or "Cómo llegar" on the card of a "Talleres" business in the zone "Huicalco", with the measurement configured
- **THEN** `whatsapp-card`, `call` or `directions` is recorded depending on the button, each with `category` = `talleres` and `zone` = `huicalco`

#### Scenario: the link to the business's page is not measured

- **WHEN** the HTML of the card of a business that registered a page is reviewed
- **THEN** that link carries no event attribute

#### Scenario: the card's events are distinguished from the listing card's

- **WHEN** the WhatsApp clicks from the listing and from the card are compared
- **THEN** they arrive with different event names (`whatsapp-listing` and `whatsapp-card`), so that the PRD §10 metric can be calculated against card views without mixing them

#### Scenario: reporting stays outside the contact block

- **WHEN** the order of the card is reviewed
- **THEN** the contact block holds only the buttons of PRD §6.2, and "Reportar este negocio" and the block "¿Es tu negocio?" with "Perdí mi enlace" appear after it, separated from them

#### Scenario: "Perdí mi enlace" does not fight the contact

- **WHEN** the resident opens a card with the block "¿Es tu negocio?" visible
- **THEN** "Enviar WhatsApp" is still the most prominent control on the page

### Requirement: The prefilled WhatsApp message names the directory with the current brand

Every WhatsApp button toward a business —the listing card's, the one on the trade and results pages, and the "Enviar WhatsApp" on the card— MUST open the conversation with the same already written message, literally: "Hola, te vi en enmirumbo. ¿Me das informes?". The message MUST be the same on all surfaces (it is declared only once), MUST NOT be sent by itself —the resident sends it— and MUST NOT contain any data about the resident. It goes without a geographic descriptor on purpose: the business that receives it is in Tizayuca and already knows where it is, so saying so only lengthens the message (founder's resolution of 2026-09-04).

#### Scenario: the resident writes from a listing card

- **WHEN** the resident taps the WhatsApp button of a listing card
- **THEN** the conversation with that business opens with the message "Hola, te vi en enmirumbo. ¿Me das informes?" already written, not sent

#### Scenario: the resident writes from the card

- **WHEN** the resident taps "Enviar WhatsApp" on a business's card
- **THEN** the conversation opens with exactly the same message it would open from the listing card, without the previous brand anywhere

### Requirement: The card view is measured on its own, without custom instrumentation

The "card view" of PRD §9 MUST be measured with the page view that the provider records by itself when the card loads: the site MUST NOT add any event, counter or JavaScript of its own to count it. Since the card lives at its own stable URL (`/negocio/<slug>-<id>`), that view is the denominator of the PRD §10 metric "clics a WhatsApp / vistas de ficha", whose numerator is the event `whatsapp-card`. The URL that travels to the provider is the card's public route, the same one anyone shares over WhatsApp; no additional business data accompanies it.

#### Scenario: opening a card counts as a view

- **WHEN** a resident opens the card of a published business with the measurement configured
- **THEN** a view of that page is recorded, without the site having sent any event of its own

#### Scenario: the card adds no instrumentation

- **WHEN** the card code is reviewed
- **THEN** there is no "view" event, nor counter in the database, nor client-side JavaScript added to measure

### Requirement: The zone is published, never the exact address nor the card's internal data

The directory MUST show the business's zone and MUST NOT show any location data that the business did not enter itself: the only thing that may appear as an address is the address or references text it wrote (PRD §8). Neither the listing nor the card MUST expose, neither on screen nor in the response HTML, the card's internal data: state, origin, registration date, consent record, **the fingerprint of the management link or any token or edit URL**, or **anything of the content of a pending edit**.

#### Scenario: business without an entered address

- **WHEN** the resident opens the card of a business that registered only its zone
- **THEN** they see the zone and no other location reference

#### Scenario: business with entered references

- **WHEN** the resident opens the card of a business that wrote "a un lado de la primaria, calle Morelos"
- **THEN** they see that text as the business wrote it, without adding to it or completing it with address data

#### Scenario: no internal data in the response

- **WHEN** the HTML of a listing or of the card of a business that has a management link and a pending edit is inspected
- **THEN** the state, the origin, the registration date, the consent record —nor its date, nor its version, nor the re-acceptance—, the link fingerprint, any edit URL and any value proposed in the edit do not appear

### Requirement: From the card the pages of its trades are reached

The card of a published business MUST show the trades the admin assigned to it, each one as a link to its trade page, so that those pages are reachable by browsing and crawlable by a search engine without depending only on the sitemap. A published business without assigned trades MUST NOT show any empty section or label without content, exactly like the rest of the fields the business did not fill in. The trades MUST be presented with the curated phrase of the trade and with a touch area of at least 44px.

#### Scenario: card with assigned trades

- **WHEN** the resident opens the card of a published business to which the admin assigned the trades "Plomería" and "Cerrajería"
- **THEN** they see both trades as links and, on tapping "Plomería", they reach `/plomeria`

#### Scenario: card without trades

- **WHEN** the resident opens the card of a published business to which the admin has not yet assigned any trade
- **THEN** the card is shown complete and no empty trades section appears

#### Scenario: trade links never lead to an empty page

- **WHEN** any trade link of a published card is reviewed
- **THEN** the page it leads to has at least that published business, so it is never one of the empty non-indexable pages

### Requirement: Discreet "Reportar este negocio" control on the card

Each published card MUST offer a control with the literal text "Reportar este negocio" that leads to the report mini-form (PRD §6.3). The control MUST go **after** the contact buttons, at the end of the card, and be presented in clearly lesser visual hierarchy than "Enviar WhatsApp": neither action green, nor main-button size, nor anything that makes it compete with the contact, which remains the only main action of the page. Its accessible label MUST name the business, so that whoever browses with a screen reader knows which card they are reporting. The control MUST have a touch area of at least 44px in its smaller dimension. The control MUST NOT appear on any listing card —neither in the category listing, nor in the trade and trade+zone pages, nor in the results page—: reporting is a deliberate act on a specific card.

#### Scenario: the card offers reporting without stealing WhatsApp's place

- **WHEN** the resident opens the card of a published business
- **THEN** they see "Reportar este negocio" at the end of the page, after the contact buttons, with less visual weight than "Enviar WhatsApp", which remains the most prominent control of the card

#### Scenario: tapping the control opens the report form

- **WHEN** the resident taps "Reportar este negocio" on the card of "Tacos del Güero"
- **THEN** they reach the report mini-form of that business, without leaving the site and without being asked for any account

#### Scenario: accessible label with the business name

- **WHEN** someone goes through the card with a screen reader
- **THEN** the control is announced indicating which business it reports, not just as "Reportar"

#### Scenario: reporting is not on the listing cards

- **WHEN** the category listing, a trade page, a trade+zone page and the results page are reviewed
- **THEN** no listing card shows a report control

### Requirement: Report mini-form without an account, with a closed-list reason and optional comment

The report MUST be handled on a page of its own under the business's card (`/negocio/<slug>-<id>/reportar`), without accounts, without registration and without client-side JavaScript (server-resolved form). The identifier is read from the same segment as the card, so an old link with the business's previous name also opens its report. The page MUST be headed with the literal text "Reportar este negocio" as the only `h1`, show the name of the business being reported —as text, as the business entered it— and explain with the literal text "Dinos qué pasa y lo revisamos. No te pedimos ningún dato tuyo." The form MUST have:

- A group of **closed-list** options under the literal label "¿Qué pasa?", with exactly these four and no more: "Ya cerró", "No es real", "Los datos están mal" and "Contenido ofensivo o inapropiado". None MUST come selected by default.
- An **optional** comment under the literal label "¿Nos quieres contar más? (opcional)", limited to 300 characters, with the visible help "Máximo 300 caracteres."
- A submit button with the literal text "Enviar reporte".

The page MUST declare `noindex` in its robots metadata. If the business does not exist or is not in the `published` state, the page MUST respond 404 —the same page and the same code as a nonexistent card—, without revealing that a card under review or rejected exists. That same 404 MUST be the response to **any** request whose business identifier is unusable: an invented one, an empty one, one that is not even text, or a submission arriving with more arguments than the action declares. All those responses MUST be indistinguishable from each other —same code, same body, no cookie— and none MUST end in a server error. The page MUST also offer a way back to the card with the literal text "Volver a la ficha".

#### Scenario: complete report form

- **WHEN** the resident reaches the report form of "Tacos del Güero"
- **THEN** they see the heading "Reportar este negocio", the business name, the phrase "Dinos qué pasa y lo revisamos. No te pedimos ningún dato tuyo.", the four options of "¿Qué pasa?" with none selected, the field "¿Nos quieres contar más? (opcional)" with its help "Máximo 300 caracteres." and the button "Enviar reporte"

#### Scenario: the report works without JavaScript

- **WHEN** the resident picks a reason and submits the report with client-side JavaScript disabled
- **THEN** the report is processed the same, because the form is a server-resolved submission

#### Scenario: reporting a business that is not published

- **WHEN** someone opens the report page of a business in `in_review`, `rejected` or of an identifier that does not exist
- **THEN** they see the 404 page in Spanish with code 404, identical in the three cases, and no business data appears in the response

#### Scenario: submission with a tampered identifier

- **WHEN** a report submission whose business identifier is empty, is not text (a number, an object, a list) or carries extra arguments arrives directly at the server
- **THEN** the response is the same 404 as for a nonexistent identifier, byte for byte, without cookies, without writing anything to the database and without any server error

#### Scenario: the report page is not indexed

- **WHEN** a search engine crawls the report page of any card
- **THEN** it finds the instruction not to index it

### Requirement: The server validates the report's reason and comment

Superseded in v2 by The server validates the report's reason and comment, and keeps the draft without a cookie (v2) — source: decision of the product owner, 2026-10-14; `legal-pages`, "The privacy notice lists the cookies (v2)".

All the report validation MUST happen on the server, because the form works without JavaScript and because a submission can arrive directly, without going through the page. The reason MUST belong to the closed list: a submission without a reason, with an empty reason or with a value that is not in the list MUST NOT save anything and MUST return the form with the literal text "Dinos qué pasa con este negocio", keeping the comment that had already been written. The comment MUST always be treated as plain text —never interpreted as markup, neither when saved nor when displayed— and MUST be rejected if it exceeds 300 characters, with the literal text "El comentario es muy largo (máximo 300 caracteres)". An empty comment or one of only spaces MUST be saved as "no comment", not as a string of spaces. If the report cannot be saved because of a server failure, the resident MUST see the literal text "No pudimos enviar tu reporte. Vuelve a intentarlo en un momento." without any technical detail.

**The comment kept after an error MUST NOT travel in the URL**, because what a resident writes about a business would end up in the browser history and in the log of any proxy: the return address carries only the error code, and the draft is kept in a short-lived cookie (at most a couple of minutes), marked `HttpOnly`, `SameSite=Lax`, `Secure` whenever the site is served over HTTPS and scoped with `Path` to the form route of that card, which is deleted as soon as the report is submitted successfully. That cookie MUST be bounded by the server before being written, so that no long comment produces an oversized header; a value that is not the one the server wrote MUST leave the field empty, never break the page, and the draft MUST always be rendered escaped inside the field.

**The route the resident returns to is rebuilt by the server** from the business it found in the database, both on confirmation and when returning with an error: the submission MUST NOT be able to dictate where it redirects or what `Path` the draft cookie carries. A field or argument of the submission that purports to set a destination MUST be ignored entirely, so that no foreign address ever reaches the redirect or the cookie header.

#### Scenario: submission without choosing a reason

- **WHEN** the resident taps "Enviar reporte" without selecting any option
- **THEN** no report is saved and they see "Dinos qué pasa con este negocio", with the comment they had written still in the field

#### Scenario: what the resident wrote does not stay in the address

- **WHEN** the resident submits the form without a reason with a written comment
- **THEN** the address they return to carries only the error code, the text comes back from a short-lived cookie —`HttpOnly`, `SameSite=Lax`, `Secure` on HTTPS and scoped to the form route of that card— and that cookie is deleted as soon as the report is submitted successfully

#### Scenario: tampered draft

- **WHEN** a request arrives with the draft replaced by something the server did not write, for example text with markup or garbage
- **THEN** the form is shown with the field empty or with that content escaped as text, without breaking and without interpreting any tag

#### Scenario: the submission does not choose where to return

- **WHEN** a report submission arrives with extra fields or arguments pointing to a foreign site (`https://evil.example`, `//evil.example`, or values with line breaks or cookie attributes inside)
- **THEN** none changes the destination: either the response is the 404 for an unusable identifier, or it returns to the route of that same card, which the server builds, and no cookie goes out with a `Path` or a domain other than its own

#### Scenario: reason outside the list

- **WHEN** a submission with an invented reason that is not in the closed list arrives directly at the server
- **THEN** no report is saved and the response is the same reason error, without a server error

#### Scenario: comment too long

- **WHEN** the submission carries a comment of more than 300 characters
- **THEN** no report is saved and the resident sees "El comentario es muy largo (máximo 300 caracteres)"

#### Scenario: comment that looks like markup

- **WHEN** someone submits `<script>alert(1)</script>` as the comment with a valid reason
- **THEN** the report is saved with that text as is and, when the admin reads it in the admin panel, they see it as plain text: no tag is interpreted on any screen

#### Scenario: comment of only spaces

- **WHEN** the resident submits a valid reason and a comment of only spaces
- **THEN** the report is saved without a comment, not with a string of spaces

### Requirement: The report submission confirms in plain Spanish and gives nothing away

An accepted report MUST be confirmed with the literal text "¡Gracias por avisarnos! Vamos a revisar este negocio." and a way back to the card with the literal text "Volver a la ficha". The confirmation MUST NOT say how many reports that business has, nor whether it had already been reported, nor what will happen to the card, nor promise a reply to whoever reported (who is anonymous and left no way of contact). Reloading the confirmation screen MUST NOT create another report.

#### Scenario: report submitted

- **WHEN** the resident picks "Ya cerró" and taps "Enviar reporte"
- **THEN** they see "¡Gracias por avisarnos! Vamos a revisar este negocio." and the link "Volver a la ficha", which returns them to the business's card

#### Scenario: the confirmation tells nothing about the business

- **WHEN** a resident reports a business that already had pending reports
- **THEN** they see exactly the same confirmation as if it were the first, without counts or hints of what the admin will do

#### Scenario: reloading the confirmation does not duplicate

- **WHEN** the resident reloads the confirmation screen
- **THEN** no additional report is created

### Requirement: Report anti-abuse without captcha: honeypot, per-IP quota and pending cap per business

The report form MUST be protected against automated submissions without captcha and without friction (PRD §8), with three defenses:

1. **Trap field (honeypot)** invisible to people and not announced by screen readers: a submission with that field filled in MUST NOT save anything and MUST show exactly the same confirmation as a legitimate report, so as not to give the trap away.
2. **Per-IP quota**: 3 reports per hour from the same IP. When it is exhausted, the submission MUST NOT save anything and the resident MUST see the literal text "Ya recibimos varios reportes desde aquí. Espera un rato y vuelve a intentar." The IP is read with the same declared-header policy that registration already uses: if the deployment does not declare which header is the trusted one, NO header is trusted and this quota simply does not operate, leaving the other two defenses. The report quota MUST be its own counter: exhausting it MUST NOT prevent registering a business, nor the other way around.
3. **Cap of pending reports per business**: when a business already accumulates 10 unattended reports, subsequent submissions about that same card MUST NOT be saved; whoever reports MUST see the same confirmation as always, because the business is already flagged and nothing is lost by not noting it again.

Both limits MUST be enforced **without a race window**: the cap is decided in the same operation that saves the report, and the per-IP quota is checked and reserved in a single step. A handful of simultaneous submissions MUST NOT be able to leave more than 10 unattended reports on a single card, nor more than 3 reports from the same IP in the hour, and all of them MUST receive the response they would have gotten had they arrived one by one.

No submission blocked by any of the three defenses MUST write anything to the database or leave the report content in the server log.

#### Scenario: bot that fills the honeypot

- **WHEN** a report submission arrives with the trap field filled in
- **THEN** no report is saved and whoever submitted sees the same confirmation as a legitimate report

#### Scenario: per-IP quota exhausted

- **WHEN** a fourth report arrives from the same IP within the same hour
- **THEN** nothing is saved and the resident sees "Ya recibimos varios reportes desde aquí. Espera un rato y vuelve a intentar."

#### Scenario: no IP header declared

- **WHEN** the server runs without the variable that declares the trusted header and many reports arrive
- **THEN** the per-IP quota blocks no one (a header written by the sender is not trusted), but the honeypot and the per-business cap keep operating

#### Scenario: the report quota does not consume the creation one

- **WHEN** a resident exhausts their report quota for the hour and right away registers a business from the same IP
- **THEN** the registration is processed normally, because each quota keeps its own count

#### Scenario: business with the pending cap reached

- **WHEN** a business already has 10 unattended reports and another report arrives about that same card
- **THEN** no new report is saved and whoever reported sees the usual confirmation, without learning of the cap

#### Scenario: many reports at the same time

- **WHEN** fourteen simultaneous reports arrive about the same card, each from a different IP, and eight simultaneous ones from a single IP about another card
- **THEN** the first card ends with exactly 10 unattended reports and the second with exactly 3, all submissions see the response that corresponds to them and none reveals there was a cap

#### Scenario: the honeypot does not bother people

- **WHEN** a resident fills in the form with a keyboard or with browser autofill
- **THEN** the trap field stays empty and their report is processed normally

### Requirement: No data is requested or stored about the reporter

The report form MUST NOT ask for name, phone, email or any other data about whoever reports, and the system MUST NOT store any: the only things persisted from a report are the business it points to, the reason, the optional comment, its state and its dates. The IP is used **only in memory** for the hourly quota, exactly as in registration: it MUST NOT remain in any table or in the server log, nor MUST a derived version of it be stored. The report content MUST NOT be written to the log. The draft that keeps the comment after an error lives only in the browser of whoever wrote it, expires on its own and MUST NOT be stored on the server.

#### Scenario: the form does not ask for reporter data

- **WHEN** the report form is reviewed
- **THEN** its only fields are the reason, the optional comment and the invisible trap field

#### Scenario: nothing about the reporter is stored

- **WHEN** a freshly created report is reviewed in the database
- **THEN** it carries the business, the reason, the comment, the state and the dates, and no data or identifier of whoever submitted it

#### Scenario: the IP is neither persisted nor logged

- **WHEN** the database and the server log are reviewed after several reports
- **THEN** no IP appears nor any value derived from it, nor the content of the comments

### Requirement: A report changes nothing public

Reports MUST be invisible outside the admin panel: a reported business stays published exactly the same (PRD §6.3: moderation is done by the admin, not by report volume). NO report MUST unpublish, hide, reorder or mark a card automatically, and no public surface —the card, the category listing, the trade and trade+zone pages, the results page and the sitemap— MUST show, neither on screen nor in the response HTML, how many reports a business has, their reasons or their comments. After submitting a report, the card MUST look the same as before to any resident.

#### Scenario: the reported card stays the same

- **WHEN** a published business receives several reports and another resident opens its card
- **THEN** they see it exactly as before: still published, with its seal "Negocio verificado", without a report notice and in the same place of its listing

#### Scenario: no auto-unpublishing

- **WHEN** a business accumulates the cap of pending reports
- **THEN** its state remains `published` and only the admin, from the admin panel, can decide what to do

#### Scenario: no trace of reports in the public HTML

- **WHEN** the HTML of the reported card, of its listing, of its trade pages and of a results page that includes it is inspected
- **THEN** no count, reason or comment of reports appears

### Requirement: "Perdí mi enlace" button on the card, toward the admin's WhatsApp

Each published card MUST offer, at the end and in clearly lesser hierarchy than the contact buttons, a block headed with the literal text "¿Es tu negocio?" and a control with the literal text "Perdí mi enlace" that opens WhatsApp with the **admin's** conversation and the message already written, literally: "Hola, soy de «<nombre del negocio>» en enmirumbo y perdí el enlace para editar mi ficha. Les escribo desde el número que registré, ¿me lo pueden pasar?" (PRD §6.4 and §7 Flow D: the admin verifies that whoever writes does so from the registered number and resends or generates a new one for them).

The admin's number MUST be read from a server environment variable: it MUST NOT be written in the code, nor in the seeds, nor in the tests (public repo + LFPDPPP, PRD §8). If that variable is missing or its value cannot be interpreted as a 10-digit Mexican number, the block MUST NOT be rendered: no broken links or example numbers. The control MUST NOT appear on the listing cards or in the search results, and MUST NOT promise that the link arrives by itself: a person sends it.

#### Scenario: asking for the link from the card

- **WHEN** the owner of "Tacos del Güero" opens their card and taps "Perdí mi enlace"
- **THEN** it leaves toward WhatsApp with the admin's conversation and the message "Hola, soy de «Tacos del Güero» en enmirumbo y perdí el enlace para editar mi ficha. Les escribo desde el número que registré, ¿me lo pueden pasar?" already written, not sent

#### Scenario: no admin number configured

- **WHEN** the site runs without the admin's WhatsApp environment variable, or with a value that does not normalize to 10 digits
- **THEN** the card is shown complete but without the block "¿Es tu negocio?" or the control "Perdí mi enlace", and no broken link or invented number appears

#### Scenario: the admin's number does not live in the repo

- **WHEN** the code, the seeds and the test suites are reviewed
- **THEN** no real admin WhatsApp number appears: only the reading of the environment variable

#### Scenario: the control does not compete with the contact

- **WHEN** a resident opens a card
- **THEN** "Enviar WhatsApp" is still the main action and "Perdí mi enlace" clearly looks secondary, at the end of the card

#### Scenario: only on the card

- **WHEN** the listing cards and the search results cards are reviewed
- **THEN** none shows "Perdí mi enlace"

### Requirement: An edit awaiting review does not show through on any public surface

While an edit awaits review, the directory MUST keep showing **exactly the published version** (PRD §6.4: "Mientras tanto, la ficha sigue mostrando la versión anterior"). No proposed data MUST appear in the card, in the category listing, in the zone filter, in the search results, in any count or in the HTML of any response. The search MUST keep finding the business by what is published, not by what is proposed. Nor MUST there be any signal that an edit is waiting: neither a label, nor an "actualizando", nor an observable difference between a card with a pending edit and one without it.

#### Scenario: the card keeps showing what is published

- **WHEN** a business with a pending edit that changes its name, its opening hours and its phone appears on its card
- **THEN** the published name, opening hours and phone are seen, and none of the proposed values is in the response HTML

#### Scenario: the search does not find what is proposed

- **WHEN** a business published as "Estética Lupita" has a pending edit that renames it "Estética Lupita y Asociados", and a resident searches "asociados"
- **THEN** it does not find it by that term, and it still finds it when searching "estetica"

#### Scenario: nothing gives away that changes are waiting

- **WHEN** the card and the listing card of a business with a pending edit are compared against those of one without it
- **THEN** there is no visible difference nor in the HTML that makes it possible to know which one has changes under review

### Requirement: Search box on the home page that works without client-side JavaScript

The home page MUST show, above the categories, a search box that is a GET-submit form toward the results page, so that it works without client-side JavaScript. The field MUST have an associated visible label with the literal text "Busca lo que necesitas", an example inside the field with the literal text "ej. plomero, tacos, futbol infantil" and a submit button with the literal text "Buscar". The field and the button MUST be at least 44px in their smaller dimension. The search box MUST NOT add a heading of its own: the home page keeps a single `h1` and its second-level headings remain those of categories, sports and registration.

AMENDED (amendment approved by the founder, visual review batch 2): on a phone, the field and the "Buscar" button MUST be stacked —the field at full width and the button below, also at full width— and MUST only sit on the same row when the screen has room for both. This applies equally to the home page search box and to the one repeated by the results page.

#### Scenario: the search box stacks on a phone

- **WHEN** the resident opens the home page, or the results page, in a 390px viewport
- **THEN** the field takes up the whole available width and the "Buscar" button goes whole below the field, without clipping and without squeezing the field

#### Scenario: searching from the home page

- **WHEN** the resident types "plomero" in the home page search box and taps "Buscar"
- **THEN** they reach the results page of that search, with the word they typed reflected in the URL

#### Scenario: the search box works without JavaScript

- **WHEN** the resident searches with client-side JavaScript disabled
- **THEN** the submission resolves the same, because the search box is a server GET form and not a control with client behavior

#### Scenario: labeled and tappable field

- **WHEN** someone goes through the home page with a screen reader or uses it on a phone
- **THEN** the search field is announced with its visible label "Busca lo que necesitas", shows the example "ej. plomero, tacos, futbol infantil" and both the field and the "Buscar" button have at least 44px of touch area

#### Scenario: the home page hierarchy does not change

- **WHEN** the home page HTML is inspected with the search box in place
- **THEN** there is still exactly one `h1` and the second-level headings remain those of categories, sports and registration, without hierarchy jumps

### Requirement: Results page with the same cards as the listing

The search MUST be resolved on a page of its own with the query in the URL, headed with the literal text `Resultados para "<lo que escribió el vecino>"` as the only `h1`, showing each business found with the same card as the category listing (photo or placeholder, name, zone, tag "A domicilio" when it applies and green WhatsApp button that opens the conversation directly). The order MUST be the same as the listing: most recently published first and, on ties, by name. The page MUST repeat the search box at the top with what the resident typed already in the field, so they can correct it without going back. The displayed query text MUST be trimmed if it is extremely long, and MUST be shown as text, never interpreted as markup.

#### Scenario: results of a search

- **WHEN** the resident searches "plomero" and there are matching published businesses
- **THEN** they see the heading `Resultados para "plomero"` and one card for each business found, with the same look and the same WhatsApp button as in the category listing

#### Scenario: correcting the search without going back

- **WHEN** the resident reaches the results and wants to search for something else
- **THEN** they see at the top the same search box with "plomero" already typed in the field, change it and search again without leaving the page

#### Scenario: deterministic order

- **WHEN** several published businesses match the search
- **THEN** the most recently published appear first and, among those published the same day, by name; the order is the same every time the search is repeated

#### Scenario: the query is shown as text

- **WHEN** someone searches for something that looks like markup, for example `<b>plomero</b>`
- **THEN** the page shows it as plain text in the heading and interprets no tag

### Requirement: With no results, the page offers the categories as an alternative

When the search finds no published business, the page MUST NOT be left empty: it MUST say so with the literal text `No encontramos negocios para "<lo que escribió el vecino>".`, invite trying another way with the literal text "Prueba con otra palabra o elige una categoría:" and offer the 8 catalogue categories as large buttons that lead to their listing, the same as those on the home page.

#### Scenario: search without matches

- **WHEN** the resident searches "veterinario espacial" and no published business matches
- **THEN** they see `No encontramos negocios para "veterinario espacial".`, the phrase "Prueba con otra palabra o elige una categoría:" and the eight category buttons that lead to their listings

#### Scenario: a search with no results is not an error

- **WHEN** a search finds nothing
- **THEN** the response is a normal page (not a 404 nor an error) and keeps the search box at the top with what the resident typed

### Requirement: The search covers name, keywords and trades, and only what is published

The search MUST find businesses by the business name, by the keywords the business wrote in "¿Qué ofreces?" and by the trades the admin assigned to it (PRD §6.2 and Appendix B), so that whoever types "plomero" finds the business even if its category is "Servicios del hogar". A term may match in any of those three places. The search MUST return only businesses in the `published` state: those in `in_review` or `rejected` MUST NOT appear in the results nor leak any of their data into the page HTML, exactly as in the listings.

#### Scenario: finds by keywords even if the category is another

- **WHEN** the resident searches "plomero" and there is a published business in the category "Servicios del hogar" that wrote "plomería, destape de drenajes" in "¿Qué ofreces?"
- **THEN** that business appears in the results

#### Scenario: finds by business name

- **WHEN** the resident searches for a word from the name of a published business
- **THEN** that business appears in the results even if that word is not in "¿Qué ofreces?" nor in its trades

#### Scenario: finds by trade assigned by the admin

- **WHEN** the admin assigned the trade "Comida corrida" to a published business and the resident searches "comida", even though that word is neither in the name nor in the business's "¿Qué ofreces?"
- **THEN** that business appears in the results

#### Scenario: unpublished businesses never appear

- **WHEN** the resident searches a term that matches a business in `in_review` and another `rejected`
- **THEN** neither appears in the results and none of their data is in the page HTML

#### Scenario: published business without trades

- **WHEN** a published business does not have trades assigned yet (the admin has not reviewed it in the admin panel yet)
- **THEN** it is still found by its name and by its keywords, without error

### Requirement: Case- and accent-insensitive matching, and partial by word stem

The search MUST ignore case, accents and punctuation, both in what the resident types and in what the business stored, and MUST match partially by the stem of each word, so that "plomero" finds the one with "plomería" and the one with "plomeria", and "futbol" the club that wrote "fútbol" (PRD §6.2). When the resident types several words with content, only the businesses that match all of them MUST be found, regardless of in which of the three places (name, keywords or trades) each one appears. The search MUST NOT do relevance ranking, synonyms or typo correction.

Before applying the cap on searched terms and before requiring all of them, the search MUST discard the **filler words**: a short, fixed list of words with which the resident states their question but that do not describe the business they are looking for —articles, prepositions and conjunctions ("el", "la", "de", "en", "con", "que"…), question pronouns and adverbs ("quien", "me", "mi", "donde", "cerca", "hay"…), the generic verbs of "¿quién hace X?" ("necesito", "busco", "arregla", "repara", "vende"…) and "tizayuca", which discriminates no business because the whole site is about Tizayuca—. The discarding has to happen before the term cap so that the useful word is not left out of the quota when the resident writes in a hurry ("quien me arregla la cerrajería"). Removing a filler word can only WIDEN the results, never narrow them, because a condition stops being required. If the query is made of only filler words, they MUST be searched as is, so that the resident sees that nothing was found instead of the empty-query notice.

#### Scenario: case and accents do not matter

- **WHEN** the resident searches "PLOMERÍA", "plomeria" or "Plomería"
- **THEN** all three return the same businesses

#### Scenario: "plomero" finds "plomería"

- **WHEN** the resident searches "plomero" and there is a published business that wrote "plomería" and another that wrote "plomeria"
- **THEN** both appear in the results

#### Scenario: "futbol" finds the "fútbol" club

- **WHEN** a mom searches "futbol" and there is a published club that wrote "fútbol infantil de 6 a 12 años"
- **THEN** that club appears in the results

#### Scenario: several words are all required

- **WHEN** the resident searches "futbol infantil" and one business matches both words while another matches only "futbol"
- **THEN** only the one that matches both appears

#### Scenario: the "ñ" does not break the search

- **WHEN** the resident searches "pinatas" and there is a published business that wrote "piñatas"
- **THEN** that business appears in the results

#### Scenario: filler words do not reduce the results

- **WHEN** the resident searches "cerrajeria en Tizayuca" or "quien me arregla la cerrajeria"
- **THEN** they see the same businesses as when searching only "cerrajeria", because "en", "tizayuca", "quien", "me", "arregla" and "la" are discarded before the terms are required

#### Scenario: query of only filler words

- **WHEN** the resident searches only "quien me" or "necesito uno"
- **THEN** the page searches those terms as is and shows the notice that no businesses were found, not the empty-query notice

### Requirement: Empty query and hostile terms bounded, without error

An empty, absent or only-spaces query MUST NOT search anything nor list the whole directory: the page MUST be shown with the literal heading "¿Qué estás buscando?" as the only `h1`, the literal notice "Escribe qué necesitas y te decimos quién lo hace en Tizayuca.", the empty search box and the 8 categories as an alternative. The query MUST be bounded before touching the database: its length is trimmed, the number of searched terms is limited and everything that is not a letter or digit is discarded (including search wildcards and characters of other alphabets), so that no query —however long, odd or malicious— produces a server error or returns results that do not belong.

#### Scenario: empty or only-spaces query

- **WHEN** someone opens the results page without a query, with an empty query or typing only spaces
- **THEN** they see "¿Qué estás buscando?", the notice "Escribe qué necesitas y te decimos quién lo hace en Tizayuca.", the empty search box and the categories, with no business listed and no error

#### Scenario: extremely long query

- **WHEN** someone searches a string of thousands of characters
- **THEN** the page responds normally (with or without results), without a server error, and the heading does not repeat the whole string

#### Scenario: characters that would be wildcards in a search

- **WHEN** someone searches `%` or `_`
- **THEN** the whole directory is not returned: the query is treated as empty and the notice to type what they need is shown

#### Scenario: odd alphabets and symbols

- **WHEN** someone searches only emojis or characters of another alphabet
- **THEN** the page responds without error and, since no searchable term remains, shows the empty-query notice

#### Scenario: repeated query in the URL

- **WHEN** the URL carries the search parameter more than once
- **THEN** the first value is used and the page responds normally

### Requirement: The results page is not indexable

The results page MUST declare `noindex` in its robots metadata (allowing its links to be followed), because query URLs are not the SEO pages of PRD §8 —those are the trade and trade+zone ones of E5— and must not compete with them or generate duplicate content.

#### Scenario: results page metadata

- **WHEN** a search engine crawls the results page of any query
- **THEN** it finds the instruction not to index it, and it can follow the links to the businesses' cards

#### Scenario: the directory pages stay indexable

- **WHEN** the home page, a category listing and a card are reviewed
- **THEN** none was marked as non-indexable

### Requirement: Own title and description on each directory page, with its canonical

Each public directory page MUST declare its own title and its own description, instead of inheriting the site's, and MUST declare its absolute canonical URL. The texts are:

- **Category listing:** title `«Categoría» en Tizayuca`; description `«Categoría» en Tizayuca: negocios de aquí, verificados uno por uno, que contactas directo por WhatsApp.`
- **Trade page:** title `«Frase del giro» en Tizayuca`; description `«Frase del giro» en Tizayuca: negocios verificados que contactas directo por WhatsApp, sin intermediarios.`
- **Trade and zone page:** title `«Frase del giro» en «Colonia», Tizayuca` (without repeating "Tizayuca" when the zone name already contains it); description `«Frase del giro» en «Colonia»: negocios verificados de Tizayuca que contactas directo por WhatsApp.`
- **Card:** title `«Nombre del negocio» en «Colonia», Tizayuca` or, if the business has no zone, `«Nombre del negocio» en Tizayuca`; description: what the business wrote in "¿Qué ofreces?", trimmed if long, and if it wrote nothing, `«Nombre del negocio» en «Colonia», Tizayuca. Negocio verificado que contactas directo por WhatsApp.`

The category listing with a zone filter applied (`?colonia=`) MUST declare as canonical the unfiltered listing, so as not to compete with the trade+zone pages nor duplicate content.

The description MUST NOT include the business's WhatsApp or phone, nor any internal data of the card. Since "¿Qué ofreces?" is free text, not reading those fields is not enough: the description MUST also hide the sequences of seven or more digits the business may have written inside that text —allowing between them the separators with which a phone number is written— replacing them with `…`. The business name is NOT altered: it is the card's identity and the admin reviews it on approval.

#### Scenario: each page with its own title

- **WHEN** the listing `/servicios-del-hogar`, the page `/plomeria`, the page `/plomeria-huicalco` and the card of a business are reviewed
- **THEN** each one declares a title and a description different from one another and different from the site's, and none keeps those of the layout

#### Scenario: card description with what the business wrote

- **WHEN** the resident shares the card of a business that wrote "Plomería, destape de drenajes y bombas de agua." in "¿Qué ofreces?"
- **THEN** the page description is that text, and does not include its WhatsApp or its phone

#### Scenario: a number written inside "¿Qué ofreces?"

- **WHEN** a published business wrote "Plomería 24 horas, llámanos al 771 000 0000." and someone shares its card or a search engine crawls it
- **THEN** the page description says "Plomería 24 horas, llámanos al …", while the card keeps showing people the full text as it was written

#### Scenario: card without "¿Qué ofreces?"

- **WHEN** the business did not fill in "¿Qué ofreces?"
- **THEN** the description is the fallback phrase with its name and its zone, not an empty description

#### Scenario: the filtered listing does not compete with the trade pages

- **WHEN** a search engine crawls `/servicios-del-hogar?colonia=huicalco`
- **THEN** it finds `/servicios-del-hogar` as canonical, without the filter

#### Scenario: absolute canonicals

- **WHEN** the canonical of any indexable directory page is reviewed
- **THEN** it is an absolute URL built with the site's public URL, not a relative path nor a local address

### Requirement: The card looks good when shared over WhatsApp or Facebook

Each published card MUST declare Open Graph data so that the link preview shows something useful when shared (PRD §9: each card is distributed as an individual link): title and description the same as the page's, the canonical URL, the site name and the Mexican Spanish language, and an image. The image MUST be the business's photo when it exists, with its address built from the internal reference the server generated; when the business has no photo —or what is stored is not a valid reference—, the site's own brand image MUST be used, so that **no card is shared without an image** and no foreign address can end up as `og:image`. The preview MUST NOT add the business's WhatsApp or phone.

#### Scenario: card with a photo

- **WHEN** a published business has a photo and someone shares its card
- **THEN** the preview uses that photo, with the card's title and description

#### Scenario: card without a photo

- **WHEN** a published business has no photo and someone shares its card
- **THEN** the preview uses the site's brand image, it is not left without an image

#### Scenario: photo reference not generated by the server

- **WHEN** a published card has an external address or an arbitrary string stored as its photo and someone shares its card
- **THEN** the preview uses the site's brand image and that address does not appear in the response

#### Scenario: the image is declared with an absolute URL

- **WHEN** the Open Graph data of any card is reviewed
- **THEN** the image and the URL are absolute, built with the site's public URL

#### Scenario: the preview does not hand out the number

- **WHEN** the Open Graph data of a card is reviewed
- **THEN** neither the WhatsApp nor the landline of the business appears

### Requirement: Each published card emits Schema.org LocalBusiness

Each published card MUST emit JSON-LD structured data of type `LocalBusiness` (PRD §8) with what is honest to publish: the business name, the canonical URL of its card, its category and its trades, the zone as the only location reference —inside an address that declares Tizayuca, Hidalgo, México—, the description with what it wrote in "¿Qué ofreces?" if it wrote it —with the long digit sequences hidden just as in the meta description— and its photo if it has one, with the address built from the internal reference the server generated. If the business has no photo, or what is stored is not a valid reference, the block MUST be emitted without an image rather than emit an address the site did not build.

The markup MUST respect the realistic expectation of PRD §8: _"al publicar colonia (no dirección exacta) y horario en texto libre, el markup será parcial; el horario estructurado queda para fases posteriores (§12)"_. Consequently it MUST NOT emit: the opening hours, the address or references text the business entered, coordinates, nor the WhatsApp or the phone (finding M5 of T-004: do not hand out the numbers in machine-readable format). Nor MUST it be emitted on cards that are not published, nor on the listings.

The content the business wrote MUST be escaped inside the data block: a name or a "¿Qué ofreces?" with markup inside MUST NOT be able to close the block or execute anything.

#### Scenario: published card with structured data

- **WHEN** a search engine reads the card of a business published in the zone "Huicalco" with the trade "Plomería"
- **THEN** it finds a valid JSON-LD block of type `LocalBusiness` with its name, the card URL, the zone, "Tizayuca" and "Hidalgo" as location, and its category and its trade

#### Scenario: never the exact address nor the number

- **WHEN** the JSON-LD of a business that entered an address or references, a landline and opening hours is reviewed
- **THEN** none of those three data points appears in the structured data block, even though the card does show them to people

#### Scenario: business without a catalogue zone

- **WHEN** a published business was left with an unnormalized "Otra" zone
- **THEN** the JSON-LD block is still emitted, with Tizayuca as location and without inventing a zone, and nothing breaks

#### Scenario: name with markup inside

- **WHEN** a published business is called `Tacos </script><script>alert(1)</script>`
- **THEN** the structured data block remains a single valid block, the markup is seen as text inside the datum and nothing executes

#### Scenario: only on published cards

- **WHEN** the listings, the trade pages and the response of a card in `in_review` are reviewed
- **THEN** none has business structured data

#### Scenario: the block's image is always built by the site

- **WHEN** the JSON-LD of a published card with a photo and that of another whose photo reference is not one the server generates are reviewed
- **THEN** the first declares the image built by the site and the second is emitted without an image, without taking any address from what is stored

### Requirement: Directory in Server Components, mobile-first and usable without JavaScript

The home page, the category listings, the trade and trade+zone pages, the cards, the search box, the results page and **the report page with its confirmation** MUST be Server Components and MUST NOT add client-side JavaScript of their own (PRD §8, budget of <2s on 4G). The card's JSON-LD does not count as client-side JavaScript: it is a data block, not executable code. Nor does the script of the cookieless analytics provider, which is a third party's and is injected by the trunk of the public pages (`base-layout` capability): these pages only declare events with markup attributes, without code of their own around them. All pages MUST look complete in a 390px viewport without horizontal scroll, with touch areas of at least 44px on every tappable element, and MUST remain navigable with client-side JavaScript disabled, including the zone filter, the search, the navigation between the trade and trade+zone pages and the submission of a report.

#### Scenario: no client-side JS

- **WHEN** the files of the home page, the listing, the trade and trade+zone pages, the listing card, the card, the search box, the results page and the report page are reviewed
- **THEN** none declares `"use client"` nor adds a client bundle of its own

#### Scenario: phone at 390px

- **WHEN** a resident opens the home page, a listing, a trade page, a trade+zone one, a card, a results page and the report form in a 390px viewport
- **THEN** everything looks complete and legible, without horizontal scroll, and every tappable element is at least 44px in its smaller dimension

#### Scenario: navigation without JavaScript

- **WHEN** the resident goes through home → search → results → card → WhatsApp, home → category → zone filter → card → trade → trade+zone → WhatsApp, and card → report → submit → confirmation, with client-side JavaScript disabled
- **THEN** the three complete journeys work the same, because each step is a link or a server-resolved form

### Requirement: Public URLs carry the state and the municipality (v2)

Added in v2 — source: ADR 0007, PRD §3 (Flow F), PRD §8.

Every public route that shows the data of a locality (home, category listings, trade and trade+zone pages, search, cards, report routes, registration and edit routes) MUST be served under two positional segments of one host: `/{estado}/{municipio}/...`, for example `/hidalgo/tizayuca/plomeria-haciendas-de-tizayuca`. The paths written without that prefix in the requirements and scenarios of this specification are relative to it. Every route handler MUST resolve the locality from the path before doing anything else. All internal links MUST include the prefix. The admin panel stays at `/admin` (ADR 0010).

#### Scenario: a listing under the locality

- **WHEN** a resident opens `/hidalgo/tizayuca/plomeria-haciendas-de-tizayuca`
- **THEN** they see the plumbing listing of the zone Haciendas de Tizayuca, with only the published businesses of Tizayuca

#### Scenario: a card under the locality

- **WHEN** a resident opens the card of a published business of Tizayuca
- **THEN** its URL is `/hidalgo/tizayuca/negocio/<slug>-<id>`

#### Scenario: the same path without the prefix

- **WHEN** someone opens `/plomeria-haciendas-de-tizayuca` while one locality is active
- **THEN** it does not render the listing: it answers 404 (only `/` redirects, see the next requirements)

#### Scenario: links keep the prefix

- **WHEN** the links of a home, a listing and a card are reviewed
- **THEN** all internal links to categories, trades, cards, search and registration start with `/hidalgo/tizayuca/`

### Requirement: Unknown or inactive state and municipality answer 404 (v2)

Added in v2 — source: ADR 0006, ADR 0007. Amended on 2026-10-15 by decision of the product owner: the database holds only the states and municipalities of the localities it serves (`data-model`, "The database holds only the reference data of the localities it serves (v2)"); until then it held INEGI's full catalogue.

A state or municipality that the database does not hold, or that it holds but has no active locality, MUST answer 404 on every public route, with the site's 404 page. Only active localities are served.

#### Scenario: a state that does not exist

- **WHEN** someone opens `/atlantida/tizayuca/`
- **THEN** the answer is 404 with the site's 404 page

#### Scenario: a municipality the database does not hold

- **WHEN** someone opens `/hidalgo/pachuca-de-soto`, a real municipality that the directory does not serve
- **THEN** the answer is 404

#### Scenario: a municipality that is not active

- **WHEN** someone opens the path of a municipality that is in the database but has no locality, or whose locality is not active
- **THEN** the answer is 404

#### Scenario: a municipality under the wrong state

- **WHEN** someone opens the path of an active municipality under a state that the database holds but that is not its own
- **THEN** the answer is 404

### Requirement: While there is one active locality, the root redirects to it (v2)

Added in v2 — source: ADR 0007, PRD §3 (Flow F), PRD §9. Amended on 2026-10-14 by decision of the product owner: there is no short alias (see "There is no short alias of a locality (v2)"); until then this requirement also redirected `/tizayuca`.

While exactly one locality is active, `/` MUST answer a 301 redirect to that locality (`/hidalgo/tizayuca` for Tizayuca). No locality chooser is shown in the interface: the locality cookie, `?elegir=` and `?cambiar` change nothing, and `/` sets no cookie.

The destination MUST come from the locality record, never from the code. Because where the root leads changes when a second locality is activated, the redirect MUST tell browsers to keep it for an hour at most (`Cache-Control: max-age=3600`); a 301 without it stays in a browser for good.

#### Scenario: the root

- **WHEN** someone opens `/` and only Tizayuca is active
- **THEN** the answer is a 301 to `/hidalgo/tizayuca`

#### Scenario: no chooser

- **WHEN** the home of Tizayuca is reviewed while it is the only active locality
- **THEN** it offers no control to change locality

#### Scenario: a cookie or a choice changes nothing

- **WHEN** someone opens `/` with a locality cookie of another municipality, `/?elegir=hidalgo/tizayuca` or `/?cambiar` while only Tizayuca is active
- **THEN** each answer is the same 301 to `/hidalgo/tizayuca`, and none sets a cookie

#### Scenario: read from the record

- **WHEN** the only active locality is a fixture locality with another state and municipality
- **THEN** `/` redirects to its own `/{estado}/{municipio}`

#### Scenario: browsers ask again

- **WHEN** the redirect of `/` is read
- **THEN** it carries `Cache-Control: max-age=3600`

### Requirement: There is no short alias of a locality (v2)

Added in v2 — source: decision of the product owner, 2026-10-14; amends ADR 0007.

Public URLs always carry the state and the municipality. A path of a single segment that is not a page of the site, such as the municipality slug alone (`/tizayuca`), MUST answer 404 with the site's 404 page, whatever the number of active localities and whatever cookie the request carries. Printed material and shared links use the full path (`/hidalgo/tizayuca`).

#### Scenario: the municipality slug alone

- **WHEN** someone opens `/tizayuca` while none, one or two localities are active
- **THEN** the answer is 404, never a redirect

### Requirement: With two or more active localities the root lists them and never redirects by location (v2)

Added in v2 — source: ADR 0007, PRD §3 (Flow F).

When two or more localities are active, `/` MUST show the list of localities, each linking to its home, and MUST NOT redirect automatically based on the visitor's location. The decision rests on advice that content must not adapt itself to the visitor's IP and on the fact that crawlers request from another country.

The list is headed "¿En qué municipio buscas?" and says "Elige tu municipio y te enseñamos los negocios de ahí. La próxima vez te llevamos directo.". Each entry names the municipality and its state, read from the locality record, in the order of the state slug and then the municipality slug, and is a link with a touch area of at least 44px. The link of an entry leads to its home through the choice (`/?elegir={estado}/{municipio}`, see "The chosen locality is remembered in a cookie that holds only its slug (v2)"), so following it is choosing; it works without JavaScript. The page belongs to no locality (`base-layout`, "Pages outside a locality name no locality (v2)"). Because what `/` answers depends on each visitor's cookie, and the highlight on their location, the list MUST carry `Cache-Control: no-store`.

#### Scenario: the list

- **WHEN** someone with no locality cookie opens `/` and two localities are active
- **THEN** the answer is 200 with the list of both localities, each naming its municipality and state and linking through the choice to its home, with `Cache-Control: no-store` and no cookie

#### Scenario: a crawler gets the same list

- **WHEN** a request that Cloudflare locates in the United States opens `/`
- **THEN** it gets the same list with a 200, not a redirect

### Requirement: With no active locality the root says the directory is coming (v2)

Added in v2 — source: decision of the product owner, 2026-10-14.

While no locality is active, as in production before the launch, `/` MUST answer 200 with the notice that the directory is being built ("Estamos armando el directorio de negocios de tu colonia."), whatever cookie or query the request carries. It MUST NOT answer an error: the deploy smoke test and the availability check request it. Once the list of localities exists, this case is reviewed again.

#### Scenario: production before the launch

- **WHEN** someone opens `/` and no locality is active
- **THEN** the answer is 200 with the notice that the directory is being built, and `/tizayuca` answers 404

### Requirement: Geolocation is only a suggestion of the nearest locality (v2)

Added in v2 — source: ADR 0007, PRD §3 (Flow F), PRD §8.

On the list of localities, the one nearest to the visitor MUST be highlighted using the approximate location that Cloudflare attaches to each request. The highlight is a suggestion: the visitor can choose any locality. When the request carries no location, the list MUST appear without any highlight. The approximate location MUST NOT be stored.

The distance is measured, along the Earth's surface, from the approximate location to the municipal seat of each active locality, whose coordinates the locality record keeps from INEGI (`data-model`, "The locality is a first-class record keyed by the INEGI municipality code (v2)"). A locality without coordinates MUST be listed like any other but never highlighted; when no active locality has coordinates, nothing is highlighted. On a tie, the first in the order of the list wins. The highlighted entry carries the label "Te queda más cerca" and a stronger border, and stays a link to the choice like the others: the highlight is never a choice and stores nothing. The location is used for that answer only: it is never written to the database, a cookie or the logs.

#### Scenario: the nearest is highlighted

- **WHEN** a request located near Tizayuca opens `/` and Tizayuca and a second locality are active
- **THEN** both appear in the list and Tizayuca is visibly highlighted, with a 200 answer

#### Scenario: no location

- **WHEN** the request carries no approximate location
- **THEN** the list appears with no highlighted locality

#### Scenario: a locality without coordinates

- **WHEN** a request located next to an active locality that has no coordinates opens `/`, while Tizayuca has its seat's
- **THEN** that locality is listed but not highlighted, and Tizayuca, the nearest locality with coordinates, is

#### Scenario: the location is not stored

- **WHEN** the database, the cookies and the logs are reviewed after those requests
- **THEN** no coordinates or city of the visitor were stored

### Requirement: The chosen locality is remembered in a cookie that holds only its slug (v2)

Added in v2 — source: ADR 0007, PRD §3 (Flow F), PRD §7.

When the visitor chooses a locality from the list, the system MUST store the choice in a cookie whose value is only the slug of that locality. Later visits to `/` with that cookie MUST redirect to that locality. A cookie whose slug is not an active locality MUST be ignored and the list shown.

Choosing is following the link of an entry, `/?elegir={estado}/{municipio}`. While two or more localities are active and that pair is an active locality, the answer MUST set the cookie and redirect to its home; any other value chooses nothing, sets no cookie and shows the list. The cookie is named `locality`; its value is the municipality slug (`tizayuca`), which is how the cookie names the locality; it is `Path=/`, lasts a year from the last choice (`Max-Age=31536000`), is `HttpOnly` (no script reads it; the public site has none), `SameSite=Lax` (so a link to the site shared on WhatsApp still honours the choice) and `Secure` whenever the site is served over HTTPS. A municipality slug is unique within its state only: a cookie whose slug names two active localities MUST be ignored like a stale one.

The redirect of a choice and the one of a later visit MUST be a 302 with `Cache-Control: no-store`, never a 301: it differs from one visitor to another and changes as soon as the visitor chooses again, so no browser or cache may keep it. A stale cookie is ignored, not deleted.

#### Scenario: choosing

- **WHEN** the visitor chooses Tizayuca from the list
- **THEN** the response sets a cookie whose value is `tizayuca` and nothing else
- **AND** it is a 302 to `/hidalgo/tizayuca` with `Cache-Control: no-store`, and the cookie is `locality=tizayuca; Max-Age=31536000; Path=/; HttpOnly; SameSite=Lax`, plus `Secure` over HTTPS

#### Scenario: coming back

- **WHEN** the visitor opens `/` with that cookie while two localities are active
- **THEN** they are redirected to `/hidalgo/tizayuca`
- **AND** the redirect is a 302 with `Cache-Control: no-store`

#### Scenario: a stale cookie

- **WHEN** the visitor opens `/` with a cookie whose slug is not an active locality
- **THEN** the cookie is ignored and the list is shown

#### Scenario: a choice that names no active locality

- **WHEN** someone opens `/?elegir=hidalgo/pachuca-de-soto`, whose locality is not active, while two localities are active
- **THEN** the answer is the list with a 200 and no cookie

#### Scenario: the same slug in two states

- **WHEN** two active localities share the municipality slug of the cookie
- **THEN** the cookie is ignored and the list is shown; choosing from the list still tells them apart by their state

### Requirement: The pages of a locality offer to change municipality while two or more are active (v2)

Added in v2 — source: ADR 0007, PRD §3 (Flow F).

While two or more localities are active, the footer of every page of a locality MUST offer the link "Cambiar de municipio", with a touch area of at least 44px, to `/?cambiar`, which shows the list of localities even to a visitor whose cookie names one. Choosing again replaces the cookie; leaving the list without choosing keeps it. While a single locality is active the link MUST NOT appear, and `/?cambiar` redirects like `/`. Pages outside a locality do not show it. Like every public page, the footer may show or hide the link up to a minute after a locality is activated or deactivated ("Public pages may show a change up to a minute late (v2)").

#### Scenario: changing

- **WHEN** a visitor whose cookie names Tizayuca taps "Cambiar de municipio" on a page of Tizayuca while two localities are active
- **THEN** they see the list at `/?cambiar`, and choosing the other locality takes them to its home and replaces the cookie

#### Scenario: one active locality

- **WHEN** the footer of a page of Tizayuca is read while it is the only active locality
- **THEN** it has no link to change municipality

### Requirement: The search endpoint has a per-IP quota (v2)

Added in v2 — source: ADR 0012, PRD §8, prototype backlog E5-5. Amended on 2026-10-15 by EMR-36: the limit, the window, the message and the answer over the quota, which were not settled. Amended on 2026-10-15 by EMR-71: the scenario of the first search over the quota counted the 61st, a leftover of an earlier limit; with 100 searches it is the 101st.

The search MUST have its own per-IP quota, separate from the quotas of registration, edits, reports and SMS, to hold back the mass harvesting of the directory. The counter is kept as described in "Anti-abuse counters live in a Durable Object and never in PostgreSQL (v2)", which also says how the address is read. A request over the quota MUST NOT run the query, MUST NOT produce a server error and MUST show a message in plain Spanish asking to try again later. Exhausting this quota MUST NOT affect any other surface.

The quota is **100 searches per address in a window of 10 minutes** (decision of the product owner, 2026-10-15), which starts with the first search of that address: enough for a resident who corrects a search and pages through its results, and for the neighbours who share one address behind their carrier, but not for a script that walks the directory one query after another. Only a request that would run the query counts, each page of results included: the empty query, which runs none ("Empty query and hostile terms bounded, without error"), and the other pages of the site never count. Over the quota the page MUST answer `429` with `Retry-After` (the seconds left in the window) and `Cache-Control: no-store`, inside the layout and without an error page: the heading `Resultados para "<lo que escribió el vecino>"`, the search box with what was typed, the literal text "Recibimos muchas búsquedas desde aquí. Espera un rato y vuelve a intentar." and, since the listings are not held back, the literal text "Mientras, puedes ver los negocios por categoría:" with the 8 category buttons. When the counter cannot answer, the search runs as if it were within the quota: the quota may fail to count, never turn into an error.

#### Scenario: within the quota

- **WHEN** a visitor searches fewer times than the quota allows in its window
- **THEN** every search runs normally

#### Scenario: over the quota

- **WHEN** the same IP exceeds the quota of the search in its window
- **THEN** the query is not run, the resident sees the message and no error page, and no results are returned

#### Scenario: the 101st search

- **WHEN** an address searches for the 101st time within 10 minutes of its first search
- **THEN** the answer is a `429` with `Retry-After` and `Cache-Control: no-store`, showing "Recibimos muchas búsquedas desde aquí. Espera un rato y vuelve a intentar." and the 8 categories, and no business

#### Scenario: what is not counted

- **WHEN** an address over the search quota opens the empty results page, a card or a listing
- **THEN** they answer normally, because only a search that runs the query counts

#### Scenario: the counter does not answer

- **WHEN** the counter of the quotas fails or cannot be reached
- **THEN** the search runs and shows its results, without an error

#### Scenario: independent counters

- **WHEN** an IP exhausts its search quota and then sends a report
- **THEN** the report is processed normally, and the other way round

#### Scenario: no IP is stored

- **WHEN** the quota is exceeded and the database is reviewed
- **THEN** it holds no IP and no value derived from it

### Requirement: The name of the locality is a filler word of its own search (v2)

Added in v2 — source: PRD §5, ADR 0006.

"Case- and accent-insensitive matching, and partial by word stem" discards "tizayuca" because the whole site was about Tizayuca. With several localities, the search of a locality MUST discard instead the words of that locality's name, read from the locality record and normalized like the query, exactly as it discards the other filler words: before the term cap, and only while another word remains. No locality name MAY be written in the list of filler words. For Tizayuca the results are the ones that requirement describes; the name of another locality is a word like any other.

#### Scenario: the name of the locality being searched

- **WHEN** a resident searches "cerrajeria en «name of the locality»"
- **THEN** they see the same businesses as when searching only "cerrajeria"

#### Scenario: the name of another locality

- **WHEN** a resident of Tizayuca searches "cerrajeria pachuca"
- **THEN** "pachuca" is required like any other word with content

### Requirement: Heading levels never skip (v2)

Added in v2 — source: PRD §8 (minor debt), prototype backlog (h1 to h3 jump in the listing cards).

On every public page the heading levels MUST go down one level at a time. In particular, the name of a business in a listing card or a result MUST be an `h2` under the page's `h1`, never an `h3`.

#### Scenario: a listing

- **WHEN** the headings of a category listing are read in order
- **THEN** the first is the `h1` and the names of the businesses are `h2`, with no jump

#### Scenario: results and card pages

- **WHEN** the headings of the results page, of a card and of the home are read in order
- **THEN** none goes down more than one level at a time

### Requirement: The photo of an unpublished business is referenced on no public surface (v2)

Added in v2 — source: ADR 0011, PRD §6.8. Amended on 2026-10-18 by the decision of the product owner of that date: the photos are served from the environment's media hostname, under the `photos/` prefix of its public media bucket.

Photos are served from the environment's media hostname (`deployment`, "Public media live in R2, in one bucket for production and one for dev and stage (v2)"), under `photos/` and opaque keys generated by the server, without invoking the Worker. The key of a photo MUST appear only on the surfaces of a published business: listing, card, share preview image and structured data. The key of the photo of a business in `in_review` or `rejected`, or of one that was unpublished, MUST appear on no public page, sitemap or structured data. The bucket MUST NOT list its contents through that hostname. Because the key is opaque and unguessable, no per-request check of the business state exists.

#### Scenario: a published card

- **WHEN** a resident opens the listing and the card of a published business with a photo
- **THEN** the image URLs point to the environment's media hostname with the opaque key, the listing at the `card` size and the card, its share preview and its structured data at the `full` one

#### Scenario: a registration in review

- **WHEN** the public HTML, the sitemap, the share preview and the structured data are reviewed while a business with a photo is in `in_review`
- **THEN** the key of its photo appears in none of them

#### Scenario: unpublishing

- **WHEN** the admin unpublishes a card with a photo
- **THEN** from then on no listing, card, result, sitemap or structured data references its photo key

#### Scenario: the bucket does not list

- **WHEN** someone requests the root of the media hostname or a prefix
- **THEN** no list of keys is returned

### Requirement: "Perdí mi enlace" opens WhatsApp to the admin of the card's locality (v2)

Added in v2 — source: ADR 0006, ADR 0021, PRD §3 (Flows C and D). Amended on 2026-10-15 by EMR-37: what replaces the environment variable of the prototype requirement when the number cannot be used.

The button "Perdí mi enlace" MUST open WhatsApp to the contact WhatsApp stored in the locality record of the card, not to a global number. In the prototype requirement of the button, the number is that record's, not a server environment variable, and the scenario "the admin's number does not live in the repo" holds for it: no code, seed or test holds a real one. An active locality always has a contact WhatsApp (`data-model`); when the stored one does not normalize to a Mexican number of 10 digits, the card MUST show neither the block "¿Es tu negocio?" nor the control, as the prototype requirement says for a missing variable, and stays complete.

#### Scenario: Tizayuca

- **WHEN** an owner taps "Perdí mi enlace" on a card of Tizayuca
- **THEN** WhatsApp opens to the contact WhatsApp of the locality of Tizayuca

#### Scenario: another locality

- **WHEN** a second locality is active with a different contact WhatsApp and an owner taps "Perdí mi enlace" on one of its cards
- **THEN** WhatsApp opens to the contact WhatsApp of that locality

#### Scenario: a number that cannot be dialled

- **WHEN** the contact WhatsApp of a card's locality does not normalize to 10 digits
- **THEN** the card is shown complete, with "Reportar este negocio", but without "¿Es tu negocio?" or "Perdí mi enlace", and no broken link or invented number appears

### Requirement: The honeypot of the report form is trimmed before it is checked (v2)

Added in v2 — source: prototype debt (docs/backlog.md, "Deuda menor registrada").

The value of the honeypot field of the report form MUST be trimmed before it is checked. A value that is empty or only whitespace counts as empty and the report proceeds. Any other value counts as filled and the submission is handled as described in the honeypot requirement of the report.

#### Scenario: whitespace only

- **WHEN** a report arrives with the honeypot containing only spaces
- **THEN** the honeypot counts as empty and the report is processed normally

#### Scenario: a filled honeypot

- **WHEN** a report arrives with the honeypot containing text
- **THEN** nothing is saved and the resident sees the same confirmation as a legitimate report

### Requirement: Public pages may show a change up to a minute late (v2)

Added in v2 — source: ADR 0005, decision of 2026-10-14.

The public pages read through the cached Hyperdrive binding, whose results may be up to 60 seconds old and are not invalidated by writes. So a card the admin publishes, unpublishes, edits or permanently deletes, and a zone the admin hides or renames, MAY keep its previous state on the public pages (listings, counts, the zone filter, the home page, the trade pages, the search results, the card itself and `sitemap.xml`) for up to 60 seconds. After that, every rule of "Only what is published is shown" applies in full; where it says "on the next request" and "without waiting for any cache to expire", this requirement wins and the limit is 60 seconds. The admin panel says so after each of those actions (`admin-review`, "The panel says that a change takes up to a minute to reach the site (v2)").

#### Scenario: an unpublished card

- **WHEN** the admin unpublishes a card and the public pages are opened right away and again a minute later
- **THEN** right away the card may still appear, and a minute later it appears nowhere and its URL answers the usual 404

#### Scenario: a permanently deleted card

- **WHEN** the admin permanently deletes a card
- **THEN** within a minute no public page shows its data, and its URL answers the usual 404

### Requirement: An outdated card URL redirects to its current URL (v2)

Added in v2 — source: ADR 0007, EMR-34.

The URL of a card is `/{estado}/{municipio}/negocio/<slug>-<id>`. The identifier is what follows the last hyphen: the ten characters of `data-model`, "The card is identified by a short random id (v2)". The slug is the business's current name in lowercase ASCII words joined by hyphens, without accents (`ñ` becomes `n`) and with everything else dropped; a name that leaves no slug gives the identifier alone. The canonical URL, the sitemap and every link name that current URL.

In "Business card at its own URL with the registered information and the verified seal", a card URL whose readable part does not match the business's current name still shows the card: it MUST answer a 301 redirect to the card's current URL, so a link shared over WhatsApp keeps working and search engines index one URL per card. Any other readable part redirects: an earlier name, a typo, the name with its accents or the identifier alone. Because the name can change again, even back to an earlier one, the redirect MUST tell browsers to keep it for an hour at most (`Cache-Control: max-age=3600`), like the one of the root; it does not depend on the visitor. Only a published card of the locality of the URL redirects: a segment without an identifier, an identifier that does not exist, a card of another locality, and a card in review, rejected or deleted answer the same 404 ("Only what is published is shown"), so a redirect never reveals a card that is not published.

#### Scenario: an earlier name

- **WHEN** someone opens `/hidalgo/tizayuca/negocio/plomeria-el-nombre-de-antes-<id>` and the published card `<id>` of Tizayuca is now named "Plomería Los Fontaneros Ficticios"
- **THEN** the answer is a 301 to `/hidalgo/tizayuca/negocio/plomeria-los-fontaneros-ficticios-<id>` with `Cache-Control: max-age=3600`
- **AND** following it, they see the card

#### Scenario: the identifier alone

- **WHEN** someone opens `/hidalgo/tizayuca/negocio/<id>` of a published card
- **THEN** the answer is the same 301 to its current URL

#### Scenario: a card that is not published

- **WHEN** someone opens, with any readable part, the identifier of a card in review, rejected or deleted
- **THEN** they get the 404 of a card that does not exist, without a redirect

#### Scenario: a card of another locality

- **WHEN** the identifier of a published card of another locality is opened under `/hidalgo/tizayuca/negocio/`
- **THEN** they get the same 404 as for an identifier that does not exist

### Requirement: Only the WhatsApp buttons of the card and the listing card are measured (v2)

Added in v2 — source: ADR 0014 (amended on 2026-10-15), PRD §6.4.

`base-layout`, "Two product events and the no-results tag are recorded, only in production (v2)", allows two event names, those of the two WhatsApp buttons, each with the locality and the category as its only properties. So in "The listing card brings the essentials and WhatsApp without extra taps" and "Contact buttons on the card with WhatsApp as the main action", the two WhatsApp buttons keep their events, `whatsapp-listing` and `whatsapp-card`, with the locality in place of the zone; the events `call` and `directions` are not sent, and no event carries a `zone`. The WhatsApp button of the listing card MUST declare `whatsapp-listing`, and "Enviar WhatsApp" on the card `whatsapp-card`, each with the locality (`{estado}/{municipio}`) and the slug of the business's own category, never the page's, on the link itself, since both open a new tab. "Llamar", "Cómo llegar" and the link to the registered page declare no event; with no event, "Llamar" needs no wrapping element. Where the measurement is off, no element carries an event attribute, and every button works the same. The two WhatsApp events stay apart, so the clicks of the card over its page views remain the PRD §10 metric ("The card view is measured on its own, without custom instrumentation").

#### Scenario: WhatsApp from a listing card

- **WHEN** a resident taps the WhatsApp button of the listing card of a "Belleza" business of Tizayuca, in production with a Website ID, on a listing or on the results page
- **THEN** `whatsapp-listing` is recorded with the locality `hidalgo/tizayuca` and the category `belleza`, and nothing else about the business

#### Scenario: WhatsApp from the card

- **WHEN** a resident taps "Enviar WhatsApp" on the card of a "Talleres" business of Tizayuca, in production with a Website ID
- **THEN** `whatsapp-card` is recorded with the locality `hidalgo/tizayuca` and the category `talleres`, and nothing else about the business

#### Scenario: the other buttons of the card

- **WHEN** the HTML of a card with "Llamar", "Cómo llegar" and a registered page is reviewed, with the measurement on
- **THEN** only "Enviar WhatsApp" carries event attributes

#### Scenario: the measurement off

- **WHEN** a card or a listing card is shown where the measurement is off
- **THEN** no element carries an event attribute, and every button works the same

### Requirement: Directory lists show 20 cards per page, with "Ver más" to the next (v2)

Added in v2 — source: decision of the product owner, 2026-10-15; PRD §6 (listings, filters and pagination work with server HTML).

The category listing, the trade and trade and zone pages and the results page MUST show at most 20 cards per page, in their order. Page 1 is the URL without `pagina`; page n is the same URL with `?pagina=n`, n being 2 or more and written without leading zeros. While a next page exists, a link with the literal text "Ver más" MUST follow the last card and lead to it; the last page MUST NOT show it. "Ver más" is a link, so it works without client-side JavaScript; it is neutral, never the action green, and its touch area is at least 44px.

Any other value of `pagina` (`1`, `0`, `-1`, `01`, `2.5`, an empty value or text) and a page past the last MUST answer 404 with the site's 404 page, so no list has a second URL for the same page or a page of nothing. Page 1 always answers, and shows its empty state when the list has nothing.

On a category listing, the zone filter is kept from page to page (`?colonia=<zona>&pagina=n`), and the zone options lead to page 1 of each zone. Each page of an indexable list declares its own URL as canonical, with its `pagina` after the first, which amends "Every page declares its title, description, canonical and share preview (v2)" in `base-layout` ("its own address without a query"); a category listing with a zone filter keeps declaring the listing without the filter, whatever its page ("Own title and description on each directory page, with its canonical"). Every page of a list has the same `h1`, title and description. `sitemap.xml` lists only page 1 of each list.

#### Scenario: a listing longer than a page

- **WHEN** a resident opens a category listing with 21 published businesses
- **THEN** they see the 20 most recently published and, after the last, "Ver más", which leads to `?pagina=2`
- **AND** with client-side JavaScript disabled, tapping it shows the 21st, in the same order

#### Scenario: the last page

- **WHEN** the resident reaches the page of a list that holds its last cards, or a list of 20 cards or fewer
- **THEN** no "Ver más" is shown

#### Scenario: past the last page

- **WHEN** someone opens `?pagina=3` of a list that has two pages, or `?pagina=2` of a list that fits on one
- **THEN** they see the 404 page in Spanish and the response has status code 404

#### Scenario: a page number that is not one

- **WHEN** someone opens a listing with `?pagina=1`, `?pagina=01`, `?pagina=0` or `?pagina=abc`
- **THEN** the answer is the site's 404, and the listing itself is the URL without `pagina`

#### Scenario: the zone filter is kept

- **WHEN** the resident filters a category listing by a zone with more than 20 published businesses of that category and taps "Ver más"
- **THEN** they reach `?colonia=<zona>&pagina=2`, with the businesses of that zone only

#### Scenario: each page names itself

- **WHEN** the canonical of page 2 of the listing `/servicios-del-hogar` is read
- **THEN** it is the absolute URL of `/servicios-del-hogar?pagina=2`, while page 2 of `/servicios-del-hogar?colonia=huicalco` declares `/servicios-del-hogar`

#### Scenario: a search longer than a page

- **WHEN** a search finds 25 published businesses
- **THEN** page 1 shows the 20 most recent and "Ver más", which leads to `?q=…&pagina=2`, where the other 5 are shown without "Ver más", with the same query in the heading and in the search box

### Requirement: An empty trade and zone page leads back only to a trade page with published businesses (v2)

Added in v2 — source: EMR-33, reconciling two scenarios of the same requirement.

In "Trade pages without published businesses are neither indexed nor linked, but are not 404 either", the trade and zone page without published businesses offers "Ver todas las colonias" to the whole trade page, and no page may link to a trade page without published businesses. So the link MUST appear only while the trade has at least one published business in the locality, wherever its zone; otherwise the empty state shows its message alone. The zone navigation follows the same rule: it is shown only when at least one zone has published businesses of the page, and then "Todas las colonias" leads to a page with them. Its zones are listed in catalogue order.

#### Scenario: the trade has businesses in other zones

- **WHEN** the resident opens `/plomeria-atempa`, and the only published plumbing business is in Huicalco
- **THEN** they see "Todavía no hay negocios publicados de esto en esta colonia." and "Ver todas las colonias", which leads to `/plomeria`

#### Scenario: the trade has no businesses at all

- **WHEN** the resident opens `/box-huicalco`, and no published business has the trade "Box"
- **THEN** they see the message, and no link leads to `/box`

### Requirement: A zone whose name repeats in its locality is shown with its settlement type (v2)

Added in v2 — source: decision of the product owner, 2026-10-15; `data-model`, "Zones belong to a locality, and Tizayuca's come from the SEPOMEX postal catalogue (v2)".

Two zones of a locality may share a name, when SEPOMEX lists it with two settlement types, and a zone may be named like its municipality. Wherever a public page shows a catalogue zone, it MUST show its display name: the zone's name followed by its settlement type in brackets, as stored and in sentence case ("El Carmen (Colonia)", "El Carmen (Fraccionamiento)", "Tizayuca (Unidad habitacional)", "Tizayuca (Zona industrial)"), when its name is also the name of another zone of the same locality, hidden ones included, or the name of the locality; and its name alone otherwise. Names are compared ignoring case, accents and punctuation. The display name MUST be decided from the zones and the locality as they are stored, never from a list of names in the code, so adding or renaming a zone changes the display names by itself.

It covers the listing card, wherever it is shown; the zone filter of a category listing and the zone navigation of the trade pages; the heading, title and description of a trade and zone page, which, like any zone that already says the locality's name, does not repeat the locality after it ("Taller mecánico en Tizayuca (Zona industrial)"); and the card, with its title, description, structured data and the zone that "Cómo llegar" searches for. The free text of a zone "Otra" is no catalogue zone, and is shown as the business wrote it. Slugs, and so URLs, never change.

#### Scenario: two zones with the same name

- **WHEN** a resident sees the zone filter of a listing with published businesses in both zones named "El Carmen"
- **THEN** the options read "El Carmen (Colonia)" and "El Carmen (Fraccionamiento)", each leading to its own zone, and the cards of those businesses show the same names

#### Scenario: a zone named like its municipality

- **WHEN** the resident opens the card of a business in the zone "Tizayuca" of type "Zona industrial"
- **THEN** the card shows "Tizayuca (Zona industrial)", and its title is "«Nombre del negocio» en Tizayuca (Zona industrial)"

#### Scenario: the trade and zone page

- **WHEN** the resident opens `/taller-mecanico-zona-industrial-tizayuca`
- **THEN** its heading is "Taller mecánico en Tizayuca (Zona industrial)", at the same URL

#### Scenario: a name that repeats nowhere

- **WHEN** a business is in the zone "Huicalco", whose name no other zone of Tizayuca has
- **THEN** every page shows "Huicalco", without a type

#### Scenario: a renamed zone

- **WHEN** the admin renames a zone with the name of another zone of its locality
- **THEN** both are shown with their type from then on, with no change to the code or to their slugs

### Requirement: The results page lives under its locality and names it from the record (v2)

Added in v2 — source: ADR 0007, ADR 0006, EMR-36.

The results page of "Results page with the same cards as the listing" is `/{estado}/{municipio}/buscar?q=<lo que escribió el vecino>`, with `buscar` a reserved segment (`data-model`, "The slugs of the catalogues do not produce ambiguous URLs at the root of a locality (v2)"), and finds only the published businesses of its locality; its search box submits there. The notice of "Empty query and hostile terms bounded, without error" MUST read the municipality from the locality record: "Escribe qué necesitas y te decimos quién lo hace en {municipio}.", which for Tizayuca is the literal of that requirement. Its category buttons lead to the listings of the same locality. Its title is static and names only the locality, `Buscar en {municipio}`, never what was typed (`base-layout`, "The measurement carries no personal data or text typed by people"). "The results page is not indexable" is met with `<meta name="robots" content="noindex, follow">` and no canonical, while `robots.txt` keeps excluding the page (`base-layout`, "The open `robots.txt` allows the public site and excludes what is not relevant (v2)").

What the page shows of the query —in the heading, the notice of no results and the search box— is cut to 80 characters as a person sees them, never in the middle of an emoji or an accented letter; control and format characters become a space, so a right-to-left override cannot turn the heading around, and a letter buried under stacked accents is shown as the letter. The heading and the notice mark the cut with "…"; the search box does not, so correcting the search never resubmits it. Only the first `q` of the address is read.

#### Scenario: the notice of another locality

- **WHEN** the empty results page of a fixture locality is rendered
- **THEN** it says "Escribe qué necesitas y te decimos quién lo hace en «municipality of the fixture».", its category buttons lead under its own `/{estado}/{municipio}` and "Tizayuca" appears nowhere

#### Scenario: the title does not carry the query

- **WHEN** the resident searches "quiero abogado por mi divorcio" in Tizayuca
- **THEN** the title is "Buscar en Tizayuca — enmirumbo", the page declares `noindex, follow` and no canonical

#### Scenario: a query with invisible characters

- **WHEN** the query carries a NUL, a line break or a right-to-left override between its letters
- **THEN** the heading shows those letters separated by spaces, and reads in the order they were typed

### Requirement: A search with no results tags its page view (v2)

Added in v2 — source: decision of the product owner, 2026-10-15; ADR 0014 (amended on 2026-10-15). It replaces the event "search with no results" of `base-layout` (see "Two product events and the no-results tag are recorded, only in production (v2)").

Where the measurement is on (`base-layout`, "Cookieless measurement is loaded only in production and only when configured (v2)"), the results page of a search that found no published business MUST load the Umami script with `data-tag="search-no-results"`. The server knows there are no results when it renders the page, so the measurement needs no JavaScript of the site and no count on the server: Umami filters the tagged page views, and they are compared with the views of all the results pages. The tag is a fixed word, so the text searched never reaches Umami, neither in the tag nor in the address, which leaves without its query (`data-exclude-search`), nor in the static title. A page with results, the empty-query page and a page over the quota carry no tag. Where the measurement is off there is no script, so there is no tag either.

#### Scenario: a search with no results in production

- **WHEN** a resident of Tizayuca searches "veterinario espacial" in production with a Website ID, and nothing is found
- **THEN** the page view is recorded with the tag `search-no-results` and the address `/hidalgo/tizayuca/buscar`, without the query

#### Scenario: a search with results

- **WHEN** the search finds businesses, or the query is empty, or the address is over the quota
- **THEN** the page view carries no tag

#### Scenario: the measurement off

- **WHEN** a search finds nothing where the measurement is off
- **THEN** the page has no script and no tag

### Requirement: The home of a locality lives under it and names it from the record (v2)

Added in v2 — source: ADR 0007, PRD §3 (Flow B), PRD §5, EMR-32.

The home page of "The home page shows the 8 categories as large buttons", "Highlighted "Deporte en Tizayuca" block on the home page" and "Search box on the home page that works without client-side JavaScript", and the home of `base-layout`, "Home of the site inside the layout, with the entry to registration", is the home of each active locality, `/{estado}/{municipio}`; what `/` answers is said by "While there is one active locality, the root redirects to it (v2)" and the requirements that follow it. Every text of the home that names the locality MUST read it from the locality record (`base-layout`, "Every text that names the locality reads it from the locality record (v2)"): the `h1` "¿Qué necesitas en {municipio}?", the heading "Deporte en {municipio}" and the question "¿Tienes un negocio en {municipio}?", which for Tizayuca are the literals of those requirements. Its category buttons and the entry of the sports block lead to the listings of the same locality, its search box submits to the results page of the same locality ("The results page lives under its locality and names it from the record (v2)"), and its registration entry leads to the registration page of the same locality.

The sports block highlights a category, not a page of its own: its entry "Ver clubes y escuelas deportivas" leads to the listing of the category "Clubes y escuelas deportivas", the same page as that category's button. Its decorative icon is the emoji of that category, the same one its button shows, and its entry is a secondary action, never the action green.

The home keeps the site's title and description in the locality (`base-layout`, "Server Component with a document in es-MX and base metadata": "enmirumbo — Encuentra negocios y servicios en {municipio}") and declares its own path as its canonical; it is indexable and `sitemap.xml` lists it. It reads the categories through the cached connection, like every public page ("Public pages may show a change up to a minute late (v2)").

#### Scenario: the home of Tizayuca

- **WHEN** a resident opens `/hidalgo/tizayuca`
- **THEN** they see "¿Qué necesitas en Tizayuca?", the search box, which submits to `/hidalgo/tizayuca/buscar`, the 8 categories, each leading to `/hidalgo/tizayuca/<categoría>`, and "Deporte en Tizayuca", whose entry leads to `/hidalgo/tizayuca/clubes-y-escuelas-deportivas`

#### Scenario: the home of another locality

- **WHEN** the home of a fixture locality is opened
- **THEN** it reads "¿Qué necesitas en «municipality of the fixture»?" and "Deporte en «municipality of the fixture»", its links and its search box lead under its own `/{estado}/{municipio}`, and "Tizayuca" appears nowhere

#### Scenario: the metadata of the home

- **WHEN** the metadata of the home of Tizayuca are read
- **THEN** its title is "enmirumbo — Encuentra negocios y servicios en Tizayuca", it declares no `noindex`, and its canonical is the absolute URL of `/hidalgo/tizayuca`

### Requirement: The server validates the report's reason and comment, and keeps the draft without a cookie (v2)

Added in v2 — source: decision of the product owner, 2026-10-14; `legal-pages`, "The privacy notice lists the cookies (v2)". It replaces "The server validates the report's reason and comment", which kept the draft in a short-lived cookie: the privacy notice lists exactly two cookies, and a third would make it false.

All the report validation MUST happen on the server, because the form works without JavaScript and because a submission can arrive directly, without going through the page. The reason MUST be exactly one value of the closed list: a submission without a reason, with an empty reason, with several reasons or with a value that is not in the list MUST NOT save anything and MUST return the form with the literal text "Dinos qué pasa con este negocio". The comment MUST always be treated as plain text —never interpreted as markup, neither when saved nor when displayed— and MUST be rejected if it exceeds 300 characters, with the literal text "El comentario es muy largo (máximo 300 caracteres)". The characters are counted as the field's `maxlength` counts them: what surrounds the comment is trimmed first, and a line break counts as one character and is kept as one, although browsers send it as two. A NUL character, which no person types and the database cannot store, is dropped. An empty comment or one of only spaces MUST be saved as "no comment", not as a string of spaces. The reason is checked before the comment. If the report cannot be saved because of a server failure, the resident MUST see the literal text "No pudimos enviar tu reporte. Vuelve a intentarlo en un momento." without any technical detail, and the log MUST record only the kind of failure, never the comment.

**The draft is kept without a cookie.** When the form comes back with an error —the reason, the comment, the per-IP quota or a server failure— the server MUST render it again in its answer to that same submission, with the reason the resident had chosen, when it is one of the list, and the comment they had written, both read from that submission. What the resident wrote MUST NOT travel in the address, which carries only the name of the action, MUST NOT be kept in a cookie and MUST NOT be stored on the server. The comment shown again is bounded to 300 characters, never cutting a character in two, so a forged submission cannot make the page echo a large body, and it is always rendered escaped inside the field. That answer MUST carry the status of its error (400 for the reason and the comment, 429 over the quota, 500 for a failure), `Cache-Control: no-store` and no `Set-Cookie`. Each error is shown next to what it is about and announced as an alert: the reason's inside the group "¿Qué pasa?", the comment's under its help, and the quota's and the failure's above the form. No field is `required` in the markup, so a missing reason always reaches the server and its message.

#### Scenario: submission without choosing a reason

- **WHEN** the resident taps "Enviar reporte" without selecting any option
- **THEN** no report is saved and they see "Dinos qué pasa con este negocio", with the comment they had written still in the field

#### Scenario: what the resident wrote stays in neither the address nor a cookie

- **WHEN** the resident submits the form without a reason with a written comment, and then submits it with a reason
- **THEN** the first answer is the form again, with status 400, the comment in the field and an address that carries only the action; no answer sets a cookie, and the browser holds none at the end

#### Scenario: the chosen reason comes back too

- **WHEN** a report with the reason "Los datos están mal" comes back over the quota, or with a comment too long
- **THEN** "Los datos están mal" is still chosen and the comment is still in the field

#### Scenario: a draft that looks like markup

- **WHEN** a submission that comes back with an error carries `</textarea><script>alert(1)</script>` as its comment
- **THEN** the form shows that text escaped inside the field, and no tag is interpreted

#### Scenario: a forged comment of any length

- **WHEN** a submission forged without the form carries a comment of thousands of characters
- **THEN** no report is saved, the resident sees "El comentario es muy largo (máximo 300 caracteres)" and the field shows the first 300 characters

#### Scenario: reason outside the list

- **WHEN** a submission with an invented reason, or with two reasons, arrives directly at the server
- **THEN** no report is saved and the response is the same reason error, without a server error

#### Scenario: comment too long

- **WHEN** the submission carries a comment of more than 300 characters
- **THEN** no report is saved and the resident sees "El comentario es muy largo (máximo 300 caracteres)"

#### Scenario: line breaks count once

- **WHEN** a resident writes a comment of 300 characters that has line breaks
- **THEN** the report is saved with that comment and its line breaks

#### Scenario: comment that looks like markup

- **WHEN** someone submits `<script>alert(1)</script>` as the comment with a valid reason
- **THEN** the report is saved with that text as is and, when the admin reads it in the admin panel, they see it as plain text: no tag is interpreted on any screen

#### Scenario: comment of only spaces

- **WHEN** the resident submits a valid reason and a comment of only spaces
- **THEN** the report is saved without a comment, not with a string of spaces

#### Scenario: the report cannot be saved

- **WHEN** the database fails while a report is saved
- **THEN** the resident sees "No pudimos enviar tu reporte. Vuelve a intentarlo en un momento." with what they wrote still in the form, and the log names the kind of failure without the comment, the card or the address

### Requirement: The report form posts to its own address, which names the card (v2)

Added in v2 — source: ADR 0007, ADR 0019. It amends "Report mini-form without an account, with a closed-list reason and optional comment" on the 404 of an unusable identifier, and takes the place of the paragraph of the prototype requirement on validation that rebuilt the route on the server.

The form posts to the address of its own page, `/{estado}/{municipio}/negocio/<slug>-<id>/reportar`, with the server action of the report, and the server reads the card from that address, as the page does: no field of the submission names or chooses the card, and an address with an earlier name still reports its card. Only a published card of the locality of the address can be reported. A submission to an address whose identifier is unusable —invented, empty or not an identifier— or whose card is in review, rejected, deleted or of another locality MUST save nothing, spend no quota and answer the same 404 as the page of a card that does not exist, byte for byte and without a cookie, whatever it carries, the trap field included. There are no bound arguments a submission could add or change, so "a submission arriving with more arguments than the action declares" can only bring extra fields, which are ignored. The action reached any other way —posted from another page, or at its own endpoint `/_actions/report`— MUST save nothing and answer 404. A field of the submission that purports to set a destination is ignored: the server builds the address it answers with from the card it found in the database ("The report form lands on its thank-you page (v2)"), so no foreign address ever reaches a redirect or a header.

#### Scenario: an earlier name

- **WHEN** the resident opens the report form of a card through an address with the business's earlier name and submits a report
- **THEN** the report is about that card, and "Volver a la ficha" leads to its current address

#### Scenario: a tampered identifier

- **WHEN** a report submission arrives at the report address of a card in review, a rejected card, an identifier that does not exist or a segment without an identifier, with or without the trap field filled
- **THEN** the response is the same 404 as for a nonexistent card, byte for byte, without cookies, without writing anything to the database and without any server error

#### Scenario: the action reached from elsewhere

- **WHEN** the report action is posted to the home of a locality, or to `/_actions/report`
- **THEN** the answer is a 404 and no report is saved

#### Scenario: the submission does not choose where to return

- **WHEN** a valid report submission arrives with extra fields pointing to a foreign site (`https://evil.example`, `//evil.example`, or values with line breaks or cookie attributes inside)
- **THEN** none changes the destination: the answer is the thank-you page of that same card, which the server builds, and no cookie goes out

### Requirement: The report form lands on its thank-you page (v2)

Added in v2 — source: ADR 0007; `base-layout`, "The open `robots.txt` allows the public site and excludes what is not relevant (v2)", which names `/reportar/gracias`; `data-model`, "The slugs of the catalogues do not produce ambiguous URLs at the root of a locality (v2)", which reserves `reportar`.

A received report —saved, past the cap of pending reports or caught by the trap field, which MUST look the same— MUST be answered with a `303` to `/{estado}/{municipio}/reportar/gracias?negocio=<id>`, with `Cache-Control: no-store`, so that reloading the confirmation never sends the form again. That page shows "¡Gracias por avisarnos! Vamos a revisar este negocio." as its only `h1` and "Volver a la ficha", which leads to the card's current address, and nothing else about the card ("The report submission confirms in plain Spanish and gives nothing away"). It reads the card its address names, through the connection without cache, since it follows a write: when that is not a published card of the locality, or the parameter is missing or is not an identifier, it answers the same 404 as a card that does not exist. The report form and its thank-you page declare `noindex, follow` and no canonical, are left out of the sitemap and are disallowed by `robots.txt`; their titles are static, "Reportar este negocio" and "Gracias por avisarnos", and name neither the business nor anything the resident wrote.

#### Scenario: report submitted

- **WHEN** the resident picks "Ya cerró" and taps "Enviar reporte", with client-side JavaScript disabled
- **THEN** they land on `/{estado}/{municipio}/reportar/gracias?negocio=<id>` and see "¡Gracias por avisarnos! Vamos a revisar este negocio." and the link "Volver a la ficha", which returns them to the business's card

#### Scenario: reloading the confirmation

- **WHEN** the resident reloads the thank-you page
- **THEN** no report is created and the page is the same

#### Scenario: a thank-you address that names no card

- **WHEN** someone opens `/reportar/gracias` without `negocio`, with an invented identifier or with that of a card in review
- **THEN** they get the same 404 as for a card that does not exist

#### Scenario: neither page is indexed

- **WHEN** a search engine reads the report form or the thank-you page
- **THEN** both ask not to be indexed, declare no canonical, appear in no sitemap and are disallowed by `robots.txt`

### Requirement: The report's per-IP quota is counted in the quota counter (v2)

Added in v2 — source: ADR 0012; `deployment`, "Anti-abuse counters live in a Durable Object and never in PostgreSQL (v2)", which also says how the address is read. In "Report anti-abuse without captcha: honeypot, per-IP quota and pending cap per business" it replaces how the IP is read —a header declared by the deployment— and the scenario "no IP header declared".

The per-IP quota of the reports is its own purpose of the quota counter: 3 reports per address in a window of one hour that starts with its first counted report, counted apart from the search, the registration, the edits and the SMS. The counter checks and takes a report in one step, so simultaneous reports from one address are counted one by one. A request that carries no address of its visitor —only possible on a developer's machine— is not counted. Only a submission that would save a report counts: one that passed the trap field and the validation and is about a published card of the locality, saved or past the cap. So a bot caught by the trap, a form that comes back with a reason or comment error and a card that cannot be reported spend no quota. Over the quota, nothing is saved and the form comes back with the literal text "Ya recibimos varios reportes desde aquí. Espera un rato y vuelve a intentar.", the chosen reason and the comment, status `429` and `Cache-Control: no-store`. When the counter cannot answer, the report goes on as if it were within the quota: the quota may fail to count, never turn into an error, and the trap and the cap keep working.

#### Scenario: the fourth report of the hour

- **WHEN** an address that sent three reports this hour, about one card or several, sends a fourth
- **THEN** nothing is saved, the answer is a `429` with "Ya recibimos varios reportes desde aquí. Espera un rato y vuelve a intentar." and what the resident had chosen and written, and another address reports normally

#### Scenario: independent counters

- **WHEN** an address over its report quota searches, or an address over its search quota reports
- **THEN** the search runs, or the report is saved

#### Scenario: no address

- **WHEN** many reports arrive without the address of their visitor
- **THEN** the quota blocks none, while the trap field and the cap of pending reports keep working

#### Scenario: what does not count

- **WHEN** an address sends reports caught by the trap field, reports without a reason and reports about a card in review
- **THEN** none of them spends its quota

#### Scenario: the counter does not answer

- **WHEN** the counter of the quotas fails or cannot be reached
- **THEN** the report is saved, without an error

### Requirement: Each place shows the photo at its own size, from the address the server builds (v2)

Added in v2 — source: ADR 0011 (amended on 2026-10-18), PRD §8, EMR-35.

In "The listing card brings the essentials and WhatsApp without extra taps", "The card shows the business photo when it has one", "Only the photo generated by the server is rendered", "Photo weight does not break the 4G budget", "The card looks good when shared over WhatsApp or Facebook" and "Each published card emits Schema.org LocalBusiness", the address of a photo MUST be the environment's media base, `photos/`, the stored photo key and the variant, and only when the stored value has exactly the shape of a key the server generates (`data-model`, "A photo key is 24 characters of the identifier alphabet, and names two objects under `photos/` (v2)"); any other value is no photo. The media base is `MEDIA_URL`, or, locally, the local Worker's `/_media` (`deployment`, "Public media live in R2, in one bucket for production and one for dev and stage (v2)").

- The listing card MUST show the `card` variant, 400×400, with `width` and `height`, "Foto de <nombre del negocio>" as its alternative text and the size of its square slot, so it takes the same space as the placeholder. In every list (the listings and the results page, which are one column on a phone) the first card's photo MUST load at once and every other MUST carry `loading="lazy"`. No list MUST name the `full` variant.
- The card MUST show the `full` variant, 1200×900, above the name, with `width` and `height`, the same alternative text and a 4:3 box, so nothing moves when it loads.
- The share preview of a card with a photo MUST be its `full` variant, absolute, as `image/webp`, 1200×900, with "Foto de <nombre del negocio>" as its alternative text; its structured data MUST name the same address as its image.

#### Scenario: a listing with and without photos

- **WHEN** the resident opens a listing whose first card has a photo, whose second has none and whose third has one
- **THEN** the first shows its `card` photo loaded at once, the second the placeholder, and the third its `card` photo with lazy loading, each in the same square

#### Scenario: the card and its preview

- **WHEN** the card of a published business with a photo is opened and shared
- **THEN** it shows the `full` photo above the name, and its `og:image` and the image of its structured data are the absolute address of that photo

#### Scenario: locally

- **WHEN** a card with a photo is opened on the dev server or the preview
- **THEN** its photo comes from `/_media/photos/<photo key>/…` of the same origin, and its preview from that address made absolute with `SITE_URL`
