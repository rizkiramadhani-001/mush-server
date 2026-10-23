import cors from "@fastify/cors";
import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import { z } from "zod";
import { classify } from "./classify.ts";
import { CONFIG } from "./config.ts";
import { prisma } from "./db.ts";
import { env } from "./env.ts";

const readingInput = z.object({
  drum_id: z.string().trim().min(1).max(32),
  suhu: z.number().finite(),
  kelembapan: z.number().finite().min(0).max(100),
  t: z.iso.datetime({ offset: true }).optional(),
});

const latestQuery = z.object({
  drum: z.string().trim().min(1).max(32),
});

const timeFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: env.APP_TZ,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const hhmm = (value: Date) => timeFormat.format(value);

const round1 = (value: number) => Math.round(value * 10) / 10;

interface HistoryRow {
  bucket: Date;
  avg: number;
}

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: env.NODE_ENV !== "test" });

  const origins =
    env.CORS_ORIGIN === "*"
      ? true
      : env.CORS_ORIGIN.split(",").map((origin) => origin.trim()).filter(Boolean);

  await app.register(cors, { origin: origins });

  app.addHook("onClose", async () => {
    await prisma.$disconnect();
  });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    request.log.error(error);
    const status = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
    reply.code(status).send({ error: status === 500 ? "Internal server error" : error.message });
  });

  app.get("/health", async (request, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return { ok: true };
    } catch (error) {
      request.log.error(error);
      return reply.code(503).send({ ok: false });
    }
  });

  app.get("/api/drums", async () => {
    const drums = await prisma.drum.findMany({
      orderBy: { id: "asc" },
      select: { id: true },
    });
    return { drums };
  });

  app.get("/api/latest", async (request, reply) => {
    const query = latestQuery.safeParse(request.query);
    if (!query.success) {
      return reply.code(400).send({ error: "Query drum wajib diisi" });
    }

    const drumId = query.data.drum;
    const [drum, latest] = await Promise.all([
      prisma.drum.findUnique({ where: { id: drumId } }),
      prisma.reading.findFirst({
        where: { drumId },
        orderBy: { recordedAt: "desc" },
      }),
    ]);

    if (!drum) {
      return reply.code(404).send({ error: `Batch ${drumId} tidak dikenal` });
    }
    if (!latest) {
      return reply.code(404).send({ error: `Batch ${drumId} belum memiliki pembacaan` });
    }

    const now = new Date();
    const since24 = new Date(now.getTime() - CONFIG.HISTORY_HOURS * 3_600_000);
    const since7 = new Date(now.getTime() - CONFIG.HISTORY_DAYS * CONFIG.DAY_MS);

    const [logs, h24Desc, h7Desc] = await Promise.all([
      prisma.reading.findMany({
        where: { drumId },
        orderBy: { recordedAt: "desc" },
        take: CONFIG.LOG_POINTS,
        select: { recordedAt: true, suhu: true, kelembapan: true },
      }),
      prisma.$queryRaw<HistoryRow[]>`
        SELECT date_trunc('hour', "recorded_at" AT TIME ZONE ${env.APP_TZ}) AS bucket,
               AVG("suhu")::float8 AS avg
        FROM "readings"
        WHERE "drum_id" = ${drumId} AND "recorded_at" >= ${since24}
        GROUP BY bucket
        ORDER BY bucket DESC
        LIMIT ${CONFIG.HISTORY_HOURS}
      `,
      prisma.$queryRaw<HistoryRow[]>`
        SELECT date_trunc('day', "recorded_at" AT TIME ZONE ${env.APP_TZ}) AS bucket,
               AVG("suhu")::float8 AS avg
        FROM "readings"
        WHERE "drum_id" = ${drumId} AND "recorded_at" >= ${since7}
        GROUP BY bucket
        ORDER BY bucket DESC
        LIMIT ${CONFIG.HISTORY_DAYS}
      `,
    ]);

    const elapsedDays = Math.floor((now.getTime() - drum.startedAt.getTime()) / CONFIG.DAY_MS);
    const hari = Math.min(drum.totalDays, Math.max(1, elapsedDays + 1));
    const classification = classify(latest.suhu, latest.kelembapan);

    return {
      drum_id: drum.id,
      suhu: latest.suhu,
      kelembapan: latest.kelembapan,
      hari,
      total_hari: drum.totalDays,
      progres_pct: Math.round((hari / drum.totalDays) * 100),
      status: classification.status,
      ml_label: classification.mlLabel,
      sinkron: hhmm(latest.recordedAt),
      sumber: `sensor drum ${drum.id}`,
      log: logs.map((row) => ({
        t: hhmm(row.recordedAt),
        suhu: row.suhu,
        hum: row.kelembapan,
      })),
      h24: h24Desc.toReversed().map((row) => round1(row.avg)),
      h7: h7Desc.toReversed().map((row) => round1(row.avg)),
    };
  });

  app.post("/api/readings", async (request, reply) => {
    const input = readingInput.safeParse(request.body);
    if (!input.success) {
      return reply.code(400).send({
        error: "Payload tidak valid",
        issues: input.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
    }

    const { drum_id, suhu, kelembapan, t } = input.data;
    const drum = await prisma.drum.findUnique({
      where: { id: drum_id },
      select: { id: true },
    });

    if (!drum) {
      return reply.code(404).send({ error: `Batch ${drum_id} tidak dikenal` });
    }

    await prisma.reading.create({
      data: {
        drumId: drum_id,
        suhu,
        kelembapan,
        recordedAt: t ? new Date(t) : new Date(),
      },
    });

    const classification = classify(suhu, kelembapan);
    return reply.code(200).send({
      ok: true,
      ml_label: classification.mlLabel,
      status: classification.status,
    });
  });

  return app;
}
