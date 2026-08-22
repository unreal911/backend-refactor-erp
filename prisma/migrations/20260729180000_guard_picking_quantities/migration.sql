-- La fila heredada PickingItem#8 excede quantity y se conserva como evidencia.
-- NOT VALID evita reescribirla, pero protege todo INSERT/UPDATE nuevo.
ALTER TABLE "PickingItem"
    ADD CONSTRAINT "PickingItem_quantity_bounds_check"
    CHECK (
        "quantity" > 0
        AND "pickedQuantity" >= 0
        AND "pickedQuantity" <= "quantity"
    ) NOT VALID;

COMMENT ON CONSTRAINT "PickingItem_quantity_bounds_check" ON "PickingItem" IS
    'MIG-007: protege filas nuevas; PickingItem#8 permanece en cuarentena histórica hasta MIG-011.';
