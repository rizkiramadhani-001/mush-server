import router from "@adonisjs/core/services/router";
import MushController from "../app/controllers/mush_controller.ts";

router.get("/health", [MushController, "health"]);
router.get("/api/drums", [MushController, "drums"]);
router.get("/api/latest", [MushController, "latest"]);
router.get("/api/predict", [MushController, "predict"]);
router.post("/api/readings", [MushController, "readings"]);
router.post("/api/press-events", [MushController, "pressEvents"]);
