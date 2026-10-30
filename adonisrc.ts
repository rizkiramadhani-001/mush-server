import { defineConfig } from "@adonisjs/core/app";

export default defineConfig({
  preloads: [
    () => import("./start/kernel.js"),
    () => import("./start/routes.js"),
  ],
  providers: [() => import("@adonisjs/core/providers/app_provider")],
  commands: [
    () => import("@adonisjs/core/commands"),
  ],
});
