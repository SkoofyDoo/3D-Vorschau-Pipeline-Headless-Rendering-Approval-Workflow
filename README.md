# 3D-Vorschau-Pipeline – Headless Rendering & Approval-Workflow

Ein produktionsnaher Fullstack-Service für automatisierte 3D-Modell-Vorschaugenerierung im medizintechnischen Bereich. Das System rendert OBJ-Modelle serverseitig in einem headless Browser, speichert die Ergebnisse in Nextcloud und steuert den gesamten Freigabe-Workflow über eine React-Oberfläche.

---

## Architektur

```
React-Frontend (useApproval Hook)
        │
        │  REST / Polling
        ▼
Express-Backend (Node.js)
        │
        ├── /render-to-view   → Puppeteer startet headless Chromium
        │                        → renderer.html lädt Three.js
        │                        → 12 Frames (6× texturiert + 6× Wireframe)
        │                        → Frames werden via exposeFunction an Node.js gestreamt
        │                        → Node.js speichert Frames in Nextcloud (WebDAV)
        │
        ├── /dav/*            → Geschützter Proxy zu Nextcloud
        │                        (nur RAW/ und VIEW/ erlaubt, kein direkter Modellzugriff)
        │
        └── /renderer         → Statisches Serving von renderer.html
```

---

## Features

- **Headless Three.js Rendering** – OBJ-Modelle werden ohne sichtbaren Browser gerendert (Puppeteer + WebGL2 offscreen canvas)
- **12 automatische Kameraansichten** – 6 texturierte Ansichten (±X, ±Y, ±Z) + 6 Wireframe-Ansichten
- **Streaming-Architektur** – Frames werden per `page.exposeFunction` direkt von der Browserseite an den Node.js-Prozess gestreamt, ohne temporäre Dateien
- **Modellschutz via Proxy** – Der Endnutzer erhält niemals direkten Zugriff auf das OBJ-Original; alle Anfragen laufen durch einen kontrollierten `/dav/*`-Proxy
- **Approval-Workflow** – React Hook mit Tag-basiertem Statusmanagement (YES / NO / IN PROGRESS / FINISHED etc.) und Polling bis das finale Modell bereitsteht
- **Nextcloud-Integration** – Speicherung und Verwaltung aller Dateien über WebDAV

---

## Tech Stack

| Schicht | Technologie |
|---|---|
| Backend | Node.js, Express |
| Headless Rendering | Puppeteer (Chromium headless) |
| 3D Engine | Three.js r160 (OBJLoader, WebGL2) |
| Dateispeicher | Nextcloud WebDAV (`webdav` npm) |
| Frontend | React, Custom Hooks |
| Dateiformate | OBJ + PNG-Textur → PNG/JPEG Frames |

---

## Wie es funktioniert

### 1. Rendering (`/render-to-view`)

```
POST /render-to-view
{
  "folder": "scan_12345",
  "size": 1024,
  "fov": 35,
  "format": "png",
  "limit": 12
}
```

Der Server:
1. Prüft ob `baked_mesh.obj` und `baked_mesh_tex0.png` im Nextcloud-Ordner vorhanden sind
2. Startet einen headless Chromium-Prozess via Puppeteer
3. Lädt `renderer.html` – eine eigenständige Three.js-Seite
4. Ruft `window.renderPreviewsStream()` im Browser-Kontext auf
5. Empfängt jeden fertigen Frame via `page.exposeFunction('__pushFrame', ...)` direkt in Node.js
6. Speichert jeden Frame sofort in den `VIEW_<folder>`-Ordner in Nextcloud

### 2. Renderer (`renderer.html`)

- Erstellt einen WebGL2-Canvas mit `preserveDrawingBuffer: true` (notwendig für `toDataURL`)
- Lädt das OBJ-Modell und die Textur asynchron
- Zentriert und skaliert das Modell automatisch (`fitAndCenter`)
- Rendert 6 Kamerawinkel (Cube-Face-Positionen) im texturierten Modus
- Erstellt `WireframeGeometry`-Overlays und rendert dieselben 6 Winkel nochmals im Wireframe-Modus
- Streamt jeden Frame als Base64 DataURL zurück an Node.js

### 3. Modellschutz (`/dav/*`)

```javascript
// Nur RAW/ und VIEW/ sind zugänglich
if (!/^\/(RAW|VIEW)\//i.test(remotePath)) {
    return res.status(403).send('Zugriff verweigert');
}
```

Nextcloud-Credentials bleiben ausschließlich serverseitig. Der Browser-Client sieht nur `/dav/VIEW/frame.png` – niemals die Nextcloud-URL oder Zugangsdaten.

### 4. Approval-Workflow (`useApproval`)

```
Nutzer sieht Vorschau
      │
      ├── Akzeptiert → Tag YES gesendet → Polling startet → Download freigegeben
      └── Ablehnt   → Tag NO gesendet  → Feedback-Formular erscheint
```

Der Hook verwaltet den gesamten Zustand: Button-Status, Fehlerzustände, Polling-Intervall (10 s), Download-URL und Tag-Kommunikation mit dem Backend.

---

## Besondere technische Entscheidungen

**Warum `exposeFunction` statt Screenshots am Ende?**
Frames werden einzeln gestreamt und sofort in Nextcloud gespeichert. Das reduziert den Speicherbedarf im Node.js-Prozess und erlaubt Fortschritts-Feedback ohne alles im RAM zu halten.

**Warum headless Browser statt eines Node.js-nativen 3D-Renderers?**
Three.js läuft nativ im Browser mit WebGL2-Hardwarebeschleunigung. Node.js-seitige Alternativen (z. B. `gl` + headless-gl) sind deutlich aufwändiger zu konfigurieren und weniger stabil im Serverumfeld.

**Warum Proxy statt direkter Nextcloud-URL?**
Das OBJ-Modell ist geistiges Eigentum des Kunden. Ein direkter Link würde das Modell öffentlich zugänglich machen. Der Proxy erlaubt feingranulare Zugriffskontrolle pro Pfad.

---

## Projektkontext

Entwickelt als Teil eines medizintechnischen Scan-Workflows. Patienten-Scans werden als 3D-Modelle verarbeitet und müssen vor der finalen Produktion durch den Kunden digital freigegeben werden. Dieses System automatisiert die Vorschaugenerierung und den Freigabeprozess vollständig.
