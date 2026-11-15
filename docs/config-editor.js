"use strict";
/*
 * Tabbladen toevoegen, bewerken en verwijderen.
 * Dat gaat door config.yml in de repo aan te passen via de GitHub-API (zelfde token als voor synchroniseren).
 * Daarna draait de scraper automatisch en verschijnt de wijziging op de pagina.
 * We lezen en schrijven config.yml als tekst, zodat commentaar en opmaak behouden blijven.
 */
const ConfigEditor = (() => {
  const GH = { owner: "Knippels", repo: "marktplaats-tracker", branch: "main", path: "config.yml" };
  const API = `https://api.github.com/repos/${GH.owner}/${GH.repo}/contents/${GH.path}`;
  const KINDS = [
    ["algemeen", "Algemeen", "Alles waar je op prijs wilt vergelijken"],
    ["hdd", "Harde schijven", "Prijs per TB, grootte en aantal"],
    ["minipc", "Mini-pc's", "Score voor Proxmox en Jellyfin, RAM, opslag"],
    ["enclosure", "Behuizingen (DAS/NAS)", "Bays, aansluitingen, meegeleverde opslag"],
  ];
  const METRIC_FOR = { algemeen: "price", hdd: "price_per_tb", minipc: "price_per_score", enclosure: "price" };
  const PENDING = "pendingTabs", DELETED = "deletedTabs";

  /* ---- tekst-hulpjes ---- */
  const b64decode = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\n/g, "")), (c) => c.charCodeAt(0)));
  const b64encode = (str) => {
    const bytes = new TextEncoder().encode(str);
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  };
  const q = (s) => JSON.stringify(s);                                    // dubbele aanhalingstekens, veilig voor YAML
  const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const slug = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

  /* ---- config.yml in blokken ---- */
  function split(text) {
    const lines = text.replace(/\r\n/g, "\n").split("\n");
    const start = lines.findIndex((l) => /^categories:\s*$/.test(l));
    if (start < 0) throw new Error("In config.yml staat geen 'categories:'.");
    const idx = [];
    for (let i = start + 1; i < lines.length; i++) if (/^  - id:\s/.test(lines[i])) idx.push(i);
    const blocks = idx.map((from, n) => {
      let to = n + 1 < idx.length ? idx[n + 1] : lines.length;
      while (to > from + 1 && lines[to - 1].trim() === "") to--;       // lege regels horen niet bij het blok
      const id = /^  - id:\s*["']?([a-z0-9-]+)/.exec(lines[from])[1];
      return { id, from, to };
    });
    return { lines, blocks, end: lines.length };
  }

  const scalar = (lines, key) => {
    for (const l of lines) {
      const m = new RegExp(`^    ${key}:\\s*(.*)$`).exec(l);
      if (!m) continue;
      let v = m[1].trim();
      if (/^["']/.test(v)) { const quote = v[0]; const e = v.lastIndexOf(quote); v = v.slice(1, e > 0 ? e : undefined); if (quote === "'") v = v.replace(/''/g, "'"); else v = v.replace(/\\"/g, '"'); }
      else v = v.replace(/\s+#.*$/, "");
      return v;
    }
    return "";
  };
  function listOf(lines, key) {
    const i = lines.findIndex((l) => new RegExp(`^    ${key}:\\s*$`).test(l));
    if (i < 0) return [];
    const out = [];
    for (let j = i + 1; j < lines.length; j++) {
      const m = /^      -\s+(.*)$/.exec(lines[j]);
      if (!m) break;
      let v = m[1].trim().replace(/\s+#.*$/, "");
      if (/^"/.test(v)) { try { v = JSON.parse(v); } catch { v = v.slice(1, -1); } } else if (/^'/.test(v)) v = v.slice(1, -1).replace(/''/g, "'");
      out.push(v);
    }
    return out;
  }
  const parseBlock = (blockLines) => ({
    id: /^  - id:\s*["']?([a-z0-9-]+)/.exec(blockLines[0])[1],
    name: scalar(blockLines, "name"),
    kind: scalar(blockLines, "kind") || "algemeen",
    queries: listOf(blockLines, "queries"),
    min_price: scalar(blockLines, "min_price"),
    max_price: scalar(blockLines, "max_price"),
    deal_max: scalar(blockLines, "deal_max"),
    metric: scalar(blockLines, "metric"),
  });

  /* Zet of verwijder één eenvoudige regel (`    key: waarde`) in een blok. */
  function setLine(lines, key, value) {
    const re = new RegExp(`^    ${key}:`);
    const i = lines.findIndex((l) => re.test(l));
    const hasVal = value !== "" && value !== null && value !== undefined;
    if (i >= 0) { if (hasVal) lines[i] = `    ${key}: ${value}`; else lines.splice(i, 1); }
    else if (hasVal) lines.push(`    ${key}: ${value}`);
  }
  function setQueries(lines, queries) {
    const i = lines.findIndex((l) => /^    queries:\s*$/.test(l));
    const newLines = ["    queries:", ...queries.map((s) => `      - ${q(s)}`)];
    if (i < 0) { lines.push(...newLines); return; }
    let j = i + 1;
    while (j < lines.length && /^      -\s/.test(lines[j])) j++;
    lines.splice(i, j - i, ...newLines);
  }
  /* Extra woorden achter in de bestaande exclude-regex zetten. Lukt dat niet, dan geven we dat terug. */
  function addExclude(lines, words) {
    if (!words.length) return null;
    const alt = words.map(escRe).join("|");
    const i = lines.findIndex((l) => /^    exclude:/.test(l));
    if (i < 0) { lines.push(`    exclude: ${q("\\b(" + alt + ")\\b")}`); return null; }
    const l = lines[i];
    const m = /^(    exclude:\s*)(["'])(.*)(\)\\b)\2(\s*(#.*)?)$/.exec(l);
    if (!m) return "De bestaande uitsluit-regel past niet in dit formaat; pas die handmatig aan in config.yml.";
    const add = m[2] === "'" ? alt.replace(/'/g, "''") : alt.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    lines[i] = `${m[1]}${m[2]}${m[3]}|${add}${m[4]}${m[2]}${m[5]}`;
    return null;
  }

  function buildBlock(f) {
    const lines = [`  - id: ${f.id}`, `    name: ${q(f.name)}`, `    kind: ${f.kind}`];
    setQueries(lines, f.queries);
    if (f.exclude.length) addExclude(lines, f.exclude);
    if (f.min_price !== "") lines.push(`    min_price: ${f.min_price}`);
    if (f.max_price !== "") lines.push(`    max_price: ${f.max_price}`);
    lines.push(`    metric: ${METRIC_FOR[f.kind]}`);
    if (f.deal_max !== "") lines.push(`    deal_max: ${f.deal_max}`);
    return lines;
  }

  /* ---- wijzigingen als functie op de tekst ---- */
  const mutations = {
    add(f) {
      return (text) => {
        const { lines, blocks } = split(text);
        if (blocks.some((b) => b.id === f.id)) throw new Error(`Er bestaat al een tabblad met id "${f.id}".`);
        const at = blocks.length ? blocks[blocks.length - 1].to : lines.length;
        lines.splice(at, 0, "", ...buildBlock(f));
        return lines.join("\n").replace(/\n*$/, "\n");
      };
    },
    edit(id, f) {
      return (text) => {
        const { lines, blocks } = split(text);
        const b = blocks.find((x) => x.id === id);
        if (!b) throw new Error("Dit tabblad staat niet meer in config.yml. Ververs de pagina.");
        const sub = lines.slice(b.from, b.to);
        setLine(sub, "name", q(f.name));
        setQueries(sub, f.queries);
        setLine(sub, "min_price", f.min_price);
        setLine(sub, "max_price", f.max_price);
        setLine(sub, "deal_max", f.deal_max);
        const warn = addExclude(sub, f.exclude);
        if (warn) mutations._warn = warn;
        lines.splice(b.from, b.to - b.from, ...sub);
        return lines.join("\n").replace(/\n*$/, "\n");
      };
    },
    remove(id) {
      return (text) => {
        const { lines, blocks } = split(text);
        const n = blocks.findIndex((x) => x.id === id);
        if (n < 0) throw new Error("Dit tabblad staat niet meer in config.yml. Ververs de pagina.");
        if (blocks.length === 1) throw new Error("Het laatste tabblad kun je niet verwijderen.");
        const b = blocks[n];
        let to = b.to;
        while (to < lines.length && lines[to].trim() === "" && n + 1 < blocks.length) to++;
        lines.splice(b.from, to - b.from);
        return lines.join("\n").replace(/\n*$/, "\n");
      };
    },
  };

  /* ---- GitHub ---- */
  const token = () => UserState.getToken();
  const headers = (write) => ({ Accept: "application/vnd.github+json", ...(token() ? { Authorization: `Bearer ${token()}` } : {}), ...(write ? { "Content-Type": "application/json" } : {}) });

  async function load() {
    const r = await fetch(`${API}?ref=${GH.branch}&t=${Date.now()}`, { headers: headers(false), cache: "no-store" });
    if (r.status === 401) throw new Error("Token ongeldig of verlopen. Stel het opnieuw in via de synchronisatieknop.");
    if (!r.ok) throw new Error(`config.yml lezen mislukt (GitHub ${r.status})`);
    const j = await r.json();
    return { text: b64decode(j.content), sha: j.sha };
  }

  async function commit(mutate, message) {
    if (!token()) throw new Error("NO_TOKEN");
    for (let attempt = 0; attempt < 3; attempt++) {
      const { text, sha } = await load();
      const next = mutate(text);
      if (next === text) return { changed: false, text };
      const r = await fetch(API, { method: "PUT", headers: headers(true), body: JSON.stringify({ message, content: b64encode(next), sha, branch: GH.branch }) });
      if (r.status === 409 || r.status === 422) continue;               // iemand schreef ertussen: opnieuw proberen op de nieuwste versie
      if (r.status === 401 || r.status === 403) throw new Error("Geen schrijfrechten op config.yml. Het token heeft 'Contents: Read and write' nodig voor deze repo.");
      if (!r.ok) throw new Error(`Opslaan mislukt (GitHub ${r.status})`);
      return { changed: true, previous: text, text: next };
    }
    throw new Error("Opslaan mislukt door een conflict. Probeer het zo nog eens.");
  }

  async function restore(previousText, message) {
    return commit(() => previousText, message);
  }

  /* ---- wachtende wijzigingen (tot de scraper de index heeft bijgewerkt) ---- */
  const pending = () => storeJSON(PENDING, []);
  const deleted = () => storeJSON(DELETED, []);
  const setPending = (v) => storeSet(PENDING, JSON.stringify(v));
  const setDeleted = (v) => storeSet(DELETED, JSON.stringify(v));

  /* Combineert de index van de scraper met wat de bezoeker net heeft gewijzigd. */
  function overlay(categories) {
    const ids = new Set(categories.map((c) => c.id));
    setPending(pending().filter((p) => !ids.has(p.id)));
    setDeleted(deleted().filter((id) => ids.has(id)));
    const gone = new Set(deleted());
    return [...categories.filter((c) => !gone.has(c.id)), ...pending().map((p) => ({ id: p.id, name: p.name, kind: p.kind, pending: true }))];
  }

  /* ---- formulier ---- */
  function validate(f, { editing, existingIds }) {
    const errors = {};
    f.name = f.name.trim();
    if (!f.name) errors.name = "Geef het tabblad een naam.";
    else if (f.name.length > 30) errors.name = "Houd de naam onder 30 tekens, anders past hij niet in de tabbalk.";
    if (!editing) {
      f.id = slug(f.name);
      if (!f.id) errors.name = "Gebruik letters of cijfers in de naam.";
      else if (existingIds.includes(f.id)) errors.name = "Er is al een tabblad met (bijna) dezelfde naam.";
    }
    f.queries = [...new Set(f.queries.map((s) => s.trim()).filter(Boolean))];
    if (!f.queries.length) errors.queries = "Voer minstens één zoekopdracht in.";
    else if (f.queries.length > 40) errors.queries = "Maximaal 40 zoekopdrachten per tabblad.";
    else if (f.queries.some((s) => s.length > 80)) errors.queries = "Een zoekopdracht is maximaal 80 tekens.";
    for (const k of ["min_price", "max_price", "deal_max"]) {
      f[k] = String(f[k]).trim().replace(",", ".");
      if (f[k] !== "" && !(Number(f[k]) >= 0)) errors[k] = "Vul een getal in, bijvoorbeeld 150.";
    }
    if (!errors.min_price && !errors.max_price && f.min_price !== "" && f.max_price !== "" && Number(f.min_price) > Number(f.max_price)) errors.max_price = "De hoogste prijs moet boven de laagste liggen.";
    f.exclude = f.exclude.split(",").map((s) => s.trim()).filter(Boolean);
    if (f.exclude.some((s) => s.length > 40)) errors.exclude = "Een woord is maximaal 40 tekens.";
    return errors;
  }

  function openForm({ cat, categories, onSaved }) {
    const editing = Boolean(cat);
    const cur = editing ? cat : { id: "", name: "", kind: "algemeen", queries: [], min_price: "", max_price: "", deal_max: "" };
    const err = (k) => el("p", { class: "fld-err", "data-err": k, role: "alert" });
    const dlg = el("dialog", { class: "sheet" });
    const kindOpts = KINDS.map(([v, label, hint]) =>
      el("label", { class: "kind-opt" }, el("input", { type: "radio", name: "kind", value: v, checked: cur.kind === v, disabled: editing }),
        el("span", {}, el("b", {}, label), el("small", {}, hint))));
    const unit = () => ({ hdd: "€ per TB", minipc: "€ per scorepunt" }[form.kind.value] || "€");
    const form = el("form", { class: "dlg tabform", method: "dialog", novalidate: true },
      el("h2", {}, editing ? `Tabblad "${cur.name}" bewerken` : "Nieuw tabblad"),
      el("label", { class: "fld" }, "Naam", el("input", { type: "text", name: "name", value: cur.name, maxlength: 30, placeholder: "Bijvoorbeeld: Switches 2,5 GbE", autocomplete: "off" }), err("name")),
      el("fieldset", { class: "kinds" }, el("legend", {}, "Soort"),
        el("p", { class: "muted small" }, editing ? "Het soort kun je niet wijzigen; dat bepaalt de kolommen. Maak een nieuw tabblad als je een ander soort wilt." : "Dit bepaalt welke kolommen en welke vergelijking je krijgt."),
        kindOpts),
      el("label", { class: "fld" }, "Zoekopdrachten op Marktplaats (één per regel)",
        el("textarea", { name: "queries", rows: 6, placeholder: "switch 2.5gbe\nmikrotik crs\n…" }, cur.queries.join("\n")), err("queries")),
      el("div", { class: "fld-row" },
        el("label", { class: "fld" }, "Laagste prijs (€)", el("input", { type: "text", inputmode: "decimal", name: "min_price", value: cur.min_price, placeholder: "geen" }), err("min_price")),
        el("label", { class: "fld" }, "Hoogste prijs (€)", el("input", { type: "text", inputmode: "decimal", name: "max_price", value: cur.max_price, placeholder: "geen" }), err("max_price"))),
      el("label", { class: "fld" }, el("span", { class: "deal-label" }, "Deal vanaf (optioneel)"),
        el("input", { type: "text", inputmode: "decimal", name: "deal_max", value: cur.deal_max, placeholder: "leeg = goedkoopste 25%" }),
        el("small", { class: "muted" }, "Een vaste grens, in dezelfde eenheid als de vergelijking. Leeg laten betekent: de goedkoopste kwart is een deal."), err("deal_max")),
      el("label", { class: "fld" }, "Titels met deze woorden overslaan (optioneel)",
        el("input", { type: "text", name: "exclude", placeholder: "defect, gezocht, onderdelen", autocomplete: "off" }),
        el("small", { class: "muted" }, editing ? "Komt er bij de bestaande uitsluitingen bij." : "Gescheiden door komma's."), err("exclude")),
      el("p", { class: "fld-err form-err", "data-err": "form", role: "alert" }),
      el("p", { class: "muted small" }, "Opslaan past config.yml aan in de repo. De scraper draait daarna automatisch; nieuwe resultaten zie je na een paar minuten."),
      el("div", { class: "dlg-btns" },
        el("button", { type: "button", class: "btn", "data-x": "1" }, "Annuleren"),
        el("button", { type: "submit", class: "btn primary", "data-save": "1" }, editing ? "Wijzigingen opslaan" : "Tabblad toevoegen")));
    dlg.append(form);

    const showErrors = (errors) => {
      form.querySelectorAll("[data-err]").forEach((p) => { p.textContent = errors[p.dataset.err] || ""; });
      const first = Object.keys(errors).find((k) => form.elements[k]);
      if (first) form.elements[first].focus();
    };
    dlg.addEventListener("click", (e) => { if (e.target.closest("[data-x]")) dlg.close(); });
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = {
        id: cur.id, name: form.elements.name.value, kind: editing ? cur.kind : form.elements.kind.value,
        queries: form.elements.queries.value.split("\n"), min_price: form.elements.min_price.value, max_price: form.elements.max_price.value,
        deal_max: form.elements.deal_max.value, exclude: form.elements.exclude.value,
      };
      const errors = validate(f, { editing, existingIds: categories.map((c) => c.id) });
      showErrors(errors);
      if (Object.keys(errors).length) return;
      const btn = form.querySelector("[data-save]");
      btn.disabled = true;
      btn.textContent = "Opslaan…";
      try {
        mutations._warn = null;
        const res = await commit(editing ? mutations.edit(cur.id, f) : mutations.add(f),
          editing ? `config: tabblad ${f.name} bewerkt (via pagina)` : `config: tabblad ${f.name} toegevoegd (via pagina)`);
        if (!editing) setPending([...pending().filter((p) => p.id !== f.id), { id: f.id, name: f.name, kind: f.kind }]);
        dlg.close();
        const warn = mutations._warn;
        toast(editing ? "Opgeslagen. De scraper past de resultaten zo aan." : `Tabblad "${f.name}" toegevoegd. Resultaten volgen na de eerstvolgende run (paar minuten).`, {
          undo: res.changed ? async () => {
            try {
              await restore(res.previous, `config: wijziging aan ${f.name} ongedaan gemaakt (via pagina)`);
              if (!editing) setPending(pending().filter((p) => p.id !== f.id));
              onSaved();
              toast("Wijziging ongedaan gemaakt.");
            } catch (x) { toast(x.message, { error: true }); }
          } : null,
        });
        if (warn) setTimeout(() => toast(warn, { error: true }), 300);
        onSaved(f.id);
      } catch (x) {
        btn.disabled = false;
        btn.textContent = editing ? "Wijzigingen opslaan" : "Tabblad toevoegen";
        showErrors({ form: x.message === "NO_TOKEN" ? "Er is geen GitHub-token ingesteld." : x.message });
      }
    });
    dlg.addEventListener("close", () => dlg.remove());
    document.body.append(dlg);
    dlg.showModal();
    form.elements.name.focus();
  }

  async function remove(cat, onDone) {
    try {
      const res = await commit(mutations.remove(cat.id), `config: tabblad ${cat.name} verwijderd (via pagina)`);
      setDeleted([...deleted(), cat.id]);
      setPending(pending().filter((p) => p.id !== cat.id));
      onDone();
      toast(`Tabblad "${cat.name}" verwijderd. De bewaarde gegevens blijven in de repo staan.`, {
        undo: res.changed ? async () => {
          try {
            await restore(res.previous, `config: tabblad ${cat.name} hersteld (via pagina)`);
            setDeleted(deleted().filter((id) => id !== cat.id));
            onDone();
            toast(`Tabblad "${cat.name}" is terug.`);
          } catch (x) { toast(x.message, { error: true }); }
        } : null,
      });
    } catch (x) {
      toast(x.message === "NO_TOKEN" ? "Er is geen GitHub-token ingesteld." : x.message, { error: true });
    }
  }

  /* ---- beheerscherm ---- */
  async function openManage({ categories, onChange, openSync }) {
    if (!token()) {
      const dlg = el("dialog", { class: "sheet" }, el("div", { class: "dlg" },
        el("h2", {}, "Eerst een GitHub-token instellen"),
        el("p", {}, "Tabbladen wijzig je door config.yml in de repo aan te passen. Daarvoor heeft deze pagina je GitHub-token nodig, hetzelfde token als voor het synchroniseren van interessant en gezien."),
        el("div", { class: "dlg-btns" },
          el("button", { type: "button", class: "btn", "data-x": "1" }, "Sluiten"),
          el("button", { type: "button", class: "btn primary", "data-sync": "1" }, "Token instellen"))));
      dlg.addEventListener("click", (e) => { if (e.target.closest("[data-x]")) dlg.close(); if (e.target.closest("[data-sync]")) { dlg.close(); openSync(); } });
      dlg.addEventListener("close", () => dlg.remove());
      document.body.append(dlg);
      dlg.showModal();
      return;
    }
    const dlg = el("dialog", { class: "sheet" });
    const draw = () => {
      const list = categories();
      dlg.replaceChildren(el("div", { class: "dlg" },
        el("div", { class: "dlg-top" }, el("h2", {}, "Tabbladen"),
          el("button", { type: "button", class: "icon-btn", "data-x": "1", title: "Sluiten", "aria-label": "Sluiten" }, icon("close"))),
        el("ul", { class: "tablist" }, list.map((c) => el("li", {},
          el("span", { class: "tl-name" }, c.name, c.pending ? el("span", { class: "badge new" }, "wordt aangemaakt") : null),
          el("span", { class: "tl-btns" },
            el("button", { type: "button", class: "icon-btn", "data-edit": c.id, title: `${c.name} bewerken`, "aria-label": `${c.name} bewerken`, disabled: c.pending }, icon("edit")),
            el("button", { type: "button", class: "icon-btn", "data-del": c.id, title: `${c.name} verwijderen`, "aria-label": `${c.name} verwijderen`, disabled: list.length < 2 }, icon("trash")))))),
        el("div", { class: "dlg-btns" }, el("button", { type: "button", class: "btn primary", "data-new": "1" }, btnLabel("add", "Nieuw tabblad")))));
    };
    dlg.addEventListener("click", async (e) => {
      if (e.target.closest("[data-x]")) { dlg.close(); return; }
      if (e.target.closest("[data-new]")) { dlg.close(); openForm({ categories: categories(), onSaved: onChange }); return; }
      const ed = e.target.closest("[data-edit]"), del = e.target.closest("[data-del]");
      if (ed) await editById(ed.dataset.edit, categories, onChange, dlg);
      if (del) { const c = categories().find((x) => x.id === del.dataset.del); if (c) { dlg.close(); await remove(c, onChange); } }
    });
    dlg.addEventListener("close", () => dlg.remove());
    draw();
    document.body.append(dlg);
    dlg.showModal();
  }

  async function editById(id, categories, onChange, dlgToClose) {
    try {
      const { text } = await load();
      const { lines, blocks } = split(text);
      const b = blocks.find((x) => x.id === id);
      if (!b) throw new Error("Dit tabblad staat niet in config.yml.");
      const cat = parseBlock(lines.slice(b.from, b.to));
      if (dlgToClose) dlgToClose.close();
      openForm({ cat, categories: categories(), onSaved: onChange });
    } catch (x) { toast(x.message, { error: true }); }
  }

  return { overlay, openManage, openNew: (categories, onChange) => openForm({ categories, onSaved: onChange }),
    edit: (id, categories, onChange) => editById(id, categories, onChange), remove, hasToken: () => Boolean(token()),
    /* voor tests */ _internal: { split, parseBlock, mutations, validate, slug } };
})();
