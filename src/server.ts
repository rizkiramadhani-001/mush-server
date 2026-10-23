import { buildApp } from "./app.ts";
import { env } from "./env.ts";

const app = await buildApp();

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "menutup server");
  await app.close();
  process.exit(0);
};

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await app.listen({ host: env.HOST, port: env.PORT });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
