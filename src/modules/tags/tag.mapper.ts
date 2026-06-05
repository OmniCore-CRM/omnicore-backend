import type { Tag } from "@prisma/client";

export const mapTag = (tag: Tag) => ({
  id: tag.id,
  companyId: tag.companyId,
  name: tag.name,
  color: tag.color,
  createdAt: tag.createdAt,
  updatedAt: tag.updatedAt,
});

export const mapTags = (tags: Tag[]) => tags.map(mapTag);
