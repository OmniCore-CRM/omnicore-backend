import {
  AssignmentRuleConditionType,
  AssignmentRuleTargetType,
  ConversationChannel,
  TicketPriority,
} from "@prisma/client";
import { z } from "zod";

const ruleFields = {
  name: z.string().trim().min(1, "Name is required").max(120),
  enabled: z.boolean(),
  targetType: z.enum(AssignmentRuleTargetType),
  conditionType: z.enum(AssignmentRuleConditionType),
  conditionValue: z.string().trim().min(1, "Condition value is required").max(128),
  teamId: z.string().trim().min(1, "Team is required").max(128),
};

const validateCondition = (
  data: {
    targetType?: AssignmentRuleTargetType;
    conditionType?: AssignmentRuleConditionType;
    conditionValue?: string;
  },
  context: z.RefinementCtx
) => {
  if (!data.targetType || !data.conditionType || !data.conditionValue) return;

  if (
    data.targetType === AssignmentRuleTargetType.CONVERSATION &&
    data.conditionType !== AssignmentRuleConditionType.CHANNEL
  ) {
    context.addIssue({
      code: "custom",
      path: ["conditionType"],
      message: "Conversation rules only support channel conditions",
    });
  }

  if (
    data.targetType === AssignmentRuleTargetType.TICKET &&
    data.conditionType !== AssignmentRuleConditionType.PRIORITY &&
    data.conditionType !== AssignmentRuleConditionType.TAG
  ) {
    context.addIssue({
      code: "custom",
      path: ["conditionType"],
      message: "Ticket rules only support priority or tag conditions",
    });
  }

  if (
    data.conditionType === AssignmentRuleConditionType.CHANNEL &&
    data.conditionValue !== ConversationChannel.WHATSAPP &&
    data.conditionValue !== ConversationChannel.WEBSITE
  ) {
    context.addIssue({
      code: "custom",
      path: ["conditionValue"],
      message: "Channel must be WEBSITE or WHATSAPP",
    });
  }

  if (
    data.conditionType === AssignmentRuleConditionType.PRIORITY &&
    !Object.values(TicketPriority).includes(data.conditionValue as TicketPriority)
  ) {
    context.addIssue({
      code: "custom",
      path: ["conditionValue"],
      message: "Priority is invalid",
    });
  }
};

export const createAssignmentRuleSchema = z
  .object({
    ...ruleFields,
    enabled: ruleFields.enabled.default(true),
  })
  .superRefine(validateCondition);

export const updateAssignmentRuleSchema = z
  .object({
    name: ruleFields.name.optional(),
    enabled: ruleFields.enabled.optional(),
    targetType: ruleFields.targetType.optional(),
    conditionType: ruleFields.conditionType.optional(),
    conditionValue: ruleFields.conditionValue.optional(),
    teamId: ruleFields.teamId.optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field is required",
  });

export type CreateAssignmentRuleInput = z.infer<
  typeof createAssignmentRuleSchema
>;
export type UpdateAssignmentRuleInput = z.infer<
  typeof updateAssignmentRuleSchema
>;
