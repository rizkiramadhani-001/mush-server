import type { PrismaClient } from "../../generated/prisma/client.ts";
import { z } from "zod";
import { CONFIG } from "../utils/config.ts";
import { prisma } from "./db.ts";
import { env } from "../../start/env.ts";
import { Batch } from "../domain/batch.ts";
import { Drum } from "../domain/drum.ts";
import { PressEvent } from "../domain/press-event.ts";
import { Reading } from "../domain/reading.ts";
import { ModelML } from "./model_ml.ts";

const drumField = z.string().trim().min(1).max(32);

export const readingInput = z.object({
  drum_id: drumField,
  suhu: z.number().finite(),
  kelembapan: z.number().int().min(0).max(100).optional(),
  tekanan: z.number().finite().optional(),
  gas: z.number().int().min(0).optional(),
  t: z.iso.datetime({ offset: true }).optional(),
});

export const pressInput = z.object({
  drum_id: drumField,
  gaya_tekan: z.number().finite().nonnegative(),
  t: z.iso.datetime({ offset: true }).optional(),
});

type ReadingInput = z.infer<typeof readingInput>;
type PressInput = z.infer<typeof pressInput>;

type ApiResult = {
  status: number;
  body: Record<string, unknown>;
};

interface HistoryRow {
  bucket: Date;
  avg: number;
}

const timeFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: env.APP_TZ,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const formatTime = (value: Date) => timeFormat.format(value);
const round1 = (value: number) => Math.round(value * 10) / 10;

export class ServerAPI {
  constructor(
    private readonly db: PrismaClient = prisma,
    private readonly modelML = new ModelML(env.ML_URL),
  ) {}

  async health() {
    await this.db.$queryRaw`SELECT 1`;
    return { ok: true };
  }

  async drums() {
    const drums = await this.db.drum.findMany({
      orderBy: { nama: "asc" },
      select: { nama: true },
    });

    return {
      drums: drums.map((drum) => ({ id: drum.nama })),
    };
  }

  async latest(drumId: string): Promise<ApiResult> {
    const context = await this.getBatchContext(drumId);
    if (context.error) return context.error;

    const { drum, batch } = context;
    const latest = await this.findLatestReading(batch.id);
    if (!latest) {
      return this.notFound(`Batch ${drum.nama} belum memiliki pembacaan`);
    }

    const now = new Date();
    const history = await this.getHistory(batch.id, now);
    const classification = latest.classify();

    return {
      status: 200,
      body: {
        drum_id: drum.nama,
        suhu: latest.suhu,
        kelembapan: latest.kelembapan,
        tekanan: latest.tekanan,
        gas: latest.gas,
        hari: batch.hitungHari(now),
        total_hari: batch.totalHari,
        progres_pct: batch.hitungProgres(now),
        berat: batch.beratKg,
        started: batch.tanggalMulai.toISOString().slice(0, 10),
        status: classification.status,
        ml_label: classification.mlLabel,
        sinkron: formatTime(latest.waktu),
        sumber: `sensor drum ${drum.nama}`,
        log: history.logs.map((row) => ({
          t: formatTime(row.waktu),
          suhu: Number(row.suhu),
          hum: row.kelembapan,
          tekanan: row.tekanan == null ? null : Number(row.tekanan),
          gas: row.gas,
        })),
        h24: history.h24.toReversed().map((row) => round1(row.avg)),
        h7: history.h7.toReversed().map((row) => round1(row.avg)),
      },
    };
  }

  async predict(drumId: string): Promise<ApiResult> {
    const context = await this.getBatchContext(drumId);
    if (context.error) return context.error;

    try {
      const result = await this.modelML.prediksi(context.batch.id, new Date());
      return {
        status: 200,
        body: {
          drum_id: context.drum.nama,
          batch_id: context.batch.id,
          generated_at: result.generated_at,
          model: result.model,
          parameters: {
            suhu: this.parameterResult(result.predictions.suhu, "°C"),
            tekanan: this.parameterResult(result.predictions.tekanan, "Pa"),
            gas: this.parameterResult(result.predictions.gas, "adc"),
          },
        },
      };
    } catch {
      return {
        status: 503,
        body: { error: "Layanan ML tidak tersedia" },
      };
    }
  }

  async createReading(input: ReadingInput): Promise<ApiResult> {
    const context = await this.getBatchContext(input.drum_id);
    if (context.error) return context.error;

    const reading = new Reading(
      context.batch.id,
      input.t ? new Date(input.t) : new Date(),
      input.suhu,
      input.kelembapan,
      input.tekanan,
      input.gas,
    );

    await context.batch.tambahReading(reading, this.db);
    const classification = reading.classify();

    return {
      status: 200,
      body: {
        ok: true,
        ml_label: classification.mlLabel,
        status: classification.status,
      },
    };
  }

  async createPressEvent(input: PressInput): Promise<ApiResult> {
    const context = await this.getBatchContext(input.drum_id);
    if (context.error) return context.error;

    const event = new PressEvent(
      context.batch.id,
      input.t ? new Date(input.t) : new Date(),
      input.gaya_tekan,
    );

    await this.db.pressEvent.create({
      data: {
        batchId: event.batchId,
        waktu: event.waktu,
        gayaTekan: event.getGayaTekan(),
      },
    });

    return {
      status: 200,
      body: {
        ok: true,
        batch_id: context.batch.id,
        gaya_tekan: input.gaya_tekan,
      },
    };
  }

  private async getBatchContext(drumId: string) {
    const drum = await Drum.find(drumId, this.db);
    if (!drum) {
      return {
        error: this.notFound(`Batch ${drumId} tidak dikenal`),
      };
    }

    const batch = drum.getBatch()[0];
    if (!batch) {
      return {
        error: this.notFound(`Batch ${drumId} belum memiliki batch aktif`),
      };
    }

    return { drum, batch };
  }

  private async findLatestReading(batchId: number) {
    const row = await this.db.reading.findFirst({
      where: { batchId },
      orderBy: { waktu: "desc" },
    });

    if (!row) return null;

    return new Reading(
      row.batchId,
      row.waktu,
      Number(row.suhu),
      row.kelembapan,
      row.tekanan == null ? null : Number(row.tekanan),
      row.gas,
      row.id,
    );
  }

  private async getHistory(batchId: number, now: Date) {
    const since24 = new Date(
      now.getTime() - CONFIG.HISTORY_HOURS * 3_600_000,
    );
    const since7 = new Date(
      now.getTime() - CONFIG.HISTORY_DAYS * CONFIG.DAY_MS,
    );

    const [logs, h24, h7] = await Promise.all([
      this.db.reading.findMany({
        where: { batchId },
        orderBy: { waktu: "desc" },
        take: CONFIG.LOG_POINTS,
        select: {
          waktu: true,
          suhu: true,
          kelembapan: true,
          tekanan: true,
          gas: true,
        },
      }),
      this.db.$queryRaw<HistoryRow[]>`
        SELECT date_trunc('hour', "waktu" AT TIME ZONE ${env.APP_TZ}) AS bucket,
               AVG("suhu")::float8 AS avg
        FROM "readings"
        WHERE "batch_id" = ${batchId} AND "waktu" >= ${since24}
        GROUP BY bucket
        ORDER BY bucket DESC
        LIMIT ${CONFIG.HISTORY_HOURS}
      `,
      this.db.$queryRaw<HistoryRow[]>`
        SELECT date_trunc('day', "waktu" AT TIME ZONE ${env.APP_TZ}) AS bucket,
               AVG("suhu")::float8 AS avg
        FROM "readings"
        WHERE "batch_id" = ${batchId} AND "waktu" >= ${since7}
        GROUP BY bucket
        ORDER BY bucket DESC
        LIMIT ${CONFIG.HISTORY_DAYS}
      `,
    ]);

    return { logs, h24, h7 };
  }

  private parameterResult(values: unknown[] | undefined, unit: string) {
    if (!Array.isArray(values) || values.length === 0) return null;
    return { satuan: unit, prediksi: values };
  }

  private notFound(error: string): ApiResult {
    return { status: 404, body: { error } };
  }
}
