import type { Team, TeamMember, User } from "@prisma/client";

type SafeUser = Pick<
  User,
  "id" | "email" | "firstName" | "lastName"
> & {
  role: User["role"] | string;
};

type TeamWithRelations = Team & {
  members?: (Omit<
    Pick<TeamMember, "teamId" | "userId" | "createdAt">,
    "createdAt"
  > & {
    createdAt: TeamMember["createdAt"] | string;
    user: SafeUser;
  })[];
  _count?: {
    tickets: number;
    conversations: number;
  };
  ticketCount?: number;
  conversationCount?: number;
  openTicketCount?: number;
  openConversationCount?: number;
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
  ticketCount: team.ticketCount ?? team._count?.tickets ?? 0,
  conversationCount: team.conversationCount ?? team._count?.conversations ?? 0,
  openTicketCount: team.openTicketCount ?? 0,
  openConversationCount: team.openConversationCount ?? 0,
  createdAt: team.createdAt,
  updatedAt: team.updatedAt,
});

export const mapTeams = (teams: TeamWithRelations[]) => teams.map(mapTeam);
