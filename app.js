/* =========================================================================
   Meine Musik App – Spotify Integration
   Auth: Authorization Code Flow mit PKCE (kein Client Secret nötig)
   Playback: Spotify Web Playback SDK (benötigt Spotify Premium)
   ========================================================================= */

// ---- 1. KONFIGURATION -----------------------------------------------------
// Trage hier deine eigene Client ID aus dem Spotify Developer Dashboard ein:
// https://developer.spotify.com/dashboard
const CLIENT_ID = "3ed25a0a5f6e4b6084dc1347644c823b";

// Muss EXAKT mit der Redirect URI übereinstimmen, die du im Dashboard
// hinterlegt hast (inkl. Slash am Ende, falls vorhanden).
const REDIRECT_URI = window.location.origin + window.location.pathname;

const SCOPES = [
  "streaming",
  "user-read-email",
  "user-read-private",
  "user-read-playback-state",
  "user-modify-playback-state",
  "playlist-read-private",
  "playlist-read-collaborative",
  "user-library-read",
].join(" ");

const AUTH_ENDPOINT = "https://accounts.spotify.com/authorize";
const TOKEN_ENDPOINT = "https://accounts.spotify.com/api/token";
const API_BASE = "https://api.spotify.com/v1";

// ---- 2. PKCE HELFER --------------------------------------------------------
function generateRandomString(length) {
  const possible =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let text = "";
  const values = crypto.getRandomValues(new Uint8Array(length));
  values.forEach((v) => (text += possible[v % possible.length]));
  return text;
}

async function sha256(plain) {
  const encoder = new TextEncoder();
  const data = encoder.encode(plain);
  return crypto.subtle.digest("SHA-256", data);
}

function base64UrlEncode(arrayBuffer) {
  return btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

async function generateCodeChallenge(codeVerifier) {
  const hashed = await sha256(codeVerifier);
  return base64UrlEncode(hashed);
}

// ---- 3. TOKEN SPEICHER (in-memory + sessionStorage für Reload-Überleben) --
const TokenStore = {
  get accessToken() {
    return sessionStorage.getItem("sp_access_token");
  },
  get refreshToken() {
    return sessionStorage.getItem("sp_refresh_token");
  },
  get expiresAt() {
    return Number(sessionStorage.getItem("sp_expires_at") || 0);
  },
  save({ access_token, refresh_token, expires_in }) {
    sessionStorage.setItem("sp_access_token", access_token);
    if (refresh_token) sessionStorage.setItem("sp_refresh_token", refresh_token);
    sessionStorage.setItem("sp_expires_at", String(Date.now() + expires_in * 1000));
  },
  clear() {
    sessionStorage.removeItem("sp_access_token");
    sessionStorage.removeItem("sp_refresh_token");
    sessionStorage.removeItem("sp_expires_at");
  },
  isValid() {
    return !!this.accessToken && Date.now() < this.expiresAt - 5000;
  },
};

// ---- 4. LOGIN STARTEN -------------------------------------------------------
async function redirectToSpotifyLogin() {
  const codeVerifier = generateRandomString(64);
  sessionStorage.setItem("sp_code_verifier", codeVerifier);
  const codeChallenge = await generateCodeChallenge(codeVerifier);

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    code_challenge_method: "S256",
    code_challenge: codeChallenge,
  });

  window.location.href = `${AUTH_ENDPOINT}?${params.toString()}`;
}

// ---- 5. CODE GEGEN TOKEN TAUSCHEN ------------------------------------------
async function exchangeCodeForToken(code) {
  const codeVerifier = sessionStorage.getItem("sp_code_verifier");

  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT_URI,
    code_verifier: codeVerifier,
  });

  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    throw new Error("Token-Austausch fehlgeschlagen: " + (await res.text()));
  }

  const data = await res.json();
  TokenStore.save(data);
}

async function refreshAccessToken() {
  const refreshToken = TokenStore.refreshToken;
  if (!refreshToken) return false;

  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) return false;
  const data = await res.json();
  TokenStore.save(data);
  return true;
}

async function getValidToken() {
  if (TokenStore.isValid()) return TokenStore.accessToken;
  const ok = await refreshAccessToken();
  if (!ok) throw new Error("Kein gültiger Token, bitte neu einloggen.");
  return TokenStore.accessToken;
}

// ---- 6. SPOTIFY WEB API HELFER ---------------------------------------------
async function spotifyFetch(path, options = {}) {
  const token = await getValidToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  if (res.status === 204) return null;
  if (!res.ok) throw new Error(`API-Fehler ${res.status}: ${await res.text()}`);
  return res.json();
}

async function getCurrentUser() {
  return spotifyFetch("/me");
}

async function searchTracks(query) {
  // Seit dem Spotify-API-Update von Februar 2026 liegt der maximale "limit"-Wert
  // für Development-Mode-Apps bei 10 (vorher 50) - siehe:
  // https://developer.spotify.com/documentation/web-api/references/changes/february-2026
  const data = await spotifyFetch(
    `/search?q=${encodeURIComponent(query)}&type=track&limit=10`
  );
  return data.tracks.items;
}

async function getUserPlaylists() {
  const data = await spotifyFetch("/me/playlists?limit=50");
  return data.items;
}

async function getPlaylistTracks(playlistId) {
  // GET /playlists/{id}/tracks wurde im Februar-2026-Update entfernt,
  // ersetzt durch GET /playlists/{id}/items. Das Feld "track" pro Eintrag
  // heißt jetzt "item". Wir prüfen defensiv auf beide Varianten.
  const data = await spotifyFetch(`/playlists/${playlistId}/items?limit=50`);
  return data.items.map((i) => i.item ?? i.track).filter(Boolean);
}

async function playTrackUris(uris, deviceId) {
  await spotifyFetch(`/me/player/play?device_id=${deviceId}`, {
    method: "PUT",
    body: JSON.stringify({ uris }),
  });
}

// ---- 7. WEB PLAYBACK SDK ----------------------------------------------------
let player = null;
let deviceId = null;

window.onSpotifyWebPlaybackSDKReady = () => {
  // Der Player wird erst nach erfolgreichem Login initialisiert (siehe init()).
};

function createPlayer() {
  player = new Spotify.Player({
    name: "Meine Musik App",
    getOAuthToken: (cb) => {
      getValidToken().then(cb);
    },
    volume: 0.5,
  });

  player.addListener("ready", ({ device_id }) => {
    deviceId = device_id;
    console.log("Player bereit, device_id:", device_id);
  });

  player.addListener("not_ready", ({ device_id }) => {
    console.log("Device offline:", device_id);
  });

  player.addListener("player_state_changed", (state) => {
    if (!state) return;
    updateNowPlaying(state);
  });

  player.addListener("initialization_error", ({ message }) => console.error(message));
  player.addListener("authentication_error", ({ message }) => console.error(message));
  player.addListener("account_error", ({ message }) =>
    console.error("Account-Fehler (Premium erforderlich?):", message)
  );

  player.connect();
}

function updateNowPlaying(state) {
  const track = state.track_window.current_track;
  document.getElementById("track-name").textContent = track.name;
  document.getElementById("track-artist").textContent = track.artists
    .map((a) => a.name)
    .join(", ");
  document.getElementById("track-cover").src = track.album.images[0]?.url || "";
  document.getElementById("play-pause-btn").textContent = state.paused ? "▶️" : "⏸";
  document.getElementById("player-bar").classList.remove("hidden");
}

// ---- 8. UI RENDERING --------------------------------------------------------
function renderTrackList(container, tracks, onClick) {
  container.innerHTML = "";
  tracks.forEach((track) => {
    if (!track) return;
    const li = document.createElement("li");
    li.className = "track-item";
    li.innerHTML = `
      <img src="${track.album?.images?.[2]?.url || track.album?.images?.[0]?.url || ""}" alt="" />
      <div class="meta">
        <div class="title">${track.name}</div>
        <div class="subtitle">${track.artists.map((a) => a.name).join(", ")}</div>
      </div>
    `;
    li.addEventListener("click", () => onClick(track));
    container.appendChild(li);
  });
}

function renderPlaylists(container, playlists) {
  container.innerHTML = "";
  playlists.forEach((pl) => {
    if (!pl) return; // z.B. gelöschte/nicht mehr verfügbare Playlist-Referenzen
    const li = document.createElement("li");
    li.className = "track-item";
    li.innerHTML = `
      <img src="${pl.images?.[0]?.url || ""}" alt="" />
      <div class="meta">
        <div class="title">${pl.name}</div>
        <div class="subtitle">${pl.items?.total ?? pl.tracks?.total ?? 0} Songs</div>
      </div>
    `;
    li.addEventListener("click", async () => {
      const tracks = await getPlaylistTracks(pl.id);
      renderTrackList(
        document.getElementById("playlist-tracks"),
        tracks,
        (track) => playTrackUris([track.uri], deviceId)
      );
    });
    container.appendChild(li);
  });
}

// ---- 9. APP-INITIALISIERUNG --------------------------------------------------
async function showAppView(user) {
  document.getElementById("login-view").classList.add("hidden");
  document.getElementById("app-view").classList.remove("hidden");

  const userInfo = document.getElementById("user-info");
  userInfo.classList.remove("hidden");
  document.getElementById("user-name").textContent = user.display_name || user.id;
  if (user.images?.[0]?.url) {
    document.getElementById("user-avatar").src = user.images[0].url;
  }

  createPlayer();

  const playlists = await getUserPlaylists();
  renderPlaylists(document.getElementById("playlists"), playlists);
}

function wireUpControls() {
  document.getElementById("login-btn").addEventListener("click", redirectToSpotifyLogin);

  document.getElementById("logout-btn").addEventListener("click", () => {
    TokenStore.clear();
    window.location.href = REDIRECT_URI;
  });

  document.getElementById("search-btn").addEventListener("click", doSearch);
  document.getElementById("search-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") doSearch();
  });

  document.getElementById("play-pause-btn").addEventListener("click", () => {
    player?.togglePlay();
  });
  document.getElementById("next-btn").addEventListener("click", () => player?.nextTrack());
  document.getElementById("prev-btn").addEventListener("click", () => player?.previousTrack());
  document.getElementById("volume-slider").addEventListener("input", (e) => {
    player?.setVolume(Number(e.target.value) / 100);
  });
}

async function doSearch() {
  const query = document.getElementById("search-input").value.trim();
  if (!query) return;
  const tracks = await searchTracks(query);
  renderTrackList(document.getElementById("search-results"), tracks, (track) => {
    if (!deviceId) {
      alert("Player wird noch initialisiert, bitte kurz warten…");
      return;
    }
    playTrackUris([track.uri], deviceId);
  });
}

async function init() {
  wireUpControls();

  // Fall A: Wir kommen gerade von Spotify zurück (?code=...)
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");

  if (code) {
    await exchangeCodeForToken(code);
    // Code aus der URL entfernen, damit ein Reload nicht erneut versucht wird
    window.history.replaceState({}, document.title, REDIRECT_URI);
  }

  // Fall B: Wir haben (jetzt) einen gültigen Token -> App zeigen
  if (TokenStore.isValid() || TokenStore.refreshToken) {
    let user;
    try {
      user = await getCurrentUser();
    } catch (err) {
      // Nur bei einem echten Auth-Fehler (z.B. abgelaufener/ungültiger Token)
      // die Tokens löschen und zum Login zurückfallen.
      console.error("Auth-Fehler:", err);
      TokenStore.clear();
      return;
    }

    try {
      await showAppView(user);
    } catch (err) {
      // Fehler beim Rendern der App-Ansicht sind kein Auth-Problem -
      // Tokens bleiben gültig, nur loggen statt Login zu erzwingen.
      console.error("Fehler beim Laden der App-Ansicht:", err);
    }
    return;
  }

  // Fall C: Kein Token -> Login-Ansicht bleibt sichtbar
}

document.addEventListener("DOMContentLoaded", init);
