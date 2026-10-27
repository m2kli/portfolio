/* Shared pacing calculation for the China / Rome / Byzantium viewers.
   Chart drawing stays per-hall; this file owns the algorithm and geometry helpers. */
(() => {
  'use strict';
  const inPoly = (point, polygon) => {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i][0], zi = polygon[i][1];
      const xj = polygon[j][0], zj = polygon[j][1];
      if (((zi > point[1]) !== (zj > point[1])) && (point[0] < (xj - xi) * (point[1] - zi) / (zj - zi) + xi)) inside = !inside;
    }
    return inside;
  };
  const resample = (points, step) => {
    const out = [[0, points[0][0], points[0][1]]];
    let total = 0;
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i], b = points[i + 1];
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const count = Math.max(1, Math.ceil(length / step));
      for (let k = 1; k <= count; k++) {
        const t = k / count;
        out.push([total + length * t, a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      }
      total += length;
    }
    return out;
  };
  const segDist = (point, a, b) => {
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const length = dx * dx + dz * dz;
    const t = length ? Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dz) / length)) : 0;
    return Math.hypot(point[0] - a[0] - t * dx, point[1] - a[1] - t * dz);
  };
  const compute = ({
    routes = [],
    enemies = [],
    rooms = [],
    weights = {},
    lambda = 5.5,
    aggro = 8,
    step = 1,
    offPath = 7,
    skipRoom = () => false,
  } = {}) => {
    const main = routes.find(route => route.kind === 'main') || routes[0];
    const exit = routes.find(route => route.kind === 'exit');
    if (!main || !main.points) return null;
    const route = main.points.concat(exit ? exit.points.slice(1) : []);
    const activeRooms = rooms.filter(room => !skipRoom(room));
    const activeEnemies = enemies.filter(enemy => enemy.center);
    const samples = resample(route, step).map(([s, x, z]) => {
      let pressure = 0, concurrent = 0;
      for (const enemy of activeEnemies) {
        if (enemy.branch === 'optional') continue;
        const distance = Math.hypot(x - enemy.center[0], z - enemy.center[1]);
        pressure += (weights[enemy.enemyType] ?? 1) * Math.exp(-distance / lambda);
        if (distance <= aggro) concurrent++;
      }
      const room = activeRooms.find(item => inPoly([x, z], item.points))?.id || null;
      return { s, x, z, p: pressure, n: concurrent, room };
    });
    if (!samples.length) return null;
    const L = samples[samples.length - 1].s;
    let best = 0;
    for (let i = 1; i < samples.length; i++) if (samples[i].p > samples[best].p) best = i;
    const peak = { i: best, v: samples[best].p, s: samples[best].s, room: samples[best].room };
    const concurrentPeak = samples.reduce((value, sample) => Math.max(value, sample.n), 0);
    const restThreshold = peak.v * 0.2;
    const rest = [];
    let start = null;
    samples.forEach((sample, index) => {
      if (sample.p < restThreshold) {
        if (start === null) start = index;
      } else {
        if (start !== null && samples[index - 1].s - samples[start].s >= 4) rest.push([samples[start].s, samples[index - 1].s]);
        start = null;
      }
    });
    if (start !== null && L - samples[start].s >= 4) rest.push([samples[start].s, L]);
    const bands = [];
    let current = null;
    samples.forEach(sample => {
      if (sample.room) {
        if (current && current.room === sample.room) current.b = sample.s;
        else {
          current = { room: sample.room, a: sample.s, b: sample.s };
          bands.push(current);
        }
      } else current = null;
    });
    const mainEnemies = activeEnemies.filter(enemy => enemy.branch !== 'optional');
    const distances = mainEnemies.map(enemy => {
      let minimum = 1e9;
      for (let i = 0; i < route.length - 1; i++) minimum = Math.min(minimum, segDist(enemy.center, route[i], route[i + 1]));
      return minimum;
    });
    const sorted = distances.slice().sort((a, b) => a - b);
    return {
      L,
      samples,
      peak,
      concurrentPeak,
      restThreshold,
      rest,
      bands,
      route,
      median: sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0,
      offPath: distances.filter(value => value > offPath).length,
      mainCount: mainEnemies.length,
      optionalCount: activeEnemies.length - mainEnemies.length,
    };
  };
  window.ViewerPacing = { compute, inPoly, resample, segDist };
})();
