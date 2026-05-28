import type { User } from "@prisma/client";

// ===== Normalize single user response =====
export const mapUser = (user: User) => {
  return {
    id: user.id,

    email: user.email,

    firstName: user.firstName,
    lastName: user.lastName,

    role: user.role,

    companyId: user.companyId,

    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
};

// ===== Normalize multiple users response =====
export const mapUsers = (users: User[]) => {
  return users.map(mapUser);
};