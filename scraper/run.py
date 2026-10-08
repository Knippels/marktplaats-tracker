"""Draait alle zoekopdrachten uit config.yml en werkt docs/data/*.json bij.

Gebruik:  python -m scraper.run [--config config.yml] [--out docs/data]
"""
from __future__ import annotations

import argparse
import json
import re
import statistics
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests
import yaml

from . import extract, marktplaats

NEW_WINDOW_HOURS = 48          # zo lang telt een advertentie als "nieuw"
INACTIVE_PRUNE_DAYS = 60       # verdwenen advertenties worden na zoveel dagen opgeruimd
HISTORY_MAX_DAYS = 730
DETAIL_BUDGET = 70             # max. detailpagina's per categorie per run (eenmalig per advertentie)
DESC_MAX = 3000


def now_utc() -> datetime:
    return datetime.now(timezone.utc).replace(microsecond=0)


def iso(dt: datetime) -> str:
    return dt.isoformat().replace("+00:00", "Z")


def parse_iso(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def kind_of(cat: dict) -> str:
    return cat.get("kind") or ("hdd" if cat.get("metric") == "price_per_tb" else "enclosure")


def enrich(item: dict, cat: dict) -> dict:
    """Vult merk/type/grootte/aantal/prijs per stuk/aansluitingen/opslag in (op basis van titel+omschrijving)."""
    fields = extract.extract(kind_of(cat), item["title"], item.get("description", ""),
                             item.get("price"), item.get("attrs"))
    item.update(fields)
    if cat.get("metric", "price") == "price_per_tb":
        item["metric"] = fields.get("price_per_tb")
    else:
        item["metric"] = item.get("price")
    return item


def matches(listing: dict, cat: dict) -> bool:
    text = f"{listing['title']} {listing.get('description', '')}"
    if cat.get("include") and not re.search(cat["include"], text, re.I):
        return False
    if cat.get("exclude") and re.search(cat["exclude"], listing["title"], re.I):
        return False
    price = listing.get("price")
    if price is not None:
        if cat.get("min_price") is not None and price < cat["min_price"]:
            return False
        if cat.get("max_price") is not None and price > cat["max_price"]:
            return False
    if cat.get("min_tb"):
        size = listing.get("size_tb")
        if size is None or size < cat["min_tb"]:
            return False
    return True


def percentile(values: list[float], pct: float) -> float:
    vs = sorted(values)
    if not vs:
        raise ValueError
    k = (len(vs) - 1) * pct / 100
    lo, hi = int(k), min(int(k) + 1, len(vs) - 1)
    return round(vs[lo] + (vs[hi] - vs[lo]) * (k - lo), 2)


def load_json(path: Path, default):
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return default


def scrape_category(cat: dict, cfg: dict, session: requests.Session) -> tuple[list[dict], bool]:
    found: dict[str, dict] = {}
    ok = True
    for q in cat["queries"]:
        try:
            for item in marktplaats.search(q, postcode=cfg.get("postcode"),
                                           distance_km=cfg.get("distance_km"), session=session):
                if matches(enrich(item, cat), cat):
                    found.setdefault(item["id"], item)
            print(f"  [{cat['id']}] '{q}': totaal {len(found)} passend", flush=True)
        except Exception as exc:  # noqa: BLE001 - één mislukte zoekterm mag de rest niet stoppen
            ok = False
            print(f"  [{cat['id']}] '{q}' MISLUKT: {exc}", file=sys.stderr, flush=True)
        time.sleep(2)
    return list(found.values()), ok


class Budget:
    def __init__(self, n: int):
        self.left = n


def update_category(cat: dict, fresh: list[dict], complete: bool, out_dir: Path, ts: datetime,
                    session: requests.Session | None = None, budget: Budget | None = None) -> dict:
    path = out_dir / f"{cat['id']}.json"
    data = load_json(path, {"listings": {}, "history": []})
    listings: dict[str, dict] = data.get("listings", {})
    metric = cat.get("metric", "price")
    stamp = iso(ts)
    seen_now = set()
    budget = budget or Budget(0)

    for item in fresh:
        seen_now.add(item["id"])
        prev = listings.get(item["id"]) or {}
        rec = {
            "title": item["title"],
            "url": item["url"],
            "image": item["image"],
            "city": item["city"],
            "seller": item["seller"],
            "source": item["source"],
            "posted": item["posted"],
            "price": item["price"],
            "price_type": item["price_type"],
            "reserved": bool(item.get("reserved")),
            "attrs": item.get("attrs") or prev.get("attrs") or {},
            "description": max([prev.get("description") or "", item.get("description") or ""], key=len),
            "detail": prev.get("detail") if prev.get("detail") is not True else 1,
            "highest_bid": prev.get("highest_bid"),
            "last_seen": stamp,
            "active": True,
        }
        # Volledige omschrijving eenmalig ophalen (voor aantal, prijs per stuk, aansluitingen, opslag)
        if (rec["detail"] or 0) < marktplaats.DETAIL_VERSION and session is not None and budget.left > 0 and rec["url"]:
            budget.left -= 1
            try:
                det = marktplaats.fetch_detail(rec["url"], session)
                if len(det.get("description") or "") > len(rec["description"]):
                    rec["description"] = det["description"]
                rec["highest_bid"] = det.get("highest_bid")
                rec["detail"] = marktplaats.DETAIL_VERSION
            except Exception as exc:  # noqa: BLE001
                print(f"    detail mislukt {rec['url']}: {exc}", file=sys.stderr, flush=True)
            time.sleep(1.5)
        rec["description"] = rec["description"][:DESC_MAX]
        if prev:
            rec["first_seen"] = prev["first_seen"]
            hist = prev.get("price_history", [])
            if item["price"] is not None and (not hist or hist[-1][1] != item["price"]):
                hist.append([stamp, item["price"]])
            rec["price_history"] = hist
        else:
            rec["first_seen"] = stamp
            rec["price_history"] = [[stamp, item["price"]]] if item["price"] is not None else []
        prices = [p for _, p in rec["price_history"]]
        rec["price_drop"] = len(prices) > 1 and prices[-1] < max(prices)
        listings[item["id"]] = rec

    # Alle opgeslagen advertenties opnieuw verrijken (verbeteringen in extract.py werken zo met terugwerkende kracht)
    # en opnieuw toetsen aan de (mogelijk aangescherpte) filters
    for v in listings.values():
        v.setdefault("description", "")
        enrich(v, cat)
    listings = {k: v for k, v in listings.items() if matches(v, cat)}

    # Alleen als ALLE zoekopdrachten lukten weten we zeker wat verdwenen is
    if complete:
        for lid, rec in listings.items():
            if lid not in seen_now:
                rec["active"] = False

    prune_before = ts - timedelta(days=INACTIVE_PRUNE_DAYS)
    listings = {k: v for k, v in listings.items()
                if v["active"] or parse_iso(v["last_seen"]) >= prune_before}

    # Deals bepalen
    active_vals = [v["metric"] for v in listings.values() if v["active"] and v["metric"] is not None]
    if cat.get("deal_max") is not None:
        threshold = float(cat["deal_max"])
    elif active_vals:
        threshold = percentile(active_vals, cat.get("deal_percentile", 25))
    else:
        threshold = None
    for v in listings.values():
        v["deal"] = bool(v["active"] and not v.get("reserved") and threshold is not None and v["metric"] is not None
                         and v["metric"] <= threshold)

    # Dagelijkse snapshot (laatste run van de dag overschrijft)
    history = [h for h in data.get("history", []) if h["date"] != ts.date().isoformat()]
    if active_vals:
        history.append({
            "date": ts.date().isoformat(),
            "count": len(active_vals),
            "min": min(active_vals),
            "p25": percentile(active_vals, 25),
            "median": round(statistics.median(active_vals), 2),
        })
    history = sorted(history, key=lambda h: h["date"])[-HISTORY_MAX_DAYS:]

    result = {
        "id": cat["id"],
        "name": cat["name"],
        "metric": metric,
        "kind": kind_of(cat),
        "queries": cat["queries"],
        "deal_threshold": threshold,
        "deal_rule": ("vast" if cat.get("deal_max") is not None
                      else f"goedkoopste {cat.get('deal_percentile', 25)}%"),
        "updated": stamp,
        "last_run_complete": complete,
        "history": history,
        "listings": listings,
    }
    path.write_text(json.dumps(result, ensure_ascii=False, indent=1), encoding="utf-8")
    return result


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default="config.yml")
    ap.add_argument("--out", default="docs/data")
    args = ap.parse_args(argv)

    cfg = yaml.safe_load(Path(args.config).read_text(encoding="utf-8"))
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    ts = now_utc()
    session = requests.Session()

    index = []
    any_ok = False
    for cat in cfg["categories"]:
        if not re.fullmatch(r"[a-z0-9-]+", cat["id"]):
            raise SystemExit(f"Ongeldige categorie-id: {cat['id']!r}")
        print(f"Categorie {cat['name']}", flush=True)
        fresh, complete = scrape_category(cat, cfg, session)
        any_ok = any_ok or complete or bool(fresh)
        res = update_category(cat, fresh, complete, out_dir, ts, session, Budget(DETAIL_BUDGET))
        active = [v for v in res["listings"].values() if v["active"]]
        index.append({
            "id": cat["id"],
            "name": cat["name"],
            "metric": res["metric"],
            "kind": res["kind"],
            "active": len(active),
            "deals": sum(1 for v in active if v["deal"]),
            "new": sum(1 for v in active
                       if parse_iso(v["first_seen"]) >= ts - timedelta(hours=NEW_WINDOW_HOURS)),
        })
        print(f"  -> {len(active)} actief, {index[-1]['deals']} deals, {index[-1]['new']} nieuw", flush=True)

    (out_dir / "index.json").write_text(json.dumps({
        "updated": iso(ts),
        "new_window_hours": NEW_WINDOW_HOURS,
        "categories": index,
    }, ensure_ascii=False, indent=1), encoding="utf-8")
    # Data van verwijderde categorieën blijft staan (historie gaat niet verloren),
    # maar verschijnt niet meer op de pagina omdat index.json leidend is.

    return 0 if any_ok else 1


if __name__ == "__main__":
    sys.exit(main())
