import type { SlaPolicy } from "@prisma/client";

export const mapSlaPolicy = (policy: SlaPolicy) => ({
  id: policy.id,
  name: policy.name,
  priority: policy.priority,
  firstResponseMinutes: policy.firstResponseMinutes,
  resolutionMinutes: policy.resolutionMinutes,
  enabled: policy.enabled,
  createdAt: policy.createdAt,
  updatedAt: policy.updatedAt,
});

export const mapSlaPolicies = (policies: SlaPolicy[]) =>
  policies.map(mapSlaPolicy);
