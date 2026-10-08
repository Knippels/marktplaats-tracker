"use strict";

const state = { index: null, cache: {}, chart: null, current: null };
const fmtEur = new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const fmtEur2 = new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const fmtDay = new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "short" });

// --- per-bezoeker "laatst bekeken" (alleen in deze browser) ---
function storeGet(key) { try { return localStorage.getItem(key); } catch { return null; } }
function storeSet(key, val) { try { localStorage.setItem(key, val); } catch { /* geen opslag */ } }

function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k === "style") n.setAttribute("style", v);
    else if (v !== undefined && v !== null && v !== false) n.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) n.append(c);
  return n;
}

function metricLabel(cat) { return cat.metric === "price_per_tb" ? "€/TB" : "prijs"; }
function fmtMetric(cat, v) {
  if (v === null || v === undefined) return "–";
  return cat.metric === "price_per_tb" ? fmtEur2.format(v) + "/TB" : fmtEur.format(v);
}
function fmtPrice(item) {
  if (item.price === null || item.price === undefined) {
    return { FAST_BID: "Bieden", SEE_DESCRIPTION: "Zie omschrijving", FREE: "Gratis", EXCHANGE: "Ruilen", RESERVED: "Gereserveerd" }[item.price_type] || "–";
  }
  return (item.price_type === "MIN_BID" ? "vanaf " : "") + fmtEur.format(item.price);
}
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

async function getJSON(url) {
  const r = await fetch(url, { cache: "no-cache" });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}

async function init() {
  try {
    state.index = await getJSON("data/index.json");
  } catch {
    document.getElementById("main").innerHTML = '<p class="muted">Nog geen gegevens. De eerste run van de scraper vult deze pagina.</p>';
    document.getElementById("updated").textContent = "";
    return;
  }
  document.getElementById("updated").textContent = "Bijgewerkt " + fmtDate.format(new Date(state.index.updated));
  renderTabs();
  setupSync();
  window.addEventListener("hashchange", () => show(location.hash.slice(1)));
  show(location.hash.slice(1));
  UserState.sync();
}

function setupSync() {
  const btn = document.getElementById("sync-btn");
  const dlg = document.getElementById("sync-dlg");
  const tok = document.getElementById("tok");
  const stat = document.getElementById("sync-status");
  const labels = { lokaal: "lokaal", laden: "synchroniseren…", ok: "gesynchroniseerd", "alleen-lezen": "alleen lokaal", fout: "sync-fout" };
  const paint = () => {
    const st = UserState.status();
    btn.textContent = `● ${labels[st.status] || st.status}`;
    btn.dataset.status = st.status;
    btn.title = st.statusMsg || "Synchronisatie van gezien/favorieten";
    stat.textContent = (st.hasToken ? "Token ingesteld. " : "Geen token ingesteld. ") + (st.statusMsg || "");
  };
  UserState.onChange(paint);
  paint();
  btn.addEventListener("click", () => { tok.value = ""; paint(); dlg.showModal(); });
  document.getElementById("tok-save").addEventListener("click", () => { if (tok.value.trim()) UserState.setToken(tok.value); dlg.close(); });
  document.getElementById("tok-clear").addEventListener("click", () => { UserState.setToken(null); paint(); });
}

function renderTabs() {
  const tabs = document.getElementById("tabs");
  tabs.replaceChildren(...state.index.categories.map((c) =>
    el("button", { class: "tab", role: "tab", "data-id": c.id, "aria-selected": "false" },
      c.name, c.new ? el("span", { class: "badge new", title: "nieuw" }, String(c.new)) : null)));
  tabs.addEventListener("click", (e) => {
    const b = e.target.closest(".tab");
    if (b) location.hash = b.dataset.id;
  });
}

async function show(id) {
  const cats = state.index.categories;
  if (!cats.length) return;
  if (!cats.some((c) => c.id === id)) id = cats[0].id;
  state.current = id;
  for (const b of document.querySelectorAll(".tab")) b.setAttribute("aria-selected", String(b.dataset.id === id));
  if (!state.cache[id]) state.cache[id] = await getJSON(`data/${id}.json`);
  if (state.current !== id) return;
  renderCategory(state.cache[id]);
}

const hideReservedPref = () => storeGet("hideReserved") !== "0";

function renderCategory(cat) {
  const main = document.getElementById("main");
  main.replaceChildren(document.getElementById("cat-tpl").content.cloneNode(true));

  const visitKey = `lastVisit:${cat.id}`;
  const lastVisit = storeGet(visitKey);
  storeSet(visitKey, cat.updated);
  const isUnseen = (it) => Boolean(lastVisit && it.first_seen > lastVisit);

  const windowH = state.index.new_window_hours || 48;
  const cutoff = new Date(new Date(cat.updated).getTime() - windowH * 3600e3).toISOString().replace(".000", "");
  const items = Object.entries(cat.listings).map(([id, v]) => ({ id, ...v, isNew: v.active && v.first_seen >= cutoff }));
  const active = items.filter((i) => i.active);
  const fresh = active.filter((i) => i.isNew).sort((a, b) => b.first_seen.localeCompare(a.first_seen));
  const deals = active.filter((i) => i.deal).sort((a, b) => a.metric - b.metric);
  const vals = active.map((i) => i.metric).filter((v) => v !== null && v !== undefined).sort((a, b) => a - b);
  const median = vals.length ? (vals.length % 2 ? vals[(vals.length - 1) / 2] : (vals[vals.length / 2 - 1] + vals[vals.length / 2]) / 2) : null;

  main.querySelector(".kpis").replaceChildren(
    kpi("Actief", active.length),
    kpi(`Nieuw (${windowH} u)`, fresh.length),
    kpi("Deals", deals.length),
    kpi(`Mediaan ${metricLabel(cat)}`, fmtMetric(cat, median)),
    kpi(`Laagste ${metricLabel(cat)}`, fmtMetric(cat, vals[0])),
  );
  main.querySelector(".new-h").textContent = `nieuw (${windowH} u)`;
  main.querySelector(".n-deal").textContent = deals.length;
  main.querySelector(".n-new").textContent = fresh.length;
  main.querySelector(".deal-rule").textContent = cat.deal_threshold === null ? "" :
    `deal = ${metricLabel(cat)} ≤ ${fmtMetric(cat, cat.deal_threshold)} (${cat.deal_rule})`;
  if (cat.kind !== "hdd") main.querySelector(".hdd-only").remove();
  if (!cat.nas_score) main.querySelector(".nas-only").remove();
  main.querySelector(".new-hint").textContent = `afgelopen ${windowH} uur`;

  const hideRes = main.querySelector(".hide-reserved");
  hideRes.checked = hideReservedPref();
  const nRes = active.filter((i) => i.reserved).length;
  main.querySelector(".n-res").textContent = nRes ? `(${nRes})` : "";
  const hideSeenPref = () => storeGet("hideSeen") === "1";
  const visible = (list) => list
    .filter((i) => !hideRes.checked || !i.reserved || UserState.isFav(i.id))
    .filter((i) => !hideSeenPref() || !UserState.isSeen(i.id) || UserState.isFav(i.id));
  const drawCards = () => {
    fillCards(main.querySelector(".cards.deals"), visible(deals), cat, isUnseen, "Geen aanbiedingen onder de grens op dit moment.");
    fillCards(main.querySelector(".cards.new"), visible(fresh), cat, isUnseen, "Niets nieuws in deze periode.");
  };
  hideRes.addEventListener("change", () => { storeSet("hideReserved", hideRes.checked ? "1" : "0"); drawCards(); });
  for (const box of main.querySelectorAll(".cards")) {
    box.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-act]");
      if (b) UserState.toggleFav(b.dataset.id);
    });
  }
  UserState.onChange(() => { if (document.body.contains(main.querySelector(".cards"))) drawCards(); });

  renderTable(main, cat, items, isUnseen, drawCards);
  renderChart(main, cat);
  drawCards();
}

function kpi(label, value) {
  return el("div", { class: "kpi" }, el("div", { class: "label" }, label), el("div", { class: "value" }, String(value)));
}

function fillCards(box, list, cat, isUnseen, emptyText) {
  if (!list.length) { box.replaceChildren(el("p", { class: "empty" }, emptyText)); return; }
  box.replaceChildren(...list.slice(0, 12).map((it) => {
    const showMetric = cat.metric !== "price" && it.metric !== null && it.metric !== undefined;
    const fav = UserState.isFav(it.id);
    return el("div", { class: "card-wrap" + (UserState.isSeen(it.id) ? " is-seen" : "") },
      el("button", { type: "button", class: "icon-btn card-fav" + (fav ? " on" : ""), "data-act": "fav", "data-id": it.id,
        "aria-pressed": String(fav), title: fav ? "Uit favorieten" : "Favoriet maken" }, fav ? "★" : "☆"),
      el("a", { class: "card ad-link" + (isUnseen(it) ? " unseen" : ""), href: it.url, target: "_blank", rel: "noopener", "data-id": it.id },
      el("div", { class: "img", style: it.image ? `background-image:url('${encodeURI(it.image)}')` : "" }),
      el("div", { class: "body" },
        el("div", { class: "badges" },
          isUnseen(it) ? el("span", { class: "badge new" }, "nieuw") : null,
          it.deal ? el("span", { class: "badge deal" }, "deal") : null,
          it.price_drop ? el("span", { class: "badge drop" }, "prijs verlaagd") : null,
          it.reserved ? el("span", { class: "badge gone" }, "gereserveerd") : null),
        el("div", { class: "title", title: it.title }, it.title),
        el("div", { class: "price" }, cat.kind === "hdd" && it.qty > 1 && it.price_each != null ? `${it.qty}× ${fmtEur.format(it.price_each)}` : fmtPrice(it), showMetric ? el("span", { class: "metric" }, fmtMetric(cat, it.metric)) : null),
        el("div", { class: "meta" }, [it.city, "online sinds " + fmtDate.format(new Date(it.first_seen)), UserState.isSeen(it.id) ? "gezien" : null].filter(Boolean).join(" · ")))));
  }));
}

function renderChart(main, cat) {
  const hist = cat.history || [];
  const canvas = main.querySelector("canvas");
  main.querySelector(".chart-hint").textContent = `${metricLabel(cat)} van actieve advertenties per dag`;
  if (state.chart) { state.chart.destroy(); state.chart = null; }
  if (hist.length < 2) {
    main.querySelector(".chart-box").hidden = true;
    main.querySelector(".chart-empty").hidden = false;
    if (!hist.length) return;
  }
  if (hist.length < 2) return;
  const labels = hist.map((h) => fmtDay.format(new Date(h.date)));
  const series = [
    { key: "median", label: "Mediaan", color: css("--series-1") },
    { key: "p25", label: "Goedkoopste 25%", color: css("--series-3") },
    { key: "min", label: "Laagste", color: css("--series-2") },
  ];
  const datasets = series.map((s) => ({
    label: s.label, data: hist.map((h) => h[s.key]), borderColor: s.color, backgroundColor: s.color,
    borderWidth: 2, pointRadius: hist.length > 40 ? 0 : 3, pointHoverRadius: 5, tension: 0.25,
  }));
  if (cat.deal_threshold !== null && cat.deal_rule === "vast") {
    datasets.push({ label: "Deal-grens", data: hist.map(() => cat.deal_threshold), borderColor: css("--muted"),
      borderDash: [5, 4], borderWidth: 1.5, pointRadius: 0, pointHoverRadius: 0 });
  }
  state.chart = new Chart(canvas, {
    type: "line",
    data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { position: "top", align: "start", labels: { color: css("--text-2"), boxWidth: 12, boxHeight: 2 } },
        tooltip: {
          callbacks: {
            label: (c) => ` ${c.dataset.label}: ${fmtMetric(cat, c.parsed.y)}`,
            afterBody: (items) => `Actieve advertenties: ${hist[items[0].dataIndex].count}`,
          },
        },
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: css("--muted"), maxRotation: 0, autoSkipPadding: 16 } },
        y: { grid: { color: css("--grid") }, border: { display: false },
             ticks: { color: css("--muted"), callback: (v) => fmtMetric(cat, v) } },
      },
    },
  });
}

const dash = "–";
const num = (v, unit = "") => (v === null || v === undefined ? dash : `${String(v).replace(".", ",")}${unit}`);

function priceEachCell(i) {
  if (i.price_each === null || i.price_each === undefined) return fmtPrice(i);
  const est = i.per_piece === "geschat";
  return el("span", { title: i.qty > 1 ? `Vraagprijs in advertentie: ${fmtPrice(i)}` + (est ? " — prijs per stuk geschat" : i.per_piece ? " — prijs per stuk vermeld" : " — totaalprijs gedeeld door aantal") : null },
    (est ? "≈ " : "") + fmtEur.format(i.price_each));
}

function columnsFor(cat) {
  const common = {
    title: { label: "Advertentie", sort: (i) => i.title, cell: null },
    brand: { label: "Merk", sort: (i) => i.brand, cell: (i) => i.brand || dash },
    type: { label: "Type", sort: (i) => i.type, cell: (i) => i.type || dash },
    city: { label: "Plaats", sort: (i) => i.city, cell: (i) => i.city || dash },
    seen: { label: "Online sinds", sort: (i) => i.first_seen, cell: (i) => fmtDate.format(new Date(i.first_seen)) },
  };
  if (cat.kind === "hdd") {
    return [common.title, common.brand, common.type,
      { label: "Grootte", num: true, sort: (i) => i.size_tb, cell: (i) => num(i.size_tb, " TB") },
      { label: "Aantal", num: true, sort: (i) => i.qty, cell: (i) => (i.sold_separately ? el("span", { title: "Meerdere beschikbaar, los te koop" }, `${i.qty} (los)`) : num(i.qty)) },
      { label: "Prijs/stuk", num: true, sort: (i) => i.price_each, cell: priceEachCell },
      { label: "Totaal", num: true, sort: (i) => i.price_total, cell: (i) => (i.price_total == null ? (i.price_each == null ? dash : (i.sold_separately ? "los" : dash)) : fmtEur.format(i.price_total)) },
      { label: "€/TB", num: true, key: "metric", sort: (i) => i.metric, cell: (i) => (i.metric == null ? dash : fmtEur2.format(i.metric)) },
      common.city, common.seen];
  }
  const nas = cat.nas_score ? [
    { label: "Score", num: true, key: "score", sort: (i) => i.score, cell: scoreCell },
    { label: "OMV", sort: (i) => ({ ja: 2, omweg: 1, nee: 0 }[i.omv] ?? -1), cell: omvCell },
    { label: "CPU · RAM", sort: (i) => i.ram_gb, cell: (i) => (i.nas_model ? el("span", { class: "cpu" }, shortCpu(i.cpu), el("span", { class: "sub-num" }, fmtGb(i.ram_gb) + (i.ram_stated ? " (vermeld)" : ""))) : dash) },
  ] : [];
  return [common.title, common.brand, common.type, ...nas,
    { label: "Bays", num: true, sort: (i) => i.bays, cell: (i) => num(i.bays) },
    { label: "Aansluitingen", sort: (i) => (i.connections || []).join(" "), cell: (i) => ((i.connections || []).length ? el("span", { class: "conns" }, ...i.connections.map((c) => el("span", { class: "conn" }, c))) : dash) },
    { label: "Meegeleverde opslag", sort: (i) => i.storage_tb, cell: (i) => (i.storage ? el("span", { class: i.storage === "Geen" ? "muted" : "" }, i.storage) : el("span", { class: "muted", title: "Niet vermeld in de advertentie (of niet herkend)" }, "niet vermeld")) },
    { label: "Prijs", num: true, key: "metric", sort: (i) => i.price, cell: (i) => el("span", {}, fmtPrice(i), i.highest_bid ? el("span", { class: "sub-num", title: "Hoogste bod" }, ` bod ${fmtEur.format(i.highest_bid)}`) : null) },
    common.city, common.seen];
}

function fmtGb(gb) { return gb == null ? dash : gb >= 1 ? `${String(gb).replace(".", ",")} GB RAM` : `${Math.round(gb * 1024)} MB RAM`; }
function shortCpu(cpu) { return (cpu || "").replace(/^(Intel|AMD|Marvell|Annapurna Labs|Realtek|Freescale|Mindspeed)\s+/, "").replace(/\s+\d+(\.\d+)?GHz$/, ""); }

function scoreCell(i) {
  if (i.score == null) return el("span", { class: "muted", title: "Model niet herkend of niet in de modellenlijst" }, dash);
  const cls = i.score >= 7 ? "good" : i.score >= 4 ? "mid" : "low";
  return el("span", { class: `score ${cls}`, title: (i.score_why || []).join("\n") }, i.score.toFixed(1).replace(".", ","));
}

function omvCell(i) {
  if (!i.omv) return el("span", { class: "muted", title: "Model niet herkend" }, dash);
  const map = { ja: ["✓", "omv-yes"], omweg: ["~", "omv-maybe"], nee: ["✗", "omv-no"] };
  const [sym, cls] = map[i.omv];
  return el("span", { class: `omv ${cls}`, title: i.omv_why || "", "aria-label": `OMV: ${i.omv}` }, sym);
}

function renderTable(main, cat, items, isUnseen, onFilterChange = () => {}) {
  const tbody = main.querySelector("tbody");
  const headRow = main.querySelector("thead tr");
  const filter = main.querySelector(".filter");
  const showGone = main.querySelector(".show-gone");
  const hideRes = main.querySelector(".hide-reserved");
  const hideSeen = main.querySelector(".hide-seen");
  const nFav = main.querySelector(".n-fav");
  const nSeen = main.querySelector(".n-seen");
  const chips = main.querySelectorAll(".chip");
  hideSeen.checked = storeGet("hideSeen") === "1";
  let shown = [];
  const cols = columnsFor(cat);
  const scoreIdx = cols.findIndex((c) => c.key === "score");
  const metricIdx = cols.findIndex((c) => c.key === "metric");
  let sort = scoreIdx >= 0 ? { idx: scoreIdx, asc: false } : { idx: metricIdx, asc: true };
  let only = "all";

  headRow.replaceChildren(el("th", { class: "act-col", "aria-label": "Acties" }),
    ...cols.map((c, idx) => el("th", { class: c.num ? "num" : "", "data-idx": idx }, c.label)));

  function actionCell(i) {
    const fav = UserState.isFav(i.id), seen = UserState.isSeen(i.id);
    return el("td", { class: "act-col" },
      el("button", { type: "button", class: "icon-btn fav-btn" + (fav ? " on" : ""), "data-act": "fav", "data-id": i.id,
        "aria-pressed": String(fav), title: fav ? "Uit favorieten" : "Favoriet maken" }, fav ? "★" : "☆"),
      el("button", { type: "button", class: "icon-btn seen-btn" + (seen ? " on" : ""), "data-act": "seen", "data-id": i.id,
        "aria-pressed": String(seen), title: seen ? "Markeer als niet gezien" : "Markeer als gezien" }, "✓"));
  }

  function titleCell(i) {
    return el("td", { class: "title-cell" },
      isUnseen(i) && i.active ? el("span", { class: "dot", title: "Nieuw sinds je laatste bezoek" }) : null,
      el("a", { href: i.url, target: "_blank", rel: "noopener", title: i.title, "data-id": i.id, class: "ad-link" }, i.title),
      el("span", { class: "row-badges" },
        i.deal ? el("span", { class: "badge deal" }, "deal") : null,
        i.isNew ? el("span", { class: "badge new" }, "nieuw") : null,
        i.price_drop ? el("span", { class: "badge drop", title: "Prijs verlaagd" }, "↓ prijs") : null,
        i.reserved ? el("span", { class: "badge gone" }, "gereserveerd") : null,
        i.active ? null : el("span", { class: "badge gone" }, "verdwenen")));
  }

  function draw() {
    const q = filter.value.trim().toLowerCase();
    const col = cols[sort.idx];
    nFav.textContent = items.filter((i) => UserState.isFav(i.id)).length || "";
    const nS = items.filter((i) => i.active && UserState.isSeen(i.id) && !UserState.isFav(i.id)).length;  // wat verborgen wordt
    nSeen.textContent = nS ? `(${nS})` : "";
    const rows = items
      .filter((i) => showGone.checked || i.active || (only === "fav" && UserState.isFav(i.id)))
      .filter((i) => !hideRes.checked || !i.reserved || UserState.isFav(i.id))
      .filter((i) => !hideSeen.checked || !UserState.isSeen(i.id) || UserState.isFav(i.id))
      .filter((i) => only === "all" || (only === "deal" ? i.deal : only === "new" ? i.isNew : UserState.isFav(i.id)))
      .filter((i) => !q || `${i.title} ${i.brand || ""} ${i.type || ""} ${i.city || ""} ${i.cpu || ""} ${(i.connections || []).join(" ")}`.toLowerCase().includes(q))
      .sort((a, b) => {
        const av = col.sort(a), bv = col.sort(b);
        if (av === null || av === undefined) return 1;
        if (bv === null || bv === undefined) return -1;
        const r = typeof av === "number" ? av - bv : String(av).localeCompare(String(bv), "nl");
        return sort.asc ? r : -r;
      });
    shown = rows;
    tbody.replaceChildren(...rows.map((i) => {
      const cls = [i.active ? "" : "gone", i.reserved ? "reserved" : "", i.deal ? "is-deal" : "", i.isNew ? "is-new" : "",
        UserState.isSeen(i.id) ? "is-seen" : "", UserState.isFav(i.id) ? "is-fav" : ""].join(" ").trim();
      return el("tr", { class: cls }, actionCell(i), ...cols.map((c) => (c.cell === null ? titleCell(i) : el("td", { class: c.num ? "num" : "" }, c.cell(i)))));
    }));
    if (!rows.length) tbody.replaceChildren(el("tr", {}, el("td", { colspan: cols.length + 1, class: "muted" }, only === "fav" ? "Nog geen favorieten. Klik op ☆ bij een advertentie." : "Geen advertenties.")));
    headRow.querySelectorAll("th[data-idx]").forEach((th) => {
      const idx = Number(th.dataset.idx);
      th.classList.toggle("sorted", idx === sort.idx);
      th.classList.toggle("asc", idx === sort.idx && sort.asc);
    });
  }
  headRow.addEventListener("click", (e) => {
    const th = e.target.closest("th[data-idx]");
    if (!th) return;
    const idx = Number(th.dataset.idx);
    sort = sort.idx === idx ? { idx, asc: !sort.asc } : { idx, asc: !["Online sinds", "Score", "OMV"].includes(cols[idx].label) };
    draw();
  });
  chips.forEach((b) => b.addEventListener("click", () => {
    only = b.dataset.only;
    chips.forEach((c) => c.setAttribute("aria-pressed", String(c === b)));
    draw();
  }));
  tbody.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-act]");
    if (b) b.dataset.act === "fav" ? UserState.toggleFav(b.dataset.id) : UserState.toggleSeen(b.dataset.id);
  });
  hideSeen.addEventListener("change", () => { storeSet("hideSeen", hideSeen.checked ? "1" : "0"); draw(); onFilterChange(); });
  filter.addEventListener("input", draw);
  showGone.addEventListener("change", draw);
  hideRes.addEventListener("change", draw);  // kaarten volgen via eigen listener
  UserState.onChange(() => { if (document.body.contains(tbody)) draw(); });
  draw();
}

init();
