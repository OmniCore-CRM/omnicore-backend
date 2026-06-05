import { prisma } from "@/config/db.js";
import type { CreateCustomerInput } from "./customer.validation.js";
import { AppError } from "@/core/errors/app-error.js";
import { HTTP_STATUS } from "@/core/constants/http-status.js";
import {
  mapCustomer,
  mapCustomerDetail,
  mapCustomers,
} from "./customer.mapper.js";
import type { PaginationParams } from "@/core/utils/pagination.js";
import { toPaginatedResult } from "@/core/utils/pagination.js";
import type { Prisma } from "@prisma/client";

type CustomerListParams = PaginationParams & {
  search?: unknown;
};

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
  static async getCustomers(
    companyId: string,
    params: CustomerListParams
  ) {
    const search =
      typeof params.search === "string"
        ? params.search.trim()
        : "";

    const where: Prisma.CustomerWhereInput = {
      companyId,
      ...(search
        ? {
            OR: [
              {
                firstName: {
                  contains: search,
                  mode: "insensitive",
                },
              },
              {
                lastName: {
                  contains: search,
                  mode: "insensitive",
                },
              },
              {
                email: {
                  contains: search,
                  mode: "insensitive",
                },
              },
              {
                phone: {
                  contains: search,
                  mode: "insensitive",
                },
              },
            ],
          }
        : {}),
    };

    const customers = await prisma.customer.findMany({
      where,
      include: {
        tags: {
          include: {
            tag: true,
          },
          orderBy: {
            createdAt: "asc",
          },
        },
      },

      orderBy: [
        {
          createdAt: "desc",
        },
        {
          id: "desc",
        },
      ],

      take: params.limit + 1,
      ...(params.cursor
        ? {
            cursor: {
              id: params.cursor,
            },
            skip: 1,
          }
        : {}),
    });

    const page = toPaginatedResult(customers, params.limit);

    return {
      ...page,
      items: mapCustomers(page.items),
    };
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
      include: {
        conversations: {
          include: {
            tags: {
              include: {
                tag: true,
              },
              orderBy: {
                createdAt: "asc",
              },
            },
            messages: {
              orderBy: [
                {
                  createdAt: "desc",
                },
                {
                  id: "desc",
                },
              ],
              take: 50,
            },
          },
          orderBy: [
            {
              updatedAt: "desc",
            },
            {
              id: "desc",
            },
          ],
        },
        tickets: {
          include: {
            assignee: true,
            tags: {
              include: {
                tag: true,
              },
              orderBy: {
                createdAt: "asc",
              },
            },
            activities: {
              include: {
                actor: true,
              },
              orderBy: {
                createdAt: "desc",
              },
            },
            notes: {
              include: {
                author: true,
              },
              orderBy: {
                createdAt: "desc",
              },
            },
          },
          orderBy: [
            {
              updatedAt: "desc",
            },
            {
              id: "desc",
            },
          ],
        },
        tags: {
          include: {
            tag: true,
          },
          orderBy: {
            createdAt: "asc",
          },
        },
      },
    });

    // Prevent access to non-existent or foreign tenant customer
    if (!customer) {
      throw new AppError(
        "Customer not found",
        HTTP_STATUS.NOT_FOUND
      );
    }
    return mapCustomerDetail(customer);
  }
}
