# Spec: admin-review

## Requirements

### Requirement: Panel access with a single environment password and a signed session

Superseded in v2 by The admin panel is protected by Cloudflare Access with one-time email codes (v2) — source: ADR 0010.

The panel MUST live under the route `/admin` and open only after typing the single password defined in an environment variable of the server (PRD §6.3), with no accounts, no email and no password recovery. The access screen MUST be headed with the literal text "Panel de revisión", ask for a single field with the label "Contraseña" and a button "Entrar". On success, the system MUST create a session held by a cookie signed by the server, with these attributes: `HttpOnly`, `SameSite=Lax`, scope limited to the panel route and `Secure` whenever the site is served over HTTPS (in production, always). The session MUST expire after 8 hours. The password MUST NOT travel inside the cookie or end up in the server log, not even partially. The panel MUST offer a button "Salir" that invalidates the session. Repeated failed attempts from the same source MUST be temporarily blocked, with the same anti-abuse criterion as PRD §8. The texts of the access screen MUST be, literally: "Contraseña incorrecta." on failure, "Demasiados intentos. Espera unos minutos y vuelve a intentar." when the attempts run out and "Cerraste sesión." on sign-out.

#### Scenario: enter the panel with the correct password

- **WHEN** the admin opens `/admin` without a session, types the configured password and taps "Entrar"
- **THEN** they reach the review queue and their browser stores a session cookie marked `HttpOnly` and `SameSite`, with scope limited to the panel route, whose content does not include the password

#### Scenario: wrong password

- **WHEN** someone types a password different from the configured one
- **THEN** they see "Contraseña incorrecta.", no session is created and they do not reach any panel screen

#### Scenario: tampered or expired cookie

- **WHEN** someone presents a session cookie with an altered signature, signed with another secret, or whose 8-hour expiry has already passed
- **THEN** the system treats it as if there were no session and sends them to the access screen

#### Scenario: sign out of the panel

- **WHEN** the admin taps "Salir"
- **THEN** they see "Cerraste sesión.", the cookie stops working and going back in the browser does not show any panel screen again

#### Scenario: repeated attempts

- **WHEN** more failed attempts than allowed in the configured window arrive from the same source
- **THEN** the following attempts are rejected with "Demasiados intentos. Espera unos minutos y vuelve a intentar.", even if the password sent is the correct one

#### Scenario: the password does not appear in the log

- **WHEN** the messages the server writes during a successful access and a failed one are reviewed
- **THEN** none contains the configured password or the one that was tried, nor the content of the cookie

### Requirement: Without a configured password the panel does not open (fail-safe)

Superseded in v2 by A deployed environment without Access configuration does not open the panel (v2) — source: ADR 0010.

If the password environment variable is missing, if it is empty, or if the secret used to sign sessions is missing, the panel MUST NOT open for anyone: no panel screen is shown, no session can be created and no state transition can be executed. The access screen MUST say so with the literal text "El panel no está disponible por ahora." and the detail of what is missing MUST stay only in the server log, never in the response. The system MUST NOT invent a default password or leave the panel open "only in development".

#### Scenario: no password configured

- **WHEN** the server runs without the password environment variable (or with it empty) and someone opens `/admin`
- **THEN** they see "El panel no está disponible por ahora." and there is no field that lets them in

#### Scenario: no signing secret

- **WHEN** the server runs with a password but without the session secret and someone types the correct password
- **THEN** no session is created and they keep seeing "El panel no está disponible por ahora."

#### Scenario: no default passwords

- **WHEN** the code and the panel configuration are reviewed
- **THEN** there is no default password, no mode that skips access in development, and no example value that works as a real password

#### Scenario: no transition without configuration

- **WHEN** with the panel unconfigured a request to approve or reject a registration is sent directly
- **THEN** nothing changes in the database and the response carries no data of the registration

### Requirement: Every panel screen and action requires a valid session

Superseded in v2 by Every admin request carries an Access token that the Worker verifies (v2) — source: ADR 0010.

Every panel page and every action on a registration —approve, reject, unpublish, **apply a pending edit, discard a pending edit, generate a new link**, mark a report as attended, permanently delete, and the screen that confirms the deletion— MUST verify the session before reading or writing anything. Without a valid session, the response MUST be a redirect to the access screen, without showing a single piece of data of the registration, its reports or its pending edits —neither on the screen, nor in the HTML, nor in the destination URL—, without confirming whether that identifier exists and without executing any change in the database. None of these actions MUST exist on a public surface: the registration form, **edit mode**, the listings, the cards and the report form MUST NOT be able to change the status, the origin, the trades or the zone of a business, nor unpublish it, nor delete it, nor resolve pending edits, nor generate management links, nor mark reports as attended. The public report form can only create reports in `pending` status.

#### Scenario: queue without a session

- **WHEN** someone without a session opens `/admin`
- **THEN** they reach the access screen and the response contains no name, WhatsApp number or data of any registration, nor any count of reports

#### Scenario: registration detail without a session

- **WHEN** someone without a session opens the detail URL of a specific registration, with its identifier
- **THEN** they reach the access screen, without seeing any data of that registration or its reports, and without the response confirming whether that identifier exists

#### Scenario: pending edit detail without a session

- **WHEN** someone without a session opens the detail URL of a pending edit, with its identifier
- **THEN** they reach the access screen, without seeing a single piece of data of what is published or what is proposed

#### Scenario: approve without a session

- **WHEN** a request to approve a registration reaches the server directly without a valid session cookie
- **THEN** the registration stays in `in_review`, no card is published, no management link is generated and the response carries no business data

#### Scenario: resolve a pending edit without a session

- **WHEN** requests to apply and to discard a pending edit reach the server directly without a valid session cookie
- **THEN** the published card does not change, the pending edit stays pending and no discard reason is saved

#### Scenario: generate a link without a session

- **WHEN** a request to generate a new link reaches the server directly without a valid session cookie
- **THEN** the business's link does not change, the one it already had keeps working and the response carries no token

#### Scenario: reject without a session

- **WHEN** a request to reject a registration reaches the server directly without a valid session cookie
- **THEN** the registration does not change status and no rejection reason is saved

#### Scenario: unpublish without a session

- **WHEN** a request to unpublish a business reaches the server directly without a valid session cookie
- **THEN** the business stays `published`, no reason or unpublication date is saved, its card stays in the directory and the response carries no business data

#### Scenario: delete without a session

- **WHEN** a deletion request, with the confirmation word and everything, reaches the server directly without a valid session cookie
- **THEN** the registration still exists in full and the response carries none of its data

#### Scenario: the deletion confirmation screen without a session

- **WHEN** someone without a session opens the URL of the deletion confirmation screen of a specific registration
- **THEN** they reach the access screen, without seeing the business name or any other data, and without the response confirming whether that identifier exists

#### Scenario: attend a report without a session

- **WHEN** a request to mark a report as attended reaches the server directly without a valid session cookie
- **THEN** the report stays `pending`, with no attended date, and the response carries neither its reason, nor its comment, nor any business data

#### Scenario: no transition from the public side

- **WHEN** the public surfaces are reviewed (registration form, edit mode, listings, cards and report form)
- **THEN** none allows changing the status, origin, trades or zone of a business, nor unpublishing it, nor deleting it, nor resolving a pending edit, nor generating a management link, nor marking reports as attended

### Requirement: The panel is not indexed nor linked from the public site

The panel pages MUST ask search engines not to index them nor follow their links (PRD §6.3: "ruta no indexada") and MUST NOT be linked from any public page of the site: neither the home, nor the footer, nor the form, nor the cards.

#### Scenario: no-indexing metadata

- **WHEN** the response of any panel screen, including the access one, is reviewed
- **THEN** it declares `noindex, nofollow`

#### Scenario: no links from the public side

- **WHEN** the home, the registration form, a listing, a card and the footer are reviewed
- **THEN** none links to the panel or mentions its route

### Requirement: Review queue with the pending registrations, oldest first

The queue MUST be the main screen of the panel, headed with the literal text "Registros por revisar", and list **two things together**: the businesses in `in_review` status and the pending edits waiting for review (PRD §6.4: the changes "entran a la misma cola de revisión"). The order MUST be from oldest to newest according to when each item entered the queue (the one that has been waiting longest, on top), because the operational goal is to answer each case in under 48 hours (PRD §10). With an empty queue —no new registrations and no pending edits— the literal text "No hay registros esperando. Todo al día." MUST be shown.

Each row MUST distinguish what it is with a text label, literally "Alta nueva" or "Edición", and show the business name, its zone (the catalogue one or the free text it entered), how long it has been waiting and an entry to the matching detail with the text "Revisar". The distinction MUST NOT depend only on color or order: it MUST be readable as text. Businesses that are `published` and `rejected` MUST NOT appear in the queue by themselves —only through their pending edits, if they have any—, and pending edits already applied or discarded MUST NOT appear.

**The wait of a new registration is counted from when the registration entered the queue**, which is the more recent of its registration date and its unpublication date: a card that was published for months and was unpublished today has been waiting since today, not since it was registered. **The wait of a pending edit is counted from when the business sent it.** That same clock MUST drive the order of the queue, so that the wait shown and the position of the row do not contradict each other. Businesses that reached the queue through an unpublication MUST also be distinguished with the literal label "Ya estaba publicada, la despublicaste" on their row, so the admin does not confuse them with new registrations to review; the wait criterion remains the same for all, with no separate sections.

**A business MUST NOT take up two rows.** If it is already in the queue by itself —because it is waiting for review or because the admin unpublished it—, its pending edit MUST NOT open a separate row: what the admin has to resolve first is the card. The pending edit is neither touched nor lost, and it reappears as "Edición" as soon as the card is published again.

#### Scenario: order of the mixed queue

- **WHEN** the admin opens the queue with two new registrations and one pending edit that arrived on different days
- **THEN** they see them from oldest to newest regardless of type, each with its label "Alta nueva" or "Edición", its name, its zone, how long it has been waiting and its entry "Revisar"

#### Scenario: the pending edit leads to its own detail

- **WHEN** the admin taps "Revisar" on a row labelled "Edición"
- **THEN** they reach the comparative detail of those changes, not the detail of a new registration

#### Scenario: the queue only brings what is pending

- **WHEN** the database has businesses in `in_review`, `published` and `rejected`, and pending edits that are `pending`, `applied` and `discarded`
- **THEN** the queue shows only the `in_review` ones and the pending edits

#### Scenario: a published business with a pending edit

- **WHEN** a published business sends changes
- **THEN** it appears in the queue only once, as "Edición", without appearing again as a new registration

#### Scenario: an unpublished card with a pending edit takes up a single row

- **WHEN** the admin unpublishes a business that had a pending edit waiting for review
- **THEN** the queue shows it in a single row, as "Alta nueva", which leads to the card detail; the pending edit keeps waiting and reappears as "Edición" as soon as the card is published again

#### Scenario: empty queue

- **WHEN** there is no registration in `in_review` and no pending edit
- **THEN** the admin sees "No hay registros esperando. Todo al día." instead of an empty list

#### Scenario: an unpublished card appears marked and with its new wait

- **WHEN** the admin unpublishes a business that was registered eight months ago and it goes back to the queue
- **THEN** that row says it has been waiting since the unpublication (not since its registration), carries the label "Ya estaba publicada, la despublicaste" and is ordered by that new wait

#### Scenario: an unpublished card that is then resubmitted counts from the resubmission

- **WHEN** an unpublished card is rejected, the business corrects its data and submits the form again
- **THEN** its row counts the wait from the resubmission, which is the most recent thing that happened to it, and not from the earlier unpublication

### Requirement: Visible indicator for registrations waiting more than 48 hours

Every queue row that has been waiting more than 48 hours MUST be shown with a visible indicator next to it, with the literal text "Lleva más de 48 horas", and the queue MUST say how many are in that condition (PRD §10: if the time between registration and publication goes over 48 hours in a sustained way, the admin's workload has to be reviewed). The clock of a new registration counts **from when it entered the queue** —its registration date or, if more recent, the date it was unpublished—; that of a pending edit, **from when the business sent it**, and if the business replaces it with a newer one the clock restarts with it (what the admin has to review is the new thing). The indicator MUST NOT depend only on color: it MUST be readable as text.

#### Scenario: overdue registration

- **WHEN** a registration has been in the queue for 50 hours
- **THEN** its row shows the indicator "Lleva más de 48 horas" and the queue's overdue count includes it

#### Scenario: overdue pending edit

- **WHEN** a pending edit has been waiting for review for 50 hours
- **THEN** its row shows the same indicator and it also enters the overdue count

#### Scenario: the clock of the pending edit restarts when it is replaced

- **WHEN** a business with a 50-hour pending edit sends new changes that replace it
- **THEN** the queue row stops being marked as overdue, because what has to be reviewed has just arrived

#### Scenario: registration within the goal

- **WHEN** a registration has been in the queue for 3 hours
- **THEN** its row does not show the indicator

#### Scenario: a freshly unpublished card is not born overdue

- **WHEN** the admin unpublishes a business registered eight months ago and opens the queue right away
- **THEN** that row does not show "Lleva más de 48 horas" nor does it enter the overdue count

#### Scenario: the indicator is read, not just seen

- **WHEN** the admin reviews the queue on a phone or with a screen reader
- **THEN** the notice of overdue registrations is understood by its text, without depending on a color

### Requirement: The queue tells which businesses have unattended reports

Below the registrations to review, the queue MUST show its own section headed with the literal text "Negocios reportados" that lists **only the businesses with at least one pending report**, from the one that has had an unattended report longest to the most recent. Each row MUST show the business name, how many unattended reports it has —with the literal text "1 reporte sin atender" or "<n> reportes sin atender", as appropriate— and an entry to that business's detail with the literal text "Ver reportes". The section MUST open with the total count, with the literal text "1 negocio tiene reportes sin atender." or "<n> negocios tienen reportes sin atender.". If there is no pending report, the whole section MUST NOT appear: the empty panel screen remains "No hay registros esperando. Todo al día."

What decides who enters this section is their pending reports, not their status: the reports of a business MUST NOT appear in the "Registros por revisar" list nor alter its order, and that list keeps bringing only the `in_review` ones. They are two distinct sections, with two distinct jobs, and a business that is both waiting for review and has unattended reports appears in both, each with its own content.

#### Scenario: queue with reported businesses

- **WHEN** the admin opens the queue and there are two published businesses with pending reports (one with three reports and the other with one)
- **THEN** they see, below the registrations to review, the section "Negocios reportados" with the count "2 negocios tienen reportes sin atender.", the row of the first with "3 reportes sin atender", that of the second with "1 reporte sin atender" and in each the entry "Ver reportes"

#### Scenario: without pending reports there is no section

- **WHEN** the admin opens the queue and no business has unattended reports
- **THEN** the section "Negocios reportados" does not appear, nor any count of reports

#### Scenario: reports are not mixed with the registrations to review

- **WHEN** a published business has pending reports
- **THEN** it does not appear in the "Registros por revisar" list (which keeps bringing only the `in_review` ones) nor does it change the order of that list

#### Scenario: an unpublished business with reports is in both sections

- **WHEN** the admin unpublishes a business that had unattended reports and goes back to the queue
- **THEN** they see it in "Registros por revisar" with its new wait and also in "Negocios reportados" with its pending reports, with neither section altering the other

#### Scenario: "Ver reportes" opens the business detail

- **WHEN** the admin taps "Ver reportes" on the row of a published business
- **THEN** they reach the detail of that business, with its complete data and its unattended reports

### Requirement: "Todos los negocios" view with the status in sight and an entry to the detail

The panel MUST have its own screen at `/admin/negocios`, headed with the literal text "Todos los negocios", that lists **all the records in the database regardless of their status** —those waiting for review, the published ones, the rejected ones and those that went back to the queue through an unpublication—, so that no card is left out of the admin's reach (PRD §6.3; PRD §8: the cancellation and deletion tools are only useful if the card can be reached). It is the panel's entry point to any card: the view MUST NOT offer any action on the records —neither approve, nor reject, nor unpublish, nor delete, nor mark reports—, because those live in the detail and are decided there with all the data in front.

Each row MUST show:

- the business **name**;
- its **zone** (the catalogue one or the free text it entered), with the same criterion as the queue;
- its **registration date**, written in full (for example "Se registró el 3 de septiembre de 2026");
- its **status written in words**, with the literal texts "En revisión", "Publicado" or "Rechazado" according to the stored status, readable as text and not only by a color;
- the literal label "Ya estaba publicada, la despublicaste" when the card went back to `in_review` through an unpublication (the same condition and the same literal the queue uses), because "unpublished" is not a status of the model but an `in_review` with a trace;
- an entry to the detail of that registration (`/admin/registros/<id>`) with the literal text "Ver detalle".

The default order MUST leave **the most recent** on top, ordering by registration date in descending order; that is exactly the date the row shows, so the order explains itself. Between two records with the same date the order MUST be stable, so that a record does not appear twice nor disappear when changing pages. The listing's clock is the registration date; the queue has its own, which counts the wait from the more recent of the registration and the unpublication.

The header MUST say how many records the list being viewed has, with the literal texts "1 negocio en esta lista" or "<n> negocios en esta lista". If the database has no business, the screen MUST show the literal text "Todavía no hay negocios registrados." instead of an empty list.

#### Scenario: reach a published card without guessing the URL

- **WHEN** the admin opens "Todos los negocios" with a published business that has no report
- **THEN** they see it in the list with its name, its zone, its registration date, the status "Publicado" and an entry "Ver detalle" that opens `/admin/registros/<id>` of that business

#### Scenario: the list brings the four cases

- **WHEN** the database has a freshly arrived `in_review` record, a `published` one, a `rejected` one and one that was published and the admin unpublished
- **THEN** the four appear in the list, the first three with "En revisión", "Publicado" and "Rechazado", and the unpublished one with "En revisión" plus the label "Ya estaba publicada, la despublicaste"

#### Scenario: most recent on top

- **WHEN** the admin opens the list with three records registered on different days
- **THEN** they see them from most recent to oldest, and the date each row shows corresponds to the order they are in

#### Scenario: the list offers no actions

- **WHEN** the admin reviews the "Todos los negocios" screen
- **THEN** there is no button to approve, reject, unpublish, delete or mark reports: the only things they can do from there are filter, change page and open a detail

#### Scenario: database without businesses

- **WHEN** the admin opens the list and the database has no business
- **THEN** they see "Todavía no hay negocios registrados." and no rows

#### Scenario: the count says how many there are

- **WHEN** the admin opens the list and the database has 34 businesses
- **THEN** they read "34 negocios en esta lista"

### Requirement: The listing is filtered by status without leaving the view

The screen MUST allow narrowing the list by status **from the URL itself**, with links that only change the querystring and without any client JavaScript: under the literal label "Filtrar por estado", the options with the literal texts "Todos" (the default value), "En revisión", "Publicados" and "Rechazados". The chosen filter MUST be marked in a readable way —not only by color— so that the admin knows what they are viewing, and the header count MUST correspond to what is filtered, not to the total of the database.

Changing the filter MUST always return to the first page: page 7 of "Todos" means nothing within "Rechazados". If the filter leaves no record, the screen MUST show the literal text "No hay negocios con ese estado." and keep the links of the other filters visible, so the admin can get out of there without typing the URL by hand.

An `estado` value that is not recognized —an invented word, an empty parameter, a repeated one or one with several values— MUST be treated as "Todos", with no server error and without saying anything about the identifier or the data of any record. The filter and the page are the only things that travel in the URL of this screen: **no personal data MUST go in the querystring**.

#### Scenario: view only what is published

- **WHEN** the admin taps "Publicados" in the list
- **THEN** they see only the businesses in `published` status, the header count counts only those, the option "Publicados" is shown marked as the active one and the URL changes only in its querystring

#### Scenario: changing the filter returns to the first page

- **WHEN** the admin is on page 3 of "Todos" and taps "Rechazados"
- **THEN** they reach the first page of the rejected ones, not a page 3 that might not exist

#### Scenario: a filter without results

- **WHEN** the admin taps "Rechazados" and there is no rejected record
- **THEN** they see "No hay negocios con ese estado." and the links of the other filters stay in sight

#### Scenario: invented filter in the URL

- **WHEN** someone with a session opens the list with an `estado` that does not exist, empty or repeated several times in the URL
- **THEN** they see the full list just as with "Todos", with no server error and no message that reveals anything

#### Scenario: the listing URL carries no personal data

- **WHEN** the URLs of the screen are reviewed with any filter and any page
- **THEN** they carry only the status and the page number: no names, no WhatsApp numbers, no record identifiers

### Requirement: The listing is cut into pages and does not degrade when there are many records

The list MUST be shown in pages of **25 rows** at most, chosen with the `pagina` parameter of the URL. The cut MUST be done by the database query —requesting only the rows of the page—, not by the browser or by in-memory filtering of all the rows: the size of the HTML the admin receives MUST NOT grow with the total number of records in the database. There MUST NOT be infinite scroll or progressive loading: they are client JavaScript and the panel does not use it (PRD §6.3, simple panel; goal of <2s on 4G).

When there is more than one page, the screen MUST show which page it is on, with the literal text "Página 2 de 5", and the links to move around: "Ver más antiguos" toward the next page (which is the one with the oldest records, because the order is most recent first) and "Ver más nuevos" toward the previous one. Each link MUST appear only when it leads somewhere: on the first page there is no "Ver más nuevos" and on the last one there is no "Ver más antiguos". Both MUST keep the status filter that was set. With a single page, no pagination control MUST appear.

A `pagina` that cannot be interpreted —letters, zero, negative, decimal, repeated or empty— MUST be treated as the first one. A `pagina` beyond the last one MUST respond with no error and no rows, offering the link "Ver más nuevos" to go back; in that case no empty-list text MUST be painted, because those texts speak of the list and not of the page: telling someone who has 60 "Todavía no hay negocios registrados." would be false.

#### Scenario: the long list is cut

- **WHEN** the admin opens "Todos los negocios" with 60 records in the database
- **THEN** they see 25 rows, read "Página 1 de 3" and have the link "Ver más antiguos" but not "Ver más nuevos"

#### Scenario: moving between pages keeping the filter

- **WHEN** the admin filters by "Publicados" and taps "Ver más antiguos"
- **THEN** they reach the second page of the published ones —not of all—, and from there "Ver más nuevos" takes them back to the first

#### Scenario: the HTML does not grow with the database

- **WHEN** the response of the list with 30 records is compared against the same one with 500
- **THEN** both bring 25 rows and an equivalent size, because the query requested only the page

#### Scenario: a single page

- **WHEN** the admin opens the list with 10 records
- **THEN** they see the 10 and no pagination control

#### Scenario: invented page in the URL

- **WHEN** someone with a session requests page `0`, `-3`, `dos` or a repeated one
- **THEN** they see the first page, with no server error

#### Scenario: page beyond the last one

- **WHEN** the admin requests page 99 of a list that has 3
- **THEN** there is no server error: they see the screen with no rows, with no empty-list text and with the link "Ver más nuevos" to go back

### Requirement: The queue has a visible entry to the listing, and the listing returns to the queue

The queue MUST offer an entry to the full listing with the literal text "Ver todos los negocios", so that the view exists within the admin's flow and is not a URL that has to be remembered. The listing, in turn, MUST offer the way back to the queue with the literal text "Volver a la cola", the same one the panel's confirmation screens use. Neither entry MUST alter what the queue shows nor the order in which it shows it: the queue remains the list of pending items, from oldest to newest, with its section of reported businesses.

#### Scenario: enter the listing from the queue

- **WHEN** the admin opens the queue and taps "Ver todos los negocios"
- **THEN** they reach "Todos los negocios" with the filter "Todos" and the first page

#### Scenario: the queue keeps its two sections next to the entry to the listing

- **WHEN** the admin opens the queue with pending registrations and reported businesses
- **THEN** they see "Registros por revisar" with the `in_review` ones from oldest to newest, the section "Negocios reportados" and the entry "Ver todos los negocios"

#### Scenario: go back to the queue

- **WHEN** the admin is in the listing and taps "Volver a la cola"
- **THEN** they reach the review queue

### Requirement: The listing inherits the panel's access, no-indexing and minimal data exposure

The listing MUST sit behind **the same signed session** as the rest of the panel, with no access mechanism of its own: the session is verified **before** reading anything from the database and, without a valid session, the response MUST be the redirect to the access screen, without a single name, zone, count or record identifier in the response. Without the panel configuration (password or signing secret), the screen MUST NOT open, just like the others. The screen MUST declare `noindex, nofollow` and inherit the panel's referrer policy, and MUST NOT be linked from any public page of the site.

The listing MUST show **the minimum needed to recognize a card and reach it**: name, zone, registration date and status. The WhatsApp, the landline phone, the address, the photo, the rejection reason, the unpublication reason and the consent record MUST NOT appear on this screen: they keep living only in the detail (PRD §8, LFPDPPP: the less personal data is painted at once, the less there is to protect). Nothing the listing shows MUST be written to the server log.

The screen MUST be **read-only**: it exposes no write action, so no request against it MUST be able to change the status, the trades, the zone or any data of a record, nor delete anything.

#### Scenario: listing without a session

- **WHEN** someone without a session opens `/admin/negocios`, with or without a filter and page in the URL
- **THEN** they reach the access screen and the response carries no name, zone, status, count or record identifier

#### Scenario: listing with the panel unconfigured

- **WHEN** the server runs without the panel password or without the signing secret and someone opens `/admin/negocios`
- **THEN** they do not see the list: it behaves the same as the other unconfigured panel screens

#### Scenario: the listing is neither indexed nor linked

- **WHEN** the response of the listing and the public pages of the site (home, form, listings, cards and footer) are reviewed
- **THEN** the listing declares `noindex, nofollow` and no public page links to it or mentions its route

#### Scenario: the listing does not paint more data than necessary

- **WHEN** the admin opens the listing with cards that have WhatsApp, phone, address, photo and rejection reason stored
- **THEN** none of that data appears on the screen or in the HTML: only name, zone, registration date and status

#### Scenario: nothing is written from the listing

- **WHEN** write requests arrive against the listing route, with or without a session
- **THEN** nothing changes in the database, no record changes status and the response carries no data of any business

### Requirement: Registration detail with all the captured data, only inside the panel

The detail of a registration MUST show everything the business captured —name, category, WhatsApp, zone (from the catalogue or free text), what it offers, whether it makes deliveries or goes to the customer's home, landline phone, address or references, opening hours, the page it registered and **the photo it uploaded**— plus the internal data the admin needs to operate: status, origin, registration date and the consent record of the privacy notice (evidence before the LFPDPPP, PRD §8). **If the card was published and then unpublished, the detail MUST also show when and why it was unpublished**, with the literal labels "Cuándo la despublicaste" and "Por qué la despublicaste"; if it was never unpublished, those labels MUST NOT appear. The photo MUST be large enough to judge it against the policy of PRD §6.1 (of the premises, the products or the work; without recognizable people) before approving or rejecting, under the literal label "Foto del negocio"; if the registration has no photo, it MUST say so with the literal text "Sin foto". The free-text rejection reason that already exists is enough to explain to the business why its photo did not comply: the panel MUST NOT have a catalogue of reasons nor specific actions on the photo.

The consent record MUST be shown in full: the date and, in parentheses, the version of the notice that was accepted, in the form "3 de septiembre de 2026 (versión 1)". If the card predates versioning and has no recorded version, it MUST say so with the literal text "versión no registrada" instead of the version, never invent one. When the card also has a re-acceptance —because it was resubmitted when a later version was already in force— the detail MUST show it as its own data point, with the literal label "El reenvío aceptó la versión 1 del aviso" (where `1` is the re-accepted version) and, as value, the date of that resubmission; if it has none, that line does not appear. The label describes the verifiable fact and MUST NOT attribute the act to the data subject: whoever resubmits the public form is an unauthenticated actor, which is the same reason the original record is not replaced. Nor MUST it claim on its own that the version is "newer": that is guaranteed by the write rule, which only records the re-acceptance when the version in force is later (`business-registration`).

This complete personal data —including the photo— MUST be visible only inside the panel with a valid session: it MUST NOT appear on any public page or in the server log, and the address with which the panel shows the photo of an unpublished registration MUST NOT serve anything without a valid session. If the registration does not exist, the detail MUST respond as not found, suggesting nothing.

#### Scenario: complete detail

- **WHEN** the admin opens the detail of a registration that filled in all the fields and uploaded a photo
- **THEN** they see all the captured data, the photo under the label "Foto del negocio" at a size that lets them judge it, and also the status, the origin, the registration date and the consent record with its date and its version

#### Scenario: registration predating versioning

- **WHEN** the admin opens the detail of a card registered before the notice had a version
- **THEN** they see the consent date with "versión no registrada", with no invented version

#### Scenario: registration whose resubmission accepted a later version

- **WHEN** the admin opens the detail of a card that was resubmitted when a later version of the notice was already in force
- **THEN** they see the original record with its date and its version, and also the line "El reenvío aceptó la versión 2 del aviso" with the date of that resubmission, without the act being attributed to the data subject

#### Scenario: detail of a registration with only the required fields

- **WHEN** the admin opens the detail of a registration that filled in only the 5 required fields
- **THEN** they see that data, the optional fields appear as not captured and where the photo would go it says "Sin foto", without inventing content

#### Scenario: detail of an unpublished card

- **WHEN** the admin opens the detail of a business that they unpublished yesterday with the reason "El negocio cerró"
- **THEN** they see "Cuándo la despublicaste" with yesterday's date and "Por qué la despublicaste" with "El negocio cerró", in addition to the date of its last publication

#### Scenario: detail of a card that was never unpublished

- **WHEN** the admin opens the detail of a registration that was never unpublished
- **THEN** they do not see the unpublication labels nor any empty gap in their place

#### Scenario: the photo of the in-review registration does not leave the panel

- **WHEN** someone without a session requests the address with which the panel shows the photo of an `in_review` registration
- **THEN** they do not receive the image, but the same not-found response the public site would give, and the response does not confirm that the registration exists

#### Scenario: personal data does not leave the panel

- **WHEN** the public pages and the server log are reviewed while there are registrations in the queue
- **THEN** the WhatsApp, the landline phone, the address, the photo and the consent version of an unpublished registration appear in neither

#### Scenario: nonexistent registration

- **WHEN** the admin with a session opens the detail of an identifier that does not exist
- **THEN** they see the not-found page, with no suggestions or data of other registrations

#### Scenario: rejecting because of the photo uses the usual free-text reason

- **WHEN** the admin sees a photo that violates the policy of PRD §6.1 and rejects the registration by writing the reason
- **THEN** the rejection works exactly like any other: the reason is saved with its date and an offer is made to notify the business by WhatsApp

### Requirement: Verification button that opens WhatsApp with a prefilled message

The detail MUST offer a button that opens the WhatsApp conversation with the number the business registered, with a message already written for the manual verification of PRD §6.3. The button MUST literally say "Escribirle por WhatsApp" and the prefilled message MUST be, literally: "Hola, te escribo de enmirumbo, el directorio de negocios de Tizayuca. Recibimos el registro de «<nombre del negocio>». ¿Nos confirmas que el negocio es tuyo y que este es tu WhatsApp?". Sending is always done by the person: the system MUST NOT send messages on its own (PRD §6.6). If the stored number cannot be interpreted as a 10-digit Mexican number, a broken link MUST NOT be painted: the panel shows the number as it is stored, without a button.

#### Scenario: open the verification conversation

- **WHEN** the admin taps "Escribirle por WhatsApp" on the detail of the business "Tacos del Güero"
- **THEN** WhatsApp opens with the conversation with that number and the message "Hola, te escribo de enmirumbo, el directorio de negocios de Tizayuca. Recibimos el registro de «Tacos del Güero». ¿Nos confirmas que el negocio es tuyo y que este es tu WhatsApp?" already written, not sent

#### Scenario: number that cannot be interpreted

- **WHEN** the registration has a stored number that does not normalize to 10 digits
- **THEN** the panel shows the number as is, without a WhatsApp button and without a broken link

### Requirement: Approving assigns trades, normalizes the zone, marks the origin and publishes the card

From the detail, the admin MUST be able to approve the registration in a single action that: assigns 1 to 3 trades from the catalogue (Appendix B) or none if none fits; normalizes the zone by choosing one from the catalogue when the business wrote it as "Otra"; marks the origin of the card (`seeded` or `organic`, PRD §10); and publishes the card, leaving it in `published` status with its publication date. The limit of 1 to 3 trades is enforced here, not in the database. The labels MUST be, literally: "Giros (de 1 a 3, o ninguno si no embona)", "¿En qué colonia está?", "¿De dónde salió?" with the options "Se registró solo" (origin `organic`) and "Lo sembramos nosotros" (origin `seeded`), and the button "Aprobar y publicar". The errors MUST be, literally: "Elige máximo 3 giros" and "Elige la colonia de este negocio". On approval, the card MUST be visible in the public directory immediately.

**Approving is also the way to publish an unpublished card again.** When the registration already has trades assigned (because it was published), the form MUST arrive with those trades already checked, so that republishing does not erase them without the admin noticing; the admin can uncheck or change them as in any approval. When publishing again, the publication date MUST be updated to that of this publication, and the trace of the earlier unpublication MUST NOT be cleared.

#### Scenario: complete approval

- **WHEN** the admin chooses 2 trades, marks the origin "Se registró solo" and taps "Aprobar y publicar" on a registration whose zone is already from the catalogue
- **THEN** the business ends up in `published` status with its publication date, with those 2 trades and with origin `organic`, and appears in the public listing of its category

#### Scenario: approval without trades

- **WHEN** the admin approves a registration without choosing any trade because none in the catalogue fits
- **THEN** the card is published anyway, with no assigned trades

#### Scenario: more than three trades

- **WHEN** the admin tries to approve with 4 trades selected
- **THEN** nothing is published and they see "Elige máximo 3 giros", keeping what they had already chosen

#### Scenario: normalize the "Otra" zone

- **WHEN** the admin opens a registration that wrote its zone as "Otra" with the text "Rinconada del Venado"
- **THEN** they see that text exactly as the business captured it and a catalogue list to choose the final zone; on approving with a chosen zone, the business is linked to that catalogue zone

#### Scenario: approve without normalizing the pending zone

- **WHEN** the admin tries to approve a registration with zone "Otra" without choosing any from the catalogue
- **THEN** nothing is published and they see "Elige la colonia de este negocio"

#### Scenario: mark the seeded origin

- **WHEN** the admin approves a registration that they got by door-to-door canvassing and marks "Lo sembramos nosotros"
- **THEN** the card ends up with origin `seeded`, so the metrics of PRD §10 can be separated

#### Scenario: republishing keeps the trades

- **WHEN** the admin opens the approve form of a card that they unpublished and that had 3 trades assigned
- **THEN** the 3 trades arrive checked, and if they approve without touching them the card is published with those same 3 trades, with today's publication date and without losing the date or the reason of the earlier unpublication

#### Scenario: approving does not edit the business data

- **WHEN** the admin approves a registration
- **THEN** the name, the WhatsApp, "¿Qué ofreces?", the phone, the address, the opening hours and the page of the business stay exactly as the business captured them

### Requirement: Approving a registration generates its management link, unique and unrepeatable

On approving a registration, the same transition that publishes the card MUST generate its management link (PRD §6.4): a cryptographically random token of at least 256 bits, different on each generation, of which the database stores only the fingerprint (capability `data-model`). No published card MUST be left without a link, and two businesses MUST NEVER share a token. A repeated approval on an already resolved registration MUST NOT generate a new token (it would invalidate the one the admin already sent): it keeps showing "Este registro ya lo habías resuelto." The detail of a published business MUST indicate that it has a link and since when, but **MUST NOT show the link itself**: the panel does not know it, because it stores only its fingerprint.

#### Scenario: each approval gets a new link

- **WHEN** the admin approves two different registrations
- **THEN** each business ends up with its own management link and the two tokens differ from each other

#### Scenario: the token cannot be guessed

- **WHEN** the generated tokens are reviewed
- **THEN** they come from a cryptographic random source, have at least 256 bits of entropy and are not derived from the name, the identifier, the number or the date of the business

#### Scenario: approving twice does not change the link

- **WHEN** the admin sends the same approval from a tab they had open
- **THEN** they see "Este registro ya lo habías resuelto." and the link they had already sent remains the valid one

#### Scenario: the panel does not show the current link

- **WHEN** the admin opens the detail of a published business
- **THEN** they read that the business has a management link and since when, without the link or the token appearing on the screen or in the HTML of the response

### Requirement: On approving, an offer is made to notify the business by WhatsApp with its card link and its management link

After approving, the panel MUST confirm with the literal text "Ya quedó publicado." and offer a button "Avisarle por WhatsApp" that opens the conversation with that business and a message prefilled with the notice, the link to its public card and **its management link with the instruction from PRD §6.4**, literally: "¡Listo! Ya quedó publicado «<nombre del negocio>» en enmirumbo. Esta es tu ficha: <link de la ficha> — compártela con tus clientes. Y este es tu enlace para editarla: <enlace de gestión> — guarda este mensaje (puedes destacarlo con la estrella), con ese enlace actualizas tus datos cuando quieras." Both links MUST be full URLs: the card one, the same that any resident would open; the management one, the one that opens the edit mode of that card. This screen is **the only moment** the management link is shown in the panel: if the admin leaves it without sending the message, to have it again they have to generate a new one, which makes the previous one stop working.

#### Scenario: publication notice with both links

- **WHEN** the admin has just approved the registration of "Estética Lupita"
- **THEN** they see "Ya quedó publicado." and a button "Avisarle por WhatsApp" that opens the conversation with that business, with the message "¡Listo! Ya quedó publicado «Estética Lupita» en enmirumbo. Esta es tu ficha: <link de la ficha> — compártela con tus clientes. Y este es tu enlace para editarla: <enlace de gestión> — guarda este mensaje (puedes destacarlo con la estrella), con ese enlace actualizas tus datos cuando quieras." already written, not sent

#### Scenario: both links open what they promise

- **WHEN** the two links carried by that message are opened
- **THEN** the first loads the public card of that business and the second opens its prefilled edit form

#### Scenario: the link does not stay in sight

- **WHEN** the admin leaves the confirmation screen and returns to the detail of that business
- **THEN** the management link no longer appears on any panel screen

### Requirement: Rejecting requires a reason, stores it with its date and offers to notify by WhatsApp

From the detail, the admin MUST be able to reject the registration by mandatorily writing the reason, under the literal label "¿Por qué lo rechazas?" and with the button "Rechazar". The system MUST store the `rejected` status, the rejection date and the reason (the data of rejected registrations is deleted after 90 days, PRD §8: the date is what the scheduled purge uses to know when it is due). Without a reason, the rejection MUST NOT be executed and the literal text "Escribe por qué lo rechazas" MUST be shown. After rejecting, the panel MUST confirm with "Registro rechazado." and offer a button "Avisarle por WhatsApp" with the prefilled message, literally: "Hola, revisamos el registro de «<nombre del negocio>» en enmirumbo y por ahora no lo pudimos publicar: <motivo>. Si lo corriges, lo puedes volver a enviar desde el mismo formulario con este mismo número." A rejected business MUST NOT appear on any public page.

#### Scenario: rejection with a reason

- **WHEN** the admin writes "El número no contesta y no pudimos confirmar que el negocio exista" and taps "Rechazar"
- **THEN** the registration ends up in `rejected` status with that reason and the rejection date stored, and leaves the queue

#### Scenario: rejection without a reason

- **WHEN** the admin taps "Rechazar" with the reason empty
- **THEN** nothing changes in the database and they see "Escribe por qué lo rechazas"

#### Scenario: rejection notice by WhatsApp

- **WHEN** the admin has just rejected the registration of "Préstamos Rápidos" with the reason "No publicamos préstamos informales"
- **THEN** they see "Registro rechazado." and a button "Avisarle por WhatsApp" with the message "Hola, revisamos el registro de «Préstamos Rápidos» en enmirumbo y por ahora no lo pudimos publicar: No publicamos préstamos informales. Si lo corriges, lo puedes volver a enviar desde el mismo formulario con este mismo número." already written

#### Scenario: the rejected one is not published

- **WHEN** a resident searches the directory for a business that was rejected
- **THEN** it does not appear in any listing and its card responds as not found, just like that of a nonexistent business

### Requirement: Unpublish a published card, with a mandatory reason and conditioned on the status

From the detail of a business in `published` status, the admin MUST be able to **unpublish it** in a single action that requires writing the reason, under the literal label "¿Por qué la despublicas?" and with the literal button "Despublicar". The action MUST leave the business in `in_review` status and store the unpublication date and the reason. Without a reason, the unpublication MUST NOT be executed and the literal text "Escribe por qué la despublicas" MUST be shown. On unpublishing, the card MUST stop being in the public directory immediately (see the capability `public-directory`).

Because that reason is what travels inside the WhatsApp sent to the business, it MUST NOT be silently trimmed: a reason of more than 500 characters MUST be rejected without writing anything to the database, with the literal text "El motivo no puede pasar de 500 caracteres. Recórtalo un poco: así, completo, es como le va a llegar al negocio." The field MUST warn beforehand where whatever is written goes, with the literal text "Este motivo se le enviará al negocio por WhatsApp.", so that an internal note does not accidentally go out to a third party.

The write MUST be **conditioned on the status**: it only takes effect on a business that is still `published`. If the card was no longer published —because the admin unpublished it from another tab, tapped the button twice, or the registration never got published—, the second action MUST NOT be applied nor overwrite the first, and the panel MUST say so with the literal text "Esta ficha ya no estaba publicada." Reloading the screen after the unpublication MUST NOT repeat it.

Unpublishing MUST NOT destroy anything: the assigned trades, the normalized zone, the origin, the date of the last publication and all the data the business captured MUST stay as they were. Unpublishing MUST also NOT touch the reason or the date of an earlier rejection.

#### Scenario: unpublish with a reason

- **WHEN** the admin opens the detail of a published business, writes "El dueño nos pidió por WhatsApp que la bajáramos" and taps "Despublicar"
- **THEN** the business ends up in `in_review` status with that date and that reason stored, and its card leaves the directory

#### Scenario: unpublish without a reason

- **WHEN** the admin taps "Despublicar" with the reason empty
- **THEN** nothing changes in the database, the business stays published and they see "Escribe por qué la despublicas"

#### Scenario: reason longer than the limit

- **WHEN** the admin sends a 501-character reason, bypassing the field's limit
- **THEN** nothing is saved, the business stays published and they see "El motivo no puede pasar de 500 caracteres. Recórtalo un poco: así, completo, es como le va a llegar al negocio."

#### Scenario: the admin knows where what they write goes

- **WHEN** the admin opens the unpublish form
- **THEN** next to the label "¿Por qué la despublicas?" they read "Este motivo se le enviará al negocio por WhatsApp."

#### Scenario: unpublish something that was no longer published

- **WHEN** a request to unpublish arrives for a business that is already in `in_review` or in `rejected`
- **THEN** no reason or unpublication date is saved, its status does not change and the panel shows "Esta ficha ya no estaba publicada."

#### Scenario: double unpublication

- **WHEN** the admin unpublishes a card and sends the same action again from a tab they had open
- **THEN** the card keeps the date and the reason of the first unpublication and they see "Esta ficha ya no estaba publicada."

#### Scenario: unpublishing does not erase the work done

- **WHEN** a business that had 3 trades assigned, a catalogue zone, origin `seeded` and a publication date is unpublished
- **THEN** it keeps its 3 trades, its zone, its origin and its date of last publication, and none of the data the business captured changes

#### Scenario: reloading after unpublishing

- **WHEN** the admin reloads the screen that confirms the unpublication
- **THEN** no action is executed again

### Requirement: On unpublishing, an offer is made to notify the business by WhatsApp

After unpublishing, the panel MUST confirm with the literal text "Ya la despublicaste." and offer a button "Avisarle por WhatsApp" that opens the conversation with that business and a message already written, literally: "Hola, te escribo de enmirumbo. Bajamos del directorio la ficha de «<nombre del negocio>»: <motivo>. Si quieres que la volvamos a publicar o tienes alguna duda, contéstame por aquí." The reason that travels in the message is the one the admin has just written. Sending is always done by the person: the system MUST NOT send messages on its own (PRD §6.6). If the stored number cannot be interpreted as a 10-digit Mexican number, a broken link MUST NOT be painted: the panel shows the number as it is stored, without a button.

That screen MUST exist only for an unpublication that really happened: if the registration is not in `in_review`, or has no unpublication date, or its reason is empty, the screen MUST NOT be shown and the admin MUST go back to the detail, without the response leaking anything. A message with a blank reason is an incorrect WhatsApp to a third party, which is exactly what the panel exists to avoid.

#### Scenario: unpublication notice

- **WHEN** the admin has just unpublished "Tacos del Güero" with the reason "El negocio cerró"
- **THEN** they see "Ya la despublicaste." and a button "Avisarle por WhatsApp" that opens the conversation with that business, with the message "Hola, te escribo de enmirumbo. Bajamos del directorio la ficha de «Tacos del Güero»: El negocio cerró. Si quieres que la volvamos a publicar o tienes alguna duda, contéstame por aquí." already written, not sent

#### Scenario: number that cannot be interpreted when notifying of the unpublication

- **WHEN** the unpublished business has a stored number that does not normalize to 10 digits
- **THEN** the panel shows the number as is, without a WhatsApp button and without a broken link

#### Scenario: the confirmation screen does not open on a new registration

- **WHEN** someone with the panel session opens the "Ya la despublicaste." screen of a registration that came through the public form and was never published
- **THEN** they do not see it: they go back to the detail of that registration, with no WhatsApp message loaded and without the response carrying business data

### Requirement: Permanent deletion is confirmed in two steps, by typing a word

Permanent deletion is irreversible and has no trash, so it MUST NOT be executable from the detail with a single tap. The detail MUST offer a control with the literal text "Borrar definitivamente" that **only leads to a confirmation screen of its own**: that first step MUST NOT delete anything or change anything in the database, and no GET request MUST ever delete a registration.

The confirmation screen MUST show, in this order:

- the literal heading "¿Seguro que quieres borrar esta ficha?";
- the business name and the literal warning "Esto borra para siempre el registro de «<nombre del negocio>», sus giros y sus reportes. No hay papelera y no se puede deshacer.";
- the reminder of the procedure, literally: "Antes de borrar: confirma por WhatsApp, desde el número con el que se registró, que quien lo pide es el dueño del negocio. Tienes 20 días hábiles para contestarle.";
- a text field with the literal label "Escribe BORRAR para confirmar";
- the literal button "Sí, borrar para siempre" and an exit with the literal text "Mejor no, regresar" that returns to the detail without touching anything.

The deletion MUST only be executed if what was typed in the field is the word `BORRAR` —regardless of upper or lower case and tolerating extra spaces at the start or end, but no other word—. If it does not match, nothing MUST be deleted and the literal text "Para borrar, escribe BORRAR en el campo." MUST be shown.

This button is the last piece of a human procedure that the spec leaves documented, because the software only executes the final step: the ARCO request arrives through the directory's WhatsApp or through the email published in the privacy notice → the admin verifies the identity of the data subject by confirming that whoever asks comes from the same WhatsApp number the business was registered with (the same human criterion as the verification of the registration, PRD §6.3) → the admin executes the unpublication or the deletion according to what was requested → the admin replies in the same conversation, within the 20 business days that the privacy notice promises (PRD §8).

#### Scenario: reaching the confirmation deletes nothing

- **WHEN** the admin taps "Borrar definitivamente" on the detail of a registration
- **THEN** they reach the confirmation screen with the heading "¿Seguro que quieres borrar esta ficha?", the warning with the business name and the reminder of the procedure, and the registration still exists with all its data

#### Scenario: confirm with the correct word

- **WHEN** the admin types "BORRAR" and taps "Sí, borrar para siempre"
- **THEN** the registration is permanently deleted and the panel confirms it

#### Scenario: the word does not match

- **WHEN** the admin types "borra" or leaves the field empty and taps "Sí, borrar para siempre"
- **THEN** nothing is deleted and they see "Para borrar, escribe BORRAR en el campo."

#### Scenario: lowercase and extra spaces

- **WHEN** the admin types " borrar " and taps "Sí, borrar para siempre"
- **THEN** the deletion is executed all the same, because only case and extra spaces are ignored

#### Scenario: changing one's mind

- **WHEN** the admin taps "Mejor no, regresar"
- **THEN** they go back to the registration detail, which remains complete and unchanged

#### Scenario: no GET deletes

- **WHEN** the confirmation screen is opened, reloaded and navigated back and forward without submitting the form
- **THEN** the registration still exists, because opening that screen executes nothing

### Requirement: Permanent deletion takes everything and leaves no trace of personal data

Permanent deletion MUST remove the whole registration, whatever status it is in (`in_review`, `published` or `rejected`): its row, its links with trades, its reports, its pending edits —pending or already resolved— and the files of its photo. After the deletion, no query MUST return its data, its public card MUST respond with the same 404 as a nonexistent business, its management link MUST respond with that same 404 and its row MUST disappear from the queue. The deletion MUST be **idempotent**: if the registration no longer exists —because it was deleted from another tab or the screen was reloaded—, no server error MUST occur and the panel MUST say so with the literal text "Esta ficha ya no existe."

There is one case in which the deletion is NOT executed and the panel MUST say so instead of confirming: the card has a photo and the storage cannot be reached (requirement "Permanent deletion refuses to claim it deleted what it did not delete", `deployment`). In that case the card still exists in full and the admin MUST read the literal text "La ficha no se borró: no pude alcanzar el almacén de fotos. Revisa la configuración y vuelve a intentar." A card without a photo is deleted normally even if the storage is down.

Once the deletion is done, the panel MUST take the admin to a screen that confirms with the literal text "Ya se borró para siempre." and offers to go back to the queue. That screen MUST NOT show any data of the deleted business, and neither the name, nor the WhatsApp, nor the identifier, nor any other personal data MUST travel in the URL or be written to the server log: what was just deleted from the database cannot stay stored in an access log.

#### Scenario: delete a published business with everything attached

- **WHEN** the admin confirms the deletion of a published business that had assigned trades, reports and a pending edit waiting for review
- **THEN** its row, its links with trades, its reports and its pending edits disappear, no later query returns any of that and its management link stops opening

#### Scenario: delete in any status

- **WHEN** the admin deletes a registration in `in_review` and another in `rejected`
- **THEN** both disappear all the same, regardless of their status

#### Scenario: the deleted card responds 404

- **WHEN** someone opens the URL that the card of a deleted business had
- **THEN** they see the 404 page in Spanish, exactly as if the business had never existed

#### Scenario: delete twice

- **WHEN** the admin deletes a registration and sends the same confirmation again from a tab they had open
- **THEN** there is no server error, nothing else is deleted and they see "Esta ficha ya no existe."

#### Scenario: the deletion confirmation leaks nothing

- **WHEN** the admin finishes deleting a registration
- **THEN** they see "Ya se borró para siempre." and an exit to the queue, and neither the screen, nor the URL, nor the server log carry the name, the WhatsApp or any data of that business

#### Scenario: the photo storage does not respond

- **WHEN** the admin confirms the deletion of a card with a photo and the storage cannot be reached
- **THEN** they read "La ficha no se borró: no pude alcanzar el almacén de fotos. Revisa la configuración y vuelve a intentar.", the card still exists in full and that screen also carries no business data

#### Scenario: the photo goes too

- **WHEN** a business whose photo is a file stored by the site is deleted
- **THEN** the file ceases to exist, no URL keeps serving it and the photo of the other businesses stays intact

### Requirement: The business detail lists its unattended reports

The detail of a business MUST show, in its own section headed with the literal text "Reportes sin atender", the pending reports of that business, from oldest to newest. Each report MUST show the readable label of its reason (the same one the resident saw: "Ya cerró", "No es real", "Los datos están mal" or "Contenido ofensivo o inapropiado"), how long it has gone unattended —in the same wording the queue uses— and the comment, only if the resident wrote one. The comment MUST be shown **as plain text**, with the same escaping as the rest of the captured data: no tag is interpreted and a very long word MUST NOT cause horizontal scroll at 390px. The section MUST come after the business data and before the actions, so the admin reads the notices before deciding, and MUST NOT appear if the business has no pending reports. The reports MUST be visible only inside the panel with a valid session: they MUST NOT appear on any public page. The detail MUST NOT show any data of whoever reported, because none exists.

#### Scenario: detail with reports

- **WHEN** the admin opens the detail of a business with two pending reports, one with a comment and one without
- **THEN** they see the section "Reportes sin atender" with both, from oldest to newest, each with the label of its reason and how long it has been waiting, and the comment only on the one that has it

#### Scenario: comment with markup

- **WHEN** a report has as its comment `<b>cerró</b><script>alert(1)</script>`
- **THEN** the panel shows it as text exactly as written and interprets no tag

#### Scenario: business without reports

- **WHEN** the admin opens the detail of a business that has no pending reports
- **THEN** they do not see the section "Reportes sin atender" nor any empty gap

#### Scenario: reports do not leave the panel

- **WHEN** the public pages of the reported business are reviewed while it has pending reports
- **THEN** neither the card, nor its listing, nor the results page show reasons, comments or counts of reports

### Requirement: Marking a report as attended, only once

Each pending report in the detail MUST have a button with the literal text "Marcar como atendido" that moves it to `attended` status with its date, removes it from that business's list of pending items and updates the queue's count. After marking it, the panel MUST confirm with the literal text "Reporte atendido." Marking as attended MUST NOT change the business's status or any of its data: it is only the record that the admin has already seen it; what they decide to do with the card are the tools the panel already has (unpublish and delete).

**The notice is painted by the business detail, whether or not the section of unattended reports exists.** Attending the last pending report makes the section disappear, which is the most frequent case —almost every reported business will have a single notice—, and the confirmation MUST NOT go away with it. A detail screen that does not come from a just-executed action MUST NOT paint any notice.

The action MUST only take effect on a report that is still `pending`: if the admin marked it twice, from two tabs or by reloading, the second time MUST NOT overwrite the date of the first and the panel MUST say so with the literal text "Este reporte ya lo habías atendido." Reloading the screen afterwards MUST NOT repeat the action. The action MUST be scoped to the business whose detail is being viewed: a report that is not from that business MUST respond exactly the same as one that does not exist, so that the panel cannot be used to find out which reports exist on other cards.

#### Scenario: attend a report

- **WHEN** the admin taps "Marcar como atendido" on one of the two pending reports of a business
- **THEN** they see "Reporte atendido.", that report disappears from "Reportes sin atender", the other one is still there and the queue now counts one report fewer for that business

#### Scenario: attending the last report is also confirmed

- **WHEN** the admin marks as attended the only pending report of a business
- **THEN** they see "Reporte atendido." even though the section "Reportes sin atender" no longer appears, and on sending the same action again they see "Este reporte ya lo habías atendido.", also without the section

#### Scenario: the last attended report takes the business out of the section

- **WHEN** the admin attends the only pending report of a business and returns to the queue
- **THEN** that business no longer appears in "Negocios reportados"

#### Scenario: the detail without a recent action shows no notice

- **WHEN** the admin opens the detail of a business without coming from marking any report
- **THEN** they do not see "Reporte atendido." nor "Este reporte ya lo habías atendido."

#### Scenario: attending does not change the business

- **WHEN** the admin marks as attended a report of a published business
- **THEN** the business stays in `published` status, with the same data, the same trades and the same publication date, and its public card does not change

#### Scenario: double marking

- **WHEN** the admin marks a report as attended and sends the same action again from a tab they had open
- **THEN** the report keeps the original attended date and they see "Este reporte ya lo habías atendido."

#### Scenario: nonexistent report or one from another business

- **WHEN** a request arrives to mark as attended a report identifier that does not exist, or that of a report that belongs to another business
- **THEN** nothing changes in the database, both responses are the same and neither carries data of any report or any business

### Requirement: The detail offers the actions that correspond to the status, with the context in sight

The detail MUST show the actions applicable to the registration's status and no others: an `in_review` registration offers approve and reject; a `published` registration offers "Despublicar" and "Generar un enlace nuevo"; any registration, in any status, offers "Borrar definitivamente". Destructive actions MUST come after the data and the context of the decision —including the business's unattended reports—, so the admin reads before acting, and "Borrar definitivamente" MUST be visually distinguished from the others as what it is: the irreversible action.

#### Scenario: detail of a published card

- **WHEN** the admin opens the detail of a business in `published` status
- **THEN** they see the unpublish form with its label "¿Por qué la despublicas?", the control "Generar un enlace nuevo" and the control "Borrar definitivamente", and do not see the approve or reject forms

#### Scenario: detail of an in-review registration

- **WHEN** the admin opens the detail of an `in_review` registration
- **THEN** they see the approve and reject forms and the control "Borrar definitivamente", and do not see the unpublish form

#### Scenario: detail of a rejected registration

- **WHEN** the admin opens the detail of a `rejected` registration
- **THEN** the only action they see is "Borrar definitivamente"

#### Scenario: deciding with the reports in sight

- **WHEN** the admin opens the detail of a published business that has unattended reports
- **THEN** they see those reports and, on the same screen and below them, the unpublish and delete actions, without having to navigate elsewhere to act

### Requirement: A transition is only applied to a registration that is still in review

Approve and reject MUST only take effect on registrations in `in_review` status. If the registration was already resolved —because the admin opened it twice, tapped the button twice or resolved it from another tab—, the second transition MUST NOT be applied nor overwrite the first, and the panel MUST say so with the literal text "Este registro ya lo habías resuelto." Reloading the screen after a transition MUST NOT repeat it.

Since any registration can be deleted at any moment, an approval may also find that the row no longer exists. That case MUST NOT end in a server error nor resurrect the row: it is resolved as registration not found, with the deleted card properly deleted.

#### Scenario: double approval

- **WHEN** the admin approves a registration and sends the same approval again from a tab they had open
- **THEN** the card keeps the original publication (same date, same trades, same origin) and they see "Este registro ya lo habías resuelto."

#### Scenario: reject something already published

- **WHEN** a rejection request arrives for a registration that is already `published`
- **THEN** the business stays published, no rejection reason is saved and the panel shows "Este registro ya lo habías resuelto."

#### Scenario: reload after resolving

- **WHEN** the admin reloads the screen that confirms the approval or the rejection
- **THEN** no transition is executed again

#### Scenario: the card is deleted halfway through an approval

- **WHEN** the admin approves a registration from one tab while permanently deleting it from another
- **THEN** the approval does not blow up with a server error, the panel resolves it as registration not found and the deleted row does not exist again

### Requirement: The pending edit detail compares what is published with what is proposed

The detail of a pending edit MUST be headed with the literal text "Cambios por revisar" and show, field by field, **what is published and what the business wants to change**, under the literal labels "Lo que está publicado" and "Lo que quiere cambiar", marking with the literal text "Cambió" each field whose proposed value differs from the published one. Fields that do not change MUST look the same, without a mark, so the admin does not have to guess what they are looking at. The mark MUST NOT depend only on color: it MUST be readable as text.

If the pending edit proposes a different WhatsApp, the detail MUST show both numbers and warn about it with the literal text "Ojo: está cambiando su WhatsApp. Confirma con el número nuevo antes de aplicar.", and the button "Escribirle por WhatsApp" MUST open the conversation with the **proposed number** (it is the one that has to be verified), with the same verification template of PRD §6.3. This complete personal data MUST be visible only inside the panel with a valid session.

#### Scenario: field-by-field comparison

- **WHEN** the admin opens a pending edit that only changes the opening hours and the address
- **THEN** they see "Cambios por revisar", the columns "Lo que está publicado" and "Lo que quiere cambiar", the mark "Cambió" next to the opening hours and the address, and the rest of the fields without a mark

#### Scenario: WhatsApp change warned about

- **WHEN** the admin opens a pending edit that proposes a WhatsApp number different from the published one
- **THEN** they see both numbers, the warning "Ojo: está cambiando su WhatsApp. Confirma con el número nuevo antes de aplicar." and the button "Escribirle por WhatsApp" opens the conversation with the new number

#### Scenario: the mark is read, not just seen

- **WHEN** the admin reviews the pending edit on the phone or with a screen reader
- **THEN** they understand which fields change by their text, without depending on a color

#### Scenario: nonexistent pending edit

- **WHEN** the admin with a session opens the detail of a pending edit that does not exist
- **THEN** they see the not-found page, with no suggestions or data of other businesses

### Requirement: Applying the pending edit updates the published card and only that

From the pending edit detail, the admin MUST be able to apply it in a single action with the literal button "Aplicar los cambios", which copies to the published card **exactly the editable fields** of the pending edit —name, category, WhatsApp, zone (from the catalogue or free text), what it offers, home deliveries, landline phone, address or references with its map pin, opening hours and page— and nothing else. The status, the origin, the assigned trades, the publication date, the registration date, the consent record and the management link MUST stay intact: applying a pending edit MUST NOT unpublish, nor put back in review, nor regenerate the link, nor force the business to re-consent. The normalized search versions MUST be recalculated, so the card can still be found by what it now says.

If the proposed WhatsApp is already held by another card at the moment of applying, the pending edit MUST NOT be applied and the panel MUST say so with the literal text "Ese número ya está en otra ficha: no se pudieron aplicar los cambios.", leaving the pending edit pending so the admin can resolve it. If the card is no longer published when the admin applies, nothing MUST be applied nor considered applied either: the pending edit MUST remain pending —so it can be applied when the card is published again— and the panel MUST say what did not happen, why, and that nothing was lost. Once the pending edit is applied, the panel MUST confirm with "Listo, la ficha ya se actualizó." and offer a button "Avisarle por WhatsApp" with the prefilled message, literally: "¡Listo! Ya actualizamos la ficha de «<nombre del negocio>» en enmirumbo. Así quedó: <link de la ficha>". The change MUST be visible in the public directory immediately.

#### Scenario: apply the changes

- **WHEN** the admin taps "Aplicar los cambios" on a pending edit that changes the opening hours of "Tacos del Güero"
- **THEN** they see "Listo, la ficha ya se actualizó.", the public card shows the new opening hours and the business keeps its `published` status, its origin, its trades and its publication date

#### Scenario: applying does not touch what is not editable

- **WHEN** the business before and after applying a pending edit are compared
- **THEN** its status, its origin, its trades, its publication date, its registration date, its consent record and its management link are identical

#### Scenario: notice that the card was updated

- **WHEN** the admin has just applied the pending edit of "Estética Lupita"
- **THEN** they see a button "Avisarle por WhatsApp" with the message "¡Listo! Ya actualizamos la ficha de «Estética Lupita» en enmirumbo. Así quedó: <link de la ficha>" already written, not sent

#### Scenario: the proposed number was taken by another card

- **WHEN** the admin applies a pending edit whose proposed WhatsApp has already been published on another card
- **THEN** nothing is applied, they see "Ese número ya está en otra ficha: no se pudieron aplicar los cambios." and the pending edit stays pending

#### Scenario: the card stopped being published

- **WHEN** the admin unpublishes a card from another tab and right away applies the pending edit they had open
- **THEN** the card does not come back to life nor change data, the pending edit stays pending, the panel explains that nothing was applied and that the changes were not lost, and when the card is published again those same changes can be applied

#### Scenario: the edited card can still be found

- **WHEN** a pending edit that changes the name to "Plomería Güicho" is applied
- **THEN** a resident who searches "plomeria" finds that business

### Requirement: Discarding the pending edit requires a reason, does not touch the card and offers to notify by WhatsApp

From the pending edit detail, the admin MUST be able to discard it by mandatorily writing the reason, under the literal label "¿Por qué no aplicas los cambios?" and with the button "Descartar los cambios". Without a reason, the discard MUST NOT be executed and the literal text "Escribe por qué descartas los cambios" MUST be shown. Since that reason is what travels inside the WhatsApp sent to the business, it MUST NOT be silently trimmed either: the same 500-character limit and the same literal message as for the unpublication reason apply to it. Discarding MUST NOT modify a single piece of data of the published card, which stays exactly as it was, nor change its status, nor invalidate the management link: the business can correct and resubmit changes with the same link. The system MUST store the reason and the date of the discard, and the panel MUST confirm with "Cambios descartados." and offer a button "Avisarle por WhatsApp" with the prefilled message, literally: "Hola, revisamos los cambios que mandaste para «<nombre del negocio>» en enmirumbo y por ahora no los pudimos aplicar: <motivo>. Tu ficha sigue publicada como estaba y puedes mandarlos otra vez con tu mismo enlace."

#### Scenario: discard with a reason

- **WHEN** the admin writes "El texto que pusiste en «¿Qué ofreces?» no lo podemos publicar" and taps "Descartar los cambios"
- **THEN** the pending edit ends up discarded with that reason and its date, leaves the queue, and the public card stays identical

#### Scenario: discard without a reason

- **WHEN** the admin taps "Descartar los cambios" with the reason empty
- **THEN** nothing changes in the database and they see "Escribe por qué descartas los cambios"

#### Scenario: discard notice by WhatsApp

- **WHEN** the admin has just discarded the changes of "Préstamos Rápidos" with the reason "No publicamos préstamos informales"
- **THEN** they see "Cambios descartados." and a button "Avisarle por WhatsApp" with the message "Hola, revisamos los cambios que mandaste para «Préstamos Rápidos» en enmirumbo y por ahora no los pudimos aplicar: No publicamos préstamos informales. Tu ficha sigue publicada como estaba y puedes mandarlos otra vez con tu mismo enlace." already written

#### Scenario: the link keeps working after a discard

- **WHEN** the owner opens their management link after some changes were discarded
- **THEN** the link works the same and the form appears prefilled with what is published

### Requirement: A pending edit is resolved only once and only if it is still the latest

Apply and discard MUST only take effect on the pending edit **that the admin had in front of them** and while it is still pending. If they already resolved it —double click, two tabs—, the second action MUST NOT be applied and the panel MUST say so with the literal text "Estos cambios ya los habías resuelto." If in the meantime the business sent newer changes that replaced those, the action MUST NOT be applied either and the panel MUST say so with the literal text "Estos cambios ya no son los últimos: el negocio mandó otros más nuevos.", leaving the new pending edit waiting in the queue and without the card ending up with anything from the old pending edit. Reloading the screen after a resolution MUST NOT repeat it.

#### Scenario: double apply

- **WHEN** the admin applies a pending edit and sends the same action again from another tab
- **THEN** the card keeps what was applied the first time and they see "Estos cambios ya los habías resuelto."

#### Scenario: the business sent others in the meantime

- **WHEN** the admin opens a pending edit, the business sends new changes that replace it, and then the admin taps "Aplicar los cambios"
- **THEN** nothing is applied —neither the old nor the new changes reach the card—, they see "Estos cambios ya no son los últimos: el negocio mandó otros más nuevos." and the new pending edit remains in the queue to be reviewed

#### Scenario: reload after resolving

- **WHEN** the admin reloads the screen that confirms they applied or discarded some changes
- **THEN** no action is executed again

### Requirement: The admin can generate a new link, and the previous one stops working

The detail of a published business MUST offer a button with the literal text "Generar un enlace nuevo" (PRD §6.4: when there is suspicion that someone else has the link, or when the owner lost it and it does not appear in the chat). On using it, the system MUST generate a new token and **the previous one MUST stop working immediately**, responding with the same 404 as an invented link. The panel MUST confirm with the literal text "Listo, el enlace anterior ya no sirve." and offer a button "Mandarle el enlace por WhatsApp" with the prefilled message, literally: "Hola, te mandamos un enlace nuevo para editar tu ficha de «<nombre del negocio>» en enmirumbo: <enlace de gestión>. El anterior ya no sirve. Guarda este mensaje (puedes destacarlo con la estrella), con ese enlace actualizas tus datos cuando quieras." That is the **only moment** the link is shown: if the admin leaves that screen without sending it, they have to generate another. Regenerating MUST NOT touch the card data or the pending edits that were already waiting.

#### Scenario: regenerating invalidates the previous one

- **WHEN** the admin taps "Generar un enlace nuevo" on the detail of a business
- **THEN** they see "Listo, el enlace anterior ya no sirve.", the old link responds 404 and the new one opens the edit mode of that same card

#### Scenario: send the new link

- **WHEN** the admin has just generated the link of "Tacos del Güero"
- **THEN** they see a button "Mandarle el enlace por WhatsApp" with the message "Hola, te mandamos un enlace nuevo para editar tu ficha de «Tacos del Güero» en enmirumbo: <enlace de gestión>. El anterior ya no sirve. Guarda este mensaje (puedes destacarlo con la estrella), con ese enlace actualizas tus datos cuando quieras." already written

#### Scenario: the link is shown only once

- **WHEN** the admin leaves the confirmation screen and returns to the business detail
- **THEN** the link no longer appears on any panel screen, and to send it again they have to generate another

#### Scenario: regenerating does not touch the card or the queue

- **WHEN** the admin generates a new link for a business that has a pending edit
- **THEN** the card data does not change and the pending edit keeps waiting in the queue

### Requirement: No panel message is presented with the previous brand

Every WhatsApp message the panel builds for the admin to send to a business MUST name the directory as "enmirumbo", with the descriptor "el directorio de negocios de Tizayuca" **only in the first-contact message** (the verification one). The others reach someone who has already received that introduction and say plain "enmirumbo". None MUST keep the previous brand nor write the locality attached to the name, including the messages that other changes add later.

#### Scenario: all panel messages are reviewed

- **WHEN** the prefilled messages the panel can build today are reviewed —verification, publication notice with both links, rejection notice, unpublication notice, applied-changes notice, discarded-changes notice and the new-link one—
- **THEN** the verification one presents the site as "enmirumbo, el directorio de negocios de Tizayuca", the other six say plain "enmirumbo", and none mentions the previous brand or attaches the locality to the name

#### Scenario: a new panel message is born with the current brand

- **WHEN** another change adds one more prefilled message to the panel
- **THEN** the site's brand guard (capability `base-layout`) reviews it like the others and fails if it carries the previous brand or the locality attached to the name

### Requirement: The panel is operated from the phone and without unnecessary client JavaScript

The panel MUST be mobile-first: queue —**including the section of reported businesses**—, listing of all businesses with its filters and its pagination, detail —**including the list of unattended reports**—, **comparative detail of the pending edit**, forms to approve, reject, unpublish, apply the changes, discard the changes, generate a new link and mark as attended, and the deletion confirmation screen MUST look complete and be usable in a 390px viewport, without horizontal scroll, with touch targets of at least 44px and AA contrast (PRD §8). The comparison between what is published and what is proposed MUST be readable on that screen, without forcing the admin to scroll sideways. The panel screens MUST be Server Components and their forms MUST work without client JavaScript, just like the public registration. In the listing, filtering and changing page are links, not controls with JavaScript: the whole view works with client JavaScript disabled.

#### Scenario: review from the phone

- **WHEN** the admin opens the queue with the reported section, the detail of a business with reports, the detail of a pending edit and the forms to approve, reject, unpublish, apply, discard and mark as attended in a 390px viewport
- **THEN** everything looks complete and legible, without horizontal scroll —including a report comment without spaces— and every tappable control measures at least 44px in its smaller dimension

#### Scenario: the comparison is read on the phone

- **WHEN** the admin reviews in 390px a pending edit that changes several fields
- **THEN** they understand what is published and what is proposed without scrolling horizontally

#### Scenario: the listing is also operated on the phone

- **WHEN** the admin opens "Todos los negocios" in a 390px viewport, with long names and a long free-text zone
- **THEN** they see the full rows without horizontal scroll, and the filters, the pagination links and every "Ver detalle" entry measure at least 44px in their smaller dimension

#### Scenario: the panel works without JavaScript

- **WHEN** the admin signs in, approves, rejects, unpublishes, applies a pending edit, discards it, generates a new link, marks a report as attended and deletes with client JavaScript disabled
- **THEN** the nine actions work the same, because each one is a server form submission

#### Scenario: the listing is filtered and paged without JavaScript

- **WHEN** the admin opens the listing with client JavaScript disabled, changes filter and advances a page
- **THEN** both work, because they are links that only change the querystring

#### Scenario: the deletion confirmation is also operated on the phone

- **WHEN** the admin opens the deletion confirmation screen in a 390px viewport with client JavaScript disabled
- **THEN** they see the full text without horizontal scroll, can type the word and delete

#### Scenario: no client JS of its own

- **WHEN** the new panel files are reviewed
- **THEN** none declares `"use client"` nor adds a client bundle of its own

### Requirement: The admin panel is protected by Cloudflare Access with one-time email codes (v2)

Added in v2 — source: ADR 0010, PRD §2 (principle 1).

One self-hosted Cloudflare Access application MUST protect `/admin` in every environment, with one destination per hostname. Login MUST be a one-time code sent by email, the policy MUST list the five team mailboxes explicitly and sessions MUST last 24 hours. The application MUST have no login form, password, session cookie or second factor of its own: the second factor is the mailbox. The panel MUST NOT count login attempts, because there is no login of its own. The screen "Panel de revisión" with a password field and the buttons "Entrar" and "Salir" no longer exist.

#### Scenario: logging in

- **WHEN** a person on the policy opens `/admin` without a session
- **THEN** Cloudflare Access asks for their email, sends a one-time code and, once typed, shows the review queue

#### Scenario: a person not on the policy

- **WHEN** a person whose mailbox is not on the policy asks for a code
- **THEN** Access does not let them in and the panel shows them nothing

#### Scenario: the panel has nothing of its own

- **WHEN** the panel code and its responses are reviewed
- **THEN** there is no password field, no session cookie of the application, no sign-in form and no counter of failed attempts

### Requirement: Every admin request carries an Access token that the Worker verifies (v2)

Added in v2 — source: ADR 0010.

On every `/admin` request, page or action, the Worker MUST verify the JWT of the `Cf-Access-Jwt-Assertion` header against the JWKS of the team (`https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`), checking its signature, expiry, issuer and the AUD tag of the application, before reading or writing anything. It MUST read the email claim as the identity of the admin. A request without a valid token MUST get a 403, even if it reached the Worker without passing through Access, and the response MUST NOT show any data of a card, a report or an edit, nor confirm that an identifier exists. The team domain and the AUD tag are per-environment variables. The token MUST come only from that header and MUST be signed with RS256 by a key of the team's JWKS and carry an expiry. Astro Actions are reachable outside `/admin`, so every admin action MUST verify the token of its own request inside its handler before reading or writing anything, and refuse with `FORBIDDEN` otherwise. Every response under `/admin`, the 403 included, MUST send `X-Robots-Tag: noindex, nofollow` and `Cache-Control: no-store`, and every 403 MUST carry the same generic body whatever the reason. No public surface MUST be able to change the state, origin, trades or zone of a business, unpublish it, delete it, resolve an edit, generate a link or mark a report as attended.

#### Scenario: a valid token

- **WHEN** a request to `/admin` carries a token with a valid signature, not expired, with the right issuer and AUD
- **THEN** the page is served and the email claim is the identity used by the audit log

#### Scenario: no token

- **WHEN** a request reaches `/admin` or the URL of a card detail without the header
- **THEN** the answer is 403 with no data of any card

#### Scenario: a token that fails

- **WHEN** the token has an altered signature, is expired, has another issuer or has the AUD of another application
- **THEN** the answer is 403 and nothing is read or written

#### Scenario: actions without a token

- **WHEN** a request to approve, reject, unpublish, apply or discard an edit, generate a link, mark a report as attended or delete arrives without a valid token
- **THEN** the answer is 403, the card does not change, no reason or token is saved and the response carries no data of the business

#### Scenario: an admin action called outside `/admin`

- **WHEN** an admin action is called through `/_actions/<name>` or with `?_action=<name>` on a public page, without a valid token
- **THEN** its handler refuses with `FORBIDDEN` before reading or writing anything

#### Scenario: no caching and no indexing

- **WHEN** any response under `/admin` is reviewed, a 403 included
- **THEN** it sends `X-Robots-Tag: noindex, nofollow` and `Cache-Control: no-store`

#### Scenario: nothing from the public surfaces

- **WHEN** the registration form, the edit mode, the listings, the cards and the report form are reviewed
- **THEN** none can perform an admin transition

### Requirement: A deployed environment without Access configuration does not open the panel (v2)

Added in v2 — source: ADR 0010, PRD §2 (principle 5).

When the team domain or the AUD tag of an environment is missing or empty, the panel MUST NOT open for anyone: every `/admin` request MUST get a 403, no transition can run, and the log MUST name the variable that is missing without putting the detail in the response. A team domain that is not of the form `<team>.cloudflareaccess.com`, and an environment variable that is missing or is not exactly `local`, `dev`, `stage` or `prod`, count as missing configuration too. The system MUST NOT invent a default identity or leave the panel open.

#### Scenario: missing AUD

- **WHEN** the server runs without the AUD variable and a request with an otherwise valid token arrives
- **THEN** the answer is 403 and the log names the missing variable

#### Scenario: no transitions

- **WHEN** the panel is not configured and a request to approve or reject arrives directly
- **THEN** nothing changes in the database and the response has no data of the card

#### Scenario: unknown environment

- **WHEN** the environment variable is missing or says something other than `local`, `dev`, `stage` or `prod`, and a request with an otherwise valid token arrives
- **THEN** the answer is 403 and the log names the environment variable

### Requirement: Locally, a fixed identity is injected only when the environment says `local` (v2)

Added in v2 — source: ADR 0010. Amended on 2026-10-18 by EMR-46: the fixed identity is a panel user like any other.

In local development a fixed admin identity (`admin@enmirumbo.test`) MAY be injected, and only when the environment variable says exactly `local` and the request arrives on a loopback host (`localhost`, `127.0.0.1` or `[::1]`), so that a Worker deployed by mistake with the local variables still refuses it. Deployed environments (`dev`, `stage`, production) MUST NEVER accept it, and a test MUST prove it. What the fixed identity may do comes from the database, as for any panel user ("Inside the panel, a user can do only what their roles allow (v2)"): without a user of that email with an active role assignment, the panel answers it the same 403. It is created by hand in the local database, as the first super admin of every environment is (README), and the end-to-end tests make it a super admin in their own database; no migration or seed creates it.

#### Scenario: local

- **WHEN** the environment variable is `local` and `/admin` is opened
- **THEN** the panel opens with the fixed identity

#### Scenario: deployed

- **WHEN** the environment is `dev`, `stage` or production and a request relies on the fixed identity
- **THEN** it is rejected with a 403, and a test covers it

#### Scenario: the fixed identity without a role

- **WHEN** the environment variable is `local`, `/admin` is opened on `localhost` and `admin@enmirumbo.test` has no active role assignment
- **THEN** the answer is the panel's 403, with no data

#### Scenario: local variables on a deployed host

- **WHEN** the environment variable says `local` but the request arrives on a host that is not a loopback one
- **THEN** it is rejected with a 403 and the log says why

### Requirement: The destructive actions of the admin write to the audit log with the Access identity (v2)

Added in v2 — source: PRD §4, ADR 0010.

Each reject, unpublish, permanent deletion and edit of contact data done from the panel MUST write an entry of the audit log (see "The audit log records the destructive actions of the admin (v2)" in `data-model`) with the email of the Access identity, in the same operation as the action. If the entry cannot be written, the action MUST NOT be reported as done.

#### Scenario: the identity comes from the token

- **WHEN** the admin rejects a registration
- **THEN** the entry's actor is the email claim of the token of that request

#### Scenario: the entry and the action go together

- **WHEN** the entry cannot be saved while unpublishing a card
- **THEN** the action fails visibly and the card stays published

### Requirement: The admin can edit any card to serve the rectification right (v2)

Added in v2 — source: PRD §3 (Flow E), PRD §7, prototype backlog E3-7.

From the detail of any card, whatever its state, the admin MUST be able to edit it with the same form and the same validations as the registration, including removing an optional field at the request of the business. The change applies to the card directly and does not create a pending edit. Each edit of contact data MUST write an entry in the audit log.

#### Scenario: correcting a field

- **WHEN** the admin changes the address of a published card and saves
- **THEN** the card shows the new address, a pending edit is not created and an audit log entry is written

#### Scenario: removing an optional field

- **WHEN** the admin clears the Facebook link at the request of the business
- **THEN** the card no longer has that link

#### Scenario: validations

- **WHEN** the admin saves a WhatsApp number that does not normalize to 10 digits
- **THEN** nothing is saved and the field shows the same error as the registration

### Requirement: The admin can send the business a copy of its data by WhatsApp (v2)

Added in v2 — source: PRD §3 (Flow E), PRD §7.

From the detail of any card, the admin MUST be able to open WhatsApp to the business's number with a prefilled message that carries a copy of the data stored on its card, to serve the right of access. The data MUST be only that of the card.

#### Scenario: the copy

- **WHEN** the admin taps the button to send the data copy
- **THEN** WhatsApp opens to the number of the business with a message that lists the data of its card

#### Scenario: nothing else

- **WHEN** the message is reviewed
- **THEN** it contains no internal data (rejection or unpublishing reasons, link fingerprint, reports)

### Requirement: The panel filters by locality, and the filter is hidden while there is one (v2)

Added in v2 — source: ADR 0006. Amended on 2026-10-18 by EMR-46: how the filter is written and which localities it offers.

There MUST be a single admin panel. Its queue and list MUST accept a locality filter, which MUST be hidden while only one locality is active.

The filter is a group of links under the literal label "Filtrar por municipio", with the option "Todos" (the default) and one option per locality, written "<municipio>, <estado>" from the locality record, such as "Tizayuca, Hidalgo". Its options are the active localities where the user sees something in that screen ("Each review screen checks its permission in the locality of what it shows (v2)"), and it MUST be shown only while there are two or more of them: a user who sees one active locality never sees it, whatever the number of localities of the site. The chosen locality travels in the query as `localidad=<INEGI code>`; a value that is not one of the options, empty or repeated, MUST be treated as "Todos", with no error. The chosen option is marked in words and not only by a colour, like the status filter, and changing it returns the list to its first page and keeps its status filter and its search. While the rows of several localities are shown, each row MUST also say its locality, so two zones of the same name are not confused. "Todos" lists the cards of every locality the user sees, inactive ones included: a locality turned off still has cards the admin must be able to reach.

#### Scenario: one locality

- **WHEN** the admin opens the queue while only Tizayuca is active
- **THEN** no locality filter is shown

#### Scenario: two localities

- **WHEN** a second locality is active and the admin filters the list by it
- **THEN** only the businesses of that locality are listed

#### Scenario: a locality the user does not see

- **WHEN** a second locality is active but the user holds no permission there, or someone writes the code of a locality the user does not see in `localidad`
- **THEN** no locality filter is shown, and the screen lists what "Todos" lists

### Requirement: The admin can hide and rename the zones of a locality (v2)

Added in v2 — source: ADR 0006. Amended on 2026-10-18 by EMR-52 and the decision of the product owner of that date: where the zones screen lives and what it shows, who may use it, that a rename keeps the display names unambiguous, and that the screen does not normalize the zone "Otra" of a card; adding a zone is "The admin can add a zone to a locality (v2)". Amended on 2026-10-18 by EMR-47: the approval offers the hidden zones, marked.

The panel MUST let the admin hide, show and rename the zones of a locality. Renaming does not change the slug (see "Catalogues of categories, zones and trades with stable slug").

**The screen.** The zones of a locality live at `/admin/colonias`, under the panel's Access check, headers and no-indexing, and the queue leads there with the link "Administrar colonias", shown only to who may use it. Its heading is "Colonias de <municipio>", from the locality record. It lists every zone of the locality, hidden ones included, in alphabetical order of the name the public pages show it with (`public-directory`, "A zone whose name repeats in its locality is shown with its settlement type (v2)"), under the count "<n> colonias" (", <m> ocultas" while some are hidden), and each row says its name as shown, "Tipo: <type>", "En la URL: <slug>" and, when it is hidden, the label "Oculta" in words. Each row has the button "Ocultar" (or "Mostrar", for a hidden zone) and the disclosure "Cambiarle el nombre", which holds the field "Nombre nuevo", filled with the stored name, and the button "Guardar el nombre"; the disclosure is the browser's own, so the screen needs no client JavaScript. The screen reads and writes through the fresh connection to the database.

**Its locality.** The screen shows one locality at a time: the one `?localidad=<INEGI code>` names among the localities where the user may manage zones, or else the first active one of them. "Filtrar por municipio" offers, as links, the active ones, with no "Todos" because a zone belongs to one locality, and only while there are two or more ("The panel filters by locality, and the filter is hidden while there is one (v2)"); a locality of the user that is not active opens only by its address, so a city can have its zones ready before it is turned on. The query carries only `localidad` and `listo`.

**Who.** Hiding, showing, renaming and adding need `zones.manage` in the locality of the zone (`data-model`, "Panel users, roles and permissions live in the database (v2)"). A user who holds it in no locality, or who is not a panel user, gets the panel's 403 on the screen. Each form posts to the screen of its locality with its action, which checks the Access token and the permission again; the locality comes from the screen's address, never from a field, and a zone that is not of that locality, a locality where the user may not manage zones, or an action called from any other page answers the site's 404 and changes nothing.

**Hiding** changes only whether the registration and the edit offer the zone (`business-registration`, "The zone options come from the active locality (v2)"); the edit still offers a card the zone it already has. **Renaming** changes only the name, which every surface reads from the zone, and never the slug or the URLs. A name is trimmed and its spaces collapsed; it MUST NOT be empty ("Escribe el nombre de la colonia."), longer than 80 characters ("Deja el nombre en 80 caracteres o menos.") or without a letter or a digit ("Escribe el nombre con letras o números."). Names may repeat in a locality only while the display names still tell the zones apart: a rename after which two zones of the locality, hidden ones included, would be shown with the same name, compared as the site compares zone names, is refused with "Ya hay otra colonia que se vería igual: «<nombre como se vería>». Ponle un nombre distinto." A rename to the name the zone already has changes nothing.

**After a change.** A change saved answers a 303 to the screen of its locality with `listo=<zone id>` and the zone's row as the fragment, so a reload never sends the form again; that row says, as a status, "Listo. El cambio puede tardar hasta un minuto en verse en el sitio." ("The panel says that a change takes up to a minute to reach the site (v2)"). A form with errors comes back with a 400, open, with what was typed and each error next to its field. None of these changes writes to the audit log, which records only what is done to a card (`data-model`, "The audit log records the destructive actions of the admin (v2)").

**"Otra".** The screen does not normalize the zone "Otra" of a card. By decision of the product owner (2026-10-18), that happens on approving a registration and on applying an owner's edit, as their requirements settle, so that a published card always has a catalogue zone. The approval offers the hidden zones too, marked "(oculta)", since a business that typed the name of a hidden zone arrived as "Otra" ("Approving and rejecting are forms of the detail, and their action checks everything again (v2)").

#### Scenario: hide

- **WHEN** the admin hides a zone
- **THEN** it is no longer offered in the registration form

#### Scenario: hide, from the screen

- **WHEN** the admin taps "Ocultar" on the row of "Nacozari" of Tizayuca
- **THEN** the screen comes back with that row labelled "Oculta" and saying "Listo. El cambio puede tardar hasta un minuto en verse en el sitio.", the registration, and the edit of a card in another zone, no longer suggest "Nacozari", and "Mostrar" offers it again

#### Scenario: rename

- **WHEN** the admin renames a zone
- **THEN** the new name is shown everywhere and its URLs do not change

#### Scenario: a rename that two zones would show the same way

- **WHEN** the admin renames the colonia "Ampliación el Carmen" to "El Carmen", while the colonia "El Carmen" is shown as "El Carmen (Colonia)"
- **THEN** nothing changes, and the form comes back open with "El Carmen" and "Ya hay otra colonia que se vería igual: «El Carmen (Colonia)». Ponle un nombre distinto."

#### Scenario: a user without the permission

- **WHEN** a user whose roles do not grant `zones.manage` in any locality opens `/admin/colonias`, or posts one of its forms
- **THEN** they get the panel's 403, the queue does not show them "Administrar colonias", and no zone changes

### Requirement: The admin can add a zone to a locality (v2)

Added in v2 — source: decision of the product owner, 2026-10-18 (EMR-52): the locality grows with housing developments that SEPOMEX does not list yet, and approving a registration needs a catalogue zone. It amends `data-model`, "Zones belong to a locality, and Tizayuca's come from the SEPOMEX postal catalogue (v2)": the zones of SEPOMEX still ship in data migrations, and a zone the admin adds is data the panel writes.

The zones screen ("The admin can hide and rename the zones of a locality (v2)") MUST let the admin add a zone to its locality, above the list, under "Agregar una colonia", with the fields "Nombre" and "Tipo" and the button "Agregar colonia". The type is one of the settlement types the zones of the locality already have, chosen from a list whose first option, "Elige el tipo", is none; without one, the form says "Elige el tipo de la colonia." The name follows the rules of a rename. The new zone is visible, and the registration and the edit offer it at once, the public pages within a minute.

Its slug comes from its name with the slug rule of the catalogues (`data-model`, "Catalogues of categories, zones and trades with stable slug (v2)") and never changes afterwards, even when the zone is renamed. Before anything is saved, the panel MUST refuse a name:

- whose letters cannot be written in a URL ("ß"): "Ese nombre tiene letras que no caben en una URL. Escríbelo con las letras del español, números y espacios.";
- whose slug another zone of the locality has, hidden or renamed ones included: "Ya hay una colonia con esa misma URL (<slug>): «<nombre de esa colonia>». Si es la misma, búscala en la lista para mostrarla o cambiarle el nombre; si es otra, ponle un nombre distinto.";
- whose slug makes a URL of the locality read in two ways, by the same check the tests run on the catalogues the migrations leave (`data-model`, "The slugs of the catalogues do not produce ambiguous URLs at the root of a locality (v2)"), with the same reserved segments: "Con ese nombre, la URL «<segmento>» se confundiría con <lo otro>. Ponle otro nombre; por ejemplo, con su tipo adelante: «<Tipo> <Nombre>».", where what else it would be is "una página propia del sitio", "la categoría «…»", "el giro «…»" or "la del giro «…» en «…»", and a segment of a trade in the new zone adds "(la del giro «…» en esta colonia)" after it;
- after which two zones of the locality would be shown with the same name, as for a rename.

#### Scenario: a new fraccionamiento

- **WHEN** the admin adds "Los Pinos de Mentiras", of type "Fraccionamiento", to Tizayuca
- **THEN** the zone is saved visible with the slug `los-pinos-de-mentiras`, its row says "En la URL: los-pinos-de-mentiras" and "Listo. El cambio puede tardar hasta un minuto en verse en el sitio.", the registration suggests it, a registration can name it and an approval can give it to a card

#### Scenario: renamed, it keeps its URL

- **WHEN** the admin renames a zone they added
- **THEN** its slug, and so its URLs, stay the ones it was given

#### Scenario: a URL that is already taken

- **WHEN** the admin adds "Centro" to a locality that has a zone with the slug `centro`, visible or hidden, with that name or another
- **THEN** nothing is saved and the form says that zone's name and the URL it already has

#### Scenario: a reserved segment

- **WHEN** the admin adds "Registro"
- **THEN** nothing is saved and the form says "Con ese nombre, la URL «registro» se confundiría con una página propia del sitio. Ponle otro nombre; por ejemplo, con su tipo adelante: «Colonia Registro»." for the type "Colonia"

#### Scenario: a URL with two readings

- **WHEN** the admin adds a zone whose slug, after a trade, composes the slug of another trade or of another trade and zone pair
- **THEN** nothing is saved and the form names the segment and what else it would be

#### Scenario: a zone named like a trade

- **WHEN** the admin adds a zone whose slug is a trade's
- **THEN** it is saved: a zone alone is no page

### Requirement: Dates in the panel use the time zone of the locality (v2)

Added in v2 — source: ADR 0006, prototype debt (docs/backlog.md, T-018). Amended on 2026-10-18 by EMR-46: how the dates are written.

Every date and time shown in the panel MUST be written in the IANA time zone of the locality of the card, not in the server's. A day is written in full, "3 de septiembre de 2026", as the list's "Se registró el 3 de septiembre de 2026" and the consent record's "3 de septiembre de 2026 (versión 1)" quote it; a moment of the detail adds its local time in 24 hours, "3 de septiembre de 2026, 14:05". A wait is written in hours below 48 ("Hace menos de una hora", "Hace 1 hora", "Hace 3 horas") and in days from then on ("Hace 2 días"), in the queue and in the reports of a detail alike.

#### Scenario: near midnight

- **WHEN** a business registered at 23:30 in the time zone of its locality (already the next day in UTC) is shown in the list
- **THEN** its registration date is the local day

### Requirement: A rejection reason is never silently trimmed (v2)

Added in v2 — source: prototype debt (docs/backlog.md, E3-10).

A rejection reason longer than 500 characters MUST be refused with the same form error as unpublishing, instead of being trimmed to 500 characters.

#### Scenario: too long

- **WHEN** the admin writes a rejection reason of 501 characters and rejects
- **THEN** nothing is saved, the registration stays in `in_review` and they see "El motivo no puede pasar de 500 caracteres. Recórtalo un poco: así, completo, es como le va a llegar al negocio."

#### Scenario: the limit

- **WHEN** the reason has exactly 500 characters
- **THEN** it is saved complete

### Requirement: A failed approval repaints exactly the trades the admin selected (v2)

Added in v2 — source: prototype debt (docs/backlog.md, E3-11).

When an approval fails a validation, the form MUST show the trades exactly as the admin left them, including none selected, and MUST NOT repaint the trades of the registration.

#### Scenario: all unticked

- **WHEN** the admin unticks every trade, and the approval fails for another validation
- **THEN** the form comes back with no trade ticked

#### Scenario: some ticked

- **WHEN** the admin ticks two trades and the approval fails for another validation
- **THEN** those two stay ticked

### Requirement: Inside the panel, a user can do only what their roles allow (v2)

Added in v2 — source: ADR 0021.

Cloudflare Access proves the email; the roles decide what it may do. After the Access token is verified, the Worker MUST look up the panel user of that email. A user that does not exist, is inactive or has no active role assignment MUST get the same 403 as a request without a valid token. Every screen and every action MUST check its permission (see "Panel users, roles and permissions live in the database (v2)" in `data-model`) in the locality of the card, edit, report or zone it touches, and managing users, roles and localities MUST need a global assignment. The panel MUST list only the localities, cards and actions the user may use. Super admins create users, roles and assignments from the panel; the first super admin of each environment is inserted by hand in the database.

#### Scenario: on the Access policy but without a role

- **WHEN** a person whose email is on the Access policy, but who has no active role assignment, opens `/admin`
- **THEN** they get the 403 page and see no data

#### Scenario: another locality's card

- **WHEN** a locality admin of locality A opens or acts on a card of locality B
- **THEN** the panel refuses it as if the card did not exist, and the queue of A never lists it

#### Scenario: a super admin

- **WHEN** a super admin opens the panel
- **THEN** they see every active locality and may manage users and roles

### Requirement: The panel says that a change takes up to a minute to reach the site (v2)

Added in v2 — source: ADR 0005, decision of 2026-10-14. Amended on 2026-10-18 by EMR-52: adding a zone is one of those actions.

The public pages may show a change up to a minute late (`public-directory`, "Public pages may show a change up to a minute late (v2)"). After every action that changes what the public pages show —approve, unpublish, permanently delete, apply a pending edit, edit a card, hide, show, rename or add a zone— the confirmation the panel shows MUST include the literal text "Listo. El cambio puede tardar hasta un minuto en verse en el sitio." Actions that change nothing public (reject a registration in review, discard a pending edit, generate a link, attend a report) MUST NOT show it.

#### Scenario: unpublishing

- **WHEN** the admin unpublishes a card
- **THEN** the confirmation says "Listo. El cambio puede tardar hasta un minuto en verse en el sitio."

#### Scenario: an action that changes nothing public

- **WHEN** the admin generates a new management link
- **THEN** that text does not appear

### Requirement: Applying or discarding a pending edit carries out what it asks of the photo (v2)

Added in v2 — source: decision of the product owner, 2026-10-18 (EMR-43): the owner's edit may change the photo (`business-registration`, "The edit of a card may change its photo, which reaches the card only when the edit is applied (v2)"). It amends "Applying the pending edit updates the published card and only that", whose editable fields now include the photo, and "Discarding the pending edit requires a reason, does not touch the card and offers to notify by WhatsApp".

Applying a pending edit MUST also carry out what it asks of the photo (`data-model`, "A pending edit may change the photo of its card (v2)"): `keep` leaves the card's photo as it is; `replace` gives the card the edit's new photo key; `remove` leaves the card without a photo. When the card stops naming its previous photo, the objects of that photo are deleted once the card is saved, and a deletion that fails is logged by its kind and left to the orphan sweep. An edit that is not applied (another card has its number, the card is no longer published, the edit is no longer the latest) changes nothing of the photo either, and its new photo stays with it. Discarding a pending edit that carries a new photo MUST delete that photo's objects once the edit is discarded; the card's photo does not change. How the detail of a pending edit shows the photo it proposes is settled with that screen (epic F).

#### Scenario: applying a new photo

- **WHEN** the admin applies a pending edit that carries a new photo for a card that had one
- **THEN** the card shows the new photo, and the objects of the old one no longer exist

#### Scenario: applying the removal of the photo

- **WHEN** the admin applies a pending edit that asks to leave the card without a photo
- **THEN** the card has no photo, and the objects of the one it had no longer exist

#### Scenario: discarding a new photo

- **WHEN** the admin discards a pending edit that carries a new photo
- **THEN** the objects of that photo no longer exist, and the card keeps its own

### Requirement: The review screens live at fixed addresses under `/admin` (v2)

Added in v2 — source: decision of the product owner, 2026-10-18 (EMR-46); ADR 0010. It settles the address of the pending edit detail, which no earlier requirement gave. Amended on 2026-10-18 by EMR-47: the confirmation of a rejection has its own address, and the detail of a card in review offers its decisions ("Approving and rejecting are forms of the detail, and their action checks everything again (v2)").

The review screens of the panel MUST live at these addresses, all of them under `/admin`, so that the Access check, the panel's headers, its no-indexing and its referrer policy reach them by where they live:

- `/admin`: the review queue, the panel's main screen ("Review queue with the pending registrations, oldest first"), which replaces the placeholder that only named the signed-in email.
- `/admin/negocios`: "Todos los negocios".
- `/admin/registros/<id>`: the detail of a card, by its identifier ("The card is identified by a short random id (v2)" in `data-model`), whatever its status. The queue's "Revisar" of an "Alta nueva", the list's "Ver detalle" and the reported section's "Ver reportes" lead here.
- `/admin/registros/<id>/rechazado`: the confirmation of the rejection of that card, where a rejection lands ("Approving and rejecting are forms of the detail, and their action checks everything again (v2)").
- `/admin/ediciones/<n>`: the detail of a pending edit, by its number. The queue's "Revisar" of an "Edición" leads here. Applying or discarding acts on the edit of that number, which is what lets them refuse an edit that is no longer the one the admin had in front of them ("A pending edit is resolved only once and only if it is still the latest").

An identifier or a number of another shape, one that no card or edit has, and a card or edit the user may not see MUST all answer the site's 404, under the panel's headers. The queue and the list carry in their query only what "The listing is filtered by status without leaving the view", "The listing searches by name or WhatsApp (v2)" and "The panel filters by locality, and the filter is hidden while there is one (v2)" allow; the details carry nothing in theirs but the name of the action a form posts with. The detail of a card in review offers approving and rejecting to who may review it; every other action of the details arrives with its own story, and until then they show no form, button or action that changes anything. Their actions come after what they show.

#### Scenario: the panel's main screen

- **WHEN** a panel user opens `/admin`
- **THEN** they see "Registros por revisar", not a placeholder

#### Scenario: Revisar leads to the right detail

- **WHEN** the admin taps "Revisar" on an "Alta nueva" and on an "Edición"
- **THEN** the first opens `/admin/registros/<id>` of that card and the second `/admin/ediciones/<n>` of that edit

#### Scenario: an address that names nothing

- **WHEN** the admin opens `/admin/registros/nada`, `/admin/registros/<an identifier no card has>` or `/admin/ediciones/<a number no edit has>`
- **THEN** each answers the site's 404, with `noindex, nofollow`, and nothing about any card

### Requirement: Each review screen checks its permission in the locality of what it shows (v2)

Added in v2 — source: decision of the product owner, 2026-10-18 (EMR-46); ADR 0021. It details, for the review screens, "Inside the panel, a user can do only what their roles allow (v2)".

Every review screen MUST first find out what the signed-in user may see, from the permissions of their active role assignments (`data-model`, "Panel users, roles and permissions live in the database (v2)"), through the fresh connection to the database, and show only that. A global assignment grants its permissions in every locality of the site, active or not; a locality assignment, in its own. The screens use these permissions of the catalogue, and no new one:

- the "Alta nueva" rows of the queue: `businesses.review` in the card's locality;
- the "Edición" rows of the queue and the detail of a pending edit: `edits.review` in the card's locality;
- "Negocios reportados" in the queue, and "Reportes sin atender" in the detail of a card: `reports.manage` in the card's locality;
- the detail of a card, and so its row in "Todos los negocios": any permission that acts on a card in its locality (`businesses.review`, `businesses.edit`, `businesses.unpublish`, `businesses.delete`, `reports.manage` or `links.manage`), because the actions of those permissions live in that detail. Resolving pending edits alone does not open the detail of a card in review.

A screen with nothing the user may see —a user who does not exist, is inactive, has no active assignment, or holds none of that screen's permissions anywhere— MUST answer the panel's generic 403, before reading any card. A card or an edit of a locality where the user may not see it MUST answer the same 404 as one that does not exist, so the panel cannot tell a user that it exists. A link to a screen the user may not open is not shown: "Ver todos los negocios" and "Volver a la cola" appear only to who may open the list and the queue. The panel's actions, when they arrive, check their own permission again in the locality of what they touch.

#### Scenario: a locality admin

- **WHEN** a user with `locality_admin` in locality A opens the queue, the list and the details
- **THEN** they see the cards, edits and reports of A, and every card or edit of B answers the 404

#### Scenario: a super admin

- **WHEN** a user with `super_admin` opens the queue and the list
- **THEN** they see the cards of every locality, an inactive one included

#### Scenario: a role that only attends reports

- **WHEN** a user whose only role grants `reports.manage` in A opens the queue
- **THEN** they see "Negocios reportados" with the reported cards of A and no row of "Registros por revisar", can open the detail of a reported card with its reports, and get the 403 on the detail of a pending edit

#### Scenario: on the Access policy but without a role

- **WHEN** a person whose email is on the Access policy, but who has no active role assignment, opens `/admin`, `/admin/negocios`, the detail of a card or the detail of an edit
- **THEN** each answers the panel's 403, which names no card

### Requirement: The listing searches by name or WhatsApp (v2)

Added in v2 — source: backlog of epic F, story F1 (EMR-46): "a search by name or WhatsApp". It amends "The listing is filtered by status without leaving the view": besides the status and the page, the query of the list may carry what the admin searched.

"Todos los negocios" MUST offer a search box under the literal label "Buscar por nombre o WhatsApp", with the button "Buscar", as a GET form to the list itself, so it works without client JavaScript. It finds the cards whose name contains every word typed (up to four), ignoring capitals, accents and punctuation as the directory's search does, and the card whose WhatsApp is the number typed, read as the registration reads it: ten digits, with or without `+52` or `521`, spaces, hyphens or brackets. A search keeps the status and locality filters, the filters keep the search, and searching returns to the first page; the count of the header counts what was found. Without results the screen says, literally, "No encontramos negocios con esa búsqueda." While a search is applied, the link "Quitar la búsqueda" returns to the list without it. What was typed comes back in the box, cut to 80 characters and without invisible characters; a `q` that is empty or repeated is no search.

What the admin typed is the only text that MAY travel in the list's query besides the filters and the page: it never names a card the admin did not type, the panel's responses are never stored by a cache, its referrer policy sends no path to any page, and nothing the panel shows or receives is written to the log.

#### Scenario: by name

- **WHEN** the admin searches "tacos guero" in a list that has "Tacos del Güero"
- **THEN** that card is listed, and so is any other whose name has both words

#### Scenario: by WhatsApp

- **WHEN** the admin searches "+52 771 999 0101"
- **THEN** the card whose WhatsApp is `7719990101` is listed

#### Scenario: nothing found

- **WHEN** the search finds no card
- **THEN** the screen says "No encontramos negocios con esa búsqueda." and keeps the filters and the box in sight

### Requirement: The panel shows the photos it reviews from the media hostname (v2)

Added in v2 — source: decision of the product owner, 2026-10-18 (EMR-46); ADR 0011; `public-directory`, "The photo of an unpublished business is referenced on no public surface (v2)". It amends "Registration detail with all the captured data, only inside the panel": the panel has no photo address of its own any more.

The panel MUST show the photo of a card in review, rejected or unpublished, and the new photo of a pending edit, from the environment's media hostname, at the address built from the stored key, like the public pages do for a published card: `photos/<key>/full.webp`, at its own size (1200×900), large enough to judge it against the photo policy. The key is opaque, 24 random characters of about 119 bits, and only the panel's pages name a key that is not a published card's; those pages are behind Access, never indexed nor cached, and their referrer policy sends no path to any page. So the sentence of "Registration detail with all the captured data, only inside the panel" that asks that "the address with which the panel shows the photo of an unpublished registration MUST NOT serve anything without a valid session", and its scenario "the photo of the in-review registration does not leave the panel", no longer apply: the address serves the photo to whoever has it, and nobody outside the panel can have it. A stored value that is not a key the server generated is no photo, and the panel says "Sin foto".

No public page names the key of a card that is not published, and the photos of the panel do not change that.

#### Scenario: the photo of a registration in review

- **WHEN** the admin opens the detail of a registration in review that uploaded a photo
- **THEN** they see it under "Foto del negocio", from the media hostname at its `full` size, and no public page names its key

#### Scenario: a stored value that is not a key

- **WHEN** a card stores as its photo a URL or any value that is not a key the server generated
- **THEN** the panel shows "Sin foto" and builds no address from it

### Requirement: The detail of a pending edit shows the photo it proposes (v2)

Added in v2 — source: decision of the product owner, 2026-10-18 (EMR-46); `data-model`, "A pending edit may change the photo of its card (v2)". It settles how the detail shows the photo, which "Applying or discarding a pending edit carries out what it asks of the photo (v2)" left to this screen.

After the fields of the form, the comparison MUST show the photo, under the label "Foto del negocio", with "Lo que está publicado" and "Lo que quiere cambiar" like every field: the card's own photo, or "Sin foto", against what the edit asks of it. An edit that keeps the photo shows the card's photo on both sides, without "Cambió"; one that replaces it shows the new photo, with "Cambió"; one that removes it shows "Sin foto", with "Cambió" only when the card had a photo. The new photo is shown while the edit is pending; once it is resolved, its photo is the card's or no longer exists, so the detail only says "Una foto nueva" in its place.

An edit that is no longer pending can still be opened, read-only, and MUST say what happened to it before the comparison: an applied or discarded one, "Estos cambios ya los habías resuelto."; a superseded one, "Estos cambios ya no son los últimos: el negocio mandó otros más nuevos."

#### Scenario: an edit with a new photo

- **WHEN** the admin opens a pending edit that replaces the photo of a card that had one
- **THEN** they see both photos, the card's under "Lo que está publicado" and the new one under "Lo que quiere cambiar", and "Cambió" next to "Foto del negocio"

#### Scenario: an edit that removes the photo

- **WHEN** the admin opens a pending edit that leaves the card without a photo
- **THEN** they see the card's photo and "Sin foto", with "Cambió"

#### Scenario: an edit that keeps the photo

- **WHEN** the admin opens a pending edit that does not touch the photo
- **THEN** they see the card's photo on both sides, without "Cambió"

#### Scenario: a superseded edit

- **WHEN** the admin opens the address of an edit that a newer one replaced
- **THEN** they read "Estos cambios ya no son los últimos: el negocio mandó otros más nuevos." above the comparison

### Requirement: The verification message names the card's locality from its record (v2)

Added in v2 — source: ADR 0006 ("texts that name the locality are parametrised"). It amends the literal message of "Verification button that opens WhatsApp with a prefilled message" and the descriptor of "No panel message is presented with the previous brand", which name Tizayuca.

The first-contact message MUST name the locality of the card, read from its record: "Hola, te escribo de enmirumbo, el directorio de negocios de <municipio>. Recibimos el registro de «<nombre del negocio>». ¿Nos confirmas que el negocio es tuyo y que este es tu WhatsApp?". For a card of Tizayuca it is exactly the prototype's message. No panel message writes the name of a locality in the code. The button appears in the detail of a card, after its data and its reports, and in the detail of a pending edit that changes the WhatsApp, toward the proposed number; it opens a new tab and carries `rel="noopener noreferrer"`.

#### Scenario: a card of another locality

- **WHEN** the admin taps "Escribirle por WhatsApp" on the detail of a card of a second locality
- **THEN** the message says "el directorio de negocios de" followed by that locality's name

### Requirement: Approving and rejecting are forms of the detail, and their action checks everything again (v2)

Added in v2 — source: backlog of epic F, story F2 (EMR-47); ADR 0010, ADR 0021; decisions of the product owner of 2026-10-18, the hidden zones among the approval's options included (EMR-52). It settles, for the Worker and Astro Actions, how "Approving assigns trades, normalizes the zone, marks the origin and publishes the card", "Rejecting requires a reason, stores it with its date and offers to notify by WhatsApp", "A transition is only applied to a registration that is still in review" and "The detail offers the actions that correspond to the status, with the context in sight" are posted and answered.

The detail of a card in `in_review` MUST show, after its data, its reports and "Escribirle por WhatsApp", the approval form and the rejection form, and only to a user who holds `businesses.review` in the card's locality: a user who opens the detail with any other permission sees neither. Each form posts to the detail's own address with its action, `admin.approve` or `admin.reject`, and works without client JavaScript; every check is the server's, so neither relies on the browser's validation.

Approving and rejecting need `businesses.review` in the card's locality and nothing else: assigning trades and normalizing the zone are part of approving ("Revisar registros: ver la cola y el detalle, aprobar y rechazar"), and `businesses.edit` is for editing a card outside its review ("The admin can edit any card to serve the rectification right (v2)"). Each action MUST, in this order and before anything is written: verify the Access token of its own request (`FORBIDDEN` without one); refuse, as not found, a submission that does not come from the detail's address, the action called at `/_actions/` or from any other page included, before reading anything; take the card from the address, never from a field; answer the site's 404 for a card that does not exist or of a locality where the user may not open a card's detail, and the panel's 403 for one the user sees but may not review there; answer "Este registro ya lo habías resuelto." for a card no longer in review; and only then check the form. Every read and write goes through the fresh connection.

The transition MUST be one conditional write that applies only while the card is still `in_review`, so that of two decisions at once exactly one applies and the other answers "Este registro ya lo habías resuelto.", with status `409`. A failed check MUST answer the detail again, status `400`, with each error next to its field and what the admin chose or wrote, read from the same submission: every trade as it was ticked, none included, the zone and the origin chosen, and the reason exactly as typed. A decision that cannot be saved answers the detail, status `500`, with the literal text "No se pudo guardar. Vuelve a intentarlo." above the forms, and nothing is decided. Any other request to the detail with a method but `GET` or `HEAD` gets a `405` with no body.

A rejection MUST answer with a `303` to `/admin/registros/<id>/rechazado`, with `Cache-Control: no-store`, so reloading it never rejects again. That screen reads the stored reason, never one an address carries, and exists only for a rejected card with a reason that the user may review: for any other, it MUST send the admin back to the detail, with nothing of the card in that answer. An approval answers as "The management link is shown only in the answer to the approval (v2)" says.

The approval form MUST offer every trade of the catalogue in the catalogue's order, as checkboxes inside labels at least 44px tall, in a list that scrolls by itself; it opens with the trades the card already has ticked and with its origin chosen, so publishing an unpublished card again changes neither unnoticed. Only when the card's zone is not a catalogue zone it MUST show the free text the business wrote, as "El negocio escribió su colonia como "Otra": <texto>", and a list of every zone of the card's locality by the names the public pages show them with ("A zone whose name repeats in its locality is shown with its settlement type (v2)" in `public-directory`), headed "Elige la colonia", in alphabetical order. The hidden zones are in that list too, each marked after its name as "<nombre> (oculta)": the registration no longer offers a hidden zone, so a business that typed its name arrived as "Otra", and the admin gives it the zone that really applies ("The admin can hide and rename the zones of a locality (v2)"). A trade that is not of the catalogue is refused like too many trades, with "Elige máximo 3 giros", and a zone that is not one of the locality's with "Elige la colonia de este negocio"; an origin that is not `seeded` is `organic`. The chosen zone replaces only the missing catalogue zone: the free text the business wrote is kept, as everything it captured is. Approving writes no entry of the audit log.

The rejection form MUST have no `maxlength`: a browser cuts a pasted text at it without saying so, and the reason travels whole to the business. Its 500 characters are counted as a person sees them written (a letter with its accent, or an emoji, is one); the spaces around the reason are dropped, a line break counts as one character and a NUL is dropped. In the same transaction as the rejection, the audit log MUST get its entry ("The destructive actions of the admin write to the audit log with the Access identity (v2)"): the Access email in lowercase, the locality, the card's identifier, `reject` and `in_review`, and nothing of the card's data.

#### Scenario: only who may review sees the forms

- **WHEN** a user who only attends reports in the card's locality opens the detail of a card in review
- **THEN** they see its data and its reports, and neither the approval nor the rejection form

#### Scenario: a decision from elsewhere

- **WHEN** an approval is posted to `/_actions/admin.approve`, or with `?_action=admin.approve` to another page of the panel
- **THEN** the action reads and writes nothing, the card stays in review, and the answer carries no notice and no management link

#### Scenario: two approvals at once

- **WHEN** two approvals of the same card arrive at the same moment
- **THEN** exactly one publishes it, with its trades and its link, and the other answers "Este registro ya lo habías resuelto."

#### Scenario: a rejection lands on its confirmation

- **WHEN** the admin rejects a registration and then reloads the screen
- **THEN** the first answer was a `303` to `/admin/registros/<id>/rechazado`, which shows "Registro rechazado.", and the reload rejects nothing again and writes no second entry of the audit log

#### Scenario: a reason pasted too long

- **WHEN** the admin pastes a reason of 600 characters and taps "Rechazar"
- **THEN** the field took it whole, nothing is saved, and the form comes back with the 600 characters and the message to shorten it

#### Scenario: a hidden zone at approval

- **WHEN** the admin opens the approval of a card whose business typed "Nacozari" while that zone of Tizayuca was hidden
- **THEN** the list offers "Nacozari (oculta)" among the zones, and approving with it gives the card that zone

#### Scenario: an approval that names a trade of nowhere

- **WHEN** a forged approval names a trade that is not in the catalogue
- **THEN** nothing is published and the form says "Elige máximo 3 giros"

### Requirement: The management link is shown only in the answer to the approval (v2)

Added in v2 — source: backlog of epic F, story F2 (EMR-47); ADR 0010; `data-model`, "The management link is issued by the panel alone and resolved by its fingerprint (v2)"; decision of the product owner, 2026-10-18: the line that the link is shown only there. It settles how "On approving, an offer is made to notify the business by WhatsApp with its card link and its management link" shows the link "only once", and how "Approving a registration generates its management link, unique and unrepeatable" applies to an unpublished card published again.

The transaction that publishes the card MUST issue its management link, after the card is `published`, and the token MUST exist in plain only in the memory of that request. The confirmation, "Ya quedó publicado.", MUST be the answer to the approval's own submission, status `200`, and never a redirect to an address of its own: an address that carried the token would keep it in the browser's history, and one that did not could not show it. The address of that answer carries only the action's name, its `Cache-Control: no-store` keeps it out of every cache, the panel's referrer policy sends no path to WhatsApp, and the token MUST NOT go in a cookie, a log, an error message or any other page. Sending the same submission again, by reloading that answer, going back to it or from a tab left open, MUST find the card already resolved: it answers "Este registro ya lo habías resuelto.", issues no new link and shows none.

The notice MUST carry the card's public address and its management link, both absolute from the environment's public origin, as the message of "Avisarle por WhatsApp", the only link of the panel that ever carries a token. Right before that button the screen MUST say, literally, "Mándale el mensaje ahora: este enlace solo se ve aquí.", so the admin does not leave without sending it; it also says "Listo. El cambio puede tardar hasta un minuto en verse en el sitio." and offers "Volver a la cola". A deployed environment without a public origin publishes the card all the same, and the screen MUST say, instead of the button and its line, "No se pudo armar el link de la ficha porque falta configurar la dirección pública del sitio. El negocio ya quedó publicado; avísale cuando esté configurada."; the admin then sends a new link once the origin is set.

Approving an unpublished card publishes it again and MUST issue it a new link that replaces the one it had: the panel cannot show the earlier one, and a notice without a link would leave the owner without one. The earlier link opened nothing while the card was unpublished, and it opens nothing afterwards.

#### Scenario: the link is shown once

- **WHEN** the admin approves a registration, leaves the confirmation and opens the detail of that card
- **THEN** the confirmation said "Mándale el mensaje ahora: este enlace solo se ve aquí." and carried the token only inside the message of "Avisarle por WhatsApp", the detail says only since when the card has a link, and no address the browser visited carries the token

#### Scenario: reloading the confirmation

- **WHEN** the admin sends the approval again from the confirmation
- **THEN** they read "Este registro ya lo habías resuelto.", and the link they had is still the valid one

#### Scenario: both links open what they promise

- **WHEN** the two links of the notice are opened
- **THEN** the first answers the public card, with its photo and its trades, and the second opens the prefilled edit form of that card

#### Scenario: publishing again

- **WHEN** the admin approves a card they had unpublished
- **THEN** it is published with the trades it had and a new link, and the link it had before opens nothing

### Requirement: The queue labels the resubmission of a rejected card, and its detail says why it was rejected before (v2)

Added in v2 — source: decision of the product owner, 2026-10-18 (EMR-47); `data-model`, "The business keeps the rejection its resubmission answered (v2)". It amends "Review queue with the pending registrations, oldest first", whose rows are labelled "Alta nueva" or "Edición", and "Registration detail with all the captured data, only inside the panel".

A card in review that entered the queue as the resubmission of a rejected card MUST be labelled, in its queue row, with the literal text "Reenvío" instead of "Alta nueva", as text and not only by a colour. It entered so when it keeps the rejection its last resubmission answered and was not unpublished since; a card that came back from an unpublishing keeps "Alta nueva" with "Ya estaba publicada, la despublicaste", and the wait of every row is counted as before.

The detail of a card that keeps that rejection MUST say, among its internal data, "La rechazaste antes por: <motivo>", with the reason as it was stored, and below it "Fue el <fecha>", the moment of that rejection in the locality's time zone ("Dates in the panel use the time zone of the locality (v2)"). It is shown whatever the card's status afterwards, like the unpublishing trace, and never on a public page; a card never resubmitted shows neither line.

#### Scenario: a resubmission in the queue

- **WHEN** the owner of a rejected card corrects it and sends it again
- **THEN** the queue shows it as "Reenvío", counting its wait from the resubmission

#### Scenario: why it was rejected before

- **WHEN** the admin opens the detail of that card
- **THEN** they read "La rechazaste antes por: " followed by the reason they wrote, and the date of that rejection

#### Scenario: unpublished after a resubmission

- **WHEN** a card that was resubmitted, approved and then unpublished goes back to the queue
- **THEN** its row says "Alta nueva" and "Ya estaba publicada, la despublicaste", not "Reenvío"
