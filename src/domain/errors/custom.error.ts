export class CustomError extends Error {


    constructor(
        public readonly message: string,
        public readonly statusCode: number) {
        super(message);
    }

    static badRequest(message: string): CustomError {
        return new CustomError(message, 400);
    }
    static notFound(message: string): CustomError {
        return new CustomError(message, 404);
    }
    static internal(message: string): CustomError {
        return new CustomError(message, 500);
    }
    static unauthorized(message: string): CustomError {
        return new CustomError(message, 401);
    }
    static forbidden(message: string): CustomError {
        return new CustomError(message, 403);
    }
}