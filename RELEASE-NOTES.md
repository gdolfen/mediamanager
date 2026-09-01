# Release Notes

Alle wesentlichen Änderungen zu diesem Projekt werden in dieser Datei dokumentiert. Das Format lehnt sich an [Keep a Changelog](https://keepachangelog.com/) an.

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
