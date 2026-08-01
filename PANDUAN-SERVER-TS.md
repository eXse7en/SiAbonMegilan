# Panduan Deploy Coolify — Bagian `server.ts`

> **Tujuan dokumen:** Setiap kali kode di-update (misalnya dari AI Studio / sumber lain), file `server.ts` sering tertimpa versi lama. Dokumen ini berisi **bagian-bagian kritis** yang WAJIB ada di `server.ts` agar aplikasi tetap berjalan normal di Coolify. Cukup cek & perbaiki 4 bagian ini — tidak perlu mengubah file lain.

---

## 🚦 Ringkasan Cepat

| # | Bagian di `server.ts` | Kalau hilang → Akibatnya |
|---|---|---|
| 1 | `PORT` dibaca dari env | ❌ Aplikasi tidak bisa diakses (jalan di port 3000, padahal container expose 80) |
| 2 | Endpoint `/healthz` | ❌ Healthcheck Docker gagal → container dianggap *unhealthy* → restart-loop di Coolify |
| 3 | Handling private key Google Sheets (robust) | ❌ Koneksi ke spreadsheet gagal jika key tersimpan tanpa newline |
| 4 | Email pengirim Resend `noreplay@siabonmegilan.qzz.io` | ❌ Email reset password tidak terkirim ke karyawan |

> 💡 **Line number bisa berubah** setiap update. Gunakan **cari kata kunci** (Ctrl+F) di bawah, bukan line number.

---

## 1️⃣ PORT dari Environment (WAJIB)

**Kata kunci pencarian:** `const PORT`

**Lokasi:** di dalam `async function startServer()`, tepat setelah `const app = express();`

**Kode yang HARUS ada:**
```ts
const PORT = parseInt(process.env.PORT || '3000');
```

**Yang SALAH (sering muncul setelah update):**
```ts
const PORT = 3000; // ❌ hardcode — Coolify inject PORT=80, kode ini mengabaikannya
```

**Penjelasan:** Coolify (via `docker-compose.yml` & `Dockerfile`) mengekspos port **80** dan meng-inject `PORT=80`. Kalau di-hardcode 3000, server jalan di port 3000 yang tidak ter-expose → aplikasi tidak bisa dibuka.

---

## 2️⃣ Endpoint `/healthz` (WAJIB)

**Kata kunci pencarian:** `healthz`

**Lokasi:** **paling akhir** — tepat sebelum komentar `// Vite middleware for development`

**Kode yang HARUS ada:**
```ts
app.get('/healthz', (req, res) => {
  res.status(200).json({ status: 'ok' });
});
```

**Penjelasan:** `Dockerfile` dan `docker-compose.yml` memakai `/healthz` untuk healthcheck:
```dockerfile
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://localhost:80/healthz').then(r=>{process.exit(r.ok?0:1)}).catch(()=>process.exit(1))"
```
Tanpa endpoint ini, healthcheck selalu gagal → container di-mark *unhealthy*.

---

## 3️⃣ Handling Private Key Google Sheets (WAJIB)

**Kata kunci pencarian:** `privateKey`

**Lokasi:** di dalam blok `if (process.env.SPREADSHEET_ID && ...)`, tepat setelah `try {`

**Kode yang HARUS ada (versi robust):**
```ts
let privateKey = process.env.GOOGLE_PRIVATE_KEY;
privateKey = privateKey.replace(/\\\\n/g, '\n').replace(/\\n/g, '\n');
if (!privateKey.includes('\n')) {
  privateKey = privateKey.replace(/-----BEGIN PRIVATE KEY-----/, '-----BEGIN PRIVATE KEY-----\n')
    .replace(/-----END PRIVATE KEY-----/, '\n-----END PRIVATE KEY-----\n')
    .replace(/(.{64})/g, '$1\n');
}
```

**Yang SALAH (versi sederhana, sering muncul setelah update):**
```ts
const privateKey = process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'); // ❌
```

**Penjelasan:** Jika `GOOGLE_PRIVATE_KEY` di Coolify tersimpan sebagai **satu baris panjang tanpa newline** (umum terjadi saat paste dari UI), versi sederhana tidak bisa memperbaikinya → koneksi Google Sheets gagal tanpa error jelas. Versi robust memperbaiki format PEM secara otomatis.

---

## 4️⃣ Email Pengirim Resend (WAJIB)

**Kata kunci pencarian:** `from: 'Si Abon Megilan`

**Lokasi:** di dalam `app.post('/api/forgot-password', ...)`, pada pemanggilan `resend.emails.send({ ... })`

**Kode yang HARUS ada:**
```ts
from: 'Si Abon Megilan <noreplay@siabonmegilan.qzz.io>',
```

**Yang SALAH (sering muncul setelah update):**
```ts
from: 'Si Abon Megilan <onboarding@resend.dev>', // ❌
```

**Penjelasan:** `onboarding@resend.dev` adalah alamat default Resend yang hanya bisa mengirim ke email terverifikasi di akun Resend — email ke karyawan akan **gagal terkirim**. Domain `siabonmegilan.qzz.io` sudah terverifikasi di akun Resend.

---

## 📦 File Pendukung (tidak boleh hilang)

Pastikan 3 file ini ada di root repo — **kalau tidak ada, salin dari repo forgejo (lama)**:

| File | Fungsi |
|---|---|
| `Dockerfile` | Build multi-stage (node:20-alpine), EXPOSE 80, healthcheck `/healthz` |
| `docker-compose.yml` | Passthrough env var ke container untuk Coolify |
| `.dockerignore` | Mengecualikan `node_modules`, `dist`, `.env`, dll dari build |

> ⚠️ File-file ini **tidak diubah** saat update kode — cukup pastikan tetap ada.

---

## ✅ Checklist Sebelum Deploy

Setelah update kode, lakukan ini:

```bash
# 1. Cek 4 bagian kritis (harus muncul semua)
Select-String -Path server.ts -Pattern "const PORT", "healthz", "privateKey", "noreplay@siabonmegilan"

# 2. Type-check (harus 0 error)
npm run lint
```

| # | Cek | Harus muncul |
|---|---|---|
| 1 | `const PORT` | `parseInt(process.env.PORT \|\| '3000')` |
| 2 | `healthz` | `app.get('/healthz', ...)` |
| 3 | `privateKey` | `privateKey.replace(/\\\\n/g, ...)` + blok `if (!privateKey.includes('\n'))` |
| 4 | `noreplay` | `noreplay@siabonmegilan.qzz.io` |
| 5 | File Docker | `Dockerfile`, `docker-compose.yml`, `.dockerignore` ada di root |
| 6 | `npm run lint` | Lulus tanpa error |

---

## 🧪 Verifikasi Setelah Deploy di Coolify

1. **Health check:** Buka `https://<domain-aplikasi>/healthz` → harus merespons `{"status":"ok"}`
2. **Spreadsheet:** Login sebagai user → data karyawan/absensi muncul (berarti koneksi Google Sheets jalan)
3. **Email reset:** Coba "Lupa kata sandi" dengan email terdaftar → email terkirim
4. **Aplikasi:** Login admin & user normal, absen masuk/keluar bekerja

---

## ❓ FAQ

**Q: Kenapa `server.ts` sering kembali ke versi lama saat update?**
A: Jika update berasal dari AI Studio / export template, `server.ts` sering di-generate ulang tanpa 4 bagian kritis di atas. Dokumen ini ada untuk memperbaikinya dalam 2 menit.

**Q: Apakah perlu mengubah file lain selain `server.ts`?**
A: Tidak. Semua file frontend (`Home.tsx`, `Attendance.tsx`, `alarm.ts`, dll) dan `package.json` tidak perlu disentuh untuk deploy.

**Q: Apa yang terjadi jika hanya 1 bagian yang hilang?**
A: Tergantung bagiannya — lihat tabel di atas. Paling fatal: PORT & `/healthz` (aplikasi tidak bisa diakses / restart-loop). Paling tidak kentara: private key (spreadsheet diam-diam tidak terhubung, aplikasi jalan tapi data kosong).
