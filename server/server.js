const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "http://127.0.0.1:5500", // Deine Live Server URL
    methods: ["GET", "POST"],
  },
});

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

const getFreeColor = (room) => {
  const used = new Set(room.playersColors?.values() || []);
  return COLORS.find((c) => !used.has(c));
};

const getScoresObject = (room) => Object.fromEntries(room.scores || []);

const isNameTaken = (room, name) => Array.from(room.players.values()).some((n) => n.toLowerCase() === name.toLowerCase());

const rooms = new Map(); // Speichert Räume und Spieler
let openRoom = null;

const getPlayersArray = (room) => Array.from(room.players.entries()).map(([id, name]) => ({ id, name }));

io.on("connection", (socket) => {
  socket.on("create-room", ({ name }, callback) => {
    const roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    const color = COLORS[0];
    rooms.set(roomCode, {
      players: new Map([[socket.id, name]]),
      playersColors: new Map([[socket.id, color]]),
      scores: new Map([[socket.id, 0]]),
      host: socket.id,
      inRound: false,
      alive: new Set(),
      closeTimeout: null,
    });
    socket.join(roomCode);
    socket.roomCode = roomCode;
    callback({ roomCode, host: socket.id, color });
  });

  socket.on("join-room", (roomCode, name, callback) => {
    const room = rooms.get(roomCode);
    if (!room) return callback({ success: false, error: "Raum nicht gefunden" });
    if (room.players.size >= 8) return callback({ success: false, error: "Raum ist voll (max. 8 Spieler)" });
    if (room.inRound) return callback({ success: false, error: "Runde läuft bereits" }); // NEU

    const cleanName = (name || "").trim();
    if (!cleanName) return callback({ success: false, error: "Name ungültig" });
    if (isNameTaken(room, cleanName)) return callback({ success: false, error: "Name bereits vergeben" });

    const color = getFreeColor(room);
    if (!color) return callback({ success: false, error: "Keine Farben frei" });

    room.players.set(socket.id, cleanName);
    room.playersColors.set(socket.id, color);
    if (!room.scores) room.scores = new Map();
    if (!room.scores.has(socket.id)) room.scores.set(socket.id, 0);
    socket.join(roomCode);
    socket.roomCode = roomCode;

    socket.to(roomCode).emit("player-joined", { id: socket.id, name: cleanName, color });

    callback({
      success: true,
      players: getPlayersArray(room).map((p) => ({ ...p, color: room.playersColors.get(p.id) })),
      host: room.host,
      color,
    });
  });

  socket.on("quick-join", (name, callback) => {
    const cleanName = (name || "").trim();
    if (!cleanName) return callback({ success: false, error: "Name ungültig" });

    if (openRoom) {
      const room = rooms.get(openRoom);
      if (room && room.players.size < 8 && !room.inRound) {
        // NEU: !room.inRound
        if (isNameTaken(room, cleanName)) return callback({ success: false, error: "Name bereits vergeben" });
        if (!room.playersColors) room.playersColors = new Map();
        const color = getFreeColor(room);
        if (!color) return callback({ success: false, error: "Keine Farben frei" });

        room.players.set(socket.id, cleanName);
        room.playersColors.set(socket.id, color);
        if (!room.scores) room.scores = new Map();
        room.scores.set(socket.id, 0);
        socket.join(openRoom);
        socket.roomCode = openRoom;

        socket.to(openRoom).emit("player-joined", { id: socket.id, name: cleanName, color });
        callback({
          success: true,
          roomCode: openRoom,
          players: getPlayersArray(room).map((p) => ({ ...p, color: room.playersColors.get(p.id) })),
          host: room.host,
          color,
        });

        if (room.players.size >= 8) openRoom = null;
        return;
      }
      openRoom = null;
    }

    // Neue Lobby
    const roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    const color = COLORS[0];
    rooms.set(roomCode, {
      players: new Map([[socket.id, cleanName]]),
      playersColors: new Map([[socket.id, color]]),
      scores: new Map([[socket.id, 0]]),
      host: socket.id,
      inRound: false,
      alive: new Set(),
      closeTimeout: null,
    });
    socket.join(roomCode);
    socket.roomCode = roomCode;
    openRoom = roomCode;
    callback({
      success: true,
      roomCode,
      players: getPlayersArray(rooms.get(roomCode)).map((p) => ({ ...p, color: color })),
      host: socket.id,
      color,
    });
  });

  socket.on("choose-color", (color, callback) => {
    const room = rooms.get(socket.roomCode);
    if (!room) return;
    // block if taken
    for (const c of room.playersColors.values()) if (c === color) return callback({ success: false, error: "Farbe belegt" });
    room.playersColors.set(socket.id, color);
    io.to(socket.roomCode).emit("color-changed", { id: socket.id, color });
    callback({ success: true });
  });

  socket.on("start-game", () => {
    const roomCode = socket.roomCode;
    if (!roomCode) return;
    const room = rooms.get(roomCode);
    if (!room || room.host !== socket.id) return;

    const seed = Math.random().toString(36).slice(2, 10);
    const newRoundId = `${Date.now()}-${Math.random()}`; // NEU: Sofort generieren
    room.roundId = newRoundId; // NEU: Speichern

    const players = getPlayersArray(room).map(({ id, name }) => ({
      id,
      name,
      color: room.playersColors.get(id),
    }));

    room.inRound = true;
    room.alive = new Set(players.map((p) => p.id));

    const mapConfig = { seed, tileSize: 16, playerSize: 8, maxPlayers: 8 };

    io.to(roomCode).emit("game-started", {
      seed,
      players,
      mapConfig,
      scores: getScoresObject(room),
      roundId: newRoundId, // NEU: Senden
    });
  });

  const handleLeaveDuringRound = (roomCode, room, socketId) => {
    if (!room || !room.inRound || !room.alive) return;

    const wasAlive = room.alive.has(socketId);
    if (!wasAlive) return; // war gar nicht am Leben

    room.alive.delete(socketId);
    const name = room.players.get(socketId);

    io.to(roomCode).emit("player-left-in-round", { id: socketId, name });

    if (room.alive.size <= 1) {
      room.inRound = false;
      if (room.closeTimeout) clearTimeout(room.closeTimeout);
      room.closeTimeout = setTimeout(() => {
        io.to(roomCode).emit("room-closed");
        rooms.delete(roomCode);
        if (openRoom === roomCode) openRoom = null;
      }, 3000);
    }
  };

  socket.on("leave-room", () => {
    if (!socket.roomCode) return;
    const roomCode = socket.roomCode;
    const room = rooms.get(roomCode);
    if (!room) return;

    const wasInRound = room.inRound && room.alive && room.alive.has(socket.id);

    handleLeaveDuringRound(roomCode, room, socket.id);

    room.players.delete(socket.id);
    room.playersColors.delete(socket.id);
    room.scores?.delete(socket.id);

    if (room.players.size === 0) {
      rooms.delete(roomCode);
      if (openRoom === roomCode) openRoom = null;
    } else if (socket.id === room.host) {
      room.host = room.players.keys().next().value;
      io.to(roomCode).emit("host-changed", room.host);
    }

    if (!wasInRound) {
      io.to(roomCode).emit("player-left", socket.id);
    }

    socket.leave(roomCode);
    socket.roomCode = null;
  });

  socket.on("disconnect", () => {
    if (!socket.roomCode) return;
    const roomCode = socket.roomCode;
    const room = rooms.get(roomCode);
    if (!room) return;

    const wasInRound = room.inRound && room.alive && room.alive.has(socket.id);

    handleLeaveDuringRound(roomCode, room, socket.id);

    room.players.delete(socket.id);
    room.playersColors.delete(socket.id);
    room.scores?.delete(socket.id);

    if (room.players.size === 0) {
      rooms.delete(roomCode);
      if (openRoom === roomCode) openRoom = null;
    } else if (socket.id === room.host) {
      room.host = room.players.keys().next().value;
      io.to(roomCode).emit("host-changed", room.host);
    }

    if (!wasInRound) {
      io.to(roomCode).emit("player-left", socket.id);
    }

    socket.roomCode = null;
  });

  socket.on("move", (data) => {
    const room = rooms.get(socket.roomCode);
    if (!room || !room.inRound) return;

    // NEU: Throttle stärker (nur an andere senden, nicht broadcast)
    const now = Date.now();
    if (!socket.lastMoveTime) socket.lastMoveTime = 0;
    if (now - socket.lastMoveTime < 50) return; // 100ms throttle
    socket.lastMoveTime = now;

    socket.to(socket.roomCode).emit("player-move", {
      id: socket.id,
      x: data.x,
      y: data.y,
    });
  });

  socket.on("aim", (data) => {
    const room = rooms.get(socket.roomCode);
    if (!room || !room.inRound) return;

    // NEU: Throttle für Aim
    const now = Date.now();
    if (!socket.lastAimTime) socket.lastAimTime = 0;
    if (now - socket.lastAimTime < 150) return; // 150ms throttle
    socket.lastAimTime = now;

    socket.to(socket.roomCode).emit("player-aim", {
      id: socket.id,
      aimX: data.aimX,
      aimY: data.aimY,
    });
  });

  socket.on("shoot", (data) => {
    const room = rooms.get(socket.roomCode);
    if (!room || !room.inRound) return;

    const bulletId = `${socket.id}-${Date.now()}-${Math.random()}`;
    const bullet = {
      id: bulletId,
      x: data.x,
      y: data.y,
      vx: data.vx,
      vy: data.vy,
      color: data.color,
      ownerId: socket.id,
      roundId: data.roundId,
    };

    io.to(socket.roomCode).emit("bullet-fired", bullet);
  });

  socket.on("bullet-hit-player", ({ bulletId, playerId, roundId }) => {
    const room = rooms.get(socket.roomCode);
    if (!room || !room.inRound) return;
    if (!room.roundId || room.roundId !== roundId) {
      console.log(`[DEBUG] Treffer aus falscher Runde ignoriert: ${roundId} !== ${room.roundId}`);
      return;
    }

    io.to(socket.roomCode).emit("bullet-destroyed", { bulletId });

    const playerSockets = Array.from(io.sockets.sockets.values()).filter((s) => s.roomCode === socket.roomCode);
    const targetSocket = playerSockets.find((s) => s.id === playerId);
    if (!targetSocket) return;

    if (!targetSocket.bulletLog) targetSocket.bulletLog = new Set();
    if (targetSocket.bulletLog.has(bulletId)) {
      console.log(`[DEBUG] Doppel-Treffer ignoriert: ${bulletId}`);
      return;
    }
    targetSocket.bulletLog.add(bulletId);

    if (!targetSocket.hits) targetSocket.hits = 0;
    targetSocket.hits++;

    console.log(`[DEBUG] ${playerId} hit count: ${targetSocket.hits}/5`);

    io.to(socket.roomCode).emit("player-hit", {
      playerId,
      hits: targetSocket.hits,
    });

    if (targetSocket.hits >= 5) {
      console.log(`[DEBUG] ${playerId} is dead (5 hits)`);
      room.alive.delete(playerId);
      io.to(socket.roomCode).emit("player-died", { playerId });

      if (room.alive.size === 1) {
        const winnerId = [...room.alive][0];
        const winnerName = room.players.get(winnerId);
        room.scores.set(winnerId, (room.scores.get(winnerId) || 0) + 1);
        room.inRound = false;

        io.to(socket.roomCode).emit("round-ended", {
          winnerId,
          winnerName,
          scores: getScoresObject(room),
        });

        setTimeout(() => {
          if (room.players.size < 2) return;

          playerSockets.forEach((s) => {
            s.hits = 0;
            s.bulletLog = new Set();
          });

          const seed = Math.random().toString(36).slice(2, 10);
          const newRoundId = `${Date.now()}-${Math.random()}`; // NEU
          room.roundId = newRoundId; // NEU
          const players = getPlayersArray(room).map(({ id, name }) => ({
            id,
            name,
            color: room.playersColors.get(id),
          }));
          room.inRound = true;
          room.alive = new Set(players.map((p) => p.id));

          io.to(socket.roomCode).emit("game-started", {
            seed,
            players,
            mapConfig: { seed, tileSize: 16, playerSize: 8, maxPlayers: 8 },
            scores: getScoresObject(room),
            roundId: newRoundId, // NEU
          });
        }, 5000);
      }
    }
  });

  socket.on("bullet-hit-wall", ({ bulletId, roundId }) => {
    const room = rooms.get(socket.roomCode);
    if (!room || !room.roundId || room.roundId !== roundId) {
      return;
    }
    io.to(socket.roomCode).emit("bullet-destroyed", { bulletId });
  });
});

server.listen(3000, () => console.log("Server läuft auf Port 3000"));
