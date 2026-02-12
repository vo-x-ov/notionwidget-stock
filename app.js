// Notion Stock Widget (no API key)
// Data source: Stooq CSV (fetched via CORS-friendly relay)

const STORAGE_KEY = "nsw_watchlist_v1";
const DEFAULT_TICKER = "AAPL";

function fmtTime(){
  const d = new Date();
  return d.toLocaleString(undefined, { weekday:"short", hour:"numeric", minute:"2-digit" });
}

function $(id){ return document.getElementById(id); }

function setMsg(text){
  const el = $("msg");
  if (!text){ el.hidden = true; el.textContent = ""; return; }
  el.hidden = false;
  el.textContent = text;
}

function normalizeTicker(input){
  // Accept: "AAPL", "aapl", "aapl.us", "TSLA.US"
  // Stooq US format uses lowercase + ".us"
  let t = (input ?? "").trim();
  if (!t) return null;

  // Remove spaces
  t = t.replace(/\s+/g, "");

  // If user includes market suffix already (contains ".")
  if (t.includes(".")) return t.toLowerCase();

  // Default to US
  return `${t.toLowerCase()}.us`;
}

function displayTicker(t){
  // Show "AAPL" instead of "aapl.us"
  const base = t.split(".")[0] ?? t;
  return base.toUpperCase();
}

function loadWatchlist(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    const arr = raw ? JSON.parse(raw) : null;
    if (Array.isArray(arr)) return arr;
  } catch {}
  return [];
}

function saveWatchlist(list){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
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

function comma(n){
  if (n == null || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat().format(n);
}

function money(n){
  if (n == null || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(n);
}

function pct(n){
  if (n == null || Number.isNaN(n)) return "—";
  return `${(n*100).toFixed(2)}%`;
}

function parseCSV(text){
  // Stooq historical CSV columns:
  // Date,Open,High,Low,Close,Volume
  const lines = text.trim().split("\n");
  if (lines.length < 3) return [];

  // header
  const rows = [];
  for (let i=1; i<lines.length; i++){
    const parts = lines[i].split(",");
    if (parts.length < 6) continue;
    const [date, open, high, low, close, volume] = parts;
    const o = Number(open), h = Number(high), l = Number(low), c = Number(close), v = Number(volume);
    if (!date || [o,h,l,c].some(x => Number.isNaN(x))) continue;
    rows.push({ date, open:o, high:h, low:l, close:c, volume: Number.isNaN(v) ? null : v });
  }

  // Stooq returns ascending (oldest → newest) for /q/d/l/
  return rows;
}

function sparkPath(values){
  // values: array of closes, length N
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
    d += (i === 0 ? `M ${x.toFixed(2)} ${y.toFixed(2)}` : ` L ${x.toFixed(2)} ${y.toFixed(2)}`);
  });
  return d;
}

async function fetchStooqHistory(ticker){
  // Use CORS-friendly relay
  // Stooq URL: https://stooq.com/q/d/l/?s=aapl.us&i=d
  // Relay: https://r.jina.ai/http(s)://...
  const stooq = `https://stooq.com/q/d/l/?s=${encodeURIComponent(ticker)}&i=d`;
  const relay = `https://r.jina.ai/${stooq}`;
  const res = await fetch(relay, { cache: "no-store" });
  if (!res.ok) throw new Error("Fetch failed");
  const text = await res.text();

  // Relay returns page with the CSV content; it should include the CSV directly.
  // We’ll pull out the CSV lines by finding the first header line.
  const idx = text.indexOf("Date,Open,High,Low,Close,Volume");
  if (idx === -1) throw new Error("No CSV data (invalid ticker?)");
  const csv = text.slice(idx).trim();
  return parseCSV(csv);
}

function compute52w(rows){
  // last ~252 trading days
  const slice = rows.slice(-252);
  const highs = slice.map(r => r.high);
  const lows  = slice.map(r => r.low);
  return {
    hi52: Math.max(...highs),
    lo52: Math.min(...lows)
  };
}

function trendLabel(rows){
  // Simple: compare last close to 20-day SMA
  const closes = rows.map(r => r.close);
  if (closes.length < 25) return "—";
  const last = closes[closes.length - 1];
  const last20 = closes.slice(-20);
  const sma20 = last20.reduce((a,b)=>a+b,0)/last20.length;
  const diff = (last - sma20) / sma20;
  if (diff > 0.02) return "Above 20D";
  if (diff < -0.02) return "Below 20D";
  return "Near 20D";
}

function render(rows, ticker){
  const last = rows[rows.length - 1];
  const prev = rows[rows.length - 2] ?? null;

  $("symbol").textContent = displayTicker(ticker);
  $("name").textContent = ""; // Stooq doesn't provide names; we keep it clean
  $("time").textContent = `Updated: ${fmtTime()} • Last data: ${last?.date ?? "—"}`;

  // Price / change
  const price = last?.close ?? null;
  const chg = (prev && price != null) ? (price - prev.close) : null;
  const chgPct = (prev && price != null) ? (chg / prev.close) : null;

  $("price").textContent = price != null ? `$${money(price)}` : "—";
  $("change").textContent = (chg != null && chgPct != null)
    ? `${chg >= 0 ? "+" : ""}${money(chg)} (${(chgPct*100).toFixed(2)}%)`
    : "—";

  // OHLC
  $("open").textContent = last?.open != null ? `$${money(last.open)}` : "—";
  $("high").textContent = last?.high != null ? `$${money(last.high)}` : "—";
  $("low").textContent  = last?.low  != null ? `$${money(last.low)}` : "—";
  $("volume").textContent = last?.volume != null ? comma(last.volume) : "—";

  // 52-week
  const { hi52, lo52 } = compute52w(rows);
  $("hi52").textContent = hi52 != null ? `$${money(hi52)}` : "—";
  $("lo52").textContent = lo52 != null ? `$${money(lo52)}` : "—";

  const rangePct = (price != null && hi52 != null && lo52 != null)
    ? (price - lo52) / (hi52 - lo52)
    : null;

  $("range").textContent = rangePct != null ? `${(rangePct*100).toFixed(0)}% of 52W` : "—";
  $("trend").textContent = trendLabel(rows);

  // Sparkline (last 60 closes)
  const closes60 = rows.slice(-60).map(r => r.close);
  $("sparkPath").setAttribute("d", sparkPath(closes60));
  $("sparkMeta").textContent = closes60.length ? `Spark: last ${closes60.length} closes` : "";

  $("note").textContent = "Tip: type a ticker and press Load. Click ★ Save to add to Favorites.";
}

async function loadTicker(raw){
  const ticker = normalizeTicker(raw);
  if (!ticker){
    setMsg("Type a ticker first.");
    return;
  }

  setMsg("Loading…");
  try{
    const rows = await fetchStooqHistory(ticker);
    if (!rows.length) throw new Error("No rows");

    // quick sanity check: last close not NaN
    if (rows[rows.length - 1]?.close == null) throw new Error("Bad data");

    render(rows, ticker);
    setMsg("");
    return ticker;
  } catch (e){
    console.error(e);
    setMsg("Couldn’t load that symbol. Try a different ticker (ex: AAPL, TSLA, SPY).");
    return null;
  }
}

function setup(){
  const watchlist = loadWatchlist();
  ensureWatchSelect(watchlist);

  $("time").textContent = `Updated: ${fmtTime()}`;

  $("loadBtn").addEventListener("click", async () => {
    const t = $("tickerInput").value;
    await loadTicker(t);
  });

  $("tickerInput").addEventListener("keydown", async (e) => {
    if (e.key === "Enter"){
      await loadTicker($("tickerInput").value);
    }
  });

  $("watchSelect").addEventListener("change", async () => {
    const t = $("watchSelect").value;
    if (t) await loadTicker(t);
  });

  $("saveBtn").addEventListener("click", () => {
    const current = ($("symbol").textContent || "").trim();
    if (!current || current === "—"){
      setMsg("Load a ticker first, then save it.");
      return;
    }
    // convert displayed "AAPL" back to normalized "aapl.us"
    const normalized = normalizeTicker(current);
    if (!normalized) return;

    const list = loadWatchlist();
    if (!list.includes(normalized)){
      list.unshift(normalized);
      saveWatchlist(list);
      ensureWatchSelect(list);
      setMsg(`Saved ${current} to Favorites.`);
      setTimeout(()=>setMsg(""), 1200);
    } else {
      setMsg(`${current} is already in Favorites.`);
      setTimeout(()=>setMsg(""), 1200);
    }
  });

  $("removeBtn").addEventListener("click", () => {
    const selected = $("watchSelect").value;
    if (!selected){
      setMsg("Select a favorite to remove.");
      return;
    }
    const list = loadWatchlist().filter(x => x !== selected);
    saveWatchlist(list);
    ensureWatchSelect(list);
    setMsg(`Removed ${displayTicker(selected)}.`);
    setTimeout(()=>setMsg(""), 1200);
  });

  // Initial load
  const fromUrl = new URL(window.location.href).searchParams.get("t");
  loadTicker(fromUrl || DEFAULT_TICKER);
}

setup();
