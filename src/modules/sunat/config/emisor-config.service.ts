import forge from "node-forge";
import { prisma } from "../../../data/prisma";
import { CustomError } from "../../../domain/errors/custom.error";
import { AuthService } from "../../../presentation/services/auth.service";
import { SunatSoapClient } from "../soap/sunat-soap.client";
import {
    endpointForEnvironment,
    loadSunatConfig,
    SunatEnvironment,
} from "./sunat.config";
import { decryptSecretString, encryptSecret, isSunatEncryptionConfigured } from "./sunat-crypto";

// Fila cruda (lectura via SQL para no depender del cliente Prisma generado).
interface EmisorRow {
    id: number;
    environment: string;
    ruc: string;
    razonSocial: string;
    nombreComercial: string | null;
    ubigeo: string;
    direccion: string | null;
    tipoOperacion: string | null;
    regimen: string | null;
    solUser: string;
    solPasswordEnc: string | null;
    certP12Enc: string | null;
    certPasswordEnc: string | null;
    certSubjectCN: string | null;
    certNotAfter: Date | null;
    signatureId: string;
    activo: boolean;
    updatedById: number | null;
    updatedAt: Date;
}

// Vista enmascarada para el dashboard: NUNCA expone secretos.
export interface EmisorConfigView {
    configured: boolean;
    encryptionConfigured: boolean;
    environment: SunatEnvironment;
    ruc: string;
    razonSocial: string;
    nombreComercial: string | null;
    ubigeo: string;
    direccion: string | null;
    tipoOperacion: string | null;
    regimen: string | null;
    solUser: string;
    signatureId: string;
    hasSolPassword: boolean;
    hasCertificate: boolean;
    certSubjectCN: string | null;
    certNotAfter: Date | null;
    certExpired: boolean;
    updatedById: number | null;
    updatedAt: Date;
}

export interface UpdateEmisorInput {
    environment?: string | undefined;
    ruc?: string | undefined;
    razonSocial?: string | undefined;
    nombreComercial?: string | null | undefined;
    ubigeo?: string | undefined;
    direccion?: string | null | undefined;
    tipoOperacion?: string | null | undefined;
    regimen?: string | null | undefined;
    solUser?: string | undefined;
    solPassword?: string | undefined; // write-only; vacio/ausente = no cambia
    signatureId?: string | undefined;
}

export interface SubirCertificadoInput {
    p12Base64: string;
    password: string;
}

function toEnvironment(value: string | undefined): SunatEnvironment {
    return value === "PRODUCCION" ? "PRODUCCION" : "BETA";
}

function clean(value: string | undefined | null): string {
    return typeof value === "string" ? value.trim() : "";
}

interface ProbeResult {
    ok: boolean;
    message: string;
    code?: string;
}

export class EmisorConfigService {
    private readonly soap = new SunatSoapClient(20000);

    // Step-up: re-verifica la contraseña del admin antes de una accion sensible.
    private async requireStepUp(adminUserId: number | undefined, adminPassword: string | undefined): Promise<void> {
        if (!adminUserId) throw CustomError.unauthorized("Sesion no valida para una accion sensible");
        const ok = adminPassword ? await AuthService.verifyUserPassword(adminUserId, adminPassword) : false;
        if (!ok) throw CustomError.unauthorized("Confirma tu contraseña de administrador para continuar");
    }

    // Prueba conexion + credenciales contra SUNAT (getStatus con ticket dummy).
    private async probe(environment: SunatEnvironment, ruc: string, solUser: string, solPassword: string): Promise<ProbeResult> {
        if (!solPassword) return { ok: false, message: "Falta la Clave SOL: guarda las credenciales primero" };
        const endpoint = endpointForEnvironment(environment);
        const res = await this.soap.getStatus(endpoint, { username: `${ruc}${solUser}`, password: solPassword }, "DUMMYTICKET00000000000");
        const fault = `${res.faultCode ?? ""} ${res.faultString ?? ""}`.toLowerCase();

        if (res.faultCode === "NETWORK_ERROR") {
            return { ok: false, code: res.faultCode, message: `No se pudo conectar con SUNAT: ${res.faultString ?? ""}`.trim() };
        }
        // 0103 = usuario/clave incorrectos.
        if (fault.includes("0103") || fault.includes("clave sol") || fault.includes("usuario o contraseña")) {
            return { ok: false, code: "0103", message: "Credenciales SUNAT invalidas (usuario o Clave SOL)" };
        }
        // Cualquier otra respuesta (incluido error de ticket) implica que SUNAT respondio y autentico.
        return { ok: true, message: "Conexion y credenciales correctas" };
    }

    // Devuelve el id de la unica fila, creandola con defaults si no existe.
    private async ensureRow(): Promise<number> {
        const rows = await prisma.$queryRawUnsafe<{ id: number }[]>(
            `SELECT "id" FROM "SunatEmisorConfig" ORDER BY "id" ASC LIMIT 1`,
        );
        if (rows[0]) return rows[0].id;
        const inserted = await prisma.$queryRawUnsafe<{ id: number }[]>(
            `INSERT INTO "SunatEmisorConfig" DEFAULT VALUES RETURNING "id"`,
        );
        if (!inserted[0]) throw CustomError.internal("No se pudo inicializar la configuracion SUNAT");
        return inserted[0].id;
    }

    private async fetchRow(): Promise<EmisorRow | null> {
        const rows = await prisma.$queryRawUnsafe<EmisorRow[]>(
            `SELECT * FROM "SunatEmisorConfig" ORDER BY "id" ASC LIMIT 1`,
        );
        return rows[0] ?? null;
    }

    private toView(row: EmisorRow | null): EmisorConfigView {
        const environment = toEnvironment(row?.environment);
        const certNotAfter = row?.certNotAfter ?? null;
        return {
            configured: Boolean(row?.activo),
            encryptionConfigured: isSunatEncryptionConfigured(),
            environment,
            ruc: row?.ruc ?? "",
            razonSocial: row?.razonSocial ?? "",
            nombreComercial: row?.nombreComercial ?? null,
            ubigeo: row?.ubigeo ?? "",
            direccion: row?.direccion ?? null,
            tipoOperacion: row?.tipoOperacion ?? null,
            regimen: row?.regimen ?? null,
            solUser: row?.solUser ?? "",
            signatureId: row?.signatureId ?? "SignSUNAT",
            hasSolPassword: Boolean(row?.solPasswordEnc),
            hasCertificate: Boolean(row?.certP12Enc),
            certSubjectCN: row?.certSubjectCN ?? null,
            certNotAfter,
            certExpired: certNotAfter ? certNotAfter.getTime() < Date.now() : false,
            updatedById: row?.updatedById ?? null,
            updatedAt: row?.updatedAt ?? new Date(),
        };
    }

    async obtener(): Promise<EmisorConfigView> {
        try {
            return this.toView(await this.fetchRow());
        } catch {
            // Tabla aun no creada (bootstrap no corrido): install fresco = sin configurar.
            return this.toView(null);
        }
    }

    // Calcula si la configuracion esta lista para emitir (drives loadSunatConfig).
    private computeActivo(env: SunatEnvironment, ruc: string, solUser: string, hasPassword: boolean, hasCert: boolean): boolean {
        const base = /^\d{11}$/.test(ruc) && solUser.length > 0 && hasPassword;
        return env === "PRODUCCION" ? base && hasCert : base;
    }

    async actualizar(input: UpdateEmisorInput, updatedById?: number, adminPassword?: string): Promise<EmisorConfigView> {
        await this.ensureRow();
        const current = await this.fetchRow();
        if (!current) throw CustomError.internal("No se pudo cargar la configuracion SUNAT");

        const currentEnv = toEnvironment(current.environment);
        const environment = input.environment !== undefined ? toEnvironment(input.environment) : currentEnv;
        const ruc = input.ruc !== undefined ? clean(input.ruc) : current.ruc;
        const solUser = input.solUser !== undefined ? clean(input.solUser) : current.solUser;

        if (ruc && !/^\d{11}$/.test(ruc)) throw CustomError.badRequest("El RUC debe tener 11 digitos");
        const ubigeo = input.ubigeo !== undefined ? clean(input.ubigeo) : current.ubigeo;
        if (ubigeo && !/^\d{6}$/.test(ubigeo)) throw CustomError.badRequest("El ubigeo debe tener 6 digitos");

        // Secreto Clave SOL: solo se toca si viene un valor no vacio.
        let solPasswordEnc = current.solPasswordEnc;
        const nuevaSolPassword = clean(input.solPassword);
        if (nuevaSolPassword) {
            if (!isSunatEncryptionConfigured()) {
                throw CustomError.badRequest("Configura SUNAT_CONFIG_ENC_KEY antes de guardar secretos SUNAT");
            }
            solPasswordEnc = encryptSecret(nuevaSolPassword);
        }

        // Step-up: cambios sensibles (Clave SOL o entorno) exigen re-autenticacion.
        const cambioSensible = Boolean(nuevaSolPassword) || environment !== currentEnv;
        if (cambioSensible) {
            await this.requireStepUp(updatedById, adminPassword);
        }

        const hasCert = Boolean(current.certP12Enc);
        // Gate produccion: exige RUC valido + certificado real.
        if (environment === "PRODUCCION") {
            if (!/^\d{11}$/.test(ruc)) throw CustomError.badRequest("Produccion exige un RUC valido (11 digitos)");
            if (!hasCert) throw CustomError.badRequest("Produccion exige un certificado digital cargado");
        }

        // Al ACTIVAR produccion (transicion desde BETA) exige prueba de conexion en verde.
        if (environment === "PRODUCCION" && currentEnv !== "PRODUCCION") {
            const passwordParaProbar = nuevaSolPassword
                || (solPasswordEnc && isSunatEncryptionConfigured() ? decryptSecretString(solPasswordEnc) : "");
            const probe = await this.probe("PRODUCCION", ruc, solUser, passwordParaProbar);
            if (!probe.ok) {
                throw CustomError.badRequest(`No se puede activar produccion: la prueba de conexion fallo (${probe.message}). Corrige y reintenta.`);
            }
        }

        const activo = this.computeActivo(environment, ruc, solUser, Boolean(solPasswordEnc), hasCert);

        await prisma.$executeRawUnsafe(
            `UPDATE "SunatEmisorConfig" SET
                "environment" = $1,
                "ruc" = $2,
                "razonSocial" = $3,
                "nombreComercial" = $4,
                "ubigeo" = $5,
                "direccion" = $6,
                "tipoOperacion" = $7,
                "regimen" = $8,
                "solUser" = $9,
                "solPasswordEnc" = $10,
                "signatureId" = $11,
                "activo" = $12,
                "updatedById" = $13,
                "updatedAt" = CURRENT_TIMESTAMP
             WHERE "id" = $14`,
            environment,
            ruc,
            input.razonSocial !== undefined ? clean(input.razonSocial) : current.razonSocial,
            input.nombreComercial !== undefined ? (clean(input.nombreComercial) || null) : current.nombreComercial,
            ubigeo,
            input.direccion !== undefined ? (clean(input.direccion) || null) : current.direccion,
            input.tipoOperacion !== undefined ? (clean(input.tipoOperacion) || null) : current.tipoOperacion,
            input.regimen !== undefined ? (clean(input.regimen) || null) : current.regimen,
            solUser,
            solPasswordEnc,
            input.signatureId !== undefined ? (clean(input.signatureId) || "SignSUNAT") : current.signatureId,
            activo,
            updatedById ?? current.updatedById,
            current.id,
        );

        return this.toView(await this.fetchRow());
    }

    // Valida el .pfx con node-forge, extrae metadatos y guarda cifrado.
    async subirCertificado(input: SubirCertificadoInput, updatedById?: number, adminPassword?: string): Promise<EmisorConfigView> {
        if (!isSunatEncryptionConfigured()) {
            throw CustomError.badRequest("Configura SUNAT_CONFIG_ENC_KEY antes de subir el certificado");
        }
        // Accion sensible: exige re-autenticacion del admin.
        await this.requireStepUp(updatedById, adminPassword);
        const p12Base64 = clean(input.p12Base64).replace(/^data:[^,]+,/, "");
        if (!p12Base64) throw CustomError.badRequest("Falta el archivo .pfx (p12Base64)");
        const password = typeof input.password === "string" ? input.password : "";

        const der = Buffer.from(p12Base64, "base64");
        let subjectCN: string | null = null;
        let notAfter: Date | null = null;
        let certRuc = "";
        try {
            const p12Asn1 = forge.asn1.fromDer(der.toString("binary"));
            const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, false, password);
            let certificate: forge.pki.Certificate | undefined;
            let privateKey: forge.pki.PrivateKey | undefined;
            for (const sc of p12.safeContents) {
                for (const bag of sc.safeBags) {
                    const b = bag as typeof bag & { cert?: forge.pki.Certificate; key?: forge.pki.PrivateKey };
                    if (!certificate && b.cert) certificate = b.cert;
                    if (!privateKey && b.key) privateKey = b.key;
                }
            }
            if (!certificate || !privateKey) {
                throw CustomError.badRequest("El .pfx no contiene certificado y llave privada");
            }
            const cn = certificate.subject.getField("CN");
            subjectCN = cn?.value ?? null;
            notAfter = certificate.validity.notAfter;
            const serial = certificate.subject.getField("serialNumber") ?? certificate.subject.getField({ type: "2.5.4.5" });
            const digits = String(serial?.value ?? "").match(/\d{11}/);
            certRuc = digits?.[0] ?? "";
        } catch (error) {
            if (error instanceof CustomError) throw error;
            // node-forge lanza cuando la contraseña del .pfx es incorrecta o el archivo esta corrupto.
            throw CustomError.badRequest("No se pudo abrir el .pfx: contraseña incorrecta o archivo invalido");
        }

        if (notAfter && notAfter.getTime() < Date.now()) {
            throw CustomError.badRequest(`El certificado esta vencido (${notAfter.toISOString().slice(0, 10)})`);
        }

        const id = await this.ensureRow();
        const current = await this.fetchRow();
        // Si ya hay RUC configurado, el titular del cert debe coincidir.
        const configuredRuc = clean(current?.ruc);
        if (configuredRuc && certRuc && certRuc !== configuredRuc) {
            throw CustomError.badRequest(`El certificado pertenece al RUC ${certRuc}, distinto del configurado (${configuredRuc})`);
        }

        await prisma.$executeRawUnsafe(
            `UPDATE "SunatEmisorConfig" SET
                "certP12Enc" = $1,
                "certPasswordEnc" = $2,
                "certSubjectCN" = $3,
                "certNotAfter" = $4,
                "updatedById" = $5,
                "updatedAt" = CURRENT_TIMESTAMP
             WHERE "id" = $6`,
            encryptSecret(der),
            encryptSecret(password),
            subjectCN,
            notAfter,
            updatedById ?? current?.updatedById ?? null,
            id,
        );

        return this.toView(await this.fetchRow());
    }

    // Prueba conexion + credenciales con la configuracion efectiva actual.
    async probarConexion(): Promise<{ ok: boolean; environment: SunatEnvironment; message: string; code?: string }> {
        const config = await loadSunatConfig();
        const result = await this.probe(config.environment, config.ruc, config.solUser, config.solPassword);
        return { ok: result.ok, environment: config.environment, message: result.message, ...(result.code ? { code: result.code } : {}) };
    }
}
