"""Tests op basis van echte Marktplaats-advertenties (titel + begin omschrijving)."""
from scraper.extract import extract_enclosure, extract_hdd


def hdd(title, desc="", price=None):
    return extract_hdd(title, desc, price)


def test_per_piece_stated():
    r = hdd("4x WD Red Pro 8TB NAS Hard Drive",
            "Prijs is per stuk!! Te koop aangeboden: 4x gebruikte wd red pro 8tb nas hard drive (model wd8001ffwx).", 100)
    assert (r["brand"], r["qty"], r["size_tb"]) == ("WD", 4, 8)
    assert r["type"] == "Red Pro (WD8001FFWX)"
    assert (r["price_each"], r["price_total"], r["per_piece"]) == (100, 400, "vermeld")
    assert r["price_per_tb"] == 12.5


def test_each_and_total_in_title():
    r = hdd("WD Red plus  4x2TB  8TB total",
            "Unused sealed selling all 4 togather 2tb wd red plus nass =100 euro each", 100)
    assert (r["qty"], r["size_tb"], r["price_each"], r["price_total"]) == (4, 2, 100, 400)


def test_available_stock_sold_separately():
    r = hdd("Western Digital WD30EFRX - 3TB SATA WD RED [HDD-1624] 7-10",
            "nog 10 stuks aanwezig, prijs per stuk allemaal ok", 75)
    assert r["price_each"] == 75 and r["price_total"] is None and r["sold_separately"]
    assert r["type"] == "Red (WD30EFRX)"


def test_total_price_for_two():
    r = hdd("WD Red Pro 24TB NAS Hard Drive - Nieuw en Ongeopend",
            "2x wd red pro 24tb nas hard drives. Sku wd241kfgx.", 700)
    assert (r["qty"], r["size_tb"], r["price_each"], r["price_total"]) == (2, 24, 350, 700)


def test_implausible_total_assumed_per_piece():
    r = hdd("Seagate IronWolf 8TB (6x)", "", 60)
    assert r["qty"] == 6 and r["price_each"] == 60 and r["per_piece"] == "geschat"


def test_single_drive_series_and_model():
    r = hdd("Seagate Exos X18 18TB HDD – ST18000NM000J", "", 275)
    assert (r["brand"], r["type"], r["size_tb"], r["qty"]) == ("Seagate", "Exos X18 (ST18000NM000J)", 18, 1)
    r = hdd("Ultrastar DC HC530 Data Center Hard Drive - 14 TB", "wd ultrastar dc hc530 (model wuh721414ale6l4)", 250)
    assert r["brand"] == "WD" and r["type"] == "Ultrastar DC HC530 (WUH721414ALE6L4)" and r["size_tb"] == 14
    r = hdd("Western Digital HGST Ultrastar 3,5\" WD DC HC550 18T", "", 300)
    assert r["size_tb"] == 18
    r = hdd("Toshiba 16tb hdf", "", 200)
    assert (r["brand"], r["size_tb"], r["price_per_tb"]) == ("Toshiba", 16, 12.5)


def test_qty_leading_number_and_stuks():
    assert hdd("4 Toshiba 14TB Enterprise HDD – SMART Good €275p/stuk", "", 275)["price_total"] == 1100
    r = hdd("Seagate 8TB", "Er zijn 2 stuks 8 tb harde schijven", 300)
    assert r["qty"] == 2 and r["price_each"] == 150


def test_nog_1_stuks_over_is_single():
    r = hdd("Seagate Exos 7E8 SATA (512e, Standard model), 8TB", "(Nog 1 stuks over) model: st8000nm000a", 265)
    assert r["qty"] == 1 and r["price_each"] == 265 and r["type"] == "Exos 7E8 (ST8000NM000A)"


def enc(title, desc="", price=None):
    return extract_enclosure(title, desc, price)


def test_das_fields():
    r = enc("ICY BOX 4HDD behuizing 3.5 inch USB 3.2 gen1 eSATA", "Hierbij bied ik de icy box ib-3640su3 aan.")
    assert (r["brand"], r["type"], r["bays"]) == ("ICY BOX", "IB-3640SU3", 4)
    assert r["connections"] == ["USB 3.2", "eSATA"]
    r = enc("Mediasonic PRORAID RAID/NAS 4x 3,5\" SATA HDD USB3 eSATA",
            "Mediasonic proraid 4-bay 3,5\" sata-hardeschijfbehuizing - usb 3.0 & esata (hfr2-su3s2)")
    assert r["brand"] == "Mediasonic" and r["bays"] == 4 and r["connections"] == ["USB 3.0", "eSATA"]
    r = enc("Orico 4 Bay USB 3.0 Docking Station voor 2.5/3.5", "een orico 4 bay usb 3.0 Docking station, model 6648us3-c.")
    assert r["type"] == "6648US3-C" and r["bays"] == 4
    r = enc("TerraMaster D4-320 4-bay DAS USB-C 3.2 Gen2", "")
    assert r["type"] == "D4-320" and "USB-C" in r["connections"] and "USB 3.2" in r["connections"]


def test_nas_storage():
    r = enc("Synology DS412+ NAS + 4x 4TB Seagate HDD - 16TB")
    assert (r["brand"], r["type"], r["storage"], r["storage_tb"]) == ("Synology", "DS412+", "4× 4 TB (16 TB)", 16)
    assert enc("Synology DS916+ NAS - Zonder schijven")["storage"] == "Geen"
    assert enc("QNAP TS-412 NAS met 4x 2TB (8TB totaal)")["storage"] == "4× 2 TB (8 TB)"
    assert enc("QNAP TS-412 NAS met 4x 2TB (8TB totaal)")["type"] == "TS-412"
    assert enc("Synology DiskStation DS413 NAS 12 TB")["storage"] == "12 TB"
    assert enc("Synology DS414 NAS – Compl 4-Bay Netwerkschijf incl. 4x HDD!")["storage"].startswith("4 schijven")
    assert enc("Synology DS416play NAS")["type"] == "DS416play"
    r = enc("Synology DS415+ NAS met 8Gb geheugen (zonder harde schijven)", "gigabit lan, usb 3.0, esata")
    assert r["storage"] == "Geen" and r["connections"] == ["USB 3.0", "eSATA", "LAN"]


def test_regressions_from_real_listings():
    r = hdd("Seagate Exos X16 SATA (Standard model), 14TB", "Te koop: seagate exos x16 14tb sata harde schijf", 360)
    assert r["qty"] == 1 and r["price_each"] == 360 and r["type"] == "Exos X16"
    r = hdd("WD red 8TB (WD80EFZX) 2 op voorraad", "", 200)
    assert r["qty"] == 2 and r["price_each"] == 200 and r["sold_separately"]
    assert hdd("Seagate IronWolf 8TB (6x)", "", 600)["qty"] == 6
    e = enc("Synology DS412+ NAS inclusief 4 WD Red 2TB (8TB)")
    assert e["storage"] == "4× 2 TB (8 TB)"
    assert enc("Synology DS416j - NAS - 4-Bay")["type"] == "DS416j"
    assert enc("iOmega Storcenter ix4-200d NAS")["type"] == "ix4-200D"


def test_model_numbers_are_not_quantities():
    r = hdd("Seagate Exos 20TB X20 (1 op voorraad)", "seagate exos x20 20tb 1 stuk: 550 euro per stuk", 550)
    assert r["qty"] == 1 and r["price_each"] == 550
    r = hdd("Seagate Exos 18tb NAS - Server HDD (nieuw)", "deze enterprise seagate exos (x18) schijven", 450)
    assert r["qty"] == 1 and r["price_per_tb"] == 25


def test_large_stock_estimated_per_piece_has_no_total():
    r = hdd("Western Digital Ultrastar 10TB", "western digital dc hc330 10tb harde schijf.(13 Stuks) recertified", 350)
    assert r["qty"] == 13 and r["price_each"] == 350 and r["price_total"] is None and r["sold_separately"]


def test_bays_from_model():
    assert enc("QNAP TS-412 NAS")["bays"] == 4
    assert enc("QNAP TS 459 Pro")["type"] == "TS 459 Pro" and enc("QNAP TS 459 Pro")["bays"] == 4
    assert enc("Synology DS916+ 8GB")["bays"] == 4
    assert enc("Synology Cube Station CS407e NAS")["bays"] == 4
    assert enc("QNAP TS-251D NAS")["bays"] == 2
