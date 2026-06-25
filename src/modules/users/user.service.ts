import { prisma } from "@/config/db.js";
import { mapUsers } from "./user.mapper.js";

export class UserService {
  static async getCompanyUsers(companyId: string) {
    const users = await prisma.user.findMany({
      where: {
        companyId,
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        companyId: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: [
        {
          firstName: "asc",
        },
        {
          lastName: "asc",
        },
      ],
    });

    return mapUsers(users);
  }
}
