"use strict";
/* Gedeelde hulpmiddelen: opmaak, DOM, iconen, meldingen en de markeringen interessant/gezien. */

const fmtEur = new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const fmtEur2 = new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const fmtDay = new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "short" });
const dash = "–";
const num = (v, unit = "") => (v === null || v === undefined ? dash : `${String(v).replace(".", ",")}${unit}`);
const f1 = (n) => Number(n).toFixed(1).replace(".", ",");

function storeGet(key) { try { return localStorage.getItem(key); } catch { return null; } }
function storeSet(key, val) { try { localStorage.setItem(key, val); } catch { /* geen opslag */ } }
function storeJSON(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }

function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k === "style") n.setAttribute("style", v);
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) n.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat(Infinity)) if (c !== null && c !== undefined && c !== false) n.append(c);
  return n;
}

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function metricLabel(cat) { return { price_per_tb: "€/TB", price_per_score: "€ per scorepunt" }[cat.metric] || "prijs"; }
function fmtMetric(cat, v) {
  if (v === null || v === undefined) return dash;
  if (cat.metric === "price_per_tb") return fmtEur2.format(v) + "/TB";
  if (cat.metric === "price_per_score") return fmtEur2.format(v) + "/punt";
  return fmtEur.format(v);
}
function fmtPrice(item) {
  if (item.price === null || item.price === undefined) {
    return { FAST_BID: "Bieden", SEE_DESCRIPTION: "Zie omschrijving", FREE: "Gratis", EXCHANGE: "Ruilen", RESERVED: "Gereserveerd" }[item.price_type] || dash;
  }
  return (item.price_type === "MIN_BID" ? "vanaf " : "") + fmtEur.format(item.price);
}

/* ---- iconen (gevuld, afgeronde vormen) ---- */
const ICONS = {
  star: "M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z",
  check: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z",
  chevron: "M10 6 8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z",
  close: "M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z",
  add: "M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6z",
  edit: "M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a.996.996 0 0 0 0-1.41l-2.34-2.34a.996.996 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z",
  trash: "M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z",
  open: "M19 19H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z",
  columns: "M10 18h5V5h-5v13zm-6 0h5V5H4v13zM16 5v13h5V5h-5z",
  filter: "M10 18h4v-2h-4v2zM3 6v2h18V6H3zm3 7h12v-2H6v2z",
  tune: "M3 17v2h6v-2H3zM3 5v2h10V5H3zm10 16v-2h8v-2h-8v-2h-2v6h2zM7 9v2H3v2h4v2h2V9H7zm14 4v-2H11v2h10zm-6-4h2V7h4V5h-4V3h-2v6z",
  compare: "M9.01 14H2v2h7.01v3L13 15l-3.99-4v3zm5.98-1v-3H22V8h-7.01V5L11 9l3.99 4z",
  info: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z",
  drag: "M11 18c0 1.1-.9 2-2 2s-2-.9-2-2 .9-2 2-2 2 .9 2 2zm-2-8c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0-6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm6 4c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z",
  undo: "M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z",
  sort: "M3 18h6v-2H3v2zM3 6v2h18V6H3zm0 7h12v-2H3v2z",
};
const SVGNS = "http://www.w3.org/2000/svg";
function icon(name, size = 18) {
  const s = document.createElementNS(SVGNS, "svg");
  s.setAttribute("viewBox", "0 0 24 24");
  s.setAttribute("width", size);
  s.setAttribute("height", size);
  s.setAttribute("fill", "currentColor");
  s.setAttribute("aria-hidden", "true");
  s.setAttribute("class", "ic");
  const p = document.createElementNS(SVGNS, "path");
  p.setAttribute("d", ICONS[name]);
  s.append(p);
  return s;
}
const btnLabel = (name, text) => [icon(name, 16), el("span", {}, text)];

/* ---- meldingen met "ongedaan maken" ---- */
let toastTimer = null;
function toast(message, opts = {}) {
  let box = document.getElementById("toasts");
  if (!box) { box = el("div", { id: "toasts", "aria-live": "polite" }); document.body.append(box); }
  clearTimeout(toastTimer);
  const parts = [el("span", {}, message)];
  if (opts.undo) {
    parts.push(el("button", { type: "button", class: "toast-undo", onclick: () => { box.replaceChildren(); opts.undo(); } }, btnLabel("undo", "Ongedaan maken")));
  }
  if (opts.error) parts.unshift(el("span", { class: "toast-flag" }, "Mislukt"));
  box.replaceChildren(el("div", { class: "toast" + (opts.error ? " error" : "") }, parts));
  toastTimer = setTimeout(() => box.replaceChildren(), opts.error ? 12000 : 7000);
}

/* ---- markeringen: interessant (f) en gezien, dus niet interessant (s) ---- */
function markInteresting(id) {
  const was = UserState.isFav(id), wasSeen = UserState.isSeen(id);
  if (!was && wasSeen) UserState.toggleSeen(id);
  UserState.toggleFav(id);
  toast(was ? "Niet meer interessant" : "Gemarkeerd als interessant", {
    undo: () => { UserState.toggleFav(id); if (!was && wasSeen) UserState.toggleSeen(id); },
  });
}
function markSeen(id) {
  const was = UserState.isSeen(id), wasFav = UserState.isFav(id);
  if (!was && wasFav) UserState.toggleFav(id);
  UserState.toggleSeen(id);
  toast(was ? "Weer als niet gezien gemarkeerd" : "Gezien, niet interessant", {
    undo: () => { UserState.toggleSeen(id); if (!was && wasFav) UserState.toggleFav(id); },
  });
}

async function getJSON(url) {
  const r = await fetch(url, { cache: "no-cache" });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}
