import json, time, requests, yaml
from scraper.marktplaats import API_URL, HEADERS, parse_listing, fetch_detail
cfg = yaml.safe_load(open("config.yml"))
cat = [c for c in cfg["categories"] if c["id"] == "mini-pc"][0] if any(c["id"] == "mini-pc" for c in cfg["categories"]) else None
queries = ["lenovo tiny", "m920q", "m720q", "m900 tiny", "optiplex micro", "elitedesk mini", "prodesk mini", "intel nuc", "mini pc n100", "m70q", "m90q", "beelink"]
out = {}
s = requests.Session()
for q in queries:
    r = s.get(API_URL, params={"query": q, "limit": 100, "offset": 0, "sortBy": "SORT_INDEX", "sortOrder": "DECREASING",
              "searchInTitleAndDescription": "true", "viewOptions": "list-view"}, headers=HEADERS, timeout=30)
    out[q] = [parse_listing(x) for x in r.json().get("listings", [])]
    time.sleep(2)
seen = set(); det = 0
for q in queries:
    for it in out[q]:
        if it["id"] in seen or det >= 60: continue
        seen.add(it["id"])
        if it["price"] and 40 <= it["price"] <= 800:
            try:
                d = fetch_detail(it["url"], s); it["description"] = d.get("description") or it["description"]; det += 1
            except Exception: pass
            time.sleep(1.2)
json.dump(out, open("probe/result.json", "w"), ensure_ascii=False, indent=1)
# rerun
