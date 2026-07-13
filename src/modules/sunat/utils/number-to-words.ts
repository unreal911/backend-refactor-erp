// Convierte un monto a letras en espanol para la leyenda 1000 de SUNAT.
// Ej: 1858.59 -> "MIL OCHOCIENTOS CINCUENTA Y OCHO CON 59/100 SOLES"

const UNIDADES = ["", "UNO", "DOS", "TRES", "CUATRO", "CINCO", "SEIS", "SIETE", "OCHO", "NUEVE"];
const DIEZ_A_DIECINUEVE = [
    "DIEZ", "ONCE", "DOCE", "TRECE", "CATORCE", "QUINCE", "DIECISEIS", "DIECISIETE", "DIECIOCHO", "DIECINUEVE",
];
const DECENAS = [
    "", "", "VEINTE", "TREINTA", "CUARENTA", "CINCUENTA", "SESENTA", "SETENTA", "OCHENTA", "NOVENTA",
];
const CENTENAS = [
    "", "CIENTO", "DOSCIENTOS", "TRESCIENTOS", "CUATROCIENTOS", "QUINIENTOS",
    "SEISCIENTOS", "SETECIENTOS", "OCHOCIENTOS", "NOVECIENTOS",
];

function decenasALetras(n: number): string {
    if (n < 10) return UNIDADES[n] ?? "";
    if (n < 20) return DIEZ_A_DIECINUEVE[n - 10] ?? "";
    if (n < 30) {
        const u = n - 20;
        return u === 0 ? "VEINTE" : `VEINTI${UNIDADES[u] ?? ""}`;
    }
    const d = Math.floor(n / 10);
    const u = n % 10;
    const decena = DECENAS[d] ?? "";
    return u === 0 ? decena : `${decena} Y ${UNIDADES[u] ?? ""}`;
}

function centenasALetras(n: number): string {
    if (n === 0) return "";
    if (n === 100) return "CIEN";
    const c = Math.floor(n / 100);
    const resto = n % 100;
    const centena = CENTENAS[c] ?? "";
    const restoTexto = decenasALetras(resto);
    return restoTexto ? `${centena} ${restoTexto}` : centena;
}

function seccionALetras(n: number): string {
    // n < 1000
    return centenasALetras(n).trim();
}

function enteroALetras(n: number): string {
    if (n === 0) return "CERO";

    const millones = Math.floor(n / 1_000_000);
    const miles = Math.floor((n % 1_000_000) / 1000);
    const resto = n % 1000;

    const partes: string[] = [];

    if (millones > 0) {
        partes.push(millones === 1 ? "UN MILLON" : `${seccionALetras(millones)} MILLONES`);
    }
    if (miles > 0) {
        partes.push(miles === 1 ? "MIL" : `${seccionALetras(miles)} MIL`);
    }
    if (resto > 0) {
        partes.push(seccionALetras(resto));
    }

    return partes.join(" ").replace(/\s+/g, " ").trim();
}

export function montoEnLetras(monto: number, moneda = "SOLES"): string {
    const abs = Math.abs(monto);
    // Redondear a centimos primero para que un centavo que llega a 100 acarree al entero.
    const totalCentavos = Math.round(abs * 100);
    const entero = Math.floor(totalCentavos / 100);
    const centavos = totalCentavos % 100;
    const centavosStr = String(centavos).padStart(2, "0");
    return `${enteroALetras(entero)} CON ${centavosStr}/100 ${moneda}`.trim();
}
