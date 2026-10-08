"""Haalt gestructureerde velden uit titel + omschrijving van een advertentie.

Alles is heuristiek (regex). Velden die niet betrouwbaar te bepalen zijn blijven None,
zodat de pagina "–" toont in plaats van een gok.
"""
from __future__ import annotations

import re

NUM_WORDS = {"twee": 2, "drie": 3, "vier": 4, "vijf": 5, "zes": 6, "zeven": 7, "acht": 8,
             "negen": 9, "tien": 10, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "eight": 8}

# ---------------------------------------------------------------- merken
HDD_BRANDS = [
    (r"western\s?digital|\bwd\b|\bwd\d|\bwdc\b", "WD"),
    (r"seagate|\bst\d{4,5}[a-z]{2}", "Seagate"),
    (r"toshiba|\bmg\d{2}aca|\bhdw[gqn]", "Toshiba"),
    (r"\bhgst\b|hitachi|\bhuh\d|\bhus\d|\bhua\d", "HGST"),
    (r"ultrastar|\bwuh\d", "WD"),
    (r"samsung", "Samsung"),
]
ENCLOSURE_BRANDS = [
    (r"synology", "Synology"), (r"\bqnap\b", "QNAP"), (r"terra\s?master", "TerraMaster"),
    (r"asustor", "Asustor"), (r"netgear|readynas", "Netgear"), (r"\borico\b", "Orico"),
    (r"icy\s?box|raidsonic", "ICY BOX"), (r"sabrent", "Sabrent"), (r"yottamaster", "Yottamaster"),
    (r"mediasonic", "Mediasonic"), (r"fantec", "Fantec"), (r"\bpromise\b", "Promise"),
    (r"lacie", "LaCie"), (r"iomega", "Iomega"), (r"buffalo", "Buffalo"), (r"startech", "StarTech"),
    (r"akitio", "Akitio"), (r"acasis", "Acasis"), (r"inateck", "Inateck"), (r"unitek", "Unitek"),
    (r"sharkoon", "Sharkoon"), (r"zyxel", "Zyxel"), (r"thecus", "Thecus"), (r"verbatim", "Verbatim"),
    (r"drobo", "Drobo"), (r"\bowc\b", "OWC"), (r"sonnet", "Sonnet"), (r"d-?link", "D-Link"),
    (r"seagate", "Seagate"), (r"western\s?digital|\bwd\b", "WD"), (r"ugreen", "UGREEN"),
]

# ---------------------------------------------------------------- HDD-series
HDD_SERIES = [
    (r"red\s?plus", "Red Plus"), (r"red\s?pro", "Red Pro"), (r"\bred\b", "Red"),
    (r"\bpurple\s?pro", "Purple Pro"), (r"\bpurple\b", "Purple"), (r"\bgold\b", "Gold"),
    (r"\bblue\b", "Blue"), (r"\bblack\b", "Black"), (r"\bgreen\b", "Green"),
    (r"ultrastar\s?dc\s?hc\s?(\d{3})", "Ultrastar DC HC{0}"), (r"ultrastar", "Ultrastar"),
    (r"iron\s?wolf\s?pro", "IronWolf Pro"), (r"iron\s?wolf", "IronWolf"),
    (r"exos\s?(x\d{2}|7e\d{1,2}|e\b)", "Exos {0}"), (r"\bexos\b", "Exos"),
    (r"barra\s?cuda\s?pro", "BarraCuda Pro"), (r"barra\s?cuda", "BarraCuda"),
    (r"sky\s?hawk", "SkyHawk"), (r"\bn300\b", "N300"), (r"\bx300\b", "X300"),
    (r"\bmg\d{2}\b", "MG"), (r"deskstar", "Deskstar"), (r"constellation", "Constellation"),
]
HDD_MODEL = re.compile(
    r"\b(wd\d{2,4}[a-z]{3,5}\d?[a-z]?|st\d{4,5}[a-z]{2}\d{3,4}[a-z]?|"
    r"[hw]u[hs]\d{6}[a-z0-9]*|hu[as]\d{6}[a-z0-9]*|mg\d{2}aca\d{2,3}[a-z]*|hdw[a-z]\d{2,3}[a-z]*)\b", re.I)

# ---------------------------------------------------------------- behuizing-modellen
ENCLOSURE_MODEL = [
    r"\b((?:ds|cs|rs)\d{3,4}[a-z]?\+?(?:play|j|xs\+?)?)(?![\w])",  # Synology
    r"\b(ts-?\d{3,4}[a-z+]*(?:\s?pro)?)",                  # QNAP
    r"\b(tr-?004)\b",                                      # QNAP DAS
    r"\b([df]\d-\d{3}[a-z]*(?:\s?max)?)\b",                # TerraMaster
    r"\b(as-?\d{3,4}[a-z]*)\b",                            # Asustor
    r"\b(rn\d{3,5}[a-z]*)\b",                              # Netgear ReadyNAS
    r"\b(ib-?\d{3,4}[a-z0-9-]*)\b",                        # ICY BOX
    r"\b(hfr2-[a-z0-9]+|pro\s?raid)\b",                    # Mediasonic
    r"\b(\d{4}(?:r?us3|c3|u3)[a-z0-9-]*)\b",               # Orico
    r"\b(ix4-[a-z0-9]+)\b",                                # Iomega
    r"\b(ds4600|pegasus\d?\s?r4)\b",                       # Promise
    r"\b(qr-?\d[a-z0-9-]*)\b",                             # Sonnet
    r"\b(n\d{3})\b",                                       # Verbatim N446 etc.
    r"\b(quadra)\b",                                       # LaCie
]

CONNECTIONS = [
    (r"thunderbolt\s?5", "Thunderbolt 5"), (r"thunderbolt\s?4|\btb4\b", "Thunderbolt 4"),
    (r"thunderbolt\s?3|\btb3\b", "Thunderbolt 3"), (r"thunderbolt", "Thunderbolt"),
    (r"usb[\s-]?c\b|type[\s-]?c\b|usb\s?type[\s-]?c", "USB-C"),
    (r"usb[\s-]?(?:c\s?)?3[.,]2", "USB 3.2"), (r"usb[\s-]?(?:c\s?)?3[.,]1", "USB 3.1"),
    (r"usb\s?3(?:[.,]0)?\b|usb3", "USB 3.0"), (r"usb\s?2(?:[.,]0)?\b", "USB 2.0"),
    (r"e-?sata", "eSATA"), (r"firewire|ieee\s?1394", "FireWire"),
    (r"10\s?gbe|10\s?gb(?:it)?/?s?\s?(?:lan|ethernet|netwerk|sfp)|10g\s?(?:base|lan)|sfp\+", "10GbE"),
    (r"2[.,]5\s?gbe|2[.,]5\s?g(?:bit)?\s?(?:lan|ethernet|netwerk)", "2.5GbE"),
    (r"gigabit|1\s?gbe|\blan\b|ethernet|rj-?45", "LAN"),
    (r"\bsas\b|sff-?8088|sff-?8644", "SAS"),
]

PER_PIECE = re.compile(
    r"(per\s?stuk|p\s?/\s?st(?:uk)?\b|p\.\s?st\b|/\s?stuk|per\s?(?:schijf|disk|drive|hdd|exemplaar)|"
    r"prijs\s?is\s?per|stuksprijs|\beach\b|per\s?piece|\bper\s?st\b|\bp\.?s\.?t\.?\b|"
    r"€\s?\d+[,.]?\d*\s?(?:p/?s|per\s?st\w*)\b|\d+\s?(?:euro|eur|€)\s?(?:p/?s|per\s?st\w*|each|ps)\b)", re.I)
SOLD_SEPARATELY = re.compile(
    r"(nog\s?\d{1,2}\s?(?:stuks?|st\.?|x)?\s?(?:aanwezig|beschikbaar|over|op voorraad)|"
    r"\b(?:[2-9]|[12]\d)\s?(?:stuks?|st\.?)?\s?(?:aanwezig|beschikbaar|op voorraad)|losse verkoop|los te koop|ook los|"
    r"per stuk te koop|meerdere (?:beschikbaar|aanwezig|op voorraad))", re.I)
NO_DRIVES = re.compile(
    r"(zonder\s(?:harde\s?)?(?:schijven|schijf|hdd'?s?|disks?|drives?|harddisks?|opslag|hd'?s?)\b|"
    r"excl(?:usief|\.)?\s(?:harde\s?)?(?:schijven|hdd'?s?|disks?)|"
    r"(?:no|without)\s(?:drives|disks|hdds?)|diskless|\bleeg\b|\bempty\b)", re.I)


def _norm(s: str | None) -> str:
    return re.sub(r"\s+", " ", (s or "")).strip()


def _model_case(raw: str) -> str:
    m = raw.upper()
    m = re.sub(r"PLAY$", "play", m)
    m = re.sub(r"(?<=\d)J$", "j", m)
    m = re.sub(r"(?<=\d)(XS)(\+?)$", lambda g: "xs" + g.group(2), m)
    for a, b in (("PRO", "Pro"), ("MAX", "Max"), ("QUADRA", "Quadra"), ("PRORAID", "ProRAID")):
        m = m.replace(a, b)
    m = re.sub(r"^IX4", "ix4", m)
    return m


def _first(patterns, text):
    for pat, label in patterns:
        m = re.search(pat, text, re.I)
        if m:
            return label.format(*(g.upper() for g in m.groups())) if m.groups() else label
    return None


def _qty_word(s: str) -> int | None:
    s = s.lower()
    return int(s) if s.isdigit() else NUM_WORDS.get(s)


# ================================================================ HDD
def drive_size(text: str) -> float | None:
    sizes = [int(c) for c in re.findall(r"(?<![\d.,])(\d{1,2})\s?(?:tb|tib|terabyte)\b", text, re.I)
             if 1 <= int(c) <= 30]
    if sizes:
        return float(max(sizes))
    m = re.search(r"(?<![\d.,])(\d{1,2})\s?t\b(?!\s?(?:max|plus))", text, re.I)
    if m and 2 <= int(m.group(1)) <= 30:
        return float(m.group(1))
    m = re.search(r"(?<![\d.,])(\d{4,5})\s?gb\b", text, re.I)  # 8000GB / 16000 GB
    if m and int(m.group(1)) % 1000 == 0:
        return float(int(m.group(1)) // 1000)
    return None


def drive_qty(title: str, desc: str) -> tuple[int, float | None]:
    """(aantal, grootte per schijf) — grootte alleen als die uit het aantal-patroon volgt."""
    for text in (title, desc):
        m = re.search(r"\b(\d{1,2})\s?[x×]\s?(?:[a-z ]{0,25}?)(\d{1,2})\s?(?:tb|tib)\b", text, re.I)
        if m and 2 <= int(m.group(1)) <= 30:
            return int(m.group(1)), float(m.group(2))
        m = re.search(r"\b(\d{1,2})\s?(?:tb|tib)\s?\(?\s?[x×]\s?(\d{1,2})\b", text, re.I)
        if m and 2 <= int(m.group(2)) <= 30:
            return int(m.group(2)), float(m.group(1))
        m = re.search(r"\(\s?(\d{1,2})\s?[x×]\s?\)|\(\s?[x×]\s?(\d{1,2})\s?\)|"
                      r"(?<![\w.])(\d{1,2})\s?[x×](?=\s*(?:$|[),!.;]|stuks?\b|aanwezig|beschikbaar))", text, re.I)
        if m:
            q = int(m.group(1) or m.group(2) or m.group(3))
            if 2 <= q <= 30:
                return q, None
        m = re.search(r"\b(\d{1,2}|twee|drie|vier|vijf|zes|acht|tien|two|three|four|six|eight)\s?"
                      r"(?:stuks?|st\.|pcs|exemplaren|identieke|harde\s?schijven|schijven|hdd'?s|drives|disks)\b",
                      text, re.I)
        if m:
            q = _qty_word(m.group(1))
            if q and 2 <= q <= 30:
                return q, None
        m = re.search(r"(?:nog\s)?\b(\d{1,2})\s?(?:stuks?\s|st\.?\s|x\s)?(?:op\s?voorraad|beschikbaar|aanwezig)",
                      text, re.I)
        if m and 2 <= int(m.group(1)) <= 30:
            return int(m.group(1)), None
        m = re.search(r"set\s?van\s?(\d{1,2}|twee|drie|vier|zes|acht)", text, re.I)
        if m:
            q = _qty_word(m.group(1))
            if q and 2 <= q <= 30:
                return q, None
    m = re.match(r"\s*(\d{1,2})\s+(?!tb|gb|t\b)[a-z]", title, re.I)  # "4 Toshiba 14TB ..."
    if m and 2 <= int(m.group(1)) <= 24:
        return int(m.group(1)), None
    return 1, None


def extract_hdd(title: str, desc: str, price: float | None, attrs: dict | None = None) -> dict:
    title, desc = _norm(title), _norm(desc)
    text = f"{title} {desc}"
    attrs = attrs or {}

    brand = _first(HDD_BRANDS, title) or _first(HDD_BRANDS, desc)
    if not brand and attrs.get("brand"):
        brand = attrs["brand"]
    series = _first(HDD_SERIES, title) or _first(HDD_SERIES, desc)
    mm = HDD_MODEL.search(title) or HDD_MODEL.search(desc)
    model = mm.group(1).upper() if mm else None
    type_ = " ".join(x for x in [series, f"({model})" if model and series else model] if x) or None

    qty, qty_size = drive_qty(title, desc)
    size = qty_size or drive_size(title) or drive_size(desc)
    # "4x2TB 8TB total": grootte in de titel is het totaal, niet per schijf
    if qty > 1 and qty_size and size and size != qty_size:
        size = qty_size

    sold_sep = bool(SOLD_SEPARATELY.search(text))
    per_piece_stated = bool(PER_PIECE.search(text)) or (sold_sep and qty > 1)
    per_piece_reason = None
    price_each = price_total = None
    if price is not None:
        if qty <= 1:
            price_each = price_total = price
        elif per_piece_stated:
            price_each, per_piece_reason = price, "vermeld"
            price_total = None if sold_sep else round(price * qty, 2)
        elif size and price / qty / size < 4:
            # onwaarschijnlijk goedkoop als totaalprijs -> vrijwel zeker prijs per stuk
            price_each, price_total, per_piece_reason = price, round(price * qty, 2), "geschat"
        else:
            price_each, price_total = round(price / qty, 2), price

    return {
        "brand": brand,
        "type": type_,
        "size_tb": size,
        "qty": qty,
        "sold_separately": sold_sep and qty > 1,
        "per_piece": per_piece_reason,
        "price_each": price_each,
        "price_total": price_total,
        "price_per_tb": round(price_each / size, 2) if price_each and size else None,
    }


# ================================================================ DAS / NAS
def extract_enclosure(title: str, desc: str, price: float | None, attrs: dict | None = None) -> dict:
    title, desc = _norm(title), _norm(desc)
    text = f"{title} {desc}"
    attrs = attrs or {}

    brand = _first(ENCLOSURE_BRANDS, title) or _first(ENCLOSURE_BRANDS, desc) or attrs.get("brand")
    model = None
    for src in (title, desc):
        for pat in ENCLOSURE_MODEL:
            m = re.search(pat, src, re.I)
            if m:
                model = _model_case(m.group(1))
                break
        if model:
            break

    bays = None
    m = re.search(r"\b(\d{1,2})[\s-]?(?:bay|bays|slots?|sleuven|hdd\b|voudig)", text, re.I) \
        or re.search(r"\b(\d)\s?x\s?3[.,]5", text, re.I)
    if m:
        bays = int(m.group(1))

    conns = []
    for pat, label in CONNECTIONS:
        if re.search(pat, text, re.I) and label not in conns:
            conns.append(label)
    # "Thunderbolt" naast "Thunderbolt 3" is dubbel
    if "Thunderbolt" in conns and any(c.startswith("Thunderbolt ") for c in conns):
        conns.remove("Thunderbolt")
    # USB 3.0 is impliciet bij 3.1/3.2
    if "USB 3.0" in conns and ("USB 3.1" in conns or "USB 3.2" in conns):
        conns.remove("USB 3.0")

    storage, storage_tb = None, None
    if NO_DRIVES.search(title):
        storage, storage_tb = "Geen", 0.0
    else:
        for src in (title, desc):
            m = re.search(r"\b(\d)\s?[x×]\s?(?:[a-z ]{0,20}?)(\d{1,2}(?:[.,]\d)?)\s?tb\b", src, re.I)
            if m:
                q, s = int(m.group(1)), float(m.group(2).replace(",", "."))
                storage, storage_tb = f"{q}× {s:g} TB ({q * s:g} TB)", q * s
                break
            m = re.search(r"\b([2-8])\s(?:[a-z]+\s){1,3}?(\d{1,2})\s?tb\b", src, re.I)
            if m:
                q, s = int(m.group(1)), float(m.group(2))
                storage, storage_tb = f"{q}× {s:g} TB ({q * s:g} TB)", q * s
                break
            m = re.search(r"\b(\d)\s?[x×]\s?(\d{3,4})\s?gb\b", src, re.I)
            if m:
                q, s = int(m.group(1)), int(m.group(2))
                storage, storage_tb = f"{q}× {s} GB", q * s / 1000
                break
            if src is title:
                m = re.search(r"(?<![\d.,x×])(\d{1,3}(?:[.,]\d)?)\s?tb\b", src, re.I)
                if m:
                    v = float(m.group(1).replace(",", "."))
                    storage, storage_tb = f"{v:g} TB", v
                    break
        if storage is None:
            if NO_DRIVES.search(desc):
                storage, storage_tb = "Geen", 0.0
            else:
                m = re.search(r"(?:incl\.?|inclusief|met)\s?(\d|twee|drie|vier)\s?x?\s?(?:\w+\s){0,2}?"
                              r"(?:hdd'?s?|harde\s?schijven|schijven|disks|drives)", text, re.I)
                if m:
                    storage = f"{_qty_word(m.group(1))} schijven (grootte onbekend)"

    return {
        "brand": brand,
        "type": model,
        "bays": bays,
        "connections": conns,
        "storage": storage,
        "storage_tb": storage_tb,
        "price_each": price,
        "price_total": price,
    }


def extract(kind: str, title: str, desc: str, price: float | None, attrs: dict | None = None) -> dict:
    if kind == "hdd":
        return extract_hdd(title, desc, price, attrs)
    return extract_enclosure(title, desc, price, attrs)
