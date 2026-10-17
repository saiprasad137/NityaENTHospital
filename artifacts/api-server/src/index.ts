import fs from "node:fs";
import path from "node:path";

// Auto-load root .env if present
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
    break;
  }
}

import app from "./app";
import { logger } from "./lib/logger";

const rawPort = process.env["PORT"] || "8080";
const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, `API server listening on port ${port}`);
});
