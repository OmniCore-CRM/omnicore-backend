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

router.post(
	"/:id/invite",
	protect,
	authorize(...RBAC.admin),
	UserController.sendCompanyUserInvite,
);

router.post(
	"/:id/invite/resend",
	protect,
	authorize(...RBAC.admin),
	UserController.resendCompanyUserInvite,
);

router.post(
	"/:id/invite/revoke",
	protect,
	authorize(...RBAC.admin),
	UserController.revokeCompanyUserInvite,
);

export default router;
