import { env } from "@/config/env.js";
import { HTTP_STATUS } from "@/core/constants/http-status.js";
import { AppError } from "@/core/errors/app-error.js";

export const resolveDevelopmentIngestionCompanyId = () => {
  const companyId = env.DEVELOPMENT_INGESTION_COMPANY_ID?.trim();

  if (env.NODE_ENV === "development" && companyId) {
    return companyId;
  }

  throw new AppError(
    "Public ingestion tenant mapping is not configured",
    HTTP_STATUS.FORBIDDEN
  );
};
