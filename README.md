# Meine Musik App (Spotify-Integration)

Eine kleine Web-App, die Songs über die Spotify Web API sucht und über das
**Spotify Web Playback SDK** direkt im Browser abspielt.

Wichtig: Zum Abspielen brauchen deine Nutzer (bzw. du selbst) einen
**Spotify Premium**-Account. Die App streamt nur über Spotify — es werden
keine Dateien heruntergeladen oder gehostet.

## 1. Spotify App registrieren

1. Gehe zum [Spotify for Developers Dashboard](https://developer.spotify.com/dashboard).
2. Klicke auf **Create app**.
3. Trage einen Namen ein, z.B. "Meine Musik App".
4. Bei **Redirect URIs** genau die URL eintragen, unter der du die App lokal
   öffnest, z.B.:
   ```
   http://127.0.0.1:5500/
   ```
   (Der Slash am Ende ist wichtig – muss exakt mit `REDIRECT_URI` in `app.js`
   übereinstimmen.)
5. Bei **Which API/SDKs are you planning to use?** die Option
   **Web Playback SDK** ankreuzen.
6. Speichern und die **Client ID** aus den App-Settings kopieren.

## 2. Client ID eintragen

Öffne `app.js` und ersetze:

```js
const CLIENT_ID = "DEINE_SPOTIFY_CLIENT_ID";
```

Ein Client Secret wird **nicht** benötigt – die App nutzt den
Authorization-Code-Flow mit PKCE, der komplett im Browser läuft.

## 3. Lokal starten

Die App muss über `http://` (nicht `file://`) laufen, sonst lehnt Spotify
den Login ab. Einfachster Weg:

```bash
cd spotify-music-app
npx serve -l 5500
```

Dann im Browser öffnen: `http://127.0.0.1:5500`

(Alternative: `python3 -m http.server 5500`)

Achte darauf, dass Port und Pfad exakt zur Redirect URI im Dashboard passen.

## 4. Nutzen

1. "Mit Spotify einloggen" klicken → Spotify-Login/Consent-Screen.
2. Nach Rückleitung: Playlists werden geladen, Suche ist nutzbar.
3. Song anklicken → Wiedergabe startet direkt im Browser über den
   eingebetteten Player ("Meine Musik App" taucht auch in der offiziellen
   Spotify-App als verfügbares Gerät auf).

## Funktionsumfang

- Login via OAuth 2.0 / PKCE (kein Backend nötig)
- Songsuche über die Web API
- Anzeige & Wiedergabe eigener Playlists
- Player-Leiste mit Play/Pause, Skip, Lautstärke

## Bekannte Grenzen (durch Spotify vorgegeben)

- Erfordert Spotify Premium zum Abspielen.
- Kein Download / keine Offline-Nutzung, kein Umgehen von Werbung im Free-Tier.
- Tokens liegen aktuell in `sessionStorage` (verschwinden bei Tab-Schließung) –
  für eine "richtige" Produktions-App würde man Tokens sicherer verwalten
  und Refresh-Token-Rotation serverseitig absichern.

## Mögliche nächste Schritte

- Eigenes Backend für sicheres Token-Handling (z.B. wenn du die App
  veröffentlichen willst).
- "Meine Bibliothek" (gespeicherte Songs) via `/me/tracks`.
- Warteschlange / Queue-Ansicht.
- Deploy z.B. auf Vercel/Netlify (dort dann die Produktions-URL als
  zusätzliche Redirect URI im Dashboard eintragen).
