(() => {
  'use strict';

  const RANGE = 3; // ±3%, di luar rentang di-clamp
  const REVEAL_DELAY = 280; // jeda antar negara saat animasi masuk (ms)
  const PULSE_MS = 450;
  // Nama pendek untuk label di peta (tooltip & panel tetap pakai nama lengkap).
  const MAP_LABEL = { '^KLSE': 'KLCI' };
  // ISO alpha-3 -> file bendera di assets/flags/ (flag-icons, kode alpha-2).
  const FLAG = {
    JPN: 'jp', HKG: 'hk', IDN: 'id', KOR: 'kr', TWN: 'tw', SGP: 'sg',
    MYS: 'my', THA: 'th', IND: 'in', CHN: 'cn', PHL: 'ph', VNM: 'vn',
  };
  const flagUrl = (country) => (FLAG[country] ? `assets/flags/${FLAG[country]}.svg` : null);
  const flagImg = (country) => {
    const src = flagUrl(country);
    return src ? `<img class="flag" src="${src}" alt="" width="18" height="14">` : '';
  };

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

  const PALETTES = {
    light: {
      upLo: '#b7e4c7', upHi: '#1b7a43',
      downLo: '#f3b8b5', downHi: '#c62828',
      zero: '#b0b6bd', nodata: '#e3e6ea', nodataHover: '#d3d8de',
      border: '#ffffff', text: '#1c2024', halo: 'rgba(255,255,255,0.9)',
      tipBg: '#ffffff', tipBorder: '#e1e5ea', muted: '#5f6b76', flagBorder: 'rgba(0,0,0,0.45)',
    },
    dark: {
      upLo: '#2e5b42', upHi: '#3fbf7a',
      downLo: '#6b3534', downHi: '#e05250',
      zero: '#4a525c', nodata: '#262c34', nodataHover: '#323943',
      border: '#0f1216', text: '#e7eaee', halo: 'rgba(15,18,22,0.85)',
      tipBg: '#171b21', tipBorder: '#2a3039', muted: '#9aa5b1', flagBorder: 'rgba(255,255,255,0.6)',
    },
  };
  const palette = () => PALETTES[darkQuery.matches ? 'dark' : 'light'];

  // ---------- Format Indonesia ----------
  const nf2 = new Intl.NumberFormat('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const nfSigned = new Intl.NumberFormat('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: 'exceptZero' });
  const fmtPct = (v) => nfSigned.format(v) + '%';
  const wibParts = (iso, opts) =>
    Object.fromEntries(new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', hour12: false, ...opts })
      .formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
  const fmtTime = (iso) => {
    const p = wibParts(iso, { hour: '2-digit', minute: '2-digit' });
    return `${p.hour}:${p.minute}`;
  };
  const fmtDateTime = (iso) => {
    const p = wibParts(iso, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    return `${p.day} ${p.month} ${p.year}, ${p.hour}:${p.minute} WIB`;
  };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- Warna ----------
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const mix = (a, b, t) => {
    const [x, y] = [hex(a), hex(b)];
    return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('');
  };
  function colorFor(pct) {
    const p = palette();
    if (!Number.isFinite(pct) || pct === 0) return p.zero;
    const t = Math.min(Math.abs(pct), RANGE) / RANGE;
    return pct > 0 ? mix(p.upLo, p.upHi, t) : mix(p.downLo, p.downHi, t);
  }

  // ---------- State ----------
  const mapEl = document.getElementById('map');
  const listEl = document.getElementById('list');
  const updatedEl = document.getElementById('updated');

  let chart;
  let countryNames = {}; // ISO_A3 -> nama dari GeoJSON
  let indices = []; // diurutkan dari kenaikan terbesar
  const byCountry = new Map();
  const revealed = new Set();
  const pulsing = new Set();
  let activeCountry = null;

  // ---------- Peta ----------
  const isCompact = () => mapEl.clientWidth < 560;

  function seriesData() {
    const p = palette();
    return indices.map((d) => {
      if (!revealed.has(d.country)) {
        return { name: d.country, itemStyle: { areaColor: p.nodata }, label: { show: false } };
      }
      const color = colorFor(d.changePct);
      const pulse = pulsing.has(d.country);
      return {
        name: d.country,
        value: d.changePct,
        itemStyle: {
          areaColor: color,
          borderColor: pulse ? color : p.border,
          borderWidth: pulse ? 5 : 0.6,
          shadowBlur: pulse ? 28 : 0,
          shadowColor: color,
        },
        emphasis: { itemStyle: { areaColor: color, borderColor: p.text, borderWidth: 1.5 } },
        label: { show: true },
      };
    });
  }

  function labelFormatter(params) {
    const d = byCountry.get(params.name);
    if (!d || !revealed.has(d.country)) return '';
    const cls = d.changePct > 0 ? 'up' : d.changePct < 0 ? 'down' : 'flat';
    // Layar sempit: cukup persen, nama indeks ada di tooltip dan daftar.
    const flag = FLAG[d.country] ? ` {f_${d.country}|}` : '';
    // Layar sempit: bendera di atas persen supaya label tetap ramping.
    if (isCompact()) return `${flag.trim() ? flag.trim() + '\n' : ''}{${cls}|${fmtPct(d.changePct)}}`;
    return `{name|${MAP_LABEL[d.ticker] || d.name}}${flag}\n{${cls}|${fmtPct(d.changePct)}}`;
  }

  function tooltipFormatter(params) {
    const p = palette();
    const d = byCountry.get(params.name);
    if (!d) {
      return `<b>${esc(countryNames[params.name] || params.name)}</b><br><span style="color:${p.muted}">Tidak ada data indeks</span>`;
    }
    const color = d.changePct > 0 ? p.upHi : d.changePct < 0 ? p.downHi : p.muted;
    const status = d.status === 'buka' ? '🟢 Buka' : '⚪ Tutup';
    const stale = d.stale ? `<div style="color:${p.downHi};margin-top:4px">⚠ Data lama</div>` : '';
    return `
      <div style="min-width:190px">
        <div style="font-weight:700">${esc(d.countryName)}</div>
        <div style="color:${p.muted};margin-bottom:6px;display:flex;align-items:center;gap:6px">${esc(d.name)}${flagImg(d.country)} · ${esc(d.ticker)}</div>
        <div style="font-size:1.15em;font-weight:700">${nf2.format(d.price)}</div>
        <div style="color:${color};font-weight:600">${nfSigned.format(d.change)} (${fmtPct(d.changePct)})</div>
        <div style="color:${p.muted};margin-top:6px">Update: ${fmtDateTime(d.marketTime)}</div>
        <div>${status}</div>${stale}
      </div>`;
  }

  // Gaya rich text per bendera: gambar SVG sebagai background kotak 4:3.
  function flagStyles() {
    const h = isCompact() ? 9 : 10.5;
    return Object.fromEntries(Object.keys(FLAG).map((c) => [`f_${c}`, {
      width: h * 4 / 3,
      height: h,
      borderRadius: 1.5,
      borderColor: palette().flagBorder,
      borderWidth: 1,
      backgroundColor: { image: flagUrl(c) },
    }]));
  }

  function baseOption() {
    const p = palette();
    return {
      backgroundColor: 'transparent',
      animationDurationUpdate: 500,
      animationEasingUpdate: 'cubicOut',
      tooltip: {
        trigger: 'item',
        formatter: tooltipFormatter,
        backgroundColor: p.tipBg,
        borderColor: p.tipBorder,
        textStyle: { color: p.text, fontSize: 13 },
        confine: true,
      },
      series: [{
        type: 'map',
        map: 'asia',
        nameProperty: 'ISO_A3',
        roam: true,
        scaleLimit: { min: 0.8, max: 8 },
        boundingCoords: [[64, 47], [147, -11]],
        selectedMode: false,
        itemStyle: { areaColor: p.nodata, borderColor: p.border, borderWidth: 0.6 },
        emphasis: {
          itemStyle: { areaColor: p.nodataHover },
          label: { show: false },
        },
        label: {
          show: false,
          formatter: labelFormatter,
          textBorderColor: p.halo,
          textBorderWidth: 3,
          lineHeight: 15,
          rich: {
            name: { fontSize: 11, color: p.text, fontWeight: 600 },
            up: { fontSize: isCompact() ? 10 : 12, color: p.upHi, fontWeight: 700 },
            down: { fontSize: isCompact() ? 10 : 12, color: p.downHi, fontWeight: 700 },
            flat: { fontSize: isCompact() ? 10 : 12, color: p.muted, fontWeight: 700 },
            ...flagStyles(),
          },
        },
        labelLayout: { hideOverlap: false },
        data: seriesData(),
      }],
    };
  }

  const render = () => chart.setOption({ series: [{ data: seriesData() }] });

  // ---------- Panel ----------
  function buildList() {
    listEl.innerHTML = indices.map((d) => {
      const cls = d.changePct > 0 ? 'up' : d.changePct < 0 ? 'down' : '';
      return `
        <li tabindex="0" data-country="${esc(d.country)}">
          <span class="idx-name">${esc(d.name)}${flagImg(d.country)}${d.stale ? '<span class="stale">data lama</span>' : ''}</span>
          <span class="idx-country">${esc(d.countryName)} · ${d.status === 'buka' ? 'Buka' : 'Tutup'}</span>
          <span class="idx-pct ${cls}">${fmtPct(d.changePct)}<small>${nf2.format(d.price)}</small></span>
        </li>`;
    }).join('');
  }

  function setActive(country) {
    if (activeCountry) chart.dispatchAction({ type: 'downplay', seriesIndex: 0, name: activeCountry });
    activeCountry = country;
    listEl.querySelectorAll('li').forEach((li) => li.classList.toggle('active', li.dataset.country === country));
    if (!country) {
      chart.dispatchAction({ type: 'hideTip' });
      return;
    }
    chart.dispatchAction({ type: 'highlight', seriesIndex: 0, name: country });
    chart.dispatchAction({ type: 'showTip', seriesIndex: 0, name: country });
  }

  listEl.addEventListener('click', (e) => {
    const li = e.target.closest('li');
    if (!li) return;
    setActive(activeCountry === li.dataset.country ? null : li.dataset.country);
  });
  listEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.target.closest('li')?.click();
    }
  });

  // ---------- Animasi masuk per negara ----------
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function revealAll() {
    const items = [...listEl.querySelectorAll('li')];
    if (reducedMotion) {
      indices.forEach((d) => revealed.add(d.country));
      items.forEach((li) => li.classList.add('shown'));
      render();
      return;
    }
    await sleep(400);
    for (const [i, d] of indices.entries()) {
      revealed.add(d.country);
      pulsing.add(d.country);
      items[i]?.classList.add('shown');
      render();
      const c = d.country;
      setTimeout(() => { pulsing.delete(c); render(); }, PULSE_MS);
      await sleep(REVEAL_DELAY);
    }
  }

  // ---------- Init ----------
  async function init() {
    try {
      const [geo, data] = await Promise.all([
        fetch('assets/asia.geo.json').then((r) => r.json()),
        fetch(`data/indices.json?t=${Date.now()}`, { cache: 'no-store' }).then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        }),
      ]);

      countryNames = Object.fromEntries(geo.features.map((f) => [f.properties.ISO_A3, f.properties.NAME]));
      echarts.registerMap('asia', geo);

      indices = (data.indices || [])
        .filter((d) => Number.isFinite(d.changePct))
        .sort((a, b) => b.changePct - a.changePct);
      indices.forEach((d) => byCountry.set(d.country, d));

      updatedEl.textContent = data.generatedAt
        ? `Terakhir diperbarui ${fmtTime(data.generatedAt)} WIB`
        : 'Waktu pembaruan tidak diketahui';

      chart = echarts.init(mapEl, null, { renderer: 'canvas' });
      chart.setOption(baseOption());
      chart.on('click', (e) => byCountry.has(e.name) && setActive(e.name));
      const restyle = () => chart.setOption(baseOption(), { replaceMerge: ['series'] });
      let compact = isCompact();
      window.addEventListener('resize', () => {
        chart.resize();
        if (compact !== isCompact()) { compact = isCompact(); restyle(); }
      });
      darkQuery.addEventListener('change', restyle);

      buildList();
      revealAll();
    } catch (err) {
      console.error(err);
      updatedEl.textContent = 'Gagal memuat data';
      mapEl.innerHTML = `<p class="error">Data tidak bisa dimuat (${esc(err.message)}). Coba muat ulang halaman.</p>`;
    }
  }

  init();
})();
