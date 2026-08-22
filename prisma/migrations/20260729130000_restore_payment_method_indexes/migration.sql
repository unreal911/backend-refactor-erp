-- Completa la formalización del bootstrap de métodos de pago.
-- Una migración histórica eliminó estos índices y el arranque los recreaba,
-- por lo que una base vacía difería de la base heredada.
CREATE INDEX IF NOT EXISTS "PaymentMethod_isActive_idx"
    ON "PaymentMethod"("isActive");

CREATE INDEX IF NOT EXISTS "PaymentMethod_displayOrder_idx"
    ON "PaymentMethod"("displayOrder");
