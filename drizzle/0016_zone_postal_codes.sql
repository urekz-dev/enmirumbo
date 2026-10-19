-- EMR-74 (ADR 0006). Postal codes. The registration and edit forms ask for
-- the business's postal code and narrow the zones they offer to that postal
-- code's, so a zone carries its postal code, and a business and its pending
-- edit store the one the owner typed (never shown on a public page).
-- Additive: three nullable columns, each with a CHECK of five digits, which
-- every existing row meets; a card or an edit saved before keeps none, and so
-- does a zone the admin added before zones had one.
--
-- Then the data: the postal code of each of the 105 zones of Tizayuca,
-- Hidalgo (locality 13069), from SEPOMEX's postal catalogue, the same source
-- as drizzle/0006_tizayuca_zones.sql. Each zone of that migration matched
-- exactly one settlement of the catalogue by its name, its settlement type
-- and its municipality (Tizayuca, Hidalgo), with no zone left over; the zones
-- are named here by their slug, which never changes. Postal codes are
-- SEPOMEX's (d_codigo).
-- Fuente: Servicio Postal Mexicano (Correos de México), Catálogo Nacional de Códigos Postales, última actualización 2026-10-17.
-- https://www.correosdemexico.gob.mx/SSLServicios/ConsultaCP/CodigoPostal_Exportar.aspx
ALTER TABLE "zones" ADD COLUMN "postal_code" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "postal_code" text;--> statement-breakpoint
ALTER TABLE "pending_edits" ADD COLUMN "postal_code" text;--> statement-breakpoint
ALTER TABLE "zones" ADD CONSTRAINT "zones_postal_code_check" CHECK ("zones"."postal_code" ~ '^[0-9]{5}$');--> statement-breakpoint
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_postal_code_check" CHECK ("businesses"."postal_code" ~ '^[0-9]{5}$');--> statement-breakpoint
ALTER TABLE "pending_edits" ADD CONSTRAINT "pending_edits_postal_code_check" CHECK ("pending_edits"."postal_code" ~ '^[0-9]{5}$');--> statement-breakpoint
UPDATE "zones" SET "postal_code" = "tizayuca"."postal_code" FROM (VALUES
  ('abeto-lifestyle', '43815'),
  ('accordia', '43802'),
  ('ampliacion-el-carmen', '43815'),
  ('ampliacion-emiliano-zapata', '43810'),
  ('ampliacion-felipe-reyes', '43815'),
  ('ampliacion-lazaro-cardenas', '43806'),
  ('ampliacion-residencial-san-angel', '43803'),
  ('andalucia-residencial', '43825'),
  ('arboledas', '43808'),
  ('atempa', '43808'),
  ('bicentenario', '43815'),
  ('bosques-de-ibiza', '43815'),
  ('campestre', '43808'),
  ('city', '43806'),
  ('ciudad-de-los-ninos-rosas-rojas', '43802'),
  ('ciudad-natura-tizayuca', '43817'),
  ('ciudad-natura-tizayuca-ii', '43816'),
  ('colonia-el-carmen', '43815'),
  ('ctm', '43804'),
  ('cuenca-lechera', '43804'),
  ('cuxtitla', '43803'),
  ('deportiva', '43802'),
  ('don-carlos', '43810'),
  ('don-carlos-2da-seccion', '43810'),
  ('el-arenal', '43807'),
  ('el-carmen-ii', '43815'),
  ('el-cid', '43810'),
  ('el-paraiso', '43815'),
  ('el-pedregal', '43802'),
  ('el-sitio', '43807'),
  ('emiliano-zapata', '43810'),
  ('ex-presidentes-municipales', '43810'),
  ('felipe-reyes', '43815'),
  ('florencia', '43806'),
  ('fraccionamiento-el-carmen', '43815'),
  ('fraccionamiento-el-manantial', '43824'),
  ('fuentes-de-tizayuca', '43816'),
  ('fuentes-de-tizayuca-ii', '43816'),
  ('fuentes-del-valle', '43806'),
  ('geo-villas', '43806'),
  ('hacienda-de-guadalupe', '43810'),
  ('hacienda-las-torres', '43802'),
  ('haciendas-de-tizayuca', '43815'),
  ('huicalco', '43808'),
  ('huitzila', '43820'),
  ('ignacio-zaragoza-mogotes', '43824'),
  ('jardines-de-tizayuca-i', '43803'),
  ('jardines-de-tizayuca-ii', '43803'),
  ('jose-humberto-gutierrez-corona', '43816'),
  ('joyas-de-tizayuca', '43807'),
  ('la-canada', '43803'),
  ('la-escondida', '43815'),
  ('la-ilusion-la-casa-del-manantial', '43824'),
  ('la-joya', '43820'),
  ('la-mina', '43815'),
  ('la-posta', '43824'),
  ('la-pradera', '43807'),
  ('las-campanas', '43806'),
  ('las-maravillas-del-angel', '43810'),
  ('las-margaritas', '43815'),
  ('las-plazas', '43810'),
  ('lazaro-cardenas', '43806'),
  ('lisboa', '43803'),
  ('loma-bonita', '43810'),
  ('lomas-de-tizayuca', '43807'),
  ('lomas-del-real', '43815'),
  ('los-almendros', '43803'),
  ('los-heroes-tizayuca', '43816'),
  ('los-pinos', '43815'),
  ('marbella', '43823'),
  ('maria-candelaria', '43824'),
  ('monarca', '43816'),
  ('nacozari', '43803'),
  ('nuevo-tizayuca', '43806'),
  ('olmos', '43825'),
  ('paseos-del-pedregal', '43815'),
  ('pedregal-de-tizayuca', '43803'),
  ('pintores-antorchistas', '43810'),
  ('privada-diamante', '43803'),
  ('pueblo-el-chopo', '43824'),
  ('quinta-esperanza', '43808'),
  ('quintas-de-tizayuca', '43808'),
  ('rancho-don-antonio', '43810'),
  ('rancho-el-chopo', '43817'),
  ('rancho-el-manantial', '43824'),
  ('rancho-la-purisima', '43803'),
  ('real-de-san-jeronimo', '43808'),
  ('residencial-las-palmas', '43815'),
  ('rincon-de-tizayuca', '43815'),
  ('rojo-gomez', '43804'),
  ('san-angel', '43803'),
  ('san-antonio', '43803'),
  ('san-isidro', '43817'),
  ('san-jose', '43803'),
  ('tepeyac', '43804'),
  ('tepojaco', '43823'),
  ('tizara-town', '43816'),
  ('tizayuca-centro', '43800'),
  ('unidad-deportiva', '43802'),
  ('unidad-habitacional-tizayuca', '43806'),
  ('valle-de-tizayuca', '43815'),
  ('villa-los-milagros', '43810'),
  ('villa-magna', '43806'),
  ('vista-hermosa', '43823'),
  ('zona-industrial-tizayuca', '43804')
) AS "tizayuca" ("slug", "postal_code")
WHERE "zones"."locality_code" = '13069' AND "zones"."slug" = "tizayuca"."slug";
