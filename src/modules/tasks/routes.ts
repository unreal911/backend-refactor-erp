import { Router } from "express";
import { AuthMiddleware } from "../../presentation/auth/middleware";
import { OperationalTaskController, StoreAssignmentController } from "./controller";

export function registerOperationalTaskRoutes(router: Router): void {
    const tasks = new OperationalTaskController();
    const assignments = new StoreAssignmentController();
    const authenticated = AuthMiddleware.validateJWT;
    const enabled = AuthMiddleware.requirePlanFeature("tasks.operational");

    router.get("/api/tasks", authenticated, enabled, AuthMiddleware.requirePermission(["tasks.view.own", "tasks.view.all"]), tasks.list);
    router.get("/api/tasks/:id", authenticated, enabled, AuthMiddleware.requirePermission(["tasks.view.own", "tasks.view.all"]), tasks.get);
    router.post("/api/tasks/:id/assign", authenticated, enabled, AuthMiddleware.requirePermission("tasks.assign"), tasks.assign);
    router.post("/api/tasks/:id/accept", authenticated, enabled, AuthMiddleware.requirePermission("tasks.view.own"), tasks.transition("accept"));
    router.post("/api/tasks/:id/reject", authenticated, enabled, AuthMiddleware.requirePermission("tasks.view.own"), tasks.transition("reject"));
    router.post("/api/tasks/:id/start", authenticated, enabled, AuthMiddleware.requirePermission("tasks.view.own"), tasks.transition("start"));
    router.post("/api/tasks/:id/complete", authenticated, enabled, AuthMiddleware.requirePermission("tasks.view.own"), tasks.transition("complete"));
    router.post("/api/tasks/:id/delivery-failure", authenticated, enabled, AuthMiddleware.requirePermission("tasks.view.own"), tasks.reportDeliveryFailure);
    router.patch("/api/tasks/:id/items/:orderItemId", authenticated, enabled, AuthMiddleware.requirePermission("tasks.view.own"), tasks.pickItem);

    router.get("/api/users/:userId/store-assignments", authenticated, AuthMiddleware.requirePermission("store_assignments.view"), assignments.list);
    router.post("/api/users/:userId/store-assignments", authenticated, AuthMiddleware.requirePermission("store_assignments.manage"), assignments.create);
    router.patch("/api/users/:userId/store-assignments/:assignmentId/finish", authenticated, AuthMiddleware.requirePermission("store_assignments.manage"), assignments.finish);
}
