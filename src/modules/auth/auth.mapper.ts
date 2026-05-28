import type { Company, User } from "@prisma/client";
import { mapUser } from "@/modules/users/user.mapper.js";
import { mapCompany } from "@/modules/companies/company.mapper.js";

//  Shared auth/session response payload
type AuthPayload = {
  accessToken: string;
  user: User;
  company: Company;
};

// Normalize auth/session responses
export const mapAuthResponse = ({
  accessToken,
  user,
  company,
}: AuthPayload) => {
  return {
    accessToken,

    user: mapUser(user),

    company: mapCompany(company),
  };
};