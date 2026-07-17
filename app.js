/* =========================================================================
   Meine Musik App – Spotify Integration (PWA)
   Auth: Authorization Code Flow mit PKCE (kein Client Secret nötig)
   Playback: Spotify Web Playback SDK (benötigt Spotify Premium)
   ========================================================================= */

// ---- 1. KONFIGURATION -----------------------------------------------------
const CLIENT_ID = "3ed25a0a5f6e4b6084dc1347644c823b";

const REDIRECT_URI = window.location.origin + window.location.pathname;

const SCOPES = [
  "streaming",
  "user-read-email",
  "user-read-private",
  "user-read-playback-state",
  "user-modify-playback-state",
  "user-read-recently-played",
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
  return crypto.subtle.digest("SHA-256", encoder.encode(plain));
}

function base64UrlEncode(arrayBuffer) {
  return btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

async function generateCodeChallenge(codeVerifier) {
  return base64UrlEncode(await sha256(codeVerifier));
}

// ---- 3. TOKEN SPEICHER ------------------------------------------------------
// localStorage statt sessionStorage: Login bleibt auch nach dem Schließen und
// Neu-Öffnen der (installierten) PWA erhalten.
const TokenStore = {
  get accessToken() {
    return localStorage.getItem("sp_access_token");
  },
  get refreshToken() {
    return localStorage.getItem("sp_refresh_token");
  },
  get expiresAt() {
    return Number(localStorage.getItem("sp_expires_at") || 0);
  },
  save({ access_token, refresh_token, expires_in }) {
    localStorage.setItem("sp_access_token", access_token);
    if (refresh_token) localStorage.setItem("sp_refresh_token", refresh_token);
    localStorage.setItem("sp_expires_at", String(Date.now() + expires_in * 1000));
  },
  clear() {
    localStorage.removeItem("sp_access_token");
    localStorage.removeItem("sp_refresh_token");
    localStorage.removeItem("sp_expires_at");
  },
  isValid() {
    return !!this.accessToken && Date.now() < this.expiresAt - 5000;
  },
};

// ---- 4. LOGIN STARTEN -------------------------------------------------------
async function redirectToSpotifyLogin() {
  const codeVerifier = generateRandomString(64);
  localStorage.setItem("sp_code_verifier", codeVerifier);
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

// ---- 5. TOKEN AUSTAUSCH / REFRESH -------------------------------------------
async function exchangeCodeForToken(code) {
  const codeVerifier = localStorage.getItem("sp_code_verifier");
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
  if (!res.ok) throw new Error("Token-Austausch fehlgeschlagen: " + (await res.text()));
  TokenStore.save(await res.json());
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
  TokenStore.save(await res.json());
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
  // Seit Februar 2026 liegt der max. "limit" für Development-Mode-Apps bei 10.
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
  // GET /playlists/{id}/tracks wurde entfernt, ersetzt durch .../items
  const data = await spotifyFetch(`/playlists/${playlistId}/items?limit=50`);
  return data.items.map((i) => i.item ?? i.track).filter(Boolean);
}

async function getRecentlyPlayed() {
  const data = await spotifyFetch("/me/player/recently-played?limit=10");
  const seen = new Set();
  const tracks = [];
  for (const item of data.items) {
    if (!item.track || seen.has(item.track.id)) continue;
    seen.add(item.track.id);
    tracks.push(item.track);
  }
  return tracks;
}

async function playTrackUris(uris, deviceId) {
  await spotifyFetch(`/me/player/play?device_id=${deviceId}`, {
    method: "PUT",
    body: JSON.stringify({ uris }),
  });
}

async function playContext(contextUri, deviceId, offsetUri) {
  const body = { context_uri: contextUri };
  if (offsetUri) body.offset = { uri: offsetUri };
  await spotifyFetch(`/me/player/play?device_id=${deviceId}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

async function setShuffle(state, deviceId) {
  await spotifyFetch(`/me/player/shuffle?state=${state}&device_id=${deviceId}`, {
    method: "PUT",
  });
}

async function setRepeat(state, deviceId) {
  await spotifyFetch(`/me/player/repeat?state=${state}&device_id=${deviceId}`, {
    method: "PUT",
  });
}

// ---- 7. WEB PLAYBACK SDK ----------------------------------------------------
let player = null;
let deviceId = null;
let currentPlaylistUri = null;
let shuffleOn = false;
let repeatOn = false;
let latestState = null;
let progressTimer = null;

window.onSpotifyWebPlaybackSDKReady = () => {};

function createPlayer() {
  player = new Spotify.Player({
    name: "Meine Musik App",
    getOAuthToken: (cb) => getValidToken().then(cb),
    volume: 0.8,
  });

  player.addListener("ready", ({ device_id }) => {
    deviceId = device_id;
  });
  player.addListener("not_ready", () => {});
  player.addListener("player_state_changed", (state) => {
    if (!state) return;
    latestState = state;
    updatePlayerUI(state);
  });
  player.addListener("initialization_error", ({ message }) => console.error(message));
  player.addListener("authentication_error", ({ message }) => console.error(message));
  player.addListener("account_error", ({ message }) =>
    console.error("Account-Fehler (Premium erforderlich?):", message)
  );

  player.connect();
  wireUpMediaSessionActions();

  progressTimer = setInterval(() => {
    if (!latestState || latestState.paused) return;
    latestState.position += 500;
    renderProgress(latestState.position, latestState.duration);
  }, 500);
}

function formatTime(ms) {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = String(totalSec % 60).padStart(2, "0");
  return `${min}:${sec}`;
}

function renderProgress(position, duration) {
  const pct = duration ? Math.min(100, (position / duration) * 100) : 0;
  document.getElementById("progress-fill").style.width = pct + "%";
  document.getElementById("time-current").textContent = formatTime(position);
  document.getElementById("time-total").textContent = formatTime(duration);
}

function updatePlayerUI(state) {
  const track = state.track_window.current_track;
  const coverUrl = track.album.images?.[0]?.url || "";
  const isPaused = state.paused;

  document.getElementById("mini-player").classList.remove("hidden");
  document.getElementById("mini-cover").src = coverUrl;
  document.getElementById("mini-title").textContent = track.name;
  document.getElementById("mini-artist").textContent = track.artists.map((a) => a.name).join(", ");
  document.getElementById("mini-play-icon").setAttribute("href", isPaused ? "#i-play" : "#i-pause");

  document.getElementById("player-cover").src = coverUrl;
  document.getElementById("player-title").textContent = track.name;
  document.getElementById("player-artist").textContent = track.artists.map((a) => a.name).join(", ");
  document.getElementById("play-pause-icon").setAttribute("href", isPaused ? "#i-play" : "#i-pause");

  renderProgress(state.position, state.duration);
  updateMediaSession(track, state, isPaused);
}

// ---- 7b. MEDIA SESSION (Sperrbildschirm / Control Center) --------------------
function updateMediaSession(track, state, isPaused) {
  if (!("mediaSession" in navigator)) return;

  navigator.mediaSession.metadata = new MediaMetadata({
    title: track.name,
    artist: track.artists.map((a) => a.name).join(", "),
    album: track.album.name,
    artwork: (track.album.images || []).map((img) => ({
      src: img.url,
      sizes: img.width && img.height ? `${img.width}x${img.height}` : "512x512",
      type: "image/jpeg",
    })),
  });

  navigator.mediaSession.playbackState = isPaused ? "paused" : "playing";

  if (state.duration) {
    try {
      navigator.mediaSession.setPositionState({
        duration: state.duration / 1000,
        playbackRate: 1,
        position: Math.min(state.position / 1000, state.duration / 1000),
      });
    } catch (e) {
      // manche Browser unterstützen setPositionState nicht vollständig
    }
  }
}

// Browser-Autoplay-Policies blockieren Audio, das nicht direkt innerhalb
// einer Nutzer-Geste gestartet wurde. Da unser eigentlicher Play-Befehl über
// die Web API läuft (also nach einem await passiert), muss das interne
// Audio-Element des SDK synchron beim Klick "freigeschaltet" werden.
function unlockPlaybackAudio() {
  if (player && typeof player.activateElement === "function") {
    player.activateElement();
  }
}

function wireUpMediaSessionActions() {
  if (!("mediaSession" in navigator)) return;
  navigator.mediaSession.setActionHandler("play", () => player?.resume());
  navigator.mediaSession.setActionHandler("pause", () => player?.pause());
  navigator.mediaSession.setActionHandler("previoustrack", () => player?.previousTrack());
  navigator.mediaSession.setActionHandler("nexttrack", () => player?.nextTrack());
  navigator.mediaSession.setActionHandler("seekto", (details) => {
    if (details.seekTime != null) player?.seek(details.seekTime * 1000);
  });
}

// ---- 8. UI RENDERING --------------------------------------------------------
function coverUrlFor(item) {
  return item.images?.[0]?.url || item.album?.images?.[0]?.url || "";
}

function renderRowList(container, items, { onClick, subtitleFor }) {
  container.innerHTML = "";
  if (!items.length) {
    container.innerHTML = `<div class="row-empty">Nichts gefunden.</div>`;
    return;
  }
  items.forEach((item) => {
    if (!item) return;
    const btn = document.createElement("button");
    btn.className = "row-item";
    btn.innerHTML = `
      <img class="cover cover-sm" src="${coverUrlFor(item)}" alt="" />
      <div class="row-meta">
        <div class="row-title">${item.name}</div>
        <div class="row-sub">${subtitleFor(item)}</div>
      </div>
      <svg class="icon row-chevron" width="14" height="14"><use href="#i-chevron-right"/></svg>
    `;
    btn.addEventListener("click", () => {
      unlockPlaybackAudio();
      onClick(item);
    });
    container.appendChild(btn);
  });
}

function renderTrackRows(container, tracks, onClick) {
  container.innerHTML = "";
  tracks.forEach((track, i) => {
    if (!track) return;
    const row = document.createElement("div");
    row.className = "track-row";
    row.innerHTML = `
      <span class="track-index">${i + 1}</span>
      <div class="row-meta">
        <div class="row-title">${track.name}</div>
        <div class="row-sub">${track.artists.map((a) => a.name).join(", ")}</div>
      </div>
    `;
    row.addEventListener("click", () => {
      unlockPlaybackAudio();
      onClick(track);
    });
    container.appendChild(row);
  });
}

// ---- 9. NAVIGATION -----------------------------------------------------------
function switchTab(tab) {
  document.querySelectorAll("#screens > .screen").forEach((el) => el.classList.add("hidden"));
  document.getElementById(`${tab}-screen`).classList.remove("hidden");
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === tab);
  });
}

function openPlaylistDetail() {
  document.querySelectorAll("#screens > .screen").forEach((el) => el.classList.add("hidden"));
  document.getElementById("playlist-screen").classList.remove("hidden");
}

function closePlaylistDetail() {
  switchTab("library");
}

function openPlayerOverlay() {
  document.getElementById("player-overlay").classList.remove("hidden");
}
function closePlayerOverlay() {
  document.getElementById("player-overlay").classList.add("hidden");
}

// ---- 9b. SWIPE-GESTEN (wie in Spotify) ----------------------------------------
function addSwipeHandlers(el, { onSwipeLeft, onSwipeRight, onSwipeDown } = {}) {
  let startX = 0;
  let startY = 0;
  let tracking = false;

  el.addEventListener(
    "touchstart",
    (e) => {
      if (e.touches.length !== 1) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      tracking = true;
    },
    { passive: true }
  );

  el.addEventListener(
    "touchend",
    (e) => {
      if (!tracking) return;
      tracking = false;
      const touch = e.changedTouches[0];
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      const absX = Math.abs(dx);
      const absY = Math.abs(dy);
      const THRESHOLD = 50;

      if (absY > absX && dy > THRESHOLD && onSwipeDown) {
        onSwipeDown();
      } else if (absX > absY && absX > THRESHOLD) {
        if (dx < 0 && onSwipeLeft) onSwipeLeft();
        else if (dx > 0 && onSwipeRight) onSwipeRight();
      }
    },
    { passive: true }
  );
}

function wireUpSwipeGestures() {
  const skipNext = () => {
    unlockPlaybackAudio();
    player?.nextTrack();
  };
  const skipPrev = () => {
    unlockPlaybackAudio();
    player?.previousTrack();
  };

  addSwipeHandlers(document.getElementById("mini-player"), {
    onSwipeLeft: skipNext,
    onSwipeRight: skipPrev,
  });

  addSwipeHandlers(document.querySelector(".player-cover-wrap"), {
    onSwipeLeft: skipNext,
    onSwipeRight: skipPrev,
  });

  addSwipeHandlers(document.getElementById("player-overlay"), {
    onSwipeDown: closePlayerOverlay,
  });
}

// ---- 10. APP-INITIALISIERUNG --------------------------------------------------
async function ensureDevice() {
  let tries = 0;
  while (!deviceId && tries < 20) {
    await new Promise((r) => setTimeout(r, 250));
    tries++;
  }
  return deviceId;
}

async function playTrack(track) {
  const id = await ensureDevice();
  if (!id) return;
  playTrackUris([track.uri], id);
}

async function playPlaylist(playlist, offsetTrackUri) {
  const id = await ensureDevice();
  if (!id) return;
  currentPlaylistUri = playlist.uri;
  playContext(playlist.uri, id, offsetTrackUri);
}

async function showAppView(user) {
  document.getElementById("login-view").classList.add("hidden");
  document.getElementById("app-shell").classList.remove("hidden");

  document.getElementById("user-name").textContent = user.display_name || user.id;
  const avatarUrl = user.images?.[0]?.url;
  if (avatarUrl) document.getElementById("user-avatar").src = avatarUrl;

  const hour = new Date().getHours();
  document.getElementById("greeting").textContent =
    hour < 11 ? "Guten Morgen" : hour < 18 ? "Guten Tag" : "Guten Abend";

  createPlayer();

  try {
    const recent = await getRecentlyPlayed();
    renderRowList(document.getElementById("recent-tracks"), recent, {
      subtitleFor: (t) => t.artists.map((a) => a.name).join(", "),
      onClick: (track) => playTrack(track),
    });
  } catch (err) {
    console.error("Zuletzt gehört konnte nicht geladen werden:", err);
  }

  try {
    const playlists = await getUserPlaylists();
    renderRowList(document.getElementById("library-playlists"), playlists, {
      subtitleFor: (p) => `${p.items?.total ?? p.tracks?.total ?? 0} Songs`,
      onClick: async (playlist) => {
        document.getElementById("playlist-cover").src = coverUrlFor(playlist);
        document.getElementById("playlist-title").textContent = playlist.name;
        document.getElementById("playlist-sub").textContent = `${
          playlist.items?.total ?? playlist.tracks?.total ?? 0
        } Songs`;
        openPlaylistDetail();

        document.getElementById("playlist-tracks").innerHTML = "";
        const tracks = await getPlaylistTracks(playlist.id);
        renderTrackRows(document.getElementById("playlist-tracks"), tracks, (track) =>
          playPlaylist(playlist, track.uri)
        );

        document.getElementById("playlist-play-btn").onclick = () => {
          unlockPlaybackAudio();
          playPlaylist(playlist);
        };
      },
    });
  } catch (err) {
    console.error("Playlists konnten nicht geladen werden:", err);
  }
}

function wireUpControls() {
  document.getElementById("login-btn").addEventListener("click", redirectToSpotifyLogin);

  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });

  document.getElementById("playlist-back").addEventListener("click", closePlaylistDetail);

  document.getElementById("mini-player").addEventListener("click", openPlayerOverlay);
  document.getElementById("player-close").addEventListener("click", closePlayerOverlay);

  document.getElementById("mini-play-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    unlockPlaybackAudio();
    player?.togglePlay();
  });
  document.getElementById("play-pause-btn").addEventListener("click", () => {
    unlockPlaybackAudio();
    player?.togglePlay();
  });
  document.getElementById("next-btn").addEventListener("click", () => {
    unlockPlaybackAudio();
    player?.nextTrack();
  });
  document.getElementById("prev-btn").addEventListener("click", () => {
    unlockPlaybackAudio();
    player?.previousTrack();
  });

  document.getElementById("shuffle-btn").addEventListener("click", async () => {
    shuffleOn = !shuffleOn;
    document.getElementById("shuffle-btn").classList.toggle("muted", !shuffleOn);
    if (deviceId) setShuffle(shuffleOn, deviceId).catch(() => {});
  });
  document.getElementById("repeat-btn").addEventListener("click", async () => {
    repeatOn = !repeatOn;
    document.getElementById("repeat-btn").classList.toggle("muted", !repeatOn);
    if (deviceId) setRepeat(repeatOn ? "context" : "off", deviceId).catch(() => {});
  });

  document.getElementById("search-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") doSearch();
  });
  document.getElementById("search-input").addEventListener("input", () => {
    clearTimeout(window.__searchDebounce);
    window.__searchDebounce = setTimeout(doSearch, 400);
  });
}

async function doSearch() {
  const query = document.getElementById("search-input").value.trim();
  const label = document.getElementById("search-label");
  const container = document.getElementById("search-results");
  if (!query) {
    container.innerHTML = "";
    label.textContent = "";
    return;
  }
  label.textContent = "Ergebnisse";
  try {
    const tracks = await searchTracks(query);
    renderRowList(container, tracks, {
      subtitleFor: (t) => t.artists.map((a) => a.name).join(", "),
      onClick: (track) => playTrack(track),
    });
  } catch (err) {
    console.error(err);
  }
}

async function init() {
  wireUpControls();
  wireUpSwipeGestures();

  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");

  if (code) {
    await exchangeCodeForToken(code);
    window.history.replaceState({}, document.title, REDIRECT_URI);
  }

  if (TokenStore.isValid() || TokenStore.refreshToken) {
    let user;
    try {
      user = await getCurrentUser();
    } catch (err) {
      console.error("Auth-Fehler:", err);
      TokenStore.clear();
      return;
    }
    try {
      await showAppView(user);
    } catch (err) {
      console.error("Fehler beim Laden der App-Ansicht:", err);
    }
  }
}

document.addEventListener("DOMContentLoaded", init);

// ---- 11. PWA / SERVICE WORKER -------------------------------------------------
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").then((registration) => {
      // Regelmäßig auf ein neues Service-Worker-Update prüfen.
      setInterval(() => registration.update(), 60 * 1000);

      function promptUpdate(worker) {
        const toast = document.getElementById("update-toast");
        toast.classList.remove("hidden");
        document.getElementById("update-reload-btn").onclick = () => {
          worker.postMessage({ type: "SKIP_WAITING" });
        };
      }

      if (registration.waiting) promptUpdate(registration.waiting);

      registration.addEventListener("updatefound", () => {
        const newWorker = registration.installing;
        newWorker.addEventListener("statechange", () => {
          if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
            promptUpdate(newWorker);
          }
        });
      });
    });

    // Sobald der neue Service Worker aktiv ist, Seite neu laden.
    let refreshing = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });
  });
}
