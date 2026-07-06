# Backend Deployment Notes

## Render Start Command Policy

Render must start the backend with a server-only command:

- `npm run start:staging`

Do not run migrations in Render start/deploy commands.

## Prisma Migration Policy

Prisma migrations for this project are handled manually in Supabase SQL Editor.

Because of this workflow:

- Do NOT use `npx prisma migrate deploy` in Render start command.
- Do NOT use `npx prisma migrate deploy` in Render post-deploy command.
- Do NOT use `npx prisma migrate reset`.

## Recommended Render Commands

- Build command: `npm ci && npm run build`
- Start command: `npm run start:staging`

## Prisma Client Usage

The backend uses a singleton Prisma client in `src/config/db.ts`.
Avoid creating additional `PrismaClient` instances in request handlers or services.
