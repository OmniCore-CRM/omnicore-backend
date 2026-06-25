import { prisma } from "@/config/db.js";
import type {
  CreateCustomerInput,
  CustomerListQueryInput,
} from "./customer.validation.js";
import { AppError } from "@/core/errors/app-error.js";
import { HTTP_STATUS } from "@/core/constants/http-status.js";
import {
  mapCustomer,
  mapCustomerDetail,
  mapCustomers,
} from "./customer.mapper.js";
import { toPaginatedResult } from "@/core/utils/pagination.js";
import type { Prisma } from "@prisma/client";

const safeUserSelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  role: true,
} satisfies Prisma.UserSelect;

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
    params: CustomerListQueryInput
  ) {
    const search = params.search?.trim();
    const filters: Prisma.CustomerWhereInput[] = [];

    if (search) {
      filters.push({
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
      });
    }

    if (params.tagId) {
      filters.push({
        tags: {
          some: {
            companyId,
            tagId: params.tagId,
          },
        },
      });
    }

    if (params.createdFrom || params.createdTo) {
      filters.push({
        createdAt: {
          ...(params.createdFrom ? { gte: params.createdFrom } : {}),
          ...(params.createdTo ? { lte: params.createdTo } : {}),
        },
      });
    }

    if (params.lastActivityFrom || params.lastActivityTo) {
      const activityRange = {
        ...(params.lastActivityFrom ? { gte: params.lastActivityFrom } : {}),
        ...(params.lastActivityTo ? { lte: params.lastActivityTo } : {}),
      };
      filters.push({
        OR: [
          { updatedAt: activityRange },
          { conversations: { some: { companyId, updatedAt: activityRange } } },
          { tickets: { some: { companyId, updatedAt: activityRange } } },
        ],
      });
    }

    const where: Prisma.CustomerWhereInput = {
      companyId,
      ...(filters.length ? { AND: filters } : {}),
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
            assignee: { select: safeUserSelect },
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
                actor: { select: safeUserSelect },
              },
              orderBy: {
                createdAt: "desc",
              },
            },
            notes: {
              include: {
                author: { select: safeUserSelect },
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
