import { Router } from "express";
import { protect } from "@/core/middleware/auth.middleware.js";
import { authorize, RBAC } from "@/core/middleware/authorize.middleware.js";
import { validateRequest } from "@/core/middleware/validate.middleware.js";
import { CompanyController } from "./company.controller.js";
import { companyPortalSettingsUpdateSchema } from "./company.validation.js";

const router = Router();

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
