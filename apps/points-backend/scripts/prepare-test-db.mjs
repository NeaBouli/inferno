import { closeSync, mkdirSync, openSync } from "node:fs";
import { basename, dirname, isAbsolute, resolve } from "node:path";

if (process.env.NODE_ENV === "production") {
  throw new Error("Test database preparation is disabled in production");
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl?.startsWith("file:")) {
  throw new Error("DATABASE_URL must reference a SQLite test file");
}

const configuredPath = databaseUrl.slice("file:".length);
const databasePath = isAbsolute(configuredPath)
  ? configuredPath
  : resolve(process.cwd(), configuredPath);

if (!basename(databasePath).toLowerCase().includes("test")) {
  throw new Error("Refusing to prepare a database without 'test' in its filename");
}

mkdirSync(dirname(databasePath), { recursive: true });
closeSync(openSync(databasePath, "a"));
