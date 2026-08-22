-- MIG-005: después de conciliar los saldos heredados, PostgreSQL certifica las
-- restricciones que hasta ahora protegían solo escrituras nuevas.

ALTER TABLE "Inventory"
    VALIDATE CONSTRAINT "Inventory_stock_nonneg_check";
ALTER TABLE "Inventory"
    VALIDATE CONSTRAINT "Inventory_reserved_range_check";

COMMENT ON TABLE "Inventory" IS
    'Saldo físico y reservado por tienda/variante, aislado y validado por tenant.';
