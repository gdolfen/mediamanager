# Release Notes

Alle wesentlichen Änderungen zu diesem Projekt werden in dieser Datei dokumentiert. Das Format lehnt sich an [Keep a Changelog](https://keepachangelog.com/) an.

## [1.0.5] – 2026-09-01

### Changed

- **Two-Phase-Scan**: Scan besteht aus zwei Phasen – Phase 1 (Walk) traversiert das Dateisystem schnell und speichert Dateien als `indexed`, Phase 2 (Analyze) führt Hash-Berechnung, EXIF-Auslesung, Geräteauflösung und Thumbnail-Erzeugung mit 4 parallelen Workern durch
- **FileStatus `indexed`**: Neuer Status `indexed` für frisch indexierte Dateien, ersetzt `problem`-Status
- **Probleme separat**: Probleme werden nur noch in der `problems`-Tabelle gespeichert; Dateien bleiben `pending` wenn blockiert

### Fixed

- **Scan-Fortsetzung**: Ein fortgeführter Scan erstellt keinen neuen Eintrag in der Historie mehr – der ursprüngliche `runId` wird aus `scan_progress` übernommen
- **Scan-Fortsetzung**: Bereits gezählte Dateien/Ordner werden aus dem abgebrochenen Scan korrekt übernommen

### Docker

- **Image-Optimierung**: Alpine-Basis, 4-Stufen-Multi-Stage-Build mit geschichtetem Caching
- **Minifizierung**: Backend-JavaScript wird mit esbuild minifiziert
- **Layering**: Dependencies, Build-Output und Production-Deps in separaten Layern – bei Re-Builds werden nur geänderte Layer neu erstellt

## [1.0.3] – 2026-09-01

### Fixed

- **Version**: Korrekte Pfad-Auflösung für `version.txt` im Docker-Container (`../../../version.txt` statt `../../version.txt`)
- **Docker**: `VERSION`-Build-Arg wird in `docker-compose.yml` weitergegeben

## [1.0.2] – 2026-09-01

### Fixed

- **Docker**: `DATA_DIR=/data` wird jetzt im Dockerfile gesetzt, sodass die DB auch bei `docker run` ohne explizite Env-Variable im Volume abgelegt wird

## [1.0.1] – 2026-09-01

### Fixed

- **Scan**: Ordner die mit `.` starten (z.B. `.DS_Store`, `.cache`) werden jetzt ignoriert

## [1.0.0] – 2026-09-01

Initiales Release von **MediaManager**.

### Added

- **Dashboard**: Übersicht über Dateien, Geräte und Scan-Status
- **Bibliothek**: Durchsuchen der verknüpften Zieldateien mit Filtern und Thumbnail-Vorschau
- **Upload**: Hierarchische Navigation (Person → Gerät → Jahr) mit Status-Icons und Übertragungsfunktion
- **Aktionen**: Scan-Steuerung (Upload-Scan, Zielordner-Scan, Recheck) mit Live-Fortschritt
- **Probleme**: Anzeige und Verwaltung von Dateien mit Erkennungsproblemen
- **Geräte**: Geräteverwaltung mit Identifikatoren und Zuordnung
- **Einstellungen**: Pfade, Dateiformate und Zeitplan konfigurieren
- **Logs**: Live-Log-Anzeige mit Filterung nach Level
- **MD5-Deduplizierung**: Automatische Erkennung von Duplikaten über SHA256 + MD5
- **Scan-Fortsetzung**: Unterbrochene Scans können fortgesetzt werden
- **Ignore-System**: Dateien können vom Import ausgeschlossen werden
- **Docker-Unterstützung**: Dockerfile und docker-compose.yml für Deployments
- **GitHub Actions**: Automatischer Docker-Build und GHCR-Publish bei Tag-Push

### Technologie

- Node.js 22 (LTS), TypeScript
- Express (Backend)
- React + Material-UI (Frontend)
- `node:sqlite` (SQLite)
- Docker / Docker Compose
- GitHub Actions + GHCR
