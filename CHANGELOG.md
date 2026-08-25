# Changelog

## 1.1.0 - 2026-08-13

- ENH: Betrieb nur noch über die konfigurierte Open-Data-Portal-Quelle: `apiurl` ist Pflichtfeld und mit der Ressourcen-URL des Datensatzes „Touristische Points of Interests (POI) München“ vorbelegt; der mitgelieferte Demo-Datensatz entfällt als Laufzeitfeature
- ENH: `proxyAktiv` standardmäßig auf „ja“ gesetzt, weil der Portal-Download keine CORS-Header sendet; Direktabruf nur bei CORS-freigebender Quelle
- FIX: Pflichtmetadatum `category` an allen 13 `instanz-config`-Feldern ergänzt (Paketvertrag, fail-closed)
- FIX: `daten.beispiel` als Strukturbeschreibung und `daten.beispiel-url` als funktionierender Beispiel-Endpunkt getrennt
- FIX: Datenschutz in Paket, lokaler Konfiguration und README synchronisiert und an die tatsächlichen Kontakte angeglichen (lokale Vendor-Bibliotheken, ODAS-Proxy, Bilddomänen, localStorage)
- FIX: Lizenztexte an die Lizenzangaben je Datensatz-Eintrag und Bild angepasst, statt den gesamten Portalbestand pauschal als CC0 zu bezeichnen
- FIX: `.gitignore` um `*.zip` ergänzt
- DOC: Spielregeln (vier Schwierigkeitsgrade, 1–3 Leben, Timer nur in Zeit-Modi, Spielende bei 0 Leben, Bestwert je Schwierigkeit) in Store- und App-Beschreibung sowie README korrigiert
- DOC: README um den Abschnitt „Datenquelle und Betriebsarten“ ergänzt

## 1.0.0 - 2026-07-24

- ENH: Erste Version von "Bilder-Rätsel" als generisches touristisches Bild-Duell für POI-Datensätze im schema.org/ODTA-Format
- ENH: Endlos-Spielmodus mit Serie/Streak und lokal gespeichertem Bestwert (localStorage)
- ENH: Mitgelieferter Demo-Datensatz (`app/demo-data.json`, Touristische POI München, CC0) – same-origin geladen, sofort ohne CORS/Proxy spielbar
- ENH: Konfigurierbare Datenquelle über `apiurl` mit automatischer JSON-/CSV-Erkennung und Entpacken gängiger JSON-Hüllen (Array, CKAN `result.records`, `records`, `results`, `data`)
- ENH: feldtolerante Aufbereitung für ODTA-/schema.org-Varianten (mehrsprachige Namen, Bild flach `image-contentUrl` oder verschachtelt `image`, Bildautor:in flach oder verschachtelt)
- ENH: robuster CSV-Parser (Kommata, Anführungszeichen und Zeilenumbrüche in Feldern)
- ENH: Kategorie-Hinweis je Runde und Bildautor-Angabe unter dem Foto
- ENH: ODAS-Proxy-Muster über `proxyAktiv` für konfigurierte Fremdquellen (Standard `nein`; Demo benötigt keinen Proxy)
- ENH: generisches Bild-/Foto-Icon, Frictionless-Schema, generische Store- und App-Beschreibung
- DOC: README mit Datenformen, Feldzuordnung, Demo-Datensatz, Proxy-/CORS-Hinweis und lokaler Testanleitung
