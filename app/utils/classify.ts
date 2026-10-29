import { CONFIG } from "./config.ts";

export type TargetStatus = "dalam_target" | "di_luar_target";

export interface Classification {
  target: boolean;
  status: TargetStatus;
  tone: "ok" | "warn" | "bad";
  mlLabel: string;
}

/* Aturan ambang deterministik, sama dengan dashboard. Ini bukan model ML;
   label ini menjadi nilai sementara sampai model server tersedia.
   Kelembapan opsional karena node final hanya mengukur suhu, gas, dan tekanan. */
export function classify(suhu: number, kelembapan?: number | null): Classification {
  const [suhuLo, suhuHi] = CONFIG.THRESHOLDS.suhu;
  const suhuOk = suhu >= suhuLo && suhu <= suhuHi;

  if (kelembapan == null) {
    return suhuOk
      ? { target: true, status: "dalam_target", tone: "ok", mlLabel: "Asam laktat" }
      : suhu > suhuHi
        ? { target: false, status: "di_luar_target", tone: "bad", mlLabel: "Anomali: cek udara" }
        : { target: false, status: "di_luar_target", tone: "warn", mlLabel: "Awal fermentasi" };
  }

  const [humLo, humHi] = CONFIG.THRESHOLDS.hum;
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
