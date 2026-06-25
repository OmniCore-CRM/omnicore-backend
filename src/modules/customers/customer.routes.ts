import { Router } from "express";
import { protect } from "@/core/middleware/auth.middleware.js";
import { authorize, RBAC } from "@/core/middleware/authorize.middleware.js";
import { validateRequest } from "@/core/middleware/validate.middleware.js";
import { CustomerController } from "./customer.controller.js";
import { createCustomerSchema } from "./customer.validation.js";
import { TagController } from "@/modules/tags/tag.controller.js";

const router = Router();

// Create tenant-scoped customer
router.post(
  "/",
  protect,
  authorize(...RBAC.operational),
  validateRequest(createCustomerSchema),
  CustomerController.createCustomer
);

// Fetch tenant-scoped customers
router.get(
  "/",
  protect,
  CustomerController.getCustomers
);

// Fetch single tenant-scoped customer
router.get(
  "/:id",
  protect,
  CustomerController.getCustomerById
);

router.post("/:id/tags", protect, authorize(...RBAC.operational), TagController.attachCustomerTag);

router.delete(
  "/:id/tags/:tagId",
  protect,
  authorize(...RBAC.operational),
  TagController.removeCustomerTag
);

export default router;
