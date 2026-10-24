import type { PrismaClient, Drum as DrumRow, Batch as BatchRow } from "../../generated/prisma/client.ts";
import { Batch } from "./batch.ts";

export class Drum {
  constructor(private readonly data: DrumRow & { batches: BatchRow[] }) {}

  get id() { return this.data.id; }
  get nama() { return this.data.nama; }
  get kapasitasKg() { return this.data.kapasitasKg; }

  getStatus(): string {
    return this.data.status;
  }

  getBatch(): Batch[] {
    return this.data.batches.map((batch) => new Batch(batch));
  }

  static async find(nama: string, db: PrismaClient): Promise<Drum | null> {
    const data = await db.drum.findUnique({
      where: { nama },
      include: { batches: { orderBy: [{ tanggalMulai: "desc" }, { id: "desc" }] } },
    });
    return data ? new Drum(data) : null;
  }
}
