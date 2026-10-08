import json, time, requests
from scraper.marktplaats import API_URL, HEADERS
out = {}
for q in ["wd red 8tb", "4-bay", "qnap ts-412", "4x 8tb"]:
    r = requests.get(API_URL, params={"query": q, "limit": 30, "offset": 0, "sortBy": "SORT_INDEX",
                     "sortOrder": "DECREASING", "searchInTitleAndDescription": "true", "viewOptions": "list-view"},
                     headers=HEADERS, timeout=30)
    out[q] = r.json().get("listings", [])[:30]
    time.sleep(2)
first = out["4-bay"][0]
vip = "https://www.marktplaats.nl" + first["vipUrl"]
h = requests.get(vip, headers={**HEADERS, "Accept": "text/html"}, timeout=30)
out["_vip"] = {"url": vip, "status": h.status_code, "len": len(h.text), "html": h.text[:300000]}
json.dump(out, open("probe/result.json", "w"), ensure_ascii=False, indent=1)
