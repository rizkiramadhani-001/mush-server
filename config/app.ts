import { defineConfig as defineHttpConfig } from "@adonisjs/core/http";
import { env } from "../start/env.ts";

export default {
  appKey: env.APP_KEY,
  http: defineHttpConfig({}),
};
