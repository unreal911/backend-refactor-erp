-- TEN-008: el runtime tenant necesita resolver identidad y RBAC globales
-- mientras las entidades empresariales permanecen protegidas por RLS.

GRANT SELECT, INSERT, UPDATE, DELETE
    ON TABLE "User", "Role", "Permission", "RolePermission"
    TO "tienda_tenant_app";
