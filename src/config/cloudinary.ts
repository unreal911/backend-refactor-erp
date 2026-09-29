import { v2 as cloudinary } from 'cloudinary';
import { envs } from './envs';

cloudinary.config({
    cloud_name: envs.CLOUDINARY_CLOUD_NAME,
    api_key: envs.CLOUDINARY_API_KEY,
    api_secret: envs.CLOUDINARY_API_SECRET,
    secure: true,
    hide_sensitive: true,
});

export function assertCloudinaryConfigured(): void {
    if (!envs.CLOUDINARY_CONFIGURED) {
        throw new Error("Cloudinary no está configurado; activa un perfil S3 para cargar imágenes en AWS");
    }
}

export { cloudinary };
