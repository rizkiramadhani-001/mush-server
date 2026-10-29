import { classify } from "../app/utils/classify.ts";
import { prisma } from "../app/services/db.ts";

const HALF_HOUR_MS = 30 * 60_000;
const DAY_MS = 86_400_000;
const TOTAL_DAYS = 14;

interface SeedDrum {
  nama: string;
  kapasitasKg: number;
  startedDaysAgo: number;
  baseSuhu: number;
  baseHum: number;
  baseGas: number;
  baseTekanan: number;
  beratKg: number;
  gayaTekan: number;
}

const DRUMS: SeedDrum[] = [
  {
    nama: "B-024",
    kapasitasKg: 50,
    startedDaysAgo: 8,
    baseSuhu: 41.2,
    baseHum: 62,
    baseGas: 420,
    baseTekanan: 12,
    beratKg: 5,
    gayaTekan: 820.5,
  },
  {
    nama: "B-025",
    kapasitasKg: 50,
    startedDaysAgo: 3,
    baseSuhu: 39.4,
    baseHum: 68,
    baseGas: 405,
    baseTekanan: 8,
    beratKg: 5,
    gayaTekan: 795,
  },
];

const round1 = (value: number) => Math.round(value * 10) / 10;

const startOfDay = (daysAgo: number) => {
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return new Date(today - daysAgo * DAY_MS);
};

async function seedDrum(drum: SeedDrum) {
  const tanggalMulai = startOfDay(drum.startedDaysAgo);

  const record = await prisma.drum.upsert({
    where: { nama: drum.nama },
    update: { kapasitasKg: drum.kapasitasKg },
    create: {
      nama: drum.nama,
      kapasitasKg: drum.kapasitasKg,
      status: "aktif",
    },
  });

  const existing = await prisma.batch.findFirst({
    where: { drumId: record.id },
    orderBy: [{ tanggalMulai: "desc" }, { id: "desc" }],
    select: { id: true, _count: { select: { readings: true } } },
  });

  if (existing && existing._count.readings > 0) {
    console.log(`${drum.nama}: ${existing._count.readings} pembacaan sudah ada, dilewati`);
    return;
  }

  const batch =
    existing ??
    (await prisma.batch.create({
      data: {
        drumId: record.id,
        tanggalMulai,
        totalHari: TOTAL_DAYS,
        beratKg: drum.beratKg,
      },
    }));

  const now = new Date();
  const since = Math.max(tanggalMulai.getTime(), now.getTime() - 7 * DAY_MS);
  const steps = Math.floor((now.getTime() - since) / HALF_HOUR_MS);
  const readings = [];

  for (let i = 0; i <= steps; i += 1) {
    const phase = i / 6;
    const suhu = round1(drum.baseSuhu + Math.sin(phase) * 0.35);
    const kelembapan = Math.round(drum.baseHum + Math.sin(phase / 2) * 2);

    readings.push({
      batchId: batch.id,
      suhu,
      kelembapan,
      tekanan: round1(drum.baseTekanan + Math.sin(phase / 2) * 3.5),
      gas: Math.round(drum.baseGas + Math.sin(phase / 3) * 25),
      label: classify(suhu, kelembapan).mlLabel,
      waktu: new Date(since + i * HALF_HOUR_MS),
    });
  }

  readings.push({
    batchId: batch.id,
    suhu: drum.baseSuhu,
    kelembapan: drum.baseHum,
    tekanan: drum.baseTekanan,
    gas: drum.baseGas,
    label: classify(drum.baseSuhu, drum.baseHum).mlLabel,
    waktu: now,
  });

  await prisma.reading.createMany({ data: readings });
  await prisma.pressEvent.create({
    data: {
      batchId: batch.id,
      gayaTekan: drum.gayaTekan,
      waktu: new Date(tanggalMulai.getTime() + 3_600_000),
    },
  });

  console.log(`${drum.nama}: batch ${batch.id}, ${readings.length} pembacaan dibuat`);
}

for (const drum of DRUMS) {
  await seedDrum(drum);
}

await prisma.$disconnect();
