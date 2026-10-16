# Asia Stock Index Map

A static website that shows how each Asian country's main stock index is moving, on a single map. When the page loads, countries appear one by one (ordered from the biggest gain), colored green when up and red when down. The bigger the move, the stronger the color, up to ±3% (values beyond that are clamped).

- Frontend: HTML + CSS + vanilla JS, [Apache ECharts](https://echarts.apache.org/) 5.5.1 from a CDN, no build step.
- Data: a GitHub Actions workflow runs `scripts/fetch-indices.mjs` (Node 20, no dependencies), which pulls data from Yahoo Finance and writes `data/indices.json`, then deploys the site to GitHub Pages. The fetched JSON is **not** committed to the repo.
- Data is read once when the page loads (no auto refresh). Reload the page to get the latest data.

The UI itself is in Indonesian, with Indonesian number formatting and times in WIB (UTC+7).

## Structure

```
index.html
assets/style.css
assets/app.js
assets/asia.geo.json       Natural Earth 110m, Asian countries (+ HKG & SGP from 50m)
assets/flags/              country flags from flag-icons (MIT)
scripts/fetch-indices.mjs
data/indices.json          sample data for local development
.github/workflows/update.yml
```

## GitHub Pages setup

1. Push the repo to GitHub (branch `main`).
2. Go to **Settings > Pages**, and under **Build and deployment > Source** choose **GitHub Actions**.
3. The `Update data & deploy` workflow runs automatically on every push to `main`, every 15 minutes between 00:00 and 11:59 UTC (07:00–18:59 WIB) Monday to Friday, or manually from **Actions > Update data & deploy > Run workflow**.

Note: GitHub does not guarantee cron schedules run on time, so updates can be more than 15 minutes apart when the queue is busy.

## Running locally

Requires Node 20 or newer.

```bash
node scripts/fetch-indices.mjs
```

```bash
npx serve .
```

Then open http://localhost:3000. The page must be served over HTTP (not `file://`) because the GeoJSON and JSON are loaded with `fetch`.

Optional environment variables for the script:

| Variable    | Purpose |
|-------------|---------|
| `PAGES_URL` | URL of the live site, e.g. `https://user.github.io/repo/`. The previous JSON is downloaded from here as a fallback. Set automatically in the workflow. |
| `OUT_FILE`  | Output path, default `data/indices.json`. |

## How the data works

- Endpoint: `https://query1.finance.yahoo.com/v8/finance/chart/{TICKER}?range=1mo&interval=1d`, sent with a regular browser User-Agent.
- **Daily change %** = (`regularMarketPrice` − previous trading day's close) / previous trading day's close. The previous close comes from the daily close array (the last bar whose exchange-local date is before the date of `regularMarketTime`), not from `chartPreviousClose`.
- Some exchanges (Thailand's SET, the Philippines' PSEi, Vietnam's VN-Index) return only one bar at `interval=1d`. For these tickers the script refetches with `interval=1h` and uses the last bar of each day as that day's close. As a result, the previous close can differ slightly from the official figure when the exchange has a closing auction after the last hourly bar.
- **Status**: `buka` (open) if `regularMarketTime` is less than 30 minutes before fetch time, otherwise `tutup` (closed).
- Each request is retried twice with a 2-second delay, with a 300 ms pause between tickers.
- **Fallback**: before writing new JSON, the script downloads the previous JSON from `PAGES_URL` (or reads the local file if that is unavailable). Tickers that fail reuse their previous data and are marked `"stale": true` (shown as "data lama"). If every ticker fails, the previous JSON is kept and the workflow still deploys.

## Adding a new index

1. Check that the ticker is valid:

   ```bash
   curl -s -A "Mozilla/5.0" "https://query1.finance.yahoo.com/v8/finance/chart/%5ENSEI?range=1mo&interval=1d" | head -c 400
   ```

   Replace `^` with `%5E` in the URL. A valid response contains `chart.result[0].meta.regularMarketPrice`.
2. Add an entry to the `INDICES` array in `scripts/fetch-indices.mjs`:

   ```js
   { country: 'IND', countryName: 'India', ticker: '^NSEI', name: 'Nifty 50' },
   ```

   `country` must be an ISO alpha-3 code present in `assets/asia.geo.json` (the `ISO_A3` property). Keep one index per country, since the map is colored per country. `countryName` is shown in the UI, so write it in Indonesian.
3. If the country is missing from the GeoJSON (for example a small country not included at the 110m scale), add its feature from Natural Earth 50m with `ISO_A3` and `NAME` properties. The optional `cp: [lon, lat]` property sets the label position.
4. Add the country's flag: download `flags/4x3/{alpha-2}.svg` from [flag-icons](https://github.com/lipis/flag-icons) (MIT) into `assets/flags/`, add `width="640" height="480"` to its root `<svg>` tag (needed to draw it on the map canvas), and map the ISO alpha-3 code to the alpha-2 file name in `FLAG` in `assets/app.js`.
5. If the index name is too long for a map label, add a short name to `MAP_LABEL` in `assets/app.js`.
6. Run `node scripts/fetch-indices.mjs` and check the output.

## Indices

| Country | Ticker | Index |
|---|---|---|
| Japan | `^N225` | Nikkei 225 |
| Hong Kong | `^HSI` | Hang Seng |
| Indonesia | `^JKSE` | IHSG (Jakarta Composite) |
| South Korea | `^KS11` | KOSPI |
| Taiwan | `^TWII` | TAIEX |
| Singapore | `^STI` | Straits Times |
| Malaysia | `^KLSE` | FTSE Bursa Malaysia KLCI |
| Thailand | `^SET.BK` | SET |
| India | `^BSESN` | Sensex |
| China | `000001.SS` | Shanghai Composite |
| Philippines | `PSEI.PS` | PSEi |
| Vietnam | `^VNINDEX.VN` | VN-Index |

Pakistan (KSE-100) and Sri Lanka (CSE ASPI) are not included because no valid ticker was found on Yahoo's chart endpoint (`^KSE`, `^KSE100`, `KSE100.KA`, `^CSE`, `CSEALL.CM` all return 404).

---

Data is delayed by about 15 minutes. Source: Yahoo Finance. Not investment advice.
