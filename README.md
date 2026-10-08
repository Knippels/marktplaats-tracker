# Marktplaats-tracker

Houdt Marktplaats.nl bij voor homelab-onderdelen (SATA-schijven 4TB+, 4-bay DAS, 4-bay NAS) en publiceert een
overzichtspagina op GitHub Pages: **https://knippels.github.io/marktplaats-tracker/**

Per zoekcategorie toont de pagina:
- **Tabel (bovenaan)** met deals (groen) en nieuwe advertenties (blauwe rand) gemarkeerd, en snelfilters
  - schijven: merk, type, grootte, aantal, prijs per stuk, totaal, €/TB
  - DAS/NAS: merk, type, bays, aansluitingen (USB-C, USB 3.x, eSATA, Thunderbolt, LAN…), meegeleverde opslag, hoogste bod
- **NAS-score (0–10) en OMV-kolom** (categorie 4-bay NAS): het model wordt herkend en opgezocht in
  `scraper/nas_models.yml`. Score = 35% platform (x86-64 met ander OS mogelijk > x86 zonder > ARM64 > ARM32 > ARMv5/PPC),
  25% processorklasse, 25% geheugen (vermeld in advertentie of standaard), 15% OS-updates (actief/beperkt/EOL),
  plus bonus voor 2.5/10 GbE en M.2. OMV: ✓ x86-64 met beeldscherm-uitgang, ~ met omweg, ✗ niet (ARM 32-bit, Synology).
  Model ontbreekt? Voeg een regel toe aan `scraper/nas_models.yml`.
- **Interessante aanbiedingen**: onder een vaste grens (bijv. ≤ €12/TB) of de goedkoopste 25%
- **Nieuw binnen**: advertenties van de afgelopen 48 uur; blauwe rand = nieuw sinds je laatste bezoek
- **Prijsverloop**: dagelijks mediaan, goedkoopste 25% en laagste prijs (voor HDD's in €/TB)
- **Alle advertenties**: sorteerbaar en filterbaar, inclusief prijsverlagingen en verdwenen advertenties

## Zo werkt het

1. GitHub Actions (`.github/workflows/scrape.yml`) draait elke 3 uur `python -m scraper.run`.
2. De scraper zoekt op Marktplaats (nieuwste eerst, max. 100 per zoekterm), filtert met de regels uit
   `config.yml` en werkt `docs/data/<categorie>.json` bij (eerste/laatste keer gezien, prijshistorie, deals).
3. De data wordt gecommit en `docs/` wordt gepubliceerd op GitHub Pages.

Handmatig draaien: tab **Actions → Scrape & publiceer → Run workflow**.

## Zoekterm toevoegen

Voeg in `config.yml` een blok toe onder `categories:`, bijvoorbeeld:

```yaml
  - id: mini-pc
    name: "Mini-pc (tiny)"
    queries: ["lenovo m720q", "lenovo m920q", "optiplex micro"]
    exclude: '\b(gezocht|defect)\b'
    max_price: 250
    metric: price
    deal_percentile: 20
```

Commit de wijziging. De workflow start dan vanzelf en de nieuwe tab verschijnt na de run.
Alle opties staan bovenaan `config.yml` uitgelegd.

## Lokaal

```bash
pip install -r requirements.txt
python -m pytest -q tests
python -m scraper.run          # schrijft naar docs/data
python -m http.server -d docs  # http://localhost:8000
```

## Beperkingen

- Alleen Marktplaats.nl. Facebook Marketplace toont zoekresultaten alleen aan ingelogde gebruikers
  en verbiedt geautomatiseerd verzamelen, dus dat zit er niet in.
- De Marktplaats-zoek-API is niet officieel en kan zonder aankondiging veranderen.
- Merk, type, aantal, prijs per stuk, aansluitingen en opslag worden met regels (`scraper/extract.py`) uit titel en
  volledige omschrijving gehaald. De omschrijving wordt één keer per nieuwe advertentie van de advertentiepagina
  opgehaald (max. 70 per categorie per run). Staat er "per stuk" of "nog 5 aanwezig", dan is de vraagprijs de prijs per stuk;
  is een totaalprijs onwaarschijnlijk laag (< €4/TB), dan wordt prijs per stuk aangenomen (≈ in de tabel).
- €/TB voor schijven = prijs per stuk / grootte per schijf.
