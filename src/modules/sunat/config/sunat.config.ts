import "dotenv/config";
import { prisma } from "../../../data/prisma";
import { decryptSecret, decryptSecretString, isSunatEncryptionConfigured } from "./sunat-crypto";

// Configuracion SUNAT. Fuente de verdad: tabla SunatEmisorConfig (dashboard).
// Fallback a variables de entorno (solo BETA) cuando no hay fila configurada.
export type SunatEnvironment = "BETA" | "PRODUCCION";

export interface SunatConfig {
    environment: SunatEnvironment;
    endpointBill: string; // billService (factura, notas, resumen, baja)
    ruc: string;
    razonSocial: string;
    ubigeo: string; // ubigeo del domicilio fiscal del emisor (catalogo INEI)
    solUser: string;
    solPassword: string;
    // Firma: material del certificado en MEMORIA (preferente, viene de la BD cifrado)
    certP12Der?: Buffer | undefined; // bytes del .pfx ya descifrados
    // Firma: rutas en disco (legacy env, solo dev/beta)
    certP12Path?: string | undefined;
    certP12Password?: string | undefined;
    certPemPath?: string | undefined;
    keyPemPath?: string | undefined;
    signatureId: string;
    allowTestCertificate: boolean;
}

function clean(value: string | undefined): string {
    return value ? value.trim() : "";
}

function isEnabled(value: string | undefined): boolean {
    return ["1", "true", "yes", "si"].includes(clean(value).toLowerCase());
}

const BETA_BILL_ENDPOINT = "https://e-beta.sunat.gob.pe/ol-ti-itcpfegem-beta/billService";
const PRODUCCION_BILL_ENDPOINT = "https://e-factura.sunat.gob.pe/ol-ti-itcpfegem/billService";

export function endpointForEnvironment(environment: SunatEnvironment): string {
    return environment === "PRODUCCION" ? PRODUCCION_BILL_ENDPOINT : BETA_BILL_ENDPOINT;
}

// Config desde variables de entorno. Fallback (solo BETA): nunca lee la BD.
export function resolveSunatConfig(): SunatConfig {
    const ruc = clean(process.env.SUNAT_RUC);
    // RUC de pruebas por defecto (el que usa la documentacion SUNAT).
    const resolvedRuc = /^\d{11}$/.test(ruc) ? ruc : "20100066603";

    return {
        environment: "BETA",
        endpointBill: clean(process.env.SUNAT_BETA_ENDPOINT) || BETA_BILL_ENDPOINT,
        ruc: resolvedRuc,
        razonSocial: clean(process.env.SUNAT_RAZON_SOCIAL) || "EMISOR DEMO SAC",
        ubigeo: /^\d{6}$/.test(clean(process.env.SUNAT_UBIGEO)) ? clean(process.env.SUNAT_UBIGEO) : "150101",
        solUser: clean(process.env.SUNAT_BETA_SOL_USER) || "MODDATOS",
        solPassword: clean(process.env.SUNAT_BETA_SOL_PASSWORD) || "MODDATOS",
        certP12Path: clean(process.env.SUNAT_CERT_P12_PATH) || undefined,
        certP12Password: process.env.SUNAT_CERT_P12_PASSWORD ?? "",
        certPemPath: clean(process.env.SUNAT_CERT_PEM_PATH) || undefined,
        keyPemPath: clean(process.env.SUNAT_KEY_PEM_PATH) || undefined,
        signatureId: clean(process.env.SUNAT_SIGNATURE_ID) || "SignSUNAT",
        // En beta permitimos cert autogenerado si no hay uno configurado.
        allowTestCertificate: isEnabled(process.env.SUNAT_ALLOW_TEST_CERT) || true,
    };
}

// Fila cruda de SunatEmisorConfig (lectura via SQL para no depender del cliente generado).
interface EmisorConfigRow {
    environment: string;
    ruc: string;
    razonSocial: string;
    ubigeo: string;
    solUser: string;
    solPasswordEnc: string | null;
    certP12Enc: string | null;
    certPasswordEnc: string | null;
    signatureId: string;
}

async function fetchActiveEmisorRow(): Promise<EmisorConfigRow | null> {
    try {
        const rows = await prisma.$queryRawUnsafe<EmisorConfigRow[]>(
            `SELECT "environment", "ruc", "razonSocial", "ubigeo", "solUser",
                    "solPasswordEnc", "certP12Enc", "certPasswordEnc", "signatureId"
             FROM "SunatEmisorConfig"
             WHERE "activo" = true
             ORDER BY "id" ASC
             LIMIT 1`,
        );
        return rows[0] ?? null;
    } catch {
        // Tabla aun no creada (bootstrap no corrido) -> usar fallback env.
        return null;
    }
}

// Config efectiva: BD (si hay emisor activo) sobre fallback de env. Async.
// No rompe BETA: sin fila activa devuelve exactamente resolveSunatConfig().
export async function loadSunatConfig(): Promise<SunatConfig> {
    const envConfig = resolveSunatConfig();
    const row = await fetchActiveEmisorRow();
    if (!row) return envConfig;

    const environment: SunatEnvironment = row.environment === "PRODUCCION" ? "PRODUCCION" : "BETA";
    const canDecrypt = isSunatEncryptionConfigured();

    let solPassword = envConfig.solPassword;
    let certP12Der: Buffer | undefined;
    let certP12Password: string | undefined;

    if (canDecrypt) {
        if (row.solPasswordEnc) solPassword = decryptSecretString(row.solPasswordEnc);
        if (row.certP12Enc) certP12Der = decryptSecret(row.certP12Enc);
        if (row.certPasswordEnc) certP12Password = decryptSecretString(row.certPasswordEnc);
    } else {
        console.warn(
            "[SUNAT] SUNAT_CONFIG_ENC_KEY no configurada: se ignoran secretos cifrados del emisor y se usa el fallback de env.",
        );
    }

    return {
        environment,
        endpointBill: endpointForEnvironment(environment),
        ruc: /^\d{11}$/.test(clean(row.ruc)) ? row.ruc : envConfig.ruc,
        razonSocial: clean(row.razonSocial) || envConfig.razonSocial,
        ubigeo: /^\d{6}$/.test(clean(row.ubigeo)) ? row.ubigeo : envConfig.ubigeo,
        solUser: clean(row.solUser) || envConfig.solUser,
        solPassword,
        certP12Der,
        certP12Password,
        signatureId: clean(row.signatureId) || envConfig.signatureId,
        // En PRODUCCION nunca autofirmar: exige cert real. En BETA se permite.
        allowTestCertificate: environment === "BETA",
    };
}
