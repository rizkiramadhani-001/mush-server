import cors from "@fastify/cors";
import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import { z } from "zod";
import type { PrismaClient } from "../generated/prisma/client.ts";
import { Batch } from "./domain/batch.ts";
import { Drum } from "./domain/drum.ts";
import { Reading } from "./domain/reading.ts";
import { PressEvent } from "./domain/press-event.ts";
import { ModelML, type MlResponse } from "./model-ml.ts";
import { CONFIG } from "./config.ts";
import { prisma } from "./db.ts";
import { env } from "./env.ts";

const drumField = z.string().trim().min(1).max(32);

const readingInput = z.object({
  drum_id: drumField,
  suhu: z.number().finite(),
  kelembapan: z.number().int().min(0).max(100).optional(),
  tekanan: z.number().finite().optional(),
  gas: z.number().int().min(0).optional(),
  t: z.iso.datetime({ offset: true }).optional(),
});

const pressInput = z.object({
  drum_id: drumField,
  gaya_tekan: z.number().finite().nonnegative(),
  t: z.iso.datetime({ offset: true }).optional(),
});

const latestQuery = z.object({
  drum: drumField,
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

export class ServerAPI {
  constructor(
    private readonly db: PrismaClient = prisma,
    private readonly modelML: ModelML = new ModelML(env.ML_URL),
  ) {}

  async getLatest(batchId: number): Promise<Reading | null> {
    const row = await this.db.reading.findFirst({
      where: { batchId },
      orderBy: { waktu: "desc" },
    });
    return row ? new Reading(
      row.batchId, row.waktu, Number(row.suhu), row.kelembapan,
      row.tekanan == null ? null : Number(row.tekanan), row.gas, row.id,
    ) : null;
  }

  async terimaReading(batch: Batch, reading: Reading): Promise<void> {
    await batch.tambahReading(reading, this.db);
  }

  async simpan(event: PressEvent): Promise<void> {
    await this.db.pressEvent.create({
      data: {
        batchId: event.batchId,
        waktu: event.waktu,
        gayaTekan: event.getGayaTekan(),
      },
    });
  }

  async build(): Promise<FastifyInstance> {
  const prisma = this.db;
  const findDrum = (nama: string) => Drum.find(nama, this.db);
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
      orderBy: { nama: "asc" },
      select: { nama: true },
    });
    return { drums: drums.map((drum) => ({ id: drum.nama })) };
  });

  app.get("/api/latest", async (request, reply) => {
    const query = latestQuery.safeParse(request.query);
    if (!query.success) {
      return reply.code(400).send({ error: "Query drum wajib diisi" });
    }

    const drumId = query.data.drum;
    const drum = await findDrum(drumId);
    if (!drum) {
      return reply.code(404).send({ error: `Batch ${drumId} tidak dikenal` });
    }

    const batch = drum.getBatch()[0];
    if (!batch) {
      return reply.code(404).send({ error: `Batch ${drumId} belum memiliki batch aktif` });
    }

    const latest = await this.getLatest(batch.id);
    if (!latest) {
      return reply.code(404).send({ error: `Batch ${drumId} belum memiliki pembacaan` });
    }

    const now = new Date();
    const since24 = new Date(now.getTime() - CONFIG.HISTORY_HOURS * 3_600_000);
    const since7 = new Date(now.getTime() - CONFIG.HISTORY_DAYS * CONFIG.DAY_MS);

    const [logs, h24Desc, h7Desc] = await Promise.all([
      prisma.reading.findMany({
        where: { batchId: batch.id },
        orderBy: { waktu: "desc" },
        take: CONFIG.LOG_POINTS,
        select: { waktu: true, suhu: true, kelembapan: true, tekanan: true, gas: true },
      }),
      prisma.$queryRaw<HistoryRow[]>`
        SELECT date_trunc('hour', "waktu" AT TIME ZONE ${env.APP_TZ}) AS bucket,
               AVG("suhu")::float8 AS avg
        FROM "readings"
        WHERE "batch_id" = ${batch.id} AND "waktu" >= ${since24}
        GROUP BY bucket
        ORDER BY bucket DESC
        LIMIT ${CONFIG.HISTORY_HOURS}
      `,
      prisma.$queryRaw<HistoryRow[]>`
        SELECT date_trunc('day', "waktu" AT TIME ZONE ${env.APP_TZ}) AS bucket,
               AVG("suhu")::float8 AS avg
        FROM "readings"
        WHERE "batch_id" = ${batch.id} AND "waktu" >= ${since7}
        GROUP BY bucket
        ORDER BY bucket DESC
        LIMIT ${CONFIG.HISTORY_DAYS}
      `,
    ]);

    const hari = batch.hitungHari(now);
    const classification = latest.classify();

    return {
      drum_id: drum.nama,
      suhu: Number(latest.suhu),
      kelembapan: latest.kelembapan,
      tekanan: latest.tekanan == null ? null : Number(latest.tekanan),
      gas: latest.gas,
      hari,
      total_hari: batch.totalHari,
      progres_pct: batch.hitungProgres(now),
      status: classification.status,
      ml_label: classification.mlLabel,
      sinkron: hhmm(latest.waktu),
      sumber: `sensor drum ${drum.nama}`,
      log: logs.map((row) => ({
        t: hhmm(row.waktu),
        suhu: Number(row.suhu),
        hum: row.kelembapan,
        tekanan: row.tekanan == null ? null : Number(row.tekanan),
        gas: row.gas,
      })),
      h24: h24Desc.toReversed().map((row) => round1(row.avg)),
      h7: h7Desc.toReversed().map((row) => round1(row.avg)),
    };
  });

  app.get("/api/predict", async (request, reply) => {
    const query = latestQuery.safeParse(request.query);
    if (!query.success) {
      return reply.code(400).send({ error: "Query drum wajib diisi" });
    }

    const drumId = query.data.drum;
    const drum = await findDrum(drumId);
    if (!drum) {
      return reply.code(404).send({ error: `Batch ${drumId} tidak dikenal` });
    }

    const batch = drum.getBatch()[0];
    if (!batch) {
      return reply.code(404).send({ error: `Batch ${drumId} belum memiliki batch aktif` });
    }

    const now = new Date();

    let result: MlResponse;
    try {
      result = await this.modelML.prediksi(batch.id, now);
    } catch (error) {
      request.log.error(error);
      return reply.code(503).send({ error: "Layanan ML tidak tersedia" });
    }

    const wrap = (key: string, satuan: string) => {
      const prediksi = result.predictions[key];
      return Array.isArray(prediksi) && prediksi.length > 0 ? { satuan, prediksi } : null;
    };

    return {
      drum_id: drum.nama,
      batch_id: batch.id,
      generated_at: result.generated_at,
      model: result.model,
      parameters: {
        suhu: wrap("suhu", "°C"),
        tekanan: wrap("tekanan", "Pa"),
        gas: wrap("gas", "adc"),
      },
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

    const { drum_id, suhu, kelembapan, tekanan, gas, t } = input.data;
    const drum = await findDrum(drum_id);
    if (!drum) {
      return reply.code(404).send({ error: `Batch ${drum_id} tidak dikenal` });
    }

    const batch = drum.getBatch()[0];
    if (!batch) {
      return reply.code(404).send({ error: `Batch ${drum_id} belum memiliki batch aktif` });
    }

    const reading = new Reading(
      batch.id, t ? new Date(t) : new Date(), suhu, kelembapan, tekanan, gas,
    );
    const classification = reading.classify();
    await this.terimaReading(batch, reading);

    return reply.code(200).send({
      ok: true,
      ml_label: classification.mlLabel,
      status: classification.status,
    });
  });

  app.post("/api/press-events", async (request, reply) => {
    const input = pressInput.safeParse(request.body);
    if (!input.success) {
      return reply.code(400).send({
        error: "Payload tidak valid",
        issues: input.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
    }

    const { drum_id, gaya_tekan, t } = input.data;
    const drum = await findDrum(drum_id);
    if (!drum) {
      return reply.code(404).send({ error: `Batch ${drum_id} tidak dikenal` });
    }

    const batch = drum.getBatch()[0];
    if (!batch) {
      return reply.code(404).send({ error: `Batch ${drum_id} belum memiliki batch aktif` });
    }

    await this.simpan(new PressEvent(batch.id, t ? new Date(t) : new Date(), gaya_tekan));

    return { ok: true, batch_id: batch.id, gaya_tekan };
  });

  return app;
  }
}
