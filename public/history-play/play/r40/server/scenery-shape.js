import { readFileSync, existsSync } from '../../../runtime/node-shim.js';
const authored = new URL('../Unity/Assets/Resources/SceneryRock.json', import.meta.url);
const geometry = JSON.parse(readFileSync(existsSync(authored) ? authored : new URL('./scenery-rock.json', import.meta.url), 'utf8'));
const V = (x = 0, y = 0, z = 0) => ({ x, y, z });
const add = (a, b) => V(a.x + b.x, a.y + b.y, a.z + b.z);
const sub = (a, b) => V(a.x - b.x, a.y - b.y, a.z - b.z);
const mul = (a, n) => V(a.x * n, a.y * n, a.z * n);
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a, b) => V(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
const clamp = n => Math.max(0, Math.min(1, n));

export function rockShape(c, seed, height) {
  const base = height(c.x, c.z);
  let low = base;
  for (let i = 0; i < 8; i++) low = Math.min(low, height(c.x + Math.cos(i * Math.PI / 4) * c.radius * .78,
    c.z + Math.sin(i * Math.PI / 4) * c.radius * .78));
  const sink = Math.max(c.height * .35, base - low + c.height * .19);
  const a = seed * 79 * Math.PI / 180;
  return { id: c.id, x: c.x, y: base - sink, z: c.z, sx: c.radius, sy: c.height + sink,
    cos: Math.cos(a), sin: Math.sin(a), radius: c.radius, top: base + c.height };
}
export function localPoint(s, p, direction = false) {
  const x = p.x - (direction ? 0 : s.x), z = p.z - (direction ? 0 : s.z);
  return V((x * s.cos - z * s.sin) / s.sx, (p.y - (direction ? 0 : s.y)) / s.sy,
    (x * s.sin + z * s.cos) / s.sx);
}
export function worldPoint(s, p) {
  return V(s.x + (p.x * s.cos + p.z * s.sin) * s.sx, s.y + p.y * s.sy,
    s.z + (-p.x * s.sin + p.z * s.cos) * s.sx);
}
function vertex(i) { return V(geometry.vertices[i * 3], geometry.vertices[i * 3 + 1], geometry.vertices[i * 3 + 2]); }
function triangle(face) { return [0, 1, 2].map(k => vertex(geometry.triangles[face * 3 + k])); }
function rayTriangle(o, d, a, b, c) {
  const e = sub(b, a), f = sub(c, a), p = cross(d, f), det = dot(e, p);
  if (Math.abs(det) < 1e-10) return Infinity;
  const t = sub(o, a), u = dot(t, p) / det;
  if (u < -1e-7 || u > 1 + 1e-7) return Infinity;
  const q = cross(t, e), v = dot(d, q) / det;
  if (v < -1e-7 || u + v > 1 + 1e-7) return Infinity;
  const distance = dot(f, q) / det;
  return distance >= 0 ? distance : Infinity;
}
function rayBox(o, d, index, limit) {
  let lo = 0, hi = limit;
  for (let k = 0; k < 3; k++) {
    const key = ['x', 'y', 'z'][k], min = geometry.nodes[index * 10 + k] - 1e-6, max = geometry.nodes[index * 10 + 3 + k] + 1e-6;
    if (Math.abs(d[key]) < 1e-12) { if (o[key] < min || o[key] > max) return false; }
    else { const a = (min - o[key]) / d[key], b = (max - o[key]) / d[key]; lo = Math.max(lo, Math.min(a, b)); hi = Math.min(hi, Math.max(a, b)); }
  }
  return lo <= hi;
}
export function rockRay(s, origin, direction, maxDistance) {
  const o = localPoint(s, origin), d = localPoint(s, direction, true), stack = [0];
  let best = maxDistance, face = -1;
  while (stack.length) {
    const index = stack.pop(), n = index * 10;
    if (!rayBox(o, d, index, best)) continue;
    if (geometry.nodes[n + 9] > 0) {
      for (let i = geometry.nodes[n + 8]; i < geometry.nodes[n + 8] + geometry.nodes[n + 9]; i++) {
        const distance = rayTriangle(o, d, ...triangle(i));
        if (distance <= best) { best = distance; face = i; }
      }
    } else stack.push(geometry.nodes[n + 6], geometry.nodes[n + 7]);
  }
  if (face < 0) return null;
  const [a, b, c] = triangle(face).map(p => worldPoint(s, p));
  let normal = cross(sub(b, a), sub(c, a)); normal = mul(normal, 1 / Math.max(1e-12, Math.sqrt(dot(normal, normal))));
  if (dot(normal, direction) > 0) normal = mul(normal, -1);
  return { distance: best, point: add(origin, mul(direction, best)), normal };
}

function closestTriangle(p, a, b, c) {
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a), d1 = dot(ab, ap), d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return a;
  const bp = sub(p, b), d3 = dot(ab, bp), d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return b;
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return add(a, mul(ab, d1 / (d1 - d3)));
  const cp = sub(p, c), d5 = dot(ab, cp), d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return c;
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return add(a, mul(ac, d2 / (d2 - d6)));
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) return add(b, mul(sub(c, b), (d4 - d3) / (d4 - d3 + d5 - d6)));
  const denominator = 1 / (va + vb + vc);
  return add(a, add(mul(ab, vb * denominator), mul(ac, vc * denominator)));
}
function closestSegments(a, b, c, d) {
  const u = sub(b, a), v = sub(d, c), w = sub(a, c);
  const aa = dot(u, u), bb = dot(u, v), cc = dot(v, v), dd = dot(u, w), ee = dot(v, w);
  let s = aa * cc - bb * bb > 1e-12 ? clamp((bb * ee - cc * dd) / (aa * cc - bb * bb)) : 0;
  let t = cc > 1e-12 ? (bb * s + ee) / cc : 0;
  if (t < 0) { t = 0; s = aa > 1e-12 ? clamp(-dd / aa) : 0; }
  else if (t > 1) { t = 1; s = aa > 1e-12 ? clamp((bb - dd) / aa) : 0; }
  return [add(a, mul(u, s)), add(c, mul(v, t))];
}
function capsulePair(a, b, u, v, w) {
  const line = sub(b, a), intersection = rayTriangle(a, line, u, v, w);
  if (intersection <= 1) { const p = add(a, mul(line, intersection)); return [p, p]; }
  let pair = [a, closestTriangle(a, u, v, w)], best = dot(sub(pair[0], pair[1]), sub(pair[0], pair[1]));
  for (const next of [[b, closestTriangle(b, u, v, w)], closestSegments(a, b, u, v), closestSegments(a, b, v, w), closestSegments(a, b, w, u)]) {
    const delta = sub(next[0], next[1]), distance = dot(delta, delta);
    if (distance < best) { best = distance; pair = next; }
  }
  return pair;
}

// Highest point of a walkable triangle inside the horizontal foot disc.
// Candidate extrema are vertices, edge/circle crossings, or the circle point
// facing the plane gradient. Unlike a ring of rays, this cannot miss a thin lip.
function triangleSupport(a, b, c, x, z, radius) {
  const bx = b.x - a.x, bz = b.z - a.z, cx = c.x - a.x, cz = c.z - a.z;
  const det = bx * cz - bz * cx;
  if (Math.abs(det) < 1e-10) return -Infinity;
  const gx = ((b.y - a.y) * cz - bz * (c.y - a.y)) / det;
  const gz = (bx * (c.y - a.y) - (b.y - a.y) * cx) / det;
  if (1 / Math.sqrt(1 + gx * gx + gz * gz) < .65) return -Infinity;
  let best = -Infinity;
  const candidate = (px, pz) => {
    if ((px - x) ** 2 + (pz - z) ** 2 > radius * radius + 1e-8) return;
    const u = ((px - a.x) * cz - (pz - a.z) * cx) / det;
    const v = (bx * (pz - a.z) - bz * (px - a.x)) / det;
    if (u >= -1e-6 && v >= -1e-6 && u + v <= 1 + 1e-6)
      best = Math.max(best, a.y + gx * (px - a.x) + gz * (pz - a.z));
  };
  candidate(x, z);
  const vertices = [a, b, c];
  for (let i = 0; i < 3; i++) {
    const p = vertices[i], q = vertices[(i + 1) % 3]; candidate(p.x, p.z);
    const dx = q.x - p.x, dz = q.z - p.z, ox = p.x - x, oz = p.z - z;
    const aa = dx * dx + dz * dz, bb = ox * dx + oz * dz;
    const disc = bb * bb - aa * (ox * ox + oz * oz - radius * radius);
    if (aa <= 1e-12 || disc < 0) continue;
    for (const t of [(-bb - Math.sqrt(disc)) / aa, (-bb + Math.sqrt(disc)) / aa])
      if (t >= 0 && t <= 1) candidate(p.x + dx * t, p.z + dz * t);
  }
  const gradient = Math.hypot(gx, gz);
  if (gradient > 1e-10) candidate(x + gx / gradient * radius, z + gz / gradient * radius);
  return best;
}

export function rockSupport(s, x, z, feet, radius, minimum, walkableOnly = false) {
  if (Math.hypot(x - s.x, z - s.z) > s.radius * 1.43 + radius) return minimum;
  let support = minimum;
  if (!walkableOnly) {
    const hit = rockRay(s, { x, y: feet + .03, z }, V(0, -1, 0), Math.max(0, feet + .03 - minimum));
    if (hit) support = Math.max(support, hit.point.y);
  }
  const center = localPoint(s, V(x, feet, z)), extent = radius * 1.42 / s.sx;
  const low = (minimum - s.y) / s.sy, high = (feet + .03 - s.y) / s.sy, stack = [0];
  while (stack.length) {
    const n = stack.pop() * 10;
    if (geometry.nodes[n] > center.x + extent || geometry.nodes[n + 3] < center.x - extent ||
        geometry.nodes[n + 1] > high || geometry.nodes[n + 4] < low ||
        geometry.nodes[n + 2] > center.z + extent || geometry.nodes[n + 5] < center.z - extent) continue;
    if (!geometry.nodes[n + 9]) { stack.push(geometry.nodes[n + 6], geometry.nodes[n + 7]); continue; }
    for (let i = geometry.nodes[n + 8]; i < geometry.nodes[n + 8] + geometry.nodes[n + 9]; i++) {
      const [a, b, c] = triangle(i).map(p => worldPoint(s, p));
      const height = triangleSupport(a, b, c, x, z, radius);
      if (height <= feet + .030001) support = Math.max(support, height);
    }
  }
  return support;
}
export function rockPush(s, point, radius, bodyHeight) {
  if (Math.hypot(point.x - s.x, point.z - s.z) > s.radius * 1.43 + radius || point.y >= s.top + .03) return point;
  let result = { ...point };
  const center = localPoint(s, V(point.x, point.y + bodyHeight / 2, point.z));
  const rx = radius * 1.42 / s.sx, ry = bodyHeight / (2 * s.sy), stack = [0];
  while (stack.length) {
    const n = stack.pop() * 10;
    if (geometry.nodes[n] > center.x + rx || geometry.nodes[n + 3] < center.x - rx ||
      geometry.nodes[n + 1] > center.y + ry || geometry.nodes[n + 4] < center.y - ry ||
      geometry.nodes[n + 2] > center.z + rx || geometry.nodes[n + 5] < center.z - rx) continue;
    if (!geometry.nodes[n + 9]) { stack.push(geometry.nodes[n + 6], geometry.nodes[n + 7]); continue; }
    for (let i = geometry.nodes[n + 8]; i < geometry.nodes[n + 8] + geometry.nodes[n + 9]; i++) {
      const [a, b, c] = triangle(i).map(p => worldPoint(s, p));
      if (Math.max(a.y, b.y, c.y) <= result.y + .025) continue;
      const [onBody, onRock] = capsulePair(add(result, V(0, radius)), add(result, V(0, Math.max(radius, bodyHeight - radius))), a, b, c);
      const delta = sub(onBody, onRock), distance = dot(delta, delta);
      if (distance >= radius * radius - 1e-8) continue;
      let horizontal = Math.hypot(delta.x, delta.z), nx = delta.x, nz = delta.z;
      if (horizontal < 1e-8) {
        const normal = cross(sub(b, a), sub(c, a)); nx = normal.x; nz = normal.z;
        if (nx * (result.x - s.x) + nz * (result.z - s.z) < 0) { nx = -nx; nz = -nz; }
        const length = Math.hypot(nx, nz); if (length < 1e-8) continue;
        nx /= length; nz /= length; horizontal = 0;
      } else { nx /= horizontal; nz /= horizontal; }
      const push = Math.sqrt(Math.max(0, radius * radius - delta.y * delta.y)) - horizontal + .0001;
      result.x += nx * push; result.z += nz * push;
    }
  }
  return result;
}
