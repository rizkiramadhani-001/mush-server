import { prisma } from "../src/db.ts";

const HALF_HOUR_MS = 30 * 60_000;
const DAY_MS = 86_400_000;
const TOTAL_DAYS = 14;

interface SeedDrum {
  id: string;
  label: string;
  startedDaysAgo: number;
  baseSuhu: number;
  baseHum: number;
}

const DRUMS: SeedDrum[] = [
  {
    id: "B-024",
    label: "Pakan silase premium · 5 kg",
    startedDaysAgo: 8,
    baseSuhu: 41.2,
    baseHum: 62,
  },
  {
    id: "B-025",
    label: "Pakan silase premium · 5 kg",
    startedDaysAgo: 3,
    baseSuhu: 39.4,
    baseHum: 68,
  },
];

const round1 = (value: number) => Math.round(value * 10) / 10;

async function seedDrum(drum: SeedDrum) {
  const now = new Date();
  const startedAt = new Date(now.getTime() - drum.startedDaysAgo * DAY_MS);

  await prisma.drum.upsert({
    where: { id: drum.id },
    update: { label: drum.label, startedAt, totalDays: TOTAL_DAYS },
    create: {
      id: drum.id,
      label: drum.label,
      startedAt,
      totalDays: TOTAL_DAYS,
    },
  });

  const existing = await prisma.reading.count({ where: { drumId: drum.id } });
  if (existing > 0) {
    console.log(`${drum.id}: ${existing} pembacaan sudah ada, dilewati`);
    return;
  }

  const since = Math.max(startedAt.getTime(), now.getTime() - 7 * DAY_MS);
  const steps = Math.floor((now.getTime() - since) / HALF_HOUR_MS);
  const data = [];

  for (let i = 0; i <= steps; i += 1) {
    const phase = i / 6;
    data.push({
      drumId: drum.id,
      suhu: round1(drum.baseSuhu + Math.sin(phase) * 0.35),
      kelembapan: Math.round(drum.baseHum + Math.sin(phase / 2) * 2),
      recordedAt: new Date(since + i * HALF_HOUR_MS),
    });
  }

  data.push({
    drumId: drum.id,
    suhu: drum.baseSuhu,
    kelembapan: drum.baseHum,
    recordedAt: now,
  });

  await prisma.reading.createMany({ data });
  console.log(`${drum.id}: ${data.length} pembacaan dibuat`);
}

for (const drum of DRUMS) {
  await seedDrum(drum);
}

await prisma.$disconnect();
