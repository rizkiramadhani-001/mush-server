import "dotenv/config";
import { z } from "zod";

const timeZone = z.string().refine(
  (value) => {
    try {
      new Intl.DateTimeFormat("en-GB", { timeZone: value });
      return true;
    } catch {
      return false;
    }
  },
  { message: "APP_TZ bukan zona waktu IANA yang valid" },
);

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_KEY: z.string().min(16),
  HOST: z.string().min(1).default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(8080),
  DATABASE_URL: z.url(),
  ML_URL: z.url().default("http://127.0.0.1:8081"),
  CORS_ORIGIN: z.string().default("http://localhost:8000,http://localhost:5173"),
  APP_TZ: timeZone.default("Asia/Jakarta"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Konfigurasi environment tidak valid:");
  for (const issue of parsed.error.issues) {
    console.error(`- ${issue.path.join(".")}: ${issue.message}`);
  }
  process.exit(1);
}

export const env = parsed.data;
