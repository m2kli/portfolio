/* AI_MAP_SPEC v1 structural validator — the browser twin of tools/validate_ai_map.py.
   Both emit the same issue codes; tools/check_validator_parity.cjs keeps them in step.
   Works as a browser global (window.WorkbenchValidate) and as a Node module. */
(root => {
  'use strict';

  const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/;
  const STATUSES = ['existing', 'planned', 'adjusted', 'preview', 'annotation'];
  const TIERS = ['normal', 'elite', 'boss'];
  const BRANCHES = ['main', 'optional'];
  const ROUTE_KINDS = ['main', 'optional', 'exit', 'secret'];
  const NOTE_STATUSES = ['open', 'confirmed', 'resolved'];
  const SIDES = ['N', 'S', 'E', 'W'];
  const PLAYER_KEYS = ['radius', 'height', 'walkSpeed', 'rollDistance', 'rollDuration', 'interactionRange'];
  const DOOR_EDGE_TOLERANCE = 0.08;

  const isNum = value => typeof value === 'number' && Number.isFinite(value);
  const isPoint = (value, allowY = false) => Array.isArray(value) &&
    (value.length === 2 || (allowY && value.length === 3)) && value.every(isNum);

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

  function segmentsCross(a, b, c, d) {
    const cross = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
    const d1 = cross(c, d, a), d2 = cross(c, d, b), d3 = cross(a, b, c), d4 = cross(a, b, d);
    return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0)) && d1 !== 0 && d2 !== 0 && d3 !== 0 && d4 !== 0;
  }

  // Distance from segment a-b to a polygon (0 when touching or inside).
  function segmentPolygonDistance(a, b, polygon) {
    if (pointInPolygon(a, polygon) || pointInPolygon(b, polygon)) return 0;
    let best = Infinity;
    for (let i = 0; i < polygon.length; i++) {
      const p = polygon[i], q = polygon[(i + 1) % polygon.length];
      if (segmentsCross(a, b, p, q)) return 0;
      best = Math.min(best, segmentDistance(a, p, q), segmentDistance(b, p, q), segmentDistance(p, a, b));
    }
    return best;
  }

  function polygonArea(points) {
    let sum = 0;
    for (let i = 0; i < points.length; i++) {
      const p = points[i], q = points[(i + 1) % points.length];
      sum += p[0] * q[1] - q[0] * p[1];
    }
    return Math.abs(sum / 2);
  }

  function validate(data) {
    const errors = [];
    const warnings = [];
    const error = (code, id, msg) => errors.push({ code, id: id ?? null, msg });
    const warn = (code, id, msg) => warnings.push({ code, id: id ?? null, msg });
    data = data && typeof data === 'object' ? data : {};

    if (data.schemaVersion !== 1) error('schema-version', null, 'schemaVersion 必须是 1');
    const meta = data.meta || {};
    let bounds = meta.bounds || {};
    if (meta.units !== 'm') error('meta-units', null, 'meta.units 必须是 "m"');
    if (!['minX', 'minZ', 'maxX', 'maxZ'].every(key => isNum(bounds[key]))) {
      error('meta-bounds', null, 'meta.bounds 需要数字 minX/minZ/maxX/maxZ');
      bounds = { minX: -Infinity, minZ: -Infinity, maxX: Infinity, maxZ: Infinity };
    } else if (bounds.minX >= bounds.maxX || bounds.minZ >= bounds.maxZ) {
      error('meta-bounds-order', null, 'meta.bounds 的 min 必须小于 max');
    }
    const inBounds = p => bounds.minX <= p[0] && p[0] <= bounds.maxX && bounds.minZ <= p[1] && p[1] <= bounds.maxZ;
    const provenance = meta.provenance || {};
    if (!['design', 'scene-snapshot'].includes(provenance.kind)) error('provenance-kind', null, 'meta.provenance.kind 必须是 design 或 scene-snapshot');
    if (!provenance.label || !provenance.source) error('provenance-fields', null, 'meta.provenance 需要 label 和 source');
    if (provenance.kind === 'design' && !provenance.generatedAt) error('provenance-date', null, 'design 来源需要 generatedAt');
    if (provenance.kind === 'scene-snapshot' && !provenance.snapshotDate) error('provenance-date', null, 'scene-snapshot 来源需要 snapshotDate');
    const player = meta.player || {};
    for (const key of PLAYER_KEYS) {
      if (!isNum(player[key]) || player[key] < 0) error('player-field', key, `meta.player.${key} 必须是非负数`);
    }
    for (const [key, value] of Object.entries(meta.legendLabels || {})) {
      if (typeof value !== 'string' || !value) error('legend-label', key, `meta.legendLabels.${key} 必须是非空字符串`);
    }

    const floorById = new Map();
    const levels = [];
    for (const floor of data.floors || []) {
      const fid = floor.id;
      if (!fid || !ID_RE.test(fid)) error('floor-id', fid, `楼层 id 非法: ${fid}`);
      else if (floorById.has(fid)) error('floor-dup', fid, `楼层 id 重复: ${fid}`);
      floorById.set(fid, floor);
      if (!isNum(floor.elevation)) error('floor-elevation', fid, `楼层 ${fid}: elevation 必须是数字`);
      else levels.push(floor.elevation);
      if (!isNum(floor.height) || floor.height <= 0) error('floor-height', fid, `楼层 ${fid}: height 必须大于 0`);
    }
    if (levels.some((level, index) => index && level < levels[index - 1])) warn('floors-order', null, '楼层没有按 elevation 从低到高排列');

    const ids = new Set(floorById.keys());
    const register = (entity, type) => {
      const id = entity.id;
      if (!id || !ID_RE.test(id)) error('id-invalid', id, `${type} id 非法: ${id}`);
      else if (ids.has(id)) error('id-dup', id, `ID 重复: ${id}`);
      ids.add(id);
      return id;
    };
    const checkPoints = (points, id, type, allowY = false) => {
      for (const point of points) {
        if (!isPoint(point, allowY)) error('point-invalid', id, `${type} ${id}: 点格式错误 ${JSON.stringify(point)}`);
        else if (!inBounds(point)) error('point-out-of-bounds', id, `${type} ${id}: 点超出 bounds ${JSON.stringify(point)}`);
      }
    };
    const checkFloor = (entity, id, type) => {
      if (!floorById.has(entity.floorId)) error('floor-unknown', id, `${type} ${id}: 未知楼层 ${entity.floorId}`);
    };

    const rooms = data.rooms || [];
    const roomById = new Map();
    if (!rooms.length) error('rooms-empty', null, '至少需要一个房间');
    for (const room of rooms) {
      const rid = register(room, '房间');
      roomById.set(rid, room);
      checkFloor(room, rid, '房间');
      if (!STATUSES.includes(room.status)) error('room-status', rid, `房间 ${rid}: status 非法`);
      if (room.wallHeight !== undefined && (!isNum(room.wallHeight) || room.wallHeight < 0)) error('room-wall-height', rid, `房间 ${rid}: wallHeight 必须是 ≥0 的数字`);
      const points = room.points || [];
      if (points.length < 3) error('room-points', rid, `房间 ${rid}: 至少 3 个点`);
      else if (points.every(p => isPoint(p)) && polygonArea(points) < 0.5) warn('room-small', rid, `房间 ${rid}: 面积很小`);
      checkPoints(points, rid, '房间');
    }

    // Light AABB overlap warning; polygon-level overlap is intentionally not guessed.
    const box = points => ({
      x0: Math.min(...points.map(p => p[0])), z0: Math.min(...points.map(p => p[1])),
      x1: Math.max(...points.map(p => p[0])), z1: Math.max(...points.map(p => p[1])),
    });
    for (let i = 0; i < rooms.length; i++) {
      for (let j = i + 1; j < rooms.length; j++) {
        const a = rooms[i], b = rooms[j];
        if (a.floorId !== b.floorId) continue;
        const ap = a.points || [], bp = b.points || [];
        if (ap.length < 3 || bp.length < 3 || !ap.every(p => isPoint(p)) || !bp.every(p => isPoint(p))) continue;
        const A = box(ap), B = box(bp);
        const overlap = Math.max(0, Math.min(A.x1, B.x1) - Math.max(A.x0, B.x0)) * Math.max(0, Math.min(A.z1, B.z1) - Math.max(A.z0, B.z0));
        if (overlap > 0.5) warn('room-overlap', a.id, `房间 ${a.id} 与 ${b.id} 外框重叠 ${overlap.toFixed(1)} m²`);
      }
    }

    const objects = data.objects || [];
    for (const object of objects) {
      const oid = register(object, '物件');
      checkFloor(object, oid, '物件');
      const points = object.points || [];
      if (points.length < 3) error('object-points', oid, `物件 ${oid}: 至少 3 个点`);
      checkPoints(points, oid, '物件');
    }

    for (const enemy of data.enemies || []) {
      const eid = register(enemy, '敌人');
      if (!TIERS.includes(enemy.tier)) error('enemy-tier', eid, `敌人 ${eid}: tier 非法`);
      if (!BRANCHES.includes(enemy.branch)) error('enemy-branch', eid, `敌人 ${eid}: branch 非法`);
      const room = roomById.get(enemy.roomId);
      if (!room) error('enemy-room-unknown', eid, `敌人 ${eid}: 未知房间 ${enemy.roomId}`);
      else if (enemy.floorId !== room.floorId) error('enemy-floor-mismatch', eid, `敌人 ${eid}: 楼层与房间 ${room.id} 不一致`);
      const center = enemy.center;
      if (!isPoint(center)) error('enemy-center-invalid', eid, `敌人 ${eid}: center 格式错误`);
      else if (!inBounds(center)) error('point-out-of-bounds', eid, `敌人 ${eid}: center 超出 bounds`);
      else if (room && !pointInPolygon(center, room.points || [])) error('enemy-outside-room', eid, `敌人 ${eid}: center 不在房间 ${room.id} 内`);
    }

    const radius = isNum(player.radius) ? player.radius : 0;
    for (const door of data.doors || []) {
      const did = register(door, '门');
      checkFloor(door, did, '门');
      const points = door.points || [];
      if (points.length !== 2) error('door-points', did, `门 ${did}: 需要正好 2 个点`);
      if (!isNum(door.width) || door.width <= 0) error('door-width', did, `门 ${did}: width 必须大于 0`);
      else if (door.width < radius * 2 - 1e-6) warn('door-narrow', did, `门 ${did}: 宽 ${door.width}m 小于玩家直径 ${(radius * 2).toFixed(2)}m`);
      if (points.length === 2 && points.every(p => isPoint(p))) {
        const mid = [(points[0][0] + points[1][0]) / 2, (points[0][1] + points[1][1]) / 2];
        const onEdge = rooms.some(room => room.floorId === door.floorId && (room.points || []).some((p, i, list) =>
          isPoint(p) && isPoint(list[(i + 1) % list.length]) && segmentDistance(mid, p, list[(i + 1) % list.length]) <= DOOR_EDGE_TOLERANCE));
        if (!onEdge) warn('door-off-boundary', did, `门 ${did}: 中点不在任何房间边上`);
      }
    }

    const solids = objects.filter(object => object.solid === true && (object.points || []).length >= 3 && object.points.every(p => isPoint(p)));
    let main = null;
    for (const route of data.routes || []) {
      const rid = register(route, '路线');
      checkFloor(route, rid, '路线');
      if (!ROUTE_KINDS.includes(route.kind)) error('route-kind', rid, `路线 ${rid}: kind 非法`);
      const points = route.points || [];
      if (points.length < 2) error('route-points', rid, `路线 ${rid}: 至少 2 个点`);
      checkPoints(points, rid, '路线', true);
      if (route.kind === 'main') {
        if (main) warn('main-multiple', rid, '有多条主线；压力节奏只用第一条');
        else main = route;
      }
      if (radius > 0 && points.length >= 2 && points.every(p => isPoint(p, true))) {
        for (const object of solids) {
          if (object.floorId !== route.floorId) continue;
          const tight = points.slice(1).some((p, i) => segmentPolygonDistance(points[i], p, object.points) < radius - 1e-6);
          if (tight) warn('route-clearance', rid, `路线 ${rid}: 离阻挡物件 ${object.id} 不足玩家半径 ${radius}m`);
        }
      }
    }
    if (!main) error('main-missing', null, '缺少 kind="main" 的主线');

    for (const stair of data.stairs || []) {
      const sid = register(stair, '楼梯');
      for (const key of ['fromFloorId', 'toFloorId']) {
        if (!floorById.has(stair[key])) error('stairs-floor-unknown', sid, `楼梯 ${sid}: 未知 ${key} ${stair[key]}`);
      }
      if (stair.bottom !== undefined && !SIDES.includes(stair.bottom)) error('stairs-bottom', sid, `楼梯 ${sid}: bottom 必须是 N/S/E/W`);
      const points = stair.points || [];
      if (points.length < 3) error('stairs-points', sid, `楼梯 ${sid}: 至少 3 个点`);
      checkPoints(points, sid, '楼梯');
    }

    for (const water of data.water || []) {
      const wid = register(water, '水面');
      checkFloor(water, wid, '水面');
      const points = water.points || [];
      if (points.length < 3) error('water-points', wid, `水面 ${wid}: 至少 3 个点`);
      checkPoints(points, wid, '水面');
    }

    for (const note of data.reviewNotes || []) {
      const nid = register(note, '备注');
      if (!NOTE_STATUSES.includes(note.status)) error('note-status', nid, `备注 ${nid}: status 非法`);
      if (note.targetId && !ids.has(note.targetId)) error('note-target', nid, `备注 ${nid}: targetId 不存在 ${note.targetId}`);
      if (note.at !== undefined) {
        if (!isPoint(note.at)) error('point-invalid', nid, `备注 ${nid}: at 格式错误`);
        else if (!inBounds(note.at)) error('point-out-of-bounds', nid, `备注 ${nid}: at 超出 bounds`);
      }
      if (note.floorId !== undefined && !floorById.has(note.floorId)) error('floor-unknown', nid, `备注 ${nid}: 未知楼层 ${note.floorId}`);
    }

    return {
      errors,
      warnings,
      stats: {
        rooms: rooms.length,
        objects: objects.length,
        enemies: (data.enemies || []).length,
        routes: (data.routes || []).length,
        doors: (data.doors || []).length,
        stairs: (data.stairs || []).length,
        water: (data.water || []).length,
      },
    };
  }

  const api = { validate, pointInPolygon, segmentDistance, segmentPolygonDistance, polygonArea };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WorkbenchValidate = api;
})(typeof window !== 'undefined' ? window : globalThis);
