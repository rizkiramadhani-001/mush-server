import { defineConfig as defineHttpConfig } from "@adonisjs/core/http";

export default {
  appKey: process.env.APP_KEY,
  http: defineHttpConfig({}),
};
