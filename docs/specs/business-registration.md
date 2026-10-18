# Spec: business-registration

## Requirements

### Requirement: Public registration page on a single screen

The site MUST have a public registration page, reachable from the home page, with a single form on a single screen (no steps, no wizard, no account or password, PRD §6.1). The page MUST use the global layout and MUST be correct at a 390px viewport with no horizontal scroll.

#### Scenario: the owner reaches registration from the home page

- **WHEN** a business owner opens the home page on their phone and taps "Registra tu negocio gratis"
- **THEN** they land on the registration page and see the complete form on a single screen, with the site header and footer

#### Scenario: mobile-first at 390px

- **WHEN** the registration page is opened in a viewport 390px wide
- **THEN** all fields, labels and the submit button are fully visible and usable, with no horizontal scroll, and every tappable control is at least 44px in its smaller dimension

### Requirement: Required and optional form fields

The form MUST ask for the 5 required fields of PRD §6.1 — business name, category (closed list of the 8 in the catalogue), 10-digit WhatsApp, zone (closed catalogue list with an "Otra" option + free text) and a consent checkbox — and MUST offer as optional: "¿Qué ofreces?" (max. 200 characters), "¿Haces entregas o vas a domicilio?" (yes/no), landline phone, address or directions, opening hours, Facebook link and **one photo of the business**. The optional fields MUST be visibly marked as optional. The visible labels MUST be, literally: "¿Cómo se llama tu negocio?", "¿A qué se dedica?", "Tu WhatsApp (10 dígitos)", "¿En qué colonia estás?", "¿Qué ofreces? (opcional)", "¿Haces entregas o vas a domicilio? (opcional)", "Teléfono fijo (opcional)", "Dirección o referencias (opcional)", "Horario (opcional)", "Link de tu Facebook (opcional)" and "Foto de tu negocio (opcional)".

AMENDED (amendment approved by the founder, visual review batch 2): the "Horario (opcional)" field MUST be explained with an example written the way a business talks, not with a calendar abbreviation. Its example text inside the field MUST be literally "Lunes a sábado de 9 de la mañana a 7 de la tarde", and below the field the literal help line MUST always be visible: "Escríbelo como se lo dirías a un cliente: 'L-S 9am-7pm', 'Todos los días de 8 a 8', 'Solo fines de semana'." The field remains free text: neither the example nor the help imposes a format, and the server does not reject any opening hours because of how they are worded.

#### Scenario: the opening-hours example reads the way a business would say it

- **WHEN** the owner reaches the "Horario (opcional)" field
- **THEN** inside the field they see the example "Lunes a sábado de 9 de la mañana a 7 de la tarde" and below it the help "Escríbelo como se lo dirías a un cliente: 'L-S 9am-7pm', 'Todos los días de 8 a 8', 'Solo fines de semana'."

#### Scenario: the opening hours remain free text

- **WHEN** the owner writes their opening hours in other words (for example "Solo fines de semana")
- **THEN** the registration is saved with that text as is, with no error and no reformatting

#### Scenario: empty form on open

- **WHEN** the owner opens the registration page
- **THEN** they see the 5 required fields and the 7 optional ones (including the photo), with the optional ones identified as such, with no error message and no prefilled field

#### Scenario: closed catalogue lists

- **WHEN** the owner opens the category list and the zone list
- **THEN** they see the 8 categories and the 21 zones of the catalogue, plus the "Otra" option at the end of the zones

#### Scenario: registration with required fields only

- **WHEN** the owner fills in only the 5 required fields and submits
- **THEN** the registration is saved, the optional fields stay empty and the card has no photo

### Requirement: The "¿Qué ofreces?" example adapts to the chosen category

The "¿Qué ofreces?" field MUST show, inside the field, an example of keywords that changes according to the selected category (PRD §6.1 and §6.5). Each of the 8 categories MUST have its example; for "Servicios del hogar" the example MUST be literally "ej. plomería, destape de drenajes, bombas de agua" and for "Clubes y escuelas deportivas" it MUST be literally "ej. futbol infantil 6-12 años, entrenamientos martes y jueves". While no category is chosen a generic example MUST be shown.

#### Scenario: home services example

- **WHEN** the owner chooses the category "Servicios del hogar"
- **THEN** the "¿Qué ofreces?" field shows the example "ej. plomería, destape de drenajes, bombas de agua"

#### Scenario: sports example

- **WHEN** a club chooses the category "Clubes y escuelas deportivas"
- **THEN** the "¿Qué ofreces?" field shows the example "ej. futbol infantil 6-12 años, entrenamientos martes y jueves"

#### Scenario: the example changes when the category changes

- **WHEN** the owner changes the category from "Servicios del hogar" to another category
- **THEN** the field's example updates to that of the new category without reloading the page and without erasing what they already wrote

### Requirement: The photo field explains the PRD §6.1 policy and opens the phone gallery

The form MUST offer an optional photo field, for a single image, that opens the gallery on a phone (a file field that declares it accepts images). Next to the field, as help text visible before choosing the file, the photo policy of PRD §6.1 MUST appear in plain Spanish, with the literal text: "Una foto de tu local, de tus productos o de tu trabajo. Que no salgan personas que se puedan reconocer. Máximo 5 MB (JPG, PNG o WebP); nosotros la comprimimos para que cargue rápido." The field MUST have an associated label and a tappable area of at least 44px.

The form MUST also include a checkbox with the literal text "Dejar mi ficha sin foto", always visible and with the same text for anyone who opens the form: on a new registration it changes nothing, and on a resubmission after a rejection it is what allows removing the photo that was already there (see the requirement "Resubmission after a rejection allows changing or removing the photo"). The form MUST NOT reveal, neither with that text nor with any other hint, whether the number being entered already had a card.

#### Scenario: choosing a photo from the phone

- **WHEN** the owner taps the "Foto de tu negocio (opcional)" field on their phone
- **THEN** the image picker of their gallery opens, they can choose a single photo and they see above the field the policy "Una foto de tu local, de tus productos o de tu trabajo. Que no salgan personas que se puedan reconocer. Máximo 5 MB (JPG, PNG o WebP); nosotros la comprimimos para que cargue rápido."

#### Scenario: registering without a photo

- **WHEN** the owner submits the form without choosing any photo
- **THEN** the registration is saved all the same, without a photo and without any error message for that field

#### Scenario: the remove-photo checkbox is the same for everyone

- **WHEN** two different people open the form, one with a number that has no card and another with a number whose card was rejected
- **THEN** both see exactly the same photo field and the same "Dejar mi ficha sin foto" checkbox, with no difference that gives away that one of them already had a card

### Requirement: The server normalizes and validates the WhatsApp to 10 digits

The server MUST normalize the WhatsApp before validating it and before touching the database: it discards spaces, hyphens, dots and parentheses, and removes the country prefix (`+52`, `52` or `521`) when doing so leaves exactly 10 digits. The stored value MUST always be the 10-digit one, so that the "one card per number" uniqueness (PRD §6.1) cannot be bypassed by writing the same number in another format. If after normalization there are not exactly 10 digits, the submission MUST be rejected with the message "Revisa tu número de WhatsApp: deben ser 10 dígitos".

#### Scenario: variants of the same number are saved the same way

- **WHEN** the WhatsApp is submitted as "+52 771 123 4567", as "771-123-4567" or as "7711234567"
- **THEN** in all three cases the stored number is "7711234567"

#### Scenario: number with fewer than 10 digits

- **WHEN** the owner submits an 8-digit WhatsApp
- **THEN** nothing is saved and they see the message "Revisa tu número de WhatsApp: deben ser 10 dígitos" next to that field

#### Scenario: text that is not a number

- **WHEN** the owner submits in the WhatsApp field a text without enough digits (for example "no tengo" or "771 123 45")
- **THEN** nothing is saved and they see the same error message next to that field

#### Scenario: normalization happens even if the browser does not validate

- **WHEN** the submission reaches the server directly without going through browser validation
- **THEN** the server applies the same normalization and rejection

### Requirement: The server validates every field and returns per-field errors in Spanish

The server MUST validate every received field, without trusting browser validation: required fields cannot be empty, the category and the zone MUST exist in the catalogue, "¿Qué ofreces?" cannot exceed 200 characters, the Facebook link is only accepted if it starts with `http://` or `https://` (any other scheme is rejected, including `javascript:` or `data:`), the photo MUST meet what the requirement "The server only accepts the photo if it is a real image of at most 5 MB" demands, and every free-text field has a maximum length. The messages MUST be shown next to the corresponding field, in clear Spanish, and the form MUST keep what the owner had already entered. The error texts MUST be, literally: "Escribe el nombre de tu negocio", "Elige una categoría", "Revisa tu número de WhatsApp: deben ser 10 dígitos", "Elige tu colonia", "Escribe el nombre de tu colonia", "Marca la casilla para poder registrar tu negocio", "Deja esto en 200 caracteres o menos", "El link de Facebook debe empezar con http:// o https://" and "El aviso de privacidad cambió mientras llenabas esto. Léelo otra vez y vuelve a marcar la casilla."

AMENDED (amendment approved by the founder, visual review batch 2): the **landline phone** MUST be validated on the server, not just rely on the phone keyboard. Only digits and the separators people use when writing a phone number —space, hyphen, parentheses and `+`— are accepted, and there MUST be at least one digit. Any other content (letters, "no tengo", an email address, a dial string) MUST be rejected with the literal message "Revisa el teléfono fijo: escribe solo números (puedes usar espacios, guiones o paréntesis)" next to that field, without saving anything. The field MUST ask for the phone keyboard on a phone (not the pure numeric one, which does not offer the separators). What is entered is saved exactly as the owner wrote it: this rule decides what gets in, not how it looks afterwards — the public card still shows "Teléfono: &lt;texto&gt;" for what cannot be dialed, with no change at all.

When a submission is rejected, the form MUST come back with all the entered values except two exceptions, which the owner has to supply again: the consent checkbox and **the photo**, because no browser repopulates a file field for security reasons. If the rejected submission carried a photo, the form MUST say so next to the field with the literal text "Tu foto no se quedó guardada: vuelve a elegirla antes de enviar." and MUST NOT keep the file on the server in the meantime.

#### Scenario: empty required fields

- **WHEN** the owner submits the form without filling in anything
- **THEN** nothing is saved and they see an error message next to each missing required field, with focus on the first one

#### Scenario: "¿Qué ofreces?" too long

- **WHEN** the owner submits 250 characters in "¿Qué ofreces?"
- **THEN** nothing is saved and they see "Deja esto en 200 caracteres o menos" next to that field

#### Scenario: Facebook link with a disallowed scheme

- **WHEN** the owner submits as Facebook link something that does not start with http:// or https:// (for example "javascript:alert(1)" or "facebook.com/minegocio")
- **THEN** nothing is saved and they see "El link de Facebook debe empezar con http:// o https://" next to that field

#### Scenario: landline phone with letters

- **WHEN** the submission reaches the server directly (without going through the browser) with "no tengo" or "llámame al celu" in the landline phone
- **THEN** nothing is saved and they see "Revisa el teléfono fijo: escribe solo números (puedes usar espacios, guiones o paréntesis)" next to that field

#### Scenario: landline phone with separators

- **WHEN** the owner writes their phone as "(775) 123-45-67" or "+52 775 123 4567"
- **THEN** the registration is saved with that text as is, with no error

#### Scenario: landline phone without a single digit

- **WHEN** the submission carries in the landline phone only separators (for example "()" or "--")
- **THEN** nothing is saved and they see the same message next to that field

#### Scenario: category or zone outside the catalogue

- **WHEN** the submission carries a category or zone identifier that does not exist in the catalogue
- **THEN** the registration is rejected and no business is created

#### Scenario: what was entered is not lost

- **WHEN** the submission is rejected because of a validation error
- **THEN** the form is shown again with all the values the owner had written (including category, zone and optional fields), except the consent checkbox and the photo, which must be supplied again

#### Scenario: the photo has to be chosen again

- **WHEN** the owner submits the form with a photo and the submission is rejected because another field has an error
- **THEN** they see "Tu foto no se quedó guardada: vuelve a elegirla antes de enviar." next to the photo field, the field appears empty and no file from that submission was saved on the server

### Requirement: The server only accepts the photo if it is a real image of at most 5 MB

The server MUST accept the photo only if it weighs 5 MB or less and if its **content** is really a JPG, PNG or WebP image that can be opened, without trusting the file extension or the type declared by the browser (PRD §6.1: "máx. 5 MB de entrada"). It MUST reject, with the same criterion, files that are not images, vector images (SVG) and images whose dimensions exceed 40 megapixels, which are the cheap way to bring down the server with a small file. If the submission carries more than one photo file, the system MUST keep the first image and discard the rest: a card has a single photo.

Image processing MUST happen **after** the honeypot field, the per-IP quota and the validation of the rest of the fields: a submission blocked by those defenses MUST NOT cost the server a single byte of image processing nor leave any file behind. The messages MUST be shown next to the photo field and be, literally: "Esa foto pesa más de 5 MB. Sube una más ligera." when it exceeds the size, "No pudimos leer esa foto. Sube una imagen JPG, PNG o WebP." when the content is not one of those images (including SVG and disguised files) or when it is too large in pixels, and "No pudimos preparar tu foto. Intenta con otra." if processing fails because of a server problem. No message MUST include technical details about the file or the error.

#### Scenario: photo over 5 MB

- **WHEN** the owner uploads a 6 MB photo
- **THEN** no business and no file is saved, and they see "Esa foto pesa más de 5 MB. Sube una más ligera." next to the photo field

#### Scenario: file disguised as an image

- **WHEN** someone submits as a photo a file named `foto.jpg` whose content is HTML, a PDF or an executable
- **THEN** no business and no file is saved, and they see "No pudimos leer esa foto. Sube una imagen JPG, PNG o WebP."

#### Scenario: SVG rejected

- **WHEN** someone submits an SVG (even if the browser declares it as `image/svg+xml`)
- **THEN** it is rejected with "No pudimos leer esa foto. Sube una imagen JPG, PNG o WebP." and at no point is that content stored or served

#### Scenario: huge image in pixels

- **WHEN** someone submits a PNG of a few megabytes but of 100 megapixels
- **THEN** the server rejects it with the same unreadable-photo message, without running out of memory and without taking longer than a normal submission

#### Scenario: the bot does not pay for processing

- **WHEN** a submission arrives with the honeypot field filled in or from an IP with no quota, with a 5 MB photo attached
- **THEN** no image is processed, no file is left stored and the response is the one that the anti-abuse requirement already defines for that case

#### Scenario: several files in the same submission

- **WHEN** a submission carries three files in the photo field
- **THEN** the card ends up with a single photo and no file is stored for the other two

### Requirement: Image work has a ceiling, and what does not fit is turned away with a message, not queued

The 5 MB cap bounds the bytes that arrive, not the work they trigger: a _valid_ image of almost 40 megapixels can weigh little over 100 KB and cost tens of MB of memory when opened, so a well-formed submission that passes all the earlier defenses could bring down the server through accumulation. Therefore the system MUST limit how many photos it **opens** at the same time, with a fixed and small cap, independent of how many requests arrive. A submission that arrives when the cap is busy MUST NOT wait for its turn or be queued: it MUST be rejected immediately, next to the photo field, with the literal text "Estamos recibiendo muchas fotos, intenta de nuevo en un momento", keeping everything the owner had entered and leaving neither a card nor files behind. We prefer asking a person to retry in a minute over leaving the directory down for the whole town.

That cap MUST cover **only the part that opens the original image**, which is the one that spends memory in proportion to what the client sent. The later compression —which works on a size already bounded by the system— MUST NOT occupy one of those slots: if it did, a handful of deliberately hard-to-compress photos, sent at a rate of one per second, would leave the photo field unusable for everyone in a sustained way, and that is no longer "a traffic spike, try in a moment" but a cheap denial of service. Rejection due to the cap MUST be an occasional notice during a real spike, not the normal state of the form.

The same photo MUST NOT be opened more than once to produce its two variants: the second is derived from the work already done. That way the cost of a submission does not grow with the number of sizes or with compression retries.

The megapixel cap stays at 40: it is what lets through a phone photo taken in its highest-resolution mode that still fits in 5 MB, and lowering it would reject legitimate photos without closing the problem —what closes it is the simultaneous-work cap, because concurrency is the dimension that was not bounded—.

#### Scenario: more photos arrive than fit at once

- **WHEN** more submissions with a photo arrive at the same time than the server processes at once
- **THEN** those that fit are processed normally and the rest receive "Estamos recibiendo muchas fotos, intenta de nuevo en un momento" next to the photo field, without waiting for their turn

#### Scenario: what the turned-away person wrote is not lost

- **WHEN** a submission is rejected because the server was busy processing other photos
- **THEN** the form comes back with everything that had been entered (except the photo, which no browser repopulates), no card was created and no file was stored

#### Scenario: the work per photo is not multiplied

- **WHEN** the server processes a photo and produces its listing-card and card variants
- **THEN** the image is opened only once, and both variants come out of that single piece of work

#### Scenario: hard-to-compress photos do not block the form

- **WHEN** someone sustains one submission per second with photos made on purpose to be costly to compress
- **THEN** a resident who uploads their photo in that same period uploads it just the same, without receiving the "estamos recibiendo muchas fotos" notice

### Requirement: The photo is stored compressed, without metadata and with a server-generated reference

Every accepted photo MUST be stored **processed by the server** (PRD §6.1: "comprimida en el servidor"; ADR-006: variants generated on upload): the system MUST produce one variant for the listing card and another for the card, resized and compressed, and MUST discard the original file. The result MUST NOT keep any image metadata: in particular, no stored or served variant MUST include EXIF with GPS coordinates, device make or capture date, because the phone's location is personal data that PRD §8 does not publish even when the business gives its address.

The system MUST store on the card an **internal reference generated by the server** (an opaque key that cannot be guessed from the business or its name). No value sent by the client MUST be able to set or alter that reference, just as happens with the status, the origin and the consent record. The files MUST live outside the repository and outside version control (ADR-006), in whatever photo storage the system has configured; the observable behavior MUST NOT depend on which storage that is. If the registration or resubmission is not saved (database error, duplicate number, card already resolved), the newly written file MUST be deleted: no failed submission MUST leave orphan files.

#### Scenario: the photo is served compressed and in two sizes

- **WHEN** the owner registers their business with a 4 MB photo taken with the phone
- **THEN** the card ends up with a stored photo in two variants —one for the listing card and one for the card—, both much lighter than the original, and the original file is not kept anywhere

#### Scenario: the phone location is neither published nor stored

- **WHEN** the owner uploads a photo that carries EXIF with GPS coordinates and phone model
- **THEN** none of the stored or served variants contains those coordinates or any other image metadata

#### Scenario: the client cannot set the photo reference

- **WHEN** a submission includes extra fields that try to set the photo reference (for example an external URL, a `data:` or an invented internal path)
- **THEN** those values are ignored and the card ends up with the reference generated by the server, or without a photo if none was uploaded

#### Scenario: no orphan files when the registration fails

- **WHEN** a submission with a photo is rejected at the end because that number already has a card or because the database fails to save
- **THEN** no file from that submission is left stored

### Requirement: One card per WhatsApp number

If the normalized WhatsApp already has a card in status `in_review` or `published`, the registration MUST be rejected and the form MUST say so with the literal text "Este número ya tiene una ficha registrada. Si es tu negocio, no hace falta registrarlo otra vez: te vamos a pasar por WhatsApp el enlace para editarlo." That message is true from end to end: the management link exists (PRD §6.4), the admin sends it on approval and the public card offers the "Perdí mi enlace" button to request it again (capability `public-directory`). The registration form still carries **no** button or link to edit mode: asking for the link is a conversation with the admin, not a button on an anonymous form.

If the card for that number is in status `rejected`, the submission MUST NOT be treated as a duplicate: the business "puede corregir y volver a enviar" (PRD §6.3). In that case the system MUST update that same card with the data of the new submission, return it to `in_review`, set to null the date and reason of the previous rejection (otherwise the 90-day purge of rejected records would take away a record that is already back in the queue) and restart the waiting clock, so that the admin panel's 48-hour indicator counts from the resubmission.

The consent record is the exception: neither the date (`consentedToNoticeAt`) nor the accepted version (`consentedToNoticeVersion`) MUST be replaced on resubmission, because they are the LFPDPPP evidence of the data subject and an anonymous form could be getting resubmitted by a third party; the consent checkbox remains required on every submission. When the current version of the notice is **later** than that of the original record, the system MUST record the reacceptance separately: the resubmission date and the current version (`reconsentedToNoticeAt` and `reconsentedToNoticeVersion`), overwriting the previous reacceptance if there was one. In any other case the reacceptance fields MUST NOT be touched: not when the current version is the same as the record's, not when it is **earlier** (a reverted deployment), and not when the original record **has no version** because it predates versioning, which is not comparable with any. Noting a reacceptance in those cases would claim a change that did not happen, or would turn anyone who knows the number into the author of consent evidence on someone else's card. This can only happen on an accepted submission, so the reacceptance always corresponds to a checked checkbox with that text in front of it (see the requirement "Nobody consents to a notice version they did not have in front of them").

The owner MUST see the same thank-you screen as for a new registration. The system MUST NOT reveal to them at any moment that their card was rejected or the reason for the rejection: that data only lives inside the admin panel, and the public form is anonymous (anyone could type someone else's number). The resubmission is still a submission of the public form: it MUST go through the same validations, the honeypot field and the per-IP submission limit, and it MUST NOT be able to alter the origin, the trades, the management link fingerprint or the publication date of the card.

#### Scenario: number with a published card

- **WHEN** the owner submits a WhatsApp that already has a published card
- **THEN** no second business is created and the existing card is not touched, and they see the message "Este número ya tiene una ficha registrada. Si es tu negocio, no hace falta registrarlo otra vez: te vamos a pasar por WhatsApp el enlace para editarlo." next to the WhatsApp field

#### Scenario: number with a card in review

- **WHEN** the owner submits a WhatsApp whose card is still waiting for review
- **THEN** they see the same already-registered-number message and their card in the queue does not change

#### Scenario: registration does not hand out management links

- **WHEN** the owner sees the already-registered-number message
- **THEN** no edit link and no button leading to one appears: only the text

#### Scenario: resubmission after a rejection

- **WHEN** a business whose card was rejected corrects its data and submits the form again with the same number
- **THEN** they see the thank-you screen with the message "¡Gracias! Tu negocio está en revisión. Te contactaremos por WhatsApp para confirmar tus datos antes de publicarlo.", their card ends up with the new data in status `in_review`, with no rejection date or reason, and it appears again in the admin panel queue as newly arrived

#### Scenario: the consent record is not replaced on resubmission

- **WHEN** a rejected card is resubmitted with the consent checkbox checked and the notice is still on the same version
- **THEN** the resubmission is accepted, the card keeps the consent date and version of the original registration, and its reacceptance fields remain empty

#### Scenario: resubmission against a new version of the notice

- **WHEN** a rejected card whose record is from version `1` is resubmitted when version `2` is already current
- **THEN** the original record still says version `1` with its original date, and the card also ends up with the reacceptance: the resubmission date and version `2`

#### Scenario: resubmission of a card that predates versioning

- **WHEN** a card whose record has no registered version is resubmitted
- **THEN** its record remains without a version (none is invented for it) and NO reacceptance is recorded: without a starting version there is nothing to compare against, and the admin panel keeps showing "versión no registrada"

#### Scenario: resubmission after reverting the deployment

- **WHEN** a rejected card whose record is from version `2` is resubmitted when the current version went back to `1`
- **THEN** the resubmission is accepted normally and no reacceptance is noted: the current version is not later than the record's, and recording the opposite would claim a change that did not happen

#### Scenario: the form does not give away the rejection

- **WHEN** someone submits the form with a number whose card was rejected
- **THEN** at no point do they see the rejection reason or any data from the previous card

#### Scenario: the resubmission does not publish itself

- **WHEN** a resubmission includes extra fields such as status `published`, origin `seeded`, trades, publication date or a notice version of their choosing
- **THEN** those values are ignored and the card ends up in `in_review`, with the origin it already had, without new trades, without a publication date and with the original record intact

#### Scenario: the resubmission goes through the same defenses

- **WHEN** a resubmission arrives with the honeypot field filled in, with the IP over quota or with an invalid field
- **THEN** it is treated exactly like any other submission of the form and the rejected card does not change

#### Scenario: duplicate written in another format

- **WHEN** a business already published as "7711234567" tries to register again as "+52 771 123 4567"
- **THEN** the system detects it as the same number and shows the same message, without creating a second card

#### Scenario: race between two simultaneous submissions

- **WHEN** two submissions with the same number arrive almost at the same time and the second one collides with the database uniqueness
- **THEN** the user of the second submission sees the already-registered-number message, not a technical error

### Requirement: Resubmission after a rejection allows changing or removing the photo

When a rejected card is corrected and submitted again (PRD §6.3), the submission MUST be able to: upload a new photo, which replaces the previous one; remove the one it had, by checking the "Dejar mi ficha sin foto" checkbox; or leave it as it is, by neither choosing a file nor checking the checkbox. Every time a photo stops being on the card —because it was replaced or because it was removed—, its files MUST be deleted from the storage, not just unlinked from the card (PRD §8: deletion is real). The owner MUST see the same usual thank-you screen and the system MUST NOT tell them anything about the previous rejection or about the photo they had.

#### Scenario: changing the photo on resubmission

- **WHEN** a rejected business submits the form again with a different photo
- **THEN** their card ends up with the new photo, the files of the previous one no longer exist in the storage and they see the usual thank-you screen

#### Scenario: removing the photo on resubmission

- **WHEN** a rejected business submits again checking "Dejar mi ficha sin foto" and without choosing a file
- **THEN** their card ends up without a photo, the files of the one it had no longer exist and they see the usual thank-you screen

#### Scenario: resubmission that does not touch the photo

- **WHEN** a rejected business corrects its opening hours and submits again without choosing a file and without checking the checkbox
- **THEN** their card keeps exactly the same photo it had

#### Scenario: the resubmission with a photo goes through the same defenses

- **WHEN** a resubmission arrives with a 6 MB photo, with the honeypot field filled in or with the IP over quota
- **THEN** it is treated like any other submission of the form: the rejected card does not change, its previous photo stays intact and no new file is left

### Requirement: Consent with a visible simplified notice and a consent record

The form MUST show the simplified privacy notice within the page itself (visible without leaving the form, PRD §6.1 and §8) and a required checkbox with the literal text "Acepto el aviso de privacidad y confirmo que este negocio es mío o que tengo permiso para registrarlo." Without that checkbox there MUST be no submission. When saving a new registration, the system MUST record the consent record as a pair set by the server —the timestamp (`consentedToNoticeAt`) and the version of the notice in force at that moment (`consentedToNoticeVersion`)—, never values sent by the client; on the resubmission of a rejected card that record is kept whole and not replaced (see the requirement "One card per WhatsApp number").

The simplified notice MUST warn, in plain language and before the owner checks the box, that if their card is published the business name, the WhatsApp, the landline phone and whatever else they write will be visible to anyone in the directory: without that warning the consent is not informed. The text of the simplified notice MUST be: "Aviso de privacidad (resumen): enmirumbo, el directorio de negocios de Tizayuca, usa los datos que escribes aquí para revisar tu negocio, contactarte por WhatsApp y publicar tu ficha en el directorio. Ojo con esto: si publicamos tu ficha, el nombre de tu negocio, tu WhatsApp, tu teléfono fijo y lo demás que escribas quedan a la vista de cualquiera que entre al directorio, con botones para escribirte o marcarte directo. Publicamos tu colonia, no tu domicilio exacto, salvo que tú escribas la dirección. No vendemos ni compartimos tus datos con nadie más. Puedes pedirnos que corrijamos o borremos tu ficha cuando quieras, por el mismo WhatsApp con el que te contactemos; lo atendemos en máximo 20 días hábiles."

That text is one of the three pieces of the versioned content of the notice (see the capability `legal-pages`): changing it starts a new version, and that is why the rebrand to "EnMiRumbo" went through the same procedure as any other change to the notice.

The consent block MUST also include a visible link to the full privacy notice, with the literal text "Lee el aviso de privacidad completo", pointing to `/aviso-de-privacidad`, with a touch area of at least 44px and in the same tab (it is not an external link). The phrase "Cuando publiquemos el aviso completo, aquí va a estar el enlace." MUST NOT appear anywhere.

The block MUST also show, before the checkbox, which version of the notice is being accepted, with the literal text "Estás aceptando la versión 2 del aviso de privacidad." (where `2` is the identifier of the current version, read from the same place the notice page reads it: it is not written by hand in two places). The owner MUST NOT have to fill in or choose anything for this: it is text, not a field.

#### Scenario: notice visible without leaving the form

- **WHEN** the owner reaches the consent section
- **THEN** they read the simplified notice on the same screen, without opening another page or downloading anything

#### Scenario: the simplified notice warns that the WhatsApp and the phone become public

- **WHEN** the owner reads the simplified notice before checking the box
- **THEN** they read that, if their card is published, the business name, the WhatsApp, the landline phone and whatever else they write will be visible to anyone who enters the directory, with buttons to write to them or call them directly

#### Scenario: the simplified notice names the site with the current brand

- **WHEN** the owner reads the first line of the simplified notice
- **THEN** it says "Aviso de privacidad (resumen): enmirumbo, el directorio de negocios de Tizayuca, usa los datos que escribes aquí…", with no trace of the previous brand and without the locality attached to the name

#### Scenario: the version is visible before accepting

- **WHEN** the owner reaches the consent checkbox
- **THEN** they read "Estás aceptando la versión 2 del aviso de privacidad." and that version is the same one `/aviso-de-privacidad` shows

#### Scenario: link to the full notice

- **WHEN** the owner wants to read the full notice before accepting
- **THEN** they find in the consent block the link "Lee el aviso de privacidad completo", which opens `/aviso-de-privacidad` in the same tab, and the phrase "Cuando publiquemos el aviso completo, aquí va a estar el enlace." no longer appears anywhere in the form

#### Scenario: without the checkbox there is no submission

- **WHEN** the owner fills in everything correctly but does not check the checkbox and submits
- **THEN** no business is created and they see "Marca la casilla para poder registrar tu negocio" next to the checkbox

#### Scenario: consent record

- **WHEN** a registration is saved with the checkbox checked
- **THEN** the business ends up with a consent timestamp corresponding to the moment the server processed the submission and with the version of the notice in force at that moment

#### Scenario: the registration links point to pages that exist

- **WHEN** the links of the registration page are reviewed
- **THEN** the only link in the consent block is the one to the full notice and it leads to a route that exists (the site's automatic link check verifies it)

### Requirement: Nobody consents to a notice version they did not have in front of them

The form MUST tell the server which version of the notice it was rendered with, and the server MUST compare it with the version in force when processing the submission. If they do not match —because the notice changed between the owner opening the form and sending it, or because the data did not arrive— the submission MUST NOT be saved: the form MUST be shown again with the new notice, with everything the owner had already entered, with the consent checkbox unchecked and with the literal message "El aviso de privacidad cambió mientras llenabas esto. Léelo otra vez y vuelve a marcar la casilla." next to the checkbox.

The version that is stored MUST always be the one the server has in force, never the one that arrived in the submission: the form's datum only serves to detect the mismatch, just like the status, the origin and the consent date, which the client does not set either. A submission that declares an invented, old or empty version MUST end in that same message, without creating or touching any card. The datum MUST travel in the form's own submission, without client JavaScript.

#### Scenario: the notice changed mid-entry

- **WHEN** the owner opens the form with version `1`, version `2` is deployed and they send the form afterwards
- **THEN** no registration is saved and they see the message "El aviso de privacidad cambió mientras llenabas esto. Léelo otra vez y vuelve a marcar la casilla." next to the checkbox, with their data still in the form and the new notice in view

#### Scenario: retry after the change

- **WHEN** the owner reads the new notice, checks the checkbox again and sends again
- **THEN** the registration is saved normally and its record ends up with version `2`

#### Scenario: invented version in the submission

- **WHEN** a submission arrives declaring a notice version that does not exist, an old one or none
- **THEN** no card is created or modified and whoever sent it sees the same notice-changed message

#### Scenario: the stored version is set by the server

- **WHEN** a valid submission is saved
- **THEN** the version that ends up in the record is the server's current one, even if the submission brought anything else in that field

### Requirement: Zone "Otra" with free text pending normalization

Superseded in v2 by The zone is typed with the locality's zones as suggestions, and a name that is none of them is kept as "Otra" (v2) — source: decision of the product owner, 2026-10-18.

If the owner chooses "Otra" in the zone list, the form MUST ask for the name as free text and that text is required. The registration MUST be saved with the free text and without a catalogue zone, so that the admin normalizes it later (PRD §6.3, Appendix A). If they choose a catalogue zone, the free text MUST be ignored.

#### Scenario: registration with zone "Otra"

- **WHEN** the owner chooses "Otra" and writes "Rinconada del Venado"
- **THEN** the business is saved with that free text and without a catalogue zone, pending normalization

#### Scenario: "Otra" without text

- **WHEN** the owner chooses "Otra" and leaves the free text empty
- **THEN** nothing is saved and they see "Escribe el nombre de tu colonia" next to that field

#### Scenario: catalogue zone with leftover free text

- **WHEN** the submission carries a catalogue zone and also free-text zone
- **THEN** the business is saved with the catalogue zone and without the free text

### Requirement: A successful submission queues the business and shows the thank-you screen

A valid submission MUST create the business in status `in_review` with origin `organic` (the model's default values) and take the owner to the thank-you screen with the literal PRD §6.1 message: "¡Gracias! Tu negocio está en revisión. Te contactaremos por WhatsApp para confirmar tus datos antes de publicarlo." The status, the origin and the consent record —its date and its version— are set by the server: no value sent by the client MUST be able to alter them. Reloading the thank-you screen MUST NOT create a new registration.

#### Scenario: successful registration

- **WHEN** the owner submits the correctly filled form
- **THEN** they see the screen with the message "¡Gracias! Tu negocio está en revisión. Te contactaremos por WhatsApp para confirmar tus datos antes de publicarlo." and the business is saved in status `in_review` with origin `organic`, without trades and unpublished

#### Scenario: the client cannot publish itself

- **WHEN** a submission includes extra fields such as status `published`, origin `seeded`, publication date or a management link fingerprint
- **THEN** those values are ignored and the business ends up in `in_review` all the same, origin `organic`, with no publication date and no management link

#### Scenario: reload after success

- **WHEN** the owner reloads the thank-you screen or returns to it
- **THEN** no additional record is created

#### Scenario: save failure

- **WHEN** saving fails because of a server or database problem
- **THEN** the owner sees the message "No pudimos guardar tu registro. Vuelve a intentarlo en un momento." with their data still in the form, and no technical error detail is shown

### Requirement: Anti-abuse without a captcha on the public form

Superseded in v2 by The registration and edit forms are protected by quotas, honeypot and Turnstile (v2) — source: ADR 0012, PRD §3 (Flow A).

The form MUST be protected against automated submissions without adding friction for the user and without a captcha (PRD §8), by means of: a honeypot field invisible to people, a per-IP submission limit (3 per hour) and an alert recorded in the server log when the day's registrations exceed a plausible threshold. When blocking a submission, the system MUST NOT save anything.

The registration's per-IP limit MUST carry **its own count**, separate from that of any other public surface that uses the same mechanism —today the card's "Reportar" button (PRD §6.3) and the edit mode's change submission (PRD §6.4)—: exhausting the report quota or the edit quota MUST NOT prevent anyone from registering their business, nor MUST exhausting the registration quota prevent anyone from reporting a card or sending their changes. The IP reading policy is the same for all those quotas: only the header that the deployment declares is trusted, and without that configuration no per-IP quota is applied.

#### Scenario: bot that fills the honeypot

- **WHEN** a submission arrives with the honeypot field filled in
- **THEN** no business is created and whoever sent it sees the same thank-you screen as a legitimate submission (so as not to give the trap away)

#### Scenario: per-IP limit

- **WHEN** a fourth submission arrives from the same IP within the same hour
- **THEN** the submission is rejected without saving anything and the user sees "Ya recibimos varios registros desde aquí. Espera un rato y vuelve a intentar."

#### Scenario: alert for daily volume

- **WHEN** the registrations created in the day exceed the configured threshold
- **THEN** an alert is recorded in the server log, without blocking legitimate users

#### Scenario: the honeypot does not bother people

- **WHEN** a resident fills in the form with the keyboard or with browser autofill
- **THEN** the honeypot field stays empty and their submission is processed normally (it is not a focusable field nor announced by screen readers)

#### Scenario: quotas are not shared between surfaces

- **WHEN** from the same IP the report quota for the hour is exhausted and then a valid registration is submitted
- **THEN** the registration is processed normally; and conversely, exhausting the registration quota does not prevent sending a report

### Requirement: Form states and registration accessibility

The form MUST have the four complete states: empty, per-field error, submitting and success. While submitting, the button MUST indicate it is in progress and not allow repeated submissions. Every field MUST have an associated label, errors MUST be associated with the field for screen readers, and the WhatsApp field MUST open the numeric keyboard on a phone.

#### Scenario: submitting state

- **WHEN** the owner taps the submit button with a correct form
- **THEN** the button shows "Enviando..." and stays disabled until the server responds, so that tapping it twice does not create two registrations

#### Scenario: announced errors

- **WHEN** the submission is rejected because of validation errors
- **THEN** each message is associated with its field (the screen reader announces it on focus) and focus is placed on the first field with an error

#### Scenario: numeric keyboard

- **WHEN** the owner taps the WhatsApp field on their phone
- **THEN** the numeric keyboard opens

### Requirement: Registration works without client JavaScript

Superseded in v2 by The registration and edit forms require JavaScript for the anti-bot check and say so (v2) — source: PRD §6.1, ADR 0012.

Submitting the form and all its validation MUST work even if client JavaScript does not load: the only behavior lost without JS is the dynamic example of "¿Qué ofreces?" (which falls back to the generic example) and the "Enviando..." indicator. This keeps the PRD §8 performance budget on 4G. The photo travels in that same form submission: there MUST be no client-side preview, cropping or compression, nor any new JavaScript associated with the photo field.

#### Scenario: submission without JS

- **WHEN** the owner submits the form, with or without a photo, with client JavaScript disabled or not yet loaded
- **THEN** the registration is processed the same on the server and they see the thank-you screen or the per-field errors, as appropriate

#### Scenario: JS limited to the example field

- **WHEN** the registration page's own client JavaScript is reviewed
- **THEN** it corresponds only to the dynamic per-category example and to the button's submitting state, not to the photo field or the rest of the page; the analytics provider's script does not count, because it is a third party's and is injected by the trunk of the public pages (capability `base-layout`)

### Requirement: The registration leaves the card ready for the search

When saving a registration, the server MUST also write the normalized version of the name and of "¿Qué ofreces?" that the search uses (capability `data-model`), with the same normalization function the search uses, so that as soon as the admin publishes the card the resident finds it by typing with or without accents. That value is computed by the server from what the owner entered: no value sent by the client MUST be able to set or alter it, just like the status, the origin and the consent record. The owner MUST NOT see or fill in anything new on the form: the visible registration fields remain exactly the same.

#### Scenario: registration with accents, findable later

- **WHEN** the owner registers "Plomería Güicho" with "destape de drenajes" in "¿Qué ofreces?", and later their card is published
- **THEN** a resident who searches "plomeria" or "plomero" finds that business

#### Scenario: the client cannot set the search text

- **WHEN** a submission includes extra fields that try to set the normalized search text
- **THEN** those values are ignored and the business ends up with the normalized text computed from its real name and its real "¿Qué ofreces?"

#### Scenario: the form does not change for the owner

- **WHEN** the owner opens the registration page
- **THEN** they see the same required and optional fields as always, with no new field related to search

### Requirement: The management link opens the card in edit mode with the same prefilled form

The management link (PRD §6.4) MUST open, at the route `/editar/<token>`, **the same registration form** with the card's current data already filled in: no separate form and no parallel logic. The fields, their literal labels, their per-category examples and their rules are exactly those of the registration. The screen MUST be headed with the literal text "Edita tu ficha", accompanied by the literal phrase "Cambia lo que necesites y lo revisamos antes de publicarlo. Mientras tanto tu ficha sigue como está." and submitted with a button that literally says "Enviar cambios".

The edit MUST NOT ask for consent again: the registration's checkbox block MUST NOT appear, because consent was given at registration and the consent record (`consentedToNoticeAt`) remains in force (PRD §8). In its place the literal note "Tus datos siguen protegidos por el mismo aviso de privacidad que aceptaste al registrarte." MUST be shown with the link "Lee el aviso de privacidad completo" to `/aviso-de-privacidad`. The page MUST be correct at a 390px viewport, with touch areas of at least 44px, and MUST work with client JavaScript disabled, just like the registration.

#### Scenario: the owner opens their link

- **WHEN** the owner of "Plomería Güicho" opens their management link on their phone
- **THEN** they see "Edita tu ficha", the phrase "Cambia lo que necesites y lo revisamos antes de publicarlo. Mientras tanto tu ficha sigue como está.", the form with their name, their category, their WhatsApp, their zone and their optional fields already filled in as they are published, and the button "Enviar cambios"

#### Scenario: the edit does not ask for consent again

- **WHEN** the owner goes through the edit form to the bottom
- **THEN** there is no consent checkbox, they read "Tus datos siguen protegidos por el mismo aviso de privacidad que aceptaste al registrarte." and find the link "Lee el aviso de privacidad completo"

#### Scenario: business with an unnormalized zone "Otra"

- **WHEN** a published business that registered its zone as "Otra" and whose zone the admin has not yet normalized opens its link
- **THEN** the form appears with the "Otra" option chosen and its free text already written, without losing it or inventing a catalogue zone for it

#### Scenario: the edit works without JavaScript

- **WHEN** the owner opens their link and sends their changes with client JavaScript disabled
- **THEN** the submission is processed the same on the server and they see the confirmation or the per-field errors, as appropriate

### Requirement: A token that is not exactly the current one opens nothing and gives nothing away

The link MUST be resolved by looking up the **fingerprint** of the received token, compared in constant time. A nonexistent token, one that was invalidated on regeneration, one altered in a single character, one belonging to a business that is no longer published and a route without a token MUST respond with **exactly the same Spanish 404 page and the same 404 code** as any URL that does not exist: nothing in the response —neither the text, nor a header, nor an appreciable response time— MUST allow distinguishing "this link does not exist" from "this link exists but no longer works".

Because the token travels in the URL, the system MUST close the four known leaks. The edit page and its confirmation MUST declare `noindex, nofollow`; they MUST declare a referrer policy that **does not send the PATH in the `Referer`** —the most that can go out to a destination is the site's origin, never the edit URL; suppressing the whole header is not valid, because it leaves form submissions without an origin and breaks editing without JavaScript— and they MUST NOT open external links. No public page of the site MUST link to an edit URL. The edit-mode screens MUST NOT load the audience meter or any other third-party script, because it would send the path —that is, the secret— to a third party. And the token MUST NEVER be written to the application log, neither whole nor truncated, neither on the happy path nor on failure.

#### Scenario: invented token

- **WHEN** someone opens `/editar/` with an invented string
- **THEN** they see the site's Spanish 404 page, with a 404 code, with no hint as to whether that link ever existed

#### Scenario: token invalidated by a regeneration

- **WHEN** the owner opens the link they had saved after the admin generated a new one
- **THEN** they see exactly the same 404 page as with an invented token, and their public card remains published unchanged

#### Scenario: token of a business that is not published

- **WHEN** the link of a business that is no longer in status `published` is opened
- **THEN** it responds 404, just like an invented link

#### Scenario: the token does not leave in the Referer

- **WHEN** the owner taps, from the edit page, the link to the privacy notice
- **THEN** the request to the destination does not carry the edit URL in the `Referer` header

#### Scenario: the edit page is neither indexed nor linked

- **WHEN** the response of the edit page, that of its confirmation and all the public pages of the site are reviewed
- **THEN** the first two declare `noindex, nofollow` and no public page links to `/editar/...` or mentions a token

#### Scenario: the edit route does not travel to any third party

- **WHEN** the edit page and its confirmation are reviewed with analytics measurement configured
- **THEN** neither loads the provider's script or sends its route to any external destination, while the rest of the site keeps being measured normally

#### Scenario: the token does not appear in the log

- **WHEN** the messages the server writes are reviewed when opening a valid link, when opening an invalid one and when a change submission fails
- **THEN** none contains the token, neither whole nor truncated

### Requirement: Sending the edit does not touch the public card: it creates a pending edit

A valid submission of the edit form MUST NOT modify a single datum of the published card. It MUST create a **pending edit** with what the owner entered, which enters the admin's queue (capability `admin-review`), and take the owner to a confirmation screen with the literal text "¡Gracias! Ya recibimos tus cambios. Los revisamos y en cuanto los aprobemos tu ficha se actualiza. Mientras tanto sigue publicada como está." While the edit waits, the directory MUST keep showing exactly the published version. Reloading the confirmation screen MUST NOT send the changes again. If saving fails because of a server problem, the owner MUST see the literal text "No pudimos guardar tus cambios. Vuelve a intentarlo en un momento." with their data still in the form and without any technical error detail.

#### Scenario: the changes enter review and the card does not move

- **WHEN** the owner of "Estética Lupita" changes their opening hours and their address and taps "Enviar cambios"
- **THEN** they see "¡Gracias! Ya recibimos tus cambios. Los revisamos y en cuanto los aprobemos tu ficha se actualiza. Mientras tanto sigue publicada como está.", a pending edit is left waiting for review, and their public card still shows the previous opening hours and address

#### Scenario: the listing and the search do not find out either

- **WHEN** a business with a pending edit that changes its name appears in the listing of its category and in a search
- **THEN** in both places the published name is shown, not the proposed one

#### Scenario: reloading the confirmation

- **WHEN** the owner reloads the confirmation screen or returns to it
- **THEN** no additional edit is created

#### Scenario: failure saving the changes

- **WHEN** saving the edit fails because of a server or database problem
- **THEN** the owner sees "No pudimos guardar tus cambios. Vuelve a intentarlo en un momento." with their data still in the form, and the published card does not change

### Requirement: The edit goes through the same validations as the registration and cannot set what is not its to set

The server MUST validate and normalize the edit with **the same rules and the same literal messages** as the registration: required fields not empty, category and zone from the catalogue, WhatsApp normalized to 10 digits, "¿Qué ofreces?" at 200 characters or fewer, page link only with `http://` or `https://`, zone "Otra" with required free text, and every free-text field bounded. The errors MUST be shown next to their field and the form MUST keep what the owner had already entered.

If the proposed WhatsApp already has another card in the directory, the submission MUST be rejected with the literal text "Ese número ya está en otra ficha del directorio." next to that field (the check is repeated when the edit is applied, see `admin-review`). An edit submission MUST NOT be able to alter the status, the origin, the trades, the publication date, the registration date, the consent record or the management link fingerprint: those values are not editable and any extra field that tries to set them MUST be ignored. A token MUST NOT be able to edit a business other than its own.

#### Scenario: invalid WhatsApp in the edit

- **WHEN** the owner deletes a digit of their WhatsApp and sends the changes
- **THEN** no edit is saved and they see "Revisa tu número de WhatsApp: deben ser 10 dígitos" next to that field, with the rest of what they wrote intact

#### Scenario: WhatsApp that already has another card

- **WHEN** the owner proposes a number that is already published on another card of the directory
- **THEN** no edit is saved and they see "Ese número ya está en otra ficha del directorio." next to that field

#### Scenario: fields that are not its to set

- **WHEN** an edit submission includes extra fields such as status `published`, origin `seeded`, trades, publication date, consent date or a management token
- **THEN** those values are ignored entirely: the edit saves only enterable fields and, when applied, the business keeps its status, its origin, its trades, its publication date, its consent record and its link

#### Scenario: a token only edits its own card

- **WHEN** a submission arrives with the token of one business and the identifier of another
- **THEN** nothing is saved for the second business and the response does not reveal any of its data

#### Scenario: the edit leaves the card ready for the search

- **WHEN** an edit is applied that changes the name to "Plomería Güicho" and the keywords to "destape de drenajes"
- **THEN** the business's normalized search versions are recomputed by the server, so that a resident who searches "plomeria" finds it

### Requirement: Sending changes when others are already waiting replaces the previous ones

A business MUST be able to have **only one edit waiting for review**. If the owner opens their link when they already have pending changes, the form MUST be prefilled with **what they sent last time** (not with what is published, so they do not have to enter it again) and MUST warn them at the top with the literal text "Ojo: ya tienes cambios esperando revisión. Si mandas otros, estos reemplazan a los anteriores." On submit, the previous edit MUST stop being pending and the new one MUST take its place, with its wait counted from this submission. At no moment MUST two pending edits of the same business remain, not even if two submissions arrive almost at the same time.

#### Scenario: warning when opening with pending changes

- **WHEN** the owner opens their link a day after sending changes that the admin has not yet reviewed
- **THEN** they see "Ojo: ya tienes cambios esperando revisión. Si mandas otros, estos reemplazan a los anteriores." and the form carries what they sent last time, not what is published

#### Scenario: the new changes replace the old ones

- **WHEN** the owner sends a second set of changes
- **THEN** the admin sees a single edit for that business in the queue, with the content of the second submission and with its wait counted from that moment

#### Scenario: two almost simultaneous submissions

- **WHEN** two edit submissions for the same business arrive almost at the same time
- **THEN** exactly one pending edit remains and the owner does not see a technical error

### Requirement: Anti-abuse for edit submissions, with its own quota

Superseded in v2 by The registration and edit forms are protected by quotas, honeypot and Turnstile (v2) — source: ADR 0012.

Edit submission MUST be protected without a captcha and without friction (PRD §8), with: a honeypot field invisible to people and a limit of 3 edit submissions per hour per IP, counted in a **counter of its own**, separate from the registration counter, the card's report counter and the admin panel access attempts counter —exhausting one MUST NOT consume the others—. When blocking a submission, nothing MUST be saved or modified. When the quota is exhausted, the owner MUST see the literal text "Ya recibimos varios cambios desde aquí. Espera un rato y vuelve a intentar."

#### Scenario: per-IP limit

- **WHEN** a fourth edit submission arrives from the same IP within the same hour
- **THEN** the submission is rejected without saving anything and whoever sent it sees "Ya recibimos varios cambios desde aquí. Espera un rato y vuelve a intentar."

#### Scenario: the honeypot field

- **WHEN** an edit submission arrives with the honeypot field filled in
- **THEN** no edit is saved and whoever sent it sees the same confirmation as a legitimate submission

#### Scenario: the quotas do not get in each other's way

- **WHEN** an owner exhausts their edit quota and from that same IP someone registers a new business
- **THEN** the registration is processed normally, because the counters are independent

### Requirement: The registration funnel is measured with the views of its two screens

The events "formulario iniciado" and "formulario enviado" of PRD §9 MUST be measured with the page views of `/registro` and `/registro/gracias`, without adding our own JavaScript, without instrumenting the "Enviar" button and without any extra event. The button is deliberately not instrumented: a click on "Enviar" with validation errors is not a registration, and counting it would inflate the PRD §10 conversion ("% de registros completados sin ayuda", read as views of `/registro/gracias` divided by views of `/registro`). The thank-you screen is a proxy for conversion, not the accounting count of registrations: the exact number of registered businesses lives in the database.

#### Scenario: successful registration

- **WHEN** a business owner fills in the form correctly and sends it, with measurement configured
- **THEN** one view of `/registro` and one view of `/registro/gracias` are recorded, which is what counts as a conversion

#### Scenario: a submission with errors does not count as a conversion

- **WHEN** the owner sends the form with one field wrong and sees the per-field errors
- **THEN** they stay on `/registro`, no view of `/registro/gracias` is recorded and no "enviado" event is sent

#### Scenario: no instrumentation on the button

- **WHEN** the registration form is reviewed
- **THEN** the "Enviar" button carries no event attribute or JavaScript added for measuring, and the form keeps working without client JavaScript

### Requirement: No form data travels to the measurement

Nothing the owner writes in the registration —business name, WhatsApp, phone, zone, address, opening hours or the text of "¿Qué ofreces?"— MUST reach the analytics provider, neither as an event property nor inside a URL. The two registration screens MUST keep living at URLs without parameters, and the per-field errors MUST keep being shown at the same URL `/registro`, so that the only information that leaves the site is that someone viewed those two screens.

#### Scenario: the registration URLs carry no data

- **WHEN** the owner goes through the form, makes a mistake, corrects it and ends on the thank-you screen
- **THEN** the only routes that travel to the provider are `/registro` and `/registro/gracias`, with no query string and none of their data

#### Scenario: a submission blocked by the honeypot

- **WHEN** a bot fills in the honeypot field and receives the same thank-you screen as a legitimate submission (so as not to give the trap away)
- **THEN** no conversion is counted, because measurement happens only in the browser and a bot that does not run JavaScript does not record the view; and if it did end up counting it, the accounting number of registrations is still the database's, not the provider's

### Requirement: The zone options come from the active locality (v2)

Added in v2 — source: ADR 0006, PRD §3 (Flow A). Amended on 2026-10-18 by EMR-39 and the decision of the product owner of that date: the field that offers the zones is designed ("The zone is typed with the locality's zones as suggestions, and a name that is none of them is kept as "Otra" (v2)"): the zones are suggestions of a text field, there is no option "Otra" to choose, and a submission names a zone by its name, so a zone of another locality is kept as free text instead of being an error.

The registration page of a locality MUST offer as zones the visible zones of that locality, and nothing else: no zone of another locality and no hidden zone. A business MUST be created in the locality of the page where it registered.

This replaces the zones of the scenario "closed catalogue lists" of "Required and optional form fields": the list is not the prototype's 21 zones but the visible zones of the locality (Tizayuca has 105, from SEPOMEX), offered as the suggestions of the zone field.

#### Scenario: options

- **WHEN** an owner opens the registration page of Tizayuca
- **THEN** the zone suggestions are the visible zones of Tizayuca, and no zone of another locality or hidden zone

#### Scenario: a zone of another locality

- **WHEN** a submission to the registration of Tizayuca carries the name of a zone of another locality, or of a hidden zone of Tizayuca
- **THEN** no catalogue zone is linked to the business: it is saved with that name as the free text of "Otra", pending the admin's normalization

#### Scenario: the locality of the new business

- **WHEN** a valid registration is submitted on the page of Tizayuca
- **THEN** the business is saved with the locality of Tizayuca

### Requirement: The registration and edit forms are protected by quotas, honeypot and Turnstile (v2)

Added in v2 — source: ADR 0012, PRD §3 (Flow A), PRD §7. Amended on 2026-10-18 by EMR-42 and the decision of the product owner of that date: for the registration, Turnstile, its kill switch and the test keys are settled in "Turnstile is checked on the server, fails closed and has a switch in the database (v2)", and the alert of the daily threshold in "The daily registrations alert goes out once per local day (v2)"; the edit form (EMR-43) follows them with its own action.

Both forms MUST be protected without a login and with the following controls, all of which MUST run before any image is opened and MUST save nothing when they block a submission: (1) an invisible honeypot field, trimmed before it is checked, where a whitespace-only value counts as empty; (2) a per-IP quota of 3 submissions per hour for registrations and 3 per hour for edits, each with its own counter, separate from the counters of reports, search and SMS; (3) Cloudflare Turnstile in managed mode, whose token MUST be validated on the server, and a submission without a valid token MUST be rejected. Turnstile MUST be on from day one behind a kill switch that turns it off without a deploy. Local and CI runs MUST work with Turnstile's test keys without network. The registration MUST also alert the admin when the registrations of a day exceed the threshold configured for the locality.

#### Scenario: honeypot filled in a registration

- **WHEN** a registration arrives with the honeypot filled
- **THEN** no business is created and the sender sees the same thank-you screen as a legitimate registration

#### Scenario: honeypot with only spaces

- **WHEN** a registration or edit arrives whose honeypot has only whitespace
- **THEN** the honeypot counts as empty and the submission is processed normally

#### Scenario: honeypot filled in an edit

- **WHEN** an edit arrives with the honeypot filled
- **THEN** no edit is saved and the sender sees the same confirmation as a legitimate edit

#### Scenario: registration quota

- **WHEN** a fourth registration from the same IP arrives within the same hour
- **THEN** it is rejected without saving anything and the owner sees "Ya recibimos varios registros desde aquí. Espera un rato y vuelve a intentar."

#### Scenario: edit quota

- **WHEN** a fourth edit from the same IP arrives within the same hour
- **THEN** it is rejected without saving or changing anything and the owner sees "Ya recibimos varios cambios desde aquí. Espera un rato y vuelve a intentar."

#### Scenario: independent counters

- **WHEN** an IP exhausts its registration quota and then submits an edit, a report or a search
- **THEN** those are processed normally, and the other way round

#### Scenario: daily threshold alert

- **WHEN** the registrations created in the day exceed the threshold configured for the locality
- **THEN** the admin is alerted and legitimate users are not blocked

#### Scenario: a valid Turnstile token

- **WHEN** a valid submission arrives with a valid Turnstile token
- **THEN** it is processed normally

#### Scenario: a missing or invalid token

- **WHEN** a submission arrives with no token, an invalid token or an expired token
- **THEN** it is rejected, nothing is saved, no image is opened and no file is left

#### Scenario: the kill switch

- **WHEN** the kill switch is set to off without a new deploy
- **THEN** the forms no longer show the widget and accept submissions without a token, and the honeypot and the quotas keep working

#### Scenario: test keys

- **WHEN** the forms are tested locally or in CI with Turnstile's test keys
- **THEN** the validation runs without network access

#### Scenario: only the forms that need it

- **WHEN** the report form and the search are reviewed
- **THEN** neither includes Turnstile

### Requirement: The registration and edit forms require JavaScript for the anti-bot check and say so (v2)

Added in v2 — source: PRD §6.1, ADR 0012. Amended on 2026-10-18 by EMR-42 and the decision of the product owner of that date: the forms require JavaScript while Turnstile's switch is on, and the registration's message and behaviour are settled in "Without JavaScript the registration says so and cannot be sent while Turnstile is on (v2)"; with the switch off they work without JavaScript.

The registration and edit forms require client JavaScript, because the anti-bot check runs in the browser. This is the single exception to the rule that the site works without JavaScript. When JavaScript is missing, the page MUST say so plainly in Spanish, and the form MUST NOT be submittable. Listings, filters, pagination, search, legal pages and the whole admin panel keep working with server HTML only.

#### Scenario: no JavaScript

- **WHEN** an owner opens the registration or the edit page with JavaScript disabled
- **THEN** the page shows a plain Spanish message that the form needs JavaScript, and the form cannot be submitted

#### Scenario: with JavaScript

- **WHEN** an owner opens the same pages with JavaScript enabled
- **THEN** the message is not shown and the form can be submitted

#### Scenario: the rest of the site

- **WHEN** a resident uses a listing, a filter, the pagination, the search and the legal pages with JavaScript disabled
- **THEN** all work the same

### Requirement: Photos are stored as two WebP sizes in R2 under opaque keys (v2)

Added in v2 — source: ADR 0011, PRD §6.8. Amended on 2026-10-18 by EMR-35 and the decision of the product owner of that date: the bucket is the environment's public media bucket, and the objects, their sizes and their caching are the ones the directory serves.

The Worker MUST validate the type and size of the uploaded photo and transform it once with the Images binding into two WebP sizes (card and full) with the metadata stripped. Only those two files MUST be stored, in the public media bucket of the environment (`deployment`, "Public media live in R2, in one bucket for production and one for dev and stage (v2)"), under the opaque photo key the server generates (`data-model`, "A photo key is 24 characters of the identifier alphabet, and names two objects under `photos/` (v2)"): `photos/<photo key>/card.webp`, 400×400, the listing card's, and `photos/<photo key>/full.webp`, 1200×900, the card's, each within the weight of `public-directory`, "Photo weight does not break the 4G budget", with the media type `image/webp` and `Cache-Control: public, max-age=31536000, immutable`. The original MUST NOT be kept. This replaces the storage described in "The photo is stored compressed, without metadata and with a server-generated reference" only as to the format and the store.

#### Scenario: what is stored

- **WHEN** an owner registers with a photo
- **THEN** the bucket holds exactly two WebP objects for it, under opaque keys, and no original

#### Scenario: no metadata

- **WHEN** the photo uploaded carries EXIF with GPS coordinates
- **THEN** neither stored object carries any metadata

#### Scenario: a failure while transforming

- **WHEN** the transformation fails
- **THEN** the owner sees "No pudimos preparar tu foto. Intenta con otra.", no business is created and no object remains in the bucket

### Requirement: The registration page of a locality lives under it, and lands on its thank-you page (v2)

Added in v2 — source: ADR 0007, ADR 0019, EMR-39; `public-directory`, "The report form posts to its own address, which names the card (v2)", whose pattern every public form follows. It takes the place of the prototype's `/registro` and `/registro/gracias` at the root, and amends "No form data travels to the measurement" on the address of the answer with errors. Amended on 2026-10-18 by EMR-42: the answer refused by Turnstile (`403`), and the form needs JavaScript while Turnstile is on.

The registration form of a locality is `/{estado}/{municipio}/registro`, and its thank-you page `/{estado}/{municipio}/registro/gracias`; both segments are reserved (`data-model`, "The slugs of the catalogues do not produce ambiguous URLs at the root of a locality (v2)"). The page MUST be headed with the literal text "Registra tu negocio gratis" as its only `h1`, followed by the literal phrase "Llena este formulario en un par de minutos, sin cuenta ni contraseña. En cuanto lo revisemos, te contactamos por WhatsApp.", and then the form. The form page may be indexed: it declares its own address as canonical, its title is "Registra tu negocio gratis en {municipio}", its description "Registra gratis tu negocio de {municipio} en enmirumbo: un solo formulario, sin cuenta ni contraseña. Lo revisamos y te contactamos por WhatsApp.", both with the municipality read from the locality record, and the sitemap lists it (`base-layout`, "The sitemap lists the pages that exist, from the database (v2)").

The form posts to the address of its own page with the server action of the registration, and the business is created in the locality of that address: no field of the submission chooses or changes the locality. The action reached any other way —posted from another page, or at its own endpoint `/_actions/register`— MUST save nothing and answer 404, and so does the registration page of a municipality that is not an active locality. A received submission —a new card, the resubmission of a rejected card or a submission caught by the trap field, which MUST look the same— MUST be answered with a `303` to the thank-you page, with `Cache-Control: no-store`, so that reloading it never sends the form again; the server builds that address, and no field of the submission can change it. Any other answer renders the form again in the answer to that same submission, with the error next to each field and what the owner had written, read from that submission, with the status of its error (`400` for the fields, a number that already has a card included; `403` when Turnstile refused it; `429` over the quota; `500` when it could not be saved), `Cache-Control: no-store` and no `Set-Cookie`. What the owner wrote MUST NOT travel in an address or a cookie, and MUST NOT be kept on the server: the address of that answer is the form's with the name of the action alone (`/registro?_action=register`), which carries no value, and the measurement leaves the query out of the addresses it records (`base-layout`, "The measurement carries no personal data or text typed by people"), so only `/registro` and `/registro/gracias` reach it.

The thank-you page MUST show the literal message of "A successful submission queues the business and shows the thank-you screen" as its only `h1` and a link "Volver al inicio" to the home of the locality, and nothing else. It has no form and no query, reads nothing, declares `noindex, follow` and no canonical, has the static title "Gracias por registrar tu negocio", is left out of the sitemap and is disallowed by `robots.txt` (`base-layout`, "The open `robots.txt` allows the public site and excludes what is not relevant (v2)").

While Turnstile's switch is on, the form needs client JavaScript ("Without JavaScript the registration says so and cannot be sent while Turnstile is on (v2)"); with it off, the form is submitted and validated without client JavaScript, as "Registration works without client JavaScript" describes, and so the scenarios below that send it without JavaScript hold with the switch off.

#### Scenario: the registration of Tizayuca

- **WHEN** an owner taps "Registra tu negocio gratis" on the home of Tizayuca
- **THEN** they land on `/hidalgo/tizayuca/registro`, headed "Registra tu negocio gratis", whose canonical is that address

#### Scenario: a valid registration

- **WHEN** an owner sends the form filled in correctly, with client JavaScript disabled
- **THEN** the answer is a `303` to `/hidalgo/tizayuca/registro/gracias`, which shows "¡Gracias! Tu negocio está en revisión. Te contactaremos por WhatsApp para confirmar tus datos antes de publicarlo." and "Volver al inicio", and the business is saved in Tizayuca

#### Scenario: a submission with errors

- **WHEN** an owner sends the form with a field wrong
- **THEN** the answer is the form again, with status `400`, `Cache-Control: no-store`, no cookie, the error next to that field and what they wrote still in the form, at an address that carries only the name of the action

#### Scenario: the action reached from elsewhere

- **WHEN** the registration action is posted to the home of a locality, to another page or to `/_actions/register`
- **THEN** the answer is a 404 and no business is created

#### Scenario: the submission does not choose where to return

- **WHEN** a valid submission arrives with extra fields that point to a foreign site
- **THEN** the answer is the thank-you page of the same locality, which the server builds, and no cookie goes out

#### Scenario: the thank-you page is not indexed

- **WHEN** a search engine reads the thank-you page
- **THEN** it asks not to be indexed, declares no canonical, appears in no sitemap and is disallowed by `robots.txt`, while the form page is indexable and listed in the sitemap

### Requirement: The zone is typed with the locality's zones as suggestions, and a name that is none of them is kept as "Otra" (v2)

Added in v2 — source: decision of the product owner, 2026-10-18 (EMR-39); ADR 0006. With 105 zones in Tizayuca, a list to scroll is no way to find one's own. It takes the place of "Zone "Otra" with free text pending normalization", and in "Required and optional form fields" of the zone as "closed catalogue list with an "Otra" option + free text" and of "Otra" at the end of the zones in the scenario "closed catalogue lists"; and in "The server validates every field and returns per-field errors in Spanish", of the zone outside the catalogue as a rejection, and of the literal "Elige tu colonia", which no field shows any more.

The zone MUST be one text field, labelled "¿En qué colonia estás?", whose suggestions are the browser's own (a `datalist`, with no JavaScript of the site): the visible zones of the locality ("The zone options come from the active locality (v2)"), each by the name the directory shows it with (`public-directory`, "A zone whose name repeats in its locality is shown with its settlement type (v2)"), in alphabetical order. Typing part of a name offers the zones that contain it: typing "hacien" offers "Haciendas de Tizayuca". Below the field, the literal help line MUST always be visible: "Empieza a escribirla y elígela de la lista. Si no aparece, escríbela completa y nosotros la acomodamos." There is no option "Otra" to choose and no second field for it.

The server MUST decide the zone from the text that arrives, compared as the site compares zone names, ignoring capitals, accents and punctuation: a text that is the display name of one visible zone of the locality ("El Carmen (Fraccionamiento)"), or else the name of exactly one ("El Chopo", when the zone that shares its name is hidden), selects that zone, and nothing else is kept. A text that names no visible zone of the locality, or names several ("El Carmen", which two share), is kept as the free text of "Otra", trimmed, with no catalogue zone, so that the admin normalizes it later (PRD §6.3, Appendix A; `data-model`, "The zone allows "Otra" with free text pending normalization"). The submission carries a name, never an identifier, so no submission can link a business to a zone of another locality or to a hidden zone. An empty zone MUST NOT be saved and MUST show the literal message "Escribe el nombre de tu colonia" next to the field; a zone of more than 80 characters, "Deja esto en 80 caracteres o menos".

#### Scenario: the suggestions

- **WHEN** an owner of Tizayuca types "hacien" in "¿En qué colonia estás?"
- **THEN** the browser suggests "Haciendas de Tizayuca", among the visible zones of Tizayuca, and the help line is in view

#### Scenario: a zone typed without capitals or accents

- **WHEN** an owner writes "haciendas de tizayuca" and sends the form
- **THEN** the business is saved with the catalogue zone "Haciendas de Tizayuca" and without free text

#### Scenario: registration with zone "Otra"

- **WHEN** an owner writes "Rinconada del Venado", which is no zone of the locality, and sends the form
- **THEN** the business is saved with that free text and without a catalogue zone, pending normalization

#### Scenario: a name two zones share

- **WHEN** an owner writes "El Carmen", and the locality has "El Carmen (Colonia)" and "El Carmen (Fraccionamiento)"
- **THEN** the business is saved with "El Carmen" as the free text of "Otra", and the admin decides which one it is

#### Scenario: no zone

- **WHEN** an owner sends the form with the zone empty
- **THEN** nothing is saved and they see "Escribe el nombre de tu colonia" next to the field

### Requirement: Every check of the registration form is the server's, with fixed limits (v2)

Added in v2 — source: EMR-39. It settles what "The server validates every field and returns per-field errors in Spanish", "The server normalizes and validates the WhatsApp to 10 digits", "Consent with a visible simplified notice and a consent record" and "Form states and registration accessibility" leave open.

The form MUST leave every check to the server (`novalidate`), so that each error is its literal Spanish message next to its field and never a browser's tooltip, while the required fields keep `required` for screen readers and every field keeps the type and keyboard of its kind. Each free-text field has a limit, the same for the browser (`maxlength`) and the server, counted as `maxlength` counts (a line break counts once): the name 80 characters, the zone 80, "¿Qué ofreces?" 200, the landline 20, the address or references 200, the opening hours 100 and the Facebook link 300; past it the field shows "Deja esto en <límite> caracteres o menos" (for "¿Qué ofreces?", the literal "Deja esto en 200 caracteres o menos"). A WhatsApp of more than 30 characters, or with any character other than digits, spaces, hyphens, dots, brackets and `+` (a letter, "no tengo"), is the WhatsApp error. The Facebook link MUST start with `http://` or `https://`, parse as such and carry no credentials (`https://facebook.com@evil.example` leads elsewhere), and it is saved in its canonical form. The category is sent as its slug and MUST be one of the catalogue. The checkboxes count as checked only with what a browser sends for them (`on`): `consent=false` or `consent=yes` is no consent. The form carries the version of the notice it was rendered with in a hidden field, `noticeVersion`, which only detects a mismatch. Every field is read once, its first value, and a field that is not text is empty.

When the form comes back, the first field with an error, in the order of the screen, MUST take the focus (`autofocus`, which needs no JavaScript), every field with an error MUST be marked invalid and point to its message, and what was written MUST be shown bounded to each field's limit, as text. The page's own client JavaScript is one bundled file of the site, never inline (`deployment`, "Every response carries the security headers and the content security policy (v2)"), and does only the two things "Registration works without client JavaScript" allows: the example of "¿Qué ofreces?", and "Enviando..." on the disabled button; while Turnstile is on, the widget adds a second bundled file of its own ("Turnstile is checked on the server, fails closed and has a switch in the database (v2)"). When the form comes back with a category chosen, the server already writes that category's example.

#### Scenario: a link without its scheme

- **WHEN** an owner writes "facebook.com/minegocio" in the Facebook link and sends the form
- **THEN** the browser lets it through, and the server answers "El link de Facebook debe empezar con http:// o https://" next to the field

#### Scenario: a field past its limit

- **WHEN** a submission forged without the form carries a name of thousands of characters
- **THEN** nothing is saved, the name shows "Deja esto en 80 caracteres o menos" and its first 80 characters

#### Scenario: the focus after an error

- **WHEN** the form comes back with errors in the WhatsApp and the landline, with client JavaScript disabled
- **THEN** the focus is on the WhatsApp field, and each error is announced with its field

#### Scenario: the consent is what a browser sends

- **WHEN** a submission forged without the form carries `consent=false`
- **THEN** nothing is saved and the form says "Marca la casilla para poder registrar tu negocio"

### Requirement: The registration's honeypot and per-IP quota are those of the public forms (v2)

Added in v2 — source: ADR 0012; `deployment`, "Anti-abuse counters live in a Durable Object and never in PostgreSQL (v2)", which also says how the address is read. It settles, for the registration, the honeypot and the quota of "The registration and edit forms are protected by quotas, honeypot and Turnstile (v2)"; Turnstile, its kill switch and the alert of the daily threshold are settled in "Turnstile is checked on the server, fails closed and has a switch in the database (v2)" and "The daily registrations alert goes out once per local day (v2)". Amended on 2026-10-18 by EMR-42: a submission Turnstile refused spends no quota either.

The registration form carries the trap field of the public forms, the same as the report form's: invisible, out of the keyboard's order, hidden from screen readers and away from autofill, and trimmed before it is checked, so that a value of only spaces counts as empty. A submission with it filled MUST be answered as a received registration —the `303` to the thank-you page— without saving anything and without reaching the database.

The per-IP quota of the registrations is its own purpose of the quota counter, `registration`: 3 per address in a window of one hour that starts with its first counted registration, counted apart from the search, the reports, the edits and the SMS. Only a submission that passed the trap field, Turnstile (or came while its switch is off) and the validation of every field counts, whether it then creates a card, resubmits a rejected one or meets a number that already has a card; so a typo or a refused token spends no quota, and finding out which numbers have a card takes one counted submission each. The quota is checked before the number is looked up. Over it, nothing is saved and the form comes back with the literal text "Ya recibimos varios registros desde aquí. Espera un rato y vuelve a intentar." above it, with what the owner had written, status `429` and `Cache-Control: no-store`. A request that carries no address of its visitor —only possible on a developer's machine— is not counted. When the counter cannot answer, the registration goes on as if it were within the quota.

#### Scenario: the fourth registration of the hour

- **WHEN** an address that sent three valid registrations this hour sends a fourth
- **THEN** nothing is saved, the answer is a `429` with "Ya recibimos varios registros desde aquí. Espera un rato y vuelve a intentar." and what the owner had written, and another address registers normally

#### Scenario: what does not count

- **WHEN** an address sends submissions caught by the trap field and submissions with a field wrong
- **THEN** none of them spends its quota

#### Scenario: independent counters

- **WHEN** an address over its report quota registers, or an address over its registration quota reports or searches
- **THEN** the registration is saved, or the report and the search go on

#### Scenario: the trap field

- **WHEN** a registration arrives with the trap field filled, or with only spaces in it
- **THEN** the first lands on the thank-you page and saves nothing; the second is saved normally

### Requirement: Turnstile is checked on the server, fails closed and has a switch in the database (v2)

Added in v2 — source: ADR 0012; decision of the product owner, 2026-10-18 (EMR-42); Cloudflare's Turnstile documentation (client-side rendering, server-side validation, testing), read on 2026-10-18. It settles, for the registration, Turnstile, its kill switch and the test keys of "The registration and edit forms are protected by quotas, honeypot and Turnstile (v2)". The edit form (EMR-43) uses the same widget and the same check, with its own action.

**The widget.** While the switch is on, the registration form MUST carry Cloudflare's Turnstile widget in managed mode, after the consent block and before the submit button, rendered in Spanish at the width of the form, with the site key of the environment and the action `registration`. The page's markup carries no script of Cloudflare: a bundled script of the site loads Turnstile's `api.js` from `https://challenges.cloudflare.com/turnstile/v0/api.js`, exactly as Cloudflare publishes it, and renders the widget there, which puts its token in the field `cf-turnstile-response` of the form. The submit button is disabled until the widget has a token, and again while the token has expired or the widget failed, until it gets a new one; a page restored from the browser's history asks for a new token, since its token was spent. When `api.js` cannot load, or the environment has no site key it may use, the form shows "No pudimos comprobar que eres una persona. Vuelve a intentarlo." and cannot be sent. Each environment names its site key in `TURNSTILE_SITE_KEY` (`deployment`): the widget `enmirumbo` in production, the widget `enmirumbo-dev` in `dev` and `stage`, and Cloudflare's always-pass test site key on the local Worker; the secret key is the Worker secret `TURNSTILE_SECRET_KEY`.

**The check.** The server MUST decide a submission in this order, and each step that refuses it saves nothing and opens no image: the trap field; Turnstile; every field; the per-IP quota; then the photo (EMR-40) and the save. The action reads the switch through `HYPERDRIVE_FRESH`. With it on, the token MUST be validated with Cloudflare's siteverify: one request with the secret key and the token and nothing else —never the visitor's address, which the privacy notice keeps in the quota counter's memory alone—, which MUST answer within 3 seconds, without a retry. The token is valid only when siteverify says so and carries the action of the form. Anything else refuses the submission: no token, an expired, already spent, invented or forged one, a token of another form, an error of Cloudflare, no answer or one after 3 seconds. A refused submission spends no quota, and the form comes back from that same submission, with what the owner had written, the widget again and the literal text "No pudimos comprobar que eres una persona. Vuelve a intentarlo." above it, with status `403`, `Cache-Control: no-store` and no `Set-Cookie`. Turnstile fails closed: when Cloudflare's check is down, the admin turns the switch off. The log says that a registration was refused and why (no token, not valid, not checked), never the token or anything of the submission.

**The switch.** Turnstile has a switch in the database, on by default (`data-model`, "The site's switches live in one row of the database (v2)"), that an admin turns off and on without a deploy: today with one SQL statement (README, Operations), later from the panel (epic F). The page reads it through the cached `HYPERDRIVE`, so it shows or hides the widget within a minute of the change; the action reads it fresh, so turning it off lets submissions through at once, and a submission Turnstile refused always comes back with the widget. With the switch off, the form shows no widget and no message about JavaScript, its button is ready, and submissions are accepted without a token; the trap field and the quota keep working. Turning it off never blocks anyone for more than that minute, in which a page still shows the widget; turning it on refuses at most once, for that minute, a form shown without the widget, which then comes back with it.

**The test keys.** Local and CI runs MUST work with Cloudflare's test keys without network: the local Worker (`ENVIRONMENT` `local`), with no secret key or with a test secret key, answers as siteverify answers those keys, without asking it: the always-pass test secret key, which is also the one used when none is set, accepts the dummy token `XXXX.DUMMY.TOKEN.XXXX` that every test site key produces, and nothing else; the always-fail and already-spent ones accept nothing. Outside the local Worker no dummy token can pass: a test secret key, or none, refuses every token and is logged once as a configuration problem; a real secret key never accepts the dummy token; a test site key renders no widget; and the deploy refuses a site key that is not a real one (`deployment`, "Each environment is built and deployed by its own workflow (v2)"). The end-to-end tests answer every request to Turnstile's origin with a local stand-in of `api.js` that produces the dummy token; a check run by hand loads Cloudflare's real script on the preview.

#### Scenario: a valid token

- **WHEN** an owner sends the form filled in correctly, with the token the widget produced
- **THEN** the registration is saved, and siteverify was asked once, with the secret key and the token and without the visitor's address

#### Scenario: a refused token

- **WHEN** a submission arrives with no token, or with an expired, already spent or forged one
- **THEN** nothing is saved, no quota is spent, and the form comes back with status `403`, "No pudimos comprobar que eres una persona. Vuelve a intentarlo." above it, what the owner had written and the widget

#### Scenario: Cloudflare does not answer

- **WHEN** siteverify fails or takes more than 3 seconds
- **THEN** the submission is refused the same way, and the admin can turn the switch off

#### Scenario: a token of another form

- **WHEN** a submission to the registration carries a valid token whose action is not `registration`
- **THEN** it is refused

#### Scenario: the switch turned off

- **WHEN** the admin turns the switch off in the database
- **THEN** a registration without a token is saved at once, the page shows no widget within a minute, and a filled trap field and a fourth registration of the hour from one address are still stopped

#### Scenario: the switch turned on again

- **WHEN** the admin turns the switch on while an owner has the form open without the widget
- **THEN** their submission is refused once and comes back with the widget, and the next one with its token is saved

#### Scenario: test keys locally and in CI

- **WHEN** the local Worker receives the dummy token, with Cloudflare's always-pass test keys or no secret key
- **THEN** it accepts it without any request to Cloudflare, and refuses any other token

#### Scenario: a test key in a deployed environment

- **WHEN** a deployed environment has a test secret key, no secret key or a test site key, or a submission brings the dummy token there
- **THEN** no submission that needs Turnstile passes, the problem is logged once, and the deploy of a test site key stops before changing anything

### Requirement: Without JavaScript the registration says so and cannot be sent while Turnstile is on (v2)

Added in v2 — source: PRD §6.1, ADR 0012; decision of the product owner, 2026-10-18 (EMR-42). It settles "The registration and edit forms require JavaScript for the anti-bot check and say so (v2)" for the registration; the edit form (EMR-43) says it with its own message.

While Turnstile's switch is on, the registration page MUST show, above the fields, only to a browser that does not run JavaScript (a `noscript`), the literal text "Para registrar tu negocio, activa JavaScript en tu navegador. Lo usamos para comprobar que eres una persona.", and the form MUST NOT be submittable: its one submit button is disabled in the page's markup, so neither tapping it nor pressing Enter in a field sends anything, and only the widget's script enables it, once the widget has a token. A submission forged without the form is refused as one without a token. With JavaScript, the text is never shown. With the switch off, the form is sent and validated without JavaScript, as "Registration works without client JavaScript" describes, and the text is not shown. The rest of the site keeps working without JavaScript.

#### Scenario: no JavaScript

- **WHEN** an owner opens the registration page with JavaScript disabled while Turnstile is on
- **THEN** they read "Para registrar tu negocio, activa JavaScript en tu navegador. Lo usamos para comprobar que eres una persona." above the fields, and neither the button nor Enter sends the form

#### Scenario: with JavaScript

- **WHEN** an owner opens the page with JavaScript enabled
- **THEN** the text is not shown, and the button is enabled as soon as the widget has its token

#### Scenario: the switch off without JavaScript

- **WHEN** Turnstile's switch is off and an owner sends the form with JavaScript disabled
- **THEN** the text is not shown and the registration is processed on the server as without Turnstile

### Requirement: The daily registrations alert goes out once per local day (v2)

Added in v2 — source: ADR 0012, ADR 0013; decision of the product owner, 2026-10-18 (EMR-42). It settles the alert of the daily threshold of "The registration and edit forms are protected by quotas, honeypot and Turnstile (v2)" and of "Anti-abuse without a captcha on the public form".

Each locality has a daily registrations threshold, 20 by default (`data-model`, "The locality is a first-class record keyed by the INEGI municipality code (v2)"), which a super admin changes with SQL until the panel does (epic F, README, Operations); none disables the alert. A task of the hourly job (`deployment`, "Scheduled work runs from one hourly Cron Trigger per environment (v2)") counts, for each active locality with a threshold, the registrations of its local day, in its IANA time zone, up to the time the run was scheduled for: the organic businesses whose `registered_at` falls in that day, new cards and resubmitted rejected cards, whose wait restarts; a card the admin creates is not one. When they are more than the threshold, the admin MUST be alerted, once that day: the run that finds it first claims the alert by writing the locality's day in `daily_registration_alerted_on`, in the same statement that finds it, and only a locality whose last alert is of an earlier day can be claimed. So the later runs of the day, a run repeated, two runs at once and the first run after one that did not happen alert at most once, and the next local day counts from zero and may alert again. The alert blocks nobody and changes nothing else.

Until the email to the admin arrives (EMR-55), the alert MUST be one structured line in the Worker log, a warning whose fields are `alert: "daily-registrations"`, the code of the locality, its day, the count and the threshold, and nothing about a business, a person or an address. The email is another channel for the same alert, with the same fields.

#### Scenario: passing the threshold

- **WHEN** a locality with a threshold of 20 receives its 21st registration of its local day
- **THEN** the next hourly run writes one alert line with its code, the day, 21 and 20, and nobody is blocked

#### Scenario: at the threshold

- **WHEN** a locality has exactly as many registrations in its day as its threshold
- **THEN** no alert goes out

#### Scenario: once a day

- **WHEN** the runs after the alert find the locality still over its threshold that day, or a run is repeated, or two run at once
- **THEN** no other alert goes out that day, and the next day alerts again only if it passes the threshold

#### Scenario: the locality's own day

- **WHEN** registrations arrive at 23:30 and at 00:30 in the time zone of the locality
- **THEN** they count in two different days, whatever the date in UTC

#### Scenario: other localities

- **WHEN** one locality passes its threshold
- **THEN** only it is alerted; another locality under its own threshold, an inactive one and one without a threshold are not
