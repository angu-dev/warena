import { GameClient } from "./game.js";

const socket = io("http://localhost:3000");
let currentHost = null;
let playerName = null;
let playerColor = null;
let gamePlayers = [];
let aliveIds = new Set();
let scores = new Map();
let game = null;

const hudTopLeft = document.getElementById("hud-top-left");
const hudBottomLeft = document.getElementById("hud-bottom-left");

const renderBottomHud = () => {
  if (!hudBottomLeft) return;
  const items = gamePlayers.map((p) => {
    const alive = aliveIds.has(p.id);
    const win = scores.get(p.id) || 0;
    const status = alive ? "" : " (tot)";
    return `<div style="color:${p.color};">${p.name}${status} — Wins: ${win}</div>`;
  });
  hudBottomLeft.innerHTML = items.join("");
};

const flashTopLeft = (msg) => {
  if (!hudTopLeft) return;
  hudTopLeft.textContent = msg;
  setTimeout(() => {
    if (hudTopLeft.textContent === msg) hudTopLeft.textContent = "";
  }, 2000);
};

const COLORS = [
  "#e74c3c",
  "#e67e22",
  "#f1c40f",
  "#2ecc71",
  "#1abc9c",
  "#3498db",
  "#9b59b6",
  "#34495e",
  "#16a085",
  "#27ae60",
  "#2980b9",
  "#8e44ad",
  "#2c3e50",
  "#f39c12",
  "#d35400",
];

const classActive = "active";

const areas = Array.from(document.querySelectorAll(".area"));
const buttons = Array.from(document.querySelectorAll("button"));

const getTakenColors = () => {
  const listFriends = document.querySelector("#list-friends");
  return new Set(Array.from(listFriends.querySelectorAll("li")).map((li) => li.dataset.color));
};

const renderColorChoices = () => {
  const container = document.querySelector("#color-choices");
  if (!container) return;
  const taken = getTakenColors();
  container.innerHTML = "";
  COLORS.forEach((c) => {
    const btn = document.createElement("button");
    btn.style.background = c;
    btn.className = "color-choice";
    btn.title = c;
    btn.disabled = taken.has(c); // schon vergeben
    btn.addEventListener("click", () => {
      socket.emit("choose-color", c, (res) => {
        if (!res.success) {
          alert(res.error);
          return;
        }
        playerColor = c;
        renderColorChoices(); // Refresh nach erfolgreicher Wahl
      });
    });
    container.appendChild(btn);
  });
};

const setStartButtonState = () => {
  const btnRoomStart = buttons.find((b) => b.id === "btn-room-start");
  if (!btnRoomStart) return;
  const isHost = socket.id === currentHost;
  btnRoomStart.disabled = !isHost;
  btnRoomStart.textContent = isHost ? "Spielen" : "Warten auf Host";
};

const switchAreas = (openIdentifier) => {
  areas.forEach((area) => {
    area.classList.remove(classActive);
  });

  areas.find((area) => area.id === `area-${openIdentifier}`).classList.add(classActive);
};

const generateRoomCode = () => {
  if (!ensurePlayerName()) return;
  const code = document.querySelector("code");

  socket.emit("create-room", { name: playerName }, ({ roomCode, host, color }) => {
    currentHost = host;
    playerColor = color;
    code.innerText = `#${roomCode}`;
    addPlayerToList(socket.id, playerName, host, color);
    setStartButtonState();
    renderColorChoices();
  });
};

const ensurePlayerName = () => {
  if (playerName) return true;
  const name = prompt("Dein Spielername:");
  if (!name) return false;
  playerName = name.trim();
  return !!playerName;
};

const addPlayerToList = (playerId, name, hostId = currentHost, color = "#fff") => {
  const listFriends = document.querySelector("#list-friends");
  const existing = listFriends.querySelector(`[data-player-id="${playerId}"]`);
  if (existing) existing.remove();

  const li = document.createElement("li");
  li.dataset.playerId = playerId;
  li.dataset.name = name;
  li.dataset.color = color;
  li.style.color = color;
  li.textContent = `${name}${playerId === hostId ? " (host)" : ""}`;
  listFriends.appendChild(li);
};

const updateHostLabel = (hostId) => {
  currentHost = hostId;
  const listFriends = document.querySelector("#list-friends");
  listFriends.querySelectorAll("li").forEach((li) => {
    const pid = li.dataset.playerId;
    const name = li.dataset.name || pid;
    li.textContent = `${name}${pid === hostId ? " (host)" : ""}`;
  });
};

const removePlayerFromList = (playerId) => {
  const listFriends = document.querySelector("#list-friends");
  const playerItem = listFriends.querySelector(`[data-player-id="${playerId}"]`);
  if (playerItem) playerItem.remove();
};

const handleAreaHome = () => {
  const btnStart = buttons.find((button) => button.id === "btn-start");
  const btnLeave = buttons.find((button) => button.id === "btn-leave");

  btnStart.addEventListener("click", () => {
    switchAreas("choose");
  });

  btnLeave.addEventListener("click", () => {
    window.location.reload();
  });
};

const handleAreaChoose = () => {
  const btnMultiplayer = buttons.find((b) => b.id === "btn-multiplayer");
  const btnPrivate = buttons.find((b) => b.id === "btn-private");
  const btnChooseReturn = buttons.find((b) => b.id === "btn-choose-return");

  btnMultiplayer.addEventListener("click", () => {
    if (!ensurePlayerName()) return;
    socket.emit("quick-join", playerName, (res) => {
      if (!res.success) {
        alert(res.error || "Beitritt fehlgeschlagen");
        return;
      }
      currentHost = res.host;
      playerColor = res.color;
      const code = document.querySelector("code");
      code.innerText = `#${res.roomCode}`;
      const listFriends = document.querySelector("#list-friends");
      listFriends.innerHTML = "";
      res.players.forEach(({ id, name, color }) => addPlayerToList(id, name, res.host, color));
      switchAreas("create");
      setStartButtonState();
      renderColorChoices();
    });
  });

  btnPrivate.addEventListener("click", () => {
    switchAreas("private");
  });

  btnChooseReturn.addEventListener("click", () => {
    switchAreas("home");
  });
};

const handleAreaPrivate = () => {
  const btnCreate = buttons.find((button) => button.id === "btn-create");
  const btnJoin = buttons.find((button) => button.id === "btn-join");
  const btnPrivateReturn = buttons.find((button) => button.id === "btn-private-return");

  btnCreate.addEventListener("click", () => {
    switchAreas("create");

    generateRoomCode();
  });

  btnJoin.addEventListener("click", () => {
    if (!ensurePlayerName()) return;
    const roomCode = prompt("Raum-Code eingeben:");
    if (!roomCode) return;

    socket.emit("join-room", roomCode, playerName, (response) => {
      if (response.success) {
        currentHost = response.host;
        playerColor = response.color;

        const code = document.querySelector("code");
        code.innerText = `#${roomCode}`;

        const listFriends = document.querySelector("#list-friends");
        listFriends.innerHTML = "";

        response.players.forEach(({ id, name, color }) => addPlayerToList(id, name, response.host, color));
        switchAreas("create");
        setStartButtonState();
        renderColorChoices();
      } else {
        alert(response.error);
      }
    });
  });

  btnPrivateReturn.addEventListener("click", () => {
    switchAreas("choose");
  });
};

const handleAreaCreate = () => {
  const btnRoomStart = buttons.find((button) => button.id === "btn-room-start");
  const btnRoomLeave = buttons.find((button) => button.id === "btn-room-leave");

  setStartButtonState();

  btnRoomStart.addEventListener("click", () => {
    if (socket.id !== currentHost) return; // Guard Client-seitig
    socket.emit("start-game");
    switchAreas("game");
  });

  btnRoomLeave.addEventListener("click", () => {
    const listFriends = document.querySelector("#list-friends");
    listFriends.innerHTML = "";
    socket.emit("leave-room");
    switchAreas("choose");
  });
};

const handleAreaGame = () => {
  const canvas = document.querySelector("canvas");
  const transition = document.querySelector("#transition");
  const btnGameLeave = buttons.find((button) => button.id === "btn-game-leave");

  btnGameLeave.addEventListener("click", () => {
    const listFriends = document.querySelector("#list-friends");
    if (listFriends) listFriends.innerHTML = "";
    socket.emit("leave-room"); // NEU: Server informieren
    switchAreas("choose");
  });
};

socket.on("color-changed", ({ id, color }) => {
  const listFriends = document.querySelector("#list-friends");
  const li = listFriends.querySelector(`[data-player-id="${id}"]`);
  if (li) {
    li.dataset.color = color;
    li.style.color = color;
    const name = li.dataset.name || id;
    li.textContent = `${name}${id === currentHost ? " (host)" : ""}`;
  }
  renderColorChoices(); // neu zeichnen, damit disabled-Status stimmt
});

socket.on("game-started", ({ seed, players, mapConfig, scores: sc, roundId }) => {
  switchAreas("game");
  gamePlayers = players;
  aliveIds = new Set(players.map((p) => p.id));
  scores = new Map(Object.entries(sc || {}));
  renderBottomHud();

  const canvas = document.querySelector("canvas");
  if (game) game.destroy();

  game = new GameClient({
    canvas,
    socket,
    playerId: socket.id,
    players,
    mapConfig,
  });

  game.startRound(seed, players, mapConfig, roundId); // NEU: roundId übergeben
});

socket.on("player-left-in-round", ({ id, name }) => {
  aliveIds.delete(id);
  gamePlayers = gamePlayers.filter((p) => p.id !== id);
  flashTopLeft(`${name} hat die Runde verlassen`);
  renderBottomHud();
});

socket.on("round-ended", ({ winnerId, winnerName, scores: sc }) => {
  scores = new Map(Object.entries(sc || {}));
  aliveIds = new Set([winnerId]); // Nur Gewinner ist am Leben
  flashTopLeft(`Gewonnen: ${winnerName}`);
  renderBottomHud();
});

socket.on("player-died", ({ playerId }) => {
  aliveIds.delete(playerId);
  renderBottomHud(); // Sofort aktualisieren wenn gestorben
});

socket.on("room-closed", () => {
  alert("Lobby geschlossen");
  switchAreas("choose");
  const listFriends = document.querySelector("#list-friends");
  if (listFriends) listFriends.innerHTML = "";
});

socket.on("player-joined", ({ id, name, color }) => {
  addPlayerToList(id, name, currentHost, color);
  setStartButtonState();
  renderColorChoices();
});
socket.on("player-left", (playerId) => {
  removePlayerFromList(playerId);
  setStartButtonState();
  renderColorChoices();
});
socket.on("host-changed", (newHostId) => {
  updateHostLabel(newHostId);
  setStartButtonState();
});

handleAreaHome();
handleAreaChoose();
handleAreaPrivate();
handleAreaCreate();
handleAreaGame();

// DEV-Mode
switchAreas("choose");
