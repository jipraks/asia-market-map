#!/usr/bin/env node
// Mengambil data indeks saham Asia dari Yahoo Finance dan menulis data/indices.json.
// Tanpa dependency eksternal: butuh Node 20+ (fetch bawaan).
//
// Env opsional:
//   PAGES_URL  URL situs GitHub Pages yang sedang live (mis. https://user.github.io/repo/)
//              dipakai untuk mengambil JSON lama sebagai fallback.
//   OUT_FILE   lokasi output (default: data/indices.json)

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_FILE = resolve(ROOT, process.env.OUT_FILE || 'data/indices.json');
const PAGES_URL = process.env.PAGES_URL || '';

// Tambah indeks baru cukup di sini. `country` = ISO alpha-3, harus ada di assets/asia.geo.json.
export const INDICES = [
  { country: 'JPN', countryName: 'Jepang', ticker: '^N225', name: 'Nikkei 225' },
  { country: 'HKG', countryName: 'Hong Kong', ticker: '^HSI', name: 'Hang Seng' },
  { country: 'IDN', countryName: 'Indonesia', ticker: '^JKSE', name: 'IHSG' },
  { country: 'KOR', countryName: 'Korea Selatan', ticker: '^KS11', name: 'KOSPI' },
  { country: 'TWN', countryName: 'Taiwan', ticker: '^TWII', name: 'TAIEX' },
  { country: 'SGP', countryName: 'Singapura', ticker: '^STI', name: 'Straits Times' },
  { country: 'MYS', countryName: 'Malaysia', ticker: '^KLSE', name: 'FTSE Bursa Malaysia KLCI' },
  { country: 'THA', countryName: 'Thailand', ticker: '^SET.BK', name: 'SET' },
  { country: 'IND', countryName: 'India', ticker: '^BSESN', name: 'Sensex' },
  { country: 'CHN', countryName: 'Tiongkok', ticker: '000001.SS', name: 'Shanghai Composite' },
  { country: 'PHL', countryName: 'Filipina', ticker: 'PSEI.PS', name: 'PSEi' },
  { country: 'VNM', countryName: 'Vietnam', ticker: '^VNINDEX.VN', name: 'VN-Index' },
  // Pakistan (KSE-100) dan Sri Lanka (CSE ASPI): tidak ditemukan ticker yang valid
  // di endpoint chart Yahoo (^KSE, ^KSE100, KSE100.KA, ^CSE, CSEALL.CM semua 404).
];

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';
const OPEN_THRESHOLD_MS = 30 * 60 * 1000;
const RETRIES = 2;
const RETRY_DELAY_MS = 2000;
const TICKER_DELAY_MS = 300;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const round = (n, d = 4) => Math.round(n * 10 ** d) / 10 ** d;

async function fetchJson(url) {
  let lastErr;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    if (attempt > 0) await sleep(RETRY_DELAY_MS);
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: 'application/json' },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

function chartUrl(ticker, interval) {
  return `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=1mo&interval=${interval}`;
}

// Tanggal lokal bursa (YYYY-MM-DD) dari epoch detik + gmtoffset detik.
const localDate = (ts, offset) => new Date((ts + offset) * 1000).toISOString().slice(0, 10);

// Ubah bar (harian atau per jam) jadi daftar close harian: bar terakhir per tanggal lokal menang.
function toDailyCloses(result) {
  const { meta, timestamp = [] } = result;
  const closes = result.indicators?.quote?.[0]?.close || [];
  const offset = meta.gmtoffset || 0;
  const byDate = new Map();
  timestamp.forEach((ts, i) => {
    const c = closes[i];
    if (c == null || !Number.isFinite(c)) return;
    byDate.set(localDate(ts, offset), c);
  });
  return [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, close]) => ({ date, close }));
}

async function fetchIndex(def) {
  let data = await fetchJson(chartUrl(def.ticker, '1d'));
  let result = data?.chart?.result?.[0];
  if (!result?.meta) throw new Error(data?.chart?.error?.description || 'respon kosong');
  let daily = toDailyCloses(result);

  // Beberapa bursa (SET, PSEi, VN-Index) hanya mengembalikan 1 bar harian.
  // Fallback: ambil data per jam lalu rangkum jadi close harian.
  if (daily.length < 2) {
    await sleep(TICKER_DELAY_MS);
    data = await fetchJson(chartUrl(def.ticker, '1h'));
    const hourly = data?.chart?.result?.[0];
    if (hourly?.meta) {
      result = hourly;
      daily = toDailyCloses(hourly);
    }
  }

  const { meta } = result;
  const price = meta.regularMarketPrice;
  const marketTs = meta.regularMarketTime;
  if (!Number.isFinite(price) || !Number.isFinite(marketTs)) throw new Error('harga/waktu tidak tersedia');

  const offset = meta.gmtoffset || 0;
  const today = localDate(marketTs, offset);
  // Close hari bursa terakhir sebelum tanggal regularMarketTime.
  const past = daily.filter((d) => d.date < today);
  if (past.length === 0) throw new Error('tidak ada close hari bursa sebelumnya');

  const prevClose = past[past.length - 1].close;
  const change = price - prevClose;

  return {
    ...def,
    price: round(price),
    prevClose: round(prevClose),
    change: round(change),
    changePct: round((change / prevClose) * 100),
    marketTime: new Date(marketTs * 1000).toISOString(),
    status: Date.now() - marketTs * 1000 < OPEN_THRESHOLD_MS ? 'buka' : 'tutup',
  };
}

async function loadPrevious() {
  if (PAGES_URL) {
    const url = new URL('data/indices.json', PAGES_URL.endsWith('/') ? PAGES_URL : PAGES_URL + '/');
    url.searchParams.set('t', Date.now());
    try {
      const json = await fetchJson(url.href);
      if (Array.isArray(json?.indices)) {
        console.log(`Data lama diambil dari ${url.origin}${url.pathname}`);
        return json;
      }
    } catch (err) {
      console.warn(`Gagal mengambil data lama dari Pages: ${err.message}`);
    }
  }
  try {
    const json = JSON.parse(await readFile(OUT_FILE, 'utf8'));
    if (Array.isArray(json?.indices)) {
      console.log(`Data lama diambil dari file lokal ${OUT_FILE}`);
      return json;
    }
  } catch {
    /* belum ada file lokal */
  }
  return null;
}

async function main() {
  const previous = await loadPrevious();
  const prevByTicker = new Map((previous?.indices || []).map((x) => [x.ticker, x]));

  const indices = [];
  let ok = 0;
  for (const [i, def] of INDICES.entries()) {
    if (i > 0) await sleep(TICKER_DELAY_MS);
    let item;
    try {
      item = await fetchIndex(def);
    } catch (err) {
      const old = prevByTicker.get(def.ticker);
      if (old) {
        indices.push({ ...old, ...def, status: 'tutup', stale: true });
        console.warn(`✗ ${def.ticker.padEnd(12)} gagal (${err.message}) → pakai data lama`);
      } else {
        console.warn(`✗ ${def.ticker.padEnd(12)} gagal (${err.message}) → di-skip`);
      }
      continue;
    }
    indices.push(item);
    ok++;
    const sign = item.changePct >= 0 ? '+' : '';
    console.log(`✓ ${def.ticker.padEnd(12)} ${def.name.padEnd(26)} ${String(item.price).padStart(12)}  ${sign}${item.changePct.toFixed(2)}%  ${item.status}`);
  }

  let output;
  if (ok === 0 && previous) {
    console.warn('Semua ticker gagal, data lama dipertahankan.');
    output = previous;
  } else {
    output = { generatedAt: new Date().toISOString(), indices };
  }

  await mkdir(dirname(OUT_FILE), { recursive: true });
  await writeFile(OUT_FILE, JSON.stringify(output, null, 2) + '\n');
  console.log(`\n${ok}/${INDICES.length} berhasil, ${output.indices.length} indeks ditulis ke ${OUT_FILE}`);
}

main().catch((err) => {
  // Jangan gagalkan workflow: situs tetap di-deploy dengan data yang ada.
  console.error('Error tak terduga:', err);
});
