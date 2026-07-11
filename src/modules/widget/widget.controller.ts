import type { Request, Response } from "express";
import { HTTP_STATUS } from "@/core/constants/http-status.js";
import { asyncHandler } from "@/core/utils/async-handler.js";
import { sendResponse } from "@/core/utils/send-response.js";
import type { AuthenticatedRequest } from "@/core/middleware/auth.middleware.js";
import { WidgetService } from "./widget.service.js";
import {
  updateWidgetArticleStatusSchema,
  widgetPublicArticleParamsSchema,
  widgetPublicArticleQuerySchema,
  widgetPublicHelpCenterQuerySchema,
  widgetBootstrapQuerySchema,
  widgetMessagesQuerySchema,
} from "./widget.validation.js";
import { AppError } from "@/core/errors/app-error.js";
import {
  Permissions,
  hasPermission,
} from "@/core/permissions/permission-policy.js";
import { UserRole } from "@prisma/client";

const getRequestOrigin = (req: Request) =>
  req.get("origin") || req.get("referer");

const assertWidgetAdmin = (req: AuthenticatedRequest) => {
  const role = req.user?.role;
  if (!role || !hasPermission(role as UserRole, Permissions.manageWidget)) {
    throw new AppError(
      "Widget settings are restricted to workspace admins",
      HTTP_STATUS.FORBIDDEN
    );
  }
};

const assertKnowledgeBaseManager = (req: AuthenticatedRequest) => {
  const role = req.user?.role;
  if (!role || !hasPermission(role as UserRole, Permissions.manageKnowledgeBase)) {
    throw new AppError(
      "Knowledge base management is restricted to workspace admins and supervisors",
      HTTP_STATUS.FORBIDDEN
    );
  }
};

const assertKnowledgeBaseAdmin = (req: AuthenticatedRequest) => {
  const role = req.user?.role as UserRole | undefined;
  if (!role) {
    throw new AppError(
      "This knowledge base action is restricted to workspace admins",
      HTTP_STATUS.FORBIDDEN
    );
  }

  const isAdminRole =
    role === UserRole.SUPER_ADMIN ||
    role === UserRole.OWNER ||
    role === UserRole.ADMIN;

  if (!isAdminRole) {
    throw new AppError(
      "This knowledge base action is restricted to workspace admins",
      HTTP_STATUS.FORBIDDEN
    );
  }
};

export class WidgetController {
  static getInstallations = asyncHandler(
    async (req: AuthenticatedRequest, res: Response) => {
      assertWidgetAdmin(req);

      const installations = await WidgetService.getInstallations(
        req.user!.companyId
      );

      return sendResponse({
        res,
        statusCode: HTTP_STATUS.OK,
        message: "Widget installations retrieved successfully",
        data: installations,
      });
    }
  );

  static createInstallation = asyncHandler(
    async (req: AuthenticatedRequest, res: Response) => {
      assertWidgetAdmin(req);

      const installation = await WidgetService.createInstallation(
        req.user!.companyId,
        req.body,
        req.user!.userId
      );

      return sendResponse({
        res,
        statusCode: HTTP_STATUS.CREATED,
        message: "Widget installation created successfully",
        data: installation,
      });
    }
  );

  static updateInstallation = asyncHandler(
    async (req: AuthenticatedRequest, res: Response) => {
      assertWidgetAdmin(req);

      const installation = await WidgetService.updateInstallation(
        req.user!.companyId,
        req.params.id as string,
        req.body,
        req.user!.userId
      );

      return sendResponse({
        res,
        statusCode: HTTP_STATUS.OK,
        message: "Widget installation updated successfully",
        data: installation,
      });
    }
  );

  static bootstrap = asyncHandler(
    async (req: Request, res: Response) => {
      const query = widgetBootstrapQuerySchema.parse(req.query);
      const config = await WidgetService.bootstrap(
        query.key,
        getRequestOrigin(req)
      );

      return sendResponse({
        res,
        statusCode: HTTP_STATUS.OK,
        message: "Widget bootstrap retrieved successfully",
        data: config,
      });
    }
  );

  static getPublicHelpCenter = asyncHandler(
    async (req: Request, res: Response) => {
      const query = widgetPublicHelpCenterQuerySchema.parse(req.query);
      const payload = await WidgetService.listPublicHelpCenter(
        query,
        getRequestOrigin(req)
      );

      return sendResponse({
        res,
        statusCode: HTTP_STATUS.OK,
        message: "Public help center retrieved successfully",
        data: payload,
      });
    }
  );

  static getPublicHelpCenterArticle = asyncHandler(
    async (req: Request, res: Response) => {
      const query = widgetPublicArticleQuerySchema.parse(req.query);
      const params = widgetPublicArticleParamsSchema.parse(req.params);
      const payload = await WidgetService.getPublicHelpCenterArticle(
        query.key,
        params.slug,
        getRequestOrigin(req)
      );

      return sendResponse({
        res,
        statusCode: HTTP_STATUS.OK,
        message: "Public help center article retrieved successfully",
        data: payload,
      });
    }
  );

  // ===== Create public widget conversation =====
  static createWidgetConversation = asyncHandler(
    async (req: Request, res: Response) => {
      // Create widget conversation flow
      const result = await WidgetService.createWidgetConversation(
        req.body,
        getRequestOrigin(req)
      );

      // Send successful API response
      return sendResponse({
        res,
        statusCode: HTTP_STATUS.CREATED,
        message: "Widget conversation created successfully",
        data: result,
      });
    }
  );

  static getWidgetMessages = asyncHandler(
    async (req: Request, res: Response) => {
      const query = widgetMessagesQuerySchema.parse(req.query);
      const messages = await WidgetService.getConversationMessages(
        req.params.id as string,
        query,
        getRequestOrigin(req)
      );

      return sendResponse({
        res,
        statusCode: HTTP_STATUS.OK,
        message: "Widget messages retrieved successfully",
        data: messages,
      });
    }
  );

  // ===== Send public widget message =====
  static createWidgetMessage = asyncHandler(
    async (req: Request, res: Response) => {
      // Create widget message
      const message = await WidgetService.createWidgetMessage(
        req.params.id as string,
        req.body,
        getRequestOrigin(req)
      );

      // Send successful API response
      return sendResponse({
        res,
        statusCode: HTTP_STATUS.CREATED,
        message: "Widget message created successfully",
        data: message,
      });
    }
  );

  // ===== FAQ management (admin) =====

  static listFaqEntries = asyncHandler(
    async (req: AuthenticatedRequest, res: Response) => {
      assertWidgetAdmin(req);
      const entries = await WidgetService.listFaqEntries(
        req.user!.companyId,
        req.params.id as string
      );
      return sendResponse({
        res,
        statusCode: HTTP_STATUS.OK,
        message: "FAQ entries retrieved successfully",
        data: entries,
      });
    }
  );

  static createFaqEntry = asyncHandler(
    async (req: AuthenticatedRequest, res: Response) => {
      assertWidgetAdmin(req);
      const entry = await WidgetService.createFaqEntry(
        req.user!.companyId,
        req.params.id as string,
        req.body
      );
      return sendResponse({
        res,
        statusCode: HTTP_STATUS.CREATED,
        message: "FAQ entry created successfully",
        data: entry,
      });
    }
  );

  static updateFaqEntry = asyncHandler(
    async (req: AuthenticatedRequest, res: Response) => {
      assertWidgetAdmin(req);
      const entry = await WidgetService.updateFaqEntry(
        req.user!.companyId,
        req.params.id as string,
        req.params.faqId as string,
        req.body
      );
      return sendResponse({
        res,
        statusCode: HTTP_STATUS.OK,
        message: "FAQ entry updated successfully",
        data: entry,
      });
    }
  );

  static deleteFaqEntry = asyncHandler(
    async (req: AuthenticatedRequest, res: Response) => {
      assertWidgetAdmin(req);
      await WidgetService.deleteFaqEntry(
        req.user!.companyId,
        req.params.id as string,
        req.params.faqId as string
      );
      return sendResponse({
        res,
        statusCode: HTTP_STATUS.OK,
        message: "FAQ entry deleted successfully",
        data: null,
      });
    }
  );

  // ===== Knowledge base management (admin) =====

  static listArticleCategories = asyncHandler(
    async (req: AuthenticatedRequest, res: Response) => {
      assertKnowledgeBaseManager(req);
      const categories = await WidgetService.listArticleCategories(
        req.user!.companyId,
        req.params.id as string
      );
      return sendResponse({
        res,
        statusCode: HTTP_STATUS.OK,
        message: "Knowledge base categories retrieved successfully",
        data: categories,
      });
    }
  );

  static createArticleCategory = asyncHandler(
    async (req: AuthenticatedRequest, res: Response) => {
      assertKnowledgeBaseManager(req);
      const category = await WidgetService.createArticleCategory(
        req.user!.companyId,
        req.params.id as string,
        req.body,
        req.user!.userId
      );
      return sendResponse({
        res,
        statusCode: HTTP_STATUS.CREATED,
        message: "Knowledge base category created successfully",
        data: category,
      });
    }
  );

  static updateArticleCategory = asyncHandler(
    async (req: AuthenticatedRequest, res: Response) => {
      assertKnowledgeBaseManager(req);
      const category = await WidgetService.updateArticleCategory(
        req.user!.companyId,
        req.params.id as string,
        req.params.categoryId as string,
        req.body,
        req.user!.userId
      );
      return sendResponse({
        res,
        statusCode: HTTP_STATUS.OK,
        message: "Knowledge base category updated successfully",
        data: category,
      });
    }
  );

  static deleteArticleCategory = asyncHandler(
    async (req: AuthenticatedRequest, res: Response) => {
      assertKnowledgeBaseAdmin(req);
      await WidgetService.deleteArticleCategory(
        req.user!.companyId,
        req.params.id as string,
        req.params.categoryId as string,
        req.user!.userId
      );
      return sendResponse({
        res,
        statusCode: HTTP_STATUS.OK,
        message: "Knowledge base category deleted successfully",
        data: null,
      });
    }
  );

  static listArticles = asyncHandler(
    async (req: AuthenticatedRequest, res: Response) => {
      assertKnowledgeBaseManager(req);
      const articles = await WidgetService.listArticles(
        req.user!.companyId,
        req.params.id as string
      );
      return sendResponse({
        res,
        statusCode: HTTP_STATUS.OK,
        message: "Knowledge base articles retrieved successfully",
        data: articles,
      });
    }
  );

  static getArticle = asyncHandler(
    async (req: AuthenticatedRequest, res: Response) => {
      assertKnowledgeBaseManager(req);
      const article = await WidgetService.getArticle(
        req.user!.companyId,
        req.params.id as string,
        req.params.articleId as string
      );
      return sendResponse({
        res,
        statusCode: HTTP_STATUS.OK,
        message: "Knowledge base article retrieved successfully",
        data: article,
      });
    }
  );

  static createArticle = asyncHandler(
    async (req: AuthenticatedRequest, res: Response) => {
      assertKnowledgeBaseManager(req);
      const article = await WidgetService.createArticle(
        req.user!.companyId,
        req.params.id as string,
        req.body,
        req.user!.userId
      );
      return sendResponse({
        res,
        statusCode: HTTP_STATUS.CREATED,
        message: "Knowledge base article created successfully",
        data: article,
      });
    }
  );

  static updateArticle = asyncHandler(
    async (req: AuthenticatedRequest, res: Response) => {
      assertKnowledgeBaseManager(req);
      const article = await WidgetService.updateArticle(
        req.user!.companyId,
        req.params.id as string,
        req.params.articleId as string,
        req.body,
        req.user!.userId
      );
      return sendResponse({
        res,
        statusCode: HTTP_STATUS.OK,
        message: "Knowledge base article updated successfully",
        data: article,
      });
    }
  );

  static updateArticleStatus = asyncHandler(
    async (req: AuthenticatedRequest, res: Response) => {
      const statusPayload = updateWidgetArticleStatusSchema.parse(req.body);
      if (statusPayload.status === "ARCHIVED") {
        assertKnowledgeBaseAdmin(req);
      } else {
        assertKnowledgeBaseManager(req);
      }

      const article = await WidgetService.updateArticleStatus(
        req.user!.companyId,
        req.params.id as string,
        req.params.articleId as string,
        statusPayload,
        req.user!.userId
      );
      return sendResponse({
        res,
        statusCode: HTTP_STATUS.OK,
        message:
          statusPayload.status === "PUBLISHED"
            ? "Knowledge base article published successfully"
            : "Knowledge base article archived successfully",
        data: article,
      });
    }
  );

  // ===== Branding uploads (admin) =====

  static uploadLogo = asyncHandler(
    async (req: AuthenticatedRequest, res: Response) => {
      assertWidgetAdmin(req);
      if (!req.file) throw new AppError("File is required", HTTP_STATUS.BAD_REQUEST);
      const installation = await WidgetService.uploadBrandingImage(
        req.user!.companyId,
        req.params.id as string,
        "logoUrl",
        req.file
      );
      return sendResponse({ res, statusCode: HTTP_STATUS.OK, message: "Logo uploaded successfully", data: installation });
    }
  );

  static uploadHero = asyncHandler(
    async (req: AuthenticatedRequest, res: Response) => {
      assertWidgetAdmin(req);
      if (!req.file) throw new AppError("File is required", HTTP_STATUS.BAD_REQUEST);
      const installation = await WidgetService.uploadBrandingImage(
        req.user!.companyId,
        req.params.id as string,
        "heroImageUrl",
        req.file
      );
      return sendResponse({ res, statusCode: HTTP_STATUS.OK, message: "Hero image uploaded successfully", data: installation });
    }
  );

  static removeLogo = asyncHandler(
    async (req: AuthenticatedRequest, res: Response) => {
      assertWidgetAdmin(req);
      const installation = await WidgetService.removeBrandingImage(
        req.user!.companyId,
        req.params.id as string,
        "logoUrl"
      );
      return sendResponse({ res, statusCode: HTTP_STATUS.OK, message: "Logo removed successfully", data: installation });
    }
  );

  static removeHero = asyncHandler(
    async (req: AuthenticatedRequest, res: Response) => {
      assertWidgetAdmin(req);
      const installation = await WidgetService.removeBrandingImage(
        req.user!.companyId,
        req.params.id as string,
        "heroImageUrl"
      );
      return sendResponse({ res, statusCode: HTTP_STATUS.OK, message: "Hero image removed successfully", data: installation });
    }
  );

  static serveBrandingImage = asyncHandler(
    async (req: Request, res: Response) => {
      const { key } = req.params;
      const { buffer, mimeType } = await WidgetService.serveBrandingImage(key as string);
      // Public branding assets must be loadable cross-origin (widget landing page
      // may be served from a different host than the API).
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
      res.setHeader("Content-Type", mimeType);
      res.setHeader("Content-Length", buffer.length);
      res.setHeader("Cache-Control", "public, max-age=3600, immutable");
      res.end(buffer);
    }
  );
}
