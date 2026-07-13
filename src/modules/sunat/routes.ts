import { Router } from "express";
import { AuthMiddleware } from "../../presentation/auth/middleware";
import { SunatController } from "./controller";
import { EmisorConfigController } from "./config/emisor-config.controller";

export function registerSunatModuleRoutes(router: Router): void {
    const sunat = Router();
    const controller = new SunatController();
    const configController = new EmisorConfigController();

    // Configuracion del emisor (RUC, credenciales, certificado). Permiso dedicado.
    const requireConfig = AuthMiddleware.requirePermission("sunat.config");
    sunat.get("/config", requireConfig, configController.obtener);
    sunat.put("/config", requireConfig, configController.actualizar);
    sunat.post("/config/certificado", requireConfig, configController.subirCertificado);
    sunat.post("/config/probar", requireConfig, configController.probar);

    // Emision desde una orden (proforma)
    sunat.post("/orders/:orderId/factura", controller.emitirFactura);
    sunat.post("/orders/:orderId/boleta", controller.emitirBoleta);
    sunat.get("/orders/:orderId/comprobantes", controller.listarPorOrder);

    // Notas de credito / debito sobre un comprobante aceptado
    sunat.post("/comprobantes/:id/nota-credito", controller.emitirNotaCredito);
    sunat.post("/comprobantes/:id/nota-debito", controller.emitirNotaDebito);
    sunat.get("/comprobantes/:id", controller.obtener);

    // Bandeja de declaracion: lotes de boletas/notas pendientes de informar
    sunat.get("/pendientes", controller.listarPendientes);

    // Informe del dia: comprobantes declarados vs pendientes
    sunat.get("/informe-dia", controller.informeDia);

    // Reconciliacion: ventas con comprobante solicitado pero no emitido/aceptado
    sunat.get("/reconciliacion", controller.listarReconciliacion);

    // Listado de comprobantes emitidos (con filtros) para el panel de administracion
    sunat.get("/comprobantes", controller.listarComprobantes);

    // Resumen Diario de boletas (envio asincrono): adicion y anulacion
    sunat.post("/resumen-diario", controller.generarResumenDiario);
    sunat.post("/resumen-diario/anulacion", controller.anularBoletas);
    sunat.post("/resumen-diario/:id/consultar", controller.consultarResumen);

    // Comunicacion de Baja (anular facturas y notas aceptadas)
    sunat.post("/comunicacion-baja", controller.generarComunicacionBaja);
    sunat.post("/comunicacion-baja/:id/consultar", controller.consultarComunicacionBaja);

    router.use("/api/sunat", AuthMiddleware.validateJWT, sunat);
}
