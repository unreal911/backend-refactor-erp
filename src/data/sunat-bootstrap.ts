import { prisma } from "./prisma";

// Crea de forma idempotente las tablas SUNAT (facturacion electronica).
// Mantener sincronizado con los modelos de prisma/schema.prisma.
const SUNAT_SCHEMA_STATEMENTS: string[] = [
    `DO $$ BEGIN
        CREATE TYPE "ComprobanteTipo" AS ENUM ('FACTURA', 'BOLETA', 'NOTA_CREDITO', 'NOTA_DEBITO');
    EXCEPTION WHEN duplicate_object THEN null; END $$`,
    `DO $$ BEGIN
        CREATE TYPE "ComprobanteEstado" AS ENUM ('BORRADOR', 'ENVIADO', 'ACEPTADO', 'ACEPTADO_CON_OBSERVACIONES', 'RECHAZADO', 'ANULADO', 'ERROR');
    EXCEPTION WHEN duplicate_object THEN null; END $$`,
    `DO $$ BEGIN
        CREATE TYPE "SunatDispatchStatus" AS ENUM ('SIMULATED', 'PENDING', 'ACCEPTED', 'ACCEPTED_WITH_OBSERVATIONS', 'REJECTED', 'ERROR');
    EXCEPTION WHEN duplicate_object THEN null; END $$`,
    `CREATE TABLE IF NOT EXISTS "ComprobanteSerie" (
        "id" SERIAL NOT NULL,
        "tipo" "ComprobanteTipo" NOT NULL,
        "serie" TEXT NOT NULL,
        "correlativo" INTEGER NOT NULL DEFAULT 0,
        "storeId" INTEGER,
        "isActive" BOOLEAN NOT NULL DEFAULT true,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "ComprobanteSerie_pkey" PRIMARY KEY ("id")
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "ComprobanteSerie_tipo_serie_key" ON "ComprobanteSerie"("tipo", "serie")`,
    `CREATE INDEX IF NOT EXISTS "ComprobanteSerie_storeId_idx" ON "ComprobanteSerie"("storeId")`,
    `CREATE TABLE IF NOT EXISTS "Comprobante" (
        "id" SERIAL NOT NULL,
        "tipo" "ComprobanteTipo" NOT NULL,
        "tipoCodigo" TEXT NOT NULL,
        "serie" TEXT NOT NULL,
        "numero" INTEGER NOT NULL,
        "nombreArchivo" TEXT NOT NULL,
        "estado" "ComprobanteEstado" NOT NULL DEFAULT 'BORRADOR',
        "emisorRuc" TEXT NOT NULL,
        "emisorRazonSocial" TEXT NOT NULL,
        "clienteTipoDoc" TEXT NOT NULL,
        "clienteNumDoc" TEXT NOT NULL,
        "clienteNombre" TEXT NOT NULL,
        "moneda" TEXT NOT NULL DEFAULT 'PEN',
        "fechaEmision" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "totalGravado" DECIMAL(12,2) NOT NULL DEFAULT 0,
        "totalExonerado" DECIMAL(12,2) NOT NULL DEFAULT 0,
        "totalInafecto" DECIMAL(12,2) NOT NULL DEFAULT 0,
        "totalGratuito" DECIMAL(12,2) NOT NULL DEFAULT 0,
        "totalIgv" DECIMAL(12,2) NOT NULL DEFAULT 0,
        "totalIsc" DECIMAL(12,2) NOT NULL DEFAULT 0,
        "totalOtrosTributos" DECIMAL(12,2) NOT NULL DEFAULT 0,
        "totalDescuentos" DECIMAL(12,2) NOT NULL DEFAULT 0,
        "totalValorVenta" DECIMAL(12,2) NOT NULL DEFAULT 0,
        "totalPrecioVenta" DECIMAL(12,2) NOT NULL DEFAULT 0,
        "leyendaMontoLetras" TEXT NOT NULL,
        "motivoNota" TEXT,
        "motivoNotaCodigo" TEXT,
        "comprobanteAfectadoId" INTEGER,
        "orderId" INTEGER,
        "serieRefId" INTEGER,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "Comprobante_pkey" PRIMARY KEY ("id")
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "Comprobante_nombreArchivo_key" ON "Comprobante"("nombreArchivo")`,
    `CREATE INDEX IF NOT EXISTS "Comprobante_orderId_idx" ON "Comprobante"("orderId")`,
    `CREATE INDEX IF NOT EXISTS "Comprobante_estado_idx" ON "Comprobante"("estado")`,
    `CREATE INDEX IF NOT EXISTS "Comprobante_tipo_fechaEmision_idx" ON "Comprobante"("tipo", "fechaEmision")`,
    `CREATE TABLE IF NOT EXISTS "ComprobanteItem" (
        "id" SERIAL NOT NULL,
        "linea" INTEGER NOT NULL,
        "codigoProducto" TEXT,
        "descripcion" TEXT NOT NULL,
        "unidadMedida" TEXT NOT NULL DEFAULT 'NIU',
        "cantidad" DECIMAL(12,3) NOT NULL,
        "valorUnitario" DECIMAL(12,6) NOT NULL,
        "precioUnitario" DECIMAL(12,6) NOT NULL,
        "valorVenta" DECIMAL(12,2) NOT NULL,
        "descuento" DECIMAL(12,2) NOT NULL DEFAULT 0,
        "afectacionIgvCodigo" TEXT NOT NULL DEFAULT '10',
        "igv" DECIMAL(12,2) NOT NULL DEFAULT 0,
        "isc" DECIMAL(12,2) NOT NULL DEFAULT 0,
        "comprobanteId" INTEGER NOT NULL,
        CONSTRAINT "ComprobanteItem_pkey" PRIMARY KEY ("id")
    )`,
    `CREATE INDEX IF NOT EXISTS "ComprobanteItem_comprobanteId_idx" ON "ComprobanteItem"("comprobanteId")`,
    `CREATE TABLE IF NOT EXISTS "SunatDispatch" (
        "id" SERIAL NOT NULL,
        "environment" TEXT NOT NULL DEFAULT 'BETA',
        "endpoint" TEXT NOT NULL,
        "fileName" TEXT NOT NULL,
        "metodo" TEXT NOT NULL DEFAULT 'sendBill',
        "documentTypeCode" TEXT NOT NULL,
        "status" "SunatDispatchStatus" NOT NULL,
        "ticket" TEXT,
        "cdrCode" TEXT,
        "cdrDescription" TEXT,
        "cdrNotes" TEXT[] DEFAULT ARRAY[]::TEXT[],
        "faultCode" TEXT,
        "faultString" TEXT,
        "xmlBase64" TEXT,
        "cdrZipBase64" TEXT,
        "rawResponseXml" TEXT,
        "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "comprobanteId" INTEGER NOT NULL,
        CONSTRAINT "SunatDispatch_pkey" PRIMARY KEY ("id")
    )`,
    `CREATE INDEX IF NOT EXISTS "SunatDispatch_comprobanteId_idx" ON "SunatDispatch"("comprobanteId")`,
    `CREATE INDEX IF NOT EXISTS "SunatDispatch_status_idx" ON "SunatDispatch"("status")`,
    `CREATE TABLE IF NOT EXISTS "ResumenDiario" (
        "id" SERIAL NOT NULL,
        "correlativo" INTEGER NOT NULL,
        "fechaReferencia" DATE NOT NULL,
        "fechaGeneracion" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "fileName" TEXT NOT NULL,
        "environment" TEXT NOT NULL DEFAULT 'BETA',
        "endpoint" TEXT NOT NULL,
        "status" "SunatDispatchStatus" NOT NULL DEFAULT 'PENDING',
        "ticket" TEXT,
        "cdrCode" TEXT,
        "cdrDescription" TEXT,
        "cdrNotes" TEXT[] DEFAULT ARRAY[]::TEXT[],
        "faultCode" TEXT,
        "faultString" TEXT,
        "xmlBase64" TEXT,
        "cdrZipBase64" TEXT,
        "rawResponseXml" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "ResumenDiario_pkey" PRIMARY KEY ("id")
    )`,
    `ALTER TABLE "ResumenDiario" ADD COLUMN IF NOT EXISTS "esAnulacion" BOOLEAN NOT NULL DEFAULT false`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "ResumenDiario_fileName_key" ON "ResumenDiario"("fileName")`,
    `CREATE INDEX IF NOT EXISTS "ResumenDiario_status_idx" ON "ResumenDiario"("status")`,
    `CREATE INDEX IF NOT EXISTS "ResumenDiario_fechaReferencia_idx" ON "ResumenDiario"("fechaReferencia")`,
    `ALTER TABLE "Comprobante" ADD COLUMN IF NOT EXISTS "resumenDiarioId" INTEGER`,
    `CREATE INDEX IF NOT EXISTS "Comprobante_resumenDiarioId_idx" ON "Comprobante"("resumenDiarioId")`,
    `CREATE TABLE IF NOT EXISTS "ComunicacionBaja" (
        "id" SERIAL NOT NULL,
        "correlativo" INTEGER NOT NULL,
        "fechaReferencia" DATE NOT NULL,
        "fechaGeneracion" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "fileName" TEXT NOT NULL,
        "environment" TEXT NOT NULL DEFAULT 'BETA',
        "endpoint" TEXT NOT NULL,
        "status" "SunatDispatchStatus" NOT NULL DEFAULT 'PENDING',
        "ticket" TEXT,
        "cdrCode" TEXT,
        "cdrDescription" TEXT,
        "cdrNotes" TEXT[] DEFAULT ARRAY[]::TEXT[],
        "faultCode" TEXT,
        "faultString" TEXT,
        "xmlBase64" TEXT,
        "cdrZipBase64" TEXT,
        "rawResponseXml" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "ComunicacionBaja_pkey" PRIMARY KEY ("id")
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "ComunicacionBaja_fileName_key" ON "ComunicacionBaja"("fileName")`,
    `CREATE INDEX IF NOT EXISTS "ComunicacionBaja_status_idx" ON "ComunicacionBaja"("status")`,
    `CREATE INDEX IF NOT EXISTS "ComunicacionBaja_fechaReferencia_idx" ON "ComunicacionBaja"("fechaReferencia")`,
    `ALTER TABLE "Comprobante" ADD COLUMN IF NOT EXISTS "comunicacionBajaId" INTEGER`,
    `ALTER TABLE "Comprobante" ADD COLUMN IF NOT EXISTS "motivoBaja" TEXT`,
    `CREATE INDEX IF NOT EXISTS "Comprobante_comunicacionBajaId_idx" ON "Comprobante"("comunicacionBajaId")`,
    // Foreign keys (idempotentes)
    `DO $$ BEGIN
        ALTER TABLE "ComprobanteSerie" ADD CONSTRAINT "ComprobanteSerie_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    EXCEPTION WHEN duplicate_object THEN null; END $$`,
    `DO $$ BEGIN
        ALTER TABLE "Comprobante" ADD CONSTRAINT "Comprobante_comprobanteAfectadoId_fkey" FOREIGN KEY ("comprobanteAfectadoId") REFERENCES "Comprobante"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    EXCEPTION WHEN duplicate_object THEN null; END $$`,
    `DO $$ BEGIN
        ALTER TABLE "Comprobante" ADD CONSTRAINT "Comprobante_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    EXCEPTION WHEN duplicate_object THEN null; END $$`,
    `DO $$ BEGIN
        ALTER TABLE "Comprobante" ADD CONSTRAINT "Comprobante_serieRefId_fkey" FOREIGN KEY ("serieRefId") REFERENCES "ComprobanteSerie"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    EXCEPTION WHEN duplicate_object THEN null; END $$`,
    `DO $$ BEGIN
        ALTER TABLE "ComprobanteItem" ADD CONSTRAINT "ComprobanteItem_comprobanteId_fkey" FOREIGN KEY ("comprobanteId") REFERENCES "Comprobante"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    EXCEPTION WHEN duplicate_object THEN null; END $$`,
    `DO $$ BEGIN
        ALTER TABLE "SunatDispatch" ADD CONSTRAINT "SunatDispatch_comprobanteId_fkey" FOREIGN KEY ("comprobanteId") REFERENCES "Comprobante"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    EXCEPTION WHEN duplicate_object THEN null; END $$`,
    `DO $$ BEGIN
        ALTER TABLE "Comprobante" ADD CONSTRAINT "Comprobante_resumenDiarioId_fkey" FOREIGN KEY ("resumenDiarioId") REFERENCES "ResumenDiario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    EXCEPTION WHEN duplicate_object THEN null; END $$`,
    `DO $$ BEGIN
        ALTER TABLE "Comprobante" ADD CONSTRAINT "Comprobante_comunicacionBajaId_fkey" FOREIGN KEY ("comunicacionBajaId") REFERENCES "ComunicacionBaja"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    EXCEPTION WHEN duplicate_object THEN null; END $$`,
    // Configuracion del emisor SUNAT (1 fila por instalacion; secretos cifrados AES-256-GCM).
    `CREATE TABLE IF NOT EXISTS "SunatEmisorConfig" (
        "id" SERIAL NOT NULL,
        "environment" TEXT NOT NULL DEFAULT 'BETA',
        "ruc" TEXT NOT NULL DEFAULT '',
        "razonSocial" TEXT NOT NULL DEFAULT '',
        "nombreComercial" TEXT,
        "ubigeo" TEXT NOT NULL DEFAULT '',
        "direccion" TEXT,
        "tipoOperacion" TEXT,
        "regimen" TEXT,
        "solUser" TEXT NOT NULL DEFAULT '',
        "solPasswordEnc" TEXT,
        "certP12Enc" TEXT,
        "certPasswordEnc" TEXT,
        "certSubjectCN" TEXT,
        "certNotAfter" TIMESTAMP(3),
        "signatureId" TEXT NOT NULL DEFAULT 'SignSUNAT',
        "activo" BOOLEAN NOT NULL DEFAULT false,
        "updatedById" INTEGER,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "SunatEmisorConfig_pkey" PRIMARY KEY ("id")
    )`,
];

export async function ensureSunatSchema(): Promise<void> {
    for (const statement of SUNAT_SCHEMA_STATEMENTS) {
        await prisma.$executeRawUnsafe(statement);
    }
}
