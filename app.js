// Notion Stock Widget
// Prices/History: Stooq (no key)
// Autocomplete + Sector/Industry: Financial Modeling Prep (FMP) (needs key)
//
// Key change: Use direct fetch for FMP, and if CORS blocks it,
// fall back to AllOrigins RAW proxy (CORS-friendly).
// AllOrigins RAW: https://api.allorigins.win/raw?url=ENCODED_URL

const STORAGE_WATCH = "nsw_watchlist_v1";
const STORAGE_KEY   = "nsw_fmp_key_v1";

const DEFAULT_TICKER = "AAPL";

function $(id){ return document.getElementById(id); }

function fmtTime(){
  const d = new Date();
  return d.toLocaleString(undefined, { weekday:"short", hour:"numeric", minute:"2-digit" });
}

function setMsg(text){
  const el = $("msg");
  if (!el) return;
  if (!text){ el.hidden = true; el.textContent = ""; return; }
  el.hidden = false;
  el.textContent = text;
}

function normalizeTicker(input){
  let t = (input ?? "").trim();
  if (!t) return null;
  t = t.replace(/\s+/g, "");
  if (t.includes(".")) return t.toLowerCase();
  return `${t.toLowerCase()}.us`;
}

function displayTicker(stooqTicker){
  const base = (stooqTicker.split(".")[0] ?? stooqTicker).toUpperCase();
  return base;
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

function getFmpKey(){
  return (localStorage.getItem(STORAGE_KEY) ?? "").trim();
}

function setFmpKey(key){
  localStorage.setItem(STORAGE_KEY, (key ?? "").trim());
}

function clearFmpKey(){
  localStorage.removeItem(STORAGE_KEY);
}

function ensureWatchSelect(list){
  const sel = $("watchSelect");
  if (!sel) return;

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
    d += (i === 0 ? `M ${x.toFixed(2)} ${y.toFixed(2)}` : ` L ${x.toFixed(2)} ${y.toFixed(2)}`);
  });
  return d;
}

/* -----------------------------
   CORS-safe JSON fetch
-------------------------------- */

async function fetchJsonCORS(url){
  // Try direct first (best/fastest if CORS allows)
  try{
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e1){
    // Fallback: AllOrigins RAW proxy (CORS-friendly)
    // Docs/examples: https://api.allorigins.win/raw?url=... :contentReference[oaicite:1]{index=1}
    const proxied = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
    const res2 = await fetch(proxied, { cache: "no-store" });
    if (!res2.ok) throw new Error(`AllOrigins HTTP ${res2.status}`);
    const text = await res2.text();
    // JSON parse
    return JSON.parse(text);
  }
}

/* -----------------------------
   Stooq (CSV) history
-------------------------------- */

async function fetchStooqHistory(stooqTicker){
  const stooq = `https://stooq.com/q/d/l/?s=${encodeURIComponent(stooqTicker)}&i=d`;

  // Stooq may also be CORS-blocked; use AllOrigins RAW to keep it consistent.
  const proxied = `https://api.allorigins.win/raw?url=${encodeURIComponent(stooq)}`;
  const res = await fetch(proxied, { cache: "no-store" });
  if (!res.ok) throw new Error(`Stooq HTTP ${res.status}`);

  const text = await res.text();
  const idx = text.indexOf("Date,Open,High,Low,Close,Volume");
  if (idx === -1) throw new Error("No CSV data (invalid ticker?)");
  const csv = text.slice(idx).trim();

  return parseCSV(csv);
}

function compute52w(rows){
  const slice = rows.slice(-252);
  if (!slice.length) return { hi52: null, lo52: null };
  const highs = slice.map(r => r.high);
  const lows  = slice.map(r => r.low);
  return { hi52: Math.max(...highs), lo52: Math.min(...lows) };
}

function trendLabel(rows){
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

/* -----------------------------
   FMP: search + profile
   Endpoints:
   - https://financialmodelingprep.com/stable/search-name?query=...&apikey=...
   - https://financialmodelingprep.com/stable/profile?symbol=AAPL&apikey=...
   Docs: :contentReference[oaicite:2]{index=2}
-------------------------------- */

async function fmpSearch(query){
  const key = getFmpKey();
  if (!key) return [];

  const url =
    `https://financialmodelingprep.com/stable/search-name?query=${encodeURIComponent(query)}&apikey=${encodeURIComponent(key)}`;

  const data = await fetchJsonCORS(url);
  if (!Array.isArray(data)) return [];

  // Keep list tight and usable in Notion
  return data
    .filter(x => x && x.symbol && x.name)
    .slice(0, 10);
}

async function fmpProfile(symbol){
  const key = getFmpKey();
  if (!key) return null;

  const url =
    `https://financialmodelingprep.com/stable/profile?symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(key)}`;

  const data = await fetchJsonCORS(url);
  if (!Array.isArray(data) || !data.length) return null;
  return data[0];
}

/* -----------------------------
   UI helpers: sector/industry pills
-------------------------------- */

function setMetaPills(sector, industry){
  const sP = $("sectorPill");
  const iP = $("industryPill");

  if (sP){
    if (sector){ sP.textContent = sector; sP.hidden = false; }
    else sP.hidden = true;
  }

  if (iP){
    if (industry){ iP.textContent = industry; iP.hidden = false; }
    else iP.hidden = true;
  }
}

/* -----------------------------
   Render
-------------------------------- */

function render(rows, stooqTicker, profile){
  const last = rows[rows.length - 1];
  const prev = rows[rows.length - 2] ?? null;

  const symbolShown = displayTicker(stooqTicker);

  $("symbol").textContent = symbolShown;
  $("name").textContent = profile?.companyName ? profile.companyName : "";
  $("time").textContent = `Updated: ${fmtTime()} • Last data: ${last?.date ?? "—"}`;

  const sector = profile?.sector ?? "";
  const industry = profile?.industry ?? "";

  $("sector").textContent = sector || "—";
  $("industry").textContent = industry || "—";
  setMetaPills(sector, industry);

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

  // Sparkline
  const closes60 = rows.slice(-60).map(r => r.close);
  $("sparkPath").setAttribute("d", sparkPath(closes60));
  $("sparkMeta").textContent = closes60.length ? `Spark: last ${closes60.length} closes` : "";

  if (!getFmpKey()){
    $("note").textContent = "Add your FMP API key in Settings to enable autocomplete + sector/industry. Prices still work without it.";
  } else {
    $("note").textContent = "Type a ticker or company name and pick from the dropdown. Click ★ Save to add to Favorites.";
  }
}

/* -----------------------------
   Load ticker
-------------------------------- */

async function loadTicker(userInput){
  const raw = (userInput ?? "").trim();
  if (!raw){
    setMsg("Type a ticker (AAPL) or search a company name.");
    return null;
  }

  const hasKey = !!getFmpKey();

  // If user typed a company name and we have a key, resolve to the first match
  const looksLikeTicker = /^[A-Za-z.\-]{1,8}$/.test(raw);

  let symbolForProfile = raw.split(".")[0].toUpperCase();
  let stooqTicker = normalizeTicker(symbolForProfile);

  if (!looksLikeTicker && hasKey){
    setMsg("Searching…");
    try{
      const results = await fmpSearch(raw);
      if (!results.length){
        setMsg("No matches. Try a ticker (AAPL, TSLA, SPY).");
        return null;
      }
      symbolForProfile = String(results[0].symbol || "").toUpperCase();
      stooqTicker = normalizeTicker(symbolForProfile);
    } catch (e){
      console.error(e);
      setMsg("Search failed. Check API key or try a ticker.");
      return null;
    }
  }

  if (!stooqTicker){
    setMsg("Invalid symbol.");
    return null;
  }

  setMsg("Loading…");

  try{
    const profile = hasKey ? await fmpProfile(symbolForProfile) : null;
    const rows = await fetchStooqHistory(stooqTicker);
    if (!rows.length) throw new Error("No rows");
    render(rows, stooqTicker, profile);
    setMsg("");
    return stooqTicker;
  } catch (e){
    console.error(e);
    setMsg("Couldn’t load that symbol. Try a different ticker (AAPL, TSLA, SPY).");
    return null;
  }
}

/* -----------------------------
   Autocomplete UI
-------------------------------- */

function setupAutocomplete(){
  const input = $("tickerInput");
  const box = $("suggestions");

  if (!input || !box) return;

  let debounceTimer = null;

  function hide(){
    box.hidden = true;
    box.innerHTML = "";
  }

  function show(items, query){
    box.innerHTML = "";

    if (!getFmpKey()){
      const empty = document.createElement("div");
      empty.className = "suggestion";
      empty.style.cursor = "default";
      empty.innerHTML = `<div>
        <div>Autocomplete needs an FMP key</div>
        <div class="sub">Open Settings → paste key → Save</div>
      </div><div class="right">—</div>`;
      box.appendChild(empty);
      box.hidden = false;
      return;
    }

    if (!items || items.length === 0){
      const empty = document.createElement("div");
      empty.className = "suggestion";
      empty.style.cursor = "default";
      empty.innerHTML = `<div>
        <div>No matches for “${query}”</div>
        <div class="sub">Try a ticker (AAPL) or a different name</div>
      </div><div class="right">—</div>`;
      box.appendChild(empty);
      box.hidden = false;
      return;
    }

    items.forEach((r) => {
      const div = document.createElement("div");
      div.className = "suggestion";
      const sym = String(r.symbol || "").toUpperCase();
      const nm  = String(r.name || "");
      const exch = (r.exchangeShortName || r.exchange || "").toString();

      div.innerHTML = `<div>
        <div><strong>${sym}</strong> — ${nm}</div>
        <div class="sub">${exch}</div>
      </div><div class="right">Select</div>`;

      div.addEventListener("click", async () => {
        input.value = sym;
        hide();
        await loadTicker(sym);
      });

      box.appendChild(div);
    });

    box.hidden = false;
  }

  input.addEventListener("input", () => {
    const q = input.value.trim();
    if (debounceTimer) clearTimeout(debounceTimer);

    if (q.length < 2) { hide(); return; }

    debounceTimer = setTimeout(async () => {
      try{
        const results = getFmpKey() ? await fmpSearch(q) : [];
        show(results, q);
      } catch (e){
        console.error(e);
        show([], q);
      }
    }, 250);
  });

  input.addEventListener("keydown", async (e) => {
    if (e.key === "Escape") hide();
    if (e.key === "Enter"){
      hide();
      await loadTicker(input.value);
    }
  });

  document.addEventListener("click", (e) => {
    const wrap = e.target.closest(".inputWrap");
    if (!wrap) hide();
  });
}

/* -----------------------------
   Setup
-------------------------------- */

function setup(){
  const watchlist = loadWatchlist();
  ensureWatchSelect(watchlist);

  $("time").textContent = `Updated: ${fmtTime()}`;
  $("apiKeyInput").value = getFmpKey();

  setupAutocomplete();

  $("loadBtn").addEventListener("click", async () => {
    await loadTicker($("tickerInput").value);
  });

  $("watchSelect").addEventListener("change", async () => {
    const t = $("watchSelect").value;
    if (t) await loadTicker(displayTicker(t));
  });

  $("saveBtn").addEventListener("click", () => {
    const currentShown = ($("symbol").textContent || "").trim();
    if (!currentShown || currentShown === "—"){
      setMsg("Load a ticker first, then save it.");
      return;
    }
    const normalized = normalizeTicker(currentShown);
    if (!normalized) return;

    const list = loadWatchlist();
    if (!list.includes(normalized)){
      list.unshift(normalized);
      saveWatchlist(list);
      ensureWatchSelect(list);
      setMsg(`Saved ${currentShown} to Favorites.`);
      setTimeout(()=>setMsg(""), 1200);
    } else {
      setMsg(`${currentShown} is already in Favorites.`);
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

  $("saveKeyBtn").addEventListener("click", () => {
    const k = $("apiKeyInput").value.trim();
    if (!k){
      setMsg("Paste your FMP key first.");
      return;
    }
    setFmpKey(k);
    setMsg("Saved API key. Autocomplete + industry enabled.");
    setTimeout(()=>setMsg(""), 1200);
  });

  $("clearKeyBtn").addEventListener("click", () => {
    clearFmpKey();
    $("apiKeyInput").value = "";
    setMsg("Cleared API key.");
    setTimeout(()=>setMsg(""), 1200);
  });

  const fromUrl = new URL(window.location.href).searchParams.get("t");
  loadTicker(fromUrl || DEFAULT_TICKER);
}

setup();
