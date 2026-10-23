import { CONFIG } from "./config.ts";

export type TargetStatus = "dalam_target" | "di_luar_target";

export interface Classification {
  target: boolean;
  status: TargetStatus;
  tone: "ok" | "warn" | "bad";
  mlLabel: string;
}

/* Aturan ambang deterministik, sama dengan dashboard. Ini bukan model ML;
   label ini menjadi nilai sementara sampai model server tersedia. */
export function classify(suhu: number, kelembapan: number): Classification {
  const [suhuLo, suhuHi] = CONFIG.THRESHOLDS.suhu;
  const [humLo, humHi] = CONFIG.THRESHOLDS.hum;
  const suhuOk = suhu >= suhuLo && suhu <= suhuHi;
  const humOk = kelembapan >= humLo && kelembapan <= humHi;

  if (suhuOk && humOk) {
    return { target: true, status: "dalam_target", tone: "ok", mlLabel: "Asam laktat" };
  }
  if (suhu > suhuHi) {
    return { target: false, status: "di_luar_target", tone: "bad", mlLabel: "Anomali: cek udara" };
  }
  if (suhu < suhuLo) {
    return { target: false, status: "di_luar_target", tone: "warn", mlLabel: "Awal fermentasi" };
  }
  return { target: false, status: "di_luar_target", tone: "warn", mlLabel: "Perlu perhatian" };
}
