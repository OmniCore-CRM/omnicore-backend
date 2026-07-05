import { Router } from "express";
import { protect } from "@/core/middleware/auth.middleware.js";
import { authorize, RBAC } from "@/core/middleware/authorize.middleware.js";
import { validateRequest } from "@/core/middleware/validate.middleware.js";
import { UserController } from "./user.controller.js";
import {
	createUserSchema,
	updateUserSchema,
	updateUserStatusSchema,
} from "./user.validation.js";

const router = Router();

router.get(
	"/",
	protect,
	authorize(...RBAC.adminAndLead),
	UserController.getCompanyUsers,
);

router.post(
	"/",
	protect,
	authorize(...RBAC.admin),
	validateRequest(createUserSchema),
	UserController.createCompanyUser,
);

router.patch(
	"/:id",
	protect,
	authorize(...RBAC.admin),
	validateRequest(updateUserSchema),
	UserController.updateCompanyUser,
);

router.patch(
	"/:id/status",
	protect,
	authorize(...RBAC.admin),
	validateRequest(updateUserStatusSchema),
	UserController.updateCompanyUserStatus,
);

export default router;
