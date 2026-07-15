import type { Request, Response } from "express";
import { HTTP_STATUS } from "@/core/constants/http-status.js";
import { asyncHandler } from "@/core/utils/async-handler.js";
import { sendResponse } from "@/core/utils/send-response.js";
import type { AuthenticatedRequest } from "@/core/middleware/auth.middleware.js";
import {
  feedbackDetractorsQuerySchema,
  feedbackOverviewQuerySchema,
  feedbackPendingSurveysQuerySchema,
  feedbackPublicParamsSchema,
  feedbackSurveyParamsSchema,
  feedbackSurveyDeliverySchema,
  feedbackSurveyReissueSchema,
  submitFeedbackResponseSchema,
  updateFeedbackEscalationSchema,
} from "./feedback.validation.js";
import { FeedbackService } from "./feedback.service.js";

export class FeedbackController {
  static getOverview = asyncHandler(
    async (req: AuthenticatedRequest, res: Response) => {
      const query = feedbackOverviewQuerySchema.parse(req.query);
      const data = await FeedbackService.getOverview(req.user!.companyId, query);

      return sendResponse({
        res,
        statusCode: HTTP_STATUS.OK,
        message: "Feedback overview retrieved successfully",
        data,
      });
    }
  );

  static getDetractors = asyncHandler(
    async (req: AuthenticatedRequest, res: Response) => {
      const query = feedbackDetractorsQuerySchema.parse(req.query);
      const data = await FeedbackService.getDetractors(req.user!.companyId, query);

      return sendResponse({
        res,
        statusCode: HTTP_STATUS.OK,
        message: "Feedback detractors retrieved successfully",
        data,
      });
    }
  );

  static getPendingSurveys = asyncHandler(
    async (req: AuthenticatedRequest, res: Response) => {
      const query = feedbackPendingSurveysQuerySchema.parse(req.query);
      const data = await FeedbackService.getPendingSurveys(req.user!.companyId, query);

      return sendResponse({
        res,
        statusCode: HTTP_STATUS.OK,
        message: "Pending feedback surveys retrieved successfully",
        data,
      });
    }
  );

  static getTriggerConfigs = asyncHandler(
    async (req: AuthenticatedRequest, res: Response) => {
      const data = await FeedbackService.getTriggerConfigs(req.user!.companyId);

      return sendResponse({
        res,
        statusCode: HTTP_STATUS.OK,
        message: "Feedback trigger config retrieved successfully",
        data,
      });
    }
  );

  static updateTriggerConfig = asyncHandler(
    async (req: AuthenticatedRequest, res: Response) => {
      const data = await FeedbackService.upsertTriggerConfig(
        req.user!.companyId,
        req.user!.userId,
        req.body
      );

      return sendResponse({
        res,
        statusCode: HTTP_STATUS.OK,
        message: "Feedback trigger config updated successfully",
        data,
      });
    }
  );

  static getPublicSurvey = asyncHandler(async (req: Request, res: Response) => {
    const params = feedbackPublicParamsSchema.parse(req.params);
    const data = await FeedbackService.getPublicSurvey(params.token);

    return sendResponse({
      res,
      statusCode: HTTP_STATUS.OK,
      message: "Feedback survey retrieved successfully",
      data,
    });
  });

  static submitPublicSurvey = asyncHandler(async (req: Request, res: Response) => {
    const params = feedbackPublicParamsSchema.parse(req.params);
    const body = submitFeedbackResponseSchema.parse(req.body);
    const data = await FeedbackService.submitPublicSurvey(params.token, body);

    return sendResponse({
      res,
      statusCode: HTTP_STATUS.CREATED,
      message: "Feedback response submitted successfully",
      data,
    });
  });

  static revealPendingSurveyLink = asyncHandler(
    async (req: AuthenticatedRequest, res: Response) => {
      const params = feedbackSurveyParamsSchema.parse(req.params);
      const data = await FeedbackService.revealPendingSurveyLink(
        req.user!.companyId,
        req.user!.userId,
        params.id
      );

      return sendResponse({
        res,
        statusCode: HTTP_STATUS.OK,
        message: "Feedback survey link revealed successfully",
        data,
      });
    }
  );

  static reissuePendingSurveyToken = asyncHandler(
    async (req: AuthenticatedRequest, res: Response) => {
      const params = feedbackSurveyParamsSchema.parse(req.params);
      const body = feedbackSurveyReissueSchema.parse(req.body);
      const data = await FeedbackService.reissuePendingSurveyToken(
        req.user!.companyId,
        req.user!.userId,
        params.id,
        body
      );

      return sendResponse({
        res,
        statusCode: HTTP_STATUS.OK,
        message: "Feedback survey token reissued successfully",
        data,
      });
    }
  );

  static deliverPendingSurvey = asyncHandler(
    async (req: AuthenticatedRequest, res: Response) => {
      const params = feedbackSurveyParamsSchema.parse(req.params);
      const body = feedbackSurveyDeliverySchema.parse(req.body);
      const data = await FeedbackService.deliverPendingSurvey(
        req.user!.companyId,
        req.user!.userId,
        params.id,
        body
      );

      return sendResponse({
        res,
        statusCode: HTTP_STATUS.OK,
        message: "Feedback survey delivery processed",
        data,
      });
    }
  );

  static updateEscalation = asyncHandler(
    async (req: AuthenticatedRequest, res: Response) => {
      const body = updateFeedbackEscalationSchema.parse(req.body);
      const data = await FeedbackService.updateEscalation(
        req.user!.companyId,
        req.user!.userId,
        req.params.id as string,
        body
      );

      return sendResponse({
        res,
        statusCode: HTTP_STATUS.OK,
        message: "Feedback escalation updated successfully",
        data,
      });
    }
  );
}
