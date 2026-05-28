import { prisma } from "@/config/db.js";
import type { CreateCustomerInput } from "./customer.validation.js";
import { AppError } from "@/core/errors/app-error.js";
import { HTTP_STATUS } from "@/core/constants/http-status.js";
import { mapCustomer, mapCustomers } from "./customer.mapper.js";

export class CustomerService {
  // ===== Create customer under authenticated tenant =====
  static async createCustomer(
    companyId: string,
    data: CreateCustomerInput
  ) {
    const customer = await prisma.customer.create({
      data: {
        ...data,

        // Securely attach tenant ownership
        companyId,
      },
    });

    return mapCustomer(customer);
  }

  // ===== Fetch customers belonging to authenticated tenant =====
  static async getCustomers(companyId: string) {
    const customers = await prisma.customer.findMany({
      where: {
        companyId,
      },

      orderBy: {
        createdAt: "desc",
      },
    });

    return mapCustomers(customers);
  }

  // ===== Fetch single customer belonging to authenticated tenant =====
  static async getCustomerById(
    companyId: string,
    customerId: string
  ) {
    const customer = await prisma.customer.findFirst({
      where: {
        id: customerId,

        // Enforce tenant ownership
        companyId,
      },
    });

    // Prevent access to non-existent or foreign tenant customer
    if (!customer) {
      throw new AppError(
        "Customer not found",
        HTTP_STATUS.NOT_FOUND
      );
    }
    return mapCustomer(customer);
  }
}