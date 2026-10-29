# MUSH Server

Backend REST untuk dashboard MUSH (Pagi Farm): AdonisJS + TypeScript,
Prisma 7, dan PostgreSQL. Mengikuti `mush-dashboard/api-contract.json` v3.1
dan ERD `dokumen/diagram/ERD_MUSH.drawio`. Inferensi prediksi dikerjakan
layanan terpisah `../mush-ml`.

## Model data

```
drums (id, nama, kapasitas_kg, status)
  └─ batches (id, drum_id, tanggal_mulai, total_hari, berat_kg)
       ├─ readings (waktu, suhu, kelembapan, tekanan, gas, label)
       ├─ press_events (waktu, gaya_tekan)
       ├─ gate_events (waktu, tercapai)
       ├─ alerts (waktu, jenis, pesan)
       └─ events (waktu, judul, status, tone)
```

API tetap memakai `drum_id` (`B-024`) seperti kontrak; nilainya dipetakan ke
`drums.nama`. Batch aktif = batch dengan `tanggal_mulai` terbaru pada drum itu.

## Jalankan

Kebutuhan: Node.js 22+, Python 3.11+, dan PostgreSQL 16+.

```bash
# terminal 1 — layanan ML (FastAPI + scikit-learn)
cd mush-ml
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
python server.py            # http://localhost:8081

# terminal 2 — API
cd mush-server
npm install
cp .env.example .env        # sesuaikan DATABASE_URL dan ML_URL
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
| `ML_URL` | `http://127.0.0.1:8081` | Base URL layanan `mush-ml` |
| `HOST` | `0.0.0.0` | Alamat bind AdonisJS |
| `PORT` | `8080` | Port HTTP |
| `CORS_ORIGIN` | `http://localhost:8000,http://localhost:5173` | Daftar origin dipisah koma, atau `*` |
| `APP_TZ` | `Asia/Jakarta` | Zona waktu label jam, hari fermentasi, dan bucket histori |

## Endpoint

### `POST /api/readings`

Dipakai gateway ESP32. `t` opsional; jika kosong dipakai waktu server.
`tekanan` dan `gas` opsional mengikuti node final (DS18B20, MQ-135, sensor
tekanan). `kelembapan` opsional dan hanya dipakai bila dikirim.

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

Drum harus sudah terdaftar dan punya batch aktif (seed: `B-024`, `B-025`);
drum tidak dikenal mengembalikan `404`.

### `POST /api/press-events`

Mencatat gaya tekan load cell screw press ke batch aktif.

```json
{ "drum_id": "B-024", "gaya_tekan": 812.4, "t": "2026-10-10T09:30:00+07:00" }
```

```json
{ "ok": true, "batch_id": 1, "gaya_tekan": 812.4 }
```

`gaya_tekan` dinyatakan dalam newton (N), sesuai subbab load cell laporan.

### `GET /api/latest?drum=B-024`

Mengembalikan snapshot terbaru sesuai kontrak: `suhu`, `kelembapan`, `hari`,
`total_hari`, `progres_pct`, `status`, `ml_label`, `sinkron`, `sumber`, `log`,
`h24`, dan `h7`, ditambah `tekanan` dan `gas`.

- `log`: 8 pembacaan terakhir, terbaru di atas.
- `h24`: rata-rata suhu per jam, maksimal 24 bucket terakhir.
- `h7`: rata-rata suhu per hari, maksimal 7 bucket terakhir.
- `hari`: dihitung dari `batches.tanggal_mulai`, dibatasi `1..total_hari`.

### `GET /api/predict?drum=B-024`

Server membaca deret dari database, lalu meneruskannya ke `POST /predict` milik
layanan `mush-ml`. Regresi linear per parameter dengan horizon 1 hari dan 7
hari. Data diurutkan kronologis; 80% awal untuk latih, 20% akhir untuk uji.
Metrik `mae`, `rmse`, dan `r2` dihitung pada bagian uji; `r2` bernilai `null`
bila variansi nol.

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
        { "hari": 1, "waktu": "2026-10-24T06:51:31.574Z", "nilai": 41.2, "metrik": { "mae": 0.22, "rmse": 0.24, "r2": -0.003, "n": 68 } }
      ]
    },
    "tekanan": null,
    "gas": null
  }
}
```

`tekanan`/`gas` bernilai `null` bila pembacaan untuk parameter itu kurang dari
dua. Batch dengan kurang dari dua pembacaan mengembalikan `409`.

Satuan: `suhu` °C, `tekanan` Pa (sensor diferensial), `gas` nilai ADC mentah
MQ-135 — bukan ppm, karena kalibrasi gas belum dilakukan.

Kalau `mush-ml` mati atau timeout (8 detik), endpoint mengembalikan `503`
`{"error":"Layanan ML tidak tersedia"}`.

### `GET /api/drums`

```json
{ "drums": [{ "id": "B-024" }, { "id": "B-025" }] }
```

### `GET /health`

`200 {"ok":true}` jika koneksi database hidup, `503` jika tidak.

## Klasifikasi

`src/classify.ts` memakai ambang yang sama dengan dashboard: suhu `40–45°C`,
kelembapan `55–70%` bila dikirim. `ml_label` saat ini adalah label aturan
ambang, **bukan** keluaran Random Forest / Isolation Forest.

## Belum diimplementasikan

- Ingest MQTT dan push WebSocket dari arsitektur (server masih HTTP saja).
- Endpoint `alerts`/`events`/`gate_events`; tabelnya sudah ada sesuai ERD.
- Model Random Forest / Isolation Forest; `mush-ml` masih regresi linear.

## Catatan integrasi `mush-react`

Backend ini mengikuti kontrak v3.1, sedangkan adapter React masih mengharapkan
bentuk data contoh. Sebelum `USE_MOCK:false`:

1. `Api.getDrums()` harus memetakan `{ drums: [{ id }] }` menjadi daftar
   snapshot, atau backend menambah endpoint snapshot.
2. `selectDrum()` di `App.jsx` masih membatasi pilihan ke `SEED[id]`.
3. View React memakai field di luar kontrak: `label`, `started`, `berat`,
   `kapasitas_kg`, `machine_sensors`, dan `sensor_history`.

## Struktur

```
app/utils/config.ts       ambang, jumlah log, rentang histori
app/utils/classify.ts     aturan status + label deterministik
start/env.ts              validasi environment
app/services/db.ts        PrismaClient + driver adapter pg
app/services/server_api.ts service API dan serialisasi response
app/controllers/          controller HTTP AdonisJS
app/domain/               class Drum, Batch, Reading, PressEvent sesuai UML
start/routes.ts   definisi route AdonisJS
bin/server.ts     entry point HTTP AdonisJS
prisma/           schema, migrasi awal, seed
```

Inferensi prediksi ada di `../mush-ml`, bukan di folder ini.
