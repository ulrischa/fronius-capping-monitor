# Fronius Curtailment Monitor – deutsches Handbuch

Dieses Handbuch erklärt Installation, Betrieb und vor allem die **Interpretation der angezeigten Werte** des Fronius Curtailment Monitor.

Der Monitor ist für Fronius-GEN24-Anlagen gedacht, bei denen geprüft werden soll, ob eine konfigurierte Begrenzung der Netzeinspeisung tatsächlich greift und wann die Anlage wahrscheinlich mehr PV-Leistung liefern könnte, als gerade ins Netz eingespeist werden darf.

## 1. Was der Monitor kann – und was nicht

Der Monitor liest ausschließlich lokale Messwerte aus der Fronius Solar API aus. Er verändert keine Einstellungen am Wechselrichter.

Er kann unter anderem erfassen:

- aktuelle PV-DC-Leistung (`P_PV`)
- AC-Wirkleistung des Wechselrichters (`PAC`)
- Netzeinspeisung und Netzbezug
- Hausverbrauch
- Laden und Entladen der Batterie
- Ladezustand der Batterie (SOC)
- Leistung der beiden MPPT-Eingänge
- zeitliche Verläufe und Tagesmaxima
- Zeitabschnitte, in denen die Netzeinspeisung am konfigurierten Limit liegt
- Indizien dafür, dass tatsächlich abgeregelt wird

Wichtig: Die Fronius Solar API liefert **nicht** die Leistung, die die Module ohne Abregelung in diesem Moment theoretisch liefern könnten. Deshalb kann der Monitor nicht direkt messen:

- wie viele Watt gerade exakt durch Abregelung verloren gehen
- wie viele kWh an einem Tag exakt verloren gegangen sind
- welche ungedrosselte PV-Leistung exakt möglich gewesen wäre

Der Monitor trennt deshalb bewusst zwischen **Messwerten** und **Schlussfolgerungen**.

## 2. Grundprinzip der Einspeisebegrenzung

Die konfigurierte Grenze wird aus der installierten DC-Modulleistung berechnet, sofern kein absolutes Limit eingetragen wurde.

Beispielkonfiguration:

```json
{
  "dcPeakW": 14260,
  "exportLimitPercent": 60,
  "exportLimitW": null
}
```

Bei 14,26 kWp und 60 % ergibt sich:

```text
14.260 W × 0,60 = 8.556 W
```

Das erwartete Einspeiselimit liegt also bei **8,556 kW**.

Wichtig: Das ist ein **Netzeinspeiselimit**, nicht automatisch ein Limit der gesamten PV-Erzeugung. Wenn das Haus gleichzeitig Leistung verbraucht oder die Batterie geladen wird, kann die PV-Leistung deutlich höher als die erlaubte Netzeinspeisung sein.

Beispiel:

```text
PV-Leistung       11,0 kW
Hausverbrauch      1,5 kW
Batterieladung     1,0 kW
Netzeinspeisung    8,5 kW
```

Eine PV-Leistung oberhalb von 8,556 kW widerspricht einer 60-%-Einspeisebegrenzung daher nicht.

## 3. Installation auf dem Raspberry Pi

Voraussetzungen:

- Raspberry Pi OS 64 Bit
- Node.js ab Version 24.15 aus der Node-24-LTS-Reihe
- Git
- Raspberry Pi und Fronius-Wechselrichter im selben lokalen Netzwerk
- aktivierte Fronius Solar API
- möglichst feste oder per DHCP reservierte IP-Adresse des Wechselrichters

Repository klonen:

```bash
git clone https://github.com/ulrischa/fronius-capping-monitor.git
cd fronius-capping-monitor
```

Konfiguration für einen manuellen Test anlegen:

```bash
cp config/config.example.json config/config.json
nano config/config.json
```

Tests ausführen:

```bash
node --test
```

Einmalig einen echten Messwert abrufen:

```bash
node src/index.js --sample
```

Monitor manuell starten:

```bash
node src/index.js
```

Danach ist das Dashboard standardmäßig erreichbar unter:

```text
http://IP-DES-RASPBERRY:3200
```

## 4. Empfohlener Dauerbetrieb mit systemd

Für den Dauerbetrieb ist systemd besser geeignet als Cron. Der Monitor arbeitet mit Abständen von wenigen Sekunden, braucht vergangene Messwerte für die Plateau-Erkennung und soll nach Netzwerkfehlern automatisch weiterlaufen.

Installation:

```bash
sudo bash scripts/install-service.sh
```

Beim ersten Aufruf wird die Konfiguration angelegt, der Dienst aber noch nicht gestartet. Danach:

```bash
sudo nano /etc/fronius-monitor/config.json
sudo systemctl enable --now fronius-monitor
```

Status prüfen:

```bash
sudo systemctl status fronius-monitor
```

Live-Protokoll anzeigen:

```bash
sudo journalctl -u fronius-monitor -f
```

Gesundheitsstatus der Anwendung prüfen:

```bash
curl http://127.0.0.1:3200/api/v1/health
```

### Dienst stoppen, starten oder länger pausieren

Den laufenden Monitor vorübergehend stoppen:

```bash
sudo systemctl stop fronius-monitor
```

Dabei wird nur der aktuelle Prozess beendet. Der automatische Start beim nächsten Systemstart bleibt aktiviert.

Wieder starten:

```bash
sudo systemctl start fronius-monitor
```

Nach einer Konfigurationsänderung neu starten:

```bash
sudo systemctl restart fronius-monitor
```

Soll der Monitor länger pausieren und auch nach einem Neustart des Raspberry Pi nicht automatisch starten, Dienst gleichzeitig stoppen und deaktivieren:

```bash
sudo systemctl disable --now fronius-monitor
```

Später wieder für den automatischen Start aktivieren und sofort starten:

```bash
sudo systemctl enable --now fronius-monitor
```

Kurz gesagt: `stop` ist für eine vorübergehende Pause geeignet, `disable --now` für eine längere Stilllegung. Die bereits gespeicherten Messdaten bleiben dabei erhalten.

## 5. Wichtige Konfigurationswerte

### `froniusHost`

IP-Adresse oder lokaler Hostname des Wechselrichters, ohne `http://` und ohne Pfad.

```json
"froniusHost": "192.168.178.50"
```

### `deviceId`

Fronius-Geräte-ID des Wechselrichters. Bei vielen GEN24-Anlagen ist das `1`.

### `dcPeakW`

Installierte Modulleistung in Watt peak. Möglichst den exakten Wert eintragen.

Beispiel für 14,26 kWp:

```json
"dcPeakW": 14260
```

### `exportLimitPercent`

Prozentuale Einspeisebegrenzung.

```json
"exportLimitPercent": 60
```

### `exportLimitW`

Optionales absolutes Limit. Ist hier eine Zahl eingetragen, hat sie Vorrang vor `exportLimitPercent`.

### `limitToleranceW`

Toleranz um das erwartete Limit. Standard:

```json
"limitToleranceW": 60
```

Bei einem Limit von 8.556 W gelten damit beispielsweise 8.520 W oder 8.590 W noch als „am Limit“.

### `plateauWindowSeconds`

Zeitfenster für die Plateau-Erkennung. Standard: 90 Sekunden.

### `minimumPlateauSamples`

Mindestanzahl gültiger Messungen innerhalb dieses Fensters. Standard: 12.

### `fullSocPercent`

Ab welchem SOC die Batterie als voll betrachtet wird. Standard: 99,5 %.

## 6. Bedeutung der Live-Werte

### PV-Erzeugung

Die angezeigte PV-Erzeugung ist `P_PV` aus der Fronius PowerFlow-API. Das ist die **aktuelle DC-Leistung am Arbeitspunkt des Wechselrichters**.

Sie ist nicht gleichbedeutend mit der theoretisch maximal möglichen Modulleistung unter den aktuellen Wetterbedingungen.

### Netzeinspeisung

Der Fronius-Wert `P_Grid` ist beim Einspeisen negativ. Der Monitor dreht das Vorzeichen für die Anzeige um:

```text
Fronius P_Grid = -8.540 W
Dashboard      =  8.540 W Einspeisung
```

### Hausverbrauch

`P_Load` wird von Fronius beim Verbrauch typischerweise negativ geliefert. Der Monitor zeigt ihn als positiven Verbrauchswert an.

### Batterie

Bei `P_Akku` gilt:

- negativer Rohwert = Batterie wird geladen
- positiver Rohwert = Batterie wird entladen

Im Dashboard werden Laden und Entladen getrennt und verständlich positiv dargestellt.

### Wechselrichter

Hier wird die AC-Wirkleistung (`PAC`) angezeigt. Sie kann von der DC-PV-Leistung abweichen, etwa durch Umwandlungsverluste, Batterieleistung und Messzeitpunkte.

## 7. Die Evidenzbewertung richtig lesen

Die Evidenzbewertung ist das Herzstück des Monitors.

Sie ist **keine Wahrscheinlichkeit in Prozent**. Ein Score von `65/100` bedeutet nicht, dass mit 65 % Wahrscheinlichkeit abgeregelt wird. Der Score ist nur ein transparentes Punktesystem, mit dem mehrere beobachtbare Indizien zusammengefasst werden.

Die aktuelle Logik vergibt folgende Punkte:

| Beobachtung | Punkte |
| --- | ---: |
| Netzeinspeisung liegt innerhalb der Toleranz am konfigurierten Limit | 45 |
| zusätzlich: Batterie ist voll | +20 |
| zusätzlich: stabiles Plateau am Limit erkannt | +25 |

Daraus entstehen die Stufen:

| Score | Anzeige | Interpretation |
| ---: | --- | --- |
| unter 40 | Keine Hinweise | derzeit kein auffälliges Muster |
| 40–59 | Möglich | Einspeisung liegt am erwarteten Limit, kann aber zufällig sein |
| 60–79 | Wahrscheinlich | mehrere Indizien sprechen gleichzeitig für Begrenzung |
| ab 80 | Sehr wahrscheinlich | die wesentlichen Indizien treten gemeinsam auf |

Mit der aktuellen Gewichtung ergeben sich in der Praxis vor allem diese Fälle:

### Keine Hinweise

Beispiel:

```text
Limit:          8,556 kW
Einspeisung:    6,2 kW
```

Die Anlage liegt deutlich unter der Grenze. Daraus lässt sich keine Abregelung ableiten.

Das bedeutet aber nicht automatisch, dass die Anlage technisch ihre maximal mögliche Leistung erreicht. Bewölkung, Temperatur, Ausrichtung oder andere Faktoren können die Erzeugung begrenzen.

### Möglich – 45/100

Beispiel:

```text
Limit:          8,556 kW
Einspeisung:    8,54 kW
Batterie:       nicht voll
Plateau:        nein
```

Die Einspeisung liegt auffällig genau am Limit. Eine einzelne Messung reicht aber nicht aus, um eine Abregelung überzeugend zu erkennen.

### Wahrscheinlich – 65/100

Beispiel:

```text
Einspeisung:    am Limit
Batterie:       voll
Plateau:        noch nicht erkannt
```

Die Batterie kann praktisch keine zusätzliche Energie mehr aufnehmen und die Einspeisung liegt gleichzeitig am Limit. Das ist ein deutlich stärkeres Indiz.

### Wahrscheinlich – 70/100

Auch ein stabiles Plateau am Limit kann ohne als voll erkannte Batterie 70 Punkte ergeben.

Das kann beispielsweise vorkommen, wenn der Batterie-SOC oder der Batteriemodus nicht eindeutig gemeldet wird.

### Sehr wahrscheinlich – 90/100

```text
Einspeisung:    am Limit
Batterie:       voll
Plateau:        erkannt
```

Das ist die stärkste automatische Einstufung des Monitors. Über längere Zeit liegt die Einspeisung stabil am konfigurierten Limit, während die Batterie voll ist.

Das ist ein starkes Indiz für aktive Einspeisebegrenzung, aber weiterhin keine direkte Messung der ungedrosselten Modulleistung.

## 8. Was bedeutet „Plateau erkannt“?

Ein einzelner Messwert nahe 8,556 kW kann Zufall sein. Deshalb betrachtet der Monitor ein Zeitfenster von standardmäßig 90 Sekunden.

Ein Plateau wird nur erkannt, wenn unter anderem:

- genügend Messpunkte vorhanden sind
- der beobachtete Zeitraum einen großen Teil des 90-Sekunden-Fensters abdeckt
- mindestens 80 % der Messwerte am Limit liegen
- die Einspeisewerte untereinander nur wenig schwanken

Ein längeres, ungewöhnlich flaches Plateau exakt am konfigurierten Limit ist wesentlich aussagekräftiger als ein einzelner Treffer.

## 9. Der Lastsprung-Test

Der Lastsprung-Test ist die stärkste praktische Prüfung, die der Monitor ohne Veränderung der Wechselrichtereinstellungen unterstützen kann.

### Durchführung

Am besten an einem wolkenfreien oder sehr gleichmäßig sonnigen Zeitpunkt:

1. Batterie vollständig laden lassen.
2. Warten, bis die Einspeisung stabil am konfigurierten Limit liegt.
3. Einen bekannten größeren Verbraucher einschalten, beispielsweise einen Heizlüfter oder Heizkörper mit etwa 1–2 kW.
4. Dashboard beobachten.

Beispiel:

Vorher:

```text
PV              8,94 kW
Haus            0,12 kW
Einspeisung     8,56 kW
```

Nach Einschalten eines Verbrauchers:

```text
PV             10,82 kW
Haus            2,12 kW
Einspeisung     8,55 kW
```

Die PV-Leistung ist um rund 1,88 kW gestiegen, während die Einspeisung praktisch gleich blieb. Das ist ein sehr starkes Indiz dafür, dass der Wechselrichter zuvor Leistung zurückgenommen hat und nach dem Lastsprung zusätzliche PV-Leistung nutzen konnte.

Der Monitor speichert einen solchen Lastsprung als Ereignis und zeigt die beobachtete Zusatzleistung als Untergrenze an.

### Wichtige Einschränkung

Auch ein Lastsprung ist ohne zusätzliche Einstrahlungsmessung kein mathematischer Beweis dafür, wie viel Leistung exakt vorher abgeregelt wurde. Wenn sich während derselben Sekunden die Sonneneinstrahlung verändert, kann ein Teil des Leistungsanstiegs wetterbedingt sein.

Deshalb sollte ein Lastsprung möglichst:

- bei stabiler Sonne durchgeführt werden
- mit einem klar definierten Verbraucher erfolgen
- mehrere Male reproduziert werden

Ein reproduzierbares Muster ist deutlich überzeugender als ein einzelnes Ereignis.

## 10. Tagesauswertung

### PV-Maximum

Höchster gemessener `P_PV`-Wert des gewählten Tages.

Ein Tagesmaximum deutlich unter der installierten kWp-Leistung beweist allein keinen Fehler. Modulleistung in kWp ist ein Labor-Nennwert unter Standard-Testbedingungen. Dachausrichtung, Temperatur, Sonnenstand, Wetter und Wechselrichterregelung beeinflussen die reale Leistung.

### Max. Einspeisung

Höchste gemessene Netzeinspeisung des Tages.

Bei einem konfigurierten Limit von 8,556 kW ist es normal, wenn kurze Werte geringfügig darüber oder darunter liegen. Genau deshalb arbeitet die Analyse mit einer Toleranz.

### Nahe am Limit

Summierte beobachtete Zeit, in der die Einspeisung innerhalb der konfigurierten Toleranz am Limit lag.

Längere Messausfälle werden dabei nicht einfach vollständig als Beobachtungszeit gezählt. Dadurch soll vermieden werden, dass ein Netzwerkausfall fälschlich als lange Abregelungsphase erscheint.

### Wahrscheinlich abgeregelt

Summierte Zeit mit einem Evidenz-Score ab 60.

Das entspricht den Einstufungen „Wahrscheinlich“ und „Sehr wahrscheinlich“.

Diese Zeit ist **nicht** gleichbedeutend mit einer exakt nachgewiesenen Verlustdauer. Sie bezeichnet Zeiträume, in denen die Messwerte das definierte Indizmuster zeigen.

### Nachgewiesene Zusatzleistung

Hier erscheint der höchste an diesem Tag erkannte Lastsprung, zum Beispiel:

```text
≥ 1,88 kW
```

Der Wert bedeutet: Bei einem erkannten Lastsprung stieg die PV-Leistung mindestens um diesen Betrag, während die Netzeinspeisung praktisch gleich am Limit blieb.

Für eine belastbare Interpretation sollte der Lastsprung kontrolliert und bei stabilen Wetterbedingungen reproduziert werden.

## 11. Diagramm interpretieren

Das Tagesdiagramm zeigt mehrere Datenreihen:

- **PV Mittel**: gemittelte PV-Leistung innerhalb des jeweiligen Diagramm-Zeitfensters
- **PV Spitze**: höchster PV-Wert innerhalb dieses Zeitfensters
- **MPPT 1 / MPPT 2**: Leistung der beiden Tracker
- **Einspeisung**: Netzeinspeisung
- **Limit**: konfigurierte Einspeisegrenze
- **Haus**: Hausverbrauch
- **Akku-SOC**: Ladezustand der Batterie

Orange hinterlegte Bereiche markieren Zeitabschnitte, in denen mindestens die Einstufung „Wahrscheinlich“ erreicht wurde.

### Typisches Abregelungsmuster

Ein verdächtiges Muster sieht beispielsweise so aus:

- PV-Erzeugung steigt am Vormittag
- Batterie wird voll
- Netzeinspeisung erreicht das Limit
- die Einspeisekurve läuft längere Zeit ungewöhnlich flach entlang der Limitlinie
- wechselnder Hausverbrauch wird teilweise durch Änderungen der PV-Leistung ausgeglichen

Besonders interessant ist, wenn die PV-Kurve bei zunehmendem Hausverbrauch nach oben reagiert, die Einspeisung aber am gleichen Limit bleibt.

## 12. MPPT-Werte interpretieren

Die MPPT-Leistung wird aus Spannung × Strom berechnet:

```text
MPPT 1 = UDC × IDC
MPPT 2 = UDC_2 × IDC_2
```

Die Summe der MPPT-Leistungen kann mit `P_PV` verglichen werden.

Kleine Unterschiede sind normal, weil:

- die API-Werte nicht zwingend exakt im selben Moment erfasst werden
- Werte gerundet werden
- interne Umwandlungs- und Messunterschiede bestehen

Große, dauerhaft unplausible Abweichungen können dagegen auf Daten- oder Konfigurationsprobleme hinweisen.

Die beiden MPPT-Verläufe sind außerdem hilfreich, wenn die Module auf zwei Dachseiten oder Strings verteilt sind. Dann lässt sich erkennen, ob eine Seite deutlich anders arbeitet als erwartet.

## 13. Datenhaltung

Standardmäßig bleiben Rohmessungen 14 Tage erhalten.

Ältere Daten werden zu Minutenwerten verdichtet. Dabei bleiben wichtige Informationen erhalten, darunter:

- Mittelwerte
- PV- und Einspeisespitzen
- MPPT-Maxima
- Evidenzzeiten

Dadurch bleibt die Datenbank auch bei mehrjährigem Betrieb überschaubar.

Die systemd-Installation speichert die Datenbank hier:

```text
/var/lib/fronius-monitor/fronius-monitor.sqlite
```

Sicherung:

```bash
sudo systemctl stop fronius-monitor
sudo cp /var/lib/fronius-monitor/fronius-monitor.sqlite /PFAD/ZUM/BACKUP/
sudo systemctl start fronius-monitor
```

## 14. Adaptive Abfrageintervalle

Der Monitor fragt nicht permanent mit maximaler Geschwindigkeit ab.

Standardmäßig:

- nachts: alle 60 Sekunden
- normale Erzeugung: alle 10 Sekunden
- nahe am Einspeiselimit oder bei fast vollem Akku: alle 2 Sekunden

Dadurch werden genau in den interessanten Phasen hochauflösende Daten gesammelt, ohne Wechselrichter und Raspberry unnötig zu belasten.

## 15. Typische Fehlinterpretationen

### „Meine Anlage hat 14,26 kWp, zeigt aber nur 9 kW. Also ist etwas kaputt.“

Nicht zwingend. kWp ist die Nennleistung der Module unter Standard-Testbedingungen. Die reale Leistung hängt stark von Wetter, Sonnenstand, Temperatur, Ausrichtung und Regelung ab.

### „Bei 60 % Begrenzung darf die PV-Anlage nie mehr als 8,556 kW erzeugen.“

Falsch. Begrenzt wird die Netzeinspeisung. Eigenverbrauch und Batterieladung können zusätzlich versorgt werden.

### „65/100 heißt 65 % Wahrscheinlichkeit.“

Nein. Der Score ist ein internes Evidenz-Punktesystem und keine statistisch kalibrierte Wahrscheinlichkeit.

### „Sehr wahrscheinlich heißt bewiesen.“

Nein. Es bedeutet, dass die verfügbaren lokalen Messwerte sehr gut zu einer aktiven Begrenzung passen. Die ungedrosselte Leistung wird weiterhin nicht direkt gemessen.

### „Aus der Zeit am Limit kann ich verlorene kWh berechnen.“

Nicht zuverlässig. Dafür müsste bekannt sein, wie viel Leistung ohne Begrenzung in jedem einzelnen Moment verfügbar gewesen wäre.

## 16. Kompatibilität mit anderen Fronius-Anlagen

Der Monitor verwendet die lokalen Solar-API-v1-Endpunkte:

```text
/solar_api/v1/GetPowerFlowRealtimeData.fcgi
/solar_api/v1/GetInverterRealtimeData.cgi?Scope=Device&DeviceId=...&DataCollection=CommonInverterData
```

Damit ist die Anwendung nicht hart auf eine einzelne Seriennummer zugeschnitten. Sie kann grundsätzlich auch mit anderen Fronius-Anlagen funktionieren, wenn diese Endpunkte und die benötigten Felder bereitstellen.

Die Auswertungslogik ist jedoch insbesondere für ein System mit:

- Fronius GEN24
- Smart Meter
- Batterie
- konfigurierter Einspeisebegrenzung

entwickelt und getestet.

Bei anderen Fronius-Modellen sollte deshalb zunächst mit:

```bash
node src/index.js --sample
```

geprüft werden, ob alle benötigten Werte plausibel geliefert werden.

## 17. Sicherheit

Die Anwendung besitzt nur lesende HTTP-Endpunkte. Sie verändert keine Einstellungen des Wechselrichters.

Das Dashboard sollte trotzdem nicht direkt aus dem Internet erreichbar gemacht werden. Für Fernzugriff besser VPN, beispielsweise WireGuard oder Tailscale, verwenden.

Die Fronius Solar API selbst ist im lokalen Netzwerk üblicherweise ohne Benutzeranmeldung lesbar. Deshalb sollte auch der Wechselrichter nicht direkt ins Internet freigegeben werden.

## 18. Was ist ein überzeugender Nachweis für Abregelung?

Am überzeugendsten ist nicht ein einzelner Wert, sondern die Kombination mehrerer Beobachtungen:

1. korrekt konfiguriertes Einspeiselimit
2. Batterie voll
3. sonnige und möglichst stabile Wetterlage
4. Einspeisung über längere Zeit direkt am Limit
5. Plateau-Erkennung des Monitors
6. kontrollierter Lastsprung
7. PV-Leistung steigt beim Lastsprung, während die Einspeisung am Limit bleibt
8. derselbe Effekt lässt sich wiederholen

Wenn dieses Muster reproduzierbar auftritt, ist eine aktive Einspeisebegrenzung sehr gut belegt, auch wenn die Solar API die theoretisch ungedrosselte Leistung selbst nicht ausgibt.