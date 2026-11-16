"use strict";

const state = { index: null, categories: [], cache: {}, chart: null, current: null };

async function init() {
  try {
    state.index = await getJSON("data/index.json");
  } catch {
    document.getElementById("main").replaceChildren(el("p", { class: "muted" }, "Nog geen gegevens. De eerste run van de scraper vult deze pagina."));
    document.getElementById("updated").textContent = "";
    return;
  }
  document.getElementById("updated").textContent = "Bijgewerkt " + fmtDate.format(new Date(state.index.updated));
  refreshCategories();
  setupSync();
  document.getElementById("tabs").addEventListener("click", onTabClick);
  window.addEventListener("hashchange", () => show(location.hash.slice(1)));
  show(location.hash.slice(1));
  UserState.sync();
}

/* ---- synchronisatie-venster ---- */
function openSync() { document.getElementById("tok").value = ""; paintSync(); document.getElementById("sync-dlg").showModal(); }
const SYNC_LABELS = { lokaal: "alleen hier", laden: "bezig…", ok: "gesynchroniseerd", "alleen-lezen": "alleen hier", fout: "sync-fout" };
function paintSync() {
  const btn = document.getElementById("sync-btn");
  const st = UserState.status();
  btn.textContent = SYNC_LABELS[st.status] || st.status;
  btn.dataset.status = st.status;
  btn.title = st.statusMsg || "Synchronisatie van interessant en gezien";
  document.getElementById("sync-status").textContent = (st.hasToken ? "Token ingesteld. " : "Geen token ingesteld. ") + (st.statusMsg || "");
}
function setupSync() {
  const dlg = document.getElementById("sync-dlg");
  UserState.onChange(paintSync);
  paintSync();
  document.getElementById("sync-btn").addEventListener("click", openSync);
  document.getElementById("tok-save").addEventListener("click", () => { const v = document.getElementById("tok").value.trim(); if (v) UserState.setToken(v); dlg.close(); });
  document.getElementById("tok-clear").addEventListener("click", () => { UserState.setToken(null); paintSync(); });
  document.getElementById("manage-btn").addEventListener("click", manageTabs);
}

/* ---- tabbladen ---- */
function refreshCategories(selectId) {
  state.categories = ConfigEditor.overlay(state.index.categories);
  renderTabs();
  if (selectId) { location.hash = selectId; return; }
  show(state.current || location.hash.slice(1), true);
}
function renderTabs() {
  document.getElementById("tabs").replaceChildren(
    ...state.categories.map((c) => el("button", { class: "tab", role: "tab", "data-id": c.id, "aria-selected": String(c.id === state.current) },
      c.name, c.new ? el("span", { class: "badge new", title: "nieuw" }, String(c.new)) : null, c.pending ? el("span", { class: "badge", title: "wordt aangemaakt" }, "…") : null)),
    el("button", { class: "tab add", type: "button", "data-add": "1", title: "Nieuw tabblad", "aria-label": "Nieuw tabblad" }, icon("add", 16)));
}
function onTabClick(e) {
  if (e.target.closest("[data-add]")) { newTab(); return; }
  const b = e.target.closest(".tab[data-id]");
  if (b) location.hash = b.dataset.id;
}
const tabsChanged = (selectId) => refreshCategories(typeof selectId === "string" ? selectId : undefined);
function newTab() {
  if (!ConfigEditor.hasToken()) { manageTabs(); return; }
  ConfigEditor.openNew(state.categories, tabsChanged);
}
function manageTabs() {
  ConfigEditor.openManage({ categories: () => state.categories, onChange: tabsChanged, openSync });
}

async function show(id, force) {
  const cats = state.categories;
  if (!cats.length) return;
  if (!cats.some((c) => c.id === id)) id = cats[0].id;
  if (!force && state.current === id && document.querySelector(".cat-head")) return;
  state.current = id;
  for (const b of document.querySelectorAll(".tab[data-id]")) b.setAttribute("aria-selected", String(b.dataset.id === id));
  const meta = cats.find((c) => c.id === id);
  if (meta.pending) { renderPending(meta); return; }
  try {
    if (!state.cache[id]) state.cache[id] = await getJSON(`data/${id}.json`);
  } catch {
    if (state.current === id) document.getElementById("main").replaceChildren(el("p", { class: "muted" }, "De gegevens van dit tabblad konden niet worden geladen."));
    return;
  }
  if (state.current !== id) return;
  renderCategory(state.cache[id]);
}

function renderPending(meta) {
  document.getElementById("main").replaceChildren(el("section", { class: "block pending" },
    el("h2", {}, `"${meta.name}" wordt aangemaakt`),
    el("p", {}, "De scraper haalt nu voor het eerst advertenties op voor dit tabblad. Dat duurt meestal een paar minuten. Ververs de pagina straks."),
    el("button", { type: "button", class: "btn", onclick: () => location.reload() }, "Pagina verversen")));
}

/* ---- één tabblad ---- */
function median(vals) {
  if (!vals.length) return null;
  const s = [...vals].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
}

function renderCategory(cat) {
  const main = document.getElementById("main");
  const visitKey = `lastVisit:${cat.id}`;
  const lastVisit = storeGet(visitKey);
  storeSet(visitKey, cat.updated);
  const isUnseen = (it) => Boolean(lastVisit && it.first_seen > lastVisit);

  const windowH = state.index.new_window_hours || 48;
  const cutoff = new Date(new Date(cat.updated).getTime() - windowH * 3600e3).toISOString().replace(".000", "");
  const build = () => Object.entries(cat.listings).map(([id, v]) => Edit.apply(cat, { id, ...v, isNew: v.active && v.first_seen >= cutoff }));
  const items = build();
  const active = items.filter((i) => i.active);
  const fresh = active.filter((i) => i.isNew);
  const deals = active.filter((i) => i.deal);
  const vals = active.map((i) => i.metric).filter((v) => v !== null && v !== undefined).sort((a, b) => a - b);
  const med = median(vals);

  const kpis = el("section", { class: "kpis" },
    kpi("Actief", active.length), kpi(`Nieuw (${windowH} u)`, fresh.length), kpi("Deals", deals.length),
    cat.metric !== "price" || vals.length ? kpi(`Mediaan ${metricLabel(cat)}`, fmtMetric(cat, med)) : null,
    cat.metric !== "price" || vals.length ? kpi(`Laagste ${metricLabel(cat)}`, fmtMetric(cat, vals[0])) : null);

  const dealNote = cat.deal_threshold === null || cat.deal_threshold === undefined ? ""
    : `Deal = ${metricLabel(cat)} van ${fmtMetric(cat, cat.deal_threshold)} of lager (${cat.deal_rule}).`;
  const head = el("div", { class: "cat-head" },
    el("div", {}, el("h2", {}, cat.name), el("p", { class: "muted small" }, dealNote,
      cat.queries && cat.queries.length ? ` Zoekt op ${cat.queries.length} zoekopdracht${cat.queries.length > 1 ? "en" : ""}.` : "")),
    el("button", { type: "button", class: "btn", onclick: () => ConfigEditor.hasToken() ? ConfigEditor.edit(cat.id, () => state.categories, tabsChanged) : manageTabs() },
      btnLabel("edit", "Tabblad bewerken")));

  const tableHost = el("div", { class: "table-host" });
  const chartBlock = el("section", { class: "block" },
    el("div", { class: "block-head" }, el("h2", {}, "Prijsverloop"), el("span", { class: "hint" }, `${metricLabel(cat)} van actieve advertenties per dag`)),
    el("div", { class: "chart-box" }, el("canvas")),
    el("p", { class: "muted chart-empty", hidden: true }, "Nog niet genoeg historie. Na een paar dagen verschijnt hier de grafiek."));

  main.replaceChildren(head, kpis, el("section", { class: "block table-block" }, tableHost), chartBlock);
  DealTable.mount(tableHost, cat, items, { median: med, isUnseen, onViewChange: () => {}, rebuild: build, original: (id) => cat.listings[id] });
  renderChart(chartBlock, cat);
}

function kpi(label, value) {
  return el("div", { class: "kpi" }, el("div", { class: "label" }, label), el("div", { class: "value" }, String(value)));
}

function renderChart(block, cat) {
  const hist = cat.history || [];
  if (state.chart) { state.chart.destroy(); state.chart = null; }
  if (hist.length < 2) {
    block.querySelector(".chart-box").hidden = true;
    block.querySelector(".chart-empty").hidden = false;
    return;
  }
  if (typeof Chart === "undefined") { block.querySelector(".chart-box").hidden = true; return; }
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
  if (cat.deal_threshold !== null && cat.deal_threshold !== undefined && cat.deal_rule === "vast") {
    datasets.push({ label: "Deal-grens", data: hist.map(() => cat.deal_threshold), borderColor: css("--muted"),
      borderDash: [5, 4], borderWidth: 1.5, pointRadius: 0, pointHoverRadius: 0 });
  }
  state.chart = new Chart(block.querySelector("canvas"), {
    type: "line",
    data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { position: "top", align: "start", labels: { color: css("--text-2"), boxWidth: 12, boxHeight: 2 } },
        tooltip: { callbacks: {
          label: (c) => ` ${c.dataset.label}: ${fmtMetric(cat, c.parsed.y)}`,
          afterBody: (it) => `Actieve advertenties: ${hist[it[0].dataIndex].count}`,
        } },
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: css("--muted"), maxRotation: 0, autoSkipPadding: 16 } },
        y: { grid: { color: css("--grid") }, border: { display: false }, ticks: { color: css("--muted"), callback: (v) => fmtMetric(cat, v) } },
      },
    },
  });
}

init();
