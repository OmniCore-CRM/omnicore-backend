import type { AuditLog, User } from "@prisma/client";

type AuditLogWithActor = AuditLog & {
  actor?: User | null;
};

const mapActor = (actor?: User | null) => {
  if (!actor) return null;
  return {
    id: actor.id,
    email: actor.email,
    firstName: actor.firstName,
    lastName: actor.lastName,
    role: actor.role,
    displayName: [actor.firstName, actor.lastName].filter(Boolean).join(" "),
  };
};

export const mapAuditLog = (log: AuditLogWithActor) => ({
  id: log.id,
  companyId: log.companyId,
  actorId: log.actorId,
  actor: mapActor(log.actor),
  action: log.action,
  entityType: log.entityType,
  entityId: log.entityId,
  metadata: log.metadata,
  createdAt: log.createdAt,
});

export const mapAuditLogs = (logs: AuditLogWithActor[]) =>
  logs.map(mapAuditLog);
