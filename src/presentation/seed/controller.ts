import { Request, Response } from 'express';
import { TriggerSeedDto } from '../../domain/dtos/trigger-seed.dto';
import { runSeed } from '../../data/seed';
import { envs } from '../../config/envs';

export class SeedController {
    static async run(req: Request, res: Response) {
        if (!envs.SEED_ENDPOINT_ENABLED) {
            return res.status(404).json({ message: 'Endpoint de seed deshabilitado' });
        }

        const [error, dto] = TriggerSeedDto.create(req.body as { [key: string]: unknown });
        if (error) {
            return res.status(400).json({ message: error });
        }

        if (envs.SEED_TRIGGER_KEY) {
            if (!dto!.key || dto!.key !== envs.SEED_TRIGGER_KEY) {
                return res.status(401).json({ message: 'Clave invalida para ejecutar seed' });
            }
        }

        try {
            const seedOptions: { includeDemoUsers?: boolean; ensureAdminFromEnv?: boolean } = {};
            if (dto!.includeDemoUsers !== undefined) {
                seedOptions.includeDemoUsers = dto!.includeDemoUsers;
            }
            if (dto!.ensureAdminFromEnv !== undefined) {
                seedOptions.ensureAdminFromEnv = dto!.ensureAdminFromEnv;
            }

            const summary = await runSeed(seedOptions);
            return res.status(200).json({
                success: true,
                message: 'Seed ejecutado correctamente',
                data: summary,
            });
        } catch (err) {
            console.error('Seed endpoint error:', err);
            return res.status(500).json({ message: 'No se pudo ejecutar el seed' });
        }
    }
}
