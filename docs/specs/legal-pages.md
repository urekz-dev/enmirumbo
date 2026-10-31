# Spec: legal-pages

## Requirements

### Requirement: Full privacy notice page at `/aviso-de-privacidad`

The site MUST publish the full privacy notice at the route `/aviso-de-privacidad` (a reserved segment in `src/lib/rutas-reservadas.ts`), inside the global layout, with a single `h1` with the literal text "Aviso de privacidad" and its sections as `h2`, with no skipped heading levels. The page MUST show, above the content, the current version of the notice and the date on which that text was published, on a single line with the literal form "Versión 2 · Última actualización: " followed by the date written in Spanish (for example "3 de septiembre de 2026"), where `2` is the current version identifier. The literal block of the requirement "Full text of the full privacy notice" does not include that version: it is prepended to that same line when rendering, and for that reason it stays out of the guard's fingerprint (everything else in that block, including the date, does count). The terms and conditions carry NO version: their last-update line is rendered as is. The page MUST carry a visible link to the terms and conditions with the text "Términos y condiciones", and MUST NOT carry any link to a page that does not exist.

#### Scenario: the owner opens the privacy notice

- **WHEN** a business owner opens `/aviso-de-privacidad` on their phone
- **THEN** they see, inside the layout with header and footer, the heading "Aviso de privacidad", the line "Versión 2 · Última actualización: " with its date, and the full content of the notice

#### Scenario: the version shown is the current one

- **WHEN** the version shown by the page is compared with the literal declared in the code
- **THEN** they are the same, without anyone having to update the page by hand when a new version is released

#### Scenario: heading hierarchy of the notice

- **WHEN** the HTML of `/aviso-de-privacidad` is inspected
- **THEN** there is exactly one `h1` and each section of the notice is an `h2`, with no skipped heading levels

#### Scenario: the notice links to the terms

- **WHEN** the owner reaches the end of the privacy notice
- **THEN** they find a link with the text "Términos y condiciones" that takes them to `/terminos`, and no link in the notice points to a page that does not exist

### Requirement: The privacy notice has a stable version declared in a single place

The privacy notice MUST have a stable version identifier, declared as a single literal in a single code module, from which every surface that shows or stores it reads it (the full page, the form's consent block and the server that records the consent record). The identifier MUST be a string that only moves forward: the current version is `2` —introduced by the rebrand to "enmirumbo" (T-019), which changed the site name inside the published text— and an already published version MUST NEVER be reused for another text. The version identifies the notice as a whole, which for these purposes is three inseparable pieces: the form's simplified notice, the literal of the consent checkbox and the full notice at `/aviso-de-privacidad`. The terms and conditions are NOT part of this version.

#### Scenario: a single source of the version

- **WHEN** the place where the notice version identifier is written is reviewed
- **THEN** it appears only once in the code, and the notice page, the registration form and the server read it from there, with no copies

#### Scenario: the current version

- **WHEN** the current version of the notice is queried
- **THEN** it is `2`, and it corresponds to the text that `/aviso-de-privacidad` and the form's consent block publish today

### Requirement: Changing the notice text without bumping the version breaks the verification

The project's automated verification MUST include a guard that ties the version to the text: it computes a fingerprint of the notice's versioned content —the text of the simplified notice, the literal of the consent checkbox and all the published content of the full notice (heading, draft mark while it is published, last-update line, introduction, sections with their paragraphs and bullets, and the closing link), excluding only the version line itself— and compares it against the fingerprint anchored for the current version. If they do not match, the verification MUST fail and say what to do: bump the version and anchor its fingerprint. The fingerprints of already published versions MUST stay recorded and MUST NOT be modified —in particular, the one for version `1` stays as is even though its text is no longer published: it is the proof of which text the consent records that cite it were signed against—; the fingerprint table MUST live next to the verification and not next to the text, so that fixing the text and "fixing" the fingerprint are not the same absent-minded gesture. The verification MUST also check that the current version has an anchored fingerprint and that it is the last one in the table.

The draft mark is part of the fingerprint because it is published content: it warns the data subject that the text they are accepting has not yet passed legal review, and if it were left out, removing it from the page would not release a new version and would leave the verification green.

#### Scenario: someone edits the notice and does not bump the version

- **WHEN** a sentence of the full notice, of the simplified notice or of the checkbox literal is changed, leaving the current version as is
- **THEN** the automated verification fails and indicates that the notice text changed without releasing a new version

#### Scenario: a new version is released together with the text

- **WHEN** the notice text is changed, the version is bumped to the next one and the new fingerprint is anchored
- **THEN** the verification passes, the fingerprints of the previous versions stay recorded as they were and the table gains a row

#### Scenario: version without a fingerprint

- **WHEN** the current version is bumped without anchoring its fingerprint
- **THEN** the verification fails, because the current version must always have its fingerprint in the table

#### Scenario: the guard does not get in the way of the placeholders

- **WHEN** the human fills in one of the notice's placeholders (for example the responsible party's address)
- **THEN** the verification fails until a new version is released: filling in a placeholder changes the notice text and therefore releases a new version

#### Scenario: removing the draft mark also releases a new version

- **WHEN** the placeholders stop being published and with them the draft mark disappears from the page
- **THEN** the verification fails until a new version is released: the mark is published content and is part of the fingerprint

### Requirement: The rebrand releases version 2 of the notice, without touching the evidence of version 1

Changing the site name inside the published text of the notice —the introduction, the section "Quién es responsable de tus datos" and the form's simplified notice— MUST be treated for what it is: a change to the versioned content. The same applies to publishing the directory's email in place of its placeholder. Both changes arrive together, so they release **a single** version: `2`, with its new fingerprint anchored. The fingerprint of version `1` MUST NOT be re-anchored, even though its text is no longer published: that fingerprint is the proof of which text the consent records that cite version `1` were signed against.

The consent records already stored MUST NOT be modified: a card that consented to version `1` keeps saying `1`, with its date, and the reconsent —when there is one— is recorded going forward with the mechanism that already exists. The system MUST NOT ask the data subject for anything because of this change nor send them any message: the notice promises to warn via WhatsApp before applying an important change —"por ejemplo, si empezamos a usar tus datos para algo nuevo"—, and a brand change does not alter which data is collected, what it is used for, who it is shared with or what stays public. The new version is published on the same page, which is exactly what the section "Cambios a este aviso" promises.

#### Scenario: the fingerprint of version 1 survives the rebrand

- **WHEN** the fingerprint table is reviewed after publishing the notice with the new brand
- **THEN** it has two rows, the one for version `1` is identical to the one before the rebrand and the one for `2` corresponds to the text published today

#### Scenario: an old consent record is not rewritten

- **WHEN** the admin opens the detail of a card that consented before the rebrand
- **THEN** they see the consent record with its original date and version `1`, without anyone having changed the version to `2`

#### Scenario: the rebrand does not ask anything of the already published business

- **WHEN** the notice with the new brand is deployed and there are published cards
- **THEN** none is unpublished, nobody is sent a message about the change and the directory keeps working the same

#### Scenario: the form opened before the deployment is not saved blindly

- **WHEN** an owner opened the form with version `1` in view, the rebrand is deployed and they submit afterwards
- **THEN** no registration is saved and they see "El aviso de privacidad cambió mientras llenabas esto. Léelo otra vez y vuelve a marcar la casilla." next to the checkbox, with their data still in the form and the new notice in view

### Requirement: The full notice carries the six minimum elements of the LFPDPPP

The full privacy notice MUST contain, each in its own visible section, the six minimum elements required by PRD §8: (1) identity and address of the responsible party, (2) the personal data that is processed, (3) the purposes of the processing, (4) the means to limit the use or disclosure of the data, (5) the mechanism to exercise ARCO rights, including the response deadline of at most 20 business days, and (6) the procedure by which changes to the notice will be communicated. None MUST be left implicit or spread across loose lines.

Element (4) MUST describe the actual operation today and not promise automatisms that do not exist. Two conditions: (a) the 90-day deletion period MUST be limited to **rejected** registrations —which is what PRD §6.3 and §8 say, the same as `/terminos` declares and the only thing the model can date, with `rejectedAt`—, never to every registration "that was not published", because a card in review has no purge clock and the notice would be promising an impossible deletion; and (b) the notice MUST say that the data subject's requests are handled by hand and on request (unpublishing as soon as the message arrives; everything else confirmed within at most 20 business days), without implying that a request of theirs resolves itself. The deletion of rejected registrations at 90 days is not a request from the data subject: that one the system does execute on its own, and the notice MUST NOT promise a shorter period than the one that is met.

#### Scenario: identity and address of the responsible party

- **WHEN** the owner looks for who is responsible for their data
- **THEN** they find the section "Quién es responsable de tus datos" with the name of the responsible party, their address and the contact channels (the data that does not exist yet appears as a placeholder in square brackets)

#### Scenario: data processed and purposes

- **WHEN** the owner reads the notice
- **THEN** they find the section "Qué datos recogemos", which lists the required and optional fields of the form, and the section "Para qué usamos tus datos", which lists the purposes (reviewing the business, publishing the card, notifying them via WhatsApp and counting registrations in general numbers)

#### Scenario: means to limit use or disclosure

- **WHEN** the owner wants their landline to stop appearing, or their card to be taken down from the directory
- **THEN** they find the section "Cómo limitar el uso o la divulgación de tus datos", which tells them what they can ask for (not publishing a piece of data, unpublishing the card, permanently deleting it), that unpublishing is done as soon as their message arrives and that everything is handled by hand, with no automatic button, with confirmation within a maximum of 20 business days

#### Scenario: the 90-day period is the one for rejected registrations

- **WHEN** the owner reads what happens to the data of a registration that was not published
- **THEN** the notice says that the data of **rejected** registrations is permanently deleted at 90 days —the same as `/terminos` and PRD §6.3— and does NOT promise to delete the ones still in review

#### Scenario: ARCO rights with a 20-business-day deadline

- **WHEN** the owner wants to correct or delete their data
- **THEN** they find the section "Tus derechos ARCO" with the four rights, the data they must include in their request, the channels to send it and the phrase that they are answered "en un máximo de 20 días hábiles", at no cost

#### Scenario: procedure for changes to the notice

- **WHEN** the owner wants to know what happens if the notice changes
- **THEN** they find the section "Cambios a este aviso", which says that the new version is published on that same page with its updated date and that an important change is notified to them via WhatsApp at the registered number before it is applied

### Requirement: The full notice warns that the WhatsApp and the landline become public

The full notice MUST say clearly, in its own section, what information on the card is visible to anyone on the internet —including the business name, the WhatsApp and the landline, with buttons to write or dial directly—, that the zone is published but the exact address is not, unless the owner writes it themselves, that search engines may index the card, and which data is NEVER published (the registration date, the internal review notes and the reason for a rejection). It is the same message as the form's simplified notice, here in its full version.

The enumeration MUST match exactly what the public card serves today, so it also includes: (a) that the address or references the owner writes feed the card's "Cómo llegar" button, which opens Google Maps with that address on the phone of whoever taps it (`buildDirectionsLink` in `src/lib/enlaces.ts`) —the data is not shared with anyone from the server, but it goes out to a third party as soon as a resident uses the button, and the owner has the right to know that before writing it—; and (b) that the business photo is public, with the policy on what may be depicted and what happens if it is not met. The form captures photos, so the notice MUST say what is accepted (the premises, the products or the work), what is not (people who can be recognized, because this notice covers the data subject's data and not the image of third parties) and that a photo that does not comply is not published. It MUST also say that the image is stored compressed and without the metadata the file carries —the GPS location of the shot, among others—, because that data is neither published nor kept.

#### Scenario: the notice says the WhatsApp is in plain view

- **WHEN** the owner reads the section "Qué queda público y qué no"
- **THEN** they read that their WhatsApp and their landline are visible on their card to anyone who enters the directory and that anyone can write to or call them from there

#### Scenario: the notice distinguishes zone from address

- **WHEN** the owner reads the same section
- **THEN** they read that their zone is published and not their exact address, and that if they write an address or references, those are published as is, with the warning to think about it if they work from home

#### Scenario: the address feeds the "Cómo llegar" button

- **WHEN** the owner reads the same section
- **THEN** they read that the address or references they write feed the "Cómo llegar" button on their card, and that whoever taps it opens Google Maps searching for that address with their zone and "Tizayuca, Hidalgo"

#### Scenario: the business photo is also public

- **WHEN** the owner reads the same section
- **THEN** they read that, if they upload a photo of their business, that photo is also public; that it must show their premises, their products or their work and not people who can be recognized; that a photo that does not comply is not published; and that the image is stored compressed and without the file's metadata, such as the GPS location

#### Scenario: what is never published

- **WHEN** the owner reads the same section
- **THEN** they read that the registration date, the internal review notes and the reason for a rejection are seen only by whoever administers the directory

### Requirement: Full text of the full privacy notice

Superseded in v2 by Full text of the privacy notice (v2) — source: PRD §7, decision of the product owner, 2026-10-14.

The content published at `/aviso-de-privacidad` MUST be literally the following (the headings marked with `##` are the page's `h2`; the bullets are lists). It is approved content, not free copy: changing it changes this spec.

```
Aviso de privacidad

Ojo: este texto todavía es un borrador. Nos faltan los datos que ves entre corchetes y la revisión legal antes de que el directorio se lance.

Última actualización: [FECHA DE PUBLICACIÓN]

Este aviso explica, sin rodeos, qué datos nos das cuando registras tu negocio en enmirumbo, el directorio de negocios de Tizayuca, para qué los usamos, qué queda público y cómo puedes pedirnos que los corrijamos o los borremos.

## Quién es responsable de tus datos

El responsable del directorio enmirumbo y de los datos personales que nos das es [NOMBRE O RAZÓN SOCIAL DEL RESPONSABLE — completar antes del lanzamiento], con domicilio en [DOMICILIO DEL RESPONSABLE — completar antes del lanzamiento], Tizayuca, Hidalgo, México.

Para cualquier cosa relacionada con tus datos escríbenos al correo contacto@enmirumbo.com o por WhatsApp al [WHATSAPP DEL DIRECTORIO — completar antes del lanzamiento].

## Qué datos recogemos

Los que tú escribes en el formulario de registro:

- Obligatorios: el nombre de tu negocio, la categoría, tu número de WhatsApp de 10 dígitos y tu colonia.
- Opcionales: qué ofreces, si haces entregas o vas a domicilio, teléfono fijo, dirección o referencias, horario, el link de tu Facebook y, si la subes, una foto de tu negocio.

No te pedimos CURP, RFC, credencial de elector ni datos bancarios. Si nos los mandas por WhatsApp, no los guardamos.

Guardamos también la fecha y la hora en que aceptaste este aviso: es la constancia de que nos diste tu permiso para usar tus datos.

Cuando envías el formulario, el servidor usa tu dirección IP por menos de una hora, solo en su memoria, para frenar registros automatizados. No la guardamos en la base de datos ni la ligamos a tu ficha.

## Para qué usamos tus datos

- Para revisar que tu negocio existe y que el número que registraste es tuyo: te escribimos o te llamamos por WhatsApp antes de publicar.
- Para publicar tu ficha en el directorio, que es a lo que vino todo esto: que los vecinos te encuentren y te contacten.
- Para avisarte cuando publicamos tu ficha, para mandarte su link y para decirte, si fuera el caso, por qué no la publicamos.
- Para contar cuántos negocios se registran y cuántos se publican, en números generales, y saber si el directorio está sirviendo.

No usamos tus datos para publicidad de terceros ni para nada distinto de tener el directorio funcionando.

## Qué queda público y qué no

Cuando aprobamos tu registro, tu ficha se publica y cualquier persona con internet puede verla: el nombre de tu negocio, la categoría, tu colonia, lo que escribiste en "¿Qué ofreces?", tu horario, si haces entregas, el link de tu Facebook y —esto es lo más importante— tu WhatsApp y tu teléfono fijo, con botones para escribirte o marcarte directo. Trátalos como números de contacto de tu negocio: quien sea puede verlos y usarlos.

Publicamos tu colonia, no tu domicilio exacto. Si tú escribes una dirección o referencias en el formulario, eso también se publica tal cual: piénsalo si atiendes desde tu casa.

Esa dirección también alimenta el botón "Cómo llegar" de tu ficha: quien lo toca abre Google Maps en su teléfono, buscando lo que escribiste junto con tu colonia y "Tizayuca, Hidalgo".

Si subes una foto de tu negocio, esa foto es pública igual que lo demás. La foto es opcional y debe mostrar tu local, tus productos o tu trabajo: que no salgan personas que se puedan reconocer, porque este aviso cubre tus datos y no la imagen de otras personas. Si una foto no cumple, no la publicamos y te decimos por qué al revisar tu registro. Antes de guardarla la comprimimos y le quitamos los datos ocultos que trae el archivo —como la ubicación GPS de dónde se tomó—: eso no se publica ni se conserva.

Buscadores como Google pueden encontrar tu ficha y mostrarla en sus resultados. Para eso está hecho el directorio.

Lo que nunca se publica: la fecha en que te registraste, las notas internas de la revisión y el motivo por el que, en su caso, no publicamos tu ficha. Eso solo lo ve quien administra el directorio.

## Con quién compartimos tus datos

Con nadie. No vendemos, no rentamos ni intercambiamos tus datos.

Los únicos terceros que participan son los proveedores que hacen funcionar el sitio (hospedaje y base de datos), que tratan los datos por cuenta nuestra y nada más para eso.

Solo entregaríamos datos a una autoridad que nos los pida por escrito y conforme a la ley.

## Cómo limitar el uso o la divulgación de tus datos

- Dinos qué no quieres publicar: si prefieres que tu teléfono fijo, tu horario o tu dirección no aparezcan en la ficha, escríbenos y los quitamos.
- Pide que despubliquemos tu ficha: en cuanto nos llega tu mensaje la bajamos del directorio, sin trámites ni explicaciones.
- Pide que borremos todo: eliminamos tu registro de forma definitiva, no solo lo escondemos.
- Si rechazamos tu registro, sus datos se eliminan definitivamente a los 90 días.

Todo esto lo atendemos a mano, cuando tú lo pides: no hay un botón que lo haga solo. Escríbenos por WhatsApp o por correo y te confirmamos que quedó hecho en un máximo de 20 días hábiles.

## Tus derechos ARCO

Tienes derecho a acceder a tus datos, a rectificarlos si están mal, a cancelarlos (que los borremos) y a oponerte a que los usemos. Eso son los derechos ARCO.

Para ejercerlos escríbenos al correo contacto@enmirumbo.com o por WhatsApp al [WHATSAPP DEL DIRECTORIO — completar antes del lanzamiento] y dinos:

- qué quieres: ver tus datos, corregirlos, borrarlos u oponerte a que los usemos;
- el nombre de tu negocio y el número de WhatsApp con el que lo registraste;
- si es una corrección, qué debe decir.

Te contestamos en un máximo de 20 días hábiles y, si tu solicitud procede, la aplicamos en cuanto te respondemos. No cobramos nada por esto.

Como el registro no usa cuentas ni contraseñas, antes de cambiar o borrar algo confirmamos que la solicitud viene del mismo número de WhatsApp con el que se registró el negocio. Es para que nadie más pueda tocar tu ficha.

## Cookies y datos de navegación

El directorio público no usa cookies de publicidad ni rastrea a los vecinos que lo visitan. La única cookie del sitio es la de la sesión de quien administra el directorio. Si más adelante agregamos alguna herramienta para medir visitas, lo decimos aquí antes de encenderla.

## Cambios a este aviso

Si cambiamos este aviso, publicamos la versión nueva en esta misma página y actualizamos la fecha de arriba. Si el cambio es importante —por ejemplo, si empezamos a usar tus datos para algo nuevo—, te avisamos por WhatsApp al número que registraste antes de aplicarlo. Darle una repasada a esta página de vez en cuando es la forma de estar al tanto.

## Si crees que no respetamos tus derechos

Puedes acudir a la Secretaría Anticorrupción y Buen Gobierno, que desde 2025 es la autoridad en materia de protección de datos personales en México.

Términos y condiciones
```

The last line is the link to `/terminos`.

#### Scenario: the published text is the approved one

- **WHEN** what `/aviso-de-privacidad` shows is compared with the content of this spec
- **THEN** they match paragraph by paragraph, with no filler text, no empty sections and no "lorem ipsum"

#### Scenario: the notice names the site with the current brand

- **WHEN** the owner reads the introduction of the notice and the section "Quién es responsable de tus datos"
- **THEN** the introduction presents the site as "enmirumbo, el directorio de negocios de Tizayuca" and the responsible party section already says plain "enmirumbo", without the previous brand and without the locality attached to the name

#### Scenario: none of this needs legal knowledge to be understood

- **WHEN** a resident without legal training reads the whole notice
- **THEN** all the sentences are in plain Mexican Spanish, in the second person ("tus datos", "escríbenos"), without Latinisms or contract formulas

#### Scenario: the photo is in the list of data collected

- **WHEN** the owner reads the section "Qué datos recogemos"
- **THEN** the optional-data bullet names the business photo, along with the rest of what the form captures

### Requirement: Terms and conditions page at `/terminos`

The site MUST publish the terms and conditions at the route `/terminos` (a reserved segment), inside the global layout, with a single `h1` with the literal text "Términos y condiciones" and its sections as `h2`. It MUST show the line "Última actualización: " with its date, the same as the notice, and MUST carry a visible link to the privacy notice with the text "Aviso de privacidad".

#### Scenario: the resident opens the terms

- **WHEN** anyone opens `/terminos` on their phone
- **THEN** they see, inside the layout with header and footer, the heading "Términos y condiciones", the line "Última actualización: " with its date and the full content

#### Scenario: the terms link to the privacy notice

- **WHEN** the owner reads the section of the terms that talks about their personal data
- **THEN** they find a link with the text "Aviso de privacidad" that takes them to `/aviso-de-privacidad`

### Requirement: The terms declare the directory an informational intermediary and disclaim the transactions

The terms MUST establish that enmirumbo is an informational intermediary: it only shows information, does not provide the services or sell the products on the cards, and does not charge for publishing nor charge commissions. They MUST expressly disclaim the directory from everything that happens between the resident and the business —price, work, delivery, payment, warranty, timing and any problem— and from the truthfulness of the information each business writes. They MUST also explain what the "Negocio verificado" seal means (that the business exists and that the registered number is theirs) and what is NOT verified (quality, prices, licenses, permits, insurance or that the information is still current).

#### Scenario: disclaimer of the transaction between resident and business

- **WHEN** a resident hires a service from a business they found in the directory and something goes wrong
- **THEN** the terms already told them, in the section "Somos un intermediario informativo, no el negocio", that this deal is directly between them and the business and that the directory is not a party to it, does not guarantee it and is not liable for it

#### Scenario: real scope of the "Negocio verificado" seal

- **WHEN** someone wants to know what the verified seal backs
- **THEN** the terms say that it only confirmed that the business exists and that the number belongs to whoever registered it, and list what is not verified (quality, prices, licenses, permits, insurance and whether the information is still current)

### Requirement: The terms publish the moderation rules of PRD §6.3

The terms MUST publish the moderation rules of PRD §6.3, which would otherwise live only in the admin panel: cards are rejected (or withdrawn, if already published) for illegal activities or ones that require a license that cannot be demonstrated —with the PRD's examples: controlled medicines, weapons and informal loans—, offensive, discriminatory or sexual content, cards of other people's businesses registered without the business's authorization, and photos that do not comply with the directory's publication rules. They MUST also say that rejecting is not final (the reason is communicated via WhatsApp and the business can correct and resubmit), that the data of rejected registrations is deleted at 90 days, and that the directory reserves the right not to publish or to withdraw a card, including immediate takedown when the business itself requests it.

#### Scenario: the moderation rules are published

- **WHEN** an owner wants to know why their card could be rejected
- **THEN** they find in `/terminos` the complete list of the PRD §6.3 rules, with their examples, without having to ask anyone

#### Scenario: rejecting is not forever

- **WHEN** a business has its registration rejected
- **THEN** the terms already told them that the reason is communicated to them via WhatsApp, that they can correct and resubmit, and that the data of a rejected registration is deleted at 90 days

#### Scenario: withdrawal of cards

- **WHEN** a business asks for its card to be taken down, or a card breaks the rules
- **THEN** the terms make clear that the directory may not publish it or may withdraw it, and that when the business requests it the takedown is immediate

### Requirement: Full text of the terms and conditions

Superseded in v2 by Full text of the terms and conditions (v2) — source: decision of the product owner, 2026-10-14.

The content published at `/terminos` MUST be literally the following (the headings marked with `##` are the page's `h2`). It is approved content, not free copy.

```
Términos y condiciones

Ojo: este texto todavía es un borrador. Nos faltan los datos que ves entre corchetes y la revisión legal antes de que el directorio se lance.

Última actualización: [FECHA DE PUBLICACIÓN]

Estas son las reglas de enmirumbo, el directorio de negocios de Tizayuca, para los negocios que se registran y para los vecinos que los buscan. Al usar el sitio o registrar tu negocio, aceptas lo que dice aquí.

## Qué es enmirumbo

Es un directorio de negocios y servicios de Tizayuca, Hidalgo. Sirve para dos cosas: que un negocio publique su ficha gratis y que un vecino lo encuentre y le escriba por WhatsApp. Nada más.

No cobramos por registrarse, no vendemos nada, no cobramos comisiones y no hay cuentas ni contraseñas.

## Somos un intermediario informativo, no el negocio

enmirumbo solo muestra información. No prestamos los servicios ni vendemos los productos que aparecen en las fichas.

Cuando le escribes a un negocio por WhatsApp, sales de este sitio. Lo que pase después —el precio, el trabajo, la entrega, el pago, la garantía, los tiempos y cualquier problema— es un trato directo entre tú y ese negocio. enmirumbo no es parte de ese trato, no lo garantiza, no lo supervisa y no responde por él.

Tampoco respondemos por daños, pérdidas o desacuerdos que salgan de un servicio o una compra contratados con alguien que encontraste aquí. Si algo sale mal, resuélvelo con el negocio; y avísanos, porque nos sirve para moderar el directorio.

## Qué verificamos y qué no

Antes de publicar una ficha le escribimos o le llamamos al número registrado para confirmar dos cosas: que el negocio existe y que el número es de quien lo registró. Eso, y nada más que eso, es lo que significa el sello "Negocio verificado".

Lo que no verificamos: la calidad del trabajo, los precios, que el negocio tenga licencias, permisos o seguros, ni que lo que dice su ficha siga siendo cierto con el tiempo. Esa información la escribe cada negocio y es su responsabilidad que sea verdadera y esté al día.

Si un negocio cierra o cambia sus datos y no nos avisa, su ficha puede quedar desactualizada. Avísanos y la corregimos o la bajamos.

## Reglas para registrar un negocio

Revisamos a mano cada registro antes de publicarlo. Rechazamos —o retiramos, si ya estaba publicada— cualquier ficha que caiga en esto:

- Actividades ilegales, o que necesitan una licencia o un permiso que no se pueda demostrar: venta de medicamentos controlados, armas, préstamos informales y parecidos.
- Contenido ofensivo, discriminatorio o sexual.
- Fichas de negocios ajenos registradas por alguien sin autorización del negocio: solo lo registra su dueño o alguien con su permiso.
- Fotos que no cumplan las reglas de publicación del directorio.
- Datos falsos, un número de contacto que no es del negocio, o registrar la misma ficha varias veces.

Rechazar no es para siempre: te avisamos por WhatsApp con el motivo y puedes corregir y volver a enviar tu registro. Los datos de los registros rechazados se borran a los 90 días.

## Podemos retirar una ficha

Nos reservamos el derecho de no publicar o de retirar cualquier ficha que rompa estas reglas o que ya no corresponda a un negocio real de Tizayuca. Y si el propio negocio nos pide que la bajemos, la bajamos de inmediato.

## Si ves algo raro

Si encuentras una ficha falsa, un negocio que ya cerró o algo que rompe estas reglas, escríbenos al correo contacto@enmirumbo.com o por WhatsApp al [WHATSAPP DEL DIRECTORIO — completar antes del lanzamiento]. Lo revisamos y actuamos.

## Uso de la información del directorio

Los datos del directorio están para que los vecinos contacten a los negocios uno por uno. Copiarlos de forma masiva —a mano o con programas— para armar otra base de datos, revenderlos o mandar publicidad no está permitido.

## Tus datos personales

Qué datos guardamos, para qué los usamos y qué queda público está explicado en el aviso de privacidad.

Aviso de privacidad

## Cambios a estos términos

Si cambiamos estas reglas, publicamos la versión nueva en esta misma página y actualizamos la fecha de arriba. Seguir usando el sitio después de un cambio significa que lo aceptas.

## Ley aplicable

Estos términos se rigen por las leyes mexicanas. [JURISDICCIÓN PARA CONTROVERSIAS — confirmar en la revisión legal].
```

The standalone line "Aviso de privacidad" is the link to `/aviso-de-privacidad`.

#### Scenario: the published text is the approved one

- **WHEN** what `/terminos` shows is compared with the content of this spec
- **THEN** they match paragraph by paragraph, with no filler text or empty sections

#### Scenario: the terms name the site with the current brand

- **WHEN** the resident reads the opening of the terms, the heading "Qué es enmirumbo" and the disclaimer section
- **THEN** the opening presents the site as "enmirumbo, el directorio de negocios de Tizayuca" and from there on the terms say plain "enmirumbo", without the previous brand and without the locality attached to the name

#### Scenario: plain language in the terms too

- **WHEN** a resident without legal training reads the terms
- **THEN** they understand them: short sentences, second person and no contract paragraph in capital letters or jargon

### Requirement: Visible placeholders and a draft mark while the responsible party's data is missing

Every piece of data that only a person can provide (name or business name of the responsible party, address, the directory's WhatsApp, publication date and jurisdiction) MUST appear on the page as a visible placeholder in square brackets with the indication that it still needs to be filled in, never as an invented datum, a blank space or filler text. While at least one placeholder remains unfilled, both pages MUST show at the top, visibly, the draft mark with the literal text "Ojo: este texto todavía es un borrador. Nos faltan los datos que ves entre corchetes y la revisión legal antes de que el directorio se lance." The pending placeholders MUST be declared in a single place in the code, so that the automated verification can list them and the launch checklist does not depend on someone looking for them by eye.

The directory's email is NO LONGER a placeholder: with the domain purchased, the contact channel and the one for exercising ARCO rights is `contacto@enmirumbo.com` and MUST be published literally in the three places where the text asks for it (the two appearances in the notice —"Quién es responsable de tus datos" and "Tus derechos ARCO"— and the section "Si ves algo raro" of the terms). Publishing an email that nobody monitors would be worse than an honest placeholder: the mailbox MUST exist and receive mail before the text is published. The other data of the responsible party is still pending, so the draft mark **stays**.

The missing data is not the only thing pending before the draft mark is removed. Next to the placeholders, the list of **operational pending items** MUST be declared, in the same module and in the same walkable form, each with the commitment or the processing it refers to, with what the system does today and with the ticket that resolves it, so that the legal review and the launch checklist see them without looking for them by eye. This list is NOT published on the pages: the legal text says what the responsible party commits to do, not the state of the backlog; what the pages MUST NOT do is promise automatisms that do not exist.

A row enters that list for any of these three reasons, not only the first: (a) the published text promises an operation that the system does not yet do on its own; (b) the published text obliges the system to fall short on purpose, so that changing it first is a condition for improving the defense; or (c) the system processes personal data that the published text does not mention. The list MUST reflect the reality of the system at every moment: a row leaves when it stops being true, and enters as soon as it is.

A pending item MUST leave that list **only for the part that the system can really do already, not entirely**, because a launch checklist that lies by omission is worse than one row too many. Of the four letters of ARCO, the panel resolves cancellation and opposition —unpublishing a card and permanently deleting a registration are actions of the panel—, so that part MUST no longer appear as pending; **access and rectification MUST remain declared**, with their ticket, because the notice promises them ("escríbenos y los quitamos", "rectificarlos si están mal") and the panel has no screen to give the business a copy of its data, to correct it or to remove a field from its card: that is still done by hand against the database.

Today the list has **four** rows: (1) access and rectification, which are handled by hand against the database; (2) the notice says the data is processed by "los proveedores que hacen funcionar el sitio (hospedaje y base de datos)" without naming them, and ADR-004 requires naming the processor before launch, something that can only be written when the account exists; (3) the notice says the IP of whoever submits the form is used "por menos de una hora, solo en su memoria" and that "no la guardamos en la base de datos", so the quotas for the public form and for reports stay counting in the memory of each instance —looser than they could be— until the legal review approves another wording; and (4) the notice does not mention that, when submitting the admin panel access form, the system stores a row per attempt with an HMAC of the IP (never the IP) and the time, to stop brute force against the site's only credential. The deletion of rejected registrations at 90 days MUST NOT appear in the list: the system executes it without human intervention.

The published texts of the notice and the terms do not depend on this list and remain true: unpublishing and deletion are executed by hand and at the data subject's request, after the admin verifies ownership via WhatsApp; the data subject still has no "un botón que lo haga solo". The phrase "todo esto lo atendemos a mano, cuando tú lo pides" speaks of what the data subject requests; the deletion of rejected registrations at 90 days is not a request of theirs and the system executes it on its own, so the text promises less than what is met, never more.

Filling in a placeholder of the notice or removing its draft mark changes the published content of the notice and, therefore, MUST release a new version (see the requirement "Changing the notice text without bumping the version breaks the verification"). Not so in the terms, because they are not versioned. Publishing the directory's email is exactly that case, and it traveled in the same version `2` as the brand change.

#### Scenario: the responsible party's address does not exist yet

- **WHEN** the human opens `/aviso-de-privacidad` before the legal review
- **THEN** instead of the address they read "[DOMICILIO DEL RESPONSABLE — completar antes del lanzamiento]", and the same for the responsible party's name and the directory's WhatsApp

#### Scenario: the email is no longer a placeholder

- **WHEN** a business owner looks for where to write to exercise their ARCO rights, or a resident looks for where to report a fake card
- **THEN** they read the email `contacto@enmirumbo.com` written out in full —in both sections of the notice and in "Si ves algo raro" of the terms—, without brackets or the note "completar antes del lanzamiento"

#### Scenario: draft mark visible

- **WHEN** anyone opens either of the two legal pages while there are still unfilled placeholders
- **THEN** they read at the top "Ojo: este texto todavía es un borrador. Nos faltan los datos que ves entre corchetes y la revisión legal antes de que el directorio se lance."

#### Scenario: publishing the email does not remove the draft mark

- **WHEN** the directory's email is published and the responsible party's name, their address, the WhatsApp, the publication date and the jurisdiction are still missing
- **THEN** the two pages keep showing the draft mark, because the legal review and the responsible party's data are still pending

#### Scenario: the pending items are verifiable

- **WHEN** the site's automated verification is run
- **THEN** it can list which placeholders remain unfilled —five, now without the email—, and no legal page contains an invented contact datum or address

#### Scenario: the operational pending items are also declared

- **WHEN** the legal review or the launch checklist review what is missing before the draft mark is removed
- **THEN** they find, next to the placeholder list and in the same module, the four operational pending items —access and rectification in the panel, the name of the processor, the two quotas that stay in memory so as not to make the IP phrase false, and what is stored about whoever tries to enter the panel—, each with its ticket, and none of them appears published on the legal pages

#### Scenario: the ARCO pending item was narrowed, not removed

- **WHEN** the legal review looks in that list for what is missing of the ARCO rights
- **THEN** they read that what is pending are access and rectification —giving the business a copy of its data, correcting it or removing a field from its card—, with the note that unpublishing and deleting are already panel actions, and no pending item still says that unpublishing or deleting is missing

#### Scenario: the purge is no longer a pending item

- **WHEN** the same list is walked
- **THEN** the deletion of the data of rejected registrations at 90 days does not appear, because the system executes it without human intervention

#### Scenario: what the system stores about whoever tries to enter the panel is declared

- **WHEN** the legal review looks in the list for whether the system processes any data that the notice does not mention
- **THEN** they read that, when submitting the `/admin` form, a row per attempt is stored with an HMAC of the IP —never the IP— and the time, with its purpose, its duration and its ticket, so that they can decide whether the notice needs a line

#### Scenario: the legal text does not change because the system releases automatisms

- **WHEN** `/aviso-de-privacidad` and `/terminos` are compared with the approved text in this spec, with the panel already offering unpublish and delete and with the 90-day purge running on its own
- **THEN** they match paragraph by paragraph: they still say that everything is handled by hand and on request, with confirmation within a maximum of 20 business days

### Requirement: The two legal pages are indexable and have their own metadata

`/aviso-de-privacidad` and `/terminos` MUST be indexable: neither MUST declare `noindex` (unlike the search results page and the panel). Each MUST expose its own title and its own description, different from the site's, so that a resident who searches for them reaches the right one.

#### Scenario: no noindex

- **WHEN** the metadata of the two legal pages is reviewed
- **THEN** neither asks search engines not to index it

#### Scenario: own title and description

- **WHEN** one of the two pages is shared or appears in a search engine
- **THEN** its title and description speak of that document and do not repeat the site's

### Requirement: The legal pages are mobile-first Server Components without client JavaScript

The two pages MUST be rendered as Server Components, without declaring `"use client"` and without adding their own client bundles: they are text. They MUST look complete and legible in a 390px viewport without horizontal scroll, with a comfortable reading width on desktop, and every tappable element (the links between documents) MUST measure at least 44px in its smaller dimension.

#### Scenario: they read well on the phone

- **WHEN** the owner opens either of the two pages in a 390px viewport
- **THEN** the text reads in full, without horizontal scroll, and the links can be tapped without surgeon-level precision

#### Scenario: no client JavaScript

- **WHEN** the site is built and the two legal pages are reviewed
- **THEN** neither uses the `"use client"` directive nor adds its own client JavaScript, and its content displays in full with JavaScript disabled

The requirements below state what the texts of version 2 MUST say. Their Spanish wording is in the verbatim blocks of "Full text of the privacy notice (v2)" and "Full text of the terms and conditions (v2)", which replace the two blocks above. The professional legal review before launch (PRD §11) may still change it; a change to the notice releases a new version.

### Requirement: The privacy notice names the processors (v2)

Added in v2 — source: PRD §7, ADR 0018.

The full notice MUST name the processors of the personal data and what each does: Cloudflare (hosting, storage, access control, anti-bot check), Neon (database), Twilio (SMS verification, only when the verification flag is on), Resend (email to the admin) and Umami (analytics). It MUST reference Cloudflare's Turnstile privacy addendum. It MUST NOT keep the generic wording "los proveedores que hacen funcionar el sitio (hospedaje y base de datos)" as the only mention.

#### Scenario: each processor

- **WHEN** the text of the notice is read
- **THEN** it names Cloudflare, Neon, Twilio, Resend and Umami, each with its purpose, and says Twilio is used only when SMS verification is on

#### Scenario: the Turnstile addendum

- **WHEN** the section on the anti-bot check is read
- **THEN** it references Cloudflare's Turnstile privacy addendum

### Requirement: The privacy notice states how the IP address is used (v2)

Added in v2 — source: PRD §7, ADR 0012.

The notice MUST say that the visitor's IP address is used for quotas for less than one hour, only in memory and as a keyed hash, and that it is never written to the database. The wording is subject to legal review.

#### Scenario: the sentence

- **WHEN** the notice is read
- **THEN** it says the IP address is used for less than an hour, only in memory, as a keyed hash, and is never stored in the database

### Requirement: The privacy notice lists the cookies (v2)

Added in v2 — source: PRD §7, ADR 0007, ADR 0010.

The notice MUST list exactly two cookies: the functional cookie that holds only the slug of the chosen locality, and the Cloudflare Access cookie, which exists only on the admin panel. It MUST say that analytics use no cookies.

#### Scenario: the list

- **WHEN** the cookies section of the notice is read
- **THEN** it names the locality cookie with its content (only the slug) and the Access cookie (only in the admin panel), and says analytics use no cookies

### Requirement: The notice states the retention periods (v2)

Added in v2 — source: PRD §4, PRD §7.

The notice MUST state that rejected registrations are deleted after 90 days and that applied, discarded or superseded pending edits, and registrations never verified, are deleted after 30 days.

#### Scenario: the periods

- **WHEN** the retention section of the notice is read
- **THEN** it says 90 days for rejected registrations and 30 days for pending edits and registrations never verified

### Requirement: The notice describes access and rectification served from the panel (v2)

Added in v2 — source: PRD §7.

The notice MUST say that the rights of access, rectification, cancellation and opposition are served from the admin panel (unpublishing, deleting, editing any card and sending a copy of the data by WhatsApp), with a committed response time of 20 working days, and MUST keep `contacto@enmirumbo.com` as the contact for data matters.

#### Scenario: the commitment

- **WHEN** the ARCO rights section of the notice is read
- **THEN** it states the response time of 20 working days and the contact `contacto@enmirumbo.com`

### Requirement: The notice takes a new version with the rebuild, and earlier consents keep their evidence (v2)

Added in v2 — source: PRD §7.

Publishing the text of version 2 of the product MUST release a new notice version with its own cryptographic fingerprint declared in the single place of the code, and the check of "Changing the notice text without bumping the version breaks the verification" MUST keep failing when the text changes without raising the version. Whoever accepted an earlier version keeps that evidence.

The rebuild numbers its notice versions on its own (decision of the product owner, 2026-10-14): its first notice is version `2`, the one the fictitious seed and the registration form name, even though the prototype also published a text it called version `2`. No consent record of the rebuilt database names a version of the prototype, and the prototype's database does not survive the cut-over, so the number points no evidence at two texts. From here on, a version published by the rebuild is never reused.

#### Scenario: new version and fingerprint

- **WHEN** the amended text is published
- **THEN** the declared version is new, its fingerprint matches the text, and the verification passes

#### Scenario: the text changes without the version

- **WHEN** the text is edited and the version is not raised
- **THEN** the verification fails

#### Scenario: earlier evidence

- **WHEN** a business that consented to an earlier version is read
- **THEN** its record still names that earlier version

The fingerprint is the SHA-256 of the versioned content as data (`versionedNoticeContent` in `src/core/legal/version.ts`): one entry per piece, in reading order, each tagged with its role —the simplified notice, the literal of the checkbox, the `h1`, the draft mark while it is published, the last-update line, the introduction, every `h2`, paragraph and list item, and every link with its destination—, with whitespace collapsed the way HTML collapses it. It is neither the source file nor the HTML: reformatting the code, or changing the markup or the styles of the page, does not change it, while changing a word, a punctuation mark, the order of the blocks or where a link leads does. A test MUST check that each legal page publishes exactly that content, so that nothing reaches the page outside the fingerprint. The table of fingerprints lives in `test/scripts/notice-version.test.ts`, next to the verification.

#### Scenario: formatting does not release a version

- **WHEN** the code of the notice is reformatted, or the markup or the styles of the page change, and what the page shows does not
- **THEN** the fingerprint is the same and the verification passes

#### Scenario: nothing is published outside the fingerprint

- **WHEN** the page of the notice renders a text that is not in the versioned content, or leaves one out
- **THEN** the verification fails

### Requirement: The list of operational pending items reflects v2 (v2)

Added in v2 — source: PRD §7, ADR 0010, ADR 0012. Amended on 2026-10-18 by EMR-48: unpublishing and the permanent deletion are actions of the panel, so the first row is about access and rectification alone.

In the list of operational pending items: the row on access and rectification MUST leave once the panel can edit any card and send a copy of the data (the four ARCO rights are then served); the row on the unnamed processors MUST leave once the notice names them; the row on the access attempts stored for the panel MUST leave because the panel has no login of its own and stores no attempts. The row on the quotas that count in memory stays until the legal review approves the wording on the IP address.

#### Scenario: rows that leave

- **WHEN** the list is declared after the v2 features exist and the notice names the processors
- **THEN** it has neither the access-and-rectification row, nor the unnamed-processors row, nor the panel-access-attempts row

#### Scenario: the row that stays

- **WHEN** the list is read
- **THEN** it still declares the row about the IP quotas pending the legal review

While the panel's actions and the quotas do not exist yet, the list (`OPERATIONAL_PENDING_ITEMS` in `src/core/legal/placeholders.ts`, next to the placeholders) has three rows: (1) the ARCO rights the notice says are served from the panel: since F3 (EMR-48) the panel unpublishes a card and deletes it for good, so cancellation and opposition are served from it, as the narrowing of "Visible placeholders and a draft mark while the responsible party's data is missing" asks, while access and rectification are served by hand against the database until F6 (edit any card and send a copy of its data) arrives; (2) the sentence on the IP address, which the quotas must keep true: the search quota (EMR-36) keeps its counters and the key of their codes in the memory of a Durable Object, never in its storage (`deployment`, "Anti-abuse counters live in a Durable Object and never in PostgreSQL (v2)"), and the quotas of the forms and the reports must do the same when they arrive; and (3) the nightly backup of production (`deployment`, "Production is backed up every night to a private bucket (v2)"), which keeps a copy of the database for 30 days that nobody can delete earlier, so a deleted or purged card survives there that long, while the notice says a deletion is permanent and does not mention backups: the legal review decides whether the notice needs a line.

#### Scenario: the backups are declared

- **WHEN** the legal review walks the list
- **THEN** it finds that the nightly backup keeps a copy of production for 30 days, so a deleted card survives there that long, with its ticket

### Requirement: The legal pages are prerendered, belong to no locality and name none (v2)

Added in v2 — source: ADR 0003, decision of the product owner, 2026-10-14 (`base-layout`, "Pages outside a locality name no locality (v2)").

`/aviso-de-privacidad` and `/terminos` MUST live at the site root, outside every locality: every locality links to the same two pages. They MUST be prerendered when the site is built, without reading the database, and served as static assets at their address without a trailing slash (`/aviso-de-privacidad/` redirects to `/aviso-de-privacidad`). They MUST NOT name any locality: not in their text, their title, their description or their footer, which has no line for the neighbours.

Amended on 2026-10-31 (EMR-61) by decision of the product owner: the legal pages stay prerendered and directly reachable at their addresses, with their existing footer links. While no locality is active, the dynamic coming-soon root and root 404 omit legal links from their footer; pages of an active locality show them again.

This amends the parts of this spec that put the locality in the legal texts: the descriptor of both introductions is "enmirumbo, el directorio de negocios locales" (scenarios "the notice names the site with the current brand" and "the terms name the site with the current brand"); the address of the responsible party is its placeholder alone, because it is the address of the responsible party and not of a locality; the sentence on "Cómo llegar" searches "junto con tu colonia, tu municipio y tu estado" (scenario "the address feeds the 'Cómo llegar' button"); "Qué es enmirumbo" says "Es un directorio de negocios y servicios locales, organizado por municipio."; and "Podemos retirar una ficha" speaks of "un negocio real del municipio donde está publicada". The texts are in "Full text of the privacy notice (v2)" and "Full text of the terms and conditions (v2)".

The simplified notice of the registration form lives inside a locality and keeps naming it, read from the locality record ("enmirumbo, el directorio de negocios de {municipio}", `base-layout`, "Every text that names the locality reads it from the locality record (v2)"). The notice version covers its text with the mark `{municipio}`, so every locality accepts the same version.

Prerendered pages are built before the deploy sets `DEPLOY_BRANCH` and `DEPLOY_COMMIT`, so on `dev` they carry no deploy footer. Until the cut-over, the deployed environments give them `X-Robots-Tag: noindex` through the `_headers` file of the build (`base-layout`, "Deployed environments stay out of search engines until the cut-over (v2)"); they declare no `noindex` of their own, so they are indexable once the cut-over lifts it.

#### Scenario: the pages are static

- **WHEN** the site is built
- **THEN** the build writes `aviso-de-privacidad.html` and `terminos.html` among its static assets without reading the database, and `/aviso-de-privacidad` and `/terminos` answer 200 with those files

#### Scenario: no locality named

- **WHEN** either legal page is read, with its title, its description and its footer
- **THEN** no locality is named and the footer has no line for the neighbours, while it keeps the links "Aviso de privacidad" and "Términos y condiciones"

#### Scenario: the simplified notice of a locality

- **WHEN** the simplified notice is shown in the form of a locality
- **THEN** it names the municipality of that locality, and the notice version and its fingerprint are the same in every locality

### Requirement: Full text of the privacy notice (v2)

Added in v2 — source: PRD §7, ADR 0012, ADR 0014, ADR 0018, decision of the product owner, 2026-10-14.

The content published at `/aviso-de-privacidad` MUST be literally the following (the headings marked with `##` are the page's `h2`; the bullets are lists). It is approved content, not free copy: changing it changes this spec and releases a new notice version. It is the prototype's text with the amendments of the requirements marked (v2): the processors by name with the Turnstile addendum, the IP address, the two cookies, the new section "Cuánto tiempo guardamos tus datos", the rights served from the panel, and no locality named. As in "Full privacy notice page at `/aviso-de-privacidad`", the page prepends the version to the last-update line ("Versión 2 · Última actualización: …"). `src/core/legal/privacy-notice.ts` holds it, and a test fails when the module and this block differ.

The deletion at 30 days of registrations never verified (in review and never published) replaces, in v2, the prototype's rule that a registration in review has no purge clock ("The full notice carries the six minimum elements of the LFPDPPP", condition (a), and its scenario "the 90-day period is the one for rejected registrations"); the 90 days remain those of rejected registrations.

```
Aviso de privacidad

Ojo: este texto todavía es un borrador. Nos faltan los datos que ves entre corchetes y la revisión legal antes de que el directorio se lance.

Última actualización: [FECHA DE PUBLICACIÓN]

Este aviso explica, sin rodeos, qué datos nos das cuando registras tu negocio en enmirumbo, el directorio de negocios locales, para qué los usamos, qué queda público y cómo puedes pedirnos que los corrijamos o los borremos.

## Quién es responsable de tus datos

El responsable del directorio enmirumbo y de los datos personales que nos das es [NOMBRE O RAZÓN SOCIAL DEL RESPONSABLE — completar antes del lanzamiento], con domicilio en [DOMICILIO DEL RESPONSABLE — completar antes del lanzamiento].

Para cualquier cosa relacionada con tus datos escríbenos al correo contacto@enmirumbo.com o por WhatsApp al [WHATSAPP DEL DIRECTORIO — completar antes del lanzamiento].

## Qué datos recogemos

Los que tú escribes en el formulario de registro:

- Obligatorios: el nombre de tu negocio, la categoría, tu número de WhatsApp de 10 dígitos y tu colonia.
- Opcionales: qué ofreces, si haces entregas o vas a domicilio, teléfono fijo, dirección o referencias, horario, el link de tu Facebook y, si la subes, una foto de tu negocio.

No te pedimos CURP, RFC, credencial de elector ni datos bancarios. Si nos los mandas por WhatsApp, no los guardamos.

Guardamos también la fecha y la hora en que aceptaste este aviso: es la constancia de que nos diste tu permiso para usar tus datos.

## Para qué usamos tus datos

- Para revisar que tu negocio existe y que el número que registraste es tuyo: te escribimos o te llamamos por WhatsApp antes de publicar.
- Para publicar tu ficha en el directorio, que es a lo que vino todo esto: que los vecinos te encuentren y te contacten.
- Para avisarte cuando publicamos tu ficha, para mandarte su link y para decirte, si fuera el caso, por qué no la publicamos.
- Para contar cuántos negocios se registran y cuántos se publican, en números generales, y saber si el directorio está sirviendo.

No usamos tus datos para publicidad de terceros ni para nada distinto de tener el directorio funcionando.

## Qué queda público y qué no

Cuando aprobamos tu registro, tu ficha se publica y cualquier persona con internet puede verla: el nombre de tu negocio, la categoría, tu colonia, lo que escribiste en "¿Qué ofreces?", tu horario, si haces entregas, el link de tu Facebook y —esto es lo más importante— tu WhatsApp y tu teléfono fijo, con botones para escribirte o marcarte directo. Trátalos como números de contacto de tu negocio: quien sea puede verlos y usarlos.

Publicamos tu colonia, no tu domicilio exacto. Si tú escribes una dirección o referencias en el formulario, eso también se publica tal cual: piénsalo si atiendes desde tu casa.

Esa dirección también alimenta el botón "Cómo llegar" de tu ficha: quien lo toca abre Google Maps en su teléfono, buscando lo que escribiste junto con tu colonia, tu municipio y tu estado.

Si subes una foto de tu negocio, esa foto es pública igual que lo demás. La foto es opcional y debe mostrar tu local, tus productos o tu trabajo: que no salgan personas que se puedan reconocer, porque este aviso cubre tus datos y no la imagen de otras personas. Si una foto no cumple, no la publicamos y te decimos por qué al revisar tu registro. Antes de guardarla la comprimimos y le quitamos los datos ocultos que trae el archivo —como la ubicación GPS de dónde se tomó—: eso no se publica ni se conserva.

Buscadores como Google pueden encontrar tu ficha y mostrarla en sus resultados. Para eso está hecho el directorio.

Lo que nunca se publica: la fecha en que te registraste, las notas internas de la revisión y el motivo por el que, en su caso, no publicamos tu ficha. Eso solo lo ve quien administra el directorio.

## Con quién compartimos tus datos

Con nadie. No vendemos, no rentamos ni intercambiamos tus datos.

Los únicos terceros que participan son los proveedores que hacen funcionar el sitio. Tratan los datos por cuenta nuestra y nada más para lo que hace cada uno:

- Cloudflare: hospeda el sitio y las fotos de los negocios, protege la entrada al panel de quien administra el directorio y revisa, con su herramienta Turnstile, que quien envía un formulario sea una persona y no un programa.
- Neon: guarda la base de datos del directorio.
- Twilio: te manda por SMS un código para confirmar tu número, solo si tenemos encendida esa verificación.
- Resend: manda los correos de aviso que recibe quien administra el directorio.
- Umami: cuenta las visitas al sitio y algunos clics, sin cookies y sin datos que te identifiquen.

La revisión de Turnstile sigue además las reglas de privacidad que Cloudflare publica para esa herramienta:

Anexo de privacidad de Turnstile, de Cloudflare (en inglés)

Solo entregaríamos datos a una autoridad que nos los pida por escrito y conforme a la ley.

## Cuánto tiempo guardamos tus datos

Guardamos los datos de tu ficha mientras esté publicada, y también si la despublicamos, hasta que nos pidas borrarla. En estos casos los borramos de forma definitiva sin que nos lo pidas:

- Si rechazamos tu registro, sus datos se borran a los 90 días.
- Si tu registro se queda en revisión y nunca llegamos a verificarlo y publicarlo, sus datos se borran a los 30 días de que lo enviaste.
- Cuando nos mandas cambios para tu ficha, los guardamos mientras los revisamos. Una vez que los aplicamos o los descartamos, o que los reemplazas con otros más nuevos, se borran a los 30 días.

## Cómo limitar el uso o la divulgación de tus datos

- Dinos qué no quieres publicar: si prefieres que tu teléfono fijo, tu horario o tu dirección no aparezcan en la ficha, escríbenos y los quitamos.
- Pide que despubliquemos tu ficha: en cuanto nos llega tu mensaje la bajamos del directorio, sin trámites ni explicaciones.
- Pide que borremos todo: eliminamos tu registro de forma definitiva, no solo lo escondemos.

Todo esto lo hace a mano quien administra el directorio, desde su panel, cuando tú lo pides: no hay un botón que lo haga solo. Escríbenos por WhatsApp o por correo y te confirmamos que quedó hecho en un máximo de 20 días hábiles.

## Tus derechos ARCO

Tienes derecho a acceder a tus datos, a rectificarlos si están mal, a cancelarlos (que los borremos) y a oponerte a que los usemos. Eso son los derechos ARCO.

Los atiende quien administra el directorio desde su panel: según lo que pidas, te manda por WhatsApp una copia de tus datos, corrige tu ficha, la despublica o la borra de forma definitiva.

Para ejercerlos escríbenos al correo contacto@enmirumbo.com o por WhatsApp al [WHATSAPP DEL DIRECTORIO — completar antes del lanzamiento] y dinos:

- qué quieres: ver tus datos, corregirlos, borrarlos u oponerte a que los usemos;
- el nombre de tu negocio y el número de WhatsApp con el que lo registraste;
- si es una corrección, qué debe decir.

Te contestamos en un máximo de 20 días hábiles y, si tu solicitud procede, la aplicamos en cuanto te respondemos. No cobramos nada por esto.

Como el registro no usa cuentas ni contraseñas, antes de cambiar o borrar algo confirmamos que la solicitud viene del mismo número de WhatsApp con el que se registró el negocio. Es para que nadie más pueda tocar tu ficha.

## Cookies y datos de navegación

El directorio público no usa cookies de publicidad ni rastrea a los vecinos que lo visitan. El sitio usa solo dos cookies:

- La del municipio que eliges en la página de inicio cuando el directorio está en más de un municipio: guarda solo el nombre de ese municipio tal como aparece en la dirección del sitio, para llevarte ahí la próxima vez, y nada más.
- La de Cloudflare Access, que solo existe en el panel de administración: mantiene abierta la sesión de quien administra el directorio.

Umami, la herramienta con la que contamos las visitas, no usa cookies.

Cuando haces una búsqueda o envías un formulario del sitio, el servidor usa tu dirección IP para limitar cuántas veces se puede hacer eso en poco tiempo y así frenar el abuso automatizado. No la usa tal cual: la convierte en un código con una clave secreta, y ese código vive solo en su memoria y por menos de una hora. Ni tu IP ni ese código se escriben nunca en la base de datos, ni se ligan a tu ficha.

## Cambios a este aviso

Si cambiamos este aviso, publicamos la versión nueva en esta misma página y actualizamos la fecha de arriba. Si el cambio es importante —por ejemplo, si empezamos a usar tus datos para algo nuevo—, te avisamos por WhatsApp al número que registraste antes de aplicarlo. Darle una repasada a esta página de vez en cuando es la forma de estar al tanto.

## Si crees que no respetamos tus derechos

Puedes acudir a la Secretaría Anticorrupción y Buen Gobierno, que desde 2025 es la autoridad en materia de protección de datos personales en México.

Términos y condiciones
```

The line "Anexo de privacidad de Turnstile, de Cloudflare (en inglés)" is the link to `https://www.cloudflare.com/turnstile-privacy-policy/`, which opens in a new tab with `rel="noopener noreferrer"`. The last line is the link to `/terminos`.

#### Scenario: the published text is the approved one

- **WHEN** what `/aviso-de-privacidad` shows is compared with this block
- **THEN** they match paragraph by paragraph, apart from the version that the page prepends to the last-update line

#### Scenario: the notice names the site without a locality

- **WHEN** the owner reads the introduction and the section "Quién es responsable de tus datos"
- **THEN** the site is "enmirumbo, el directorio de negocios locales", and the address of the responsible party is its placeholder alone

### Requirement: Full text of the terms and conditions (v2)

Added in v2 — source: decision of the product owner, 2026-10-14.

The content published at `/terminos` MUST be literally the following (the headings marked with `##` are the page's `h2`). It is approved content, not free copy: the prototype's text naming no locality. `src/core/legal/terms.ts` holds it, and a test fails when the module and this block differ.

```
Términos y condiciones

Ojo: este texto todavía es un borrador. Nos faltan los datos que ves entre corchetes y la revisión legal antes de que el directorio se lance.

Última actualización: [FECHA DE PUBLICACIÓN]

Estas son las reglas de enmirumbo, el directorio de negocios locales, para los negocios que se registran y para los vecinos que los buscan. Al usar el sitio o registrar tu negocio, aceptas lo que dice aquí.

## Qué es enmirumbo

Es un directorio de negocios y servicios locales, organizado por municipio. Sirve para dos cosas: que un negocio publique su ficha gratis y que un vecino lo encuentre y le escriba por WhatsApp. Nada más.

No cobramos por registrarse, no vendemos nada, no cobramos comisiones y no hay cuentas ni contraseñas.

## Somos un intermediario informativo, no el negocio

enmirumbo solo muestra información. No prestamos los servicios ni vendemos los productos que aparecen en las fichas.

Cuando le escribes a un negocio por WhatsApp, sales de este sitio. Lo que pase después —el precio, el trabajo, la entrega, el pago, la garantía, los tiempos y cualquier problema— es un trato directo entre tú y ese negocio. enmirumbo no es parte de ese trato, no lo garantiza, no lo supervisa y no responde por él.

Tampoco respondemos por daños, pérdidas o desacuerdos que salgan de un servicio o una compra contratados con alguien que encontraste aquí. Si algo sale mal, resuélvelo con el negocio; y avísanos, porque nos sirve para moderar el directorio.

## Qué verificamos y qué no

Antes de publicar una ficha le escribimos o le llamamos al número registrado para confirmar dos cosas: que el negocio existe y que el número es de quien lo registró. Eso, y nada más que eso, es lo que significa el sello "Negocio verificado".

Lo que no verificamos: la calidad del trabajo, los precios, que el negocio tenga licencias, permisos o seguros, ni que lo que dice su ficha siga siendo cierto con el tiempo. Esa información la escribe cada negocio y es su responsabilidad que sea verdadera y esté al día.

Si un negocio cierra o cambia sus datos y no nos avisa, su ficha puede quedar desactualizada. Avísanos y la corregimos o la bajamos.

## Reglas para registrar un negocio

Revisamos a mano cada registro antes de publicarlo. Rechazamos —o retiramos, si ya estaba publicada— cualquier ficha que caiga en esto:

- Actividades ilegales, o que necesitan una licencia o un permiso que no se pueda demostrar: venta de medicamentos controlados, armas, préstamos informales y parecidos.
- Contenido ofensivo, discriminatorio o sexual.
- Fichas de negocios ajenos registradas por alguien sin autorización del negocio: solo lo registra su dueño o alguien con su permiso.
- Fotos que no cumplan las reglas de publicación del directorio.
- Datos falsos, un número de contacto que no es del negocio, o registrar la misma ficha varias veces.

Rechazar no es para siempre: te avisamos por WhatsApp con el motivo y puedes corregir y volver a enviar tu registro. Los datos de los registros rechazados se borran a los 90 días.

## Podemos retirar una ficha

Nos reservamos el derecho de no publicar o de retirar cualquier ficha que rompa estas reglas o que ya no corresponda a un negocio real del municipio donde está publicada. Y si el propio negocio nos pide que la bajemos, la bajamos de inmediato.

## Si ves algo raro

Si encuentras una ficha falsa, un negocio que ya cerró o algo que rompe estas reglas, escríbenos al correo contacto@enmirumbo.com o por WhatsApp al [WHATSAPP DEL DIRECTORIO — completar antes del lanzamiento]. Lo revisamos y actuamos.

## Uso de la información del directorio

Los datos del directorio están para que los vecinos contacten a los negocios uno por uno. Copiarlos de forma masiva —a mano o con programas— para armar otra base de datos, revenderlos o mandar publicidad no está permitido.

## Tus datos personales

Qué datos guardamos, para qué los usamos y qué queda público está explicado en el aviso de privacidad.

Aviso de privacidad

## Cambios a estos términos

Si cambiamos estas reglas, publicamos la versión nueva en esta misma página y actualizamos la fecha de arriba. Seguir usando el sitio después de un cambio significa que lo aceptas.

## Ley aplicable

Estos términos se rigen por las leyes mexicanas. [JURISDICCIÓN PARA CONTROVERSIAS — confirmar en la revisión legal].
```

The standalone line "Aviso de privacidad" is the link to `/aviso-de-privacidad`.

#### Scenario: the published text is the approved one

- **WHEN** what `/terminos` shows is compared with this block
- **THEN** they match paragraph by paragraph

#### Scenario: the terms name the site without a locality

- **WHEN** the resident reads the opening of the terms and the section "Qué es enmirumbo"
- **THEN** the site is "enmirumbo, el directorio de negocios locales", "un directorio de negocios y servicios locales, organizado por municipio", and no locality is named
