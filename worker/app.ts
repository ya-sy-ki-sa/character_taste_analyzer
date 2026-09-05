import { analysisDomainValues, apiPrefixForDomain } from "../shared/analysis-domain";
import { csrfMiddleware, rateLimitMiddleware, sessionMiddleware } from "./auth";
import { handleError } from "./error-handler";
import { createApiRouter } from "./http";
import { requestBodyLimit, requestMetadata } from "./middleware";
import { createAccountRoutes } from "./routes/account";
import { createAuthRoutes } from "./routes/auth";
import { createEntriesRoutes } from "./routes/entries";
import { createGenerationRoutes } from "./routes/generation";
import { createHealthRoutes } from "./routes/health";
import { createJobsRoutes } from "./routes/jobs";
import { createProfileRoutes } from "./routes/profile";

export const app = createApiRouter();

app.use("*", requestMetadata);
app.use("/api/v1/*", requestBodyLimit);
app.use("/api/v1/*", sessionMiddleware);
app.use("/api/v1/*", rateLimitMiddleware);
app.use("/api/v1/*", csrfMiddleware);

app.route("/api/v1/health", createHealthRoutes());
app.route("/api/v1", createAuthRoutes());
for (const domain of analysisDomainValues) {
  const prefix = apiPrefixForDomain(domain);
  app.route(prefix, createEntriesRoutes(domain));
  app.route(prefix, createProfileRoutes(domain));
  app.route(prefix, createGenerationRoutes(domain));
  app.route(prefix, createJobsRoutes(domain));
}
app.route("/api/v1/account", createAccountRoutes());

app.onError(handleError);
