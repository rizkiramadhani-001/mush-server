import type { HttpContext } from "@adonisjs/core/http";
import { env } from "../../start/env.ts";

export default class CorsMiddleware {
  async handle({ request, response }: HttpContext, next: () => Promise<void>) {
    const origin = env.CORS_ORIGIN === "*" ? "*" : env.CORS_ORIGIN.split(",")[0]?.trim() ?? "*";
    response.header("access-control-allow-origin", origin);
    response.header("access-control-allow-methods", "GET,POST,OPTIONS");
    response.header("access-control-allow-headers", "content-type");
    if (request.method() === "OPTIONS") return response.noContent();
    await next();
  }
}
