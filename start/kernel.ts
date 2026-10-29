import server from "@adonisjs/core/services/server";

server.use([() => import("../app/middleware/cors_middleware.js")]);
