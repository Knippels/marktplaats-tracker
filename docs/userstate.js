"use strict";
/*
 * "Gezien" en favorieten, gesynchroniseerd via de GitHub-API.
 *
 * - Altijd lokaal opgeslagen (localStorage), zodat het ook offline/zonder token werkt.
 * - Met een GitHub-token (fine-grained, alleen deze repo, Contents: read & write) wordt het
 *   bestand state.json op de branch "user-state" gelezen en bijgewerkt. Die branch triggert
 *   geen scraper-run en geen nieuwe publicatie.
 * - Zonder token wordt de gedeelde stand wel gelezen (de repo is openbaar), maar niet geschreven.
 * - Samenvoegen per advertentie: de laatst gewijzigde markering wint (veld t = tijdstip).
 */
const UserState = (() => {
  const GH = { owner: "Knippels", repo: "marktplaats-tracker", branch: "user-state", path: "state.json" };
  const API = `https://api.github.com/repos/${GH.owner}/${GH.repo}/contents/${GH.path}`;
  const LS_DATA = "userState:v1", LS_TOKEN = "ghToken";
  const listeners = new Set();

  const ls = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* geen opslag */ } },
  };

  let items = {};          // id -> { s: 0|1 (gezien), f: 0|1 (favoriet), t: ms }
  let sha = null;          // versie van state.json op GitHub
  let status = "lokaal";   // lokaal | laden | ok | alleen-lezen | fout
  let statusMsg = "";
  let timer = null;
  try { items = JSON.parse(ls.get(LS_DATA) || "{}").items || {}; } catch { items = {}; }

  const token = () => ls.get(LS_TOKEN);
  const emit = () => listeners.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });
  const saveLocal = () => ls.set(LS_DATA, JSON.stringify({ items }));
  const setStatus = (s, msg = "") => { status = s; statusMsg = msg; emit(); };

  const b64decode = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\n/g, "")), (c) => c.charCodeAt(0)));
  const b64encode = (str) => {
    const bytes = new TextEncoder().encode(str);
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  };

  function merge(remote) {
    let changedLocal = false, localNewer = false;
    for (const [id, r] of Object.entries(remote || {})) {
      const l = items[id];
      if (!l || r.t > l.t) { items[id] = r; changedLocal = true; }
    }
    for (const [id, l] of Object.entries(items)) {
      const r = (remote || {})[id];
      if (!r || l.t > r.t) localNewer = true;
    }
    return { changedLocal, localNewer };
  }

  async function fetchRemote() {
    const headers = { Accept: "application/vnd.github+json" };
    if (token()) headers.Authorization = `Bearer ${token()}`;
    const r = await fetch(`${API}?ref=${GH.branch}&t=${Date.now()}`, { headers, cache: "no-store" });
    if (r.status === 404) return { items: {}, sha: null };
    if (r.status === 401) throw new Error("Token ongeldig of verlopen");
    if (!r.ok) throw new Error(`GitHub ${r.status}`);
    const j = await r.json();
    return { items: JSON.parse(b64decode(j.content)).items || {}, sha: j.sha };
  }

  async function push() {
    const body = {
      message: "user-state: gezien/favorieten bijgewerkt",
      content: b64encode(JSON.stringify({ updated: new Date().toISOString(), items }, null, 0)),
      branch: GH.branch,
    };
    if (sha) body.sha = sha;
    const r = await fetch(API, {
      method: "PUT",
      headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token()}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (r.status === 409 || r.status === 422) return false;     // iemand anders schreef ertussen
    if (r.status === 401 || r.status === 403) throw new Error("Geen schrijfrechten (token/rechten controleren)");
    if (r.status === 404) throw new Error("Branch 'user-state' niet gevonden");
    if (!r.ok) throw new Error(`GitHub ${r.status}`);
    sha = (await r.json()).content.sha;
    return true;
  }

  async function sync() {
    clearTimeout(timer);
    setStatus("laden");
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const remote = await fetchRemote();
        sha = remote.sha;
        const { changedLocal, localNewer } = merge(remote.items);
        saveLocal();
        if (changedLocal) emit();
        if (!token()) { setStatus("alleen-lezen", "Geen token: wijzigingen blijven in deze browser"); return; }
        if (!localNewer || await push()) { setStatus("ok", "Gesynchroniseerd met GitHub"); return; }
      }
      throw new Error("Kon niet synchroniseren (conflict)");
    } catch (e) {
      setStatus("fout", e.message || String(e));
    }
  }

  function set(id, key, value) {
    const cur = items[id] || { s: 0, f: 0, t: 0 };
    items[id] = { ...cur, [key]: value ? 1 : 0, t: Date.now() };
    saveLocal();
    emit();
    clearTimeout(timer);
    timer = setTimeout(sync, 1500);    // klikken bundelen tot één commit
  }

  function setMany(ids, key, value) {
    const t = Date.now();
    for (const id of ids) items[id] = { ...(items[id] || { s: 0, f: 0 }), [key]: value ? 1 : 0, t };
    saveLocal();
    emit();
    clearTimeout(timer);
    timer = setTimeout(sync, 1500);
  }

  window.addEventListener("beforeunload", () => { if (timer) { clearTimeout(timer); sync(); } });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") sync(); });

  return {
    isSeen: (id) => Boolean(items[id]?.s),
    isFav: (id) => Boolean(items[id]?.f),
    toggleSeen: (id) => set(id, "s", !items[id]?.s),
    toggleFav: (id) => set(id, "f", !items[id]?.f),
    markSeen: (id) => { if (!items[id]?.s) set(id, "s", 1); },
    markAllSeen: (ids) => setMany(ids.filter((id) => !items[id]?.s), "s", 1),
    onChange: (fn) => listeners.add(fn),
    status: () => ({ status, statusMsg, hasToken: Boolean(token()) }),
    setToken: (t) => { ls.set(LS_TOKEN, t ? t.trim() : null); sync(); },
    sync,
  };
})();
