import fs from "node:fs";
import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

// Auto-load .env from workspace root or current directory if DATABASE_URL is not set
if (!process.env.DATABASE_URL) {
  const envCandidates = [
    path.resolve(process.cwd(), ".env"),
    path.resolve(import.meta.dirname, "../../../.env"),
    path.resolve(import.meta.dirname, "../.env"),
  ];

  for (const envPath of envCandidates) {
    if (fs.existsSync(envPath)) {
      if (typeof process.loadEnvFile === "function") {
        try {
          process.loadEnvFile(envPath);
        } catch {}
      }
      if (!process.env.DATABASE_URL) {
        try {
          const content = fs.readFileSync(envPath, "utf-8");
          for (const line of content.split("\n")) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith("#")) continue;
            const eqIdx = trimmed.indexOf("=");
            if (eqIdx !== -1) {
              const key = trimmed.slice(0, eqIdx).trim();
              let val = trimmed.slice(eqIdx + 1).trim();
              if (
                (val.startsWith('"') && val.endsWith('"')) ||
                (val.startsWith("'") && val.endsWith("'"))
              ) {
                val = val.slice(1, -1);
              }
              if (!process.env[key]) {
                process.env[key] = val;
              }
            }
          }
        } catch {}
      }
      break;
    }
  }
}

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Please define DATABASE_URL in your root .env file.",
  );
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle(pool, { schema });

export * from "./schema";
