const STORAGE_WATCH = "nsw_watchlist_v1";
const STORAGE_COLORS = "nsw_colors_v1";

const DEFAULT_TICKER = "AAPL";

// Default colors (match CSS defaults)
const DEFAULT_COLORS = {
  up: "#33d17a",
  down: "#ff6b6b",
  flat: "#b8bcc4" // a soft neutral
};

function $(id){ return document.getElementById(id); }

function fmtTime(){
  const d = new Date();
  return d.toLocaleString(undefined, { weekday:"short", hour:"numeric", minute:"2-digit" });
}

function normalizeTicker(input){
  let t = (input ?? "").trim();
  if (!t) return null;
  t = t.replace(/\s+/g, "");
  if (t.includes(".")) return t.toLowerCase();
  return `${t.toLowerCase()}.us`;
}

function displayTicker(stooqTicker){
  return (stooqTicker.split(".")[0] ?? stooqTicker).toUpperCase();
}

function loadWatchlist(){
  try{
    const raw = localStorage.getItem(STORAGE_WATCH);
    const arr = raw ? JSON.parse(raw) : null;
    if (Array.isArray(arr)) return arr;
  } catch {}
  return [];
}

function saveWatchlist(list){
  localStorage.setItem(STORAGE_WATCH, JSON.stringify(list));
}

function ensureWatchSelect(list){
  const sel = $("watchSelect");
  sel.innerHTML = "";

  const opt0 = document.createElement("option");
  opt0.value = "";
  opt0.textContent = list.length ? "Favorites…" : "No favorites yet";
  sel.appendChild(opt0);

  list.forEach(t => {
    const opt = document.createElement("option");
    opt.value = t;
    opt.textContent = displayTicker(t);
    sel.appendChild(opt);
  });
}

function money(n){
  if (n == null || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(n);
}

function comma(n){
  if (n == null || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat().format(n);
}

/* ---------- Colors (user customizable) ---------- */

function safeParse(json){
  try { return JSON.parse(json); } catch { return null; }
}

function loadColors(){
  const raw = localStorage.getItem(STORAGE_COLORS);
  const v = raw ? safeParse(raw) : null;
  if (!v) return { ...DEFAULT_COLORS };
  return {
    up: typeof v.up === "string" ? v.up : DEFAULT_COLORS.up,
    down: typeof v.down === "string" ? v.down : DEFAULT_COLORS.down,
    flat: typeof v.flat === "string" ? v.flat : DEFAULT_COLORS.flat
  };
}

function saveColors(c){
  localStorage.setItem(STORAGE_COLORS, JSON.stringify(c));
}

function applyColorsToCSS(c){
  // Apply to root CSS variables so everything updates immediately
  document.documentElement.style.setProperty("--up", c.up);
  document.documentElement.style.setProperty("--down", c.down);
  document.documentElement.style.setProperty("--flat", c.flat);
}

function initColorUI(){
  const up = $("upColor");
  const down = $("downColor");
  const flat = $("flatColor");
  const reset = $("resetColorsBtn");

  if (!up || !down || !flat || !reset) return;

  const colors = loadColors();
  applyColorsToCSS(colors);

  up.value = colors.up;
  down.value = colors.down;
  flat.value = colors.flat;

  function onChange(){
    const updated = { up: up.value, down: down.value, flat: flat.value };
    saveColors(updated);
    applyColorsToCSS(updated);
  }

  up.addEventListener("input", onChange);
  down.addEventListener("input", onChange);
  flat.addEventListener("input", onChange);

  reset.addEventListener("click", () => {
    saveColors({ ...DEFAULT_COLORS });
    const d = { ...DEFAULT_COLORS };
    up.value = d.up;
    down.value = d.down;
    flat.value = d.flat;
    applyColorsToCSS(d);
  });
}

/* ---------- Data fetch ---------- */

function parseCSV(text){
  const lines = text.trim().split("\n");
  if (lines.length < 3) return [];
  const rows = [];
  for (let i=1; i<lines.length; i++){
    const parts = lines[i].split(",");
    if (parts.length < 6) continue;
    const [date, open, high, low, close, volume] = parts;
    const o = Number(open), h = Number(high), l = Number(low), c = Number(close), v = Number(volume);
    if (!date || [o,h,l,c].some(x => Number.isNaN(x))) continue;
    rows.push({ date, open:o, high:h, low:l, close:c, volume: Number.isNaN(v) ? null : v });
  }
  return rows;
}

async function fetchHistory(ticker){
  // CORS-safe via AllOrigins RAW
  const url = `https://api.allorigins.win/raw?url=${encodeURIComponent(
    `https://stooq.com/q/d/l/?s=${ticker}&i=d`
  )}`;

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error("Fetch failed");
  const text = await res.text();

  const idx = text.indexOf("Date,Open,High,Low,Close,Volume");
  if (idx === -1) throw new Error("No data");
  return parseCSV(text.slice(idx));
}

/* ---------- Rendering ---------- */

function sparkPath(values){
  if (!values || values.length < 2) return "";
  const w = 200, h = 60, pad = 4;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = (max - min) || 1;
  const xStep = (w - pad*2) / (values.length - 1);

  let d = "";
  values.forEach((v, i) => {
    const x = pad + i * xStep;
    const y = pad + (h - pad*2) * (1 - ((v - min) / span));
    d += (i === 0 ? `M ${x} ${y}` : ` L ${x} ${y}`);
  });
  return d;
}

function setDirectionClasses(direction){
  // direction: "up" | "down" | "flat"
  const changeEl = $("change");
  const sparkEl = $("sparkPath");
  if (!changeEl || !sparkEl) return;

  changeEl.classList.remove("up", "down", "flat");
  sparkEl.classList.remove("up", "down", "flat");

  changeEl.classList.add(direction);
  sparkEl.classList.add(direction);
}

function render(rows, ticker){
  const last = rows[rows.length - 1];
  const prev = rows[rows.length - 2] ?? null;

  $("symbol").textContent = displayTicker(ticker);
  $("time").textContent = `Updated: ${fmtTime()} • Last data: ${last?.date ?? "—"}`;

  const price = last?.close ?? null;
  const chg = (prev && price != null) ? (price - prev.close) : null;
  const chgPct = (prev && price != null) ? (chg / prev.close) : null;

  $("price").textContent = price != null ? `$${money(price)}` : "—";

  // Color-coded change
  if (chg != null && chgPct != null){
    const direction = chg > 0 ? "up" : chg < 0 ? "down" : "flat";
    setDirectionClasses(direction);

    $("change").textContent =
      `${chg >= 0 ? "+" : ""}${money(chg)} (${(chgPct*100).toFixed(2)}%)`;
  } else {
    setDirectionClasses("flat");
    $("change").textContent = "—";
  }

  $("open").textContent = last?.open != null ? `$${money(last.open)}` : "—";
  $("high").textContent = last?.high != null ? `$${money(last.high)}` : "—";
  $("low").textContent  = last?.low  != null ? `$${money(last.low)}` : "—";
  $("volume").textContent = last?.volume != null ? comma(last.volume) : "—";

  const slice = rows.slice(-252);
  const hi52 = slice.length ? Math.max(...slice.map(r => r.high)) : null;
  const lo52 = slice.length ? Math.min(...slice.map(r => r.low)) : null;

  $("hi52").textContent = hi52 != null ? `$${money(hi52)}` : "—";
  $("lo52").textContent = lo52 != null ? `$${money(lo52)}` : "—";

  const rangePct = (price != null && hi52 != null && lo52 != null)
    ? (price - lo52) / (hi52 - lo52)
    : null;

  $("range").textContent = rangePct != null ? `${(rangePct*100).toFixed(0)}% of 52W` : "—";

  const closes = rows.slice(-60).map(r => r.close);
  $("sparkPath").setAttribute("d", sparkPath(closes));

  if (closes.length >= 20 && price != null){
    const last20 = closes.slice(-20);
    const sma20 = last20.reduce((a,b)=>a+b,0)/last20.length;
    const diff = (price - sma20) / sma20;
    $("trend").textContent =
      diff > 0.02 ? "Above 20D" :
      diff < -0.02 ? "Below 20D" :
      "Near 20D";
  } else {
    $("trend").textContent = "—";
  }
}

async function loadTicker(input){
  const ticker = normalizeTicker(input);
  if (!ticker) return;

  $("msg").hidden = false;
  $("msg").textContent = "Loading…";

  try{
    const rows = await fetchHistory(ticker);
    render(rows, ticker);
    $("msg").hidden = true;
  } catch (e){
    $("msg").textContent = "Couldn’t load symbol.";
  }
}

/* ---------- Setup ---------- */

function setup(){
  initColorUI();

  const watchlist = loadWatchlist();
  ensureWatchSelect(watchlist);

  $("loadBtn").addEventListener("click", () => {
    loadTicker($("tickerInput").value);
  });

  $("tickerInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") loadTicker($("tickerInput").value);
  });

  $("watchSelect").addEventListener("change", () => {
    const t = $("watchSelect").value;
    if (t) loadTicker(displayTicker(t));
  });

  $("saveBtn").addEventListener("click", () => {
    const current = ($("symbol").textContent || "").trim();
    if (!current || current === "—") return;
    const normalized = normalizeTicker(current);
    const list = loadWatchlist();
    if (!list.includes(normalized)){
      list.unshift(normalized);
      saveWatchlist(list);
      ensureWatchSelect(list);
    }
  });

  $("removeBtn").addEventListener("click", () => {
    const selected = $("watchSelect").value;
    if (!selected) return;
    const list = loadWatchlist().filter(x => x !== selected);
    saveWatchlist(list);
    ensureWatchSelect(list);
  });

  loadTicker(DEFAULT_TICKER);
}

setup();
