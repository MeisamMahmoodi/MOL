# Meine Musik App (Spotify-Integration, PWA)

Eine Musik-App im Swiss/Apple-Look, die Songs über die Spotify Web API sucht
und über das **Spotify Web Playback SDK** direkt im Browser abspielt.
Installierbar als PWA auf dem Homescreen (iOS/Android).

Wichtig: Zum Abspielen wird ein **Spotify Premium**-Account benötigt. Die App
streamt nur über Spotify — es werden keine Dateien heruntergeladen oder gehostet.

## Live

https://mol-omega.vercel.app (automatisch deployt aus diesem Repo via Vercel)

## Struktur

```
index.html    App-Shell, Screens (Home / Suche / Bibliothek / Playlist / Player)
style.css     Design (helles Swiss/Apple-Layout, "liquid glass" Tab-Bar)
app.js        Spotify-Auth (PKCE), Web API Calls, Web Playback SDK, Service-Worker-Registrierung
sw.js         Service Worker für Offline-Cache + automatische Updates
manifest.json PWA-Manifest (Icons, Name, Standalone-Modus)
icons/        App-Icons (192, 512, maskable, Apple Touch Icon)
```

## 1. Spotify App registrieren

1. [Spotify for Developers Dashboard](https://developer.spotify.com/dashboard) → **Create app**.
2. Bei **Redirect URIs** die Produktions-URL (mit Slash am Ende) eintragen,
   z.B. `https://mol-omega.vercel.app/`.
3. Bei **Which API/SDKs are you planning to use?** **Web API** und
   **Web Playback SDK** ankreuzen.
4. Client ID aus den App-Settings kopieren und in `app.js` bei `CLIENT_ID`
   eintragen. Ein Client Secret wird **nicht** benötigt (PKCE-Flow läuft
   komplett im Browser).

Hinweis: Seit Februar 2026 läuft eine neu erstellte App automatisch im
**Development Mode** mit eingeschränktem Zugriff (u.a. `limit` bei der Suche
max. 10, bis zu 5 autorisierte Nutzer). Für mehr Details: [Web API Changelog
Februar 2026](https://developer.spotify.com/documentation/web-api/references/changes/february-2026).

## 2. Deploy (Vercel + GitHub)

Das Repo ist mit Vercel verbunden — jeder Push auf `main` deployt automatisch
neu. Kein manuelles Hochladen mehr nötig.

## 3. PWA installieren

- **iOS**: Seite in Safari öffnen → Teilen-Button → "Zum Home-Bildschirm".
- **Android/Desktop Chrome**: Seite öffnen → Adressleiste zeigt ein
  Installieren-Symbol, oder Menü → "App installieren".

## 4. Updates & Cache

Die App aktualisiert sich selbst — **kein Löschen/Neuinstallieren nötig**:

1. Der Service Worker (`sw.js`) prüft alle 60 Sekunden sowie bei jedem
   Öffnen der App auf eine neue Version.
2. Ist eine neue Version verfügbar, erscheint unten ein Hinweis
   "Neue Version verfügbar" mit einem "Aktualisieren"-Button.
3. Klick darauf lädt die neue Version und startet die Seite neu.

**Wichtig für jedes Update mit Code-Änderungen:** In `sw.js` die Konstante
`CACHE_VERSION` erhöhen (z.B. `"v1"` → `"v2"`). Nur so merkt der Service
Worker zuverlässig, dass sich etwas geändert hat, und zeigt den
Update-Hinweis an. Ohne Versionserhöhung könnte der alte Cache teilweise
bestehen bleiben.

## Funktionsumfang

- Login via OAuth 2.0 / PKCE (kein Backend nötig)
- Home: zuletzt gehörte Songs
- Suche über die Web API
- Bibliothek: eigene Playlists inkl. Detailansicht mit Tracklist
- Vollbild-Player: Play/Pause, Skip, Shuffle, Repeat, Fortschrittsanzeige
- Installierbare PWA mit Offline-App-Shell und automatischen Updates

## Bekannte Grenzen (durch Spotify vorgegeben)

- Erfordert Spotify Premium zum Abspielen.
- Kein Download / keine Offline-Musikwiedergabe — nur Streaming über Spotify.
- App läuft im Development Mode: nur bis zu 5 autorisierte Spotify-Accounts
  können sich einloggen, solange keine Extended-Quota-Freigabe von Spotify
  vorliegt.
- Tokens liegen in `sessionStorage` (verschwinden bei Tab-/App-Schließung).

## Mögliche nächste Schritte

- Eigenes Backend für sicheres Token-Handling, falls die App für mehr als
  5 Nutzer geöffnet werden soll (Extended Quota Mode bei Spotify beantragen).
- Warteschlange / Queue-Ansicht.
- Offline-Hinweis-UI, wenn kein Netz verfügbar ist.
