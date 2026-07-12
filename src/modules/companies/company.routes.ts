import { Router } from "express";
import { protect } from "@/core/middleware/auth.middleware.js";
import { authorize, RBAC } from "@/core/middleware/authorize.middleware.js";
import { validateRequest } from "@/core/middleware/validate.middleware.js";
import { CompanyController } from "./company.controller.js";
import {
  companyPortalSettingsUpdateSchema,
  companyProfileUpdateSchema,
} from "./company.validation.js";
import { UserRole } from "@prisma/client";

const router = Router();

router.patch(
  "/me",
  protect,
  authorize(UserRole.OWNER, UserRole.ADMIN),
  validateRequest(companyProfileUpdateSchema),
  CompanyController.updateProfile,
);

router.get(
  "/portal-settings",
  protect,
  authorize(...RBAC.admin),
  CompanyController.getPortalSettings
);

router.patch(
  "/portal-settings",
  protect,
  authorize(...RBAC.admin),
  validateRequest(companyPortalSettingsUpdateSchema),
  CompanyController.updatePortalSettings
);

export default router;
