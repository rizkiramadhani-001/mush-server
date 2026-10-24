export interface MlResponse {
  model: string;
  generated_at: string;
  predictions: Record<string, unknown[]>;
}

export class ModelML {
  readonly namaModel = "regresi_linear";

  constructor(private readonly baseUrl: string) {}

  async prediksi(batchId: number, now: Date): Promise<MlResponse> {
    const response = await fetch(`${this.baseUrl}/predict`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ batch_id: batchId, now: now.toISOString() }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
      throw new Error(`ML ${response.status}: ${await response.text()}`);
    }
    return (await response.json()) as MlResponse;
  }
}
