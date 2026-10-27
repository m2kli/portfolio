/* Plan geometry shared by the 2D plan style, the 3D view and the analysis layers.
   Pure functions on AI_MAP_SPEC data (no DOM, no three.js); works as a browser
   global (window.WorkbenchGeometry) and as a Node module for tests. */
(root => {
  'use strict';

  const OPPOSITE = { N: 'S', S: 'N', E: 'W', W: 'E' };

  function pointInPolygon(point, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const [xi, zi] = polygon[i], [xj, zj] = polygon[j];
      if ((zi > point[1]) !== (zj > point[1]) && point[0] < (xj - xi) * (point[1] - zi) / ((zj - zi) || 1e-9) + xi) inside = !inside;
    }
    return inside;
  }

  function segmentDistance(point, a, b) {
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const length = dx * dx + dz * dz;
    const t = length ? Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dz) / length)) : 0;
    return Math.hypot(point[0] - a[0] - t * dx, point[1] - a[1] - t * dz);
  }

  function boxOf(points) {
    return {
      minX: Math.min(...points.map(p => p[0])), maxX: Math.max(...points.map(p => p[0])),
      minZ: Math.min(...points.map(p => p[1])), maxZ: Math.max(...points.map(p => p[1])),
    };
  }

  // Collinear room edges on one floor merged into continuous wall runs.
  // heightOf(room) → wall height; rooms with height 0 (open spaces) add no walls.
  function wallRuns(rooms, heightOf = () => 1) {
    const lines = new Map();
    for (const room of rooms) {
      const height = heightOf(room);
      if (!(height > 0) || !room.points?.length) continue;
      room.points.forEach((a, index) => {
        const b = room.points[(index + 1) % room.points.length];
        const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (length < .15) return;
        let angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
        if (angle < 0) angle += Math.PI;
        if (angle >= Math.PI - 1e-6) angle -= Math.PI;
        const ux = Math.cos(angle), uz = Math.sin(angle);
        const offset = -a[0] * uz + a[1] * ux;
        const key = `${angle.toFixed(3)}|${offset.toFixed(2)}`;
        const t1 = a[0] * ux + a[1] * uz, t2 = b[0] * ux + b[1] * uz;
        if (!lines.has(key)) lines.set(key, { ux, uz, offset, spans: [] });
        lines.get(key).spans.push([Math.min(t1, t2), Math.max(t1, t2), height]);
      });
    }
    const runs = [];
    for (const { ux, uz, offset, spans } of lines.values()) {
      const at = t => [t * ux - offset * uz, t * uz + offset * ux];
      spans.sort((m, n) => m[0] - n[0]);
      let current = null;
      const flush = () => current && runs.push({ a: at(current[0]), b: at(current[1]), height: current[2] });
      for (const span of spans) {
        if (current && span[0] <= current[1] + .05) {
          current[1] = Math.max(current[1], span[1]);
          current[2] = Math.max(current[2], span[2]);
        } else {
          flush();
          current = [...span];
        }
      }
      flush();
    }
    return runs;
  }

  // Door openings lying on run a→b, as [start, end] distances along it.
  function doorCuts(a, b, doors) {
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (length < .15) return { length, cuts: [] };
    const ux = (b[0] - a[0]) / length, uz = (b[1] - a[1]) / length;
    const offset = p => Math.abs((p[0] - a[0]) * uz - (p[1] - a[1]) * ux);
    const along = p => (p[0] - a[0]) * ux + (p[1] - a[1]) * uz;
    const cuts = [];
    for (const door of doors) {
      const [p, q] = door.points;
      if (offset(p) > .35 || offset(q) > .35) continue;
      let t1 = Math.min(along(p), along(q)), t2 = Math.max(along(p), along(q));
      if (t2 - t1 < (door.width || 0)) {
        const mid = (t1 + t2) / 2;
        t1 = mid - door.width / 2;
        t2 = mid + door.width / 2;
      }
      if (t2 > 0 && t1 < length) cuts.push([Math.max(0, t1), Math.min(length, t2), door]);
    }
    return { length, cuts: cuts.sort((m, n) => m[0] - n[0]) };
  }

  // Wall pieces left on run a→b after cutting out every door lying on it.
  function wallSpans(a, b, doors) {
    const { length, cuts } = doorCuts(a, b, doors);
    if (length < .15) return [];
    const ux = (b[0] - a[0]) / length, uz = (b[1] - a[1]) / length;
    const spans = [];
    let t = 0;
    for (const [c1, c2] of cuts) {
      if (c1 - t > .1) spans.push([t, c1]);
      t = Math.max(t, c2);
    }
    if (length - t > .1) spans.push([t, length]);
    return spans.map(([s, e]) => [[a[0] + ux * s, a[1] + uz * s], [a[0] + ux * e, a[1] + uz * e]]);
  }

  // Which bbox side the stair climbs toward (its "to" end). stairs[].bottom wins;
  // otherwise the side touching a room on the target floor; otherwise the long axis.
  function stairSide(stair, box, roomsByFloor, elevationOf) {
    const cx = (box.minX + box.maxX) / 2, cz = (box.minZ + box.maxZ) / 2;
    const sides = {
      E: { axis: 'x', sign: 1, probe: [box.maxX + .6, cz] },
      W: { axis: 'x', sign: -1, probe: [box.minX - .6, cz] },
      N: { axis: 'z', sign: 1, probe: [cx, box.maxZ + .6] },
      S: { axis: 'z', sign: -1, probe: [cx, box.minZ - .6] },
    };
    if (sides[stair.bottom]) {
      const climbsUp = elevationOf(stair.toFloorId) >= elevationOf(stair.fromFloorId);
      return sides[climbsUp ? OPPOSITE[stair.bottom] : stair.bottom];
    }
    const touches = (floorId, p) => (roomsByFloor.get(floorId) || []).some(room => pointInPolygon(p, room.points));
    let best = null, bestScore = 0;
    for (const side of Object.values(sides)) {
      const score = (touches(stair.toFloorId, side.probe) ? 2 : 0) - (touches(stair.fromFloorId, side.probe) ? 1 : 0);
      if (score > bestScore) { best = side; bestScore = score; }
    }
    return best || { axis: box.maxX - box.minX >= box.maxZ - box.minZ ? 'x' : 'z', sign: 1 };
  }

  /* Walking distance to the nearest source over a grid of the floor.
     Walkable = inside a room and not inside a solid object. Moving between two
     different rooms is only allowed where a door is; inside a room you move freely
     (8-neighbour Dijkstra). Result rows run north→south (row 0 = bounds.maxZ).
     dist: -1 = not walkable, Infinity = walkable but no path to any source. */
  function distanceField({ rooms, doors = [], solids = [], sources = [], bounds, cell }) {
    const nx = Math.max(1, Math.ceil((bounds.maxX - bounds.minX) / cell));
    const nz = Math.max(1, Math.ceil((bounds.maxZ - bounds.minZ) / cell));
    const roomBoxes = rooms.map(room => ({ points: room.points, box: boxOf(room.points) }));
    const solidBoxes = solids.map(solid => ({ points: solid.points, box: boxOf(solid.points) }));
    const inside = (list, x, z) => list.findIndex(item => x >= item.box.minX && x <= item.box.maxX && z >= item.box.minZ && z <= item.box.maxZ && pointInPolygon([x, z], item.points));
    const centre = (i, j) => [bounds.minX + (i + .5) * cell, bounds.maxZ - (j + .5) * cell];
    const roomAt = new Int32Array(nx * nz).fill(-1);
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const [x, z] = centre(i, j);
        const room = inside(roomBoxes, x, z);
        if (room >= 0 && inside(solidBoxes, x, z) < 0) roomAt[j * nx + i] = room;
      }
    }
    const reach = Math.max(cell * .8, .35);
    const viaDoor = (p, q) => {
      const mid = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
      return doors.some(door => door.points?.length === 2 && segmentDistance(mid, door.points[0], door.points[1]) <= reach);
    };
    const dist = new Float64Array(nx * nz).fill(Infinity);
    for (let k = 0; k < dist.length; k++) if (roomAt[k] < 0) dist[k] = -1;

    // Binary heap of [distance, index].
    const heap = [];
    const push = (d, k) => {
      heap.push([d, k]);
      for (let n = heap.length - 1; n > 0;) {
        const parent = (n - 1) >> 1;
        if (heap[parent][0] <= heap[n][0]) break;
        [heap[parent], heap[n]] = [heap[n], heap[parent]];
        n = parent;
      }
    };
    const pop = () => {
      const top = heap[0], last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        for (let n = 0; ;) {
          const l = n * 2 + 1, r = l + 1;
          let m = n;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === n) break;
          [heap[m], heap[n]] = [heap[n], heap[m]];
          n = m;
        }
      }
      return top;
    };

    // Seed: every walkable cell inside a source polygon, else the nearest walkable cell.
    // A source may carry a starting distance `d` (e.g. a stair coming from another floor).
    const seeded = [];
    let start = 0;
    const seed = k => { if (start < dist[k]) { dist[k] = start; push(start, k); } };
    for (const source of sources) {
      let any = false;
      start = source.d || 0;
      if (source.points?.length >= 3) {
        const box = boxOf(source.points);
        for (let j = 0; j < nz; j++) {
          for (let i = 0; i < nx; i++) {
            const [x, z] = centre(i, j);
            if (roomAt[j * nx + i] < 0 || x < box.minX || x > box.maxX || z < box.minZ || z > box.maxZ) continue;
            if (pointInPolygon([x, z], source.points)) { seed(j * nx + i); any = true; }
          }
        }
      }
      if (!any) {
        const target = source.point || (source.points?.length ? [
          source.points.reduce((sum, p) => sum + p[0], 0) / source.points.length,
          source.points.reduce((sum, p) => sum + p[1], 0) / source.points.length,
        ] : null);
        if (!target) continue;
        let best = -1, bestD = cell * 4;
        for (let k = 0; k < dist.length; k++) {
          if (roomAt[k] < 0) continue;
          const [x, z] = centre(k % nx, Math.floor(k / nx));
          const d = Math.hypot(x - target[0], z - target[1]);
          if (d < bestD) { bestD = d; best = k; }
        }
        if (best >= 0) { seed(best); any = true; }
      }
      seeded.push(any);
    }

    const steps = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
    while (heap.length) {
      const [d, k] = pop();
      if (d > dist[k]) continue;
      const i = k % nx, j = Math.floor(k / nx);
      for (const [di, dj, cost] of steps) {
        const ni = i + di, nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= nx || nj >= nz) continue;
        const n = nj * nx + ni;
        if (roomAt[n] < 0) continue;
        if (di && dj && (roomAt[j * nx + ni] < 0 || roomAt[nj * nx + i] < 0)) continue; // no corner cutting
        if (roomAt[n] !== roomAt[k] && !viaDoor(centre(i, j), centre(ni, nj))) continue;
        const next = d + cost * cell;
        if (next < dist[n]) { dist[n] = next; push(next, n); }
      }
    }
    let max = 0, unreachable = 0, walkable = 0;
    for (const d of dist) {
      if (d < 0) continue;
      walkable += 1;
      if (d === Infinity) unreachable += 1;
      else if (d > max) max = d;
    }
    return { nx, nz, cell, bounds: { minX: bounds.minX, maxX: bounds.minX + nx * cell, minZ: bounds.maxZ - nz * cell, maxZ: bounds.maxZ }, dist, max, walkable, unreachable, seeded };
  }

  // Smallest reachable distance inside a polygon (else at the cell nearest its centroid).
  function minInPolygon(field, polygon) {
    const box = boxOf(polygon);
    let best = Infinity;
    for (let j = 0; j < field.nz; j++) {
      const z = field.bounds.maxZ - (j + .5) * field.cell;
      if (z < box.minZ || z > box.maxZ) continue;
      for (let i = 0; i < field.nx; i++) {
        const x = field.bounds.minX + (i + .5) * field.cell;
        if (x < box.minX || x > box.maxX || !pointInPolygon([x, z], polygon)) continue;
        const d = field.dist[j * field.nx + i];
        if (d >= 0 && d < best) best = d;
      }
    }
    if (best < Infinity) return best;
    const cx = polygon.reduce((sum, p) => sum + p[0], 0) / polygon.length, cz = polygon.reduce((sum, p) => sum + p[1], 0) / polygon.length;
    for (let ring = 0; ring <= 4 && best === Infinity; ring++) {
      for (const [ox, oz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const d = sampleField(field, cx + ox * ring * field.cell, cz + oz * ring * field.cell);
        if (d !== null && d < best) best = d;
      }
    }
    return best;
  }

  // Distance at a plan point (nearest cell), or null outside the grid / not walkable.
  function sampleField(field, x, z) {
    const i = Math.floor((x - field.bounds.minX) / field.cell), j = Math.floor((field.bounds.maxZ - z) / field.cell);
    if (i < 0 || j < 0 || i >= field.nx || j >= field.nz) return null;
    const d = field.dist[j * field.nx + i];
    return d < 0 ? null : d;
  }

  const api = { pointInPolygon, segmentDistance, boxOf, wallRuns, doorCuts, wallSpans, stairSide, distanceField, sampleField, minInPolygon };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WorkbenchGeometry = api;
})(typeof window !== 'undefined' ? window : globalThis);
