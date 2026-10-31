import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { clerkMiddleware } from "@clerk/express";
import { registerPaymentRoutes } from "../payments/routes";
import { publicPlatformScript } from "./publicConfig";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { ENV } from "./env";
import { getClerkMiddlewareOptions, getClerkServerConfig, getPublicClerkStatus } from "./clerkConfig";

async function startServer() {
  const clerkConfig = getClerkServerConfig(ENV);
  const appOrigin = clerkConfig.appOrigin;
  const clerkOptions = getClerkMiddlewareOptions(clerkConfig);
  const app = express();
  const server = createServer(app);

  app.use((req, res, next) => {
    const origin = req.get("origin");
    if (origin && appOrigin && origin !== appOrigin) {
      res.status(403).json({ error: "Origin is not allowed." });
      return;
    }
    if (origin && appOrigin && origin === appOrigin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
      res.setHeader("Access-Control-Max-Age", "600");
      res.vary("Origin");
    }
    if (req.method === "OPTIONS") {
      res.sendStatus(origin && appOrigin === origin ? 204 : 403);
      return;
    }
    next();
  });

  if (clerkOptions) {
    app.use(clerkMiddleware(clerkOptions));
  } else {
    console.warn("[Clerk] Sign-in is disabled until both server Clerk keys are configured.");
  }

  app.use(express.json({
    limit: "1mb",
    verify(req, _res, buffer) {
      if (req.url?.startsWith("/api/payments/paystack/webhook")) {
        (req as typeof req & { rawBody?: Buffer }).rawBody = Buffer.from(buffer);
      }
    },
  }));
  app.use(express.urlencoded({ limit: "16kb", extended: true }));
  app.get("/api/health", (_req, res) => res.json({ status: "ok" }));
  app.get("/api/auth/status", (_req, res) => {
    res.set("Cache-Control", "no-store").json(getPublicClerkStatus(clerkConfig));
  });
  app.get("/api/platform/config.js", (_req, res) => {
    res.set("Cache-Control", "no-store").type("application/javascript").send(publicPlatformScript());
  });
  registerPaymentRoutes(app);
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const port = Number(process.env.PORT || "3000");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid PORT");
  server.on("error", error => { console.error("Server failed:", error.message); process.exit(1); });
  server.listen(port, "0.0.0.0", () => console.log(`Server listening on port ${port}`));
}

startServer().catch(error => { console.error(error); process.exit(1); });
