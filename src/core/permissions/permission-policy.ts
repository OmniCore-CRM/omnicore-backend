import { UserRole } from "@prisma/client";

export const Permissions = {
  manageUsers: "manage_users",
  viewUsers: "view_users",
  manageRoles: "manage_roles",
  manageTeams: "manage_teams",
  assignWork: "assign_work",
  manageSettings: "manage_settings",
  manageWidget: "manage_widget",
  manageEmailChannels: "manage_email_channels",
  manageAssignmentRules: "manage_assignment_rules",
  manageSlaPolicies: "manage_sla_policies",
  viewAuditLogs: "view_audit_logs",
  viewAnalytics: "view_analytics",
  manageTags: "manage_tags",
  manageSavedReplies: "manage_saved_replies",
  manageKnowledgeBase: "manage_knowledge_base",
  operationalTicketActions: "operational_ticket_actions",
  operationalConversationActions: "operational_conversation_actions",
} as const;

export type Permission = (typeof Permissions)[keyof typeof Permissions];

const allPermissions = Object.values(Permissions) as Permission[];

const rolePermissions: Record<UserRole, readonly Permission[]> = {
  [UserRole.SUPER_ADMIN]: allPermissions,
  [UserRole.OWNER]: allPermissions,
  [UserRole.ADMIN]: allPermissions,
  [UserRole.TEAM_LEAD]: [
    Permissions.viewUsers,
    Permissions.manageTeams,
    Permissions.assignWork,
    Permissions.viewAnalytics,
    Permissions.manageTags,
    Permissions.manageSavedReplies,
    Permissions.manageKnowledgeBase,
    Permissions.operationalTicketActions,
    Permissions.operationalConversationActions,
  ],
  [UserRole.AGENT]: [
    Permissions.assignWork,
    Permissions.viewAnalytics,
    Permissions.operationalTicketActions,
    Permissions.operationalConversationActions,
  ],
  [UserRole.VIEWER]: [Permissions.viewAnalytics],
};

export const hasPermission = (role: UserRole, permission: Permission) =>
  rolePermissions[role].includes(permission);

export const rolesWithPermission = (permission: Permission) =>
  (Object.values(UserRole) as UserRole[]).filter((role) =>
    hasPermission(role, permission),
  );
