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
  window.addEventListener("hashchange", () => show(location.hash.slice(1)));
  show(location.hash.slice(1));
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

function renderCategory(cat) {
  const main = document.getElementById("main");
  main.replaceChildren(document.getElementById("cat-tpl").content.cloneNode(true));

  const visitKey = `lastVisit:${cat.id}`;
  const lastVisit = storeGet(visitKey);
  storeSet(visitKey, cat.updated);
  const isUnseen = (it) => lastVisit && it.first_seen > lastVisit;

  const items = Object.entries(cat.listings).map(([id, v]) => ({ id, ...v }));
  const active = items.filter((i) => i.active);
  const windowH = state.index.new_window_hours || 48;
  const cutoff = new Date(new Date(cat.updated).getTime() - windowH * 3600e3).toISOString();
  const fresh = active.filter((i) => i.first_seen >= cutoff.replace(".000", ""))
    .sort((a, b) => b.first_seen.localeCompare(a.first_seen));
  const deals = active.filter((i) => i.deal).sort((a, b) => a.metric - b.metric);
  const vals = active.map((i) => i.metric).filter((v) => v !== null && v !== undefined).sort((a, b) => a - b);
  const median = vals.length ? (vals.length % 2 ? vals[(vals.length - 1) / 2] : (vals[vals.length / 2 - 1] + vals[vals.length / 2]) / 2) : null;

  // KPI's
  main.querySelector(".kpis").replaceChildren(
    kpi("Actief", active.length),
    kpi(`Nieuw (${windowH} u)`, fresh.length),
    kpi("Interessant", deals.length),
    kpi(`Mediaan ${metricLabel(cat)}`, fmtMetric(cat, median)),
    kpi(`Laagste ${metricLabel(cat)}`, fmtMetric(cat, vals[0])),
  );

  main.querySelector(".deal-rule").textContent = cat.deal_threshold === null ? "" :
    `${metricLabel(cat)} ≤ ${fmtMetric(cat, cat.deal_threshold)} (${cat.deal_rule})`;
  main.querySelector(".new-hint").textContent = `afgelopen ${windowH} uur` + (lastVisit ? " · blauwe rand = sinds je laatste bezoek" : "");

  fillCards(main.querySelector(".cards.deals"), deals, cat, isUnseen, "Geen aanbiedingen onder de grens op dit moment.");
  fillCards(main.querySelector(".cards.new"), fresh, cat, isUnseen, "Niets nieuws in deze periode.");
  renderChart(main, cat);
  renderTable(main, cat, items, isUnseen);
}

function kpi(label, value) {
  return el("div", { class: "kpi" }, el("div", { class: "label" }, label), el("div", { class: "value" }, String(value)));
}

function fillCards(box, list, cat, isUnseen, emptyText) {
  if (!list.length) { box.replaceWith(el("p", { class: "empty" }, emptyText)); return; }
  box.replaceChildren(...list.slice(0, 12).map((it) => {
    const showMetric = cat.metric !== "price" && it.metric !== null;
    return el("a", { class: "card" + (isUnseen(it) ? " unseen" : ""), href: it.url, target: "_blank", rel: "noopener" },
      el("div", { class: "img", style: it.image ? `background-image:url('${encodeURI(it.image)}')` : "" }),
      el("div", { class: "body" },
        el("div", { class: "badges" },
          isUnseen(it) ? el("span", { class: "badge new" }, "nieuw") : null,
          it.deal ? el("span", { class: "badge deal" }, "deal") : null,
          it.price_drop ? el("span", { class: "badge drop" }, "prijs verlaagd") : null),
        el("div", { class: "title", title: it.title }, it.title),
        el("div", { class: "price" }, fmtPrice(it), showMetric ? el("span", { class: "metric" }, fmtMetric(cat, it.metric)) : null),
        el("div", { class: "meta" }, [it.city, "gezien " + fmtDate.format(new Date(it.first_seen))].filter(Boolean).join(" · "))));
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

function renderTable(main, cat, items, isUnseen) {
  const tbody = main.querySelector("tbody");
  const filter = main.querySelector(".filter");
  const showGone = main.querySelector(".show-gone");
  const ths = main.querySelectorAll("th[data-sort]");
  if (cat.metric !== "price_per_tb") main.querySelectorAll(".metric-col").forEach((n) => n.remove());
  let sort = { key: cat.metric === "price_per_tb" ? "metric" : "price", asc: true };

  function draw() {
    const q = filter.value.trim().toLowerCase();
    const rows = items
      .filter((i) => showGone.checked || i.active)
      .filter((i) => !q || `${i.title} ${i.city || ""}`.toLowerCase().includes(q))
      .sort((a, b) => {
        const av = a[sort.key], bv = b[sort.key];
        if (av === null || av === undefined) return 1;
        if (bv === null || bv === undefined) return -1;
        const r = typeof av === "number" ? av - bv : String(av).localeCompare(String(bv), "nl");
        return sort.asc ? r : -r;
      });
    tbody.replaceChildren(...rows.map((i) => el("tr", { class: i.active ? "" : "gone" },
      el("td", {}, el("a", { href: i.url, target: "_blank", rel: "noopener" }, i.title),
        isUnseen(i) && i.active ? el("span", { class: "badge new" }, "nieuw") : null,
        i.deal ? el("span", { class: "badge deal" }, "deal") : null,
        i.price_drop ? el("span", { class: "badge drop" }, "↓") : null,
        i.active ? null : el("span", { class: "badge gone" }, "verdwenen")),
      el("td", { class: "num" }, fmtPrice(i)),
      cat.metric === "price_per_tb" ? el("td", { class: "num" }, fmtMetric(cat, i.metric)) : null,
      el("td", {}, i.city || "–"),
      el("td", {}, fmtDate.format(new Date(i.first_seen))))));
    if (!rows.length) tbody.replaceChildren(el("tr", {}, el("td", { colspan: 5, class: "muted" }, "Geen advertenties.")));
    for (const th of main.querySelectorAll("th[data-sort]")) {
      th.classList.toggle("sorted", th.dataset.sort === sort.key);
      th.classList.toggle("asc", th.dataset.sort === sort.key && sort.asc);
    }
  }
  for (const th of ths) th.addEventListener("click", () => {
    const k = th.dataset.sort;
    sort = sort.key === k ? { key: k, asc: !sort.asc } : { key: k, asc: k !== "first_seen" };
    draw();
  });
  filter.addEventListener("input", draw);
  showGone.addEventListener("change", draw);
  draw();
}

init();
