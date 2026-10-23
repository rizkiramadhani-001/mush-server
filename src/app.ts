import cors from "@fastify/cors";
import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import { z } from "zod";
import { classify } from "./classify.ts";
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

const dayFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: env.APP_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const hhmm = (value: Date) => timeFormat.format(value);

const dayIndex = (value: Date) => {
  const parts = dayFormat.formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((item) => item.type === type)?.value ?? 0);
  return Date.UTC(part("year"), part("month") - 1, part("day")) / CONFIG.DAY_MS;
};

const round1 = (value: number) => Math.round(value * 10) / 10;

interface HistoryRow {
  bucket: Date;
  avg: number;
}

const findDrum = (nama: string) =>
  prisma.drum.findUnique({
    where: { nama },
    select: {
      id: true,
      nama: true,
      batches: {
        orderBy: [{ tanggalMulai: "desc" }, { id: "desc" }],
        take: 1,
        select: { id: true, tanggalMulai: true, totalHari: true },
      },
    },
  });

interface MlResponse {
  model: string;
  generated_at: string;
  predictions: Record<string, unknown[]>;
}

const callMl = async (
  samples: Record<string, { t: Date; value: number }[]>,
  now: Date,
): Promise<MlResponse> => {
  const response = await fetch(`${env.ML_URL}/predict`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ samples, now: now.toISOString() }),
    signal: AbortSignal.timeout(8_000),
  });

  if (!response.ok) {
    throw new Error(`ML ${response.status}: ${await response.text()}`);
  }

  return (await response.json()) as MlResponse;
};

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

    const batch = drum.batches[0];
    if (!batch) {
      return reply.code(404).send({ error: `Batch ${drumId} belum memiliki batch aktif` });
    }

    const latest = await prisma.reading.findFirst({
      where: { batchId: batch.id },
      orderBy: { waktu: "desc" },
    });
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

    const elapsed = dayIndex(now) - dayIndex(batch.tanggalMulai) + 1;
    const hari = Math.min(batch.totalHari, Math.max(1, elapsed));
    const classification = classify(Number(latest.suhu), latest.kelembapan);

    return {
      drum_id: drum.nama,
      suhu: Number(latest.suhu),
      kelembapan: latest.kelembapan,
      tekanan: latest.tekanan == null ? null : Number(latest.tekanan),
      gas: latest.gas,
      hari,
      total_hari: batch.totalHari,
      progres_pct: Math.round((hari / batch.totalHari) * 100),
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

    const batch = drum.batches[0];
    if (!batch) {
      return reply.code(404).send({ error: `Batch ${drumId} belum memiliki batch aktif` });
    }

    const rows = await prisma.reading.findMany({
      where: { batchId: batch.id },
      orderBy: { waktu: "asc" },
      select: { waktu: true, suhu: true, tekanan: true, gas: true },
    });

    if (rows.length < 2) {
      return reply.code(409).send({
        error: `Batch ${drumId} butuh minimal 2 pembacaan untuk prediksi`,
      });
    }

    const now = new Date();
    const samples = {
      suhu: rows.map((row) => ({ t: row.waktu, value: Number(row.suhu) })),
      tekanan: rows
        .filter((row) => row.tekanan != null)
        .map((row) => ({ t: row.waktu, value: Number(row.tekanan) })),
      gas: rows
        .filter((row) => row.gas != null)
        .map((row) => ({ t: row.waktu, value: row.gas! })),
    };

    let result: MlResponse;
    try {
      result = await callMl(samples, now);
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

    const batch = drum.batches[0];
    if (!batch) {
      return reply.code(404).send({ error: `Batch ${drum_id} belum memiliki batch aktif` });
    }

    const classification = classify(suhu, kelembapan);
    await prisma.reading.create({
      data: {
        batchId: batch.id,
        suhu,
        kelembapan,
        tekanan,
        gas,
        label: classification.mlLabel,
        waktu: t ? new Date(t) : new Date(),
      },
    });

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

    const batch = drum.batches[0];
    if (!batch) {
      return reply.code(404).send({ error: `Batch ${drum_id} belum memiliki batch aktif` });
    }

    await prisma.pressEvent.create({
      data: {
        batchId: batch.id,
        gayaTekan: gaya_tekan,
        waktu: t ? new Date(t) : new Date(),
      },
    });

    return { ok: true, batch_id: batch.id, gaya_tekan };
  });

  return app;
}
