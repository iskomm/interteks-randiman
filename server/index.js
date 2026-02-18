const express = require("express");
const path = require("path");
const fs = require("fs");
const PDFDocument = require("pdfkit");
const { Pool } = require("pg");

const app = express();
app.use(express.json());

const store = new Map();
const sseClients = new Set();
const monthlyPath = path.join(__dirname, "data", "monthly.json");
const metaPath = path.join(__dirname, "data", "meta.json");
const shiftsPath = path.join(__dirname, "data", "shifts.json");
const shiftsDailyPath = path.join(__dirname, "data", "shifts_daily.json");
const statusPath = path.join(__dirname, "data", "status.json");
let useDb = Boolean(process.env.DATABASE_URL);
let pool = null;

const AUTH_USER = "interteks";
const AUTH_PASS = "161616";
const AUTH_TOKEN = "interteks-token";
const STOP_STATES = new Set(["sari", "kirmizi", "yesil", "beyaz", "iplik_sonu"]);
const MIN_VALID_TS = 1609459200; // 2021-01-01
const REPORT_TIMEZONE = "Europe/Istanbul";

function parseCookies(req) {
  const header = req.headers.cookie || "";
  return header.split(";").reduce((acc, part) => {
    const [key, ...rest] = part.trim().split("=");
    if (!key) return acc;
    acc[key] = decodeURIComponent(rest.join("="));
    return acc;
  }, {});
}

function getAuthToken(req) {
  const header = req.headers.authorization || "";
  if (header.startsWith("Bearer ")) {
    return header.slice(7).trim();
  }
  const cookies = parseCookies(req);
  return cookies.auth || "";
}

function isAuthorized(req) {
  return getAuthToken(req) === AUTH_TOKEN;
}

function requireAuth(req, res, next) {
  if (isAuthorized(req)) return next();
  return res.status(401).json({ ok: false, error: "unauthorized" });
}

function authGate(req, res, next) {
  const openPaths = ["/ingest", "/health", "/api/login"];
  if (!req.path.startsWith("/api")) return next();
  if (openPaths.includes(req.path)) return next();
  return requireAuth(req, res, next);
}

app.use(authGate);

function ensureMonthlyStore() {
  const dir = path.dirname(monthlyPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(monthlyPath)) {
    fs.writeFileSync(monthlyPath, JSON.stringify({}), "utf8");
  }
}

function readMonthlyStore() {
  ensureMonthlyStore();
  try {
    const raw = fs.readFileSync(monthlyPath, "utf8");
    return JSON.parse(raw || "{}");
  } catch (err) {
    return {};
  }
}

function writeMonthlyStore(data) {
  ensureMonthlyStore();
  fs.writeFileSync(monthlyPath, JSON.stringify(data, null, 2), "utf8");
}

function ensureShiftStore() {
  const dir = path.dirname(shiftsPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(shiftsPath)) {
    fs.writeFileSync(shiftsPath, JSON.stringify({}), "utf8");
  }
}

function readShiftStore() {
  ensureShiftStore();
  try {
    const raw = fs.readFileSync(shiftsPath, "utf8");
    return JSON.parse(raw || "{}");
  } catch (err) {
    return {};
  }
}

function writeShiftStore(data) {
  ensureShiftStore();
  fs.writeFileSync(shiftsPath, JSON.stringify(data, null, 2), "utf8");
}

function ensureDailyShiftStore() {
  const dir = path.dirname(shiftsDailyPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(shiftsDailyPath)) {
    fs.writeFileSync(shiftsDailyPath, JSON.stringify({}), "utf8");
  }
}

function readDailyShiftStore() {
  ensureDailyShiftStore();
  try {
    const raw = fs.readFileSync(shiftsDailyPath, "utf8");
    return JSON.parse(raw || "{}");
  } catch (err) {
    return {};
  }
}

function writeDailyShiftStore(data) {
  ensureDailyShiftStore();
  fs.writeFileSync(shiftsDailyPath, JSON.stringify(data, null, 2), "utf8");
}

function ensureStatusStore() {
  const dir = path.dirname(statusPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(statusPath)) {
    fs.writeFileSync(statusPath, JSON.stringify({}), "utf8");
  }
}

function readStatusStore() {
  ensureStatusStore();
  try {
    const raw = fs.readFileSync(statusPath, "utf8");
    return JSON.parse(raw || "{}");
  } catch (err) {
    return {};
  }
}

function writeStatusStore(data) {
  ensureStatusStore();
  const tmpPath = `${statusPath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmpPath, statusPath);
}

async function loadStatusStore() {
  if (useDb) {
    const result = await pool.query(
      "SELECT tezgah_id, timestamp, aktif_durum, states, stop_counts FROM status"
    );
    result.rows.forEach((row) => {
      store.set(row.tezgah_id, {
        tezgahId: row.tezgah_id,
        timestamp: Number(row.timestamp),
        aktifDurum: row.aktif_durum,
        states: row.states || {},
        stopCounts: normalizeStopCounts(row.stop_counts)
      });
    });
    return;
  }
  const data = readStatusStore();
  Object.keys(data).forEach((tezgahId) => {
    const entry = data[tezgahId] || {};
    store.set(tezgahId, {
      ...entry,
      stopCounts: normalizeStopCounts(entry.stopCounts)
    });
  });
}

function persistStatusStore() {
  if (useDb) return;
  const data = {};
  store.forEach((value, key) => {
    data[key] = value;
  });
  writeStatusStore(data);
}

function broadcastLiveUpdate(payload) {
  if (sseClients.size === 0) return;
  const message = `data: ${JSON.stringify(payload)}\n\n`;
  sseClients.forEach((client) => {
    try {
      client.res.write(message);
    } catch (err) {
      clearInterval(client.ping);
      sseClients.delete(client);
    }
  });
}

function ensureMetaStore() {
  const dir = path.dirname(metaPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(metaPath)) {
    fs.writeFileSync(metaPath, JSON.stringify({}), "utf8");
  }
}

function readMetaStore() {
  ensureMetaStore();
  try {
    const raw = fs.readFileSync(metaPath, "utf8");
    return JSON.parse(raw || "{}");
  } catch (err) {
    return {};
  }
}

function writeMetaStore(data) {
  ensureMetaStore();
  fs.writeFileSync(metaPath, JSON.stringify(data, null, 2), "utf8");
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function timePartsFromTimestamp(ts) {
  const input = toNumber(ts) || Math.floor(Date.now() / 1000);
  const date = new Date(input * 1000);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: REPORT_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false
  }).formatToParts(date);
  const map = {};
  parts.forEach((part) => {
    if (part.type !== "literal") {
      map[part.type] = part.value;
    }
  });
  return {
    year: map.year || "1970",
    month: map.month || "01",
    day: map.day || "01",
    hour: toNumber(map.hour)
  };
}

function calcEfficiency(states) {
  const sari = toNumber(states.sari);
  const kirmizi = toNumber(states.kirmizi);
  const yesil = toNumber(states.yesil);
  const beyaz = toNumber(states.beyaz);
  const mavi = toNumber(states.mavi);
  const total = sari + kirmizi + yesil + beyaz + mavi;
  return {
    totalSeconds: total,
    maviSeconds: mavi,
    randiman: total > 0 ? mavi / total : 0
  };
}

function normalizeStopCounts(counts) {
  return {
    sari: toNumber(counts?.sari),
    kirmizi: toNumber(counts?.kirmizi),
    yesil: toNumber(counts?.yesil),
    beyaz: toNumber(counts?.beyaz),
    iplik_sonu: toNumber(counts?.iplik_sonu)
  };
}

function diffStates(prev, next) {
  const diff = {
    sari: toNumber(next.sari) - toNumber(prev.sari),
    kirmizi: toNumber(next.kirmizi) - toNumber(prev.kirmizi),
    yesil: toNumber(next.yesil) - toNumber(prev.yesil),
    beyaz: toNumber(next.beyaz) - toNumber(prev.beyaz),
    mavi: toNumber(next.mavi) - toNumber(prev.mavi)
  };
  return {
    sari: Math.max(0, diff.sari),
    kirmizi: Math.max(0, diff.kirmizi),
    yesil: Math.max(0, diff.yesil),
    beyaz: Math.max(0, diff.beyaz),
    mavi: Math.max(0, diff.mavi)
  };
}

function monthKeyFromTimestamp(ts) {
  const parts = timePartsFromTimestamp(ts);
  return `${parts.year}-${parts.month}`;
}

function shiftKeyFromTimestamp(ts) {
  const { hour } = timePartsFromTimestamp(ts);
  if (hour >= 7 && hour < 15) return "07-15";
  if (hour >= 15 && hour < 23) return "15-23";
  return "23-07";
}

function shiftDateKeyFromTimestamp(ts) {
  const input = toNumber(ts) || Math.floor(Date.now() / 1000);
  const parts = timePartsFromTimestamp(input);
  const shiftKey = shiftKeyFromTimestamp(input);
  if (shiftKey === "23-07" && parts.hour < 7) {
    const prev = timePartsFromTimestamp(input - 86400);
    return `${prev.year}-${prev.month}-${prev.day}`;
  }
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function formatSeconds(totalSeconds) {
  const sec = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(
    s
  ).padStart(2, "0")}`;
}

function todayDateString() {
  const parts = timePartsFromTimestamp();
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function toMetreNumber(value) {
  if (value === null || value === undefined || value === "") return 0;
  const normalized = String(value).replace(",", ".");
  const num = Number(normalized);
  return Number.isFinite(num) ? Math.max(0, num) : 0;
}

function metreToString(value) {
  const rounded = Math.round(toMetreNumber(value) * 100) / 100;
  if (Math.abs(rounded - Math.round(rounded)) < 1e-9) {
    return String(Math.round(rounded));
  }
  return rounded.toFixed(2);
}

function formatHours(totalSeconds) {
  return `${(toNumber(totalSeconds) / 3600).toFixed(2)} saat`;
}

const STOP_REASON_LABELS = {
  sari: "Atki Durusu",
  kirmizi: "Cozgu Durusu",
  yesil: "Elle Durdurma",
  beyaz: "Genel Ariza/Usta",
  iplik_sonu: "Iplik Sonu"
};

function dominantReason(states) {
  const pairs = [
    ["sari", toNumber(states?.sari)],
    ["kirmizi", toNumber(states?.kirmizi)],
    ["yesil", toNumber(states?.yesil)],
    ["beyaz", toNumber(states?.beyaz)]
  ];
  pairs.sort((a, b) => b[1] - a[1]);
  return pairs[0];
}

function dominantStopCountReason(counts) {
  const pairs = [
    ["sari", toNumber(counts?.sari)],
    ["kirmizi", toNumber(counts?.kirmizi)],
    ["yesil", toNumber(counts?.yesil)],
    ["beyaz", toNumber(counts?.beyaz)],
    ["iplik_sonu", toNumber(counts?.iplik_sonu)]
  ];
  pairs.sort((a, b) => b[1] - a[1]);
  return pairs[0];
}

async function addMonthlyTotals(tezgahId, ts, deltaStates) {
  const key = monthKeyFromTimestamp(ts);
  if (useDb) {
    await pool.query(
      `INSERT INTO monthly (tezgah_id, month, sari, kirmizi, yesil, beyaz, mavi)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (tezgah_id, month)
       DO UPDATE SET
         sari = monthly.sari + EXCLUDED.sari,
         kirmizi = monthly.kirmizi + EXCLUDED.kirmizi,
         yesil = monthly.yesil + EXCLUDED.yesil,
         beyaz = monthly.beyaz + EXCLUDED.beyaz,
         mavi = monthly.mavi + EXCLUDED.mavi`,
      [
        tezgahId,
        key,
        toNumber(deltaStates.sari),
        toNumber(deltaStates.kirmizi),
        toNumber(deltaStates.yesil),
        toNumber(deltaStates.beyaz),
        toNumber(deltaStates.mavi)
      ]
    );
    return;
  }
  const db = readMonthlyStore();
  if (!db[key]) db[key] = {};
  if (!db[key][tezgahId]) {
    db[key][tezgahId] = { sari: 0, kirmizi: 0, yesil: 0, beyaz: 0, mavi: 0 };
  }
  const entry = db[key][tezgahId];
  entry.sari += toNumber(deltaStates.sari);
  entry.kirmizi += toNumber(deltaStates.kirmizi);
  entry.yesil += toNumber(deltaStates.yesil);
  entry.beyaz += toNumber(deltaStates.beyaz);
  entry.mavi += toNumber(deltaStates.mavi);
  writeMonthlyStore(db);
}

async function addShiftTotals(ts, deltaStates) {
  const monthKey = monthKeyFromTimestamp(ts);
  const shiftKey = shiftKeyFromTimestamp(ts);
  const shiftDate = shiftDateKeyFromTimestamp(ts);
  if (useDb) {
    const values = [
      toNumber(deltaStates.sari),
      toNumber(deltaStates.kirmizi),
      toNumber(deltaStates.yesil),
      toNumber(deltaStates.beyaz),
      toNumber(deltaStates.mavi)
    ];
    await pool.query(
      `INSERT INTO shifts (month, shift, sari, kirmizi, yesil, beyaz, mavi)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (month, shift)
       DO UPDATE SET
         sari = shifts.sari + EXCLUDED.sari,
         kirmizi = shifts.kirmizi + EXCLUDED.kirmizi,
         yesil = shifts.yesil + EXCLUDED.yesil,
         beyaz = shifts.beyaz + EXCLUDED.beyaz,
         mavi = shifts.mavi + EXCLUDED.mavi`,
      [monthKey, shiftKey, ...values]
    );
    await pool.query(
      `INSERT INTO shifts_daily (date_key, shift, sari, kirmizi, yesil, beyaz, mavi)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (date_key, shift)
       DO UPDATE SET
         sari = shifts_daily.sari + EXCLUDED.sari,
         kirmizi = shifts_daily.kirmizi + EXCLUDED.kirmizi,
         yesil = shifts_daily.yesil + EXCLUDED.yesil,
         beyaz = shifts_daily.beyaz + EXCLUDED.beyaz,
         mavi = shifts_daily.mavi + EXCLUDED.mavi`,
      [shiftDate, shiftKey, ...values]
    );
    return;
  }
  const db = readShiftStore();
  if (!db[monthKey]) db[monthKey] = {};
  if (!db[monthKey][shiftKey]) {
    db[monthKey][shiftKey] = { sari: 0, kirmizi: 0, yesil: 0, beyaz: 0, mavi: 0 };
  }
  const entry = db[monthKey][shiftKey];
  entry.sari += toNumber(deltaStates.sari);
  entry.kirmizi += toNumber(deltaStates.kirmizi);
  entry.yesil += toNumber(deltaStates.yesil);
  entry.beyaz += toNumber(deltaStates.beyaz);
  entry.mavi += toNumber(deltaStates.mavi);
  writeShiftStore(db);

  const dailyDb = readDailyShiftStore();
  if (!dailyDb[shiftDate]) dailyDb[shiftDate] = {};
  if (!dailyDb[shiftDate][shiftKey]) {
    dailyDb[shiftDate][shiftKey] = { sari: 0, kirmizi: 0, yesil: 0, beyaz: 0, mavi: 0 };
  }
  const dailyEntry = dailyDb[shiftDate][shiftKey];
  dailyEntry.sari += toNumber(deltaStates.sari);
  dailyEntry.kirmizi += toNumber(deltaStates.kirmizi);
  dailyEntry.yesil += toNumber(deltaStates.yesil);
  dailyEntry.beyaz += toNumber(deltaStates.beyaz);
  dailyEntry.mavi += toNumber(deltaStates.mavi);
  writeDailyShiftStore(dailyDb);
}

async function initDb() {
  if (!useDb) {
    await loadStatusStore();
    return;
  }
  try {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });
    await pool.query("SELECT 1");
    await pool.query(
      `CREATE TABLE IF NOT EXISTS status (
         tezgah_id TEXT PRIMARY KEY,
         timestamp BIGINT NOT NULL,
         aktif_durum TEXT NOT NULL,
         states JSONB NOT NULL,
         stop_counts JSONB NOT NULL DEFAULT '{}'::jsonb
       )`
    );
    await pool.query(
      "ALTER TABLE status ADD COLUMN IF NOT EXISTS stop_counts JSONB NOT NULL DEFAULT '{}'::jsonb"
    );
    await pool.query(
      `CREATE TABLE IF NOT EXISTS meta (
         tezgah_id TEXT PRIMARY KEY,
         desen TEXT NOT NULL,
         atki_sikligi TEXT NOT NULL,
         devir TEXT NOT NULL,
         siparis_metre TEXT NOT NULL,
         teslim_metre TEXT NOT NULL
       )`
    );
    await pool.query(
      "ALTER TABLE meta ADD COLUMN IF NOT EXISTS devir TEXT NOT NULL DEFAULT ''"
    );
    await pool.query(
      "ALTER TABLE meta ADD COLUMN IF NOT EXISTS siparis_metre TEXT NOT NULL DEFAULT ''"
    );
    await pool.query(
      "ALTER TABLE meta ADD COLUMN IF NOT EXISTS teslim_metre TEXT NOT NULL DEFAULT ''"
    );
    await pool.query(
      `CREATE TABLE IF NOT EXISTS monthly (
         tezgah_id TEXT NOT NULL,
         month TEXT NOT NULL,
         sari BIGINT NOT NULL,
         kirmizi BIGINT NOT NULL,
         yesil BIGINT NOT NULL,
         beyaz BIGINT NOT NULL,
         mavi BIGINT NOT NULL,
         PRIMARY KEY (tezgah_id, month)
       )`
    );
    await pool.query(
      `CREATE TABLE IF NOT EXISTS shifts (
         month TEXT NOT NULL,
         shift TEXT NOT NULL,
         sari BIGINT NOT NULL,
         kirmizi BIGINT NOT NULL,
         yesil BIGINT NOT NULL,
         beyaz BIGINT NOT NULL,
         mavi BIGINT NOT NULL,
         PRIMARY KEY (month, shift)
       )`
    );
    await pool.query(
      `CREATE TABLE IF NOT EXISTS shifts_daily (
         date_key TEXT NOT NULL,
         shift TEXT NOT NULL,
         sari BIGINT NOT NULL,
         kirmizi BIGINT NOT NULL,
         yesil BIGINT NOT NULL,
         beyaz BIGINT NOT NULL,
         mavi BIGINT NOT NULL,
         PRIMARY KEY (date_key, shift)
       )`
    );
    await loadStatusStore();
  } catch (err) {
    console.error("DB init failed, fallback to local files.", err);
    useDb = false;
    pool = null;
    await loadStatusStore();
  }
}

app.post("/ingest", async (req, res) => {
  const { tezgahId, timestamp, aktifDurum, states } = req.body || {};
  if (!tezgahId || !states) {
    return res.status(400).json({ ok: false, error: "tezgahId ve states gerekli" });
  }

  const prev = store.get(tezgahId);
  const stopCounts = normalizeStopCounts(prev?.stopCounts);
  let ts = toNumber(timestamp);
  if (!ts || ts < MIN_VALID_TS) {
    ts = Math.floor(Date.now() / 1000);
  }

  const current = {
    tezgahId,
    timestamp: ts,
    aktifDurum: aktifDurum || "none",
    states,
    stopCounts
  };

  const cumulative = calcEfficiency(states);
  const deltaStates = prev ? diffStates(prev.states, states) : null;
  const delta = deltaStates ? calcEfficiency(deltaStates) : null;

  if (
    prev &&
    current.aktifDurum !== prev.aktifDurum &&
    STOP_STATES.has(current.aktifDurum)
  ) {
    current.stopCounts[current.aktifDurum] += 1;
    // "iplik_sonu" fiilen atkı kaynaklı bir duruş olduğu için
    // atkı sayacında da görünmesini sağlıyoruz.
    if (current.aktifDurum === "iplik_sonu") {
      current.stopCounts.sari += 1;
    }
  }

  store.set(tezgahId, current);
  // Local file mode: persist each ingest so restart continues near-exactly.
  persistStatusStore();
  if (deltaStates) {
    await addMonthlyTotals(tezgahId, current.timestamp, deltaStates);
    await addShiftTotals(current.timestamp, deltaStates);
  }
  if (useDb) {
    await pool.query(
      `INSERT INTO status (tezgah_id, timestamp, aktif_durum, states, stop_counts)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (tezgah_id)
       DO UPDATE SET timestamp = EXCLUDED.timestamp,
         aktif_durum = EXCLUDED.aktif_durum,
         states = EXCLUDED.states,
         stop_counts = EXCLUDED.stop_counts`,
      [
        tezgahId,
        current.timestamp,
        current.aktifDurum,
        current.states,
        current.stopCounts
      ]
    );
  }
  persistStatusStore();
  broadcastLiveUpdate({
    type: "status",
    tezgahId: current.tezgahId,
    timestamp: current.timestamp,
    aktifDurum: current.aktifDurum
  });

  return res.json({
    ok: true,
    tezgahId,
    aktifDurum: current.aktifDurum,
    cumulative,
    delta
  });
});

app.post("/api/login", (req, res) => {
  const { username, password } = req.body || {};
  if (username === AUTH_USER && password === AUTH_PASS) {
    res.setHeader(
      "Set-Cookie",
      `auth=${AUTH_TOKEN}; HttpOnly; Path=/; SameSite=Lax`
    );
    return res.json({ ok: true, token: AUTH_TOKEN });
  }
  return res.status(401).json({ ok: false, error: "invalid credentials" });
});

app.get("/login", (req, res) => {
  return res.sendFile(path.join(__dirname, "public", "login.html"));
});

app.get("/", (req, res) => {
  if (isAuthorized(req)) {
    return res.sendFile(path.join(__dirname, "public", "index.html"));
  }
  return res.redirect("/login");
});

app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (req, res) => {
  return res.json({ ok: true, service: "interteks-randiman-server" });
});

app.get("/api/stream", (req, res) => {
  if (!isAuthorized(req)) {
    return res.status(401).end();
  }
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  if (typeof res.flushHeaders === "function") {
    res.flushHeaders();
  }
  res.write("data: {\"type\":\"hello\"}\n\n");

  const client = {
    res,
    ping: setInterval(() => {
      try {
        res.write(":ping\n\n");
      } catch (err) {
        clearInterval(client.ping);
        sseClients.delete(client);
      }
    }, 15000)
  };
  sseClients.add(client);

  req.on("close", () => {
    clearInterval(client.ping);
    sseClients.delete(client);
  });
});

app.get("/api/status", (req, res) => {
  if (useDb) {
    return pool
      .query(
        `SELECT s.tezgah_id, s.timestamp, s.aktif_durum, s.states,
                s.stop_counts, m.desen, m.atki_sikligi, m.devir,
                m.siparis_metre, m.teslim_metre
         FROM status s
         LEFT JOIN meta m ON m.tezgah_id = s.tezgah_id`
      )
      .then((result) => {
        const items = result.rows.map((row) => ({
          tezgahId: row.tezgah_id,
          timestamp: Number(row.timestamp),
          aktifDurum: row.aktif_durum,
          states: row.states || {},
          cumulative: calcEfficiency(row.states || {}),
          stopCounts: normalizeStopCounts(row.stop_counts),
          meta:
            row.desen ||
            row.atki_sikligi ||
            row.devir ||
            row.siparis_metre ||
            row.teslim_metre
              ? {
                  desen: row.desen,
                  atkiSikligi: row.atki_sikligi,
                  devir: row.devir,
                  siparisMetre: row.siparis_metre,
                  teslimMetre: row.teslim_metre
                }
              : null
        }));
        return res.json({ ok: true, items });
      })
      .catch((err) => res.status(500).json({ ok: false, error: err.message }));
  }
  const metaDb = readMetaStore();
  const items = Array.from(store.values()).map((data) => ({
    tezgahId: data.tezgahId,
    timestamp: data.timestamp,
    aktifDurum: data.aktifDurum,
    states: data.states,
    cumulative: calcEfficiency(data.states),
    stopCounts: normalizeStopCounts(data.stopCounts),
    meta: metaDb[data.tezgahId] || null
  }));
  return res.json({ ok: true, items });
});

app.get("/api/monthly", (req, res) => {
  const month = req.query.month;
  const key = month || monthKeyFromTimestamp();
  if (useDb) {
    return pool
      .query(
        `SELECT tezgah_id, sari, kirmizi, yesil, beyaz, mavi
         FROM monthly WHERE month = $1`,
        [key]
      )
      .then((result) => {
        const list = result.rows.map((row) => {
          const states = {
            sari: Number(row.sari),
            kirmizi: Number(row.kirmizi),
            yesil: Number(row.yesil),
            beyaz: Number(row.beyaz),
            mavi: Number(row.mavi)
          };
          return { tezgahId: row.tezgah_id, states, cumulative: calcEfficiency(states) };
        });
        return res.json({ ok: true, month: key, items: list });
      })
      .catch((err) => res.status(500).json({ ok: false, error: err.message }));
  }
  const db = readMonthlyStore();
  const items = db[key] || {};
  const list = Object.keys(items).map((tezgahId) => ({
    tezgahId,
    states: items[tezgahId],
    cumulative: calcEfficiency(items[tezgahId])
  }));
  return res.json({ ok: true, month: key, items: list });
});

app.get("/api/shifts", (req, res) => {
  const period = req.query.period === "daily" ? "daily" : "monthly";
  const month = req.query.month || monthKeyFromTimestamp();
  const dateKey = req.query.date || todayDateString();
  if (useDb) {
    if (period === "daily") {
      return pool
        .query(
          `SELECT shift, sari, kirmizi, yesil, beyaz, mavi
           FROM shifts_daily WHERE date_key = $1`,
          [dateKey]
        )
        .then((result) => {
          const map = new Map();
          result.rows.forEach((row) => {
            map.set(row.shift, {
              sari: Number(row.sari),
              kirmizi: Number(row.kirmizi),
              yesil: Number(row.yesil),
              beyaz: Number(row.beyaz),
              mavi: Number(row.mavi)
            });
          });
          const shifts = ["07-15", "15-23", "23-07"].map((shift) => {
            const states = map.get(shift) || { sari: 0, kirmizi: 0, yesil: 0, beyaz: 0, mavi: 0 };
            return { shift, states, cumulative: calcEfficiency(states) };
          });
          return res.json({ ok: true, period, date: dateKey, shifts });
        })
        .catch((err) => res.status(500).json({ ok: false, error: err.message }));
    }
    return pool
      .query(
        `SELECT shift, sari, kirmizi, yesil, beyaz, mavi
         FROM shifts WHERE month = $1`,
        [month]
      )
      .then((result) => {
        const map = new Map();
        result.rows.forEach((row) => {
          map.set(row.shift, {
            sari: Number(row.sari),
            kirmizi: Number(row.kirmizi),
            yesil: Number(row.yesil),
            beyaz: Number(row.beyaz),
            mavi: Number(row.mavi)
          });
        });
        const shifts = ["07-15", "15-23", "23-07"].map((shift) => {
          const states = map.get(shift) || { sari: 0, kirmizi: 0, yesil: 0, beyaz: 0, mavi: 0 };
          return { shift, states, cumulative: calcEfficiency(states) };
        });
        return res.json({ ok: true, period, month, shifts });
      })
      .catch((err) => res.status(500).json({ ok: false, error: err.message }));
  }
  const sourceDb = period === "daily" ? readDailyShiftStore() : readShiftStore();
  const sourceData = period === "daily" ? sourceDb[dateKey] || {} : sourceDb[month] || {};
  const shifts = ["07-15", "15-23", "23-07"].map((shift) => ({
    shift,
    states: sourceData[shift] || { sari: 0, kirmizi: 0, yesil: 0, beyaz: 0, mavi: 0 },
    cumulative: calcEfficiency(sourceData[shift] || {})
  }));
  if (period === "daily") {
    return res.json({ ok: true, period, date: dateKey, shifts });
  }
  return res.json({ ok: true, period, month, shifts });
});
app.get("/api/monthly.pdf", (req, res) => {
  const month = req.query.month || monthKeyFromTimestamp();
  const reportDate = req.query.date || todayDateString();

  const sendPdf = (items) => {
    const doc = new PDFDocument({ margin: 40 });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="randiman-${month}-${reportDate}.pdf"`
    );
    doc.pipe(res);

    doc.fontSize(18).text("Interteks Aylik Randiman Raporu", { align: "center" });
    doc.moveDown(0.5);
    doc
      .fontSize(11)
      .text(`Ay: ${month} - Tarih: ${reportDate} - Saat Dilimi: ${REPORT_TIMEZONE}`, {
        align: "center"
      });
    doc.moveDown();

    if (!items.length) {
      doc.moveDown();
      doc
        .fontSize(12)
        .text(
          "Bu ay icin veri yok. Aylik rapor, ingest verisi geldikce otomatik dolar.",
          { align: "center" }
        );
      doc.end();
      return;
    }

    const totalStates = { sari: 0, kirmizi: 0, yesil: 0, beyaz: 0, mavi: 0 };
    const totalCounts = { sari: 0, kirmizi: 0, yesil: 0, beyaz: 0, iplik_sonu: 0 };
    items.forEach((item) => {
      totalStates.sari += toNumber(item.states.sari);
      totalStates.kirmizi += toNumber(item.states.kirmizi);
      totalStates.yesil += toNumber(item.states.yesil);
      totalStates.beyaz += toNumber(item.states.beyaz);
      totalStates.mavi += toNumber(item.states.mavi);
      const counts = normalizeStopCounts(item.stopCounts);
      totalCounts.sari += counts.sari;
      totalCounts.kirmizi += counts.kirmizi;
      totalCounts.yesil += counts.yesil;
      totalCounts.beyaz += counts.beyaz;
      totalCounts.iplik_sonu += counts.iplik_sonu;
    });
    const overall = calcEfficiency(totalStates);
    const totalStopSeconds =
      totalStates.sari + totalStates.kirmizi + totalStates.yesil + totalStates.beyaz;
    const [dominantDurationKey, dominantDurationValue] = dominantReason(totalStates);
    const [dominantCountKey, dominantCountValue] = dominantStopCountReason(totalCounts);

    doc.fontSize(12).text("Ozet");
    doc.fontSize(10).text(`- Toplam calisma: ${formatHours(totalStates.mavi)}`);
    doc
      .fontSize(10)
      .text(`- Toplam durus: ${formatHours(totalStopSeconds)} (${Math.round(overall.randiman * 100)}% randiman)`);
    doc
      .fontSize(10)
      .text(
        `- Sureye gore en agirlikli durus: ${STOP_REASON_LABELS[dominantDurationKey]} (${formatHours(
          dominantDurationValue
        )})`
      );
    doc
      .fontSize(10)
      .text(
        `- Sayiya gore en sik durus: ${STOP_REASON_LABELS[dominantCountKey]} (${dominantCountValue} kere)`
      );
    doc.moveDown(0.7);

    const header = [
      "Tezgah",
      "Calis. (saat)",
      "Durus (saat)",
      "Rand.",
      "Siparis",
      "Kesilen",
      "Kalan",
      "Durus #",
      "Ana Neden"
    ];
    const colWidths = [60, 58, 58, 40, 50, 50, 50, 45, 70];
    const rowHeight = 20;
    const startX = doc.x;

    function drawRow(values, y, isHeader = false) {
      let x = startX;
      doc.fontSize(isHeader ? 9 : 8);
      values.forEach((value, idx) => {
        doc.text(String(value), x + 3, y + 5, { width: colWidths[idx] - 6 });
        x += colWidths[idx];
      });
    }

    function drawRowBox(y, fillColor) {
      let x = startX;
      if (fillColor) {
        doc.rect(x, y, colWidths.reduce((a, b) => a + b, 0), rowHeight).fill(fillColor);
      }
      x = startX;
      colWidths.forEach((w) => {
        doc.rect(x, y, w, rowHeight).stroke();
        x += w;
      });
    }

    let cursorY = doc.y;
    drawRowBox(cursorY, "#f1f3f7");
    drawRow(header, cursorY, true);
    cursorY += rowHeight;

    items
      .slice()
      .sort((a, b) => a.tezgahId.localeCompare(b.tezgahId))
      .forEach((item) => {
        if (cursorY + rowHeight > doc.page.height - doc.page.margins.bottom) {
          doc.addPage();
          cursorY = doc.y;
          drawRowBox(cursorY, "#f1f3f7");
          drawRow(header, cursorY, true);
          cursorY += rowHeight;
        }
        const states = item.states || {};
        const counts = normalizeStopCounts(item.stopCounts);
        const cumulative = calcEfficiency(states);
        const siparisMetre = toMetreNumber(item.meta?.siparisMetre);
        const kesilenMetre = toMetreNumber(item.meta?.teslimMetre);
        const kalanMetre = Math.max(0, siparisMetre - kesilenMetre);
        const stopCountTotal =
          counts.sari + counts.kirmizi + counts.yesil + counts.beyaz + counts.iplik_sonu;
        const [mainReasonKey] = dominantReason(states);
        const stopSeconds =
          toNumber(states.sari) +
          toNumber(states.kirmizi) +
          toNumber(states.yesil) +
          toNumber(states.beyaz);
        drawRowBox(cursorY);
        drawRow(
          [
            item.tezgahId,
            (toNumber(states.mavi) / 3600).toFixed(1),
            (stopSeconds / 3600).toFixed(1),
            `${Math.round(cumulative.randiman * 100)}%`,
            metreToString(siparisMetre),
            metreToString(kesilenMetre),
            metreToString(kalanMetre),
            stopCountTotal,
            STOP_REASON_LABELS[mainReasonKey]
          ],
          cursorY
        );
        cursorY += rowHeight;
      });

    const stopDenominator = Math.max(1, totalStopSeconds);
    const breakdown = [
      ["sari", totalStates.sari, totalCounts.sari],
      ["kirmizi", totalStates.kirmizi, totalCounts.kirmizi],
      ["yesil", totalStates.yesil, totalCounts.yesil],
      ["beyaz", totalStates.beyaz, totalCounts.beyaz]
    ];
    if (cursorY + 120 > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
      cursorY = doc.y;
    }
    doc.y = cursorY + 8;
    doc.fontSize(11).text("Durus Dagilim Ozeti (Sure / Agirlik / Sayi)");
    breakdown.forEach(([key, seconds, count]) => {
      const weight = Math.round((toNumber(seconds) / stopDenominator) * 100);
      doc
        .fontSize(10)
        .text(
          `- ${STOP_REASON_LABELS[key]}: ${formatHours(seconds)} / %${weight} / ${toNumber(
            count
          )} kere`
        );
    });
    doc
      .fontSize(10)
      .text(`- Iplik Sonu: sayi bazli ${totalCounts.iplik_sonu} kere (sureye dahil degil)`);

    doc.end();
  };

  if (useDb) {
    return pool
      .query(
        `SELECT mo.tezgah_id, mo.sari, mo.kirmizi, mo.yesil, mo.beyaz, mo.mavi,
                me.siparis_metre, me.teslim_metre, st.stop_counts
         FROM monthly mo
         LEFT JOIN meta me ON me.tezgah_id = mo.tezgah_id
         LEFT JOIN status st ON st.tezgah_id = mo.tezgah_id
         WHERE mo.month = $1`,
        [month]
      )
      .then((result) => {
        const items = result.rows.map((row) => ({
          tezgahId: row.tezgah_id,
          states: {
            sari: toNumber(row.sari),
            kirmizi: toNumber(row.kirmizi),
            yesil: toNumber(row.yesil),
            beyaz: toNumber(row.beyaz),
            mavi: toNumber(row.mavi)
          },
          stopCounts: normalizeStopCounts(row.stop_counts),
          meta: {
            siparisMetre: row.siparis_metre || "",
            teslimMetre: row.teslim_metre || ""
          }
        }));
        sendPdf(items);
      })
      .catch((err) => res.status(500).json({ ok: false, error: err.message }));
  }

  const monthlyDb = readMonthlyStore();
  const metaDb = readMetaStore();
  const statusDb = readStatusStore();
  const monthItems = monthlyDb[month] || {};
  const items = Object.keys(monthItems).map((tezgahId) => ({
    tezgahId,
    states: monthItems[tezgahId],
    stopCounts: normalizeStopCounts(statusDb[tezgahId]?.stopCounts),
    meta: metaDb[tezgahId] || null
  }));
  return sendPdf(items);
});

app.get("/api/shift.pdf", (req, res) => {
  const period = req.query.period === "daily" ? "daily" : "monthly";
  const month = req.query.month || monthKeyFromTimestamp();
  const shift = req.query.shift || "07-15";
  const reportDate = req.query.date || todayDateString();

  const sendPdf = (states, stopCounts) => {
    const cumulative = calcEfficiency(states);
    const counts = normalizeStopCounts(stopCounts);
    const stopSeconds =
      toNumber(states.sari) + toNumber(states.kirmizi) + toNumber(states.yesil) + toNumber(states.beyaz);
    const [dominantDurationKey, dominantDurationValue] = dominantReason(states);
    const [dominantCountKey, dominantCountValue] = dominantStopCountReason(counts);
    const doc = new PDFDocument({ margin: 40 });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="vardiya-${shift}-${reportDate}.pdf"`
    );
    doc.pipe(res);

    doc.fontSize(18).text("Interteks Vardiya Randiman Raporu", { align: "center" });
    doc.moveDown(0.5);
    doc
      .fontSize(12)
      .text(`Vardiya: ${shift} - Kapsam: ${period === "daily" ? "Gunluk" : "Aylik"} - Ay: ${month} - Tarih: ${reportDate} - Saat Dilimi: ${REPORT_TIMEZONE}`, {
        align: "center"
      });
    doc.moveDown();
    if (cumulative.totalSeconds === 0) {
      doc.fontSize(12).text("Vardiya icin veri yok.", { align: "center" });
      doc.end();
      return;
    }

    const rows = [
      ["Calisma (sure)", `${formatSeconds(states.mavi)} (${formatHours(states.mavi)})`],
      ["Atki Durusu", `${formatSeconds(states.sari)} (${formatHours(states.sari)})`],
      ["Cozgu Durusu", `${formatSeconds(states.kirmizi)} (${formatHours(states.kirmizi)})`],
      ["Elle Durdurma", `${formatSeconds(states.yesil)} (${formatHours(states.yesil)})`],
      ["Genel Ariza / Usta", `${formatSeconds(states.beyaz)} (${formatHours(states.beyaz)})`],
      ["Randiman", `${Math.round(cumulative.randiman * 100)}%`]
    ];
    rows.forEach(([label, value]) => {
      doc.fontSize(11).text(`${label}: ${value}`);
    });
    doc.moveDown(0.5);
    doc.fontSize(11).text("Durus Analizi");
    doc
      .fontSize(10)
      .text(
        `- Sureye gore en agirlikli neden: ${STOP_REASON_LABELS[dominantDurationKey]} (${formatHours(
          dominantDurationValue
        )})`
      );
    doc
      .fontSize(10)
      .text(
        `- Toplam durus suresi: ${formatHours(stopSeconds)} (calisma disi)` 
      );
    doc
      .fontSize(10)
      .text(
        `- Sayiya gore en sik durus (anlik sayac): ${STOP_REASON_LABELS[dominantCountKey]} (${dominantCountValue} kere)`
      );
    doc
      .fontSize(10)
      .text(
        `- Durus sayaclari: Atki ${counts.sari}, Cozgu ${counts.kirmizi}, Elle ${counts.yesil}, Ariza ${counts.beyaz}, Iplik Sonu ${counts.iplik_sonu}`
      );
    doc.end();
  };

  if (useDb) {
    const shiftTable = period === "daily" ? "shifts_daily" : "shifts";
    const keyColumn = period === "daily" ? "date_key" : "month";
    const keyValue = period === "daily" ? reportDate : month;
    return Promise.all([
      pool.query(
        `SELECT sari, kirmizi, yesil, beyaz, mavi
         FROM ${shiftTable} WHERE ${keyColumn} = $1 AND shift = $2`,
        [keyValue, shift]
      ),
      pool.query("SELECT stop_counts FROM status")
    ])
      .then(([shiftResult, statusResult]) => {
        const row = shiftResult.rows[0] || {};
        const states = {
          sari: toNumber(row.sari),
          kirmizi: toNumber(row.kirmizi),
          yesil: toNumber(row.yesil),
          beyaz: toNumber(row.beyaz),
          mavi: toNumber(row.mavi)
        };
        const totalCounts = { sari: 0, kirmizi: 0, yesil: 0, beyaz: 0, iplik_sonu: 0 };
        statusResult.rows.forEach((statusRow) => {
          const counts = normalizeStopCounts(statusRow.stop_counts);
          totalCounts.sari += counts.sari;
          totalCounts.kirmizi += counts.kirmizi;
          totalCounts.yesil += counts.yesil;
          totalCounts.beyaz += counts.beyaz;
          totalCounts.iplik_sonu += counts.iplik_sonu;
        });
        sendPdf(states, totalCounts);
      })
      .catch((err) => res.status(500).json({ ok: false, error: err.message }));
  }

  const db = period === "daily" ? readDailyShiftStore() : readShiftStore();
  const statusDb = readStatusStore();
  const periodData = period === "daily" ? db[reportDate] || {} : db[month] || {};
  const states = periodData[shift] || {
    sari: 0,
    kirmizi: 0,
    yesil: 0,
    beyaz: 0,
    mavi: 0
  };
  const totalCounts = { sari: 0, kirmizi: 0, yesil: 0, beyaz: 0, iplik_sonu: 0 };
  Object.values(statusDb).forEach((item) => {
    const counts = normalizeStopCounts(item.stopCounts);
    totalCounts.sari += counts.sari;
    totalCounts.kirmizi += counts.kirmizi;
    totalCounts.yesil += counts.yesil;
    totalCounts.beyaz += counts.beyaz;
    totalCounts.iplik_sonu += counts.iplik_sonu;
  });
  return sendPdf(states, totalCounts);
});

app.get("/api/tezgah", (req, res) => {
  if (useDb) {
    return pool
      .query(
        "SELECT tezgah_id, desen, atki_sikligi, devir, siparis_metre, teslim_metre FROM meta"
      )
      .then((result) => {
        const list = result.rows.map((row) => ({
          tezgahId: row.tezgah_id,
          desen: row.desen,
          atkiSikligi: row.atki_sikligi,
          devir: row.devir,
          siparisMetre: row.siparis_metre,
          teslimMetre: row.teslim_metre
        }));
        return res.json({ ok: true, items: list });
      })
      .catch((err) => res.status(500).json({ ok: false, error: err.message }));
  }
  const metaDb = readMetaStore();
  const list = Object.keys(metaDb).map((tezgahId) => ({
    tezgahId,
    ...metaDb[tezgahId]
  }));
  return res.json({ ok: true, items: list });
});

app.post("/api/tezgah", (req, res) => {
  const { tezgahId, desen, atkiSikligi, devir, siparisMetre, teslimMetre } =
    req.body || {};
  if (!tezgahId) {
    return res.status(400).json({ ok: false, error: "tezgahId gerekli" });
  }
  if (useDb) {
    return pool
      .query(
        `INSERT INTO meta (tezgah_id, desen, atki_sikligi, devir, siparis_metre, teslim_metre)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (tezgah_id)
         DO UPDATE SET desen = EXCLUDED.desen,
           atki_sikligi = EXCLUDED.atki_sikligi,
           devir = EXCLUDED.devir,
           siparis_metre = EXCLUDED.siparis_metre,
           teslim_metre = EXCLUDED.teslim_metre`,
        [
          tezgahId,
          desen || "",
          atkiSikligi || "",
          devir || "",
          siparisMetre || "",
          teslimMetre || ""
        ]
      )
      .then(() =>
        res.json({
          ok: true,
          tezgahId,
          meta: {
            desen: desen || "",
            atkiSikligi: atkiSikligi || "",
            devir: devir || "",
            siparisMetre: siparisMetre || "",
            teslimMetre: teslimMetre || ""
          }
        })
      )
      .catch((err) => res.status(500).json({ ok: false, error: err.message }));
  }
  const metaDb = readMetaStore();
  metaDb[tezgahId] = {
    desen: desen || "",
    atkiSikligi: atkiSikligi || "",
    devir: devir || "",
    siparisMetre: siparisMetre || "",
    teslimMetre: teslimMetre || ""
  };
  writeMetaStore(metaDb);
  broadcastLiveUpdate({ type: "meta", tezgahId });
  return res.json({ ok: true, tezgahId, meta: metaDb[tezgahId] });
});

app.post("/api/tezgah/cut-metre", (req, res) => {
  const { tezgahId, metre, mode } = req.body || {};
  if (!tezgahId) {
    return res.status(400).json({ ok: false, error: "tezgahId gerekli" });
  }
  if (metre === undefined || metre === null || String(metre).trim() === "") {
    return res.status(400).json({ ok: false, error: "metre gerekli" });
  }
  const parsedMetre = Number(String(metre).replace(",", "."));
  if (!Number.isFinite(parsedMetre) || parsedMetre < 0) {
    return res.status(400).json({ ok: false, error: "metre gecersiz" });
  }
  const inputMetre = Math.round(parsedMetre * 100) / 100;
  const updateMode = mode === "set" ? "set" : "add";

  const applyResult = (currentSiparis, currentTeslim) => {
    const siparisMetre = toMetreNumber(currentSiparis);
    const teslimMetre = toMetreNumber(currentTeslim);
    const nextTeslim = updateMode === "set" ? inputMetre : teslimMetre + inputMetre;
    return {
      siparisMetre: metreToString(siparisMetre),
      teslimMetre: metreToString(nextTeslim),
      kalanMetre: metreToString(Math.max(0, siparisMetre - nextTeslim))
    };
  };

  if (useDb) {
    return pool
      .query("SELECT siparis_metre, teslim_metre FROM meta WHERE tezgah_id = $1", [tezgahId])
      .then((result) => {
        const row = result.rows[0] || {};
        const next = applyResult(row.siparis_metre || "", row.teslim_metre || "");
        return pool
          .query(
            `INSERT INTO meta (tezgah_id, desen, atki_sikligi, devir, siparis_metre, teslim_metre)
             VALUES ($1, '', '', '', $2, $3)
             ON CONFLICT (tezgah_id)
             DO UPDATE SET teslim_metre = EXCLUDED.teslim_metre`,
            [tezgahId, next.siparisMetre, next.teslimMetre]
          )
          .then(() => {
            broadcastLiveUpdate({ type: "meta", tezgahId });
            return res.json({ ok: true, tezgahId, ...next, mode: updateMode });
          });
      })
      .catch((err) => res.status(500).json({ ok: false, error: err.message }));
  }

  const metaDb = readMetaStore();
  const current = metaDb[tezgahId] || {
    desen: "",
    atkiSikligi: "",
    devir: "",
    siparisMetre: "",
    teslimMetre: ""
  };
  const next = applyResult(current.siparisMetre, current.teslimMetre);
  metaDb[tezgahId] = {
    ...current,
    siparisMetre: next.siparisMetre,
    teslimMetre: next.teslimMetre
  };
  writeMetaStore(metaDb);
  broadcastLiveUpdate({ type: "meta", tezgahId });
  return res.json({ ok: true, tezgahId, ...next, mode: updateMode });
});

app.get("/status/:tezgahId", (req, res) => {
  const { tezgahId } = req.params;
  if (useDb) {
    return pool
      .query(
        "SELECT tezgah_id, timestamp, aktif_durum, states, stop_counts FROM status WHERE tezgah_id = $1",
        [tezgahId]
      )
      .then((result) => {
        if (result.rows.length === 0) {
          return res.status(404).json({ ok: false, error: "tezgah yok" });
        }
        const row = result.rows[0];
        const data = {
          tezgahId: row.tezgah_id,
          timestamp: Number(row.timestamp),
          aktifDurum: row.aktif_durum,
          states: row.states || {},
          stopCounts: normalizeStopCounts(row.stop_counts)
        };
        return res.json({ ok: true, data, cumulative: calcEfficiency(data.states) });
      })
      .catch((err) => res.status(500).json({ ok: false, error: err.message }));
  }
  const data = store.get(tezgahId);
  if (!data) {
    return res.status(404).json({ ok: false, error: "tezgah yok" });
  }
  return res.json({
    ok: true,
    data: {
      ...data,
      stopCounts: normalizeStopCounts(data.stopCounts)
    },
    cumulative: calcEfficiency(data.states)
  });
});

const PORT = process.env.PORT || 8080;
initDb().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on :${PORT}`);
  });
});
