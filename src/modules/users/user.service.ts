import { prisma } from "@/config/db.js";
import { mapUsers } from "./user.mapper.js";

export class UserService {
  static async getCompanyUsers(companyId: string) {
    const users = await prisma.user.findMany({
      where: {
        companyId,
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
