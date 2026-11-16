"use strict";
/*
 * Handmatig bijwerken:
 * - gegevens van één advertentie corrigeren (opgeslagen als "overschrijving" in je eigen markeringen, dus ook gesynchroniseerd)
 * - bulk: een markering toepassen op alle advertenties die aan voorwaarden voldoen
 * De scraperdata zelf wordt nooit aangepast; een overschrijving ligt eroverheen en is altijd terug te zetten.
 */
const Edit = (() => {
  /* Welke velden per soort aanpasbaar zijn */
  const FIELDS = {
    minipc: [["price", "Prijs (€)", "num"], ["score", "Score (0–10)", "num"], ["cpu", "Processor", "text"], ["ram_gb", "RAM (GB)", "num"], ["storage", "Opslag", "text"], ["model", "Model", "text"], ["brand", "Merk", "text"]],
    hdd: [["size_tb", "Grootte (TB)", "num"], ["qty", "Aantal", "num"], ["price_each", "Prijs per stuk (€)", "num"], ["brand", "Merk", "text"], ["type", "Type", "text"]],
    enclosure: [["price", "Prijs (€)", "num"], ["bays", "Aantal bays", "num"], ["storage", "Meegeleverde opslag", "text"], ["brand", "Merk", "text"]],
    algemeen: [["price", "Prijs (€)", "num"], ["brand", "Merk", "text"]],
  };
  const fieldsFor = (cat) => FIELDS[cat.kind] || FIELDS.algemeen;
  const round2 = (n) => Math.round(n * 100) / 100;

  /* Legt de overschrijvingen van de bezoeker over een advertentie heen en rekent de afgeleide waarden opnieuw uit. */
  function apply(cat, item) {
    const o = UserState.override(item.id);
    if (!o || !Object.keys(o).length) return item;
    const i = { ...item, edited: Object.keys(o) };
    Object.assign(i, o);
    if (cat.kind === "hdd") {
      if ("qty" in o && !("price_each" in o) && i.price != null && i.qty) { i.price_each = round2(i.price / i.qty); i.per_piece = "berekend"; }
      if ("price_each" in o) i.per_piece = "handmatig";
      if (i.price_each != null) i.price_total = round2(i.price_each * (i.qty || 1));
      if (["size_tb", "qty", "price_each"].some((k) => k in o)) i.metric = i.price_each != null && i.size_tb ? round2(i.price_each / i.size_tb) : null;
    } else if (["price", "score"].some((k) => k in o)) {
      if ("score" in o) { i.score_manual = true; i.score_orig = item.score; }
      if (cat.metric === "price_per_score") i.metric = i.price != null && i.score > 0 ? round2(i.price / i.score) : null;
      else i.metric = i.price ?? null;
    }
    if (i.metric !== item.metric) i.deal = cat.deal_threshold != null && i.metric != null && i.metric <= cat.deal_threshold;
    return i;
  }

  const parseNum = (s) => { const t = String(s).trim().replace(",", "."); return t === "" ? null : Number(t); };
  const same = (a, b) => (a ?? null) === (b ?? null);

  /* ---- één advertentie corrigeren ---- */
  function openEdit({ item, cat, original, onSaved }) {
    const defs = fieldsFor(cat);
    const orig = original || item;
    const cur = (k) => (item[k] === null || item[k] === undefined ? "" : String(item[k]).replace(".", ","));
    const dlg = el("dialog", { class: "sheet" });
    const form = el("form", { class: "dlg", method: "dialog", novalidate: true },
      el("h2", {}, "Gegevens aanpassen"),
      el("p", { class: "muted small t-clip" }, item.title),
      el("p", { class: "muted small" }, "Zet hier goed wat de scraper verkeerd las. Het gaat alleen om jouw weergave en wordt met je markeringen gesynchroniseerd. Afgeleide waarden (€/punt, €/TB, deal) worden opnieuw berekend."),
      defs.map(([k, label, type]) => el("label", { class: "fld" }, label,
        el("input", { type: "text", name: k, value: cur(k), inputmode: type === "num" ? "decimal" : "text", autocomplete: "off",
          placeholder: orig[k] == null ? "leeg" : `origineel: ${orig[k]}` }),
        el("small", { class: "muted", "data-hint": k }), el("p", { class: "fld-err", "data-err": k, role: "alert" }))),
      cat.kind === "minipc" ? el("p", { class: "muted small" }, "De score wordt niet opnieuw uitgerekend als je processor of RAM aanpast. Pas de score zelf aan als die daardoor verandert.") : null,
      cat.kind === "hdd" ? el("p", { class: "muted small" }, "Pas je het aantal aan zonder prijs per stuk, dan wordt de vraagprijs door het aantal gedeeld.") : null,
      el("div", { class: "dlg-btns" },
        item.edited ? el("button", { type: "button", class: "btn", "data-reset": "1" }, "Origineel herstellen") : null,
        el("button", { type: "button", class: "btn", "data-x": "1" }, "Annuleren"),
        el("button", { type: "submit", class: "btn primary" }, "Opslaan")));
    dlg.append(form);

    const finish = (msg, prev) => {
      dlg.close();
      toast(msg, { undo: () => { UserState.restore(prev); onSaved && onSaved(); } });
    };
    dlg.addEventListener("click", (e) => {
      if (e.target.closest("[data-x]")) dlg.close();
      if (e.target.closest("[data-reset]")) {
        const prev = { [item.id]: UserState.getRaw(item.id) };
        UserState.setOverride(item.id, null);
        finish("Origineel hersteld.", prev);
      }
    });
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const o = {}, errors = {};
      for (const [k, label, type] of defs) {
        const raw = form.elements[k].value;
        if (type === "num") {
          const v = parseNum(raw);
          if (v !== null && !(v >= 0)) { errors[k] = "Vul een getal in, bijvoorbeeld 8 of 12,5."; continue; }
          if (k === "score" && v !== null && v > 10) { errors[k] = "De score loopt van 0 tot 10."; continue; }
          if (!same(v, orig[k] ?? null)) o[k] = v;
        } else {
          const v = raw.trim() === "" ? null : raw.trim();
          if (!same(v, orig[k] === "" ? null : orig[k] ?? null)) o[k] = v;
        }
      }
      form.querySelectorAll("[data-err]").forEach((p) => { p.textContent = errors[p.dataset.err] || ""; });
      if (Object.keys(errors).length) { form.elements[Object.keys(errors)[0]].focus(); return; }
      const prev = { [item.id]: UserState.getRaw(item.id) };
      UserState.setOverride(item.id, o);
      finish(Object.keys(o).length ? "Gegevens aangepast." : "Geen wijzigingen ten opzichte van het origineel.", prev);
    });
    dlg.addEventListener("close", () => dlg.remove());
    document.body.append(dlg);
    dlg.showModal();
  }

  /* ---- bulk ---- */
  function openBulk({ cat, items, visibleIds }) {
    const price = { k: "price", label: cat.kind === "hdd" ? "Prijs per stuk (€)" : "Prijs (€)", get: (i) => (cat.kind === "hdd" ? i.price_each : i.price) };
    const conds = [price];
    if (cat.kind === "minipc") conds.push({ k: "score", label: "Score (0–10)", get: (i) => i.score });
    if (cat.metric !== "price") conds.push({ k: "metric", label: metricLabel(cat), get: (i) => i.metric });
    const dlg = el("dialog", { class: "sheet" });
    const preview = el("div", { class: "bulk-prev", "aria-live": "polite" });
    const applyBtn = el("button", { type: "submit", class: "btn primary", disabled: true }, "Toepassen");
    const form = el("form", { class: "dlg", method: "dialog", novalidate: true },
      el("h2", {}, "Bulk bewerken"),
      el("p", { class: "muted small" }, "Markeer in één keer alle actieve advertenties die aan je voorwaarden voldoen. Lege velden tellen niet mee. Advertenties die je als interessant markeerde blijven staan, behalve als je \"Markeringen wissen\" kiest."),
      el("fieldset", { class: "kinds" }, el("legend", {}, "Welke advertenties"),
        el("label", { class: "kind-opt" }, el("input", { type: "radio", name: "scope", value: "all", checked: true }), el("span", {}, el("b", {}, "Alle actieve advertenties in dit tabblad"))),
        el("label", { class: "kind-opt" }, el("input", { type: "radio", name: "scope", value: "list" }), el("span", {}, el("b", {}, "Alleen wat nu in de lijst staat"), el("small", {}, "Met je huidige zoekopdracht, snelfilter en kolomfilters.")))),
      el("fieldset", { class: "kinds" }, el("legend", {}, "Voorwaarden (alles moet kloppen)"),
        conds.map((c) => el("div", { class: "fld-row cond" },
          el("label", { class: "fld" }, `${c.label}, vanaf`, el("input", { type: "text", inputmode: "decimal", name: `${c.k}-min`, placeholder: "geen" })),
          el("label", { class: "fld" }, "tot en met", el("input", { type: "text", inputmode: "decimal", name: `${c.k}-max`, placeholder: "geen" }))))),
      el("fieldset", { class: "kinds" }, el("legend", {}, "Wat doen"),
        [["seen", "Markeren als gezien (niet interessant)", true], ["fav", "Markeren als interessant", false], ["clear", "Markeringen wissen", false]].map(([v, t, on]) =>
          el("label", { class: "kind-opt" }, el("input", { type: "radio", name: "action", value: v, checked: on }), el("span", {}, el("b", {}, t))))),
      preview,
      el("div", { class: "dlg-btns" }, el("button", { type: "button", class: "btn", "data-x": "1" }, "Annuleren"), applyBtn));
    dlg.append(form);

    let matches = [];
    const compute = () => {
      const scope = form.elements.scope.value, action = form.elements.action.value;
      const limits = conds.map((c) => ({ c, min: parseNum(form.elements[`${c.k}-min`].value), max: parseNum(form.elements[`${c.k}-max`].value) }))
        .filter((l) => (l.min !== null && !Number.isNaN(l.min)) || (l.max !== null && !Number.isNaN(l.max)));
      const hasCond = limits.length > 0;
      const base = scope === "list" ? new Set(visibleIds()) : null;
      matches = !hasCond && scope === "all" ? [] : items.filter((i) => {
        if (!i.active) return false;
        if (base && !base.has(i.id)) return false;
        if (action !== "clear" && UserState.isFav(i.id) && action === "seen") return false;
        return limits.every(({ c, min, max }) => {
          const v = c.get(i);
          if (v === null || v === undefined) return false;
          return (min === null || Number.isNaN(min) || v >= min) && (max === null || Number.isNaN(max) || v <= max);
        });
      });
      const sample = matches.slice(0, 5);
      preview.replaceChildren(
        el("p", { class: "bulk-count" }, !hasCond && scope === "all" ? "Vul minstens één voorwaarde in, of kies \"Alleen wat nu in de lijst staat\"."
          : matches.length ? `${matches.length} advertentie${matches.length === 1 ? "" : "s"} voldoen.` : "Geen advertenties voldoen aan deze voorwaarden."),
        sample.length ? el("ul", { class: "pts" }, sample.map((i) => el("li", {}, i.title)), matches.length > 5 ? el("li", { class: "muted" }, `… en ${matches.length - 5} meer`) : null) : null);
      applyBtn.disabled = matches.length === 0;
      applyBtn.textContent = matches.length ? `Toepassen op ${matches.length}` : "Toepassen";
    };
    form.addEventListener("input", compute);
    form.addEventListener("change", compute);
    dlg.addEventListener("click", (e) => { if (e.target.closest("[data-x]")) dlg.close(); });
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      if (!matches.length) return;
      const action = form.elements.action.value;
      const ids = matches.map((i) => i.id);
      const snap = Object.fromEntries(ids.map((id) => [id, UserState.getRaw(id)]));
      UserState.patch(ids, action === "seen" ? { s: 1, f: 0 } : action === "fav" ? { f: 1, s: 0 } : { s: 0, f: 0 });
      dlg.close();
      const what = { seen: "als gezien gemarkeerd", fav: "als interessant gemarkeerd", clear: "weer gewist" }[action];
      toast(`${ids.length} advertentie${ids.length === 1 ? "" : "s"} ${what}.`, { undo: () => UserState.restore(snap) });
    });
    dlg.addEventListener("close", () => dlg.remove());
    document.body.append(dlg);
    compute();
    dlg.showModal();
  }

  return { apply, openEdit, openBulk };
})();
