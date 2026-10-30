import server from "@adonisjs/core/services/server";

server.use([
  () => import("@adonisjs/core/bodyparser_middleware"),
  () => import("../app/middleware/cors_middleware.js"),
]);
