# Bilder-Rätsel

**Bilder-Rätsel** ist ein Spiel für den
[Open Data App Store](https://open-data-app-store.de/): Sie sehen das Foto einer
touristischen Sehenswürdigkeit und wählen aus zwei Namen den richtigen aus
("Ist das X oder Y?"). Vier Schwierigkeitsgrade bestimmen den Spielverlauf; die
beste Punktzahl wird je Schwierigkeitsgrad als persönlicher Bestwert gespeichert.

Die App arbeitet mit POI-Datensätzen im **schema.org/ODTA-Standard**. Die
Datenquelle wird über die Instanz-Konfiguration festgelegt (`apiurls` mit dem Eintrag "pois" ist
Pflichtfeld) und standardmäßig über den ODAS-Proxy geladen. Die App enthält
**keine Demo- oder Beispieldaten**.

Die App entspricht der
[Open Data App Spezifikation](https://open-data-apps.github.io/open-data-app-docs/open-data-app-spezifikation/)
und basiert auf dem `oda-generic`-Template (Bootstrap 5.3.8, Vanilla JS, kein Build-Schritt).

## Funktionen

- **Bild-Duell**: Foto einer Sehenswürdigkeit plus zwei Namen zur Auswahl
- **Vier Schwierigkeitsgrade**:
  - `Leicht` – 3 Leben, kein Zeitlimit
  - `Mittel` – 2 Leben, 20 Sekunden pro Runde
  - `Schwer` – 1 Leben, 12 Sekunden pro Runde, ähnliche Antwortalternativen aus derselben Kategorie
  - `Hardcore` – 1 Leben, 7 Sekunden pro Runde, ähnliche Antwortalternativen
- **Rundentimer nur in den Zeit-Modi** (Mittel, Schwer, Hardcore)
- **Spielende bei 0 Leben**; Punkte = Anzahl richtiger Antworten in Folge
- **Bestwert je Schwierigkeitsgrad** lokal im Browser gespeichert (`localStorage`)
- **Kategorie-Hinweis** und **Bildnachweis** (Autor:in) je Runde, sofern im Datensatz vorhanden
- **Darstellung** (Hell/Dunkel/Auto) umschaltbar, Einstellung lokal gespeichert

## Für wen ist diese App?

Die App richtet sich an alle, die eine Region spielerisch entdecken möchten –
Einheimische, Gäste und z. B. Schulklassen. Es ist kein besonderes Datenwissen
nötig: Wer gern rätselt, kann sofort loslegen.

## Datenquelle und Betriebsarten

Die App verarbeitet POI-Datensätze im **schema.org/ODTA-Format** (Points of Interest mit
Name, Kategorie und Foto je Eintrag). Sie enthält **keine Demo- oder Snapshot-Daten** und
ist ohne konfigurierte Datenquelle nicht spielbar; der `apiurls`-Eintrag "pois" ist ein Pflichtfeld.

Die voreingestellte Quelle ist identisch in `app-package.json`
(`instanz-config.apiurls.urls[0].default`) und `odas-config/config.json` hinterlegt:

- **Ressource (CSV):** <https://opendata.muenchen.de/dataset/5447d89c-256a-4091-92e2-e248e0ed6758/resource/b6b45b42-2e6c-43af-898f-c5cfa1d660b8/download/___>
- **Datensatz:** <https://opendata.muenchen.de/dataset/touristische-points-of-interests-poi-muenchen>
- **Open Data Portal:** <https://opendata.muenchen.de>

Die Portalressource enthält Lizenzangaben je Eintrag und Bild. In der am 13. August 2026
geprüften Fassung waren 172 Einträge als CC0 und 3 als CC BY 4.0 gekennzeichnet. Bei den
31 für das Spiel nutzbaren Bildern waren 12 als CC0, 13 als CC BY-SA 4.0 und 6 als
CC BY 4.0 gekennzeichnet. Maßgeblich sind jeweils die aktuellen Angaben der Portalressource.

### Betriebsarten

- **ODAS (Live):** `proxyAktiv: "ja"` (Standard) – die App sendet den Abruf an den
  app-lokalen `odp-data`-Endpunkt (POST, URL-kodierter `path`-Parameter); die Anfrage an
  die Datenquelle stellt der ODAS-Server. Echte Proxy-Antworten sind nur in der
  ODAS-Live-Umgebung prüfbar.
- **Direktmodus:** `proxyAktiv: "nein"` – der Browser lädt die Quelle direkt. Das setzt
  CORS-freigebende Antwortheader der Quelle voraus; der voreingestellte Portal-Download
  sendet keine CORS-Header und funktioniert daher im Direktmodus nicht.
- **Live Server / Standalone:** Weder Live Server noch der Standalone-Container stellen
  den `odp-data`-Endpunkt des ODAS bereit. Lokal werden deshalb nur Konfigurations- und
  UI-Verdrahtung geprüft; ohne CORS-freigebende Testquelle kann die Datenquelle lokal
  nicht geladen werden.

### Datenformat und Parser

- **JSON** wird anhand des ersten Zeichens erkannt; gängige Hüllen (reines Array,
  CKAN `result.records`, `records`, `results`, `result`, `data`) werden automatisch entpackt.
- **CSV** wird anhand des Inhalts erkannt und mit der lokal ausgelieferten Bibliothek
  **PapaParse** (`app/vendor/papaparse/`) geparst – keine externe Laufzeitabhängigkeit.
  Komma- und Semikolon-Trennzeichen werden automatisch erkannt. Erwartet wird eine Tabelle mit einer Spalte je Feld
  (u. a. `@id`, `name`, `bayernCloudType`, `image-contentUrl`); gequotete Felder mit
  Anführungszeichen und Zeilenumbrüchen sowie BOM und CRLF werden behandelt.
- Fehlerhafte oder nicht lesbare Quellen werden als sichtbare Fehlermeldung angezeigt;
  eine leere Quelle ist von einer fehlenden Konfiguration getrennt.

### Feldzuordnung

Die Feldzuordnung ist tolerant gegenüber gängigen ODTA-/schema.org-Varianten:

| Zweck | Erkannte Felder |
| --- | --- |
| ID | `@id` oder `identifier` |
| Name | `name` (String **oder** mehrsprachiges Objekt `{de,en,…}` / Array) |
| Kategorie | `bayernCloudType` oder `category` (Unterkategorien mit `::` werden zu ` – `) |
| Foto | `image-contentUrl` (flach) **oder** `image` als String, Objekt `{contentUrl\|url}` oder Array davon |
| Bildautor:in | `image-author-givenName` / `image-author-familyName` **oder** `image.author` |

## Datenmodell

`assets/schema.json` beschreibt die für das Spiel relevanten Felder der flachen
ODTA-Tabelle als Frictionless Table Schema (u. a. `@id`, `name`, `bayernCloudType`,
`image-contentUrl`, `image-license`). `@id` ist Pflichtfeld; die voreingestellte
Portal-Ressource enthält in allen 175 Einträgen einen `@id`-Wert.

## Konfiguration

| Parameter | Zweck | Pflicht |
| --- | --- | --- |
| `apiurls` (Eintrag "pois") | Vollständige JSON-/CSV-URL eines POI-Datensatzes im schema.org/ODTA-Format | ja |
| `proxyAktiv` | `ja` (Standard) für Abruf über den ODAS-Proxy, `nein` für Direktabruf (nur mit CORS) | ja |
| `urlDaten` | Katalogseite des Datensatzes (für die Datenquellen-Angabe) | nein |
| `titel` | sichtbarer Titel in der Kopfzeile | ja |
| `seitentitel` | Titel des Browser-Tabs | ja |
| `icon` | Portal-Logo in der Kopfzeile | ja |
| `beschreibung` / `kontakt` / `datenschutz` / `impressum` / `fusszeile` | Inhaltsseiten | ja |
| `brandingCSS` / `brandingCSSFile` | optionales Instanz-Branding | nein |

Jeder von `app/app.js` gelesene Wert ist in `app-package.json` unter `instanz-config`
deklariert und in `odas-config/config.json` für lokale Tests gespiegelt. Die
`category`-Metadaten der `instanz-config` sind Editor-/Paketmetadaten und werden nicht
in die lokale Konfiguration gespiegelt.

## Lokale Entwicklung

### VS Code Live Server

Live Server aus der Projektwurzel starten und `http://127.0.0.1:5500/app/` öffnen
(Standardport 5500, ggf. projektspezifisch abweichend).

```json
{
  "liveServer.settings.host": "127.0.0.1",
  "liveServer.settings.root": "/",
  "liveServer.settings.file": "app/index.html"
}
```

`liveServer.settings.root` bleibt `/`, damit `app/` und `odas-config/` als
Geschwisterpfade erreichbar sind. `getConfigUrl()` in `app/app-base.js` erkennt
Localhost selbstständig und lädt `../odas-config/config.json`. Da lokal weder der
ODAS-`odp-data`-Endpunkt noch eine CORS-freigebende Quelle zur Verfügung steht, prüft
der lokale Lauf nur Konfiguration, Darstellung und Fehlerpfade – die Datenquelle
selbst lädt erst im ODAS-Live-Betrieb.

### Docker Compose

```bash
make build up
```

Die App ist anschließend unter <http://localhost:8090> erreichbar. Auch im
Standalone-Container gibt es keinen `odp-data`-Endpunkt; für einen echten
Datenabruf ist eine CORS-freigebende Quelle oder der ODAS-Live-Betrieb nötig.

## Prüfung und Auslieferung

```bash
node --check app/app.js
node --check app/app-base.js
python3 -m json.tool app-package.json >/dev/null
python3 -m json.tool odas-config/config.json >/dev/null
python3 -m json.tool assets/schema.json >/dev/null
make check-app   # benötigt das Sibling-Checkout ../odas-tools/app-check.sh
make zip
```

`make zip` erzeugt das Liefer-ZIP mit `app/`, `assets/`, `app-package.json` und
`CHANGELOG.md`. Die App wird **ohne Demo- oder Beispieldaten** ausgeliefert. Lokale
Dateien unter `odas-config/` sowie die Infrastrukturdateien sind nicht im ZIP enthalten.

## Beim Aufruf kontaktierte Drittanbieter

Beim Aufruf dieser App werden keine externen Server für Programmbibliotheken
kontaktiert; alle Bibliotheken werden lokal aus `app/vendor/` ausgeliefert.

- `www.muenchen.travel` — Fotos der Sehenswürdigkeiten (Bilddateien der Datenquelle)

Die konfigurierte Datenquelle wird standardmäßig über den ODAS-Proxy geladen; die
Anfrage an die Datenquelle stellt der ODAS-Server. Bei `proxyAktiv: "nein"` lädt der
Browser die Quelle direkt – dafür muss die Quelle CORS-freigebende Antwortheader senden.

## Wichtige Dateien

| Datei | Zweck |
| --- | --- |
| `app/app.js` | Spiellogik, Daten-Laden (JSON/CSV), Proxy-Hilfsfunktionen |
| `app/app.css` | app-spezifisches Styling (Foto-Bühne, Antwort-Buttons) |
| `app/vendor/` | lokal ausgelieferte Bibliotheken (Bootstrap, PapaParse) – keine CDN-Abhängigkeit |
| `app/app-base.js` | Konfiguration, Routing und gemeinsame Seitendarstellung (Template) |
| `app/index.html` | gemeinsames, responsives HTML-Grundgerüst (Template) |
| `app-package.json` | Store-Metadaten und Instanz-Konfiguration |
| `assets/schema.json` | Frictionless-Datenschema der Datensatz-Felder |
| `odas-config/config.json` | lokale Testkonfiguration |

## Autor

© 2026 Ondics GmbH
