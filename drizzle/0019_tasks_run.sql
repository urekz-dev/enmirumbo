-- EMR-54: only the system super admin inherits this new global permission.
-- Its all_permissions flag includes new catalogue entries automatically;
-- no other base role receives an explicit grant.
INSERT INTO "permissions" ("key", "description")
VALUES ('tasks.run', 'Correr tareas programadas a mano');
