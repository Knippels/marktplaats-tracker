import json, time, requests
from collections import Counter
from scraper.marktplaats import API_URL, HEADERS
QUERIES = ["terramaster", "terramaster d4", "terramaster d4-300", "terramaster d4-320", "das", "4 bay",
           "4-bay", "4bay", "jbod", "raid behuizing", "hdd behuizing", "harde schijf behuizing",
           "docking station hdd", "hdd docking", "hdd enclosure", "enclosure 3.5", "multi bay",
           "orico", "icy box", "fantec", "raidsonic", "yottamaster", "mediasonic", "sabrent ds",
           "qnap tr-004", "tr-004", "akitio", "startech 4 bay", "usb behuizing 3.5", "drive bay"]
out = {}
for q in QUERIES:
    r = requests.get(API_URL, params={"query": q, "limit": 100, "offset": 0, "sortBy": "SORT_INDEX",
                     "sortOrder": "DECREASING", "searchInTitleAndDescription": "true", "viewOptions": "list-view"},
                     headers=HEADERS, timeout=30)
    d = r.json()
    L = d.get("listings") or []
    out[q] = {
        "status": r.status_code, "total": d.get("totalResultCount"),
        "top_keys": sorted(d.keys()),
        "categories": Counter("/".join((x.get("vipUrl") or "").split("/")[2:4]) for x in L).most_common(8),
        "items": [{"t": x.get("title"), "cat": x.get("categoryId"), "url": x.get("vipUrl"),
                   "p": (x.get("priceInfo") or {}).get("priceCents"),
                   "d": (x.get("description") or "")[:160]} for x in L],
    }
    time.sleep(2)
out["_facets_sample"] = {k: v for k, v in d.items() if k != "listings"}
json.dump(out, open("probe/result.json", "w"), ensure_ascii=False, indent=1)
