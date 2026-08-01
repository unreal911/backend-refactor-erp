import { NextFunction, Response } from "express";

const RESPONSE_TASKS = Symbol.for("tienda.response.tasks");

type ResponseWithTasks = Response & {
    [RESPONSE_TASKS]?: Promise<unknown>[];
};

export function registerResponseTask(
    response: Response,
    task: Promise<unknown>,
): void {
    const target = response as ResponseWithTasks;
    const tasks = target[RESPONSE_TASKS] ?? [];
    tasks.push(task);
    target[RESPONSE_TASKS] = tasks;
}

export async function waitForResponseTasks(
    response: Response,
): Promise<void> {
    const tasks = (response as ResponseWithTasks)[RESPONSE_TASKS] ?? [];
    await Promise.all(tasks);
}

export function continueThroughResponse(
    response: Response,
    next: NextFunction,
): Promise<void> {
    if (typeof response.once !== "function") {
        next();
        return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
        let settled = false;
        const cleanup = () => {
            response.off("finish", onFinish);
            response.off("close", onClose);
        };
        const settle = (handler: () => void) => {
            if (settled) return;
            settled = true;
            cleanup();
            handler();
        };
        const onFinish = () => {
            if (settled) return;
            settled = true;
            cleanup();
            void waitForResponseTasks(response).then(resolve, reject);
        };
        const onClose = () => settle(() => {
            if (response.writableFinished) resolve();
            else reject(new Error(
                "La conexion HTTP se cerro antes de completar la transaccion tenant",
            ));
        });

        response.once("finish", onFinish);
        response.once("close", onClose);
        try {
            next();
        } catch (error) {
            settle(() => reject(error));
        }
    });
}
