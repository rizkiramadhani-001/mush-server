import type { PrismaClient, Batch as BatchRow } from "../../generated/prisma/client.ts";
import { CONFIG } from "../utils/config.ts";
import { env } from "../../start/env.ts";
import type { Reading } from "./reading.ts";

const dayFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: env.APP_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const dayIndex = (value: Date) => {
  const parts = dayFormat.formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((item) => item.type === type)?.value ?? 0);
  return Date.UTC(part("year"), part("month") - 1, part("day")) / CONFIG.DAY_MS;
};

export class Batch {
  constructor(private readonly data: BatchRow) {}

  get id() {
    return this.data.id;
  }

  get drumId() {
    return this.data.drumId;
  }

  get tanggalMulai() {
    return this.data.tanggalMulai;
  }

  get totalHari() {
    return this.data.totalHari;
  }

  get beratKg() {
    return this.data.beratKg == null ? null : Number(this.data.beratKg);
  }

  hitungHari(now = new Date()): number {
    const elapsed = dayIndex(now) - dayIndex(this.tanggalMulai) + 1;
    return Math.min(this.totalHari, Math.max(1, elapsed));
  }

  hitungProgres(now = new Date()): number {
    return Math.round((this.hitungHari(now) / this.totalHari) * 100);
  }

  async tambahReading(reading: Reading, db: PrismaClient): Promise<void> {
    if (reading.batchId !== this.id) {
      throw new Error("Reading tidak sesuai batch");
    }
    await db.reading.create({
      data: {
        batchId: this.id,
        waktu: reading.waktu,
        suhu: reading.suhu,
        kelembapan: reading.kelembapan,
        tekanan: reading.tekanan,
        gas: reading.gas,
        label: reading.label,
      },
    });
  }
}
