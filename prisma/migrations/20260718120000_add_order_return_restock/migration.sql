-- Devolucion con merma: flag para NO reponer stock (mercaderia inservible).
-- Default true = comportamiento actual (repone). false = merma.
ALTER TABLE "OrderReturn" ADD COLUMN "restock" BOOLEAN NOT NULL DEFAULT true;
