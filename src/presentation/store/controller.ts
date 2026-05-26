import { Request, Response } from "express";
import { StoreService } from "../services/store.service";
import { CustomError } from "../../domain/errors/custom.error";
import { CreateStoreDto } from "../../domain/dtos/create-store.dto";
import { UpdateStoreDto } from "../../domain/dtos/update-store.dto";
import { ListStoreDto } from "../../domain/dtos/list-store.dto";

export class StoreController {
    constructor(
        private readonly storeService: StoreService,
    ) { }

    createStore = async (req: Request, res: Response) => {
        try {
            const [error, createStoreDto] = CreateStoreDto.create(req.body);
            if (error || !createStoreDto) {
                return res.status(400).json({ message: error ?? 'Datos inválidos para crear tienda' });
            }

            const store = await this.storeService.createStore(createStoreDto);
            return res.status(201).json(store);
        } catch (err) {
            if (err instanceof CustomError) {
                return res.status(err.statusCode).json({ message: err.message });
            }
            console.error(err);
            return res.status(500).json({ message: 'Error interno del servidor' });
        }
    }

    listStores = async (req: Request, res: Response) => {
        try {
            const skip = Number(req.query.skip ?? 1);
            const take = Number(req.query.take ?? 100);
            const search = req.query.search as string | undefined;
            const type = req.query.type as string | undefined;
            const includeInactive = req.query.includeInactive !== undefined ? req.query.includeInactive === 'true' : false;

            const [error, listStoreDto] = ListStoreDto.create(skip, take, search, type, includeInactive);
            if (error || !listStoreDto) {
                return res.status(400).json({ message: error ?? 'Parámetros inválidos para listar tiendas' });
            }

            const stores = await this.storeService.listStores(listStoreDto);
            return res.status(200).json(stores);
        } catch (err) {
            if (err instanceof CustomError) {
                return res.status(err.statusCode).json({ message: err.message });
            }
            console.error(err);
            return res.status(500).json({ message: 'Error interno del servidor' });
        }
    }

    updateStore = async (req: Request, res: Response) => {
        try {
            const storeId = Number(req.params.id);
            if (isNaN(storeId) || storeId <= 0) {
                return res.status(400).json({ message: 'ID de tienda inválido' });
            }

            const [error, updateStoreDto] = UpdateStoreDto.create(req.body);
            if (error || !updateStoreDto) {
                return res.status(400).json({ message: error ?? 'Datos inválidos para actualizar tienda' });
            }

            const store = await this.storeService.updateStore(storeId, updateStoreDto);
            return res.status(200).json(store);
        } catch (err) {
            if (err instanceof CustomError) {
                return res.status(err.statusCode).json({ message: err.message });
            }
            console.error(err);
            return res.status(500).json({ message: 'Error interno del servidor' });
        }
    }

    deactivateStore = async (req: Request, res: Response) => {
        try {
            const storeId = Number(req.params.id);
            if (isNaN(storeId) || storeId <= 0) {
                return res.status(400).json({ message: 'ID de tienda inválido' });
            }

            const store = await this.storeService.deactivateStore(storeId);
            return res.status(200).json(store);
        } catch (err) {
            if (err instanceof CustomError) {
                return res.status(err.statusCode).json({ message: err.message });
            }
            console.error(err);
            return res.status(500).json({ message: 'Error interno del servidor' });
        }
    }
}
