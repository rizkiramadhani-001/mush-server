-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "drums" (
    "id" SERIAL NOT NULL,
    "nama" TEXT NOT NULL,
    "kapasitas_kg" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'aktif',

    CONSTRAINT "drums_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "batches" (
    "id" SERIAL NOT NULL,
    "drum_id" INTEGER NOT NULL,
    "tanggal_mulai" DATE NOT NULL,
    "total_hari" INTEGER NOT NULL DEFAULT 14,
    "berat_kg" DECIMAL(5,1),

    CONSTRAINT "batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "readings" (
    "id" BIGSERIAL NOT NULL,
    "batch_id" INTEGER NOT NULL,
    "waktu" TIMESTAMPTZ(3) NOT NULL,
    "suhu" DECIMAL(4,1) NOT NULL,
    "kelembapan" INTEGER,
    "tekanan" DECIMAL(5,1),
    "gas" INTEGER,
    "label" TEXT,

    CONSTRAINT "readings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "press_events" (
    "id" BIGSERIAL NOT NULL,
    "batch_id" INTEGER NOT NULL,
    "waktu" TIMESTAMPTZ(3) NOT NULL,
    "gaya_tekan" DECIMAL(6,1) NOT NULL,

    CONSTRAINT "press_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gate_events" (
    "id" BIGSERIAL NOT NULL,
    "batch_id" INTEGER NOT NULL,
    "waktu" TIMESTAMPTZ(3) NOT NULL,
    "tercapai" BOOLEAN NOT NULL,

    CONSTRAINT "gate_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alerts" (
    "id" BIGSERIAL NOT NULL,
    "batch_id" INTEGER NOT NULL,
    "waktu" TIMESTAMPTZ(3) NOT NULL,
    "jenis" TEXT NOT NULL,
    "pesan" TEXT NOT NULL,

    CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" BIGSERIAL NOT NULL,
    "batch_id" INTEGER NOT NULL,
    "waktu" TIMESTAMPTZ(3) NOT NULL,
    "judul" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "tone" TEXT NOT NULL,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "drums_nama_key" ON "drums"("nama");

-- CreateIndex
CREATE INDEX "batches_drum_id_tanggal_mulai_idx" ON "batches"("drum_id", "tanggal_mulai");

-- CreateIndex
CREATE INDEX "readings_batch_id_waktu_idx" ON "readings"("batch_id", "waktu");

-- CreateIndex
CREATE INDEX "press_events_batch_id_waktu_idx" ON "press_events"("batch_id", "waktu");

-- CreateIndex
CREATE INDEX "gate_events_batch_id_waktu_idx" ON "gate_events"("batch_id", "waktu");

-- CreateIndex
CREATE INDEX "alerts_batch_id_waktu_idx" ON "alerts"("batch_id", "waktu");

-- CreateIndex
CREATE INDEX "events_batch_id_waktu_idx" ON "events"("batch_id", "waktu");

-- AddForeignKey
ALTER TABLE "batches" ADD CONSTRAINT "batches_drum_id_fkey" FOREIGN KEY ("drum_id") REFERENCES "drums"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "readings" ADD CONSTRAINT "readings_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "press_events" ADD CONSTRAINT "press_events_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gate_events" ADD CONSTRAINT "gate_events_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
