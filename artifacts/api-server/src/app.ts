import fs from "node:fs";
import path from "node:path";
import express, { type Express } from "express";
import cors from "cors";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());
app.use(cors({ credentials: true, origin: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const isClerkKeyValid = (key?: string) =>
  Boolean(key && !key.includes("...") && (key.startsWith("sk_") || key.startsWith("pk_")));

if (isClerkKeyValid(process.env.CLERK_SECRET_KEY) && isClerkKeyValid(process.env.CLERK_PUBLISHABLE_KEY)) {
  app.use(
    clerkMiddleware((req) => ({
      publishableKey: publishableKeyFromHost(
        getClerkProxyHost(req) ?? "",
        process.env.CLERK_PUBLISHABLE_KEY,
      ),
    })),
  );
}

app.use("/api", router);

// Serve frontend static assets in production or standalone mode if built
const candidateDirs = [
  path.resolve(process.cwd(), "artifacts/nitya-ent/dist/public"),
  path.resolve(import.meta.dirname, "../../nitya-ent/dist/public"),
  path.resolve(import.meta.dirname, "../nitya-ent/dist/public"),
];
const staticDir = candidateDirs.find((dir) =>
  fs.existsSync(path.join(dir, "index.html")),
);

if (staticDir) {
  app.use(express.static(staticDir));
  app.use((req, res, next) => {
    if (req.method !== "GET" || req.path.startsWith("/api")) {
      return next();
    }
    res.sendFile(path.join(staticDir, "index.html"));
  });
}

export default app;
