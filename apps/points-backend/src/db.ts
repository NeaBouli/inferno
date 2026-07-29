import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "./generated/prisma/client.js";

export function createPrismaClient(): PrismaClient {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  const adapter = new PrismaBetterSqlite3(
    { url: databaseUrl },
    { timestampFormat: "unixepoch-ms" },
  );
  return new PrismaClient({ adapter });
}

export const prisma = createPrismaClient();
