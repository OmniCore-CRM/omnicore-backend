import dotenv from "dotenv";

dotenv.config();

const databaseUrl = process.env.DATABASE_URL;
const shadowUrl = process.env.SHADOW_DATABASE_URL;

const normalize = (value: string) => value.trim().replace(/\?.*$/, "").replace(/\/$/, "");

const maskUrl = (value: string) =>
  value
    .replace(/(^[a-zA-Z0-9+.-]+:\/\/)([^@/]+)@/, "$1***:***@")
    .replace(/\?.*$/, "");

if (!databaseUrl) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}

if (!shadowUrl) {
  process.exit(0);
}

if (normalize(databaseUrl) === normalize(shadowUrl)) {
  console.error("Unsafe Prisma configuration detected.");
  console.error(`DATABASE_URL: ${maskUrl(databaseUrl)}`);
  console.error(`SHADOW_DATABASE_URL: ${maskUrl(shadowUrl)}`);
  console.error("DATABASE_URL must never be used as SHADOW_DATABASE_URL.");
  process.exit(1);
}
