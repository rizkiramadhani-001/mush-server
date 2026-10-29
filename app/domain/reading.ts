import { classify } from "../utils/classify.ts";

export class Reading {
  constructor(
    readonly batchId: number,
    readonly waktu: Date,
    readonly suhu: number,
    readonly kelembapan: number | null = null,
    readonly tekanan: number | null = null,
    readonly gas: number | null = null,
    readonly idReading?: bigint,
  ) {}

  classify() {
    return classify(this.suhu, this.kelembapan);
  }

  get label() {
    return this.classify().mlLabel;
  }
}
