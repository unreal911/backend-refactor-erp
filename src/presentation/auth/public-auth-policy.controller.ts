import { Request, Response } from "express";
import { getAuthChannelPolicy } from "../../modules/auth/auth-channel-policy";

export class PublicAuthPolicyController {
    static get = async (_req: Request, res: Response) => {
        const data = await getAuthChannelPolicy();
        return res.json({ data });
    };
}
