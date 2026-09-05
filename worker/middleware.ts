import { bodyLimit } from "hono/body-limit";
import { createMiddleware } from "hono/factory";
import type { AppEnv } from "./types";

export const requestMetadata = createMiddleware<AppEnv>(async (context, next) => {
  const requestId = context.req.header("CF-Ray") || crypto.randomUUID();
  context.set("requestId", requestId);
  await next();
  context.header("X-Request-Id", requestId);
  context.header("X-Content-Type-Options", "nosniff");
  context.header("Referrer-Policy", "no-referrer");
  context.header("X-Frame-Options", "DENY");
  context.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  context.header(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' https://challenges.cloudflare.com; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  );
  if (context.req.path.startsWith("/api/")) context.header("Cache-Control", "no-store");
});

export const requestBodyLimit = bodyLimit({
  maxSize: 64 * 1024,
  onError: (context) =>
    context.json(
      {
        error: {
          code: "REQUEST_TOO_LARGE",
          message: "リクエストが大きすぎます",
          requestId: context.get("requestId"),
        },
      },
      413,
    ),
});
