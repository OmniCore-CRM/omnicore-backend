import { Router } from "express";
import { protect } from "@/core/middleware/auth.middleware.js";
import { validateRequest } from "@/core/middleware/validate.middleware.js";
import { TeamController } from "./team.controller.js";
import { addTeamMemberSchema, createTeamSchema, updateTeamSchema } from "./team.validation.js";

const router = Router();
router.get("/", protect, TeamController.list);
router.post("/", protect, validateRequest(createTeamSchema), TeamController.create);
router.patch("/:id", protect, validateRequest(updateTeamSchema), TeamController.update);
router.delete("/:id", protect, TeamController.remove);
router.post("/:id/members", protect, validateRequest(addTeamMemberSchema), TeamController.addMember);
router.delete("/:id/members/:userId", protect, TeamController.removeMember);
export default router;
