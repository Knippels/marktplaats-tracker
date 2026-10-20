"""Tests op echte Marktplaats-titels van mini-pc's."""
from scraper.minipc import evaluate, find_model, parse_cpu, parse_ram, parse_ram_loose, parse_storage, transcode


def test_cpu_generations():
    assert parse_cpu("i5-8500T")["gen"] == 8
    assert parse_cpu("Intel Core i5-10500T")["gen"] == 10
    assert parse_cpu("i5-1135G7")["gen"] == 11
    assert parse_cpu("i5-1240P")["gen"] == 12
    assert parse_cpu("i3-1315U")["gen"] == 13
    assert parse_cpu("i5-13420H")["gen"] == 13
    assert parse_cpu("HP ProDesk 400 G3 Mini - Intel Core i5 7th Gen")["gen"] == 7
    assert parse_cpu("Tekoop Lenovo Thinkcentre M720q i3 9th gen")["name"] == "i3 (9e gen)"
    assert parse_cpu("DEMO! DELL 3000 Mini | 12e gen i5 | 16GB")["gen"] == 12
    assert parse_cpu("Mini PC SUKOTOP T9 Plus Intel N95")["tier"] == "alder-n"
    assert parse_cpu("Celeron J3455")["family"] == "atom"
    assert parse_cpu("Ryzen 5 PRO 2400GE")["gen"] == 2
    assert parse_cpu("i5-9400F")["igpu"] is False


def test_transcode_follows_jellyfin_docs():
    assert transcode(parse_cpu("i5-6500T"))[0] == 0.5      # geen HEVC 10-bit
    assert transcode(parse_cpu("i5-8500T"))[0] == 0.85     # HEVC 10-bit
    assert transcode(parse_cpu("i5-11400T"))[0] == 1.0     # + AV1-decode
    assert transcode(parse_cpu("Intel N100"))[0] == 1.0
    assert transcode(parse_cpu("i5-9400F"))[0] == 0.0      # geen iGPU


def test_ram_and_storage():
    assert parse_ram("Lenovo Thinkcentre M720Q I5-8500T 3.5GHz 16GB DDR4") == 16
    assert parse_ram("Lenovo ThinkCentre M70q: 1TB+24GB DDR4, WiFi") == 24
    assert parse_ram_loose("Dell OptiPlex 7060M i5-8500T 16GB 256GB NVMe Win11") == 16
    assert parse_ram_loose("Lenovo M720Q I5-9400T 16/256") == 16
    assert parse_storage("Dell OptiPlex 7060M i5-8500T 16GB 256GB NVMe Win11")[0] == "256 GB NVMe"
    assert parse_storage("Lenovo ThinkCentre i7 32GB RAM SSD Windows 11", ram=32)[0] is None
    assert parse_storage("Hp Prodesk 400 G5 mini i7-9500T 8GB 512GB SSD + 512GB HDD")[0] == "512 GB SSD + 512 GB HDD"
    assert parse_storage("HP ProDesk 400 G2 Mini zonder ssd")[0] == "Geen"


def test_models():
    assert find_model("Lenovo ThinkCentre M920q Tiny")[0] == "M920q"
    assert find_model("Lenovo M900 Tiny i5-6500T")[0] == "M900 Tiny"
    assert find_model("Lenovo ThinkCentre M70q Gen 3 i7")[0] == "M70q Gen 3"
    assert find_model("Dell OptiPlex 7060M i5-8500T")[0] == "OptiPlex 7060 Micro"
    assert find_model("Dell Optiplex 3000 Mff-Intel i3")[0] == "OptiPlex 3000 Micro"
    assert find_model("HP EliteDesk 800 G4 DM - i5-8500T")[0] == "EliteDesk 800 G4 Mini"
    assert find_model("Intel NUC 10 Performance Kit NUC10i5FNH")[0] == "NUC10"


def test_scores_rank_sensibly():
    old = evaluate("HP Prodesk 400 G2 mini i3-6100T 8GB 240SSD", "")
    mid = evaluate("Lenovo Thinkcentre M720Q I5-8500T 3.5GHz 16GB DDR4 256GB SSD", "")
    new = evaluate("Lenovo ThinkCentre M70q Gen 3 i5-12500T 16GB 512GB NVMe", "")
    assert old["score"] < mid["score"] < new["score"]
    assert mid["model"] == "M720q" and mid["cpu"] == "i5-8500T" and mid["ram_gb"] == 16
    assert any("PCIe" in w for w in mid["score_why"])


def test_assumed_cpu_when_not_stated():
    r = evaluate("Lenovo ThinkCentre M920q Tiny 16GB", "")
    assert r["cpu_assumed"] and r["cpu"] == "i5-8500T"


def test_parts_are_excluded():
    import yaml
    from scraper import marktplaats, run
    cat = {c["id"]: c for c in yaml.safe_load(open("config.yml"))["categories"]}["mini-pc"]
    def item(t, p):
        raw = {"itemId": "m1", "title": t, "description": "", "priceInfo": {"priceCents": p * 100, "priceType": "FIXED"}, "vipUrl": "/v/x"}
        return run.enrich(marktplaats.parse_listing(raw), cat)
    for t in ["Lenovo ThinkCentre IQ2X0IH M710q M910q Motherboard", "DDR4 8GB (2x 4GB) SODIMM PC3200 geheugen",
              "Lenovo ThinkCentre Tiny-In-One 22 Gen 3 21.5\" FHD Monitor", "Gezocht: mini PC Micro Tiny met Intel i5-10500T",
              "65W CPU Cooling Fan 01EF556 BAZA0815B2U Replacement"]:
        assert not run.matches(item(t, 50), cat), t
    assert run.matches(item("Lenovo Thinkcentre M720Q I5-8500T 3.5GHz 16GB DDR4", 200), cat)


def test_expansion_fields():
    r = evaluate("Lenovo ThinkCentre M920q Tiny i5-8500T 16GB", "")
    assert r["pcie"] is True and r["nvme_slots"] == 1 and r["bay25"] is True
    assert evaluate("Dell OptiPlex 7060 Micro i5-8500T", "")["pcie"] is False
    m = evaluate("Minisforum UM790 Pro Ryzen 9 7940HS 32GB", "USB4 en OCuLink poort")
    assert m["oculink"] and m["tb_usb4"]
