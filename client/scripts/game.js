// Simple deterministic RNG (Mulberry32)
function createRng(seed) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return function () {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

// Flood-fill check ob alle Spawns erreichbar sind
function isReachable(grid, width, height, spawns) {
  if (spawns.length === 0) return true;
  const visited = new Set();
  const start = spawns[0];
  const queue = [[Math.floor(start.x / 16), Math.floor(start.y / 16)]];

  while (queue.length) {
    const [x, y] = queue.shift();
    const key = `${x},${y}`;
    if (visited.has(key)) continue;
    if (x < 0 || y < 0 || x >= width || y >= height) continue;
    if (grid[y][x] === 1) continue; // Wand
    visited.add(key);
    queue.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }

  // Check ob alle Spawn-Positionen erreichbar
  return spawns.every((s) => {
    const tx = Math.floor(s.x / 16);
    const ty = Math.floor(s.y / 16);
    return visited.has(`${tx},${ty}`);
  });
}

export function generateMap(seed, playerCount) {
  const rng = createRng(seed);
  const size = Math.max(20, playerCount * 8); // Größer bei mehr Spielern
  const tileSize = 16;
  const width = size;
  const height = size;

  // Grid initialisieren (0 = leer, 1 = Wand)
  let grid = Array(height)
    .fill(0)
    .map(() => Array(width).fill(0));

  // Außenwände setzen
  for (let x = 0; x < width; x++) {
    grid[0][x] = 1;
    grid[height - 1][x] = 1;
  }
  for (let y = 0; y < height; y++) {
    grid[y][0] = 1;
    grid[y][width - 1] = 1;
  }

  // Spawn-Positionen gleichmäßig verteilen
  const spawns = [];
  const centerX = (width * tileSize) / 2;
  const centerY = (height * tileSize) / 2;
  const radius = (Math.min(width, height) * tileSize) / 3;

  for (let i = 0; i < playerCount; i++) {
    const angle = (i / playerCount) * Math.PI * 2;
    const x = centerX + Math.cos(angle) * radius;
    const y = centerY + Math.sin(angle) * radius;
    spawns.push({ x, y });
  }

  // Zufällige Wände platzieren (max 100 Versuche)
  let attempts = 0;
  const maxWalls = Math.floor(width * height * 0.1); // 10% Wände
  let wallsPlaced = 0;

  while (wallsPlaced < maxWalls && attempts < 500) {
    attempts++;
    const x = Math.floor(rng() * (width - 2)) + 1;
    const y = Math.floor(rng() * (height - 2)) + 1;

    // Nicht auf Spawn-Positionen
    const isSpawn = spawns.some((s) => {
      const sx = Math.floor(s.x / tileSize);
      const sy = Math.floor(s.y / tileSize);
      return Math.abs(sx - x) <= 1 && Math.abs(sy - y) <= 1;
    });

    if (isSpawn || grid[y][x] === 1) continue;

    // Temporär setzen und testen
    grid[y][x] = 1;
    if (isReachable(grid, width, height, spawns)) {
      wallsPlaced++;
    } else {
      grid[y][x] = 0; // Rückgängig
    }
  }

  return { grid, width, height, tileSize, spawns };
}

export class GameClient {
  constructor({ canvas, socket, playerId, players, mapConfig }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.socket = socket;
    this.playerId = playerId;
    this.scale = 3;

    this.keys = {};
    this.mouse = { x: 0, y: 0 };
    this.lastShot = 0;
    this.shootCooldown = 300;

    this.setupCanvas();
    this.setupInput();

    this.players = new Map();
    this.bullets = new Map();
    this.countdown = 3;
    this.gameStarted = false;
    this.animationId = null;
    this.roundId = null;

    this.cachedPlayerRender = new Map();
    this.visibleTiles = [];
  }

  setupCanvas() {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = window.innerWidth * dpr;
    this.canvas.height = window.innerHeight * dpr;
    this.canvas.style.width = `${window.innerWidth}px`;
    this.canvas.style.height = `${window.innerHeight}px`;
    this.ctx.scale(dpr, dpr);
    this.canvas.style.imageRendering = "pixelated";

    window.addEventListener("resize", () => {
      const dpr = window.devicePixelRatio || 1;
      this.canvas.width = window.innerWidth * dpr;
      this.canvas.height = window.innerHeight * dpr;
      this.canvas.style.width = `${window.innerWidth}px`;
      this.canvas.style.height = `${window.innerHeight}px`;
      this.ctx.scale(dpr, dpr);
    });
  }

  setupInput() {
    window.addEventListener("keydown", (e) => {
      this.keys[e.key.toLowerCase()] = true;
      if (e.key === " ") {
        e.preventDefault();
        this.shoot();
      }
    });

    window.addEventListener("keyup", (e) => {
      this.keys[e.key.toLowerCase()] = false;
    });

    this.canvas.addEventListener("mousemove", (e) => {
      const rect = this.canvas.getBoundingClientRect();
      this.mouse.x = e.clientX - rect.left;
      this.mouse.y = e.clientY - rect.top;
    });
  }

  setupSocketListeners() {
    this.socket.off("player-move");
    this.socket.off("player-aim");
    this.socket.off("bullet-fired");
    this.socket.off("player-hit");
    this.socket.off("player-died");
    this.socket.off("bullet-destroyed");
    this.socket.off("player-left-in-round");

    this.socket.on("player-move", (data) => {
      const player = this.players.get(data.id);
      if (player) {
        // NEU: Interpolation setup
        player.targetX = data.x;
        player.targetY = data.y;
        player.moveStartTime = Date.now();
        player.moveDuration = 50; // ms (muss mit Server-Throttle übereinstimmen)
      }
    });

    this.socket.on("player-aim", (data) => {
      const player = this.players.get(data.id);
      if (player) {
        player.aimX = data.aimX;
        player.aimY = data.aimY;
      }
    });

    this.socket.on("bullet-fired", (data) => {
      if (data.roundId !== this.roundId) return;
      this.bullets.set(data.id, {
        id: data.id,
        x: data.x,
        y: data.y,
        vx: data.vx,
        vy: data.vy,
        color: data.color,
        ownerId: data.ownerId,
        radius: 2,
        spawnTime: Date.now(),
      });
    });

    this.socket.on("player-hit", ({ playerId, hits }) => {
      const player = this.players.get(playerId);
      if (player) player.hits = hits;
    });

    this.socket.on("player-died", ({ playerId }) => {
      const player = this.players.get(playerId);
      if (player) player.alive = false;
    });

    this.socket.on("bullet-destroyed", ({ bulletId }) => {
      this.bullets.delete(bulletId);
    });

    this.socket.on("player-left-in-round", ({ id }) => {
      this.players.delete(id);
    });
  }

  startRound(seed, players, mapConfig, roundId) {
    this.socket.off("player-move");
    this.socket.off("player-aim");
    this.socket.off("bullet-fired");
    this.socket.off("player-hit");
    this.socket.off("player-died");
    this.socket.off("bullet-destroyed");
    this.socket.off("player-left-in-round");

    this.roundId = roundId || `${Date.now()}-${Math.random()}`;

    this.map = generateMap(seed, players.length);
    this.players.clear();
    this.bullets.clear();
    this.cachedPlayerRender.clear();
    this.countdown = 3;
    this.gameStarted = false;
    this.lastShot = 0;
    this.lastMove = 0;
    this.lastAim = 0;

    players.forEach((p, i) => {
      const spawn = this.map.spawns[i] || { x: 100, y: 100 };
      this.players.set(p.id, {
        id: p.id,
        name: p.name,
        color: p.color,
        x: spawn.x,
        y: spawn.y,
        targetX: spawn.x, // NEU
        targetY: spawn.y, // NEU
        moveStartTime: 0, // NEU
        moveDuration: 50, // NEU
        width: 8,
        height: 8,
        speed: 2,
        hits: 0,
        alive: true,
        aimX: 0,
        aimY: 0,
      });
    });

    this.setupSocketListeners();

    const countdownInterval = setInterval(() => {
      this.countdown--;
      if (this.countdown <= 0) {
        clearInterval(countdownInterval);
        this.gameStarted = true;
      }
    }, 1000);

    if (this.animationId) cancelAnimationFrame(this.animationId);
    this.lastTime = performance.now();
    this.loop();
  }

  shoot() {
    if (!this.gameStarted) return;
    const now = Date.now();
    if (now - this.lastShot < this.shootCooldown) return;

    const player = this.players.get(this.playerId);
    if (!player || !player.alive) return;

    this.lastShot = now;

    const centerX = window.innerWidth / 2;
    const centerY = window.innerHeight / 2;

    const dx = this.mouse.x - centerX;
    const dy = this.mouse.y - centerY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist === 0) return;

    const vx = (dx / dist) * 5;
    const vy = (dy / dist) * 5;

    this.socket.emit("shoot", {
      x: player.x + player.width / 2,
      y: player.y + player.height / 2,
      vx,
      vy,
      color: player.color,
      roundId: this.roundId,
    });
  }

  update(dt) {
    if (!this.gameStarted) return;

    const player = this.players.get(this.playerId);
    if (!player) return;

    // NEU: Andere Spieler interpolieren
    const now = Date.now();
    for (const [pid, p] of this.players) {
      if (pid === this.playerId) continue; // Nur andere Spieler

      if (p.moveStartTime && p.targetX !== undefined && p.targetY !== undefined) {
        const elapsed = now - p.moveStartTime;
        const progress = Math.min(elapsed / p.moveDuration, 1); // 0-1

        // Lineare Interpolation
        p.x = p.x + (p.targetX - p.x) * progress;
        p.y = p.y + (p.targetY - p.y) * progress;

        // Bewegung beendet
        if (progress >= 1) {
          p.x = p.targetX;
          p.y = p.targetY;
          p.moveStartTime = 0;
        }
      }
    }

    let dx = 0;
    let dy = 0;
    if (this.keys["w"]) dy -= player.speed;
    if (this.keys["s"]) dy += player.speed;
    if (this.keys["a"]) dx -= player.speed;
    if (this.keys["d"]) dx += player.speed;

    if (player.alive) {
      const newX = player.x + dx;
      const newY = player.y + dy;

      if (!this.checkCollision(newX, player.y, player.width, player.height)) {
        player.x = newX;
      }
      if (!this.checkCollision(player.x, newY, player.width, player.height)) {
        player.y = newY;
      }

      if (now - this.lastMove > 50) {
        this.socket.emit("move", { x: player.x, y: player.y });
        this.lastMove = now;
      }

      const centerX = window.innerWidth / 2;
      const centerY = window.innerHeight / 2;
      const aimDx = this.mouse.x - centerX;
      const aimDy = this.mouse.y - centerY;
      const aimDist = Math.sqrt(aimDx * aimDx + aimDy * aimDy);

      if (aimDist > 0 && now - this.lastAim > 100) {
        const aimX = aimDx / aimDist;
        const aimY = aimDy / aimDist;
        player.aimX = aimX;
        player.aimY = aimY;
        this.socket.emit("aim", { aimX, aimY });
        this.lastAim = now;
      }
    } else {
      const newX = player.x + dx;
      const newY = player.y + dy;

      const mapWidth = this.map.width * this.map.tileSize;
      const mapHeight = this.map.height * this.map.tileSize;

      if (newX >= 0 && newX <= mapWidth - 1) {
        player.x = newX;
      }
      if (newY >= 0 && newY <= mapHeight - 1) {
        player.y = newY;
      }
    }

    const bulletsToDelete = [];
    for (const [bulletId, b] of this.bullets) {
      b.x += b.vx;
      b.y += b.vy;

      const tileX = Math.floor(b.x / this.map.tileSize);
      const tileY = Math.floor(b.y / this.map.tileSize);

      if (tileX < 0 || tileY < 0 || tileX >= this.map.width || tileY >= this.map.height || this.map.grid[tileY]?.[tileX] === 1) {
        this.socket.emit("bullet-hit-wall", { bulletId, roundId: this.roundId });
        bulletsToDelete.push(bulletId);
        continue;
      }

      let hit = false;
      for (const [pid, p] of this.players) {
        if (!p.alive || pid === b.ownerId) continue;

        const pcx = p.x + p.width / 2;
        const pcy = p.y + p.height / 2;
        const dx = b.x - pcx;
        const dy = b.y - pcy;
        const distSq = dx * dx + dy * dy;
        const hitRadiusSq = Math.pow((p.width + p.height) / 2 + b.radius, 2);

        if (distSq < hitRadiusSq) {
          this.socket.emit("bullet-hit-player", {
            bulletId,
            playerId: pid,
            roundId: this.roundId,
          });
          bulletsToDelete.push(bulletId);
          hit = true;
          break;
        }
      }
      if (hit) continue;

      if (Date.now() - b.spawnTime > 5000) {
        bulletsToDelete.push(bulletId);
      }
    }

    bulletsToDelete.forEach((id) => this.bullets.delete(id));
  }

  checkCollision(x, y, w, h) {
    const tileSize = this.map.tileSize;
    const left = Math.floor(x / tileSize);
    const right = Math.floor((x + w - 1) / tileSize);
    const top = Math.floor(y / tileSize);
    const bottom = Math.floor((y + h - 1) / tileSize);

    for (let ty = top; ty <= bottom; ty++) {
      for (let tx = left; tx <= right; tx++) {
        if (ty < 0 || ty >= this.map.height || tx < 0 || tx >= this.map.width) return true;
        if (this.map.grid[ty]?.[tx] === 1) return true;
      }
    }
    return false;
  }

  render() {
    const ctx = this.ctx;
    const scale = this.scale;

    ctx.fillStyle = "#111";
    ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);

    const player = this.players.get(this.playerId);
    if (!player) return;

    const offsetX = window.innerWidth / 2 - player.x * scale;
    const offsetY = window.innerHeight / 2 - player.y * scale;

    ctx.save();
    ctx.translate(offsetX, offsetY);
    ctx.scale(scale, scale);

    const tileSize = this.map.tileSize;
    const startTileX = Math.max(0, Math.floor(-offsetX / scale / tileSize));
    const startTileY = Math.max(0, Math.floor(-offsetY / scale / tileSize));
    const endTileX = Math.min(this.map.width, Math.ceil((window.innerWidth - offsetX) / scale / tileSize));
    const endTileY = Math.min(this.map.height, Math.ceil((window.innerHeight - offsetY) / scale / tileSize));

    for (let y = startTileY; y < endTileY; y++) {
      for (let x = startTileX; x < endTileX; x++) {
        if (this.map.grid[y]?.[x] === 1) {
          ctx.fillStyle = "#555";
          ctx.fillRect(x * tileSize, y * tileSize, tileSize, tileSize);
        }
      }
    }

    this.players.forEach((p) => {
      if (!p.alive) return;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x, p.y, p.width, p.height);

      if (p.aimX !== undefined && p.aimY !== undefined) {
        const wl = 6;
        const ww = 2;
        const wx = p.x + p.width / 2 + p.aimX * (wl / 2);
        const wy = p.y + p.height / 2 + p.aimY * (wl / 2);

        ctx.save();
        ctx.translate(wx, wy);
        ctx.rotate(Math.atan2(p.aimY, p.aimX));
        ctx.fillStyle = p.color;
        ctx.fillRect(-wl / 2, -ww / 2, wl, ww);
        ctx.restore();
      }
    });

    for (const b of this.bullets.values()) {
      ctx.fillStyle = b.color;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();

    if (!player.alive) {
      ctx.fillStyle = "#aaa";
      ctx.font = "bold 36px Arial";
      ctx.textAlign = "center";
      ctx.fillText("ZUSCHAUER", window.innerWidth / 2, 60);
    }

    if (!this.gameStarted && this.countdown > 0) {
      ctx.fillStyle = "#fff";
      ctx.font = "bold 72px Arial";
      ctx.textAlign = "center";
      ctx.fillText(this.countdown, window.innerWidth / 2, window.innerHeight / 2);
    } else if (!this.gameStarted && this.countdown === 0) {
      ctx.fillStyle = "#0f0";
      ctx.font = "bold 72px Arial";
      ctx.textAlign = "center";
      ctx.fillText("LOS!", window.innerWidth / 2, window.innerHeight / 2);
    }
  }

  loop() {
    const now = performance.now();
    const dt = (now - this.lastTime) / 16.67;
    this.lastTime = now;

    this.update(dt);
    this.render();

    this.animationId = requestAnimationFrame(() => this.loop());
  }

  destroy() {
    if (this.animationId) cancelAnimationFrame(this.animationId);
    this.socket.off("player-move");
    this.socket.off("player-aim");
    this.socket.off("bullet-fired");
    this.socket.off("player-hit");
    this.socket.off("player-died");
    this.socket.off("bullet-destroyed");
    this.socket.off("player-left-in-round");
  }
}
