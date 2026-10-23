-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "drums" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "total_days" INTEGER NOT NULL DEFAULT 14,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "drums_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "readings" (
    "id" SERIAL NOT NULL,
    "drum_id" TEXT NOT NULL,
    "suhu" DOUBLE PRECISION NOT NULL,
    "kelembapan" DOUBLE PRECISION NOT NULL,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "readings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "readings_drum_id_recorded_at_idx" ON "readings"("drum_id", "recorded_at");

-- AddForeignKey
ALTER TABLE "readings" ADD CONSTRAINT "readings_drum_id_fkey" FOREIGN KEY ("drum_id") REFERENCES "drums"("id") ON DELETE CASCADE ON UPDATE CASCADE;
