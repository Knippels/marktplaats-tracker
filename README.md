# Marktplaats-tracker

Houdt Marktplaats.nl bij voor homelab-onderdelen (SATA-schijven 4TB+ en mini-pc's) en publiceert een
overzichtspagina op GitHub Pages: **https://knippels.github.io/marktplaats-tracker/**

Per zoekcategorie toont de pagina:
- **Tabel (bovenaan)** met deals (groen) en nieuwe advertenties (blauwe rand) gemarkeerd, en snelfilters
  - schijven: merk, type, grootte, aantal, prijs per stuk, totaal, €/TB
  - mini-pc's: merk, model, score, processor + generatie, RAM (en maximum), opslag, prijs, € per scorepunt
- **Mini-pc-score (0–10) voor Proxmox + Jellyfin** (`scraper/minipc.py`, modellen in `scraper/minipc_models.yml`):
  30% processor (klasse + generatie), 25% Jellyfin-transcodering via de iGPU (volgens de Jellyfin-documentatie:
  6e gen geen HEVC 10-bit, 7e–10e gen HEVC 10-bit, 11e gen/N100 ook AV1-decode, F-processors geen iGPU, AMD lager),
  20% RAM (vermeld, met bonus als uitbreiden tot 32 GB+ kan), 10% opslag (SSD/NVMe), 15% uitbreiding
  (2 schijfsloten, PCIe-slot zoals in M720q/M920q/M90q). Staat de processor niet in de advertentie, dan wordt de meest
  voorkomende processor van dat model aangenomen ("aanname"). Deals = goedkoopste 25% in euro per scorepunt.
- **Interessant en gezien**: per advertentie een ster (interessant) en een vinkje (gezien, dus niet interessant),
  alleen handmatig. Het ene wist het andere. Snelfilter "Interessant" en in "Weergave" de optie "Gezien verbergen";
  interessante advertenties blijven altijd zichtbaar. Synchronisatie tussen apparaten via de knop naast "Bijgewerkt":
  plak een fine-grained GitHub-token (alleen deze repo, Contents: read & write). De markeringen staan in `state.json`
  op de branch `user-state` (die branch start geen scraper-run). Zonder token blijft alles in de browser.
- **Tabel**: schone rijen. Klik op een rij voor de details (foto, opbouw van het cijfer, sterke en zwakke punten,
  verborgen kolommen, omschrijving). Filter per kolom in de rij onder de kopjes, sorteren door op een kopje te klikken,
  kolommen slepen of via "Kolommen" verbergen, tonen en herschikken (wordt per tabblad onthouden in de browser).
  De tabel past zich aan de schermbreedte aan; op een telefoon worden het kaartjes.
- **Score uitgelegd**: klik of hover op een score of op €/punt of €/TB voor de berekening. Per onderdeel staat het
  gewicht, het cijfer en de reden; dit komt uit `score_parts` in de data (`scraper/minipc.py`).
- **Vergelijken**: vink 2 tot 4 advertenties aan en kies "Vergelijk"; de beste waarde per rij is groen.
- **Deals**: onder een vaste grens (bijv. ≤ €12/TB) of de goedkoopste 25%
- **Nieuw**: advertenties van de afgelopen 48 uur; blauwe rand/stip = nieuw sinds je laatste bezoek
- **Prijsverloop**: dagelijks mediaan, goedkoopste 25% en laagste prijs (voor HDD's in €/TB)

## Tabbladen beheren

Via de pagina zelf: het plusje achter de tabbladen, "Tabbladen beheren" of "Tabblad bewerken". Dat past `config.yml`
aan met hetzelfde GitHub-token als hierboven (Contents: read & write geldt voor alle branches). Verwijderen kan met
"ongedaan maken"; de bewaarde gegevens van een verwijderd tabblad blijven in `docs/data/` staan. Na het opslaan
draait de workflow vanzelf; een nieuw tabblad toont de resultaten na een paar minuten. Soorten: `algemeen` (alleen
prijs), `hdd`, `minipc` en `enclosure`.

## Zoekterm toevoegen (handmatig)

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
