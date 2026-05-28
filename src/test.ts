import { prisma } from "@/config/db.js";

async function main() {
  const companies = await prisma.company.findMany();

  console.log(companies);
}

main();