// Balle Balle Runner — a 3-lane endless runner drawn on a 2D canvas with
// a simple perspective projection. Everything (character, tractors, hay bales,
// phulkari banners, fields, gurdwara) is drawn in code, no image assets.

export type GameState = "ready" | "running" | "paused" | "dying" | "over";
export type Action = "left" | "right" | "jump" | "roll";

export interface CharacterLook {
  name: string;
  turban: string;
  turbanDark: string;
  kurta: string;
  kurtaDark: string;
  pajama: string;
  skin: string;
}

export const CHARACTERS: CharacterLook[] = [
  {
    name: "Jassi",
    turban: "#ff9933",
    turbanDark: "#c9661a",
    kurta: "#1e5bd8",
    kurtaDark: "#143f99",
    pajama: "#f6f1e7",
    skin: "#c98a55",
  },
  {
    name: "Preet",
    turban: "#e8327c",
    turbanDark: "#a81d57",
    kurta: "#f4f1ea",
    kurtaDark: "#cfc8b8",
    pajama: "#2b2b38",
    skin: "#b97a48",
  },
  {
    name: "Bunty",
    turban: "#1b2a6b",
    turbanDark: "#0f1840",
    kurta: "#f2b705",
    kurtaDark: "#b98a00",
    pajama: "#f6f1e7",
    skin: "#a8693c",
  },
];

export interface EngineEvents {
  onJump: () => void;
  onCoin: () => void;
  onCrash: () => void;
  onStumble: () => void;
  onLeft: () => void;
  onRight: () => void;
  onRoll: () => void;
  /** fires every LONG_RUN_EVERY seconds the player survives */
  onLongRun: () => void;
  onHud: (score: number, coins: number) => void;
  onGameOver: (score: number, coins: number) => void;
}

type ObKind = "tractor" | "bale" | "banner";
interface Obstacle {
  kind: ObKind;
  lane: number;
  z: number; // world position of the near face
  len: number;
}
interface Coin {
  lane: number;
  z: number;
  y: number;
  taken: boolean;
}
type SceneKind = "tree" | "stack" | "pole" | "house";
interface Scene {
  kind: SceneKind;
  x: number;
  z: number;
  v: number; // variation seed
}
interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
}

const LANES = [-1.2, 0, 1.2];
const FOCAL = 4.2;
const FAR = 85;
const PLAYER_H = 1.3;
const ROLL_H = 0.55;
const GRAVITY = 26;
const JUMP_V = 8.6;
const ROLL_TIME = 0.62;
const START_SPEED = 12;
const MAX_SPEED = 30;
const ROAD_HALF = 1.95;
const LONG_RUN_EVERY = 20; // seconds
// near clip plane: just behind the runner, lands at the very bottom of the screen
const NEAR = -1.0;

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const rand = (a: number, b: number) => a + Math.random() * (b - a);

export class Engine {
  state: GameState = "ready";
  look: CharacterLook = CHARACTERS[0];

  private ctx: CanvasRenderingContext2D;
  private W = 0;
  private H = 0;
  private unit = 100;
  private horizonY = 0;
  private baseY = 0;
  private cx = 0;
  private raf = 0;
  private last = 0;
  private hudTimer = 0;

  // player
  private lane = 1;
  private prevLane = 1;
  private px = 0;
  private py = 0;
  private vy = 0;
  private rollT = 0;
  private phase = 0;
  private stumbleT = 0;
  private dyingT = 0;
  private camX = 0;
  private shake = 0;

  // world
  private dist = 0;
  private speed = START_SPEED;
  private elapsed = 0;
  private nextLongRun = LONG_RUN_EVERY;
  private score = 0;
  private coins = 0;
  private nextRow = 0;
  private nextSceneL = 0;
  private nextSceneR = 0;
  private obstacles: Obstacle[] = [];
  private coinList: Coin[] = [];
  private scenery: Scene[] = [];
  private particles: Particle[] = [];
  private clouds: { x: number; y: number; r: number; v: number }[] = [];
  private time = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    private ev: EngineEvents,
  ) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D not supported");
    this.ctx = ctx;
    for (let i = 0; i < 6; i++) {
      this.clouds.push({ x: Math.random(), y: rand(0.05, 0.22), r: rand(0.6, 1.3), v: rand(0.004, 0.012) });
    }
    this.resize();
    this.resetWorld();
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = this.canvas.getBoundingClientRect();
    this.W = Math.max(1, rect.width);
    this.H = Math.max(1, rect.height);
    this.canvas.width = Math.round(this.W * dpr);
    this.canvas.height = Math.round(this.H * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.unit = Math.min(this.W * 0.24, this.H * 0.2) / LANES[2];
    this.horizonY = this.H * 0.37;
    this.baseY = this.H * 0.84;
    this.cx = this.W / 2;
  }

  setLook(look: CharacterLook) {
    this.look = look;
  }

  private resetWorld() {
    this.lane = 1;
    this.prevLane = 1;
    this.px = 0;
    this.py = 0;
    this.vy = 0;
    this.rollT = 0;
    this.stumbleT = 0;
    this.dyingT = 0;
    this.camX = 0;
    this.shake = 0;
    this.dist = 0;
    this.speed = START_SPEED;
    this.elapsed = 0;
    this.nextLongRun = LONG_RUN_EVERY;
    this.score = 0;
    this.coins = 0;
    this.obstacles = [];
    this.coinList = [];
    this.particles = [];
    this.scenery = [];
    this.nextRow = 38;
    this.nextSceneL = 0;
    this.nextSceneR = 2;
    this.spawnScenery();
  }

  start() {
    this.resetWorld();
    this.state = "running";
    this.ev.onHud(0, 0);
  }

  togglePause() {
    if (this.state === "running") this.state = "paused";
    else if (this.state === "paused") {
      this.state = "running";
      this.last = performance.now();
    }
  }

  input(a: Action) {
    if (this.state !== "running") return;
    switch (a) {
      case "left":
        if (this.lane > 0) {
          this.prevLane = this.lane;
          this.lane--;
          this.ev.onLeft();
        }
        break;
      case "right":
        if (this.lane < 2) {
          this.prevLane = this.lane;
          this.lane++;
          this.ev.onRight();
        }
        break;
      case "jump":
        if (this.py <= 0.001) {
          this.vy = JUMP_V;
          this.rollT = 0;
          this.ev.onJump();
          this.puff(5, "#d9c49a");
        }
        break;
      case "roll":
        this.rollT = ROLL_TIME;
        this.ev.onRoll();
        if (this.py > 0) this.vy = -JUMP_V * 1.7; // slam down like the real thing
        break;
    }
  }

  // ---------------------------------------------------------------- update

  private loop(now: number) {
    const dt = Math.min(0.05, (now - (this.last || now)) / 1000);
    this.last = now;
    this.time += dt;
    if (this.state === "running") this.update(dt);
    else if (this.state === "dying") this.updateDying(dt);
    else if (this.state === "ready") {
      // idle: the world drifts slowly behind the title screen
      this.dist += dt * 4;
      this.phase += dt * 6;
      this.spawnScenery();
      this.cull();
    }
    for (const c of this.clouds) {
      c.x += c.v * dt;
      if (c.x > 1.2) c.x = -0.2;
    }
    this.render();
    this.raf = requestAnimationFrame(this.loop);
  }

  private update(dt: number) {
    this.elapsed += dt;
    if (this.elapsed >= this.nextLongRun) {
      this.nextLongRun += LONG_RUN_EVERY;
      this.ev.onLongRun();
    }
    this.speed = Math.min(MAX_SPEED, START_SPEED + this.elapsed * 0.22);
    const sp = this.stumbleT > 0 ? this.speed * 0.75 : this.speed;
    this.dist += sp * dt;
    this.score += sp * dt * 0.8;
    this.phase += dt * (8 + sp * 0.35);

    // lane movement
    const tx = LANES[this.lane];
    this.px += (tx - this.px) * Math.min(1, dt * 16);
    this.camX += (this.px * 0.55 - this.camX) * Math.min(1, dt * 6);

    // jump physics
    if (this.py > 0 || this.vy > 0) {
      this.vy -= GRAVITY * dt;
      this.py += this.vy * dt;
      if (this.py <= 0) {
        this.py = 0;
        this.vy = 0;
        this.puff(4, "#d9c49a");
      }
    }
    if (this.rollT > 0) this.rollT -= dt;
    if (this.stumbleT > 0) this.stumbleT -= dt;
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 3);

    this.spawnRows();
    this.spawnScenery();
    this.checkCollisions();
    this.updateParticles(dt);
    this.cull();

    this.hudTimer += dt;
    if (this.hudTimer > 0.08) {
      this.hudTimer = 0;
      this.ev.onHud(Math.floor(this.score), this.coins);
    }
  }

  private updateDying(dt: number) {
    this.dyingT += dt;
    this.shake = Math.max(0, this.shake - dt * 2);
    if (this.py > 0 || this.vy > 0) {
      this.vy -= GRAVITY * dt;
      this.py = Math.max(0, this.py + this.vy * dt);
    }
    this.updateParticles(dt);
    if (this.dyingT > 0.9) {
      this.state = "over";
      this.ev.onGameOver(Math.floor(this.score), this.coins);
    }
  }

  private updateParticles(dt: number) {
    for (const p of this.particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy -= 6 * dt;
      p.life -= dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
  }

  private puff(n: number, color: string) {
    for (let i = 0; i < n; i++) {
      this.particles.push({
        x: this.px + rand(-0.2, 0.2),
        y: rand(0, 0.1),
        vx: rand(-1, 1),
        vy: rand(0.5, 1.6),
        life: rand(0.25, 0.45),
        color,
      });
    }
  }

  private cull() {
    const d = this.dist;
    this.obstacles = this.obstacles.filter((o) => o.z + o.len - d > -6);
    this.coinList = this.coinList.filter((c) => c.z - d > -6 && !c.taken);
    this.scenery = this.scenery.filter((s) => s.z - d > -6);
  }

  private spawnRows() {
    while (this.nextRow < this.dist + FAR) {
      this.makeRow(this.nextRow);
      this.nextRow += 4 + this.speed * rand(0.72, 1.2);
    }
  }

  private makeRow(z: number) {
    const lanes = [0, 1, 2].sort(() => Math.random() - 0.5);
    const r = Math.random();
    const blockedCount = r < 0.1 ? 0 : r < 0.58 ? 1 : 2;
    const blocked = lanes.slice(0, blockedCount);
    const free = lanes.slice(blockedCount);

    for (const lane of blocked) {
      const k = Math.random();
      if (k < 0.42) this.obstacles.push({ kind: "tractor", lane, z, len: 3.0 });
      else if (k < 0.75) {
        this.obstacles.push({ kind: "bale", lane, z, len: 0.6 });
        if (Math.random() < 0.45) {
          // arc of coins over the bale
          for (let i = -2; i <= 2; i++) {
            const t = i / 2.6;
            this.coinList.push({ lane, z: z + 0.3 + i * 1.1, y: 0.45 + 0.95 * (1 - t * t), taken: false });
          }
        }
      } else this.obstacles.push({ kind: "banner", lane, z, len: 0.25 });
    }

    if (free.length && Math.random() < 0.75) {
      const lane = free[Math.floor(Math.random() * free.length)];
      for (let i = 0; i < 6; i++) this.coinList.push({ lane, z: z - 5 + i * 1.4, y: 0.45, taken: false });
    }
  }

  private spawnScenery() {
    const spawn = (side: -1 | 1, at: number) => {
      const k = Math.random();
      const kind: SceneKind = k < 0.5 ? "tree" : k < 0.72 ? "stack" : k < 0.88 ? "pole" : "house";
      const x = side * (kind === "pole" ? 2.6 : kind === "house" ? rand(4.5, 6.5) : rand(2.9, 5.5));
      this.scenery.push({ kind, x, z: at, v: Math.random() });
    };
    while (this.nextSceneL < this.dist + FAR) {
      spawn(-1, this.nextSceneL);
      this.nextSceneL += rand(3, 7);
    }
    while (this.nextSceneR < this.dist + FAR) {
      spawn(1, this.nextSceneR);
      this.nextSceneR += rand(3, 7);
    }
  }

  private checkCollisions() {
    const d = this.dist;
    const rolling = this.rollT > 0;
    const top = this.py + (rolling ? ROLL_H : PLAYER_H);

    for (const o of this.obstacles) {
      const near = o.z - d;
      const far = near + o.len;
      if (far < -0.35 || near > 0.35) continue;
      if (Math.abs(this.px - LANES[o.lane]) > 0.7) continue;

      let hit = false;
      if (o.kind === "tractor") hit = this.py < 1.62;
      else if (o.kind === "bale") hit = this.py < 0.55;
      else hit = top > 0.86; // banner: must roll under
      if (!hit) continue;

      if (near < -0.1 && this.stumbleT <= 0 && o.lane !== this.prevLane) {
        // scraped the side of something while changing lanes → bounce back
        this.lane = this.prevLane;
        this.stumbleT = 0.6;
        this.shake = 0.5;
        this.ev.onStumble();
        return;
      }
      if (near < -0.1 && this.stumbleT > 0) continue;
      this.crash();
      return;
    }

    for (const c of this.coinList) {
      if (c.taken) continue;
      const rel = c.z - d;
      if (Math.abs(rel) > 0.6) continue;
      if (Math.abs(this.px - LANES[c.lane]) > 0.6) continue;
      if (c.y < this.py - 0.25 || c.y > top + 0.25) continue;
      c.taken = true;
      this.coins++;
      this.ev.onCoin();
      for (let i = 0; i < 6; i++) {
        this.particles.push({
          x: LANES[c.lane] + rand(-0.15, 0.15),
          y: c.y,
          vx: rand(-1.2, 1.2),
          vy: rand(0.5, 2.5),
          life: rand(0.25, 0.5),
          color: "#ffd84d",
        });
      }
    }
  }

  private crash() {
    this.state = "dying";
    this.dyingT = 0;
    this.shake = 1;
    this.rollT = 0;
    this.ev.onCrash();
    this.ev.onHud(Math.floor(this.score), this.coins);
  }

  // ---------------------------------------------------------------- projection

  private scale(z: number) {
    return FOCAL / (FOCAL + Math.max(z, -FOCAL * 0.8));
  }

  private proj(x: number, y: number, z: number) {
    const s = this.scale(z);
    return {
      x: this.cx + (x - this.camX) * this.unit * s,
      y: this.horizonY + (this.baseY - this.horizonY) * s - y * this.unit * s,
      s,
    };
  }

  private quad(pts: { x: number; y: number }[], fill: string) {
    const c = this.ctx;
    c.beginPath();
    c.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) c.lineTo(pts[i].x, pts[i].y);
    c.closePath();
    c.fillStyle = fill;
    c.fill();
  }

  /** Axis-aligned box in world space. Returns the projected near-face rectangle. */
  private box(
    x: number,
    w: number,
    y0: number,
    h: number,
    z0: number,
    z1: number,
    front: string,
    side: string,
    top: string,
  ) {
    if (z1 <= NEAR) return null;
    z0 = Math.max(z0, NEAR);
    const xl = x - w / 2;
    const xr = x + w / 2;
    const a = this.proj(xl, y0, z0);
    const b = this.proj(xr, y0, z0);
    const c = this.proj(xr, y0 + h, z0);
    const d = this.proj(xl, y0 + h, z0);
    const e = this.proj(xl, y0, z1);
    const f = this.proj(xr, y0, z1);
    const g = this.proj(xr, y0 + h, z1);
    const k = this.proj(xl, y0 + h, z1);
    // top (camera is above every object)
    this.quad([d, c, g, k], top);
    if (xl > this.camX) this.quad([a, d, k, e], side);
    if (xr < this.camX) this.quad([b, c, g, f], side);
    this.quad([a, b, c, d], front);
    return { l: a.x, r: b.x, t: d.y, b: a.y, s: a.s };
  }

  // ---------------------------------------------------------------- render

  private render() {
    const c = this.ctx;
    c.save();
    if (this.shake > 0) {
      const m = this.shake * 8;
      c.translate(rand(-m, m), rand(-m, m));
    }
    this.drawSky();
    this.drawGround();

    type Drawable = { z: number; fn: () => void };
    const before: Drawable[] = [];
    const after: Drawable[] = [];
    const d = this.dist;
    const add = (z: number, fn: () => void) => (z > 0.05 ? before : after).push({ z, fn });

    for (const s of this.scenery) {
      const rel = s.z - d;
      if (rel < FAR && rel > NEAR + 0.3) add(rel, () => this.drawScene(s, rel));
    }
    for (const o of this.obstacles) {
      const rel = o.z - d;
      if (rel < FAR && rel + o.len > NEAR) add(rel, () => this.drawObstacle(o, rel));
    }
    for (const co of this.coinList) {
      const rel = co.z - d;
      if (!co.taken && rel < FAR && rel > NEAR) add(rel, () => this.drawCoin(co, rel));
    }
    before.sort((a, b) => b.z - a.z);
    after.sort((a, b) => b.z - a.z);
    for (const it of before) it.fn();
    this.drawParticles();
    this.drawPlayer();
    for (const it of after) it.fn();
    c.restore();
  }

  private fog(rel: number) {
    return clamp((FAR - rel) / 22, 0, 1);
  }

  private drawSky() {
    const c = this.ctx;
    const g = c.createLinearGradient(0, 0, 0, this.horizonY);
    g.addColorStop(0, "#5fb4f0");
    g.addColorStop(0.65, "#a9dcf5");
    g.addColorStop(1, "#ffe7b3");
    c.fillStyle = g;
    c.fillRect(0, 0, this.W, this.horizonY + 2);

    // sun
    const sx = this.W * 0.78 - this.camX * 10;
    const sy = this.horizonY * 0.42;
    const sg = c.createRadialGradient(sx, sy, 4, sx, sy, this.H * 0.12);
    sg.addColorStop(0, "rgba(255,250,220,1)");
    sg.addColorStop(0.3, "rgba(255,226,140,0.9)");
    sg.addColorStop(1, "rgba(255,226,140,0)");
    c.fillStyle = sg;
    c.beginPath();
    c.arc(sx, sy, this.H * 0.12, 0, Math.PI * 2);
    c.fill();

    // clouds
    c.fillStyle = "rgba(255,255,255,0.85)";
    for (const cl of this.clouds) {
      const x = cl.x * this.W * 1.2 - this.W * 0.1;
      const y = cl.y * this.H;
      const r = cl.r * this.H * 0.035;
      c.beginPath();
      c.arc(x, y, r, 0, Math.PI * 2);
      c.arc(x + r * 1.1, y - r * 0.4, r * 1.2, 0, Math.PI * 2);
      c.arc(x + r * 2.3, y, r * 0.9, 0, Math.PI * 2);
      c.fill();
    }

    // distant tree line
    const hy = this.horizonY;
    c.fillStyle = "#7fa865";
    c.beginPath();
    c.moveTo(0, hy);
    const off = -this.camX * 6;
    for (let x = -20; x <= this.W + 20; x += 18) {
      const n = Math.sin((x - off) * 0.05) * 3 + Math.sin((x - off) * 0.013) * 5;
      c.lineTo(x, hy - 8 - n - 4);
    }
    c.lineTo(this.W, hy);
    c.closePath();
    c.fill();

    this.drawGurdwara(this.W * 0.27 - this.camX * 6, hy - 4, Math.min(this.H * 0.075, this.W * 0.07));
  }

  private drawGurdwara(x: number, y: number, s: number) {
    const c = this.ctx;
    c.save();
    c.translate(x, y);
    // water tank reflection pool
    c.fillStyle = "rgba(120,170,200,0.7)";
    c.fillRect(-s * 1.6, -s * 0.05, s * 3.2, s * 0.08);
    // base
    c.fillStyle = "#f7f1e3";
    c.fillRect(-s * 0.9, -s * 0.55, s * 1.8, s * 0.55);
    c.fillStyle = "#e9b82c";
    c.fillRect(-s * 0.55, -s * 0.95, s * 1.1, s * 0.42);
    // arches
    c.fillStyle = "#c98f12";
    for (let i = -3; i <= 3; i++) {
      c.beginPath();
      c.arc(i * s * 0.24, -s * 0.18, s * 0.06, Math.PI, 0);
      c.rect(i * s * 0.24 - s * 0.06, -s * 0.18, s * 0.12, s * 0.16);
      c.fill();
    }
    // main dome
    c.fillStyle = "#f2c230";
    c.beginPath();
    c.moveTo(-s * 0.38, -s * 0.95);
    c.bezierCurveTo(-s * 0.55, -s * 1.35, -s * 0.05, -s * 1.45, 0, -s * 1.75);
    c.bezierCurveTo(s * 0.05, -s * 1.45, s * 0.55, -s * 1.35, s * 0.38, -s * 0.95);
    c.fill();
    c.fillRect(-s * 0.012, -s * 1.95, s * 0.024, s * 0.22);
    // small chhatris
    for (const dx of [-0.75, 0.75]) {
      c.fillStyle = "#f7f1e3";
      c.fillRect(s * dx - s * 0.1, -s * 0.8, s * 0.2, s * 0.25);
      c.fillStyle = "#f2c230";
      c.beginPath();
      c.arc(s * dx, -s * 0.8, s * 0.12, Math.PI, 0);
      c.fill();
    }
    // nishan sahib flag pole
    c.strokeStyle = "#9a7a3a";
    c.lineWidth = Math.max(1, s * 0.03);
    c.beginPath();
    c.moveTo(s * 1.35, 0);
    c.lineTo(s * 1.35, -s * 2.3);
    c.stroke();
    c.fillStyle = "#ff8c1a";
    c.beginPath();
    c.moveTo(s * 1.35, -s * 2.28);
    c.lineTo(s * 1.75, -s * 2.12);
    c.lineTo(s * 1.35, -s * 1.95);
    c.fill();
    c.restore();
  }

  private drawGround() {
    const c = this.ctx;
    const hy = this.horizonY;
    // mustard (sarson) fields
    c.fillStyle = "#e7c21c";
    c.fillRect(0, hy, this.W, this.H - hy);

    const period = 6;
    const off = this.dist % period;
    for (let k = 0; k < FAR / period + 2; k++) {
      const z0 = k * period - off - 3;
      const z1 = z0 + period / 2;
      const y0 = this.proj(0, 0, z1).y;
      const y1 = this.proj(0, 0, Math.max(z0, -FOCAL * 0.7)).y;
      c.fillStyle = "#cfa914";
      c.fillRect(0, y0, this.W, Math.max(0, y1 - y0));
    }
    // green crop rows converging to the horizon
    c.strokeStyle = "rgba(70,130,40,0.45)";
    c.lineWidth = 2;
    for (let i = 1; i < 26; i++) {
      for (const side of [-1, 1]) {
        const x = side * (ROAD_HALF + 0.4 + i * 0.7);
        const a = this.proj(x, 0, -FOCAL * 0.6);
        const b = this.proj(x, 0, FAR);
        c.beginPath();
        c.moveTo(a.x, a.y);
        c.lineTo(b.x, b.y);
        c.stroke();
      }
    }

    const zn = -FOCAL * 0.6;
    // dirt shoulders
    for (const side of [-1, 1]) {
      const x0 = side * ROAD_HALF;
      const x1 = side * (ROAD_HALF + 0.45);
      this.quad([this.proj(x0, 0, zn), this.proj(x1, 0, zn), this.proj(x1, 0, FAR), this.proj(x0, 0, FAR)], "#b98c55");
    }
    // road
    this.quad(
      [
        this.proj(-ROAD_HALF, 0, zn),
        this.proj(ROAD_HALF, 0, zn),
        this.proj(ROAD_HALF, 0, FAR),
        this.proj(-ROAD_HALF, 0, FAR),
      ],
      "#6d6a66",
    );
    // speed bands on the road
    const rp = 4;
    const roff = this.dist % rp;
    for (let k = 0; k < FAR / rp + 2; k++) {
      const z0 = Math.max(k * rp - roff - 2, zn);
      const z1 = k * rp - roff;
      if (z1 <= z0) continue;
      this.quad(
        [
          this.proj(-ROAD_HALF, 0, z0),
          this.proj(ROAD_HALF, 0, z0),
          this.proj(ROAD_HALF, 0, z1),
          this.proj(-ROAD_HALF, 0, z1),
        ],
        "#64615d",
      );
    }
    // lane dashes
    for (const lx of [-0.6, 0.6]) {
      for (let k = 0; k < FAR / rp + 2; k++) {
        const z0 = k * rp - roff - 1;
        const z1 = z0 + 1.6;
        if (z1 < zn) continue;
        const a = Math.max(z0, zn);
        this.quad(
          [
            this.proj(lx - 0.04, 0, a),
            this.proj(lx + 0.04, 0, a),
            this.proj(lx + 0.04, 0, z1),
            this.proj(lx - 0.04, 0, z1),
          ],
          "#f3efe2",
        );
      }
    }
    // white road edge lines
    for (const side of [-1, 1]) {
      const x0 = side * (ROAD_HALF - 0.08);
      const x1 = side * (ROAD_HALF - 0.02);
      this.quad([this.proj(x0, 0, zn), this.proj(x1, 0, zn), this.proj(x1, 0, FAR), this.proj(x0, 0, FAR)], "#f3efe2");
    }
    // haze at the horizon
    const hg = c.createLinearGradient(0, hy, 0, hy + this.H * 0.08);
    hg.addColorStop(0, "rgba(255,236,190,0.85)");
    hg.addColorStop(1, "rgba(255,236,190,0)");
    c.fillStyle = hg;
    c.fillRect(0, hy, this.W, this.H * 0.08);
  }

  private drawScene(s: Scene, rel: number) {
    const c = this.ctx;
    c.save();
    c.globalAlpha = this.fog(rel);
    const p = this.proj(s.x, 0, rel);
    const u = this.unit * p.s;
    if (s.kind === "tree") {
      const h = 1.8 + s.v * 0.8;
      c.fillStyle = "#6b4a2b";
      c.fillRect(p.x - 0.08 * u, p.y - h * u, 0.16 * u, h * u);
      const cy = p.y - h * u;
      c.fillStyle = "#2f7a32";
      c.beginPath();
      c.arc(p.x, cy, 0.75 * u, 0, Math.PI * 2);
      c.arc(p.x - 0.6 * u, cy + 0.25 * u, 0.55 * u, 0, Math.PI * 2);
      c.arc(p.x + 0.6 * u, cy + 0.2 * u, 0.55 * u, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = "#47a046";
      c.beginPath();
      c.arc(p.x - 0.2 * u, cy - 0.25 * u, 0.4 * u, 0, Math.PI * 2);
      c.fill();
    } else if (s.kind === "stack") {
      // conical straw stack (toori da kup)
      const h = 1.5 + s.v * 0.5;
      c.fillStyle = "#d8a93a";
      c.beginPath();
      c.moveTo(p.x - 0.75 * u, p.y);
      c.quadraticCurveTo(p.x - 0.7 * u, p.y - h * 0.8 * u, p.x, p.y - h * u);
      c.quadraticCurveTo(p.x + 0.7 * u, p.y - h * 0.8 * u, p.x + 0.75 * u, p.y);
      c.closePath();
      c.fill();
      c.strokeStyle = "#a67b1f";
      c.lineWidth = Math.max(1, 0.04 * u);
      for (let i = 1; i < 4; i++) {
        const yy = p.y - (h * u * i) / 4.5;
        c.beginPath();
        c.moveTo(p.x - 0.7 * u * (1 - i / 5), yy);
        c.lineTo(p.x + 0.7 * u * (1 - i / 5), yy);
        c.stroke();
      }
      c.fillStyle = "#8f5f22";
      c.fillRect(p.x - 0.06 * u, p.y - (h + 0.15) * u, 0.12 * u, 0.2 * u);
    } else if (s.kind === "pole") {
      c.fillStyle = "#8d8d8d";
      c.fillRect(p.x - 0.05 * u, p.y - 3.2 * u, 0.1 * u, 3.2 * u);
      c.fillRect(p.x - 0.5 * u, p.y - 3.0 * u, 1.0 * u, 0.07 * u);
      c.fillStyle = "#555";
      for (const dx of [-0.42, 0, 0.42]) c.fillRect(p.x + (dx - 0.03) * u, p.y - 3.1 * u, 0.06 * u, 0.1 * u);
    } else {
      // village house with flat roof
      const w = 2.0;
      const h = 1.6;
      c.fillStyle = s.v > 0.5 ? "#e8d3b0" : "#d9b28c";
      c.fillRect(p.x - (w / 2) * u, p.y - h * u, w * u, h * u);
      c.fillStyle = "#b5835a";
      c.fillRect(p.x - (w / 2 + 0.08) * u, p.y - (h + 0.12) * u, (w + 0.16) * u, 0.14 * u);
      c.fillStyle = "#3d6fa5";
      c.fillRect(p.x - 0.25 * u, p.y - 1.0 * u, 0.5 * u, 1.0 * u);
      c.fillStyle = "#5a3a22";
      c.fillRect(p.x - 0.8 * u, p.y - 1.1 * u, 0.35 * u, 0.35 * u);
      c.fillRect(p.x + 0.45 * u, p.y - 1.1 * u, 0.35 * u, 0.35 * u);
    }
    c.restore();
  }

  private drawObstacle(o: Obstacle, rel: number) {
    const c = this.ctx;
    c.save();
    c.globalAlpha = this.fog(rel);
    const lx = LANES[o.lane];
    // shadow
    const z0 = Math.max(rel - 0.08, NEAR);
    const z1 = rel + o.len + 0.15;
    this.quad(
      [
        this.proj(lx - 0.55, 0, z0),
        this.proj(lx + 0.55, 0, z0),
        this.proj(lx + 0.6, 0, z1),
        this.proj(lx - 0.5, 0, z1),
      ],
      "rgba(0,0,0,0.18)",
    );

    if (o.kind === "tractor") this.drawTractor(lx, rel);
    else if (o.kind === "bale") this.drawBale(lx, rel);
    else this.drawBanner(lx, rel);
    c.restore();
  }

  private drawTractor(lx: number, z: number) {
    const c = this.ctx;
    // front wheels (far end)
    this.box(lx - 0.34, 0.14, 0, 0.5, z + 2.35, z + 2.85, "#2a2a2a", "#1c1c1c", "#3a3a3a");
    this.box(lx + 0.34, 0.14, 0, 0.5, z + 2.35, z + 2.85, "#2a2a2a", "#1c1c1c", "#3a3a3a");
    // exhaust
    this.box(lx + 0.16, 0.06, 0.85, 0.75, z + 2.5, z + 2.56, "#3b3b3b", "#2b2b2b", "#555");
    // hood/body
    this.box(lx, 0.56, 0.32, 0.6, z + 1.0, z + 3.0, "#d32f2f", "#9d1f1f", "#ef5350");
    const body = this.box(lx, 0.62, 0.3, 0.55, z + 0.15, z + 1.0, "#c62828", "#8e1b1b", "#e53935");
    // tail lights + number plate on rear face
    if (body) {
      const bw = body.r - body.l;
      const bh = body.b - body.t;
      c.fillStyle = "#ffcf3d";
      c.fillRect(body.l + bw * 0.08, body.t + bh * 0.15, bw * 0.16, bh * 0.2);
      c.fillRect(body.r - bw * 0.24, body.t + bh * 0.15, bw * 0.16, bh * 0.2);
      c.fillStyle = "#fff4d6";
      c.fillRect(body.l + bw * 0.3, body.t + bh * 0.5, bw * 0.4, bh * 0.25);
      c.fillStyle = "#222";
      c.font = `bold ${Math.max(6, bh * 0.18)}px system-ui, sans-serif`;
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillText("PB 10", (body.l + body.r) / 2, body.t + bh * 0.63);
    }
    // seat
    this.box(lx, 0.3, 0.85, 0.32, z + 0.45, z + 0.6, "#222", "#111", "#333");
    // big rear wheels
    for (const dx of [-0.42, 0.42]) {
      const w = this.box(lx + dx, 0.22, 0, 1.0, z + 0.1, z + 1.05, "#262626", "#1a1a1a", "#3a3a3a");
      if (!w) continue;
      const ww = w.r - w.l;
      const wh = w.b - w.t;
      c.fillStyle = "#3d3d3d";
      for (let i = 1; i < 7; i++) c.fillRect(w.l, w.t + (wh * i) / 7, ww, Math.max(1, wh * 0.04));
      c.fillStyle = "#f2b705";
      c.fillRect(w.l + ww * (dx < 0 ? 0.65 : 0.05), w.t + wh * 0.38, ww * 0.3, wh * 0.24);
    }
    // canopy posts + roof
    for (const dx of [-0.42, 0.42]) {
      this.box(lx + dx, 0.04, 1.0, 0.6, z + 1.25, z + 1.29, "#555", "#444", "#666");
      this.box(lx + dx, 0.04, 1.0, 0.6, z + 0.12, z + 0.16, "#555", "#444", "#666");
    }
    const roof = this.box(lx, 1.0, 1.58, 0.07, z + 0.05, z + 1.4, "#f2b705", "#c99400", "#ffd23f");
    if (!roof) return;
    c.fillStyle = "#1e8b4d";
    c.fillRect(roof.l, roof.t, roof.r - roof.l, Math.max(1, (roof.b - roof.t) * 0.5));
  }

  private drawBale(lx: number, z: number) {
    const c = this.ctx;
    const f = this.box(lx, 0.92, 0, 0.55, z, z + 0.6, "#e2b84a", "#c4972c", "#f2d06e");
    if (!f) return;
    const w = f.r - f.l;
    const h = f.b - f.t;
    c.strokeStyle = "rgba(140,95,20,0.55)";
    c.lineWidth = Math.max(1, h * 0.03);
    for (let i = 0; i < 9; i++) {
      const x = f.l + w * ((i * 0.37) % 1);
      const y = f.t + h * ((i * 0.53) % 1);
      c.beginPath();
      c.moveTo(x, y);
      c.lineTo(x + w * 0.08, y + h * 0.05);
      c.stroke();
    }
    c.fillStyle = "#7a4b16";
    c.fillRect(f.l + w * 0.27, f.t, Math.max(1, w * 0.03), h);
    c.fillRect(f.l + w * 0.7, f.t, Math.max(1, w * 0.03), h);
  }

  private drawBanner(lx: number, z: number) {
    const c = this.ctx;
    // bamboo posts
    for (const dx of [-0.54, 0.54]) this.box(lx + dx, 0.07, 0, 1.45, z, z + 0.07, "#9c7a3c", "#7a5c28", "#b8954f");
    // phulkari cloth
    const f = this.box(lx, 1.04, 0.86, 0.5, z + 0.01, z + 0.05, "#c2185b", "#8e1243", "#d81b60");
    if (!f) return;
    const w = f.r - f.l;
    const h = f.b - f.t;
    const n = 6;
    const colors = ["#ffcc00", "#ff7a00", "#ffffff"];
    for (let i = 0; i < n; i++) {
      const cxp = f.l + (w * (i + 0.5)) / n;
      const cyp = f.t + h / 2;
      const r = Math.min(w / n, h) * 0.42;
      c.fillStyle = colors[i % 3];
      c.beginPath();
      c.moveTo(cxp, cyp - r);
      c.lineTo(cxp + r * 0.7, cyp);
      c.lineTo(cxp, cyp + r);
      c.lineTo(cxp - r * 0.7, cyp);
      c.closePath();
      c.fill();
      c.fillStyle = "#c2185b";
      c.beginPath();
      c.arc(cxp, cyp, r * 0.22, 0, Math.PI * 2);
      c.fill();
    }
    c.fillStyle = "#ffcc00";
    c.fillRect(f.l, f.t, w, Math.max(1, h * 0.07));
    c.fillRect(f.l, f.b - h * 0.07, w, Math.max(1, h * 0.07));
  }

  private drawCoin(co: Coin, rel: number) {
    const c = this.ctx;
    const p = this.proj(LANES[co.lane], co.y, rel);
    const r = 0.17 * this.unit * p.s;
    const spin = Math.abs(Math.cos(this.time * 5 + co.z));
    c.save();
    c.globalAlpha = this.fog(rel);
    c.translate(p.x, p.y);
    c.scale(Math.max(0.15, spin), 1);
    c.fillStyle = "#b8860b";
    c.beginPath();
    c.arc(0, 0, r, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = "#ffd84d";
    c.beginPath();
    c.arc(0, 0, r * 0.8, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = "#e0a800";
    c.font = `bold ${r * 1.1}px system-ui, sans-serif`;
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText("₹", 0, r * 0.05);
    c.restore();
  }

  private drawParticles() {
    const c = this.ctx;
    for (const p of this.particles) {
      const q = this.proj(p.x, p.y, 0);
      c.globalAlpha = clamp(p.life * 2.5, 0, 1);
      c.fillStyle = p.color;
      c.beginPath();
      c.arc(q.x, q.y, 0.035 * this.unit, 0, Math.PI * 2);
      c.fill();
    }
    c.globalAlpha = 1;
  }

  // ---------------------------------------------------------------- character

  private drawPlayer() {
    const c = this.ctx;
    const L = this.look;
    const u = this.unit;
    const ground = this.proj(this.px, 0, 0);
    const feet = this.proj(this.px, this.py, 0);

    // shadow
    const sh = 1 / (1 + this.py * 0.8);
    c.fillStyle = `rgba(0,0,0,${0.28 * sh})`;
    c.beginPath();
    c.ellipse(ground.x, ground.y, 0.3 * u * sh, 0.08 * u * sh, 0, 0, Math.PI * 2);
    c.fill();

    c.save();
    c.translate(feet.x, feet.y);
    c.scale(u, u);
    c.lineCap = "round";
    c.lineJoin = "round";

    const dying = this.state === "dying" || this.state === "over";
    const rolling = this.rollT > 0 && !dying;
    const airborne = this.py > 0.02;
    const running = this.state === "running" && !airborne && !rolling;
    const sw = Math.sin(this.phase);
    const bob = running ? Math.abs(Math.cos(this.phase)) * 0.04 : 0;

    // lean into lane changes
    const lean = clamp((LANES[this.lane] - this.px) * 0.25, -0.2, 0.2);
    c.rotate(lean);

    if (dying) {
      c.rotate(Math.min(1, this.dyingT * 3) * 0.5);
      if (Math.floor(this.time * 12) % 2 === 0) c.globalAlpha = 0.65;
    }
    if (rolling) {
      c.translate(0, -0.05);
      c.scale(1.08, 0.5);
    }

    c.translate(0, -bob);

    // legs
    let liftL = running ? Math.max(0, sw) * 0.2 : 0;
    let liftR = running ? Math.max(0, -sw) * 0.2 : 0;
    if (airborne) {
      liftL = 0.18;
      liftR = 0.1;
    }
    const leg = (x: number, lift: number) => {
      c.strokeStyle = L.pajama;
      c.lineWidth = 0.14;
      c.beginPath();
      c.moveTo(x, -0.55);
      c.lineTo(x * 1.15, -0.06 - lift);
      c.stroke();
      // jutti (embroidered shoe)
      c.fillStyle = "#7a1f1f";
      c.beginPath();
      c.ellipse(x * 1.15, -0.03 - lift, 0.075, 0.045 + lift * 0.15, 0, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = "#f2c94c";
      c.fillRect(x * 1.15 - 0.05, -0.05 - lift, 0.1, 0.018);
    };
    leg(-0.09, liftL);
    leg(0.09, liftR);

    // arms (behind the kurta at the shoulders, so draw first)
    const arm = (side: number, swing: number) => {
      const sx = side * 0.2;
      const sy = -0.93;
      const ex = side * 0.29;
      const ey = airborne ? -1.05 : -0.74 + swing * 0.05;
      const hx = side * (airborne ? 0.36 : 0.3);
      const hy = airborne ? -1.22 : -0.58 + swing * 0.1;
      c.strokeStyle = L.kurtaDark;
      c.lineWidth = 0.12;
      c.beginPath();
      c.moveTo(sx, sy);
      c.lineTo(ex, ey);
      c.stroke();
      c.strokeStyle = L.skin;
      c.lineWidth = 0.075;
      c.beginPath();
      c.moveTo(ex, ey);
      c.lineTo(hx, hy);
      c.stroke();
      c.fillStyle = L.skin;
      c.beginPath();
      c.arc(hx, hy, 0.045, 0, Math.PI * 2);
      c.fill();
      if (side > 0) {
        // steel kara on the right wrist
        c.strokeStyle = "#c9ccd1";
        c.lineWidth = 0.022;
        c.beginPath();
        c.moveTo(hx - 0.04 * side, hy + (ey - hy) * 0.25);
        c.lineTo(hx + 0.04 * side, hy + (ey - hy) * 0.25);
        c.stroke();
      }
    };
    arm(-1, running ? sw : 0);
    arm(1, running ? -sw : 0);

    // kurta
    c.fillStyle = L.kurta;
    c.beginPath();
    c.moveTo(-0.2, -0.98);
    c.quadraticCurveTo(0, -1.02, 0.2, -0.98);
    c.lineTo(0.25, -0.42);
    c.quadraticCurveTo(0, -0.38 + bob * 0.5, -0.25, -0.42);
    c.closePath();
    c.fill();
    // side slits + back seam + fold shading
    c.strokeStyle = L.kurtaDark;
    c.lineWidth = 0.018;
    c.beginPath();
    c.moveTo(-0.235, -0.42);
    c.lineTo(-0.225, -0.55);
    c.moveTo(0.235, -0.42);
    c.lineTo(0.225, -0.55);
    c.moveTo(0, -0.98);
    c.lineTo(0, -0.62);
    c.stroke();
    c.fillStyle = "rgba(0,0,0,0.08)";
    c.beginPath();
    c.moveTo(0.05, -0.98);
    c.lineTo(0.2, -0.98);
    c.lineTo(0.25, -0.42);
    c.lineTo(0.08, -0.4);
    c.closePath();
    c.fill();

    // neck
    c.fillStyle = L.skin;
    c.fillRect(-0.055, -1.04, 0.11, 0.08);

    // head
    c.beginPath();
    c.arc(0, -1.11, 0.115, 0, Math.PI * 2);
    c.fill();
    // ears
    c.beginPath();
    c.ellipse(-0.118, -1.1, 0.025, 0.04, 0, 0, Math.PI * 2);
    c.ellipse(0.118, -1.1, 0.025, 0.04, 0, 0, Math.PI * 2);
    c.fill();
    // beard peeking past the jaw
    c.fillStyle = "#1d1714";
    c.beginPath();
    c.ellipse(-0.1, -1.03, 0.05, 0.06, 0.3, 0, Math.PI * 2);
    c.ellipse(0.1, -1.03, 0.05, 0.06, -0.3, 0, Math.PI * 2);
    c.fill();

    // pagg (turban) — Patiala-shahi style folds from behind
    c.fillStyle = L.turban;
    c.beginPath();
    c.moveTo(-0.14, -1.06);
    c.quadraticCurveTo(-0.19, -1.18, -0.165, -1.26);
    c.quadraticCurveTo(-0.12, -1.36, 0, -1.39);
    c.quadraticCurveTo(0.12, -1.36, 0.165, -1.26);
    c.quadraticCurveTo(0.19, -1.18, 0.14, -1.06);
    c.quadraticCurveTo(0, -1.1, -0.14, -1.06);
    c.closePath();
    c.fill();
    c.strokeStyle = L.turbanDark;
    c.lineWidth = 0.018;
    for (let i = 0; i < 4; i++) {
      const y = -1.1 - i * 0.065;
      c.beginPath();
      c.moveTo(-0.16 + i * 0.01, y + 0.02);
      c.quadraticCurveTo(0, y - 0.05, 0.16 - i * 0.015, y - 0.045);
      c.stroke();
    }
    // the turla tip on top
    c.fillStyle = L.turbanDark;
    c.beginPath();
    c.ellipse(0.02, -1.385, 0.04, 0.02, -0.2, 0, Math.PI * 2);
    c.fill();

    c.restore();
  }
}
