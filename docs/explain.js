"use strict";
/* Uitleg bij cijfers: score-opbouw, €/TB of €/punt, deal, sterke en zwakke punten, en de zwevende tooltip. */

const Explain = (() => {
  const PARTS = [
    ["cpu", "Processor", 0.30, "Processor"],
    ["jellyfin", "Jellyfin-transcodering", 0.25, "Jellyfin"],
    ["ram", "Geheugen", 0.20, "Geheugen"],
    ["opslag", "Opslag", 0.10, "Opslag"],
    ["uitbreiding", "Uitbreiding", 0.15, "Uitbreiding"],
  ];

  /* Nieuwe gegevens hebben score_parts. Oudere gegevens halen we uit de tekstregels (score_why). */
  function scoreParts(i) {
    if (Array.isArray(i.score_parts) && i.score_parts.length) return i.score_parts;
    if (!Array.isArray(i.score_why)) return [];
    return PARTS.map(([key, label, weight, prefix]) => {
      const line = i.score_why.find((l) => l.startsWith(prefix + ":"));
      if (!line) return null;
      const m = /\((\d+)\/10\)\s*$/.exec(line);
      return { key, label, weight, points: m ? Number(m[1]) : 0, text: line.replace(/^[^:]+:\s*/, "").replace(/\s*\(\d+\/10\)\s*$/, "") };
    }).filter(Boolean);
  }

  const pct = (w) => `${Math.round(w * 100)}%`;

  function scoreBreakdown(i, cat) {
    const parts = scoreParts(i);
    if (i.score == null || !parts.length) {
      return el("div", { class: "ex" }, el("p", { class: "ex-title" }, "Nog geen score"),
        el("p", { class: "ex-sub" }, "Het model of de processor is niet herkend, dus er is niets om een cijfer op te baseren."));
    }
    const rows = parts.map((p) => el("div", { class: "ex-part" },
      el("div", { class: "ex-line" },
        el("span", { class: "ex-label" }, p.label, el("span", { class: "ex-w" }, ` telt voor ${pct(p.weight)}`)),
        el("span", { class: "ex-pts" }, `${f1(p.points)}/10 `, el("b", {}, `+${f1(p.weight * p.points)}`))),
      el("div", { class: "ex-bar", role: "img", "aria-label": `${f1(p.points)} van 10` }, el("i", { style: `width:${Math.max(2, p.points * 10)}%` })),
      el("div", { class: "ex-why" }, p.text,
        p.key === "cpu" && i.cpu_assumed ? el("span", { class: "ex-flag" }, "aanname: niet in de advertentie, meest voorkomend voor dit model") : null)));
    return el("div", { class: "ex" },
      el("p", { class: "ex-title" }, `Score ${f1(i.score)} van 10`),
      el("p", { class: "ex-sub" }, "Hoe goed past deze pc bij Proxmox met Jellyfin? Vijf onderdelen met elk een eigen gewicht, bij elkaar opgeteld."),
      rows,
      el("p", { class: "ex-foot" }, metricSentence(i, cat)));
  }

  function metricSentence(i, cat) {
    if (cat.metric === "price_per_score" && i.metric != null && i.price != null && i.score) {
      return `€ per scorepunt = ${fmtEur2.format(i.price)} ÷ ${f1(i.score)} = ${fmtEur2.format(i.metric)}. Hoe lager, hoe meer pc voor je geld.${dealSentence(i, cat)}`;
    }
    return "";
  }

  function dealSentence(i, cat) {
    if (cat.deal_threshold == null) return "";
    const rule = cat.deal_rule === "vast" ? "vaste grens" : cat.deal_rule;
    return ` Deal = ${metricLabel(cat)} van ${fmtMetric(cat, cat.deal_threshold)} of lager (${rule}). ${i.deal ? "Deze advertentie valt daaronder." : "Deze advertentie zit erboven."}`;
  }

  /* Uitleg bij de kolom met de vergelijkingswaarde (€/TB, €/punt of prijs) */
  function metricBreakdown(i, cat, ctx = {}) {
    const lines = [];
    if (cat.metric === "price_per_tb") {
      if (i.price_each != null && i.size_tb) {
        lines.push(`€/TB = prijs per stuk ÷ grootte = ${fmtEur2.format(i.price_each)} ÷ ${num(i.size_tb)} TB = ${fmtEur2.format(i.metric)}/TB`);
      }
      if (i.per_piece === "geschat") lines.push("De prijs per stuk is geschat: de vraagprijs lijkt te laag voor het totaal en is daarom per stuk gerekend.");
      else if (i.per_piece) lines.push("De prijs per stuk staat zo in de advertentie.");
      else if (i.qty > 1) lines.push(`Geen prijs per stuk genoemd: de vraagprijs ${fmtPrice(i)} is gedeeld door ${i.qty} stuks.`);
    } else if (cat.metric === "price_per_score") {
      return scoreBreakdown(i, cat);
    } else {
      lines.push(`Vraagprijs: ${fmtPrice(i)}.`);
    }
    if (ctx.median != null && i.metric != null && cat.metric !== "price") {
      lines.push(`Mediaan van de actieve advertenties nu: ${fmtMetric(cat, ctx.median)}.`);
    }
    const d = dealSentence(i, cat).trim();
    if (d) lines.push(d);
    return el("div", { class: "ex" },
      el("p", { class: "ex-title" }, cat.metric === "price" ? "Prijs" : `Waarom ${fmtMetric(cat, i.metric)}?`),
      lines.map((l) => el("p", { class: "ex-sub" }, l)));
  }

  /* Sterke en zwakke punten, afgeleid van de gegevens die er al zijn */
  function strengths(i, cat, ctx = {}) {
    const good = [], bad = [];
    if (cat.kind === "minipc") {
      for (const p of scoreParts(i)) {
        if (p.points >= 8) good.push(`${p.label}: ${p.text}`);
        else if (p.points <= 5) bad.push(`${p.label}: ${p.text}`);
      }
      if (i.cpu_assumed) bad.push("Processor staat niet in de advertentie; dit is een aanname op basis van het model");
      if (i.ram_gb == null) bad.push("Geheugen niet vermeld");
      if (i.ram_gb != null && i.ram_max && i.ram_max >= 32 && i.ram_gb < 32) good.push(`RAM is uit te breiden tot ${i.ram_max} GB`);
      if (i.score == null) bad.push("Geen score: model of processor niet herkend");
    } else if (cat.kind === "hdd") {
      if (i.metric != null && ctx.median) {
        const diff = Math.round((1 - i.metric / ctx.median) * 100);
        if (diff >= 15) good.push(`${diff}% goedkoper per TB dan de mediaan`);
        else if (diff <= -15) bad.push(`${-diff}% duurder per TB dan de mediaan`);
      }
      if (i.per_piece === "geschat") bad.push("Prijs per stuk is een schatting");
      if (i.size_tb >= 12) good.push(`Grote schijf: ${num(i.size_tb)} TB`);
      if (i.sold_separately) good.push("Meerdere stuks, los te koop");
      const cond = (i.attrs && i.attrs.condition) || "";
      if (/nieuw/i.test(cond)) good.push(`Staat: ${cond.toLowerCase()}`);
      if (/gebruikt|defect/i.test(cond)) bad.push(`Staat: ${cond.toLowerCase()}`);
    }
    if (i.deal) good.unshift("Deal: valt onder de dealgrens");
    if (i.price_drop) good.push("Prijs is verlaagd");
    if (i.reserved) bad.push("Gereserveerd");
    if (!i.active) bad.push("Advertentie is verdwenen");
    return { good, bad };
  }

  /* ---- zwevende tooltip: bij hoveren, aantikken of toetsenbord ---- */
  let tip = null, pinnedFor = null;

  function hide() { if (tip) { tip.remove(); tip = null; } pinnedFor = null; }

  function place(box, target) {
    const r = target.getBoundingClientRect();
    const w = Math.min(340, window.innerWidth - 16);
    box.style.width = w + "px";
    const h = box.offsetHeight;
    let top = r.bottom + 8;
    if (top + h > window.innerHeight - 8 && r.top - h - 8 > 8) top = r.top - h - 8;
    top = Math.max(8, Math.min(top, window.innerHeight - h - 8));
    box.style.top = top + "px";
    box.style.left = Math.max(8, Math.min(r.left - 12, window.innerWidth - w - 8)) + "px";
  }

  function show(target, node) {
    hide();
    tip = el("div", { class: "tip", role: "tooltip" }, node);
    document.body.append(tip);
    place(tip, target);
  }

  /* resolve(id) geeft { item, cat, ctx }. Elementen krijgen data-tip="score|metric" en data-id. */
  function attach(root, resolve) {
    const build = (t) => {
      const r = resolve(t.dataset.id);
      if (!r) return null;
      return t.dataset.tip === "score" ? scoreBreakdown(r.item, r.cat) : metricBreakdown(r.item, r.cat, r.ctx);
    };
    root.addEventListener("mouseover", (e) => {
      const t = e.target.closest("[data-tip]");
      if (!t || pinnedFor) return;
      const n = build(t);
      if (n) show(t, n);
    });
    root.addEventListener("mouseout", (e) => {
      if (e.target.closest("[data-tip]") && !pinnedFor) hide();
    });
    root.addEventListener("focusin", (e) => {
      const t = e.target.closest("[data-tip]");
      if (t && !pinnedFor) { const n = build(t); if (n) show(t, n); }
    });
    root.addEventListener("focusout", () => { if (!pinnedFor) hide(); });
    root.addEventListener("click", (e) => {
      const t = e.target.closest("[data-tip]");
      if (!t) return;
      e.stopPropagation();
      if (pinnedFor === t) { hide(); return; }
      const n = build(t);
      if (n) { show(t, n); pinnedFor = t; }
    });
  }
  document.addEventListener("click", (e) => { if (tip && !e.target.closest("[data-tip]") && !e.target.closest(".tip")) hide(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") hide(); });
  window.addEventListener("scroll", () => { if (tip && !pinnedFor) hide(); }, { passive: true });

  return { scoreParts, scoreBreakdown, metricBreakdown, strengths, attach, hide };
})();
