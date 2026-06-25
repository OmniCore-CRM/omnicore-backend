import { Router } from "express";
import { protect } from "@/core/middleware/auth.middleware.js";
import { authorize, RBAC } from "@/core/middleware/authorize.middleware.js";
import { validateRequest } from "@/core/middleware/validate.middleware.js";
import { TeamController } from "./team.controller.js";
import { addTeamMemberSchema, createTeamSchema, updateTeamSchema } from "./team.validation.js";

const router = Router();
router.get("/", protect, TeamController.list);
router.post("/", protect, authorize(...RBAC.adminAndLead), validateRequest(createTeamSchema), TeamController.create);
router.patch("/:id", protect, authorize(...RBAC.adminAndLead), validateRequest(updateTeamSchema), TeamController.update);
router.delete("/:id", protect, authorize(...RBAC.adminAndLead), TeamController.remove);
router.post("/:id/members", protect, authorize(...RBAC.adminAndLead), validateRequest(addTeamMemberSchema), TeamController.addMember);
router.delete("/:id/members/:userId", protect, authorize(...RBAC.adminAndLead), TeamController.removeMember);
export default router;
