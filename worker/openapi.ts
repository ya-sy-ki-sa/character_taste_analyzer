import { app } from "./app";

/** Generated directly from the routes, validators and response schemas used at runtime. */
export function buildAsBuiltOpenApi() {
  return app.getOpenAPI31Document({ openapi: "3.1.0", info: { title: "キャラ嗜好ラボ API", version: "2.0.0" } });
}
