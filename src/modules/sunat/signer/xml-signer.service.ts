import fs from "node:fs";
import path from "node:path";
import forge from "node-forge";
import { SignedXml } from "xml-crypto";
import { CustomError } from "../../../domain/errors/custom.error";
import { SunatConfig } from "../config/sunat.config";

interface SigningMaterial {
    privateKeyPem: string;
    certificatePem: string;
}

let cachedTestMaterial: SigningMaterial | undefined;

function resolveExistingFile(filePath: string, label: string): string {
    const resolved = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
    if (!fs.existsSync(resolved)) {
        throw CustomError.internal(`No se encontro ${label} en ${resolved}`);
    }
    return resolved;
}

// Extrae llave+cert de un PKCS#12 ya cargado en memoria (binary string).
function p12MaterialFromBinary(binary: string, password: string): SigningMaterial {
    const p12Asn1 = forge.asn1.fromDer(binary);
    const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, false, password);

    let privateKey: forge.pki.PrivateKey | undefined;
    let certificate: forge.pki.Certificate | undefined;

    for (const safeContent of p12.safeContents) {
        for (const safeBag of safeContent.safeBags) {
            const bag = safeBag as typeof safeBag & {
                key?: forge.pki.PrivateKey;
                cert?: forge.pki.Certificate;
            };
            if (!privateKey && bag.key) privateKey = bag.key;
            if (!certificate && bag.cert) certificate = bag.cert;
        }
    }

    if (!privateKey || !certificate) {
        throw CustomError.internal("El certificado P12 no contiene llave privada y certificado");
    }

    return {
        privateKeyPem: forge.pki.privateKeyToPem(privateKey),
        certificatePem: forge.pki.certificateToPem(certificate),
    };
}

// Material desde bytes en MEMORIA (proveniente de la BD, descifrado). Nunca toca disco.
function getP12MaterialFromDer(der: Buffer, password: string): SigningMaterial {
    return p12MaterialFromBinary(der.toString("binary"), password);
}

// Material desde un .pfx en disco (legacy env, solo dev/beta).
function getP12Material(filePath: string, password: string): SigningMaterial {
    return p12MaterialFromBinary(fs.readFileSync(filePath).toString("binary"), password);
}

function getPemMaterial(certPath: string, keyPath: string): SigningMaterial {
    return {
        certificatePem: fs.readFileSync(resolveExistingFile(certPath, "el certificado PEM"), "utf8"),
        privateKeyPem: fs.readFileSync(resolveExistingFile(keyPath, "la llave privada PEM"), "utf8"),
    };
}

// Certificado autofirmado para pruebas en BETA (SUNAT beta no valida el cert).
function getTestMaterial(): SigningMaterial {
    if (cachedTestMaterial) return cachedTestMaterial;

    const keys = forge.pki.rsa.generateKeyPair(2048);
    const cert = forge.pki.createCertificate();
    cert.publicKey = keys.publicKey;
    cert.serialNumber = String(Date.now());
    cert.validity.notBefore = new Date();
    cert.validity.notAfter = new Date();
    cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1);
    const attrs = [
        { name: "commonName", value: "SUNAT BETA TEST CERT" },
        { name: "organizationName", value: "EMISOR DEMO SAC" },
        { name: "countryName", value: "PE" },
    ];
    cert.setSubject(attrs);
    cert.setIssuer(attrs);
    cert.sign(keys.privateKey, forge.md.sha256.create());

    cachedTestMaterial = {
        privateKeyPem: forge.pki.privateKeyToPem(keys.privateKey),
        certificatePem: forge.pki.certificateToPem(cert),
    };
    return cachedTestMaterial;
}

export class XmlSignerService {
    constructor(private readonly config: SunatConfig) {}

    private resolveMaterial(): SigningMaterial {
        const c = this.config;
        // Preferente: certificado real en memoria (BD, descifrado). No toca disco.
        if (c.certP12Der) return getP12MaterialFromDer(c.certP12Der, c.certP12Password ?? "");
        if (c.certPemPath && c.keyPemPath) return getPemMaterial(c.certPemPath, c.keyPemPath);
        if (c.certPemPath || c.keyPemPath) {
            throw CustomError.internal("Configura SUNAT_CERT_PEM_PATH y SUNAT_KEY_PEM_PATH juntos");
        }
        if (c.certP12Path) {
            return getP12Material(resolveExistingFile(c.certP12Path, "el certificado P12"), c.certP12Password ?? "");
        }
        if (c.allowTestCertificate) return getTestMaterial();
        throw CustomError.internal("Falta certificado para firmar (P12/PEM) o habilitar SUNAT_ALLOW_TEST_CERT");
    }

    sign(xml: string): string {
        const material = this.resolveMaterial();

        const signer = new SignedXml({
            privateKey: material.privateKeyPem,
            publicCert: material.certificatePem,
            canonicalizationAlgorithm: "http://www.w3.org/TR/2001/REC-xml-c14n-20010315",
            signatureAlgorithm: "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256",
            getKeyInfoContent: SignedXml.getKeyInfoContent,
        });

        signer.addReference({
            xpath: "/*",
            transforms: [
                "http://www.w3.org/2000/09/xmldsig#enveloped-signature",
                "http://www.w3.org/TR/2001/REC-xml-c14n-20010315",
            ],
            digestAlgorithm: "http://www.w3.org/2001/04/xmlenc#sha256",
            isEmptyUri: true,
        });

        signer.computeSignature(xml, {
            prefix: "ds",
            attrs: { Id: this.config.signatureId },
            existingPrefixes: { ds: "http://www.w3.org/2000/09/xmldsig#" },
            location: {
                // Inserta la firma dentro del ExtensionContent vacio del UBLExtension.
                reference:
                    "//*[local-name(.)='ExtensionContent' and namespace-uri(.)='urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2']",
                action: "append",
            },
        });

        return signer.getSignedXml();
    }
}
