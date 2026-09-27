import { readFileSync } from "node:fs";
import path from "node:path";

export type EmailHero =
    | "account-activation"
    | "password-recovery"
    | "team-invitation"
    | "trial-expired";

type BrandedEmailOptions = {
    preheader: string;
    eyebrow: string;
    title: string;
    greeting: string;
    introduction: string;
    actionLabel: string;
    actionUrl: string;
    hero: EmailHero;
    heroAlt: string;
    expiration: string;
    expirationLabel?: string;
    detailTitle?: string;
    details?: string[];
    securityNotice: string;
};

const HERO_FILES: Record<EmailHero, string> = {
    "account-activation": "account-activation.jpg",
    "password-recovery": "password-recovery.jpg",
    "team-invitation": "team-invitation.jpg",
    "trial-expired": "trial-expired.jpg",
};

export function escapeEmailHtml(value: string): string {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

export function formatEmailExpiration(expiresAt: Date): string {
    return new Intl.DateTimeFormat("es-PE", {
        dateStyle: "long",
        timeStyle: "short",
        timeZone: "America/Lima",
    }).format(expiresAt);
}

export function getEmailHeroAttachment(hero: EmailHero) {
    const filename = HERO_FILES[hero];
    const assetPath = path.resolve(__dirname, "../../public/emails", filename);

    return {
        filename,
        content: readFileSync(assetPath),
        cid: `tienda-saas-${hero}`,
        contentType: "image/jpeg",
        contentDisposition: "inline" as const,
    };
}

export function renderBrandedEmail(options: BrandedEmailOptions): string {
    const safe = {
        preheader: escapeEmailHtml(options.preheader),
        eyebrow: escapeEmailHtml(options.eyebrow),
        title: escapeEmailHtml(options.title),
        greeting: escapeEmailHtml(options.greeting),
        introduction: escapeEmailHtml(options.introduction),
        actionLabel: escapeEmailHtml(options.actionLabel),
        actionUrl: escapeEmailHtml(options.actionUrl),
        heroAlt: escapeEmailHtml(options.heroAlt),
        expiration: escapeEmailHtml(options.expiration),
        expirationLabel: escapeEmailHtml(options.expirationLabel ?? "Este enlace vence"),
        detailTitle: options.detailTitle ? escapeEmailHtml(options.detailTitle) : "",
        details: (options.details ?? []).map(escapeEmailHtml),
        securityNotice: escapeEmailHtml(options.securityNotice),
    };
    const detailRows = safe.details
        .map((detail) => `
            <tr>
              <td width="28" valign="top" style="padding:5px 0;color:#6941c6;font-size:18px;line-height:22px;">&#10003;</td>
              <td style="padding:5px 0;color:#344054;font-size:15px;line-height:22px;">${detail}</td>
            </tr>`)
        .join("");
    const details = safe.details.length > 0
        ? `
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0 0;background:#f9f5ff;border:1px solid #e9d7fe;border-radius:14px;">
            <tr><td style="padding:20px 22px;">
              ${safe.detailTitle ? `<p style="margin:0 0 8px;color:#42307d;font-size:15px;line-height:22px;font-weight:700;">${safe.detailTitle}</p>` : ""}
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${detailRows}</table>
            </td></tr>
          </table>`
        : "";

    return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>${safe.title}</title>
  <style>
    @media only screen and (max-width: 620px) {
      .email-shell { width: 100% !important; }
      .email-body { padding: 28px 22px !important; }
      .email-title { font-size: 28px !important; line-height: 34px !important; }
      .email-button { display: block !important; text-align: center !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background:#f2f4f7;font-family:Arial,'Helvetica Neue',sans-serif;color:#101828;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${safe.preheader}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f4f7;">
    <tr>
      <td align="center" style="padding:28px 12px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" class="email-shell" style="width:600px;max-width:600px;background:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 10px 34px rgba(16,24,40,.10);">
          <tr>
            <td style="padding:18px 28px;background:#3e1c96;">
              <table role="presentation" cellpadding="0" cellspacing="0"><tr>
                <td width="38" height="38" align="center" valign="middle" style="width:38px;height:38px;background:#ffffff;border-radius:11px;color:#5925dc;font-size:21px;font-weight:800;">T</td>
                <td style="padding-left:11px;color:#ffffff;font-size:18px;font-weight:700;letter-spacing:-.2px;">Tienda SaaS</td>
              </tr></table>
            </td>
          </tr>
          <tr>
            <td style="font-size:0;line-height:0;background:#5925dc;">
              <img src="cid:tienda-saas-${options.hero}" width="600" alt="${safe.heroAlt}" style="display:block;width:100%;max-width:600px;height:auto;border:0;">
            </td>
          </tr>
          <tr>
            <td class="email-body" style="padding:38px 44px 36px;">
              <p style="margin:0 0 10px;color:#6941c6;font-size:13px;line-height:18px;font-weight:800;letter-spacing:1.4px;text-transform:uppercase;">${safe.eyebrow}</p>
              <h1 class="email-title" style="margin:0 0 20px;color:#101828;font-size:34px;line-height:40px;letter-spacing:-.8px;">${safe.title}</h1>
              <p style="margin:0 0 12px;color:#344054;font-size:17px;line-height:26px;font-weight:700;">${safe.greeting}</p>
              <p style="margin:0;color:#475467;font-size:16px;line-height:25px;">${safe.introduction}</p>
              ${details}
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px 0 24px;">
                <tr><td bgcolor="#6941c6" style="border-radius:12px;">
                  <a class="email-button" href="${safe.actionUrl}" target="_blank" style="display:inline-block;padding:15px 26px;color:#ffffff;text-decoration:none;font-size:16px;line-height:20px;font-weight:700;border-radius:12px;">${safe.actionLabel}</a>
                </td></tr>
              </table>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border-left:4px solid #9e77ed;border-radius:8px;">
                <tr><td style="padding:15px 17px;">
                  <p style="margin:0 0 5px;color:#344054;font-size:14px;line-height:20px;font-weight:700;">${safe.expirationLabel}: ${safe.expiration}</p>
                  <p style="margin:0;color:#667085;font-size:13px;line-height:20px;">${safe.securityNotice}</p>
                </td></tr>
              </table>
              <p style="margin:24px 0 8px;color:#667085;font-size:12px;line-height:18px;">Si el botón no funciona, copia y pega este enlace en tu navegador:</p>
              <p style="margin:0;word-break:break-all;color:#6941c6;font-size:12px;line-height:18px;"><a href="${safe.actionUrl}" style="color:#6941c6;">${safe.actionUrl}</a></p>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:23px 28px;background:#1d1237;color:#d6bbfb;font-size:12px;line-height:18px;">
              <strong style="color:#ffffff;">Tienda SaaS</strong><br>
              Ventas, inventario y operación de tu negocio en un solo lugar.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
