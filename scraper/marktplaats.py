"""Marktplaats.nl bron: haalt advertenties op via de zoek-API die de website zelf gebruikt."""
from __future__ import annotations

import time

import requests

API_URL = "https://www.marktplaats.nl/lrp/api/search"
BASE_URL = "https://www.marktplaats.nl"
PAGE_SIZE = 100
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    ),
    "Accept": "application/json",
    "Accept-Language": "nl-NL,nl;q=0.9",
}

# Prijs-types waarbij priceCents een echte vraagprijs is
PRICED_TYPES = {"FIXED", "MIN_BID"}


def _abs_url(url: str | None) -> str | None:
    if not url:
        return None
    if url.startswith("//"):
        return "https:" + url
    if url.startswith("/"):
        return BASE_URL + url
    return url


def parse_listing(raw: dict) -> dict | None:
    item_id = raw.get("itemId")
    if not item_id:
        return None
    price_info = raw.get("priceInfo") or {}
    price_type = price_info.get("priceType")
    cents = price_info.get("priceCents") or 0
    price = round(cents / 100, 2) if cents and price_type in PRICED_TYPES else None

    image = None
    pictures = raw.get("pictures") or []
    if pictures and isinstance(pictures[0], dict):
        p = pictures[0]
        image = p.get("mediumUrl") or p.get("largeUrl") or p.get("extraSmallUrl")
    if not image:
        urls = raw.get("imageUrls") or []
        image = urls[0] if urls else None

    location = raw.get("location") or {}
    seller = raw.get("sellerInformation") or {}

    return {
        "id": f"mp-{item_id}",
        "source": "marktplaats",
        "title": (raw.get("title") or "").strip(),
        "description": (raw.get("description") or raw.get("categorySpecificDescription") or "").strip(),
        "price": price,
        "price_type": price_type,
        "url": _abs_url(raw.get("vipUrl")),
        "image": _abs_url(image),
        "city": location.get("cityName"),
        "seller": seller.get("sellerName"),
        "posted": raw.get("date"),
    }


def search(query: str, *, postcode: str | None = None, distance_km: int | None = None,
           max_pages: int = 1, session: requests.Session | None = None) -> list[dict]:
    """Zoek op Marktplaats, nieuwste advertenties eerst."""
    s = session or requests.Session()
    results: list[dict] = []
    for page in range(max_pages):
        params = {
            "query": query,
            "limit": PAGE_SIZE,
            "offset": page * PAGE_SIZE,
            "sortBy": "SORT_INDEX",
            "sortOrder": "DECREASING",
            "searchInTitleAndDescription": "true",
            "viewOptions": "list-view",
        }
        if postcode and distance_km:
            params["postcode"] = postcode
            params["distanceMeters"] = int(distance_km) * 1000
        resp = s.get(API_URL, params=params, headers=HEADERS, timeout=30)
        resp.raise_for_status()
        data = resp.json()
        raw_listings = data.get("listings") or []
        for raw in raw_listings:
            parsed = parse_listing(raw)
            if parsed:
                results.append(parsed)
        if len(raw_listings) < PAGE_SIZE:
            break
        time.sleep(2)
    return results
