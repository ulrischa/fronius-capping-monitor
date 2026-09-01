# Fronius Curtailment Monitor

Ein schlanker lokaler Monitor für Fronius GEN24: Er zeichnet Solar-API-Momentanwerte in hoher Auflösung auf, stellt sie auf einer responsiven Website dar und bewertet nachvollziehbar, ob eine dynamische Einspeisebegrenzung wahrscheinlich aktiv ist.

Die Anwendung läuft dauerhaft auf einem Raspberry Pi, nutzt einen eigenen frei wählbaren Port und benötigt weder Fronius Solar.web noch eine andere Cloud.

## Warum Node.js statt Python?

Für einen reinen Datensammler wäre Python mindestens genauso gut. Hier gehören jedoch Sammler, REST-API und Website zusammen. Node.js hält alles in einer Laufzeit und bleibt mit reinem JavaScript leichter weiterzuentwickeln.

| Kriterium | Node.js/JavaScript | Python |
| --- | --- | --- |
| Dauerhafter Poller | sehr gut | sehr gut |
| Website und REST-API | gleiche Sprache wie Frontend | zweite Sprache für Frontend nötig |
| Betrieb | ein systemd-Dienst | ebenfalls ein systemd-Dienst |
| Build-Schritt | keiner | keiner |
| Fazit für dieses Projekt | **beste Gesamtlösung** | besser nur für den Sammler allein |

Cron ist hier die falsche Betriebsart: Abfragen alle 2 bis 60 Sekunden, Plateau-Erkennung und Fehlerzustände brauchen einen dauerhaften Prozess. systemd startet ihn beim Booten und nach Fehlern neu.

## Funktionen

- Zwei lokale Fronius-Endpunkte pro Messzyklus
- Adaptive Abfrage: 2 s nahe am Limit, 10 s normal, 60 s nachts
- SQLite mit 14 Tagen Rohdaten und langfristigen Minutenwerten
- Korrekte, explizite Vorzeichen für Einspeisung, Bezug, Verbrauch und Batterie
- PV-DC-Leistung, AC-Leistung und beide MPPTs
- Einspeiselimit, Abstand, Akku-Zustand und Plateau-Erkennung
- Evidenzstufen statt erfundener Gewissheit
- Verbraucher-Schritttest als nachgewiesene Untergrenze zusätzlicher PV-Leistung
- Tagesmaxima und Zeiten nahe beziehungsweise wahrscheinlich am Limit
- Tagesdiagramm mit Mittelwerten und erhaltener PV-Spitzenspur
- Responsive, barrierearme Oberfläche ohne externe CDN-Abhängigkeiten
- Read-only REST-API und Health-Endpunkt
- Demo-Modus ohne Wechselrichter

## Voraussetzungen

- Raspberry Pi 3, 4 oder 5 mit Raspberry Pi OS 64-Bit
- Node.js **24 LTS** und npm
- Git sowie `python3`, `make` und `g++` als Reserve, falls SQLite lokal gebaut werden muss
- Raspberry Pi und Fronius GEN24 im selben lokalen Netz
- Aktivierte Solar API am GEN24
- Eine feste oder in der Fritz!Box reservierte IP-Adresse für den Fronius

Node.js empfiehlt für Produktionsanwendungen eine LTS-Version. Prüfen:

```bash
node --version
npm --version
```

`node --version` muss `v24...` ausgeben. Nutze zur Installation die [offizielle Node.js-Downloadseite](https://nodejs.org/en/download) und das Linux-ARM64-Paket für ein 64-Bit-Raspberry-Pi-OS.

## Schnelltest auf PC oder Raspberry Pi

```bash
git clone https://github.com/ulrischa/fronius-capping-monitor.git
cd fronius-capping-monitor
cp config/config.example.json config/config.json
nano config/config.json
npm ci
npm test
npm start
```

Danach öffnen:

```text
http://IP-DES-RASPBERRY:3200
```

Zum Testen der Oberfläche ohne Fronius:

```bash
npm run demo
```

Ein einzelner echter Messzyklus ohne dauerhaften Server:

```bash
npm run sample
```

## Konfiguration

Die wichtigste Datei ist `config/config.json` beziehungsweise bei der systemd-Installation `/etc/fronius-monitor/config.json`.

```json
{
  "froniusHost": "192.168.178.50",
  "deviceId": 1,
  "dcPeakW": 14260,
  "exportLimitPercent": 60,
  "exportLimitW": null,
  "port": 3200,
  "bindAddress": "0.0.0.0",
  "timeZone": "Europe/Berlin",
  "databasePath": "data/fronius-monitor.sqlite"
}
```

- `froniusHost`: IP oder lokaler Hostname ohne `http://` und ohne Pfad.
- `deviceId`: Bei deiner Anlage laut API `1`.
- `dcPeakW`: Exakte installierte Modulleistung in Wp. Wenn es 14,26 kWp sind, ist `14260` richtig. Nicht unnötig auf 14,3 kWp runden.
- `exportLimitPercent`: Prozentuale Grenze, bei dir voraussichtlich `60`.
- `exportLimitW`: Optionaler absoluter Wert. Wenn gesetzt, hat er Vorrang vor Prozenten.
- `port`: Eigener Port der Website. Wenn `3200` schon belegt ist, beispielsweise `3210` verwenden.
- `bindAddress`: `0.0.0.0` macht die Seite im Heimnetz erreichbar; `127.0.0.1` nur auf dem Raspberry selbst.

Andere Anwendungen auf dem Raspberry bleiben unberührt, solange jede einen anderen Port nutzt.

## Installation als Raspberry-Pi-Dienst

Zuerst die Systemwerkzeuge installieren und das Repository laden:

```bash
sudo apt update
sudo apt install -y git python3 make g++
git clone https://github.com/ulrischa/fronius-capping-monitor.git
cd fronius-capping-monitor
```

Danach den Installer ausführen:

```bash
sudo bash scripts/install-service.sh
```

Beim ersten Lauf wird die Konfiguration angelegt, aber der Dienst bewusst noch nicht gestartet. Werte bearbeiten:

```bash
sudo nano /etc/fronius-monitor/config.json
sudo systemctl enable --now fronius-monitor
```

Status und Logs:

```bash
sudo systemctl status fronius-monitor
sudo journalctl -u fronius-monitor -f
```

Health-Endpunkt:

```bash
curl http://127.0.0.1:3200/api/v1/health
```

Nach einer Konfigurationsänderung:

```bash
sudo systemctl restart fronius-monitor
```

Der Dienst läuft unter einem eigenen Benutzer, darf nur in `/var/lib/fronius-monitor` schreiben und wird bei einem Fehler automatisch neu gestartet.

## Was die Werte bedeuten

Fronius verwendet in deinen Antworten negative Werte für Abflüsse aus dem System. Die Oberfläche normalisiert das eindeutig:

| Fronius-Rohwert | Rohwert bei dir | Anzeige |
| --- | ---: | --- |
| `P_Grid` | negativ | positive Netzeinspeisung |
| `P_Grid` | positiv | positiver Netzbezug |
| `P_Load` | negativ | positiver Hausverbrauch |
| `P_Akku` | negativ | Batterie lädt |
| `P_Akku` | positiv | Batterie entlädt |
| `P_PV` | positiv | aktuelle PV-DC-Leistung |
| `PAC` | positiv | AC-Wirkleistung des Wechselrichters |

MPPT-Leistungen werden direkt als `UDC × IDC` und `UDC_2 × IDC_2` berechnet. Die Summe kann dadurch unabhängig mit `P_PV` verglichen werden.

## Bewertung der Abregelung

Die Solar API liefert **keinen Wert für die momentan mögliche ungedrosselte Leistung**. Deshalb gibt der Monitor keine erfundene exakte Verlustleistung oder verlorene Energie aus.

Die Bewertung nutzt nachvollziehbare Indizien:

- `Möglich`: Einspeisung liegt innerhalb der Toleranz am konfigurierten Limit.
- `Wahrscheinlich`: Zusätzlich ist der Akku voll beziehungsweise kann kaum Leistung aufnehmen.
- `Sehr wahrscheinlich`: Die Einspeisung bleibt über das konfigurierte Zeitfenster wie ein Plateau am Limit.

Wolken können eine einzelne Messung zufällig nahe an die Grenze bringen. Genau deshalb ist ein Einzelwert schwächer als ein längeres Plateau.

### Verbraucher-Schritttest

Am aussagekräftigsten ohne Änderung der Wechselrichtereinstellung:

1. Akku ist voll und Einspeisung liegt stabil am Limit.
2. Einen bekannten größeren Verbraucher einschalten, beispielsweise 2 kW.
3. Steigt `P_PV` annähernd entsprechend, während die Netzeinspeisung am Limit bleibt, speichert der Monitor ein `LOAD_STEP`-Ereignis.

Die gemessene PV-Erhöhung wird als **Untergrenze** zusätzlicher verfügbarer Leistung ausgewiesen, nicht als exakte vorher verlorene Leistung.

## Datenhaltung

- Aktuelle Rohwerte: standardmäßig 14 Tage
- Ältere Werte: Verdichtung auf Minutenebene
- Erhalten bleiben: Durchschnitt, kurze PV-/Einspeisespitzen, MPPT-Maxima und Evidenzzeiten
- Datenbank: `/var/lib/fronius-monitor/fronius-monitor.sqlite` bei systemd-Installation

Sicheres Backup:

```bash
sudo systemctl stop fronius-monitor
sudo cp /var/lib/fronius-monitor/fronius-monitor.sqlite /PFAD/ZUM/BACKUP/
sudo systemctl start fronius-monitor
```

## Update

Im geklonten Projektordner den aktuellen Stand laden und den Installer erneut ausführen:

```bash
git pull --ff-only
sudo bash scripts/install-service.sh
```

Die vorhandene Konfiguration und Datenbank werden nicht überschrieben. Der Dienst wird nach dem Update neu gestartet.

## REST-API

Die API ist ausschließlich lesend:

- `GET /api/v1/health`
- `GET /api/v1/status`
- `GET /api/v1/days/YYYY-MM-DD`
- `GET /api/v1/measurements?date=YYYY-MM-DD&maxPoints=1200`
- `GET /api/v1/events?date=YYYY-MM-DD`

Der vollständige Vertrag steht in [`docs/api.md`](docs/api.md).

## Entwicklung

Kein TypeScript, kein React und kein Build-Schritt:

```bash
npm run dev
npm test
npm run check
```

Struktur:

```text
src/       Poller, Analyse, SQLite, REST-API und Server
public/    HTML, CSS, JavaScript und SVG-Diagramm
test/      Unit- und Integrationstests
config/    Beispielkonfiguration
scripts/   systemd-Dienst und Installer
docs/      API und Architekturentscheidungen
```

## Fehlersuche

### Keine Daten

```bash
curl http://FRONIUS-IP/solar_api/v1/GetPowerFlowRealtimeData.fcgi
```

Wenn das scheitert, Solar API am GEN24 aktivieren und Netzwerk/IP prüfen.

### Port belegt

```bash
sudo ss -ltnp | grep ':3200'
```

Dann `port` in der Konfiguration ändern und Dienst neu starten.

### Dienst startet nicht

```bash
sudo systemctl status fronius-monitor
sudo journalctl -u fronius-monitor -n 100 --no-pager
```

### Zeit oder Tagesgrenze falsch

`timeZone` muss für Deutschland `Europe/Berlin` sein. Messwerte werden intern als Zeitstempel gespeichert und erst für lokale Kalendertage gruppiert.

## Sicherheit

Die Fronius Solar API ist im lokalen Netz ohne Authentifizierung lesbar. Der Monitor bietet selbst keine Schreibfunktion und akzeptiert über die Website keine frei wählbare Ziel-URL. Stelle Port `3200` nicht ungeprüft ins Internet. Für Zugriff von außen ist ein VPN wie WireGuard oder Tailscale sinnvoller als eine Portfreigabe.
