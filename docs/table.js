"use strict";
/*
 * De advertentietabel: schone rijen, uitklapbare details, filter per kolom, kolommen slepen en verbergen,
 * vergelijken, en kaartjes op een smal scherm.
 */
const DealTable = (() => {
  const NARROW = window.matchMedia("(max-width: 780px)");
  const dashNode = () => el("span", { class: "muted" }, dash);

  /* ---------------- kolomdefinities ---------------- */
  function genNum(i) {
    const m = /^(\d+)e gen/.exec(i.cpu_gen || "");
    return m ? Number(m[1]) : i.cpu_gen === "Alder Lake-N" ? 12 : null;
  }
  function expandRank(i) { return (i.pcie ? 4 : 0) + (i.oculink ? 3 : 0) + (i.tb_usb4 ? 2 : 0) + (i.nvme_slots || 0) + (i.bay25 ? 1 : 0); }
  function expandChips(i) {
    const c = [];
    if (i.pcie) c.push(["PCIe", "PCIe-uitbreidingsslot (low-profile, via riser): geschikt voor een netwerkkaart (2.5/10 GbE) of HBA; te weinig ruimte en stroom voor een normale videokaart"]);
    if (i.oculink) c.push(["OCuLink", "OCuLink-poort: externe videokaart via een dock mogelijk"]);
    if (i.tb_usb4) c.push(["TB/USB4", "Thunderbolt/USB4: externe videokaart via een eGPU-behuizing mogelijk (langzamer dan OCuLink)"]);
    if (i.nvme_slots) c.push([`${i.nvme_slots}× NVMe`, `${i.nvme_slots} M.2 NVMe-slot(s) voor opslag`]);
    if (i.bay25) c.push(['2,5"', '2,5"-SATA-bay voor een extra SSD of HDD']);
    return c;
  }
  const expandText = (i) => expandChips(i).map((c) => c[0]).join(" ");
  function expandCell(i) {
    const chips = expandChips(i);
    if (!chips.length) return el("span", { class: "muted", title: "Model niet herkend of geen uitbreiding bekend" }, dash);
    return el("span", { class: "conns" }, ...chips.map(([t, tip]) => el("span", { class: "conn" + (t === "PCIe" || t === "OCuLink" ? " conn-strong" : ""), title: tip }, t)));
  }
  function cpuCell(i) {
    if (!i.cpu) return el("span", { class: "muted" }, "niet herkend");
    return el("span", { class: "cpu", title: i.qsv || "" }, i.cpu,
      i.cpu_assumed ? el("span", { class: "muted", title: "Niet in de advertentie; meest voorkomende processor voor dit model" }, " (aanname)") : null,
      el("span", { class: "sub-num" }, i.cpu_gen || ""));
  }
  function scoreCell(i) {
    if (i.score == null) return el("span", { class: "muted", title: "Model niet herkend of niet in de modellenlijst" }, dash);
    const cls = i.score >= 7 ? "good" : i.score >= 4 ? "mid" : "low";
    return el("span", { class: `score ${cls}`, "data-tip": "score", "data-id": i.id, tabindex: "0", role: "button", "aria-label": `Score ${f1(i.score)}, uitleg` }, f1(i.score));
  }
  function metricCell(cat) {
    return (i) => {
      if (i.metric == null) return dashNode();
      const txt = cat.metric === "price_per_tb" ? fmtEur2.format(i.metric) : fmtEur2.format(i.metric);
      return el("span", { class: "metric-val", "data-tip": "metric", "data-id": i.id, tabindex: "0", role: "button", "aria-label": "Uitleg bij deze prijs" }, txt);
    };
  }
  function priceEachCell(i) {
    if (i.price_each == null) return fmtPrice(i);
    const est = i.per_piece === "geschat";
    return el("span", { title: i.qty > 1 ? `Vraagprijs in advertentie: ${fmtPrice(i)}` : null }, (est ? "≈ " : "") + fmtEur.format(i.price_each));
  }
  const priceCell = (i) => el("span", {}, fmtPrice(i), i.highest_bid ? el("span", { class: "sub-num", title: "Hoogste bod" }, `bod ${fmtEur.format(i.highest_bid)}`) : null);

  function columnsFor(cat) {
    const T = (v) => ({ t: "text", v, ph: "Zoek…" });
    const common = {
      title: { id: "title", label: "Advertentie", sort: (i) => i.title, cell: null, filter: T((i) => i.title) },
      brand: { id: "brand", label: "Merk", sort: (i) => i.brand, cell: (i) => i.brand || dash, filter: T((i) => i.brand) },
      type: { id: "type", label: "Type", sort: (i) => i.type, cell: (i) => i.type || dash, filter: T((i) => i.type) },
      city: { id: "city", label: "Plaats", sort: (i) => i.city, cell: (i) => i.city || dash, filter: T((i) => i.city) },
      seen: { id: "seen", label: "Online sinds", sort: (i) => i.first_seen, cell: (i) => fmtDate.format(new Date(i.first_seen)) },
    };
    if (cat.kind === "hdd") {
      return [common.title, common.brand,
        { ...common.type, hide: true },
        { id: "size", label: "Grootte", num: true, sort: (i) => i.size_tb, cell: (i) => num(i.size_tb, " TB"), filter: { t: "min", v: (i) => i.size_tb, ph: "vanaf TB" } },
        { id: "qty", label: "Aantal", num: true, sort: (i) => i.qty, cell: (i) => (i.sold_separately ? el("span", { title: "Meerdere beschikbaar, los te koop" }, `${i.qty} (los)`) : num(i.qty)), filter: { t: "min", v: (i) => i.qty, ph: "vanaf" } },
        { id: "each", label: "Prijs/stuk", num: true, sort: (i) => i.price_each, cell: priceEachCell, filter: { t: "max", v: (i) => i.price_each, ph: "tot €" } },
        { id: "total", label: "Totaal", num: true, hide: true, sort: (i) => i.price_total, cell: (i) => (i.price_total == null ? dash : fmtEur.format(i.price_total)), filter: { t: "max", v: (i) => i.price_total, ph: "tot €" } },
        { id: "metric", label: "€/TB", num: true, sort: (i) => i.metric, cell: metricCell(cat), filter: { t: "max", v: (i) => i.metric, ph: "tot €" } },
        { ...common.city, hide: true }, { ...common.seen, hide: true }];
    }
    if (cat.kind === "minipc") {
      return [common.title,
        { ...common.brand, hide: true },
        { id: "model", label: "Model", hide: true, sort: (i) => i.model, cell: (i) => i.model || dash, filter: T((i) => i.model) },
        { id: "score", label: "Score", num: true, sort: (i) => i.score, cell: scoreCell, filter: { t: "min", v: (i) => i.score, ph: "vanaf" } },
        { id: "cpu", label: "Processor", sort: (i) => genNum(i) ?? -1, cell: cpuCell, filter: { t: "text", v: (i) => `${i.cpu || ""} ${i.cpu_gen || ""}`, ph: "bijv. i5" } },
        { id: "ram", label: "RAM", num: true, sort: (i) => i.ram_gb, filter: { t: "min", v: (i) => i.ram_gb, ph: "vanaf GB" },
          cell: (i) => el("span", {}, i.ram_gb == null ? el("span", { class: "muted" }, "niet vermeld") : i.ram_gb === 0 ? "geen" : `${num(i.ram_gb)} GB`, i.ram_max ? el("span", { class: "sub-num" }, `max ${i.ram_max} GB`) : null) },
        { id: "storage", label: "Opslag", sort: (i) => i.ssd_gb, filter: T((i) => i.storage),
          cell: (i) => (i.storage ? el("span", { class: i.storage === "Geen" ? "muted" : "" }, i.storage) : el("span", { class: "muted" }, "niet vermeld")) },
        { id: "expand", label: "Uitbreiding", hide: true, sort: expandRank, cell: expandCell, filter: { t: "text", v: expandText, ph: "bijv. PCIe" } },
        { id: "price", label: "Prijs", num: true, sort: (i) => i.price, cell: priceCell, filter: { t: "max", v: (i) => i.price, ph: "tot €" } },
        { id: "metric", label: "€/punt", num: true, sort: (i) => i.metric, cell: metricCell(cat), filter: { t: "max", v: (i) => i.metric, ph: "tot €" } },
        { ...common.city, hide: true }, { ...common.seen, hide: true }];
    }
    if (cat.kind === "algemeen") {
      return [common.title, { id: "price", label: "Prijs", num: true, sort: (i) => i.price, cell: priceCell, filter: { t: "max", v: (i) => i.price, ph: "tot €" } },
        common.city, common.seen];
    }
    return [common.title, { ...common.brand, hide: true }, { ...common.type, hide: true },
      { id: "bays", label: "Bays", num: true, sort: (i) => i.bays, cell: (i) => num(i.bays), filter: { t: "min", v: (i) => i.bays, ph: "vanaf" } },
      { id: "conns", label: "Aansluitingen", sort: (i) => (i.connections || []).join(" "), filter: { t: "text", v: (i) => (i.connections || []).join(" "), ph: "bijv. 10GbE" },
        cell: (i) => ((i.connections || []).length ? el("span", { class: "conns" }, ...i.connections.map((c) => el("span", { class: "conn" }, c))) : dash) },
      { id: "stor", label: "Meegeleverde opslag", sort: (i) => i.storage_tb, filter: T((i) => i.storage),
        cell: (i) => (i.storage ? el("span", { class: i.storage === "Geen" ? "muted" : "" }, i.storage) : el("span", { class: "muted", title: "Niet vermeld in de advertentie (of niet herkend)" }, "niet vermeld")) },
      { id: "price", label: "Prijs", num: true, sort: (i) => i.price, cell: priceCell, filter: { t: "max", v: (i) => i.price, ph: "tot €" } },
      { ...common.city, hide: true }, { ...common.seen, hide: true }];
  }

  function compareDefs(cat) {
    const pr = { label: "Prijs", get: (i) => fmtPrice(i), num: (i) => i.price, best: "min" };
    if (cat.kind === "minipc") {
      return [pr,
        { label: "Score", get: (i) => (i.score == null ? dash : f1(i.score)), num: (i) => i.score, best: "max" },
        { label: "€ per scorepunt", get: (i) => (i.metric == null ? dash : fmtEur2.format(i.metric)), num: (i) => i.metric, best: "min" },
        { label: "Processor", get: (i) => (i.cpu ? `${i.cpu}${i.cpu_assumed ? " (aanname)" : ""}${i.cpu_gen ? `, ${i.cpu_gen}` : ""}` : dash) },
        { label: "RAM", get: (i) => (i.ram_gb == null ? "niet vermeld" : `${num(i.ram_gb)} GB${i.ram_max ? `, max ${i.ram_max}` : ""}`), num: (i) => i.ram_gb, best: "max" },
        { label: "Opslag", get: (i) => i.storage || "niet vermeld" },
        { label: "Uitbreiding", get: (i) => expandChips(i).map((c) => c[0]).join(", ") || dash },
        { label: "Plaats", get: (i) => i.city || dash }];
    }
    if (cat.kind === "hdd") {
      return [{ label: "Prijs per stuk", get: (i) => (i.price_each == null ? fmtPrice(i) : fmtEur.format(i.price_each)), num: (i) => i.price_each, best: "min" },
        { label: "€ per TB", get: (i) => (i.metric == null ? dash : fmtEur2.format(i.metric)), num: (i) => i.metric, best: "min" },
        { label: "Grootte", get: (i) => num(i.size_tb, " TB"), num: (i) => i.size_tb, best: "max" },
        { label: "Aantal", get: (i) => num(i.qty) + (i.sold_separately ? " (los)" : "") },
        { label: "Totaal", get: (i) => (i.price_total == null ? dash : fmtEur.format(i.price_total)) },
        { label: "Merk", get: (i) => i.brand || dash },
        { label: "Type", get: (i) => i.type || dash },
        { label: "Plaats", get: (i) => i.city || dash }];
    }
    return [pr, { label: "Plaats", get: (i) => i.city || dash },
      { label: "Online sinds", get: (i) => fmtDate.format(new Date(i.first_seen)) }];
  }

  /* ---------------- tabel koppelen aan een tabblad ---------------- */
  function mount(host, cat, items, ctx) {
    const cols = columnsFor(cat);
    const byId = Object.fromEntries(cols.map((c) => [c.id, c]));
    const prefKey = `cols:${cat.id}`;

    function defaults() { return { order: cols.map((c) => c.id), hidden: cols.filter((c) => c.hide).map((c) => c.id) }; }
    function normPrefs(p) {
      const d = defaults();
      p = p && Array.isArray(p.order) ? p : d;
      const order = [...p.order.filter((id) => byId[id]), ...d.order.filter((id) => !p.order.includes(id))];
      order.splice(order.indexOf("title"), 1);
      order.unshift("title");
      return { order, hidden: (p.hidden || []).filter((id) => byId[id] && id !== "title") };
    }
    const defSort = cat.kind === "minipc" ? { id: "score", asc: false }
      : byId.metric ? { id: "metric", asc: true } : { id: "seen", asc: false };
    const st = { sort: defSort, only: "all", q: "", f: {}, open: new Set(), sel: new Set(), showGone: false,
      prefs: normPrefs(storeJSON(prefKey, null)) };

    const hideRes = () => storeGet("hideReserved") !== "0";
    const hideSeen = () => storeGet("hideSeen") === "1";
    const visibleCols = () => st.prefs.order.filter((id) => !st.prefs.hidden.includes(id)).map((id) => byId[id]);
    const savePrefs = () => storeSet(prefKey, JSON.stringify(st.prefs));
    const itemById = new Map(items.map((i) => [i.id, i]));
    const searchText = (i) => `${i.title} ${i.brand || ""} ${i.type || ""} ${i.model || ""} ${i.city || ""} ${i.cpu || ""} ${(i.connections || []).join(" ")}`.toLowerCase();

    function passes(i) {
      const fav = UserState.isFav(i.id);
      if (!st.showGone && !i.active && !(st.only === "fav" && fav)) return false;
      if (hideRes() && i.reserved && !fav) return false;
      if (hideSeen() && UserState.isSeen(i.id) && !fav) return false;
      if (st.only === "deal" && !i.deal) return false;
      if (st.only === "new" && !i.isNew) return false;
      if (st.only === "fav" && !fav) return false;
      if (st.q && !searchText(i).includes(st.q)) return false;
      for (const c of visibleCols()) {
        const val = st.f[c.id];
        if (val === undefined || val === "" || !c.filter) continue;
        const v = c.filter.v(i);
        if (c.filter.t === "text") { if (!String(v ?? "").toLowerCase().includes(String(val).toLowerCase())) return false; continue; }
        const n = Number(String(val).replace(",", "."));
        if (Number.isNaN(n)) continue;
        if (v == null) return false;
        if (c.filter.t === "min" ? v < n : v > n) return false;
      }
      return true;
    }
    function sorted(list) {
      const col = byId[st.sort.id] || byId.title;
      return list.sort((a, b) => {
        const av = col.sort(a), bv = col.sort(b);
        if (av == null) return 1;
        if (bv == null) return -1;
        const r = typeof av === "number" ? av - bv : String(av).localeCompare(String(bv), "nl");
        return st.sort.asc ? r : -r;
      });
    }
    const activeFilterCount = () => visibleCols().filter((c) => c.filter && (st.f[c.id] ?? "") !== "").length + (st.q ? 1 : 0);

    /* ---- onderdelen van een rij ---- */
    function titleBlock(i) {
      return el("span", { class: "t-wrap" },
        ctx.isUnseen(i) && i.active ? el("span", { class: "dot", title: "Nieuw sinds je laatste bezoek" }) : null,
        el("span", { class: "t-text", title: i.title }, i.title),
        el("span", { class: "row-badges" },
          i.deal ? el("span", { class: "badge deal" }, "deal") : null,
          i.isNew ? el("span", { class: "badge new" }, "nieuw") : null,
          i.price_drop ? el("span", { class: "badge drop", title: "Prijs verlaagd" }, "prijs lager") : null,
          i.reserved ? el("span", { class: "badge gone" }, "gereserveerd") : null,
          i.active ? null : el("span", { class: "badge gone" }, "verdwenen")));
    }
    function actionButtons(i) {
      const fav = UserState.isFav(i.id), seen = UserState.isSeen(i.id);
      return el("span", { class: "acts" },
        el("button", { type: "button", class: "icon-btn fav-btn" + (fav ? " on" : ""), "data-act": "fav", "data-id": i.id, "aria-pressed": String(fav),
          title: fav ? "Interessant (tik om te wissen)" : "Interessant", "aria-label": "Interessant" }, icon("star")),
        el("button", { type: "button", class: "icon-btn seen-btn" + (seen ? " on" : ""), "data-act": "seen", "data-id": i.id, "aria-pressed": String(seen),
          title: seen ? "Gezien, niet interessant (tik om te wissen)" : "Gezien, niet interessant", "aria-label": "Gezien, niet interessant" }, icon("check")));
    }
    function rowClass(i) {
      return ["row", i.active ? "" : "gone", i.reserved ? "reserved" : "", i.deal ? "is-deal" : "", i.isNew ? "is-new" : "",
        UserState.isSeen(i.id) ? "is-seen" : "", UserState.isFav(i.id) ? "is-fav" : ""].filter(Boolean).join(" ");
    }
    function checkbox(i) {
      return el("input", { type: "checkbox", class: "pick", "data-pick": i.id, checked: st.sel.has(i.id), "aria-label": `Kies voor vergelijken: ${i.title}` });
    }

    /* ---- uitgeklapte details ---- */
    function detail(i) {
      const { good, bad } = Explain.strengths(i, cat, ctx);
      const list = (arr, empty) => el("ul", { class: "pts" }, (arr.length ? arr : [empty]).map((t) => el("li", { class: arr.length ? "" : "muted" }, t)));
      const hidden = st.prefs.order.filter((id) => st.prefs.hidden.includes(id)).map((id) => byId[id]);
      const hist = (i.price_history || []).slice(-4);
      const specs = [
        ...hidden.map((c) => [c.label, c.cell ? c.cell(i) : i.title]),
        ["Verkoper", i.seller || null],
        ["Staat", (i.attrs && i.attrs.condition) || null],
        ["Geplaatst", i.posted || null],
        ["Prijsverloop", hist.length > 1 ? hist.map(([t, p]) => `${fmtDay.format(new Date(t))} ${fmtEur.format(p)}`).join(" → ") : null],
      ].filter(([, v]) => v !== null && v !== undefined && v !== "");
      const main = cat.kind === "minipc" ? Explain.scoreBreakdown(i, cat) : Explain.metricBreakdown(i, cat, ctx);
      const desc = (i.description || "").trim();
      const fav = UserState.isFav(i.id), seen = UserState.isSeen(i.id);
      return el("div", { class: "detail" },
        i.image ? el("img", { class: "d-img", src: i.image, alt: "", loading: "lazy", referrerpolicy: "no-referrer" })
          : el("div", { class: "d-img none" }, "Geen foto"),
        el("div", { class: "d-main" }, main),
        el("div", { class: "d-side" },
          el("h4", {}, "Sterke punten"), list(good, "Geen opvallende sterke punten."),
          el("h4", {}, "Zwakke punten"), list(bad, "Geen opvallende zwakke punten."),
          specs.length ? el("dl", { class: "specs" }, specs.map(([k, v]) => [el("dt", {}, k), el("dd", {}, v)])) : null),
        el("div", { class: "d-foot" },
          desc ? el("details", { class: "d-desc" }, el("summary", {}, "Omschrijving van de verkoper"), el("p", {}, desc.length > 700 ? desc.slice(0, 700) + "…" : desc)) : null,
          el("div", { class: "d-btns" },
            el("a", { class: "btn primary", href: i.url, target: "_blank", rel: "noopener" }, btnLabel("open", "Open op Marktplaats")),
            el("button", { type: "button", class: "btn" + (fav ? " on" : ""), "data-act": "fav", "data-id": i.id, "aria-pressed": String(fav) }, btnLabel("star", "Interessant")),
            el("button", { type: "button", class: "btn" + (seen ? " on" : ""), "data-act": "seen", "data-id": i.id, "aria-pressed": String(seen) }, btnLabel("check", "Gezien, niet interessant")))));
    }

    /* ---- opbouw van het scherm ---- */
    const top = el("div", { class: "tb-top" });
    const sumLine = el("div", { class: "tb-sum", "aria-live": "polite" });
    const view = el("div", { class: "tb-view" });
    const cbar = el("div", { class: "cbar", hidden: true });
    host.replaceChildren(top, sumLine, view, cbar);
    let tbody = null, cardsBox = null, chipBtns = [], qInput = null, sortSel = null;

    function buildTop() {
      const chipDefs = [["all", "Alle"], ["deal", "Deals"], ["new", "Nieuw"], ["fav", "Interessant"]];
      chipBtns = chipDefs.map(([k, label]) => el("button", { type: "button", class: "chip" + (k === "fav" ? " fav" : ""), "data-only": k, "aria-pressed": String(k === st.only) },
        label, el("span", { class: "n" })));
      qInput = el("input", { type: "search", class: "q", placeholder: "Zoek in titel, merk, plaats…", "aria-label": "Zoeken", value: st.q });
      sortSel = el("select", { class: "sortsel", "aria-label": "Sorteren op" });
      const popWrap = el("div", { class: "tb-btns" },
        el("button", { type: "button", class: "btn only-narrow", "data-pop": "filters" }, btnLabel("filter", "Filters")),
        el("button", { type: "button", class: "btn", "data-pop": "cols" }, btnLabel("columns", "Kolommen")),
        el("button", { type: "button", class: "btn", "data-pop": "view" }, btnLabel("tune", "Weergave")));
      top.replaceChildren(el("div", { class: "chips", role: "group", "aria-label": "Snelfilter" }, chipBtns), qInput,
        el("label", { class: "only-narrow sortlbl" }, "Sorteren", sortSel,
          el("button", { type: "button", class: "icon-btn", "data-act": "sortdir", title: "Richting omdraaien", "aria-label": "Richting omdraaien" }, icon("sort"))),
        popWrap);
      chipBtns.forEach((b) => b.addEventListener("click", () => { st.only = b.dataset.only; chipBtns.forEach((c) => c.setAttribute("aria-pressed", String(c === b))); renderRows(); }));
      qInput.addEventListener("input", () => { st.q = qInput.value.trim().toLowerCase(); renderRows(); });
      sortSel.addEventListener("change", () => { st.sort = { id: sortSel.value, asc: byId[sortSel.value].num ? st.sort.asc : true }; renderFull(); });
      popWrap.addEventListener("click", (e) => { const b = e.target.closest("[data-pop]"); if (b) togglePop(b); });
      top.addEventListener("click", (e) => {
        if (e.target.closest('[data-act="sortdir"]')) { st.sort.asc = !st.sort.asc; renderFull(); }
      });
    }

    function fillSortSel() {
      sortSel.replaceChildren(...st.prefs.order.map((id) => byId[id]).filter((c) => c.sort).map((c) => el("option", { value: c.id, selected: c.id === st.sort.id }, c.label)));
    }

    /* ---- uitklapmenu's ---- */
    let pop = null, popFor = null;
    function closePop() { if (pop) { pop.remove(); pop = null; popFor = null; } }
    function togglePop(btn) {
      const kind = btn.dataset.pop;
      if (popFor === kind) { closePop(); return; }
      if (kind === "filters") { closePop(); openFilterDialog(); return; }
      closePop();
      popFor = kind;
      pop = el("div", { class: "pop", role: "dialog", "aria-label": kind === "cols" ? "Kolommen" : "Weergave" });
      fillPop();
      btn.parentElement.append(pop);
    }
    function fillPop() {
      if (!pop) return;
      if (popFor === "cols") {
        const order = st.prefs.order;
        pop.replaceChildren(
          el("p", { class: "pop-h" }, "Kies welke kolommen je ziet en in welke volgorde"),
          el("ul", { class: "colist" }, order.map((id, idx) => {
            const c = byId[id], hid = st.prefs.hidden.includes(id), fixed = id === "title";
            return el("li", {},
              el("label", { class: "check" }, el("input", { type: "checkbox", checked: !hid, disabled: fixed, "data-col": id }), c.label),
              fixed ? el("span", { class: "muted small" }, "altijd zichtbaar") : el("span", { class: "mv" },
                el("button", { type: "button", class: "icon-btn up", "data-mv": id, "data-dir": "-1", title: "Eerder in de rij", "aria-label": `${c.label} naar voren`, disabled: idx <= 1 }, icon("chevron", 16)),
                el("button", { type: "button", class: "icon-btn down", "data-mv": id, "data-dir": "1", title: "Later in de rij", "aria-label": `${c.label} naar achteren`, disabled: idx === order.length - 1 }, icon("chevron", 16))));
          })),
          el("button", { type: "button", class: "btn small", "data-act": "colreset" }, "Standaard terugzetten"));
      } else {
        const nS = items.filter((i) => i.active && UserState.isSeen(i.id) && !UserState.isFav(i.id)).length;
        const nR = items.filter((i) => i.active && i.reserved && !UserState.isFav(i.id)).length;
        pop.replaceChildren(
          el("label", { class: "check" }, el("input", { type: "checkbox", checked: hideSeen(), "data-view": "seen" }), `Gezien verbergen${nS ? ` (${nS})` : ""}`),
          el("label", { class: "check" }, el("input", { type: "checkbox", checked: hideRes(), "data-view": "res" }), `Gereserveerd verbergen${nR ? ` (${nR})` : ""}`),
          el("label", { class: "check" }, el("input", { type: "checkbox", checked: st.showGone, "data-view": "gone" }), "Verdwenen advertenties tonen"),
          el("p", { class: "muted small" }, "Advertenties die je als interessant markeerde blijven altijd zichtbaar."));
      }
    }
    function onPopInput(e) {
      const t = e.target;
      if (t.dataset.col) {
        const hid = new Set(st.prefs.hidden);
        if (t.checked) hid.delete(t.dataset.col); else { hid.add(t.dataset.col); delete st.f[t.dataset.col]; }
        st.prefs.hidden = [...hid];
        savePrefs(); renderFull(); fillPop();
      } else if (t.dataset.view) {
        if (t.dataset.view === "seen") storeSet("hideSeen", t.checked ? "1" : "0");
        else if (t.dataset.view === "res") storeSet("hideReserved", t.checked ? "1" : "0");
        else st.showGone = t.checked;
        renderRows(); ctx.onViewChange();
      }
    }
    function onPopClick(e) {
      const mv = e.target.closest("[data-mv]");
      if (mv) {
        const o = st.prefs.order, i = o.indexOf(mv.dataset.mv), j = i + Number(mv.dataset.dir);
        if (j >= 1 && j < o.length) { [o[i], o[j]] = [o[j], o[i]]; savePrefs(); renderFull(); fillPop(); }
      } else if (e.target.closest('[data-act="colreset"]')) {
        st.prefs = normPrefs(null); savePrefs(); renderFull(); fillPop();
      }
    }
    top.addEventListener("change", (e) => { if (pop && pop.contains(e.target)) onPopInput(e); });
    top.addEventListener("click", (e) => { if (pop && pop.contains(e.target)) onPopClick(e); });
    const outside = (e) => {
      if (!document.body.contains(host)) { document.removeEventListener("click", outside); return; }
      if (pop && !e.target.closest(".pop") && !e.target.closest("[data-pop]")) closePop();
    };
    document.addEventListener("click", outside);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closePop(); });

    /* ---- filters op een smal scherm ---- */
    function openFilterDialog() {
      const fields = visibleCols().filter((c) => c.filter);
      const dlg = el("dialog", { class: "sheet" },
        el("form", { method: "dialog", class: "dlg" },
          el("h2", {}, "Filters"),
          fields.map((c) => el("label", { class: "fld" }, `${c.label}${c.filter.t === "min" ? " (vanaf)" : c.filter.t === "max" ? " (tot)" : ""}`,
            el("input", { type: "search", inputmode: c.filter.t === "text" ? "text" : "decimal", value: st.f[c.id] || "", placeholder: c.filter.ph, "data-f": c.id }))),
          el("div", { class: "dlg-btns" },
            el("button", { type: "button", class: "btn", "data-act": "clearf" }, btnLabel("close", "Filters wissen")),
            el("button", { class: "btn primary", value: "ok" }, "Klaar"))));
      dlg.addEventListener("input", (e) => { if (e.target.dataset.f) { st.f[e.target.dataset.f] = e.target.value.trim(); renderRows(); } });
      dlg.addEventListener("click", (e) => {
        if (e.target.closest('[data-act="clearf"]')) { st.f = {}; dlg.querySelectorAll("input").forEach((x) => { x.value = ""; }); renderRows(); }
      });
      dlg.addEventListener("close", () => dlg.remove());
      document.body.append(dlg);
      dlg.showModal();
    }

    /* ---- tabel (breed scherm) ---- */
    function headCell(c) {
      const movable = c.id !== "title";
      const sortedHere = st.sort.id === c.id;
      const th = el("th", { class: (c.num ? "num " : "") + (c.id === "title" ? "c-title" : ""), "data-id": c.id, draggable: movable ? "true" : null,
        "aria-sort": sortedHere ? (st.sort.asc ? "ascending" : "descending") : "none" },
        el("button", { type: "button", class: "th-btn", title: movable ? "Klik om te sorteren, sleep om te verplaatsen" : "Klik om te sorteren" },
          movable ? el("span", { class: "grip" }, icon("drag", 14)) : null,
          c.label, sortedHere ? el("span", { class: "arrow" }, st.sort.asc ? "↑" : "↓") : null));
      return th;
    }
    function filterCell(c) {
      if (!c.filter) return el("td", { class: "f-empty" });
      const inp = el("input", { type: "search", class: "fi" + (c.num ? " num" : ""), placeholder: c.filter.ph, "data-f": c.id,
        inputmode: c.filter.t === "text" ? "text" : "decimal", value: st.f[c.id] || "", "aria-label": `Filter ${c.label}` });
      return el("td", {}, inp);
    }
    function renderFull() {
      fillSortSel();
      if (NARROW.matches) {
        cardsBox = el("div", { class: "mcards" });
        tbody = null;
        view.replaceChildren(cardsBox);
      } else {
        const vc = visibleCols();
        const thead = el("thead", {},
          el("tr", { class: "hrow" }, el("th", { class: "c-sel" }), vc.map(headCell), el("th", { class: "c-act" })),
          el("tr", { class: "frow" }, el("td", {}), vc.map(filterCell), el("td", {})));
        tbody = el("tbody");
        cardsBox = null;
        view.replaceChildren(el("div", { class: "table-scroll" }, el("table", { class: "list" }, thead, tbody)));
        wireTable(thead);
      }
      renderRows();
    }

    let dragFrom = null;
    function wireTable(thead) {
      thead.addEventListener("click", (e) => {
        const th = e.target.closest("th[data-id]");
        if (!th || !e.target.closest(".th-btn")) return;
        const id = th.dataset.id;
        st.sort = st.sort.id === id ? { id, asc: !st.sort.asc } : { id, asc: !(byId[id].num && id !== "price" && id !== "metric" && id !== "each") && id !== "seen" && id !== "score" };
        renderFull();
      });
      thead.addEventListener("input", (e) => { const id = e.target.dataset.f; if (id) { st.f[id] = e.target.value.trim(); renderRows(); } });
      thead.addEventListener("dragstart", (e) => { const th = e.target.closest("th[data-id]"); if (!th) return; dragFrom = th.dataset.id; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", dragFrom); });
      thead.addEventListener("dragover", (e) => { const th = e.target.closest("th[data-id]"); if (th && dragFrom && th.dataset.id !== "title") { e.preventDefault(); th.classList.add("drop"); } });
      thead.addEventListener("dragleave", (e) => { const th = e.target.closest("th[data-id]"); if (th) th.classList.remove("drop"); });
      thead.addEventListener("drop", (e) => {
        const th = e.target.closest("th[data-id]");
        if (!th || !dragFrom || th.dataset.id === "title") return;
        e.preventDefault();
        const o = st.prefs.order, fi = o.indexOf(dragFrom), ti = o.indexOf(th.dataset.id);
        if (fi > 0 && ti > 0 && fi !== ti) { o.splice(fi, 1); o.splice(ti, 0, dragFrom); savePrefs(); }
        dragFrom = null;
        renderFull();
      });
      thead.addEventListener("dragend", () => { dragFrom = null; thead.querySelectorAll(".drop").forEach((x) => x.classList.remove("drop")); });
    }

    function rowEl(i, vc) {
      const open = st.open.has(i.id);
      return el("tr", { class: rowClass(i), "data-id": i.id, tabindex: "0", "aria-expanded": String(open) },
        el("td", { class: "c-sel" }, checkbox(i)),
        vc.map((c) => (c.id === "title" ? el("td", { class: "c-title" }, titleBlock(i)) : el("td", { class: c.num ? "num" : "" }, c.cell(i)))),
        el("td", { class: "c-act" }, actionButtons(i), el("span", { class: "chev" }, icon("chevron"))));
    }
    function detailRow(i, span) { return el("tr", { class: "detail-row", "data-for": i.id }, el("td", { colspan: span }, detail(i))); }

    function cardEl(i) {
      const open = st.open.has(i.id);
      const fields = visibleCols().filter((c) => c.id !== "title");
      return el("article", { class: "mcard " + rowClass(i).replace("row", "").trim(), "data-id": i.id, "aria-expanded": String(open) },
        el("div", { class: "mc-head", tabindex: "0", role: "button", "aria-label": `${i.title}, tik voor details` },
          checkbox(i), el("div", { class: "mc-title" }, titleBlock(i)), actionButtons(i)),
        el("dl", { class: "mc-grid" }, fields.map((c) => el("div", {}, el("dt", {}, c.label), el("dd", {}, c.cell(i))))),
        open ? detail(i) : null);
    }

    function updateChips(rowsShown) {
      const act = items.filter((i) => i.active);
      const counts = { all: act.length, deal: act.filter((i) => i.deal).length, new: act.filter((i) => i.isNew).length, fav: items.filter((i) => UserState.isFav(i.id)).length };
      chipBtns.forEach((b) => { b.querySelector(".n").textContent = counts[b.dataset.only] || ""; });
      const nf = activeFilterCount();
      const parts = [el("span", {}, `${rowsShown} van ${act.length} advertenties`, nf ? ` · ${nf} filter${nf > 1 ? "s" : ""} actief` : "")];
      if (nf) parts.push(el("button", { type: "button", class: "btn small", "data-act": "clearf" }, btnLabel("close", "Filters wissen")));
      sumLine.replaceChildren(...parts);
    }

    function renderRows() {
      const list = sorted(items.filter(passes));
      updateChips(list.length);
      const vc = visibleCols();
      if (tbody) {
        const frag = [];
        for (const i of list) {
          frag.push(rowEl(i, vc));
          if (st.open.has(i.id)) frag.push(detailRow(i, vc.length + 2));
        }
        tbody.replaceChildren(...(frag.length ? frag : [el("tr", {}, el("td", { colspan: vc.length + 2, class: "empty-cell" },
          st.only === "fav" ? "Je hebt nog niets als interessant gemarkeerd. Tik op de ster bij een advertentie."
            : "Geen advertenties met deze filters. Haal een filter weg om meer te zien."))]));
      } else if (cardsBox) {
        cardsBox.replaceChildren(...(list.length ? list.map(cardEl) : [el("p", { class: "empty" }, "Geen advertenties met deze filters. Haal een filter weg om meer te zien.")]));
      }
      renderBar();
    }

    function toggleOpen(id) {
      if (st.open.has(id)) st.open.delete(id); else st.open.add(id);
      const i = itemById.get(id);
      if (tbody) {
        const tr = tbody.querySelector(`tr.row[data-id="${CSS.escape(id)}"]`);
        if (!tr) return;
        const next = tr.nextElementSibling;
        const open = st.open.has(id);
        tr.setAttribute("aria-expanded", String(open));
        if (open) tr.after(detailRow(i, visibleCols().length + 2));
        else if (next && next.classList.contains("detail-row")) next.remove();
      } else if (cardsBox) {
        const old = cardsBox.querySelector(`.mcard[data-id="${CSS.escape(id)}"]`);
        if (old) old.replaceWith(cardEl(i));
      }
    }

    /* ---- klikken in de lijst ---- */
    view.addEventListener("click", (e) => {
      const act = e.target.closest("[data-act]");
      if (act) {
        e.stopPropagation();
        if (act.dataset.act === "fav") markInteresting(act.dataset.id);
        else if (act.dataset.act === "seen") markSeen(act.dataset.id);
        return;
      }
      if (e.target.closest("a, input, [data-tip], summary, details, .detail")) return;
      const host2 = e.target.closest("tr.row, .mcard");
      if (host2) toggleOpen(host2.dataset.id);
    });
    view.addEventListener("keydown", (e) => {
      if ((e.key === "Enter" || e.key === " ") && e.target.matches("tr.row, .mc-head")) {
        e.preventDefault();
        toggleOpen(e.target.closest("[data-id]").dataset.id);
      }
    });
    view.addEventListener("change", (e) => {
      const id = e.target.dataset && e.target.dataset.pick;
      if (!id) return;
      if (e.target.checked) {
        if (st.sel.size >= 4) { e.target.checked = false; toast("Je kunt maximaal 4 advertenties tegelijk vergelijken. Haal er eerst één weg."); return; }
        st.sel.add(id);
      } else st.sel.delete(id);
      renderBar();
    });
    sumLine.addEventListener("click", (e) => {
      if (e.target.closest('[data-act="clearf"]')) { st.f = {}; st.q = ""; qInput.value = ""; renderFull(); }
    });

    Explain.attach(view, (id) => (itemById.has(id) ? { item: itemById.get(id), cat, ctx } : null));

    /* ---- vergelijken ---- */
    function renderBar() {
      const n = st.sel.size;
      cbar.hidden = n === 0;
      if (!n) return;
      cbar.replaceChildren(
        el("span", {}, n === 1 ? "1 advertentie gekozen. Kies er nog minstens één om te vergelijken." : `${n} advertenties gekozen`),
        el("span", { class: "cbar-btns" },
          n >= 2 ? el("button", { type: "button", class: "btn primary", "data-act": "cmp" }, btnLabel("compare", "Vergelijk")) : null,
          el("button", { type: "button", class: "btn", "data-act": "cmpclear" }, btnLabel("close", "Wissen"))));
    }
    cbar.addEventListener("click", (e) => {
      if (e.target.closest('[data-act="cmp"]')) openCompare();
      else if (e.target.closest('[data-act="cmpclear"]')) { st.sel.clear(); renderRows(); }
    });

    function openCompare() {
      const dlg = el("dialog", { class: "sheet wide" });
      const body = el("div", { class: "dlg" });
      dlg.append(body);
      const draw = () => {
        const list = items.filter((i) => st.sel.has(i.id));
        if (list.length < 2) { dlg.close(); return; }
        const defs = compareDefs(cat);
        const bestOf = (d) => {
          if (!d.num || !d.best) return null;
          const vals = list.map(d.num).filter((v) => v != null);
          if (vals.length < 2 || new Set(vals).size < 2) return null;
          return d.best === "min" ? Math.min(...vals) : Math.max(...vals);
        };
        body.replaceChildren(
          el("div", { class: "dlg-top" }, el("h2", {}, "Vergelijking"), el("p", { class: "muted small" }, "Groen is de beste waarde in die rij."),
            el("button", { type: "button", class: "icon-btn", "data-x": "1", title: "Sluiten", "aria-label": "Sluiten" }, icon("close"))),
          el("div", { class: "cmp-scroll" }, el("table", { class: "cmp" },
            el("thead", {}, el("tr", {}, el("th", {}),
              list.map((i) => el("th", {},
                i.image ? el("img", { src: i.image, alt: "", loading: "lazy", referrerpolicy: "no-referrer" }) : null,
                el("span", { class: "cmp-title" }, i.title),
                el("span", { class: "cmp-btns" },
                  el("a", { class: "btn small", href: i.url, target: "_blank", rel: "noopener" }, btnLabel("open", "Open")),
                  el("button", { type: "button", class: "btn small", "data-rm": i.id }, btnLabel("close", "Weghalen"))))))),
            el("tbody", {}, defs.map((d) => {
              const best = bestOf(d);
              return el("tr", {}, el("th", { scope: "row" }, d.label),
                list.map((i) => el("td", { class: best !== null && d.num(i) === best ? "best" : "" }, d.get(i))));
            })))));
      };
      dlg.addEventListener("click", (e) => {
        if (e.target.closest("[data-x]")) dlg.close();
        const rm = e.target.closest("[data-rm]");
        if (rm) { st.sel.delete(rm.dataset.rm); draw(); renderRows(); }
      });
      dlg.addEventListener("close", () => dlg.remove());
      document.body.append(dlg);
      draw();
      dlg.showModal();
    }

    /* ---- starten ---- */
    buildTop();
    renderFull();
    NARROW.addEventListener("change", () => { if (document.body.contains(host)) renderFull(); });
    UserState.onChange(() => { if (document.body.contains(host)) { renderRows(); fillPop(); } });
  }

  return { mount };
})();
