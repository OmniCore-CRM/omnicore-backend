import type { Team, TeamMember, User } from "@prisma/client";

type TeamWithRelations = Team & {
  members?: (TeamMember & { user: User })[];
  _count?: {
    tickets: number;
    conversations: number;
  };
  tickets?: { status: string }[];
  conversations?: { status: string }[];
};

export const mapTeamSummary = (team?: Team | null) => {
  if (!team) return null;
  return {
    id: team.id,
    name: team.name,
    description: team.description,
  };
};

export const mapTeam = (team: TeamWithRelations) => ({
  id: team.id,
  companyId: team.companyId,
  name: team.name,
  description: team.description,
  members:
    team.members?.map(({ user }) => ({
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      displayName: [user.firstName, user.lastName].filter(Boolean).join(" "),
    })) ?? [],
  ticketCount: team._count?.tickets ?? 0,
  conversationCount: team._count?.conversations ?? 0,
  openTicketCount:
    team.tickets?.filter((ticket) =>
      ["OPEN", "PENDING", "ESCALATED"].includes(ticket.status)
    ).length ?? 0,
  openConversationCount:
    team.conversations?.filter((conversation) =>
      ["OPEN", "PENDING", "SNOOZED"].includes(conversation.status)
    ).length ?? 0,
  createdAt: team.createdAt,
  updatedAt: team.updatedAt,
});

export const mapTeams = (teams: TeamWithRelations[]) => teams.map(mapTeam);
