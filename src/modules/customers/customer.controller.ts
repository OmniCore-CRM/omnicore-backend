import type { Response } from "express";
import { HTTP_STATUS } from "@/core/constants/http-status.js";
import { sendResponse } from "@/core/utils/send-response.js";
import { asyncHandler } from "@/core/utils/async-handler.js";
import type { AuthenticatedRequest } from "@/core/middleware/auth.middleware.js";
import { CustomerService } from "./customer.service.js";
import { customerListQuerySchema } from "./customer.validation.js";

export class CustomerController {
  // ===== Create customer under authenticated tenant =====
  static createCustomer = asyncHandler(
    async (req: AuthenticatedRequest, res: Response) => {
      // companyId comes from authenticated JWT context
      const companyId = req.user!.companyId;

      // Create tenant-scoped customer
      const customer =
        await CustomerService.createCustomer(
          companyId,
          req.body
        );

      // Send successful API response
      return sendResponse({
        res,
        statusCode: HTTP_STATUS.CREATED,
        message: "Customer created successfully",
        data: customer,
      });
    }
  );

  // ===== Fetch customers belonging to authenticated tenant =====
  static getCustomers = asyncHandler(
    async (req: AuthenticatedRequest, res: Response) => {
      // companyId comes from authenticated JWT context
      const companyId = req.user!.companyId;
      const query = customerListQuerySchema.parse(req.query);

      // Fetch tenant-scoped customers
      const customers = await CustomerService.getCustomers(
        companyId,
        query
      );

      // Send successful API response
      return sendResponse({
        res,
        statusCode: HTTP_STATUS.OK,
        message: "Customers retrieved successfully",
        data: customers,
      });
    }
  );

  // ===== Fetch single customer belonging to authenticated tenant =====
  static getCustomerById = asyncHandler(
    async (req: AuthenticatedRequest, res: Response) => {
      // companyId comes from authenticated JWT context
      const companyId = req.user!.companyId;

      // Extract customer ID from route params
      const customerId = req.params.id as string;

      // Fetch tenant-scoped customer
      const customer =
        await CustomerService.getCustomerById(companyId, customerId);

      // Send successful API response
      return sendResponse({
        res,
        statusCode: HTTP_STATUS.OK,
        message: "Customer retrieved successfully",
        data: customer,
      });
    }
  );
}
