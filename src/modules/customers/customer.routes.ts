import { Router } from "express";
import { protect } from "@/core/middleware/auth.middleware.js";
import { validateRequest } from "@/core/middleware/validate.middleware.js";
import { CustomerController } from "./customer.controller.js";
import { createCustomerSchema } from "./customer.validation.js";

const router = Router();

// Create tenant-scoped customer
router.post(
  "/",
  protect,
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

export default router;