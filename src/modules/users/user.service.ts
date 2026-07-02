import { prisma } from "@/config/db.js";
import { mapUsers } from "./user.mapper.js";

const userListCacheTtlMs = 30_000;

type UserListCacheEntry = {
  expiresAt: number;
  users: ReturnType<typeof mapUsers>;
};

export class UserService {
  private static readonly listCache = new Map<string, UserListCacheEntry>();

  static async getCompanyUsers(companyId: string) {
    const cached = this.listCache.get(companyId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.users;
    }

    if (cached && cached.expiresAt <= Date.now()) {
      this.listCache.delete(companyId);
    }

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

    const mapped = mapUsers(users);
    this.listCache.set(companyId, {
      expiresAt: Date.now() + userListCacheTtlMs,
      users: mapped,
    });
    return mapped;
  }
}
