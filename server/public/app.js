const cardsEl = document.getElementById("cards");
const emptyEl = document.getElementById("empty");
const monthlyEl = document.getElementById("monthly");
const shiftsEl = document.getElementById("shifts");
const totalCountEl = document.getElementById("total-count");
const activeCountEl = document.getElementById("active-count");
const avgEfficiencyEl = document.getElementById("avg-efficiency");
const lastUpdatedEl = document.getElementById("last-updated");
const refreshBtn = document.getElementById("refresh-btn");
const metaForm = document.getElementById("meta-form");
const metaStatus = document.getElementById("meta-status");
const tezgahIdInput = document.getElementById("tezgah-id");
const desenInput = document.getElementById("desen");
const atkiInput = document.getElementById("atki");
const devirInput = document.getElementById("devir");
const siparisMetreInput = document.getElementById("siparis-metre");
const teslimMetreInput = document.getElementById("teslim-metre");
const downloadPdfBtn = document.getElementById("download-pdf");
const downloadShift1Btn = document.getElementById("download-shift-1");
const downloadShift2Btn = document.getElementById("download-shift-2");
const downloadShift3Btn = document.getElementById("download-shift-3");
const shiftTabBtns = Array.from(document.querySelectorAll(".tab-btn[data-shift]"));
const appScreen = document.body;
const reasonEls = {
  sari: document.getElementById("reason-sari"),
  kirmizi: document.getElementById("reason-kirmizi"),
  yesil: document.getElementById("reason-yesil"),
  beyaz: document.getElementById("reason-beyaz")
};
const reasonCountEls = {
  sari: document.getElementById("reason-sari-count"),
  kirmizi: document.getElementById("reason-kirmizi-count"),
  yesil: document.getElementById("reason-yesil-count"),
  beyaz: document.getElementById("reason-beyaz-count")
};
const iplikCountEl = document.getElementById("reason-iplik-count");
const distLowEl = document.getElementById("dist-low");
const distMidEl = document.getElementById("dist-mid");
const distHighEl = document.getElementById("dist-high");
const distTopEl = document.getElementById("dist-top");
const distLowCountEl = document.getElementById("dist-low-count");
const distMidCountEl = document.getElementById("dist-mid-count");
const distHighCountEl = document.getElementById("dist-high-count");
const distTopCountEl = document.getElementById("dist-top-count");
const tezgahChartEl = document.getElementById("tezgah-chart");
const cardShapeSelect = document.getElementById("setting-card-shape");
const densitySelect = document.getElementById("setting-density");
const refreshSelect = document.getElementById("setting-refresh");
const showChartCheckbox = document.getElementById("setting-show-chart");
const activeOnlyCheckbox = document.getElementById("setting-active-only");
const sortSelect = document.getElementById("setting-sort");
const columnsSelect = document.getElementById("setting-columns");
const largeTextCheckbox = document.getElementById("setting-large-text");
const detailsOpenCheckbox = document.getElementById("setting-details-open");

const STATE_ORDER = ["mavi", "yesil", "sari", "kirmizi", "beyaz"];
const REASON_KEYS = ["sari", "kirmizi", "yesil", "beyaz"];
const STOP_COUNT_KEYS = ["sari", "kirmizi", "yesil", "beyaz", "iplik_sonu"];
const STATE_LABELS = {
  mavi: "çalışıyor",
  yesil: "elle durdurma",
  sari: "atkı duruşu",
  kirmizi: "çözgü duruşu",
  beyaz: "genel arıza-usta",
  iplik_sonu: "iplik sonu",
  none: "veri akışı yok"
};
const SHIFT_LABELS = {
  "07-15": "Vardiya 1",
  "15-23": "Vardiya 2",
  "23-07": "Vardiya 3"
};
const REPORT_TIMEZONE = "Europe/Istanbul";
const SETTINGS_STORAGE_KEY = "interteks.dashboard.settings.v1";
const defaultUiSettings = {
  cardShape: "rounded",
  density: "comfortable",
  refreshSeconds: 10,
  showChart: true,
  activeOnly: false,
  sortBy: "tezgah_asc",
  columns: "auto",
  largeText: false,
  detailsOpenAll: false
};

function nowInReportTimezone() {
  return new Date(
    new Date().toLocaleString("en-US", {
      timeZone: REPORT_TIMEZONE
    })
  );
}

function shiftKeyForNow() {
  const hour = nowInReportTimezone().getHours();
  if (hour >= 7 && hour < 15) return "07-15";
  if (hour >= 15 && hour < 23) return "15-23";
  return "23-07";
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function secondsToHms(totalSeconds) {
  const sec = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s
    .toString()
    .padStart(2, "0")}`;
}

function fmtPercent(value) {
  return `${Math.round(value * 100)}%`;
}

function fmtMetre(value) {
  const n = toNumber(value);
  if (Math.abs(n - Math.round(n)) < 1e-9) return String(Math.round(n));
  return n.toFixed(2);
}

function readUiSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return { ...defaultUiSettings };
    const parsed = JSON.parse(raw);
    return {
      cardShape: parsed.cardShape === "square" ? "square" : "rounded",
      density: parsed.density === "compact" ? "compact" : "comfortable",
      refreshSeconds: [5, 10, 20, 30].includes(Number(parsed.refreshSeconds))
        ? Number(parsed.refreshSeconds)
        : 10,
      showChart: parsed.showChart !== false,
      activeOnly: parsed.activeOnly === true,
      sortBy: ["tezgah_asc", "tezgah_desc", "randiman_desc", "randiman_asc"].includes(
        parsed.sortBy
      )
        ? parsed.sortBy
        : "tezgah_asc",
      columns: ["auto", "1", "2", "3"].includes(String(parsed.columns))
        ? String(parsed.columns)
        : "auto",
      largeText: parsed.largeText === true,
      detailsOpenAll: parsed.detailsOpenAll === true
    };
  } catch (err) {
    return { ...defaultUiSettings };
  }
}

let uiSettings = readUiSettings();

function persistUiSettings() {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(uiSettings));
  } catch (err) {
    // ignore storage errors
  }
}

function applyUiSettings() {
  document.body.classList.toggle("card-shape-square", uiSettings.cardShape === "square");
  document.body.classList.toggle("density-compact", uiSettings.density === "compact");
  document.body.classList.toggle("hide-tezgah-chart", !uiSettings.showChart);
  document.body.classList.toggle("text-large", uiSettings.largeText);
  document.body.classList.toggle("cards-1", uiSettings.columns === "1");
  document.body.classList.toggle("cards-2", uiSettings.columns === "2");
  document.body.classList.toggle("cards-3", uiSettings.columns === "3");
}

function baseRandiman(item) {
  return toNumber(item?.cumulative?.randiman);
}

function scoreWithFactors(item) {
  const base = baseRandiman(item);
  const devir = toNumber(item?.meta?.devir);
  const siklik = toNumber(item?.meta?.atkiSikligi);
  if (devir <= 0 || siklik <= 0) return 0;
  return base * devir * siklik;
}

function applyAdjustedRandiman(items) {
  let maxScore = 0;
  items.forEach((item) => {
    const score = scoreWithFactors(item);
    if (score > maxScore) maxScore = score;
  });
  items.forEach((item) => {
    const score = scoreWithFactors(item);
    if (score > 0 && maxScore > 0) {
      item.adjustedRandiman = Math.min(1, score / maxScore);
    } else {
      item.adjustedRandiman = baseRandiman(item);
    }
  });
}

function displayStateLabel(state) {
  if (!state || state === "none") return "veri akışı yok";
  return STATE_LABELS[state] || state;
}

function parseTezgahId(tezgahId) {
  const match = /^T-(\d{1,3})$/i.exec(tezgahId || "");
  if (!match) return null;
  const num = parseInt(match[1], 10);
  if (Number.isNaN(num) || num < 1 || num > 100) return null;
  return num;
}

function formatTezgahLabel(tezgahId) {
  const num = parseTezgahId(tezgahId);
  return num ? `Tezgah ${num}` : "";
}

function renderCard(item) {
  const { tezgahId, aktifDurum, states, cumulative, meta, stopCounts } = item;
  const adjustedRandiman = toNumber(item.adjustedRandiman ?? cumulative.randiman);
  const stateList = STATE_ORDER.map((key) => ({
    key,
    seconds: toNumber(states[key])
  }));
  const stops = {
    sari: toNumber(stopCounts?.sari),
    kirmizi: toNumber(stopCounts?.kirmizi),
    yesil: toNumber(stopCounts?.yesil),
    beyaz: toNumber(stopCounts?.beyaz),
    iplik_sonu: toNumber(stopCounts?.iplik_sonu)
  };
  const totalStops =
    stops.sari + stops.kirmizi + stops.yesil + stops.beyaz + stops.iplik_sonu;

  const remainingMetre =
    toNumber(meta?.siparisMetre) - toNumber(meta?.teslimMetre);
  const remainingLabel =
    toNumber(meta?.siparisMetre) > 0 ? fmtMetre(Math.max(0, remainingMetre)) : "-";
  const metaRow =
    meta &&
    (meta.desen ||
      meta.atkiSikligi ||
      meta.devir ||
      meta.siparisMetre ||
      meta.teslimMetre)
      ? `<div class="row"><span>Desen</span><span>${meta.desen || "-"}</span></div>
         <div class="row"><span>Atkı Sıklığı</span><span>${meta.atkiSikligi || "-"}</span></div>
         <div class="row"><span>Devir</span><span>${meta.devir || "-"}</span></div>`
      : "";
  const orderRow =
    meta && (meta.siparisMetre || meta.teslimMetre)
      ? `<div class="row"><span>Siparis Metre</span><span>${fmtMetre(meta.siparisMetre || "0")}</span></div>
         <div class="row"><span>Kesilen Metre</span><span>${fmtMetre(meta.teslimMetre || "0")}</span></div>
         <div class="row"><span>Kalan Metre</span><span>${remainingLabel}</span></div>`
      : "";
  const cutRow = `
      <div class="cut-meter-box">
        <div class="cut-meter-title">Kumas Kesim Girisi</div>
        <div class="cut-meter-controls">
          <input class="cut-meter-input" type="number" step="0.01" min="0" data-tezgah-id="${tezgahId}" placeholder="Metre gir" />
          <button type="button" class="cut-meter-add" data-tezgah-id="${tezgahId}">Ekle</button>
          <button type="button" class="cut-meter-set" data-tezgah-id="${tezgahId}">Duzelt</button>
        </div>
        <div class="cut-meter-status" id="cut-meter-status-${tezgahId}"></div>
      </div>
  `;
  const stopRow = `
      <div class="row"><span>Duruş Sayısı</span><span>${totalStops}</span></div>
      <div class="row"><span>Atkı / Çözgü</span><span>${stops.sari} / ${stops.kirmizi}</span></div>
      <div class="row"><span>Elle / Arıza</span><span>${stops.yesil} / ${stops.beyaz}</span></div>
      <div class="row"><span>Iplik Sonu</span><span>${stops.iplik_sonu}</span></div>
  `;

  const rows = stateList
    .map(
      (s) =>
        `<div class="row"><span>${STATE_LABELS[s.key] || s.key}</span><span>${secondsToHms(
          s.seconds
        )}</span></div>`
    )
    .join("");
  const detailRows = `${metaRow}${rows}`.trim();
  const detailBlock = detailRows
    ? `<details class="card-details" data-tezgah-id="${tezgahId}" ${
        openCardDetails.has(tezgahId) ? "open" : ""
      }>
        <summary>Detaylar</summary>
        <div class="card-details-content">${detailRows}</div>
      </details>`
    : "";

  const label = formatTezgahLabel(tezgahId);
  return `
    <div class="card">
      <div class="card-header">
        <div><strong>${label}</strong></div>
        <div class="badge ${aktifDurum || "none"}">${displayStateLabel(
          aktifDurum
        )}</div>
      </div>
      <div class="row"><span>Randiman</span><span>${fmtPercent(
        adjustedRandiman
      )}</span></div>
      <div class="row"><span>Toplam</span><span>${secondsToHms(
        cumulative.totalSeconds
      )}</span></div>
      ${orderRow}
      ${cutRow}
      ${stopRow}
      ${detailBlock}
    </div>
  `;
}

function renderMonthlyCard(item) {
  const { tezgahId, cumulative } = item;
  const label = formatTezgahLabel(tezgahId);
  return `
    <div class="monthly-card">
      <div class="card-header">
        <div><strong>${label}</strong></div>
        <div class="badge">${fmtPercent(cumulative.randiman)}</div>
      </div>
      <div class="row"><span>Toplam</span><span>${secondsToHms(
        cumulative.totalSeconds
      )}</span></div>
      <div class="row"><span>Calisma</span><span>${secondsToHms(
        cumulative.maviSeconds
      )}</span></div>
    </div>
  `;
}

function renderShiftCard(item) {
  const { shift, cumulative, states } = item;
  return `
    <div class="card">
      <div class="card-header">
        <div><strong>${SHIFT_LABELS[shift] || `Vardiya ${shift}`}</strong></div>
        <div class="badge">${fmtPercent(cumulative.randiman)}</div>
      </div>
      <div class="row"><span>Çalışma</span><span>${secondsToHms(
        cumulative.maviSeconds
      )}</span></div>
      <div class="row"><span>Atkı Duruşu</span><span>${secondsToHms(
        toNumber(states.sari)
      )}</span></div>
      <div class="row"><span>Çözgü Duruşu</span><span>${secondsToHms(
        toNumber(states.kirmizi)
      )}</span></div>
      <div class="row"><span>Elle Durdurma</span><span>${secondsToHms(
        toNumber(states.yesil)
      )}</span></div>
      <div class="row"><span>Genel Arıza / Usta</span><span>${secondsToHms(
        toNumber(states.beyaz)
      )}</span></div>
    </div>
  `;
}

function updateSummary(items) {
  totalCountEl.textContent = items.length;
  const activeCount = items.filter((i) => i.aktifDurum === "mavi").length;
  activeCountEl.textContent = activeCount;

  const avg =
    items.length === 0
      ? 0
      : items.reduce(
          (sum, i) => sum + toNumber(i.adjustedRandiman ?? i.cumulative.randiman),
          0
        ) /
        items.length;
  avgEfficiencyEl.textContent = fmtPercent(avg);
}

async function fetchData() {
  const res = await apiFetch("/api/status", { cache: "no-store" });
  if (!res.ok) {
    throw new Error("Fetch failed");
  }
  const data = await res.json();
  return data.items || [];
}

async function fetchMonthly() {
  const res = await apiFetch("/api/monthly", { cache: "no-store" });
  if (!res.ok) {
    throw new Error("Fetch failed");
  }
  const data = await res.json();
  return data.items || [];
}

async function fetchShifts() {
  const res = await apiFetch("/api/shifts", { cache: "no-store" });
  if (!res.ok) {
    throw new Error("Fetch failed");
  }
  const data = await res.json();
  return data.shifts || [];
}

function aggregateReasons(monthlyItems) {
  const totals = { sari: 0, kirmizi: 0, yesil: 0, beyaz: 0 };
  monthlyItems.forEach((item) => {
    REASON_KEYS.forEach((key) => {
      totals[key] += toNumber(item.states[key]);
    });
  });
  return totals;
}

function aggregateStopCounts(items) {
  const totals = { sari: 0, kirmizi: 0, yesil: 0, beyaz: 0, iplik_sonu: 0 };
  items.forEach((item) => {
    const counts = item.stopCounts || {};
    STOP_COUNT_KEYS.forEach((key) => {
      totals[key] += toNumber(counts[key]);
    });
  });
  return totals;
}

function updateReasonChart(monthlyItems) {
  const totals = aggregateReasons(monthlyItems);
  const maxValue = Math.max(1, ...Object.values(totals));
  REASON_KEYS.forEach((key) => {
    const percent = (totals[key] / maxValue) * 100;
    const fill = document.querySelector(`.fill.${key}`);
    if (fill) fill.style.width = `${percent}%`;
    if (reasonEls[key]) reasonEls[key].textContent = secondsToHms(totals[key]);
  });
}

function updateStopCounts(items) {
  const totals = aggregateStopCounts(items);
  const atkiCount = totals.sari + totals.iplik_sonu;
  REASON_KEYS.forEach((key) => {
    if (reasonCountEls[key]) {
      const count = key === "sari" ? atkiCount : totals[key];
      reasonCountEls[key].textContent = `${count} duruş`;
    }
  });
  if (iplikCountEl) iplikCountEl.textContent = totals.iplik_sonu;
}

function updateDistribution(items) {
  const total = items.length || 1;
  const buckets = { low: 0, mid: 0, high: 0, top: 0 };
  items.forEach((item) => {
    const value = toNumber(item.adjustedRandiman ?? item.cumulative?.randiman);
    if (value < 0.4) buckets.low += 1;
    else if (value < 0.6) buckets.mid += 1;
    else if (value < 0.8) buckets.high += 1;
    else buckets.top += 1;
  });
  const setDist = (el, count) => {
    if (!el) return;
    el.style.width = `${Math.round((count / total) * 100)}%`;
  };
  setDist(distLowEl, buckets.low);
  setDist(distMidEl, buckets.mid);
  setDist(distHighEl, buckets.high);
  setDist(distTopEl, buckets.top);
  if (distLowCountEl) distLowCountEl.textContent = `${buckets.low} tezgah`;
  if (distMidCountEl) distMidCountEl.textContent = `${buckets.mid} tezgah`;
  if (distHighCountEl) distHighCountEl.textContent = `${buckets.high} tezgah`;
  if (distTopCountEl) distTopCountEl.textContent = `${buckets.top} tezgah`;
}

function updateTezgahChart(items) {
  if (!tezgahChartEl) return;
  const map = new Map();
  items.forEach((item) => {
    map.set(item.tezgahId, item);
  });
  const bars = [];
  for (let i = 1; i <= 100; i += 1) {
    const tezgahId = `T-${String(i).padStart(3, "0")}`;
    const item = map.get(tezgahId);
    const randiman = toNumber(item?.adjustedRandiman ?? item?.cumulative?.randiman);
    const percent = Math.max(0, Math.min(100, Math.round(randiman * 100)));
    const height = Math.round((percent / 100) * 140);
    bars.push(`
      <div class="tezgah-bar" title="${tezgahId} - ${percent}%">
        <div class="bar" style="height:${height}px"></div>
        <div class="label">${String(i).padStart(3, "0")}</div>
      </div>
    `);
  }
  tezgahChartEl.innerHTML = bars.join("");
}

function sortAndFilterItems(items) {
  const filtered = uiSettings.activeOnly
    ? items.filter((item) => item.aktifDurum === "mavi")
    : items.slice();
  filtered.sort((a, b) => {
    if (uiSettings.sortBy === "tezgah_desc") {
      return (parseTezgahId(b.tezgahId) || 0) - (parseTezgahId(a.tezgahId) || 0);
    }
    if (uiSettings.sortBy === "randiman_desc") {
      return (
        toNumber(b.adjustedRandiman ?? b.cumulative?.randiman) -
        toNumber(a.adjustedRandiman ?? a.cumulative?.randiman)
      );
    }
    if (uiSettings.sortBy === "randiman_asc") {
      return (
        toNumber(a.adjustedRandiman ?? a.cumulative?.randiman) -
        toNumber(b.adjustedRandiman ?? b.cumulative?.randiman)
      );
    }
    return (parseTezgahId(a.tezgahId) || 0) - (parseTezgahId(b.tezgahId) || 0);
  });
  return filtered;
}

function bindCardDetailsState() {
  const detailEls = cardsEl.querySelectorAll(".card-details[data-tezgah-id]");
  detailEls.forEach((details) => {
    const tezgahId = details.dataset.tezgahId;
    if (!tezgahId) return;
    details.open = uiSettings.detailsOpenAll || openCardDetails.has(tezgahId);
    if (details.dataset.boundToggle === "1") return;
    details.addEventListener("toggle", () => {
      if (details.open) {
        openCardDetails.add(tezgahId);
      } else {
        openCardDetails.delete(tezgahId);
      }
    });
    details.dataset.boundToggle = "1";
  });
}

async function refresh() {
  try {
    const rawItems = (await fetchData()).filter((i) => parseTezgahId(i.tezgahId));
    applyAdjustedRandiman(rawItems);
    const items = sortAndFilterItems(rawItems);
    const monthly = (await fetchMonthly()).filter((i) => parseTezgahId(i.tezgahId));
    const shifts = await fetchShifts();
    updateSummary(items);
    if (items.length === 0) {
      cardsEl.innerHTML = "";
      emptyEl.classList.remove("hidden");
    } else {
      emptyEl.classList.add("hidden");
      cardsEl.innerHTML = items.map(renderCard).join("");
      bindCardDetailsState();
    }
    monthlyEl.innerHTML = monthly.map(renderMonthlyCard).join("");
    const detectedShiftKey = shiftKeyForNow();
    if (!userSelectedShift || detectedShiftKey !== lastDetectedShiftKey) {
      activeShiftKey = detectedShiftKey;
      userSelectedShift = false;
    }
    lastDetectedShiftKey = detectedShiftKey;
    renderShiftTabs(shifts);
    updateReasonChart(monthly);
    updateStopCounts(items);
    updateDistribution(items);
    updateTezgahChart(items);
    const now = new Date();
    lastUpdatedEl.textContent = `Son guncelleme: ${now.toLocaleTimeString()}`;
  } catch (err) {
    emptyEl.classList.remove("hidden");
    emptyEl.textContent = "Veri okunamadi. Sunucuya erisim yok.";
  }
}

async function apiFetch(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    credentials: "same-origin"
  });
  if (res.status === 401) {
    window.location.href = "/login";
  }
  return res;
}

let activeShiftKey = "07-15";
let cachedShifts = [];
let userSelectedShift = false;
let lastDetectedShiftKey = shiftKeyForNow();
const openCardDetails = new Set();
let periodicRefreshTimer = null;

function renderShiftTabs(shifts) {
  cachedShifts = shifts;
  const selected = shifts.find((s) => s.shift === activeShiftKey);
  shiftsEl.innerHTML = selected ? renderShiftCard(selected) : "";
  shiftTabBtns.forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.shift === activeShiftKey);
  });
}

function todayIsoDate() {
  const now = nowInReportTimezone();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function confirmDownload() {
  return true;
}

function applySettingsInputs() {
  if (cardShapeSelect) cardShapeSelect.value = uiSettings.cardShape;
  if (densitySelect) densitySelect.value = uiSettings.density;
  if (refreshSelect) refreshSelect.value = String(uiSettings.refreshSeconds);
  if (showChartCheckbox) showChartCheckbox.checked = uiSettings.showChart;
  if (activeOnlyCheckbox) activeOnlyCheckbox.checked = uiSettings.activeOnly;
  if (sortSelect) sortSelect.value = uiSettings.sortBy;
  if (columnsSelect) columnsSelect.value = uiSettings.columns;
  if (largeTextCheckbox) largeTextCheckbox.checked = uiSettings.largeText;
  if (detailsOpenCheckbox) detailsOpenCheckbox.checked = uiSettings.detailsOpenAll;
}

let liveSource = null;
let liveRefreshTimer = null;

function scheduleLiveRefresh() {
  if (liveRefreshTimer) return;
  liveRefreshTimer = setTimeout(() => {
    liveRefreshTimer = null;
    refresh();
  }, 250);
}

function startLiveUpdates() {
  if (!("EventSource" in window)) return;
  if (liveSource) return;
  liveSource = new EventSource("/api/stream");
  liveSource.onmessage = () => {
    if (!appScreen.classList.contains("hidden")) {
      scheduleLiveRefresh();
    }
  };
}

function restartPeriodicRefresh() {
  if (periodicRefreshTimer) {
    clearInterval(periodicRefreshTimer);
    periodicRefreshTimer = null;
  }
  periodicRefreshTimer = setInterval(() => {
    if (!appScreen.classList.contains("hidden")) {
      refresh();
    }
  }, uiSettings.refreshSeconds * 1000);
}

refreshBtn.addEventListener("click", refresh);

downloadPdfBtn.addEventListener("click", () => {
  if (!confirmDownload()) return;
  window.location.href = `/api/monthly.pdf?date=${todayIsoDate()}`;
});

shiftTabBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    userSelectedShift = true;
    activeShiftKey = btn.dataset.shift;
    renderShiftTabs(cachedShifts);
  });
});

if (downloadShift1Btn) {
  downloadShift1Btn.addEventListener("click", () => {
    if (!confirmDownload()) return;
    window.location.href = `/api/shift.pdf?shift=07-15&date=${todayIsoDate()}`;
  });
}
if (downloadShift2Btn) {
  downloadShift2Btn.addEventListener("click", () => {
    if (!confirmDownload()) return;
    window.location.href = `/api/shift.pdf?shift=15-23&date=${todayIsoDate()}`;
  });
}
if (downloadShift3Btn) {
  downloadShift3Btn.addEventListener("click", () => {
    if (!confirmDownload()) return;
    window.location.href = `/api/shift.pdf?shift=23-07&date=${todayIsoDate()}`;
  });
}

metaForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const payload = {
    tezgahId: tezgahIdInput.value.trim(),
    desen: desenInput.value.trim(),
    atkiSikligi: atkiInput.value.trim(),
    devir: devirInput.value.trim(),
    siparisMetre: siparisMetreInput.value.trim(),
    teslimMetre: teslimMetreInput.value.trim()
  };
  if (!payload.tezgahId) {
    metaStatus.textContent = "Tezgah ID gerekli.";
    return;
  }
  try {
    const res = await apiFetch("/api/tezgah", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error("Kaydedilemedi");
    metaStatus.textContent = "Kaydedildi.";
    tezgahIdInput.value = "";
    desenInput.value = "";
    atkiInput.value = "";
    devirInput.value = "";
    siparisMetreInput.value = "";
    teslimMetreInput.value = "";
    refresh();
  } catch (err) {
    metaStatus.textContent = "Kayit hatasi.";
  }
});

async function submitCutMetre(tezgahId, mode) {
  const input = cardsEl.querySelector(`.cut-meter-input[data-tezgah-id="${tezgahId}"]`);
  const statusEl = cardsEl.querySelector(`#cut-meter-status-${tezgahId}`);
  if (!input) return;
  const metre = input.value.trim();
  if (!metre) {
    if (statusEl) statusEl.textContent = "Metre girin.";
    return;
  }
  try {
    const res = await apiFetch("/api/tezgah/cut-metre", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tezgahId, metre, mode })
    });
    if (!res.ok) throw new Error("Kaydedilemedi");
    const data = await res.json();
    if (statusEl) {
      statusEl.textContent = `Kayit ok: Kesilen ${data.teslimMetre} m, Kalan ${data.kalanMetre} m`;
    }
    input.value = "";
    refresh();
  } catch (err) {
    if (statusEl) statusEl.textContent = "Kesim kaydi hatasi.";
  }
}

cardsEl.addEventListener("click", (event) => {
  const addBtn = event.target.closest(".cut-meter-add");
  if (addBtn) {
    submitCutMetre(addBtn.dataset.tezgahId, "add");
    return;
  }
  const setBtn = event.target.closest(".cut-meter-set");
  if (setBtn) {
    submitCutMetre(setBtn.dataset.tezgahId, "set");
  }
});

if (cardShapeSelect) {
  cardShapeSelect.addEventListener("change", () => {
    uiSettings.cardShape = cardShapeSelect.value === "square" ? "square" : "rounded";
    applyUiSettings();
    persistUiSettings();
  });
}

if (densitySelect) {
  densitySelect.addEventListener("change", () => {
    uiSettings.density = densitySelect.value === "compact" ? "compact" : "comfortable";
    applyUiSettings();
    persistUiSettings();
  });
}

if (refreshSelect) {
  refreshSelect.addEventListener("change", () => {
    uiSettings.refreshSeconds = [5, 10, 20, 30].includes(Number(refreshSelect.value))
      ? Number(refreshSelect.value)
      : 10;
    persistUiSettings();
    restartPeriodicRefresh();
  });
}

if (showChartCheckbox) {
  showChartCheckbox.addEventListener("change", () => {
    uiSettings.showChart = Boolean(showChartCheckbox.checked);
    applyUiSettings();
    persistUiSettings();
  });
}

if (activeOnlyCheckbox) {
  activeOnlyCheckbox.addEventListener("change", () => {
    uiSettings.activeOnly = Boolean(activeOnlyCheckbox.checked);
    persistUiSettings();
    refresh();
  });
}

if (sortSelect) {
  sortSelect.addEventListener("change", () => {
    uiSettings.sortBy = ["tezgah_asc", "tezgah_desc", "randiman_desc", "randiman_asc"].includes(
      sortSelect.value
    )
      ? sortSelect.value
      : "tezgah_asc";
    persistUiSettings();
    refresh();
  });
}

if (columnsSelect) {
  columnsSelect.addEventListener("change", () => {
    uiSettings.columns = ["auto", "1", "2", "3"].includes(columnsSelect.value)
      ? columnsSelect.value
      : "auto";
    applyUiSettings();
    persistUiSettings();
  });
}

if (largeTextCheckbox) {
  largeTextCheckbox.addEventListener("change", () => {
    uiSettings.largeText = Boolean(largeTextCheckbox.checked);
    applyUiSettings();
    persistUiSettings();
  });
}

if (detailsOpenCheckbox) {
  detailsOpenCheckbox.addEventListener("change", () => {
    uiSettings.detailsOpenAll = Boolean(detailsOpenCheckbox.checked);
    persistUiSettings();
    refresh();
  });
}

applyUiSettings();
applySettingsInputs();
refresh();
startLiveUpdates();
restartPeriodicRefresh();
