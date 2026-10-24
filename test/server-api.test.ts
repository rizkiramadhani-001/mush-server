import assert from "node:assert/strict";
import { test } from "node:test";
import type { PrismaClient } from "../generated/prisma/client.ts";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgresql://localhost/mush-test";
process.env.APP_TZ = "Asia/Jakarta";

const { ServerAPI } = await import("../src/server-api.ts");
const { ModelML } = await import("../src/model-ml.ts");
const { Batch } = await import("../src/domain/batch.ts");
const { Reading } = await import("../src/domain/reading.ts");

const batchRow = {
  id: 7, drumId: 1, tanggalMulai: new Date("2026-10-01T00:00:00Z"),
  totalHari: 14, beratKg: null,
};

test("Batch menghitung progres berdasarkan tanggal lokal dan membatasi hari", () => {
  const batch = new Batch(batchRow);
  assert.equal(batch.hitungHari(new Date("2026-09-30T00:00:00Z")), 1);
  assert.equal(batch.hitungProgres(new Date("2026-10-09T00:00:00Z")), 64);
  assert.equal(batch.hitungHari(new Date("2026-10-01T17:00:00Z")), 2);
  assert.equal(batch.hitungProgres(new Date("2026-11-01T00:00:00Z")), 100);
});

test("Batch menolak Reading milik batch lain sebelum menyimpan", async () => {
  const batch = new Batch(batchRow);
  await assert.rejects(
    batch.tambahReading(new Reading(99, new Date(), 41), {} as PrismaClient),
    /tidak sesuai batch/,
  );
});

test("route memakai class domain dan mempertahankan kontrak respons", async (t) => {
  const writes: unknown[] = [];
  let disconnected = false;
  let available = true;
  let hasBatch = true;
  let hasReading = true;
  let mlFailure = false;
  const drumRow = { id: 1, nama: "B-024", kapasitasKg: 100, status: "aktif" };
  const readingRow = {
    id: 1n, batchId: 7, waktu: new Date(), suhu: 41.2, kelembapan: 62,
    tekanan: 12, gas: 420, label: "Asam laktat",
  };
  const db = {
    drum: {
      findUnique: async () => available ? { ...drumRow, batches: hasBatch ? [batchRow] : [] } : null,
      findMany: async () => [drumRow],
    },
    reading: {
      findFirst: async () => hasReading ? readingRow : null,
      findMany: async () => [readingRow],
      create: async (input: unknown) => { writes.push(input); },
    },
    pressEvent: { create: async (input: unknown) => { writes.push(input); } },
    $queryRaw: async () => [{ bucket: new Date(), avg: 41.2 }],
    $disconnect: async () => { disconnected = true; },
  } as unknown as PrismaClient;
  const model = new ModelML("http://localhost:8081");
  model.prediksi = async (batchId, now) => {
    assert.equal(batchId, 7);
    if (mlFailure) throw new Error("offline");
    return { model: model.namaModel, generated_at: now.toISOString(), predictions: {
      suhu: [{ hari: 1, nilai: 42, metrik: null }],
    } };
  };
  const app = await new ServerAPI(db, model).build();
  t.after(async () => { await app.close(); assert.equal(disconnected, true); });

  const drums = await app.inject({ method: "GET", url: "/api/drums" });
  assert.deepEqual(drums.json(), { drums: [{ id: "B-024" }] });
  const latest = await app.inject({ method: "GET", url: "/api/latest?drum=B-024" });
  assert.equal(latest.statusCode, 200);
  assert.equal(latest.json().suhu, 41.2);
  assert.equal(latest.json().ml_label, "Asam laktat");
  assert.deepEqual(latest.json().h24, [41.2]);
  const post = await app.inject({ method: "POST", url: "/api/readings", payload: {
    drum_id: "B-024", suhu: 41.2, t: "2026-10-24T00:00:00Z",
  } });
  assert.equal(post.statusCode, 200);
  assert.deepEqual(writes[0], { data: {
    batchId: 7, waktu: new Date("2026-10-24T00:00:00Z"), suhu: 41.2,
    kelembapan: null, tekanan: null, gas: null, label: post.json().ml_label,
  } });
  const press = await app.inject({ method: "POST", url: "/api/press-events", payload: {
    drum_id: "B-024", gaya_tekan: 25, t: "2026-10-24T00:00:00Z",
  } });
  assert.deepEqual(press.json(), { ok: true, batch_id: 7, gaya_tekan: 25 });
  assert.deepEqual(writes[1], { data: {
    batchId: 7, waktu: new Date("2026-10-24T00:00:00Z"), gayaTekan: 25,
  } });
  const predicted = await app.inject({ method: "GET", url: "/api/predict?drum=B-024" });
  assert.equal(predicted.statusCode, 200);
  assert.equal(predicted.json().parameters.suhu.satuan, "°C");
  assert.equal(predicted.json().parameters.gas, null);
  mlFailure = true;
  assert.equal((await app.inject("/api/predict?drum=B-024")).statusCode, 503);
  assert.equal((await app.inject("/api/latest")).statusCode, 400);
  assert.equal((await app.inject({ method: "POST", url: "/api/readings", payload: {} })).statusCode, 400);
  hasReading = false;
  assert.equal((await app.inject("/api/latest?drum=B-024")).statusCode, 404);
  hasBatch = false;
  assert.equal((await app.inject("/api/latest?drum=B-024")).statusCode, 404);
  available = false;
  assert.equal((await app.inject("/api/latest?drum=unknown")).statusCode, 404);
});
