export const CONFIG = {
  THRESHOLDS: {
    suhu: [40, 45],
    hum: [55, 70],
  },
  DEFAULT_KAPASITAS_KG: 50,
  DEFAULT_TOTAL_HARI: 14,
  LOG_POINTS: 8,
  HISTORY_HOURS: 24,
  HISTORY_DAYS: 7,
  DAY_MS: 86_400_000,
} as const;
