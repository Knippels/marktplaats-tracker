"""Mini-pc's: processor + generatie, RAM, opslag en een score (0-10) voor Proxmox met Jellyfin.

Score = 10 x (0,30 processor + 0,25 Jellyfin-transcodering (iGPU) + 0,20 geheugen + 0,10 opslag + 0,15 uitbreiding)

Transcodering volgt de Jellyfin-documentatie (Intel QSV/VA-API):
  - 6e gen Core (Skylake): H.264 + HEVC 8-bit, geen HEVC 10-bit
  - 7e gen (Kaby Lake), Gemini Lake Pentium/Celeron en nieuwer: HEVC 10-bit + tone mapping
  - 11e gen (Tiger Lake) en nieuwer, incl. N100-familie: ook AV1-decode
  - F-processors hebben geen iGPU
  - AMD: encoders "no match for Intel QSV and NVIDIA NVENC"; HEVC 10-bit genoemd vanaf Ryzen 4000
"""
from __future__ import annotations

import re
from functools import lru_cache
from pathlib import Path

import yaml

DB_PATH = Path(__file__).with_name("minipc_models.yml")

GEN_ADJ = {6: -0.12, 7: -0.08, 8: 0.05, 9: 0.06, 10: 0.10, 11: 0.12, 12: 0.20, 13: 0.22, 14: 0.24}
TIER_BASE = {"i3": 0.45, "i5": 0.62, "i7": 0.75, "i9": 0.85, "Pentium": 0.25, "Celeron": 0.2,
             "Ryzen 3": 0.45, "Ryzen 5": 0.62, "Ryzen 7": 0.75, "Ryzen 9": 0.85}
RYZEN_ADJ = {2: -0.05, 3: 0.0, 4: 0.10, 5: 0.12, 6: 0.18, 7: 0.20, 8: 0.22}
ALDER_N = {"N95": 0.40, "N97": 0.40, "N100": 0.40, "N150": 0.42, "N200": 0.42, "N250": 0.44, "N300": 0.56, "N305": 0.58}
BRANDS = [(r"lenovo|thinkcentre", "Lenovo"), (r"\bdell\b|optiplex", "Dell"), (r"\bhp\b|elitedesk|prodesk|hewlett", "HP"),
          (r"\bnuc\b|\bnuc\d", "Intel"), (r"beelink", "Beelink"), (r"minisforum", "Minisforum"), (r"gmktec", "GMKtec"),
          (r"trigkey", "Trigkey"), (r"acemagic", "ACEMAGIC"), (r"fujitsu|esprimo", "Fujitsu"), (r"\basus\b", "ASUS")]


@lru_cache(maxsize=1)
def _models() -> list[tuple[str, dict]]:
    raw = yaml.safe_load(DB_PATH.read_text(encoding="utf-8"))
    # specifieke patronen eerst (het generieke "OptiPlex Micro" als laatste)
    return sorted(raw.items(), key=lambda kv: kv[0] == "OptiPlex Micro")


def find_model(text: str) -> tuple[str, dict] | None:
    for name, spec in _models():
        m = re.search(spec["pattern"], text, re.I)
        if m:
            spec = dict(spec)
            if spec.get("gen_by_suffix"):
                g = re.search(spec["pattern"] + r"\s*(?:gen(?:eratie)?\s?)(\d)", text, re.I)
                if g and g.group(g.lastindex) in spec["gen_by_suffix"]:
                    spec["gen"] = spec["gen_by_suffix"][g.group(g.lastindex)]
                    name = f"{name} Gen {g.group(g.lastindex)}"
            return name, spec
    return None


# ---------------------------------------------------------------- processor
def parse_cpu(text: str) -> dict | None:
    """Herkent de processor; geeft naam, familie, generatie, iGPU-klasse."""
    m = re.search(r"\b(?:core\s?)?i([3579])[-\s]?(\d{4,5})([a-z]{0,2}\d?)\b", text, re.I)
    if m:
        num = m.group(2)
        # 5 cijfers (10500T) of 4 cijfers beginnend met 1 (1135G7, 1240P, 1315U) = 10e gen of nieuwer
        gen = int(num[:2]) if len(num) == 5 or num[0] == "1" else int(num[0])
        suffix = m.group(3).upper()
        return {"name": f"i{m.group(1)}-{num}{suffix}", "vendor": "intel", "tier": f"i{m.group(1)}", "gen": gen,
                "suffix": suffix, "igpu": "F" not in suffix}
    m = re.search(r"\bi([3579])\b.{0,25}?\b(\d{1,2})\s?(?:e|de|ste|th|nd|rd|st)?\s?(?:gen\b|generatie)", text, re.I)
    if m and 6 <= int(m.group(2)) <= 14:
        return {"name": f"i{m.group(1)} ({m.group(2)}e gen)", "vendor": "intel", "tier": f"i{m.group(1)}",
                "gen": int(m.group(2)), "suffix": "", "igpu": True}
    m = re.search(r"\b(\d{1,2})\s?(?:e|de|th)\s?(?:gen\b|generatie)\s?(?:intel\s?)?(?:core\s?)?i([3579])\b", text, re.I)
    if m and 6 <= int(m.group(1)) <= 14:
        return {"name": f"i{m.group(2)} ({m.group(1)}e gen)", "vendor": "intel", "tier": f"i{m.group(2)}",
                "gen": int(m.group(1)), "suffix": "", "igpu": True}
    m = re.search(r"\b(?:intel\s?)?(?:processor\s?)?(n(?:95|97|100|150|200|250|300|305))\b", text, re.I)
    if m:
        return {"name": f"Intel {m.group(1).upper()}", "vendor": "intel", "tier": "alder-n", "gen": 12,
                "suffix": "", "igpu": True, "family": m.group(1).upper()}
    m = re.search(r"\b(?:celeron\s?|pentium\s?(?:silver\s?)?)?([jn])(\d{4})\b", text, re.I)
    if m:
        code = f"{m.group(1).upper()}{m.group(2)}"
        jasper = code in {"N4500", "N4505", "N5095", "N5100", "N5105", "N6000", "N6005", "J6412", "J6413", "J4505"}
        gemini = code[:2] in {"J4", "N4", "J5", "N5"} and not jasper
        return {"name": code, "vendor": "intel", "tier": "Celeron", "gen": 10 if jasper else 8,
                "suffix": "", "igpu": True, "family": "jasper" if jasper else "gemini" if gemini else "atom"}
    m = re.search(r"\b(pentium|celeron)?\s?(?:gold\s?)?g(\d{4})(t?)\b", text, re.I)
    if m and (m.group(1) or re.search(r"pentium|celeron", text, re.I)):
        n = int(m.group(2))
        gen = 6 if n < 4560 else 7 if n < 4900 else 8 if n < 5600 else 10
        tier = "Celeron" if (m.group(1) or "").lower() == "celeron" else "Pentium"
        return {"name": f"{tier} G{n}{m.group(3).upper()}", "vendor": "intel", "tier": tier, "gen": gen,
                "suffix": m.group(3).upper(), "igpu": True}
    m = re.search(r"\bryzen\s?([3579])\s?(?:pro\s?)?(\d{4})([a-z]{0,2})\b", text, re.I)
    if m:
        series = int(m.group(2)[0])
        return {"name": f"Ryzen {m.group(1)} {m.group(2)}{m.group(3).upper()}", "vendor": "amd",
                "tier": f"Ryzen {m.group(1)}", "gen": series, "suffix": m.group(3).upper(),
                "igpu": not m.group(3).upper().endswith("F")}
    return None


def cpu_points(c: dict) -> float:
    if c["vendor"] == "amd":
        v = TIER_BASE.get(c["tier"], 0.5) + RYZEN_ADJ.get(c["gen"], 0)
    elif c["tier"] == "alder-n":
        v = ALDER_N.get(c.get("family"), 0.4)
    elif c["tier"] in ("Celeron", "Pentium") and c.get("family"):
        v = 0.25 if c["family"] == "jasper" else 0.18
    else:
        v = TIER_BASE.get(c["tier"], 0.4) + GEN_ADJ.get(c["gen"], 0)
    if c.get("suffix") == "T":
        v -= 0.03
    return max(0.05, min(1.0, v))


def transcode(c: dict) -> tuple[float, str]:
    if not c.get("igpu"):
        return 0.0, "geen iGPU (F-processor): geen hardware-transcodering"
    if c["vendor"] == "amd":
        if c["gen"] >= 4:
            return 0.55, "AMD Vega iGPU: werkt (VA-API), maar kwaliteit/snelheid onder Intel QSV"
        return 0.4, "AMD Vega iGPU (oud): beperkt; geen HEVC 10-bit-encode"
    if c["tier"] == "alder-n" or c["gen"] >= 11:
        return 1.0, "Intel QSV: HEVC 10-bit, tone mapping en AV1-decode"
    if c.get("family") == "jasper":
        return 0.75, "Intel QSV: HEVC 10-bit; geen AV1, QSV-ondersteuning wordt afgebouwd"
    if c["gen"] >= 7 or c.get("family") == "gemini":
        return 0.85, "Intel QSV: HEVC 10-bit en tone mapping; geen AV1"
    if c["gen"] == 6:
        return 0.5, "Intel QSV 6e gen: geen HEVC 10-bit (4K HDR-films vallen terug op CPU)"
    return 0.3, "oude iGPU: alleen H.264"


# ---------------------------------------------------------------- RAM & opslag
RAM_VALUES = {2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48, 64, 96, 128}


STORAGE_WORD = r"(?:ssd|nvme|hdd|m\.?2|emmc|harde|opslag|schijf|disk|sata)"


def parse_ram_loose(title: str) -> float | None:
    """Titel zonder 'RAM'-woord: '16GB 256GB', '16/256', '8GB/256GB SSD'."""
    m = re.search(r"\b(\d{1,2})\s?(?:gb)?\s?/\s?(\d{3,4})\s?(?:gb)?\b", title, re.I)
    if m and int(m.group(1)) in RAM_VALUES:
        return float(m.group(1))
    for m in re.finditer(r"(?<![\d.,x×/])(\d{1,2})\s?gb\b(?!\s?(?:[a-z]+\s)?" + STORAGE_WORD + ")", title, re.I):
        if int(m.group(1)) in RAM_VALUES and int(m.group(1)) <= 64:
            return float(m.group(1))
    return None


def parse_ram(text: str) -> float | None:
    if re.search(r"(zonder|geen|excl\.?|exclusief)\s?(ram|geheugen|werkgeheugen)", text, re.I):
        return 0.0
    vals = []
    for rx in (r"(?<![\d.,x×])(\d{1,3})\s?gb\s?(?:ddr\d\w*\s?)?(?:sodimm\s?)?(?:ram|geheugen|werkgeheugen|memory|ddr\d)",
               r"(?:ram|geheugen|werkgeheugen|memory)\s?(?:[:\-]|van)?\s?(\d{1,3})\s?gb\b"):
        vals += [int(v) for v in re.findall(rx, text, re.I) if int(v) in RAM_VALUES]
    return float(max(vals)) if vals else None


STORE_TYPES = [(r"nvme|m\.?2\s?pcie|pcie\s?ssd", "NVMe"), (r"ssd|m\.?2|msata|sata\s?ssd", "SSD"),
               (r"hdd|harde\s?schijf|hard\s?disk|harddisk", "HDD"), (r"emmc", "eMMC")]


def _stype(word: str) -> str:
    for pat, label in STORE_TYPES:
        if re.search(pat, word, re.I):
            return label
    return "SSD"


def parse_storage(text: str, ram: float | None = None, loose: bool = False) -> tuple[str | None, float | None, list]:
    """(omschrijving, totaal GB aan SSD/NVMe, lijst (GB, type))."""
    if re.search(r"(zonder|geen|excl\.?|exclusief)\s?(ssd|opslag|harde\s?schijf|hdd|schijf|nvme)", text, re.I):
        return "Geen", 0.0, []
    found = []
    word = r"(m\.?2\s?(?:pcie\s?)?nvme|m\.?2\s?ssd|nvme\s?ssd|nvme|sata\s?ssd|ssd|m\.?2|hdd|harde\s?schijf|hard\s?disk|emmc|opslag)"
    for m in re.finditer(r"(?<![\d.,])(\d{2,4}|[12](?:[.,]\d)?)\s?(gb|tb)\s?(?:(?!ram\b|geheugen|ddr)[a-z]+\s){0,2}?" + word, text, re.I):
        found.append((m.group(1), m.group(2), m.group(3)))
    for m in re.finditer(word + r"\s?(?:van\s|:\s?)?(?<![\d.,])(\d{2,4}|[12](?:[.,]\d)?)\s?(gb|tb)\b", text, re.I):
        found.append((m.group(2), m.group(3), m.group(1)))
    if loose and not found:   # titel: "i5-8500T 16GB 256GB" -> 256 GB als SSD
        for m in re.finditer(r"(?<![\d.,])(\d{3,4}|[12])\s?(gb|tb)\b", text, re.I):
            v = float(m.group(1)) * (1000 if m.group(2).lower() == "tb" else 1)
            if v >= 120:
                found.append((m.group(1), m.group(2), "ssd"))
        m = re.search(r"\b\d{1,2}\s?(?:gb)?\s?/\s?(\d{3,4})\s?(?:gb)?\b", text, re.I)
        if m and not found:
            found.append((m.group(1), "gb", "ssd"))
    items = []
    for size, unit, w in found:
        gb = float(size.replace(",", ".")) * (1000 if unit.lower() == "tb" else 1)
        if gb > 16000 or (gb < 100 and _stype(w) != "eMMC") or (ram and gb == ram and gb <= 64):
            continue
        it = (gb, _stype(w))
        if it not in items:
            items.append(it)
    if not items:
        return None, None, []
    # zelfde grootte als NVMe én SSD genoemd -> één schijf
    dedup = []
    for gb, t in sorted(items, key=lambda x: ["NVMe", "SSD", "HDD", "eMMC"].index(x[1])):
        if t == "SSD" and any(g == gb and tt == "NVMe" for g, tt in dedup):
            continue
        dedup.append((gb, t))
    fmt = lambda gb: f"{gb / 1000:g} TB" if gb >= 1000 else f"{gb:g} GB"
    desc = " + ".join(f"{fmt(gb)} {t}" for gb, t in dedup)
    ssd = sum(gb for gb, t in dedup if t in ("NVMe", "SSD"))
    return desc, ssd, dedup


# ---------------------------------------------------------------- score
def _ram_points(gb: float) -> float:
    for limit, pts in ((64, 1.0), (32, 0.95), (16, 0.75), (8, 0.45), (4, 0.2)):
        if gb >= limit:
            return pts
    return 0.05


def evaluate(title: str, desc: str) -> dict:
    text = f"{title} \n {desc}"
    model = find_model(title) or find_model(desc)
    mname, mspec = model if model else (None, {})
    cpu = parse_cpu(title) or parse_cpu(desc)
    cpu_assumed = False
    if not cpu and mspec.get("cpu"):
        cpu = parse_cpu(mspec["cpu"])
        if cpu and isinstance(mspec.get("gen"), int):
            cpu["gen"] = max(cpu["gen"], mspec["gen"]) if cpu["vendor"] == "intel" else cpu["gen"]
        cpu_assumed = True
    brand = mspec.get("brand")
    if not brand:
        for pat, b in BRANDS:
            if re.search(pat, title, re.I):
                brand = b
                break

    ram = parse_ram(title)
    if ram is None:
        ram = parse_ram(desc)
    if ram is None:
        ram = parse_ram_loose(title)
    if ram is None:
        ram = parse_ram_loose(desc[:400])
    storage, ssd_gb, disks = parse_storage(title, ram)
    if storage is None:
        storage, ssd_gb, disks = parse_storage(desc, ram)
    if storage is None:
        storage, ssd_gb, disks = parse_storage(title, ram, loose=True)

    if not cpu:
        return {"brand": brand, "model": mname, "cpu": None, "ram_gb": ram, "storage": storage, "score": None}

    c = cpu_points(cpu)
    t, t_txt = transcode(cpu)
    ram_max = mspec.get("ram_max")
    r = _ram_points(ram) if ram is not None else 0.45
    if ram is not None and ram_max and ram_max >= 32 and ram < 32:
        r = min(1.0, r + 0.1)
    if ssd_gb is None:
        s = 0.35
    elif ssd_gb == 0:
        s = 0.2 if not disks else 0.3
    else:
        s = 0.5 if ssd_gb < 256 else 0.7 if ssd_gb < 500 else 0.85 if ssd_gb < 1000 else 1.0
    nvme = mspec.get("nvme")
    if nvme is None:
        nvme = 1 if re.search(r"nvme|m\.?2", text, re.I) else 0
    e = 0.0
    slots = (nvme or 0) + (1 if mspec.get("bay25") else 0)
    e += 0.5 if slots >= 2 else 0.25 if slots == 1 else 0
    e += 0.5 if mspec.get("pcie") else 0
    score = round(10 * (0.30 * c + 0.25 * t + 0.20 * r + 0.10 * s + 0.15 * e), 1)

    fam = {"gemini": "Gemini Lake", "jasper": "Jasper Lake", "atom": "Apollo Lake"}.get(cpu.get("family"))
    gen_label = (fam if fam else "Alder Lake-N" if cpu["tier"] == "alder-n" else
                 f"{cpu['gen']}e gen" if cpu["vendor"] == "intel" else f"Ryzen {cpu['gen']}000-serie")
    why = [
        f"Processor: {cpu['name']} ({gen_label}){' — niet vermeld, aanname o.b.v. model' if cpu_assumed else ''} ({c * 10:.0f}/10)",
        f"Jellyfin: {t_txt} ({t * 10:.0f}/10)",
        f"Geheugen: {('%g GB' % ram) if ram is not None else 'niet vermeld (8 GB aangenomen)'}"
        + (f", max {ram_max} GB" if ram_max else "") + f" ({r * 10:.0f}/10)",
        f"Opslag: {storage or 'niet vermeld'} ({s * 10:.0f}/10)",
        "Uitbreiding: " + (", ".join(x for x in [
            f"{nvme}x NVMe" if nvme else None, "2,5\"-bay" if mspec.get("bay25") else None,
            "PCIe-slot (bijv. 2.5/10 GbE-kaart)" if mspec.get("pcie") else None] if x) or "onbekend") + f" ({e * 10:.0f}/10)",
    ]
    if mspec.get("src") == "k":
        why.append("Modelgegevens uit fabrikantspecificaties, niet los gecontroleerd")
    return {
        "brand": brand, "model": mname, "cpu": cpu["name"], "cpu_gen": gen_label, "cpu_assumed": cpu_assumed,
        "qsv": t_txt, "ram_gb": ram, "ram_max": ram_max, "storage": storage, "ssd_gb": ssd_gb,
        "score": score, "score_why": why,
    }
