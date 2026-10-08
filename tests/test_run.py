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


def test_hdd_excludes_from_first_run():
    cat = load_cats()["hdd-sata-4tb-plus"]
    assert run.matches(_item("WD Purple 8tb NAS - NVR HDD - WD85PURZ", 90), cat)
    for t in ["Defecte Seagate Exos 8TB HDD - SMART fouten", "2x 12TB SAS3 12GB 7.2K HDD",
              "Seagate Expansion 8TB Externe HDD", "8TB SATA HDD met SMART waarschuwing", "Dahua 16kanaals 4K NVR 8TB",
              "Foscam NVR QHD 8-kanaals recorder 16TB", "Western Digital \"My Book\" 8TB"]:
        assert not run.matches(_item(t, 80), cat), t


def test_das_excludes_from_first_run():
    cat = load_cats()["das-4-bay"]
    for t in ["Asustor DAS 4-bay behuizing", "Promise DS4600 4-Bay DAS Storage",
              "ICY BOX 4HDD behuizing 3.5 inch USB 3.2 gen1 eSATA",
              "Mediasonic PRORAID RAID/NAS 4x 3,5\" SATA HDD USB3 eSATA",
              "Orico 4 Bay USB 3.0 Docking Station voor 2.5/3.5", "TerraMaster D4-300 4-bay DAS"]:
        assert run.matches(_item(t, 100), cat), t
    for t in ["SP 4+3 4-Bay NAS Chassis M-ATX Moederbord SFX PSU",
              "SABRENT 4-bay USB-C docking station voor 2,5 inch SATA",
              "QNAP TS-431P 4-Bay NAS - Zonder harde schijven", "Synology DS416j - NAS - 4-Bay",
              "Terramaster F4-424 Max NAS - Krachtige 4-bay opslag",
              "ACASIS 40Gb/s 4-Bay Hybride HDD en NVMe kast",
              "NETGEAR ReadyNAS RN2120 4-Bay NAS 1U Rackmount"]:
        assert not run.matches(_item(t, 80), cat), t


def test_stored_listing_dropped_when_filter_tightens(tmp_path):
    cat = dict(load_cats()["hdd-sata-4tb-plus"], exclude=None)
    t0 = datetime(2026, 10, 1, tzinfo=timezone.utc)
    run.update_category(cat, [_item("Defecte WD 8TB", 40, "x")], True, tmp_path, t0)
    res = run.update_category(load_cats()["hdd-sata-4tb-plus"], [], True, tmp_path, t0 + timedelta(hours=3))
    assert "mp-x" not in res["listings"]


def test_nas_4_bay():
    cat = load_cats()["nas-4-bay"]
    for t in ["QNAP TS-412 NAS met 4x 2TB (8TB totaal)", "QNAP TS-420 NAS (zonder adapter)",
              "Synology DS415+ NAS met 8Gb geheugen (zonder harde schijven)", "Netgear 4 Bay NAS de RN104",
              "Terramaster F4-424 Max NAS", "iOmega Storcenter ix4-200d NAS"]:
        assert run.matches(_item(t, 150), cat), t
    for t in ["QNAP TS-233 2-bay NAS", "Synology DS1815+ NAS Server - 8-bay",
              "QNAP TS-432PXU-RP NAS Server met Dual M.2", "Synology RackStation RS814 1U 4-Bay NAS",
              "QNAP TS-453U 4-Bay Rackmount NAS - DEFECT", "SP 4+3 4-Bay NAS Chassis M-ATX Moederbord",
              "TerraMaster D2-320 USB Externe Disk Enclosure NAS", "Gezocht: Synology DS418"]:
        assert not run.matches(_item(t, 150), cat), t
