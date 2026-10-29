export class PressEvent {
  constructor(
    readonly batchId: number,
    readonly waktu: Date,
    private readonly gayaTekan: number,
    readonly idPressEvent?: bigint,
  ) {}

  getGayaTekan(): number {
    return this.gayaTekan;
  }
}
