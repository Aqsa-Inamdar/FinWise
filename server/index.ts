import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  const server = await registerRoutes(app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || '5000', 10);
  // Attempt to listen with reusePort (better for some hosting setups).
  // Some platforms/node builds may not support the `reusePort` option and will
  // emit an ENOTSUP error. In that case we retry without the option.
  const listenOptions = {
    port,
    host: "0.0.0.0",
    reusePort: true,
  } as const;

  const onListening = () => {
    log(`serving on port ${port}`);
  };

  // Add a one-time error handler to detect ENOTSUP and retry without reusePort.
  const onError = (err: any) => {
    // If the platform doesn't support the option, retry without reusePort.
    if (err && (err.code === "ENOTSUP" || err.code === "EINVAL")) {
      log(`listen option reusePort not supported; retrying without it (${err.code})`, "express");
      // remove this handler to avoid handling the next error
      server.removeListener("error", onError);
      // retry without the object options
      server.listen(port, "0.0.0.0", onListening);
      return;
    }

    // otherwise rethrow so the process fails loudly as before
    throw err;
  };

  server.once("error", onError);
  server.listen(listenOptions, onListening);
})();
