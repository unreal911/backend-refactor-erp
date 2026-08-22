import { randomUUID } from "node:crypto";
import {
    OwnerSignupCaptchaResult,
    OwnerSignupCaptchaVerifier,
} from "./ports/owner-signup-captcha.port";

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

type TurnstileResponse = {
    success?: boolean;
    hostname?: string;
    action?: string;
    "error-codes"?: string[];
};

export type TurnstileOwnerSignupConfig = {
    secretKey: string;
    expectedAction: string;
    expectedHostnames: string[];
    timeoutMs: number;
    allowMissingAction?: boolean;
};

export class TurnstileOwnerSignupCaptcha implements OwnerSignupCaptchaVerifier {
    constructor(
        private readonly config: TurnstileOwnerSignupConfig,
        private readonly request: typeof fetch = fetch,
    ) {}

    async verify(input: {
        token: string;
        ipAddress: string;
    }): Promise<OwnerSignupCaptchaResult> {
        if (!input.token || input.token.length > 2048) return { status: "INVALID" };

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
        try {
            const response = await this.request(SITEVERIFY_URL, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    secret: this.config.secretKey,
                    response: input.token,
                    remoteip: input.ipAddress,
                    idempotency_key: randomUUID(),
                }),
                signal: controller.signal,
            });
            if (!response.ok) return { status: "UNAVAILABLE" };

            const result = await response.json() as TurnstileResponse;
            if (!result.success) {
                const codes = Array.isArray(result["error-codes"])
                    ? result["error-codes"]
                    : [];
                return codes.includes("internal-error")
                    ? { status: "UNAVAILABLE" }
                    : { status: "INVALID" };
            }
            if (
                result.action !== this.config.expectedAction
                && !(this.config.allowMissingAction && !result.action)
            ) {
                return { status: "INVALID" };
            }
            if (
                this.config.expectedHostnames.length > 0
                && (!result.hostname
                    || !this.config.expectedHostnames.includes(result.hostname.toLowerCase()))
            ) {
                return { status: "INVALID" };
            }
            return { status: "VALID" };
        } catch {
            return { status: "UNAVAILABLE" };
        } finally {
            clearTimeout(timeout);
        }
    }
}
