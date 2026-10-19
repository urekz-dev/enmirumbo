-- Custom migration (ADR 0021), EMR-52: the permission to manage the zones of
-- a locality now also adds zones from the panel (docs/specs/admin-review.md,
-- "The admin can add a zone to a locality (v2)"), so its description says so.
-- The catalogue stays the same as PERMISSIONS in src/core/access/permissions.ts;
-- test/worker/access.test.ts compares them.
UPDATE "permissions" SET "description" = 'Agregar, ocultar y renombrar colonias' WHERE "key" = 'zones.manage';
