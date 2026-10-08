import json
from datetime import datetime, timedelta, timezone

import yaml

from scraper import marktplaats, run

RAW = {
    "itemId": "m2201234567",
    "title": "WD Red Plus 8TB NAS harde schijf 3.5 SATA",
    "description": "Werkt perfect, SMART goed",
    "priceInfo": {"priceCents": 8000, "priceType": "FIXED"},
    "location": {"cityName": "Leiden"},
    "date": "2026-10-08T10:00:00Z",
    "vipUrl": "/v/computers-en-software/harde-schijven/m2201234567-wd-red",
    "pictures": [{"mediumUrl": "//images.marktplaats.com/api/v1/x.jpg"}],
    "sellerInformation": {"sellerName": "Jan"},
}


def load_cats():
    cfg = yaml.safe_load(open("config.yml", encoding="utf-8"))
    return {c["id"]: c for c in cfg["categories"]}


def test_parse_listing():
    p = marktplaats.parse_listing(RAW)
    assert p["id"] == "mp-m2201234567"
    assert p["price"] == 80.0
    assert p["url"].startswith("https://www.marktplaats.nl/v/")
    assert p["image"].startswith("https://images.marktplaats.com/")


def test_parse_bid_without_price():
    raw = dict(RAW, priceInfo={"priceCents": 0, "priceType": "FAST_BID"})
    assert marktplaats.parse_listing(raw)["price"] is None


def test_capacity():
    assert run.capacity_tb("WD Red 4TB") == 4
    assert run.capacity_tb("2x 8TB Ironwolf") == 16
    assert run.capacity_tb("Seagate Exos 16 TB") == 16
    assert run.capacity_tb("Samsung 1.5TB") is None or run.capacity_tb("Samsung 1.5TB") < 4
    assert run.capacity_tb("geen capaciteit") is None


def _item(title, price, iid="mp-1"):
    p = marktplaats.parse_listing(dict(RAW, title=title, itemId=iid,
                                       priceInfo={"priceCents": int(price * 100), "priceType": "FIXED"}))
    p["capacity_tb"] = run.capacity_tb(p["title"])
    return p


def test_hdd_filters():
    cat = load_cats()["hdd-sata-4tb-plus"]
    assert run.matches(_item("WD Red Plus 8TB", 80), cat)
    assert not run.matches(_item("WD 2TB schijf", 30), cat)
    assert not run.matches(_item("Samsung 4TB SSD", 200), cat)
    assert not run.matches(_item("WD Elements 8TB extern USB", 100), cat)
    assert not run.matches(_item("Synology DS918+ met 4x 4TB", 500), cat)


def test_das_filters():
    cat = load_cats()["das-4-bay"]
    assert run.matches(_item("Terramaster D4-300 4-bay DAS", 120), cat)
    assert run.matches(_item("ORICO 4 bay 3.5 inch behuizing USB-C", 90), cat)
    assert not run.matches(_item("Synology DS418 4 bay NAS", 250), cat)
    assert not run.matches(_item("Gezocht: 4 bay das", 50), cat)


def test_update_cycle(tmp_path):
    cat = load_cats()["hdd-sata-4tb-plus"]
    t0 = datetime(2026, 10, 1, 12, tzinfo=timezone.utc)
    a, b = _item("WD Red 8TB", 80, "a"), _item("Exos 16TB", 300, "b")
    res = run.update_category(cat, [a, b], True, tmp_path, t0)
    assert res["listings"]["mp-a"]["metric"] == 10.0
    assert res["listings"]["mp-a"]["deal"] is True        # 10 €/TB <= 12
    assert res["listings"]["mp-b"]["deal"] is False       # 18.75 €/TB
    assert res["history"][0]["count"] == 2

    # dag later: a in prijs verlaagd, b verdwenen
    a2 = _item("WD Red 8TB", 70, "a")
    res = run.update_category(cat, [a2], True, tmp_path, t0 + timedelta(days=1))
    la = res["listings"]["mp-a"]
    assert la["first_seen"] == run.iso(t0)
    assert la["price_drop"] is True and len(la["price_history"]) == 2
    assert res["listings"]["mp-b"]["active"] is False
    assert len(res["history"]) == 2

    # onvolledige run markeert niets als verdwenen
    res = run.update_category(cat, [], False, tmp_path, t0 + timedelta(days=2))
    assert res["listings"]["mp-a"]["active"] is True
    json.loads((tmp_path / "hdd-sata-4tb-plus.json").read_text())
