from scraper.nas_score import evaluate, find_model, stated_ram


def test_find_model_prefers_most_specific():
    assert find_model("TS-439 Pro", "QNAP TS-439 Pro II NAS 4-bay")[0] == "TS-439 PRO II"
    assert find_model("server qnap TS-439 pro2")[0] == "TS-439 PRO II"
    assert find_model("QNAP TS 459 Pro")[0] == "TS-459 PRO"
    assert find_model("Synology DS412+ NAS")[0] == "DS412+"
    assert find_model("Synology DS412 NAS") is None          # geen 4-bay DS412 in de lijst
    assert find_model("QNAP TS-451+ NAS")[0] == "TS-451+"
    assert find_model("QNAP TS-451 NAS")[0] == "TS-451"
    assert find_model("HP MicroServer Gen 8 Xeon")[0] == "MICROSERVER GEN8"


def test_stated_ram():
    assert stated_ram("QNAP TS-451+ NAS met Intel Celeron 8GB RAM") == 8
    assert stated_ram("Synology DS916+ 8GB versie met 4 x 3.0 TB WD") == 8
    assert stated_ram("geheugen upgrade naar 16GB") == 16
    assert stated_ram("Synology DS418play met 4x 2GB HDD") is None
    assert stated_ram("QNAP TS-453A-8G") == 8


def test_scores_and_omv():
    a = evaluate("TS-453A", "QNAP TS-453A met 16GB Ram upgrade", "")
    assert a["omv"] == "ja" and a["ram_gb"] == 16 and a["score"] >= 7.5
    b = evaluate("TS-412", "QNAP TS-412 NAS", "")
    assert b["omv"] == "nee" and b["score"] < 1.5
    c = evaluate("DS920+", "Synology DS920+", "")
    assert c["omv"] == "nee" and "dichtgetimmerd" in c["omv_why"] and c["score"] > 7
    assert evaluate(None, "Mobiele sterilisator", "")["score"] is None
