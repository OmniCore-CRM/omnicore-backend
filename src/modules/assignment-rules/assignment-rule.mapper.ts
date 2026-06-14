import type { AssignmentRule, Team } from "@prisma/client";
import { mapTeamSummary } from "@/modules/teams/team.mapper.js";

type AssignmentRuleWithTeam = AssignmentRule & { team: Team };

export const mapAssignmentRule = (rule: AssignmentRuleWithTeam) => ({
  id: rule.id,
  name: rule.name,
  enabled: rule.enabled,
  targetType: rule.targetType,
  conditionType: rule.conditionType,
  conditionValue: rule.conditionValue,
  teamId: rule.teamId,
  team: mapTeamSummary(rule.team),
  createdAt: rule.createdAt,
  updatedAt: rule.updatedAt,
});

export const mapAssignmentRules = (rules: AssignmentRuleWithTeam[]) =>
  rules.map(mapAssignmentRule);
