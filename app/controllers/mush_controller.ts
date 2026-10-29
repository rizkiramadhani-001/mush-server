import type { HttpContext } from "@adonisjs/core/http";
import { pressInput, readingInput, ServerAPI } from "../services/server_api.ts";

export default class MushController {
  private readonly api = new ServerAPI();

  async health({ response }: HttpContext) {
    try {
      return await this.api.health();
    } catch {
      return response.status(503).send({ ok: false });
    }
  }

  async drums() {
    return this.api.drums();
  }

  async latest({ request, response }: HttpContext) {
    const drum = request.input("drum");
    if (typeof drum !== "string" || !drum.trim()) {
      return response.badRequest({ error: "Query drum wajib diisi" });
    }

    const result = await this.api.latest(drum);
    return response.status(result.status).send(result.body);
  }

  async predict({ request, response }: HttpContext) {
    const drum = request.input("drum");
    if (typeof drum !== "string" || !drum.trim()) {
      return response.badRequest({ error: "Query drum wajib diisi" });
    }

    const result = await this.api.predict(drum);
    return response.status(result.status).send(result.body);
  }

  async readings({ request, response }: HttpContext) {
    const parsed = readingInput.safeParse(request.body());
    if (!parsed.success) {
      return response.badRequest({
        error: "Payload tidak valid",
        issues: this.formatIssues(parsed.error.issues),
      });
    }

    const result = await this.api.createReading(parsed.data);
    return response.status(result.status).send(result.body);
  }

  async pressEvents({ request, response }: HttpContext) {
    const parsed = pressInput.safeParse(request.body());
    if (!parsed.success) {
      return response.badRequest({
        error: "Payload tidak valid",
        issues: this.formatIssues(parsed.error.issues),
      });
    }

    const result = await this.api.createPressEvent(parsed.data);
    return response.status(result.status).send(result.body);
  }

  private formatIssues(issues: { path: PropertyKey[]; message: string }[]) {
    return issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    }));
  }
}
