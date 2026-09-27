import "dotenv/config";

function required(name: string): string {
    const value = String(process.env[name] ?? "").trim();
    if (!value) throw new Error(`${name} está faltante`);
    return value;
}

async function main(): Promise<void> {
    const apiVersion = required("WHATSAPP_API_VERSION");
    const token = required("WHATSAPP_ACCESS_TOKEN");
    const phoneNumberId = required("WHATSAPP_PHONE_NUMBER_ID");
    const response = await fetch(
        `https://graph.facebook.com/${apiVersion}/${phoneNumberId}?fields=display_phone_number,verified_name,quality_rating`,
        {
            headers: { authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(Number(process.env.WHATSAPP_TIMEOUT_MS || 10000)),
        },
    );
    const body = await response.json().catch(() => null);
    if (!response.ok) {
        throw new Error(`WhatsApp API ${response.status}: ${JSON.stringify(body).slice(0, 500)}`);
    }
    console.log("[OK] WhatsApp Cloud API verificada", {
        displayPhoneNumber: body?.display_phone_number ?? null,
        verifiedName: body?.verified_name ?? null,
        qualityRating: body?.quality_rating ?? null,
    });
}

main().catch((error: unknown) => {
    console.error("[ERROR] WhatsApp no verificado:", error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
});
