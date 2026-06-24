import { ConversationChannel, ProviderAccountStatus } from "@prisma/client";
import { env } from "@/config/env.js";
import { prisma } from "@/config/db.js";
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

export const resolveWhatsAppIngestionCompanyId = async (
  phoneNumberId?: string
) => {
  const normalizedPhoneNumberId = phoneNumberId?.trim();

  if (normalizedPhoneNumberId) {
    const account = await prisma.whatsAppAccount.findFirst({
      where: {
        phoneNumberId: normalizedPhoneNumberId,
        status: ProviderAccountStatus.ACTIVE,
      },
      select: { companyId: true },
    });

    if (account) return account.companyId;
  }

  if (
    env.NODE_ENV === "development" &&
    env.ALLOW_UNSIGNED_WEBHOOKS_IN_DEVELOPMENT &&
    env.WHATSAPP_PHONE_NUMBER_ID &&
    normalizedPhoneNumberId === env.WHATSAPP_PHONE_NUMBER_ID
  ) {
    return resolveDevelopmentIngestionCompanyId();
  }

  throw new AppError(
    `${ConversationChannel.WHATSAPP} provider account not found`,
    HTTP_STATUS.FORBIDDEN
  );
};
