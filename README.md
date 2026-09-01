# MediaManager

Automatisches Einsortieren von Fotos und Videos aus einem Upload-Verzeichnis in nach Jahr/Monat/Tag strukturierte Zielordner – mit Geräte-Zuordnung, Problembehandlung und Miniatur-/Vollbild-Vorschau.

## Funktionen

- Scannt das Upload-Verzeichnis **rekursiv** (read-only)
- Ermittelt das Aufnahmedatum aus EXIF (Fotos) bzw. Container-Metadaten (Videos), sonst aus der Dateizeit
- Prüft das Datum gegen Datumsangaben im Dateinamen und gegen die Dateizeit
- Ordnet Dateien Geräten zu (EXIF Make+Model **oder** Dateinamen-Präfix) – **ohne Zuordnung wird nicht übertragen**
- Normalisiert Zielnamen: `yyyyMMdd_HHmmss_<Gerät>_[Original].Endung`
- Zielstruktur: `<ziel>/<JJJJ>/<MM Monatsname>/<JJJJ_MM_TT>/<dateiname>` (Ordner werden automatisch angelegt)
- Vermeidet Doppel-Übertragung per SHA-256-Hash (Upload-Dateien bleiben liegen)
- Problemliste mit anwendbaren Lösungen (z.B. Gerät anlegen, Datum übernehmen, ignorieren)
- Geräteverwaltung mit automatisch ermitteltem Nutzungszeitraum (min/max Aufnahmedatum)
- Miniatur-Vorschau + Vollbild für Bilder und Videos (Videoframes via ffmpeg)
- Fortschrittsanzeige und Historie der Transfer-Läufe
- Format-Übersicht inkl. gefundener, aber nicht unterstützter Formate

## Architektur

```
Monorepo
├── backend/   Node.js + TypeScript, Express, node:sqlite, exifr, sharp, ffmpeg/ffprobe
└── frontend/  React + Material UI (MUI), Vite
```

- **Eine DB** (SQLite) in einem eigenen Volume: Dateien, Probleme, Geräte, Einstellungen, Transfer-Historie, Format-Statistik.
- **Kein natives DB-Modul** – `node:sqlite` ist in Node.js integriert, dadurch läuft das Projekt auf Windows und Linux identisch.
- ffmpeg/ffprobe werden als gebündelte Binaries (`ffmpeg-static`, `ffprobe-static`) mitgeliefert.

## Datenmodell (Auszug)

| Tabelle | Inhalt |
| --- | --- |
| `settings` | Basis-Pfade für upload/fotos/videos (per UI editierbar) |
| `devices` / `device_identifiers` | Geräte mit mehreren Identifikatoren (`exif` oder `filename`) |
| `files` | Jede gescannte Datei mit Hash, Quelle, Ziel, Datum, Gerät, Status |
| `problems` | Probleme je Datei mit Typ, Schweregrad, Aktion, gelöst-Status |
| `transfer_runs` | Historie der Läufe (scanned/transferred/skipped/problems) |
| `formats` | Gefundene Datei-Endungen inkl. Unterstützungs-Status |

## Pfad-Portabilität (Windows-IDE ⇄ Linux/Docker)

In der DB werden **nie absolute Pfade** gespeichert, sondern logische Pfade:

- `source_rel_path` = Pfad relativ zum Upload-Ordner (mit `/` als Trenner)
- `target_rel_path` = Pfad relativ zum Ziel (fotos oder videos), z.B. `2024/01 Januar/2024_01_01/20240101_123456_iPhone13_IMG_0001.jpg`

Die drei Basis-Pfade liegen in `settings` und werden per UI gepflegt. Beim Umzug (z.B. Windows → Docker) wird die `.db`-Datei ins Daten-Volume kopiert und die Pfade einmalig in der UI gesetzt – alle Einträge funktionieren weiter.

## Transfer-Ablauf

1. Pfade validieren (Upload lesbar, Ziele beschreibbar)
2. Upload rekursiv scannen, Formate erfassen
3. Je Datei: SHA-256-Hash → bereits übertragen? (Hash in DB) → überspringen
4. Metadaten lesen (EXIF/Container), Gerät auflösen (EXIF → Dateinamen-Präfix)
5. Datum bestimmen: Override → Meta → Dateizeit; Dateinamen-Datum gegenprüfen
6. Zielname + Zielpfad berechnen, Kopie atomar (Temp-Datei + Rename)
7. DB-Eintrag, Probleme schreiben, Geräte-Nutzungszeitraum aktualisieren

**Blockierend** (keine Übertragung): unbekanntes Gerät, Datums-Abweichung im Dateinamen, Zieldatei existiert bereits.
**Nicht blockierend** (Hinweis): fehlende Meta-Daten, Meta- vs. Dateizeit-Abweichung, Datum außerhalb der Geräte-Nutzungszeit.

## Problem-Aktionen

| Problem | Aktionen |
| --- | --- |
| Unbekanntes Gerät | Gerät anlegen/zuordnen (Dialog) |
| Keine Metadaten (Datum aus Datei) | Dateizeit übernehmen |
| Meta-Datum weicht von Dateizeit ab | Meta-Datum akzeptieren / Dateizeit übernehmen |
| Datum im Dateinamen weicht ab | Meta/Dateizeit akzeptieren / Dateinamen-Datum übernehmen |
| Zieldatei existiert | Ignorieren |
| Nicht unterstütztes Format | Ignorieren |
| Nicht lesbar | Ignorieren |
| Außerhalb Geräte-Nutzungszeit | OK / Ignorieren |

Gewählte Lösungen werden **pro Datei** als Override gespeichert und beim nächsten Lauf angewendet.

## Entwicklung (IDE, Windows/macOS/Linux)

Voraussetzungen: Node.js ≥ 22, npm.

```bash
npm install          # installiert backend + frontend (workspaces)
npm run dev          # Backend auf http://localhost:3000
npm run dev:frontend # Frontend (Vite) auf http://localhost:5173 (Proxy auf :3000)
```

Die drei Verzeichnisse werden beim ersten Start per Env-Variablen gesetzt oder in der UI unter **Einstellungen** konfiguriert:

```bash
# Optional, sonst Defaults /upload, /fotos, /videos
UPLOAD_DIR=C:\Users\...\upload
FOTOS_DIR=D:\Medien\fotos
VIDEOS_DIR=D:\Medien\videos
DATA_DIR=./data
```

Beim Start werden die Pfade aus `settings` gelesen (falls bereits gesetzt), sonst aus den Env-Variablen, sonst die Defaults.

## Docker

```bash
# Build + Start
docker compose up -d --build

# Variablen (optional, siehe docker-compose.yml)
UPLOAD_PATH=/volume1/photo/upload   # wird read-only gemountet
FOTOS_PATH=/volume1/photo/fotos
VIDEOS_PATH=/volume1/photo/videos
DATA_PATH=/volume1/docker/mediamanager
PORT=8080
```

Web-UI: `http://<nas>:8080`

> Hinweis: Das Upload-Volume ist im Container **read-only** gemountet. Der Container selbst schreibt nur in die Zielordner und das Daten-Volume. Falls dein NAS andere Benutzer-IDs verwendet, setze in der `docker-compose.yml` die Zeile `user: "1000:1000"` passend ein.

## Deployment mit Docker aus GHCR

```bash
# Neuestes Image aus GHCR ziehen
docker pull ghcr.io/gdolfen/mediamanager:latest

# Oder eine spezifische Version
docker pull ghcr.io/gdolfen/mediamanager:1.0.0

# Starten
docker run -d \
  -p 8080:8080 \
  -v /path/to/upload:/upload:ro \
  -v /path/to/fotos:/fotos \
  -v /path/to/videos:/videos \
  -v /path/to/data:/data \
  ghcr.io/gdolfen/mediamanager:latest
```

## Release über GitHub Actions

Der Workflow `.github/workflows/docker-publish.yml` baut das Docker-Image und publiziert es als GitHub-Package (GHCR), wenn ein **Tag** gepusht wird:

```bash
git tag v1.0.0
git push origin v1.0.0
```

Ergebnis:

- `ghcr.io/gdolfen/mediamanager:1.0.0` (Tag ohne führendes `v`)
- `ghcr.io/gdolfen/mediamanager:latest`
- Die Tag-Version wird als `--build-arg VERSION=…` an den Docker-Build übergeben und in `/app/version.txt` geschrieben.

Die Version erscheint automatisch als Badge **im Web-UI-Header** und über den Endpunkt `GET /api/version`. Für lokale Builds ohne Tag steht dort `dev` bzw. die `package.json`-Version.

## API (Auszug)

| Methode | Pfad | Beschreibung |
| --- | --- | --- |
| GET | `/api/version` | Aktuelle Version (aus `version.txt` oder `package.json`) |
| POST | `/api/transfer` | Transfer-Lauf starten |
| POST | `/api/transfer/abort` | Lauf abbrechen |
| GET | `/api/transfer/status` | Aktueller Status / Fortschritt |
| GET | `/api/transfer/runs` | Historie |
| GET | `/api/files` | Dateien (Filter: status, search, root) |
| GET | `/api/problems` | Probleme (Filter: resolved, type) |
| POST | `/api/problems/:id/resolve` | Lösung anwenden (Aktion im Body) |
| POST | `/api/problems/:id/device` | Gerät für Problem anlegen/zuordnen |
| GET/POST/PUT/DELETE | `/api/devices` | Geräteverwaltung |
| GET/PUT | `/api/settings` | Basis-Pfade |
| GET | `/api/formats` | Format-Übersicht |
| GET | `/api/stats` | Dashboard-Statistiken |
| GET | `/api/media/thumbnail/:id` | Miniatur (JPEG, gecacht) |
| GET | `/api/media/file/:id` | Original (mit Range-Support für Videos) |

## Tests

```bash
node node_modules/tsx/dist/cli.mjs backend/scripts/smoke-test.mts
```

Der Smoke-Test legt temporäre Verzeichnisse an, erzeugt Beispielbilder, startet den Server im Prozess und prüft Scan, Geräte-Zuordnung, Datumslogik, Probleme, Lösungen, Übertragung, Format-Übersicht, Pfad-Portabilität und Thumbnails.