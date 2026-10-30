# MUSH Server

REST API untuk pemantauan fermentasi silase Pagi Farm. Menerima bacaan sensor
dari gateway ESP32, menyimpannya ke PostgreSQL, dan menyajikan snapshot terbaru
untuk dashboard.

**Stack:** AdonisJS 6 · TypeScript · Prisma 7 · PostgreSQL 16+ · Zod

## Ringkasan

- Ingest bacaan suhu, kelembapan, tekanan, dan gas per drum.
- Pencatatan event gaya tekan dari load cell screw press.
- Snapshot dashboard: bacaan terbaru, log 8 titik, rata-rata per jam (24 jam),
  dan rata-rata per hari (7 hari).
- Klasifikasi ambang deterministik untuk status dan `ml_label`.
- Delegasi prediksi ke layanan terpisah [`mush-ml`](https://github.com/rizkiramadhani-001/mush-ml).
- Validasi environment dan payload dengan Zod.

## Alur sistem

```
DS18B20 / MQ-135 / sensor tekanan
        │
        ▼
   LGT8F32P → RF433 → ESP32 → router 4G
        │
        ▼
POST /api/readings ──► mush-server ──► PostgreSQL
                            │
                            ├── GET /api/latest  ──► mush-react
                            └── POST /predict    ──► mush-ml
```

Server ini tidak menjalankan inferensi sendiri. Model per batch dilatih di
`mush-ml`, lalu dipanggil lewat HTTP.

## Menjalankan

Kebutuhan: Node.js 22+, PostgreSQL 16+ (atau Docker).

```bash
npm install
cp .env.example .env
npx tsx ace generate:key --show   # isi APP_KEY di .env
docker compose up -d              # PostgreSQL 17 di port 5432
npm run db:deploy
npm run db:seed
npm run dev
```

Server berjalan di `http://localhost:8080`.

Tanpa Docker, gunakan PostgreSQL lokal atau Prisma Postgres:

```bash
npx prisma dev -d
# salin URL TCP yang dicetak ke DATABASE_URL
npm run db:deploy && npm run db:seed
```

Seed membuat dua drum (`B-024`, `B-025`), batch aktif, riwayat bacaan, dan
event tekan. Batch aktif adalah batch dengan `tanggal_mulai` terbaru per drum.

Produksi:

```bash
npm run build
npm start          # node dist/bin/server.js
```

Perintah lain:

```bash
npm run typecheck
npm test
npm run db:studio
npm run db:migrate   # prisma migrate dev
```

## Konfigurasi

| Variabel | Default | Keterangan |
|---|---|---|
| `DATABASE_URL` | wajib | Connection string PostgreSQL |
| `APP_KEY` | wajib | Kunci enkripsi AdonisJS, minimal 16 karakter |
| `ML_URL` | `http://127.0.0.1:8081` | Base URL layanan `mush-ml` |
| `HOST` | `0.0.0.0` | Alamat bind HTTP |
| `PORT` | `8080` | Port HTTP |
| `CORS_ORIGIN` | `http://localhost:8000,http://localhost:5173` | Origin dipisah koma, atau `*` |
| `APP_TZ` | `Asia/Jakarta` | Zona waktu label jam, hari fermentasi, dan bucket histori |

`start/env.ts` memvalidasi semua variabel saat boot. Konfigurasi tidak valid
menghentikan proses dengan daftar masalah.

## Body parser

Request JSON ditangani `@adonisjs/core/bodyparser_middleware`:

- `adonisrc.ts` mem-preload `start/kernel.js` sebelum `start/routes.js`.
- `start/kernel.ts` mendaftarkan body parser dan CORS pada stack server.
- `config/bodyparser.ts` memakai konfigurasi default.

Tanpa ketiganya `request.body()` bernilai `{}` dan `POST /api/readings`
mengembalikan `400 Payload tidak valid`.

## Endpoint

| Method | Path | Fungsi |
|---|---|---|
| `GET` | `/health` | Cek koneksi database |
| `GET` | `/api/drums` | Daftar drum |
| `GET` | `/api/latest?drum=B-024` | Snapshot dashboard |
| `GET` | `/api/predict?drum=B-024` | Prediksi 1 dan 7 hari |
| `POST` | `/api/readings` | Simpan bacaan sensor |
| `POST` | `/api/press-events` | Simpan event gaya tekan |

### `POST /api/readings`

Dipakai gateway ESP32. `t` opsional; jika kosong dipakai waktu server.
`kelembapan`, `tekanan`, dan `gas` opsional mengikuti node final.

```json
{
  "drum_id": "B-024",
  "suhu": 41.2,
  "kelembapan": 62,
  "tekanan": 12.4,
  "gas": 418,
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

`kelembapan` harus bilangan bulat 0–100; `gas` bilangan bulat ≥ 0; `suhu` dan
`tekanan` bilangan finite.

Drum yang belum terdaftar dibuat otomatis saat bacaan pertama masuk: drum baru
memakai `kapasitas_kg` 50 dan `status` `aktif`, lalu dibuat batch aktif 14 hari
dengan `tanggal_mulai` mengikuti waktu bacaan. Drum yang sudah punya batch aktif
memakai batch tersebut.

### `POST /api/press-events`

```json
{ "drum_id": "B-024", "gaya_tekan": 812.4, "t": "2026-10-10T09:30:00+07:00" }
```

```json
{ "ok": true, "batch_id": 1, "gaya_tekan": 812.4 }
```

`gaya_tekan` dalam newton (N), sesuai subbab load cell laporan. Event untuk
drum baru juga membuat drum dan batch aktif secara otomatis.

### `GET /api/latest?drum=B-024`

```json
{
  "drum_id": "B-024",
  "suhu": 41.2,
  "kelembapan": 62,
  "tekanan": 12.4,
  "gas": 418,
  "hari": 9,
  "total_hari": 14,
  "progres_pct": 64,
  "berat": 5,
  "started": "2026-10-21",
  "status": "dalam_target",
  "ml_label": "Asam laktat",
  "sinkron": "10:42",
  "sumber": "sensor drum B-024",
  "log": [{ "t": "10:42", "suhu": 41.2, "hum": 62, "tekanan": 12.4, "gas": 418 }],
  "h24": [41.0, 41.2],
  "h7": [40.9, 41.1]
}
```

- `log`: 8 pembacaan terakhir, terbaru di atas.
- `h24`: rata-rata suhu per jam, maksimal 24 bucket terakhir.
- `h7`: rata-rata suhu per hari, maksimal 7 bucket terakhir.
- `hari`: dihitung dari `batches.tanggal_mulai`, dibatasi `1..total_hari`.
- `berat`: `batches.berat_kg`, `null` bila paket belum ditimbang.
- `started`: tanggal mulai batch, format `YYYY-MM-DD`.

### `GET /api/predict?drum=B-024`

Mendelegasikan ke `POST /predict` milik `mush-ml` dengan `batch_id` dan waktu
server. Model harus sudah dilatih untuk batch tersebut (lihat README `mush-ml`).

```json
{
  "drum_id": "B-024",
  "batch_id": 1,
  "generated_at": "2026-10-23T06:51:31.574Z",
  "model": "regresi_linear",
  "parameters": {
    "suhu": {
      "satuan": "°C",
      "prediksi": [
        {
          "hari": 1,
          "waktu": "2026-10-24T06:51:31.574Z",
          "nilai": 41.2,
          "metrik": { "mae": 0.22, "rmse": 0.24, "r2": -0.003, "n": 68 }
        }
      ]
    },
    "tekanan": null,
    "gas": null
  }
}
```

Satuan: `suhu` °C, `tekanan` Pa (sensor diferensial), `gas` nilai ADC mentah
MQ-135 — bukan ppm, karena kalibrasi gas belum dilakukan. Parameter tanpa
prediksi bernilai `null`.

### `GET /api/drums`

```json
{ "drums": [{ "id": "B-024" }, { "id": "B-025" }] }
```

### `GET /health`

`200 {"ok":true}` bila koneksi database hidup, `503` bila tidak.

### Status error

| Status | Kondisi |
|---|---|
| `400` | Query wajib tidak ada atau payload tidak lolos validasi |
| `404` | Drum tidak dikenal atau belum punya batch aktif pada `GET /api/latest` dan `GET /api/predict` |
| `503` | Database mati (`/health`) atau layanan ML tidak tersedia |

Payload tidak valid menyertakan detail:

```json
{
  "error": "Payload tidak valid",
  "issues": [{ "path": "suhu", "message": "Invalid input: expected number, received undefined" }]
}
```

## Klasifikasi

`app/utils/classify.ts` memakai ambang yang sama dengan dashboard: suhu
`40–45°C`, kelembapan `55–70%` bila dikirim.

| Kondisi | Status | Label |
|---|---|---|
| Suhu dan kelembapan dalam target | `dalam_target` | Asam laktat |
| Suhu di atas target | `di_luar_target` | Anomali: cek udara |
| Suhu di bawah target | `di_luar_target` | Awal fermentasi |
| Hanya kelembapan di luar target | `di_luar_target` | Perlu perhatian |

`ml_label` adalah label aturan ambang, **bukan** keluaran Random Forest atau
Isolation Forest.

## Integrasi `mush-react`

Dashboard React memakai server ini secara default (`USE_MOCK: false`).

- `src/api.js` memetakan `{ drums: [{ id }] }` + `/api/latest` menjadi snapshot
  yang dipakai view.
- `selectDrum()` membaca daftar drum dari server, bukan data contoh.
- `sensor_history` dibangun dari `log`; `machine_sensors` belum dikirim server
  dan ditampilkan sebagai "Belum ada data".
- Vite meneruskan `/api` dan `/health` ke `127.0.0.1:8080`.

Jalankan API lebih dulu, lalu dashboard:

```bash
cd mush-server && npm run dev     # http://localhost:8080
cd mush-react && npm run dev      # http://localhost:5173
```

## Struktur

```
app/
  controllers/mush_controller.ts  HTTP handler AdonisJS
  domain/                         class Drum, Batch, Reading, PressEvent
  middleware/cors_middleware.ts   CORS sesuai CORS_ORIGIN
  services/db.ts                  PrismaClient + driver adapter pg
  services/server_api.ts          logika API dan serialisasi response
  services/model_ml.ts            klien HTTP mush-ml
  utils/classify.ts               aturan status + label
  utils/config.ts                 ambang, jumlah log, rentang histori
config/                           app, body parser, logger
start/env.ts                      validasi environment
start/kernel.ts                   middleware server (body parser, CORS)
start/routes.ts                   definisi route
prisma/                           schema, migrasi, seed
test/classify.test.ts             unit test klasifikasi
```

## Pengujian

```bash
npm run typecheck
npm test
```

Tes mencakup batas target, suhu di atas/bawah target, kelembapan di luar target,
dan node yang hanya mengirim suhu.

## Batasan

- Belum ada ingest MQTT atau push WebSocket; komunikasi masih HTTP.
- Endpoint `alerts`, `events`, dan `gate_events` belum dibuat, tabelnya sudah ada.
- Belum ada autentikasi; batasi akses lewat reverse proxy atau jaringan privat.
- Model Random Forest / Isolation Forest belum ada; prediksi masih regresi linear.
- `machine_sensors` belum menjadi bagian response server.

## Repo terkait

- [MUSH React](https://github.com/rizkiramadhani-001/mush-react) — dashboard Ionic React
- [MUSH ML](https://github.com/rizkiramadhani-001/mush-ml) — layanan prediksi FastAPI
- [Landing page](https://github.com/rizkiramadhani-001/landing)
