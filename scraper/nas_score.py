"""Bruikbaarheidsscore (0-10) en OMV-geschiktheid voor NAS-advertenties.

Score = 10 x (0,35 platform + 0,25 processor + 0,25 geheugen + 0,15 software) + bonus (snel netwerk, M.2), max 10.
"""
from __future__ import annotations

import re
from functools import lru_cache
from pathlib import Path

import yaml

DB_PATH = Path(__file__).with_name("nas_models.yml")

PLATFORM = {  # (score, uitleg)
    ("x86_64", "ja"): (1.0, "x86-64, ander OS installeerbaar"),
    ("x86_64", "omweg"): (0.8, "x86-64, ander OS alleen met omweg"),
    ("x86_64", "nee"): (0.7, "x86-64, alleen fabrieks-OS"),
    ("arm64", None): (0.55, "ARM 64-bit"),
    ("armv7", None): (0.3, "ARM 32-bit"),
    ("x86_32", None): (0.15, "x86 32-bit"),
    ("armv5", None): (0.0, "ARMv5 (zeer oud)"),
    ("ppc", None): (0.0, "PowerPC (zeer oud)"),
}
OS_SCORE = {"actief": (1.0, "OS-updates actief"), "beperkt": (0.5, "OS-updates beperkt/oud model"),
            "eol": (0.0, "geen OS-updates meer (EOL)")}
OMV_LABEL = {"ja": "OMV installeerbaar (x86-64 met beeldscherm-uitgang)",
             "omweg": "OMV mogelijk met omweg (bijv. geen video-uitgang of alleen VGA-onderhoudspoort)",
             "nee": None}


def _norm(s: str) -> str:
    s = s.upper()
    s = re.sub(r"(?<=[A-Z])[\s-]+(?=\d)", "", s)   # "TS-412" / "TS 412" -> "TS412", "Gen 8" -> "GEN8"
    s = re.sub(r"\bPRO\s?2\b", "PRO II", s)
    s = re.sub(r"\s+", " ", s)
    return s


@lru_cache(maxsize=1)
def _db() -> list[tuple[str, str, dict]]:
    raw = yaml.safe_load(DB_PATH.read_text(encoding="utf-8"))
    rows = [(_norm(k), k, v) for k, v in raw.items()]
    return sorted(rows, key=lambda r: len(r[0]), reverse=True)  # langste (specifiekste) eerst


def _match(text: str) -> tuple[str, str, dict] | None:
    t = _norm(text)
    for key, name, spec in _db():  # langste sleutel eerst
        for m in re.finditer(re.escape(key), t):
            before = t[m.start() - 1] if m.start() > 0 else " "
            after = t[m.end()] if m.end() < len(t) else " "
            if before.isalnum() or after.isalnum() or (after == "+" and not key.endswith("+")):
                continue
            return key, name, spec
    return None


def find_model(*texts: str) -> tuple[str, dict] | None:
    """Specifiekste (langste) modelnaam die in een van de teksten voorkomt."""
    hits = [h for h in (_match(t) for t in texts if t) if h]
    if not hits:
        return None
    key, name, spec = max(hits, key=lambda h: len(h[0]))
    return name, spec


RAM_RE = [
    re.compile(r"(?<![\d.,x×])(\d{1,2})\s?gb\s?(?:ddr\d?l?\s?)?(?:ram|geheugen|werkgeheugen|memory|memorie)", re.I),
    re.compile(r"(?:ram|geheugen)\s?(?:upgrade\s?)?(?:naar|tot|:|van\s?\d{1,2}\s?gb\s?naar)?\s?(\d{1,2})\s?gb\b", re.I),
    re.compile(r"\b(?:ts|tvs|ds|f4)-?\d{3}\w*-(\d{1,2})g\b", re.I),   # modelvariant "TS-453A-8G"
    re.compile(r"(?<![\d.,x×])(\d{1,2})\s?gb\s?(?:versie|uitvoering|variant|model)\b", re.I),
]


def stated_ram(text: str) -> float | None:
    vals = []
    for rx in RAM_RE:
        vals += [int(v) for v in rx.findall(text) if 1 <= int(v) <= 64]
    return float(max(vals)) if vals else None


def _ram_points(gb: float) -> float:
    for limit, pts in ((8, 1.0), (4, 0.8), (2, 0.5), (1, 0.3), (0.5, 0.15)):
        if gb >= limit:
            return pts
    return 0.0


def _fmt_gb(gb: float) -> str:
    return f"{gb:g} GB" if gb >= 1 else f"{int(gb * 1024)} MB"


def evaluate(model_hint: str | None, title: str, desc: str) -> dict:
    found = find_model(model_hint or "", title) or find_model(desc)
    if not found:
        return {"nas_model": None, "score": None, "omv": None}
    name, s = found
    plat_key = (s["arch"], s["omv"]) if s["arch"] == "x86_64" else (s["arch"], None)
    p, p_txt = PLATFORM[plat_key]
    c = s["tier"] / 5
    stated = stated_ram(f"{title} {desc}")
    ram = max(s["ram"], stated or 0)
    r = _ram_points(ram)
    if s.get("ram_max", 0) >= 8 and ram < 8:
        r = min(1.0, r + 0.1)
    o, o_txt = OS_SCORE[s["os"]]
    bonus = (0.5 if s.get("net", 1) >= 10 else 0.3 if s.get("net", 1) >= 2.5 else 0) + (0.2 if s.get("m2") else 0)
    score = round(min(10.0, 10 * (0.35 * p + 0.25 * c + 0.25 * r + 0.15 * o) + bonus), 1)

    ram_txt = _fmt_gb(ram) + (" (vermeld)" if stated and stated > s["ram"] else " (standaard)")
    why = [
        f"Platform: {p_txt} ({p * 10:.0f}/10)",
        f"Processor: {s['cpu']}, {s['cores']} kern(en), klasse {s['tier']}/5",
        f"Geheugen: {ram_txt}, max {_fmt_gb(s.get('ram_max', ram))}",
        f"Software: {o_txt}",
    ]
    if bonus:
        why.append("Bonus: " + ", ".join(x for x in [
            f"{s['net']:g} GbE" if s.get("net", 1) >= 2.5 else None, "M.2-sloten" if s.get("m2") else None] if x))
    if s.get("src") == "k":
        why.append("Specs uit fabrikantgegevens, niet los gecontroleerd")
    return {
        "nas_model": name,
        "cpu": s["cpu"],
        "arch": s["arch"],
        "ram_gb": ram,
        "ram_stated": stated is not None and stated > s["ram"],
        "os_status": s["os"],
        "omv": s["omv"],
        "omv_why": OMV_LABEL.get(s["omv"]) or ("Synology: dichtgetimmerd, alleen DSM" if name.startswith(("DS", "CS"))
                                               else "Geen 64-bit x86 of geen manier om een ander OS te starten"),
        "score": score,
        "score_why": why,
    }
