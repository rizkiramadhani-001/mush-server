# MUSH Server

Backend REST untuk dashboard MUSH (Pagi Farm): Fastify + TypeScript,
Prisma 7, dan PostgreSQL. Mengikuti kontrak `mush-dashboard/api-contract.json`
v3.1.

## Jalankan

Kebutuhan: Node.js 22+ dan PostgreSQL 16+.

```bash
cd mush-server
npm install
cp .env.example .env        # sesuaikan DATABASE_URL
docker compose up -d        # atau pakai PostgreSQL yang sudah ada
npm run db:deploy
npm run db:seed
npm run dev
```

Tanpa Docker, Prisma 7 bisa menjalankan PostgreSQL lokal:

```bash
npx prisma dev -d
# salin URL TCP yang dicetak ke DATABASE_URL, lalu:
npm run db:deploy && npm run db:seed
```

Server default di `http://localhost:8080`.

```bash
npm run typecheck
npm test
npm run build
npm start
```

## Environment

| Variabel | Default | Keterangan |
|---|---|---|
| `DATABASE_URL` | wajib | Connection string PostgreSQL |
| `HOST` | `0.0.0.0` | Alamat bind Fastify |
| `PORT` | `8080` | Port HTTP |
| `CORS_ORIGIN` | `http://localhost:8000,http://localhost:5173` | Daftar origin dipisah koma, atau `*` |
| `APP_TZ` | `Asia/Jakarta` | Zona waktu label jam dan hari fermentasi |

## Endpoint

### `POST /api/readings`

Dipakai gateway ESP32. `t` opsional; jika kosong dipakai waktu server.

```json
{
  "drum_id": "B-024",
  "suhu": 41.2,
  "kelembapan": 62,
  "t": "2026-10-10T10:42:00+07:00"
}
```

```json
{
  "ok": true,
  "ml_label": "Asam laktat",
  "status": "dalam_target"
}
```

Drum harus sudah terdaftar (seed: `B-024`, `B-025`); drum tidak dikenal
mengembalikan `404`.

### `GET /api/latest?drum=B-024`

Mengembalikan snapshot terbaru sesuai kontrak: `suhu`, `kelembapan`, `hari`,
`total_hari`, `progres_pct`, `status`, `ml_label`, `sinkron`, `sumber`, `log`,
`h24`, dan `h7`.

- `log`: 8 pembacaan terakhir, terbaru di atas.
- `h24`: rata-rata suhu per jam, maksimal 24 bucket terakhir.
- `h7`: rata-rata suhu per hari, maksimal 7 bucket terakhir.
- `hari`: dihitung dari `startedAt` drum, dibatasi `1..total_hari`.

### `GET /api/drums`

```json
{ "drums": [{ "id": "B-024" }, { "id": "B-025" }] }
```

### `GET /health`

`200 {"ok":true}` jika koneksi database hidup, `503` jika tidak.

## Klasifikasi

`src/classify.ts` memakai ambang yang sama dengan dashboard: suhu `40–45°C`,
kelembapan `55–70%`. `ml_label` saat ini adalah label aturan ambang, **bukan**
keluaran Random Forest / Isolation Forest. Ganti fungsi itu saat model server
tersedia.

## Catatan integrasi `mush-react`

Backend ini mengikuti kontrak v3.1, sedangkan adapter React masih mengharapkan
bentuk data contoh. Sebelum `USE_MOCK:false`:

1. `Api.getDrums()` harus memetakan `{ drums: [{ id }] }` menjadi daftar
   snapshot, atau backend menambah endpoint snapshot.
2. `selectDrum()` di `App.jsx` masih membatasi pilihan ke `SEED[id]`.
3. View React memakai field di luar kontrak: `label`, `started`, `berat`,
   `kapasitas_kg`, `machine_sensors`, dan `sensor_history`. Field itu belum
   disediakan backend.

## Struktur

```
src/config.ts     ambang, jumlah log, rentang histori
src/classify.ts   aturan status + label deterministik
src/env.ts        validasi environment
src/db.ts         PrismaClient + driver adapter pg
src/app.ts        route dan serialisasi response
src/server.ts     listen + graceful shutdown
prisma/           schema, migrasi awal, seed
```
