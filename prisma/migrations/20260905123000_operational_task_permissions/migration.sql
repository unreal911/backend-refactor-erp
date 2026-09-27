-- Permisos operativos para la bandeja de tareas y pertenencia por sede.
INSERT INTO "Permission" ("code", "name", "module", "description", "isActive", "createdAt", "updatedAt")
VALUES
    ('tasks.view.own', 'Ver tareas propias', 'tasks', 'Permite consultar las tareas operativas asignadas al usuario', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('tasks.view.all', 'Ver todas las tareas', 'tasks', 'Permite supervisar las tareas operativas de la empresa', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('tasks.assign', 'Asignar tareas', 'tasks', 'Permite asignar tareas operativas a usuarios', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('tasks.reassign', 'Reasignar tareas', 'tasks', 'Permite cambiar al responsable de una tarea operativa', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('tasks.override_store', 'Asignar fuera de sede', 'tasks', 'Permite confirmar excepcionalmente una tarea para un usuario sin asignación vigente en la sede', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('store_assignments.view', 'Ver asignaciones de sede', 'stores', 'Permite consultar las sedes habilitadas para cada usuario', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('store_assignments.manage', 'Gestionar asignaciones de sede', 'stores', 'Permite crear y finalizar asignaciones principales, temporales o de apoyo', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO UPDATE
SET "name" = EXCLUDED."name",
    "module" = EXCLUDED."module",
    "description" = EXCLUDED."description",
    "isActive" = true,
    "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "RolePermission" ("roleId", "permissionId", "createdAt")
SELECT role_row."id", permission_row."id", CURRENT_TIMESTAMP
FROM "Role" role_row
JOIN "Permission" permission_row ON permission_row."code" = ANY (
    CASE upper(role_row."name")
        WHEN 'MANAGER' THEN ARRAY[
            'tasks.view.own', 'tasks.view.all', 'tasks.assign', 'tasks.reassign',
            'tasks.override_store', 'store_assignments.view', 'store_assignments.manage'
        ]::text[]
        WHEN 'SELLER' THEN ARRAY['tasks.view.own']::text[]
        WHEN 'WAREHOUSE' THEN ARRAY['tasks.view.own', 'store_assignments.view']::text[]
        WHEN 'PICKER' THEN ARRAY['tasks.view.own']::text[]
        WHEN 'USER' THEN ARRAY['tasks.view.own']::text[]
        ELSE ARRAY[]::text[]
    END
)
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
