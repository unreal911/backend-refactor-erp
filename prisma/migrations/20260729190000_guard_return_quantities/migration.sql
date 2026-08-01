-- MIG-008: las devoluciones nuevas deben conservar cantidades e importes
-- reconciliables. La línea base no contiene devoluciones heredadas inválidas.
ALTER TABLE "OrderItem"
    ADD CONSTRAINT "OrderItem_returned_quantity_check"
    CHECK (
        "returnedQuantity" >= 0
        AND "returnedQuantity" <= GREATEST(0, "quantity" - "shortageQuantity")
    ) NOT VALID;

ALTER TABLE "OrderReturn"
    ADD CONSTRAINT "OrderReturn_totals_check"
    CHECK (
        LENGTH(BTRIM("reason")) > 0
        AND "totalQuantity" > 0
        AND "totalAmount" >= 0
    ) NOT VALID;

ALTER TABLE "OrderReturnItem"
    ADD CONSTRAINT "OrderReturnItem_amounts_check"
    CHECK (
        "quantity" > 0
        AND "unitPrice" >= 0
        AND "subtotal" = "unitPrice" * "quantity"
    ) NOT VALID;

ALTER TABLE "OrderItem"
    VALIDATE CONSTRAINT "OrderItem_returned_quantity_check";
ALTER TABLE "OrderReturn"
    VALIDATE CONSTRAINT "OrderReturn_totals_check";
ALTER TABLE "OrderReturnItem"
    VALIDATE CONSTRAINT "OrderReturnItem_amounts_check";

COMMENT ON CONSTRAINT "OrderItem_returned_quantity_check" ON "OrderItem" IS
    'MIG-008: impide devolver más unidades que las entregadas.';
COMMENT ON CONSTRAINT "OrderReturn_totals_check" ON "OrderReturn" IS
    'MIG-008: exige motivo, cantidad positiva e importe no negativo.';
COMMENT ON CONSTRAINT "OrderReturnItem_amounts_check" ON "OrderReturnItem" IS
    'MIG-008: exige cantidad positiva y subtotal consistente.';
