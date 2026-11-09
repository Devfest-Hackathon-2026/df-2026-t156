import { readFileSync, existsSync } from '../../../runtime/node-shim.js';
import { fileURLToPath } from '../../../runtime/node-shim.js';
import { rockShape, rockRay, rockPush } from './scenery-shape.js';

const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const authored = fileURLToPath(new URL('../Unity/Assets/Resources/valley.json', import.meta.url));
const packaged = fileURLToPath(new URL('./valley.json', import.meta.url));
export const VALLEY_PATH = process.env.VALLEY_PATH || (existsSync(authored) ? authored : packaged);
export const VALLEY = JSON.parse(readFileSync(VALLEY_PATH, 'utf8').replace(/^\uFEFF/, ''));

export class Valley {
  constructor(data = VALLEY) {
    this.data = data;
    if (data.version !== 1 || data.columns < 2 || data.rows < 2 || data.cellSize <= 0 ||
      data.heights.length !== data.columns * data.rows || !data.heights.every(Number.isFinite))
      throw new Error('Invalid shared valley height grid');
    this.cover = data.colliders.map(c => ({ ...c, base: this.height(c.x, c.z) }));
    const depositBodies = data.deposits.map(d => ({ ...d, base: this.height(d.x, d.z) }));
    this.obstacles = [...this.cover, ...depositBodies];
    this.removedRocks = new Set();
    this.navigationCache = new Map();
    let seed = 0;
    for (const c of this.cover) {
      if (c.kind === 'rock') c.shape = rockShape(c, seed++, this.height.bind(this));
      else if (c.kind === 'tree' || c.kind === 'trunk') seed++;
    }
    this.rebuildNavigation();
  }

  fork() {
    const copy = Object.assign(Object.create(Object.getPrototypeOf(this)), this);
    copy.removedRocks = new Set(this.removedRocks);
    return copy;
  }

  rebuildNavigation() {
    const key = [...this.removedRocks].sort().join('|');
    if (this.navigationCache.has(key)) { Object.assign(this, this.navigationCache.get(key)); return; }
    const data = this.data;
    // Coarse grid is used only to plan bots; final movement always uses exact cylinders.
    this.navStep = 2.5;
    this.navMin = -55;
    this.navSize = 45;
    this.navPoints = Array.from({ length: this.navSize ** 2 }, (_, i) => ({
      x: this.navMin + i % this.navSize * this.navStep,
      z: this.navMin + Math.floor(i / this.navSize) * this.navStep,
    }));
    this.navFree = this.navPoints.map(p => !this.blocked(p.x, p.z, data.playerRadius + 0.15));
    // Geometry is static for this Valley, including depleted/hidden seam bodies.
    // Build clear edges before the room starts; KB and changing goals only change endpoints.
    this.navFreeIndices = this.navFree.flatMap((free, i) => free ? [i] : []);
    const offsets = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    this.navEdges = this.navPoints.map((point, i) => {
      if (!this.navFree[i]) return [];
      const x = i % this.navSize, z = Math.floor(i / this.navSize);
      return offsets.flatMap(([dx, dz]) => {
        const nx = x + dx, nz = z + dz, next = nz * this.navSize + nx;
        if (nx < 0 || nz < 0 || nx >= this.navSize || nz >= this.navSize || !this.navFree[next]) return [];
        return this.walkClear(point, this.navPoints[next]) ? [next] : [];
      });
    });
    this.navigationCache.set(key, { navPoints: this.navPoints, navEdges: this.navEdges,
      navFree: this.navFree, navFreeIndices: this.navFreeIndices });
  }

  prepareSceneryNavigation(ids) {
    for (let mask = 1; mask < 1 << ids.length; mask++) {
      const preview = this.fork();
      preview.removedRocks = new Set(ids.filter((_, i) => mask & 1 << i));
      preview.rebuildNavigation();
    }
  }

  height(x, z) {
    const d = this.data;
    const gx = clamp((x - d.originX) / d.cellSize, 0, d.columns - 1);
    const gz = clamp((z - d.originZ) / d.cellSize, 0, d.rows - 1);
    const ix = Math.min(Math.floor(gx), d.columns - 2), iz = Math.min(Math.floor(gz), d.rows - 2);
    const tx = gx - ix, tz = gz - iz, i = iz * d.columns + ix;
    const a = d.heights[i] + (d.heights[i + 1] - d.heights[i]) * tx;
    const b = d.heights[i + d.columns] + (d.heights[i + d.columns + 1] - d.heights[i + d.columns]) * tx;
    return a + (b - a) * tz;
  }

  blocked(x, z, radius = this.data.playerRadius, bodyHeight = this.data.playerHeight) {
    if (Math.abs(x) > this.data.boundary || Math.abs(z) > this.data.boundary) return true;
    const y = this.height(x, z);
    return this.obstacles.some(c => {
      if (this.removedRocks.has(c.id)) return false;
      if (c.shape) {
        const moved = rockPush(c.shape, { x, y, z }, radius, bodyHeight);
        return Math.hypot(moved.x - x, moved.z - z) > .001;
      }
      return y + bodyHeight > c.base && y < c.base + c.height && Math.hypot(x - c.x, z - c.z) < c.radius + radius;
    });
  }

  supportHeight(x, z, feet, radius = this.data.playerRadius) {
    let support = this.height(x, z);
    for (const c of this.obstacles) {
      if (this.removedRocks.has(c.id)) continue;
      if (c.shape) {
        const hit = rockRay(c.shape, { x, y: feet + .03, z }, { x: 0, y: -1, z: 0 }, Math.max(0, feet + .03 - support));
        if (hit) support = Math.max(support, hit.point.y);
        continue;
      }
      const top = c.base + c.height;
      if (top <= feet + .03 && top > support && Math.hypot(x - c.x, z - c.z) < c.radius + radius - .001)
        support = top;
    }
    return support;
  }

  move(point, dx, dz, radius = this.data.playerRadius, bodyHeight = this.data.playerHeight) {
    let { x, z } = point;
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dz)) / 0.25));
    const bound = this.data.boundary;
    for (let step = 0; step < steps; step++) {
      x = clamp(x + dx / steps, -bound, bound);
      z = clamp(z + dz / steps, -bound, bound);
      for (let pass = 0; pass < 3; pass++) for (const c of this.obstacles) {
        if (this.removedRocks.has(c.id)) continue;
        const y = Math.max(point.y ?? -Infinity, this.height(x, z));
        if (c.shape) {
          const moved = rockPush(c.shape, { x, y, z }, radius, bodyHeight);
          x = moved.x; z = moved.z;
          continue;
        }
        if (y + bodyHeight <= c.base || y >= c.base + c.height - .001) continue;
        const ox = x - c.x, oz = z - c.z, len = Math.hypot(ox, oz), r = c.radius + radius;
        if (len < r) {
          x = c.x + (len >= 0.00001 ? ox / len : 1) * r;
          z = c.z + (len >= 0.00001 ? oz / len : 0) * r;
        }
      }
      x = clamp(x, -bound, bound); z = clamp(z, -bound, bound);
    }
    return { x, y: this.supportHeight(x, z, point.y ?? this.height(x, z), radius), z };
  }

  walkClear(a, b, radius = this.data.playerRadius + 0.1) {
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.4));
    for (let i = 0; i <= steps; i++) if (this.blocked(a.x + (b.x - a.x) * i / steps,
      a.z + (b.z - a.z) * i / steps, radius)) return false;
    return true;
  }

  rayDistance(origin, direction, maxDistance) {
    let limit = maxDistance;
    for (const c of this.cover) {
      if (this.removedRocks.has(c.id)) continue;
      if (c.shape) {
        const hit = rockRay(c.shape, origin, direction, limit);
        if (hit) limit = hit.distance;
        continue;
      }
      const ox = origin.x - c.x, oz = origin.z - c.z;
      const a = direction.x ** 2 + direction.z ** 2;
      let lo = 0, hi = limit;
      if (a < 1e-10) {
        if (ox * ox + oz * oz > c.radius * c.radius) continue;
      } else {
        const b = 2 * (ox * direction.x + oz * direction.z);
        const disc = b * b - 4 * a * (ox * ox + oz * oz - c.radius * c.radius);
        if (disc < 0) continue;
        lo = Math.max(lo, (-b - Math.sqrt(disc)) / (2 * a));
        hi = Math.min(hi, (-b + Math.sqrt(disc)) / (2 * a));
      }
      if (Math.abs(direction.y) < 1e-10) {
        if (origin.y < c.base || origin.y > c.base + c.height) continue;
      } else {
        const t1 = (c.base - origin.y) / direction.y, t2 = (c.base + c.height - origin.y) / direction.y;
        lo = Math.max(lo, Math.min(t1, t2)); hi = Math.min(hi, Math.max(t1, t2));
      }
      if (lo <= hi && lo >= 0) limit = lo;
    }
    const steps = Math.max(1, Math.ceil(limit / 0.35));
    for (let i = 1; i <= steps; i++) {
      const t = limit * i / steps, x = origin.x + direction.x * t, z = origin.z + direction.z * t;
      if (origin.y + direction.y * t <= this.height(x, z) + 0.03) return t;
    }
    return limit;
  }

  path(from, target) {
    if (this.walkClear(from, target)) return [target];
    // A real actor can stand closer to cover than the navigation grid's extra
    // clearance. Do not reject every possible endpoint connector for that pad.
    const endpointRadius = this.data.playerRadius;
    if (this.blocked(from.x, from.z, endpointRadius) || this.blocked(target.x, target.z, endpointRadius)) return [];
    const n = this.navSize;
    const pos = i => this.navPoints[i];
    const nearest = p => {
      // Check visibility in distance order. Scanning row-by-row used to cast a long
      // ray for every improving candidate (dozens of rays for each endpoint).
      const candidates = this.navFreeIndices.map(i => ({ i,
        distance: (pos(i).x - p.x) ** 2 + (pos(i).z - p.z) ** 2,
      })).sort((a, b) => a.distance - b.distance || a.i - b.i);
      return candidates.find(candidate => this.walkClear(p, pos(candidate.i), endpointRadius))?.i ?? -1;
    };
    const start = nearest(from), end = nearest(target);
    if (start < 0 || end < 0) return [];
    const previous = new Int32Array(n * n).fill(-1), queue = [start];
    previous[start] = start;
    for (let cursor = 0; cursor < queue.length && previous[end] < 0; cursor++) {
      const i = queue[cursor];
      for (const next of this.navEdges[i]) {
        if (previous[next] >= 0) continue;
        previous[next] = i; queue.push(next);
      }
    }
    if (previous[end] < 0) return [];
    const path = [target];
    for (let i = end; ; i = previous[i]) {
      path.push(pos(i));
      if (i === start) break;
    }
    return path.reverse();
  }
}

export const terrain = new Valley();
