export function normalizePeruPhone(value: unknown): string | null {
    if (typeof value !== "string") return null;
    let phone = value.normalize("NFKC").trim().replace(/[\s().-]/g, "");
    if (phone.startsWith("00")) phone = `+${phone.slice(2)}`;
    if (/^9\d{8}$/.test(phone)) phone = `+51${phone}`;
    if (/^51\d{9}$/.test(phone)) phone = `+${phone}`;
    if (!/^\+519\d{8}$/.test(phone)) return null;
    return phone;
}
