import { Ignitor } from "@adonisjs/core";

const APP_ROOT = new URL("../", import.meta.url);
new Ignitor(APP_ROOT, { importer: (filePath) => import(filePath) }).httpServer().start();
