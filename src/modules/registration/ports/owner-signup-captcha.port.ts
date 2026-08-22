export type OwnerSignupCaptchaResult =
    | { status: "VALID" }
    | { status: "INVALID" }
    | { status: "UNAVAILABLE" };

export interface OwnerSignupCaptchaVerifier {
    verify(input: {
        token: string;
        ipAddress: string;
    }): Promise<OwnerSignupCaptchaResult>;
}
