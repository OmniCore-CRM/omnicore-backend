import type { User } from "@prisma/client";

type SafeUser = Pick<
  User,
  | "id"
  | "email"
  | "firstName"
  | "lastName"
  | "role"
  | "status"
  | "companyId"
  | "createdAt"
  | "updatedAt"
>;

// ===== Normalize single user response =====
export const mapUser = (user: SafeUser) => {
  return {
    id: user.id,

    email: user.email,

    firstName: user.firstName,
    lastName: user.lastName,

    role: user.role,

    status: user.status,

    companyId: user.companyId,

    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
};

// ===== Normalize multiple users response =====
export const mapUsers = (users: SafeUser[]) => {
  return users.map(mapUser);
};