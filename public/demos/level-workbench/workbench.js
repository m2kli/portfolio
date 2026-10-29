/* Generic level workbench. Reads AI_MAP_SPEC v1 maps; no per-hall renderer. */
(() => {
  'use strict';

  const maps = window.WORKBENCH_MAPS || {};
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = value => Number(value).toFixed(1).replace(/\.0$/, '');
  const point = value => Array.isArray(value) && value.length >= 2 ? [Number(value[0]), Number(value[1])] : null;
  const centerOf = entity => {
    if (Array.isArray(entity.center)) return point(entity.center);
    const points = entity.points || [];
    if (!points.length) return [0, 0];
    return [points.reduce((sum, p) => sum + p[0], 0) / points.length, points.reduce((sum, p) => sum + p[1], 0) / points.length];
  };
  const bboxOf = entity => {
    const points = entity.points || (entity.center ? [entity.center] : []);
    if (!points.length) return null;
    const xs = points.map(p => p[0]), zs = points.map(p => p[1]);
    return { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
  };
  const areaOf = points => Math.abs(points.reduce((sum, p, index) => {
    const q = points[(index + 1) % points.length];
    return sum + p[0] * q[1] - q[0] * p[1];
  }, 0) / 2);
  const routeLength = points => points.slice(1).reduce((sum, p, index) => sum + Math.hypot(p[0] - points[index][0], p[1] - points[index][1]), 0);
  const unique = list => [...new Set(list)];

  const DEFAULT_LAYERS = {
    grid: true, rooms: true, objects: true, water: true, stairs: true,
    doors: true, routes: true, enemies: true, labels: true, notes: true,
    issues: true, clearance: false, heat: false, exits: false,
  };
  const state = {
    key: null,
    data: null,
    validation: null,
    floor: 'all',
    mode: '2d',
    selected: null,
    view: { x: 0, y: 0, w: 100, h: 100 },
    fitWidth: 100,
    drag: null,
    layers: { ...DEFAULT_LAYERS },
    exitOff: new Set(),
    style: 'schema',
    compare: null,
    tool: null,
    measure: { points: [], hover: null, done: false, closed: false },
    notes: null,
    statsSort: { key: 'area', dir: -1 },
  };

  const LAYERS = [
    ['grid', '网格'], ['rooms', '房间'], ['objects', '物件'], ['water', '水面'], ['stairs', '楼梯'],
    ['doors', '门'], ['routes', '路线'], ['enemies', '敌人'], ['labels', '名称'], ['notes', '备注钉'],
    ['issues', '问题标记'], ['clearance', '通行宽度'], ['heat', '压力热力'], ['exits', '撤离距离'],
  ];
  const validate = data => window.WorkbenchValidate.validate(data);
  let view3d = null;
  const playerRadius = () => (Number(state.data?.meta?.player?.radius) > 0 ? Number(state.data.meta.player.radius) : 0);
  const issuesFor = id => {
    const result = state.validation || { errors: [], warnings: [] };
    return [...result.errors.map(item => ({ ...item, level: 'error' })), ...result.warnings.map(item => ({ ...item, level: 'warn' }))]
      .filter(item => item.id === id);
  };

  function toast(message) {
    const element = $('toast');
    if (!element) return;
    element.textContent = message;
    element.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => element.classList.remove('show'), 1800);
  }

  function floorName(id) {
    const floor = (state.data?.floors || []).find(item => item.id === id);
    return floor ? floor.name : id || '未标注';
  }

  function entityGroups(data) {
    return {
      rooms: data.rooms || [],
      objects: data.objects || [],
      enemies: data.enemies || [],
      doors: data.doors || [],
      routes: data.routes || [],
      stairs: data.stairs || [],
      water: data.water || [],
    };
  }

  function allEntities(data) {
    const groups = entityGroups(data);
    return [
      ...groups.rooms.map(e => ({ ...e, _type: 'room' })),
      ...groups.objects.map(e => ({ ...e, _type: 'object' })),
      ...groups.enemies.map(e => ({ ...e, _type: 'enemy' })),
      ...groups.doors.map(e => ({ ...e, _type: 'door' })),
      ...groups.routes.map(e => ({ ...e, _type: 'route' })),
      ...groups.stairs.map(e => ({ ...e, _type: 'stairs' })),
      ...groups.water.map(e => ({ ...e, _type: 'water' })),
    ];
  }

  function indexData(data) {
    const index = new Map();
    for (const entity of allEntities(data)) index.set(entity.id, entity);
    return index;
  }

  function floorMatches(entity) {
    if (state.floor === 'all') return true;
    if (entity.fromFloorId && entity.toFloorId) return entity.fromFloorId === state.floor || entity.toFloorId === state.floor;
    return entity.floorId === state.floor;
  }

  function boundsOf(data, floorId = 'all') {
    if (floorId && floorId !== 'all') {
      const points = [];
      for (const entity of allEntities(data)) {
        const onFloor = entity.floorId === floorId || (entity._type === 'stairs' && (entity.fromFloorId === floorId || entity.toFloorId === floorId));
        if (!onFloor) continue;
        if (entity.points) points.push(...entity.points);
        if (entity.center) points.push(entity.center);
      }
      if (points.length) {
        return {
          minX: Math.min(...points.map(p => p[0])) - 1,
          minZ: Math.min(...points.map(p => p[1])) - 1,
          maxX: Math.max(...points.map(p => p[0])) + 1,
          maxZ: Math.max(...points.map(p => p[1])) + 1,
        };
      }
    }
    const meta = data.meta?.bounds;
    if (meta && ['minX', 'minZ', 'maxX', 'maxZ'].every(key => Number.isFinite(meta[key])) && meta.maxX > meta.minX && meta.maxZ > meta.minZ) {
      return { ...meta };
    }
    const points = [];
    for (const entity of allEntities(data)) {
      if (entity.points) points.push(...entity.points);
      if (entity.center) points.push(entity.center);
    }
    if (!points.length) return { minX: 0, minZ: 0, maxX: 100, maxZ: 100 };
    return {
      minX: Math.min(...points.map(p => p[0])) - 1,
      minZ: Math.min(...points.map(p => p[1])) - 1,
      maxX: Math.max(...points.map(p => p[0])) + 1,
      maxZ: Math.max(...points.map(p => p[1])) + 1,
    };
  }

  function fit() {
    const b = boundsOf(state.data, state.floor);
    const w = Math.max(1, b.maxX - b.minX);
    const h = Math.max(1, b.maxZ - b.minZ);
    state.fitWidth = w;
    state.view = { x: b.minX - w * 0.04, y: -b.maxZ - h * 0.04, w: w * 1.08, h: h * 1.08 };
    applyView();
  }

  function applyView() {
    if (!state.data) return;
    const svg = $('map');
    svg.setAttribute('viewBox', `${state.view.x} ${state.view.y} ${state.view.w} ${state.view.h}`);
    const pct = Math.round((state.fitWidth / state.view.w) * 100);
    $('zoomLabel').textContent = state.mode === '3d' ? '' : `${Math.max(1, pct)}%`;
    render();
  }

  function zoomAt(factor, clientX, clientY) {
    const svg = $('map');
    const rect = svg.getBoundingClientRect();
    const px = state.view.x + ((clientX - rect.left) / Math.max(1, rect.width)) * state.view.w;
    const py = state.view.y + ((clientY - rect.top) / Math.max(1, rect.height)) * state.view.h;
    const nextW = Math.max(4, Math.min(600, state.view.w * factor));
    const scale = nextW / state.view.w;
    state.view = {
      x: px - (px - state.view.x) * scale,
      y: py - (py - state.view.y) * scale,
      w: nextW,
      h: state.view.h * scale,
    };
    applyView();
  }

  function svgPoint(points) {
    return points.map(([x, z]) => `${x},${-z}`).join(' ');
  }

  function labelPosition(entity) {
    if (Array.isArray(entity.label)) return [entity.label[0], -entity.label[1]];
    const center = centerOf(entity);
    return [center[0], -center[1]];
  }

  // Rough text width in font-size units: CJK glyphs are about one em, Latin/digits ~0.6.
  const textWidth = text => [...String(text)].reduce((sum, ch) => sum + (/[⺀-￯]/.test(ch) ? 1.02 : .62), 0);

  // Label level of detail: screen pixels per metre at the current zoom.
  const pixelsPerMetre = () => 14 / labelSize();
  const LOD = { sub: 3, enemy: 7, marker: 12, object: 16 };

  function labelSize() {
    const svg = $('map');
    const width = svg.clientWidth || 1000;
    const height = svg.clientHeight || 600;
    const scale = Math.min(width / Math.max(1, state.view.w), height / Math.max(1, state.view.h));
    return Math.max(0.12, 14 / Math.max(0.001, scale));
  }

  function renderDefs() {
    const routeColors = { main: '#a34f40', optional: '#b58a3c', exit: '#2d7c78', secret: '#7d5a8a' };
    const markers = Object.entries(routeColors).map(([kind, color]) => (
      `<marker id="arrow-${kind}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="3" markerHeight="3" orient="auto"><path d="M0 0L10 5L0 10Z" fill="${color}"/></marker>`
    )).join('');
    return `<defs>
      <pattern id="grid" width="5" height="5" patternUnits="userSpaceOnUse"><path d="M5 0H0V5" fill="none" stroke="#d8cdb8" stroke-width=".04"/></pattern>
      <pattern id="water" width="2" height="2" patternUnits="userSpaceOnUse"><rect width="2" height="2" fill="#7fa9a2"/><path d="M0 .6Q.5 .35 1 .6T2 .6M0 1.5Q.5 1.25 1 1.5T2 1.5" fill="none" stroke="#d8e7dc" stroke-width=".07"/></pattern>
      ${markers}
      <marker id="arrow-stair" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0L10 5L0 10" fill="none" stroke="#3a332a" stroke-width="1.6"/></marker>
    </defs>`;
  }

  function render() {
    const data = state.data;
    const svg = $('map');
    if (!data) {
      svg.innerHTML = '';
      $('empty').hidden = false;
      return;
    }
    const index = indexData(data);
    const b = boundsOf(data, state.floor);
    const routeColors = { main: '#a34f40', optional: '#b58a3c', exit: '#2d7c78', secret: '#7d5a8a' };
    let html = renderDefs();
    if (state.layers.grid) {
      html += `<g pointer-events="none"><rect x="${b.minX}" y="${-b.maxZ}" width="${b.maxX - b.minX}" height="${b.maxZ - b.minZ}" fill="url(#grid)" opacity=".55"/></g>`;
    }

    const plan = state.style === 'plan';
    svg.classList.toggle('plan', plan);
    if (state.layers.rooms) {
      for (const room of data.rooms || []) {
        if (!floorMatches(room) || !room.points?.length) continue;
        const fill = plan ? tint(room.color || '#e7dcc5', .6) : room.color || '#e7dcc5';
        html += `<polygon class="wb-room wb-hit" data-id="${esc(room.id)}" points="${svgPoint(room.points)}" fill="${esc(fill)}" opacity="${plan ? 1 : .86}"><title>${esc(room.name)}</title></polygon>`;
      }
      // Finish footprints are generic map objects, drawn below all gameplay
      // geometry. Never draw mesh triangulation edges as physical borders.
      for (const object of [...(data.objects || [])].sort((a,b) => Number(a.kind === 'floor-inlay') - Number(b.kind === 'floor-inlay'))) {
        if (!['floor-finish', 'floor-inlay'].includes(object.kind) || !floorMatches(object)) continue;
        html += `<polygon class="wb-finish" points="${svgPoint(object.points)}" fill="${esc(object.color || '#ded6c2')}" pointer-events="none"/>`;
      }
    }
    if (state.layers.heat) {
      const field = heatField(state.floor);
      if (field) {
        const fb = field.bounds;
        html += `<image class="wb-heat" href="${field.url}" x="${fb.minX}" y="${-fb.maxZ}" width="${fb.maxX - fb.minX}" height="${fb.maxZ - fb.minZ}" preserveAspectRatio="none" pointer-events="none"/>`;
      }
    }
    if (state.layers.exits) {
      for (const floorId of visibleFloorIds()) {
        const field = exitField(floorId);
        if (!field) continue;
        const fb = field.bounds;
        html += `<image class="wb-exitfield" href="${field.url}" x="${fb.minX}" y="${-fb.maxZ}" width="${fb.maxX - fb.minX}" height="${fb.maxZ - fb.minZ}" preserveAspectRatio="none" pointer-events="none"/>`;
      }
    }
    if (state.layers.water) {
      for (const water of data.water || []) {
        if (!floorMatches(water) || !water.points?.length) continue;
        const box = bboxOf(water);
        html += `<polygon class="wb-water wb-hit" data-id="${esc(water.id)}" points="${svgPoint(water.points)}" fill="url(#water)" opacity=".8"><title>${esc(water.name)}</title></polygon>`;
        if (state.layers.labels && box && water.label && pixelsPerMetre() >= LOD.sub) {
          html += `<text class="wb-label wb-sub-label" x="${(box.minX + box.maxX) / 2}" y="${-(box.minZ + box.maxZ) / 2}" font-size="${(labelSize() * .55).toFixed(2)}" text-anchor="middle" pointer-events="none">${esc(water.name)}</text>`;
        }
      }
    }
    if (plan && state.layers.rooms) html += planWalls(data);
    if (state.layers.objects) {
      for (const object of data.objects || []) {
        if (!floorMatches(object) || !object.points?.length || ['floor-finish', 'floor-inlay'].includes(object.kind)) continue;
        const color = object.color || '#a99a7e';
        if (plan && !['combat-space', 'loot', 'interaction'].includes(object.kind)) {
          const look = ['column', 'pier'].includes(object.kind) ? 'wb-object-column' : object.solid ? 'wb-object-solid' : 'wb-object-soft';
          html += `<polygon class="${look} wb-hit" data-id="${esc(object.id)}" points="${svgPoint(object.points)}"><title>${esc(object.name)}</title></polygon>`;
          continue;
        }
        if (object.kind === 'combat-space') {
          html += `<polygon class="wb-combat-space wb-hit" data-id="${esc(object.id)}" points="${svgPoint(object.points)}" fill="none" stroke="${esc(color)}"><title>${esc(object.name)}</title></polygon>`;
        } else if (['loot', 'interaction'].includes(object.kind)) {
          const [x, z] = centerOf(object);
          const label = object.kind === 'loot' ? (object.name.match(/L\d+/)?.[0] || '拾取') : 'F';
          html += `<g class="wb-hit" data-id="${esc(object.id)}"><circle class="wb-resource" cx="${x}" cy="${-z}" r=".62" fill="${object.kind === 'loot' ? '#faf6e9' : '#287c7b'}"/>${pixelsPerMetre() >= LOD.marker ? `<text class="wb-label" x="${x}" y="${-z + .15}" text-anchor="middle" fill="${object.kind === 'loot' ? '#765823' : '#ffffff'}" font-size=".46">${esc(label)}</text>` : ''}<title>${esc(object.name)}</title></g>`;
        } else {
          html += `<polygon class="wb-object wb-hit" data-id="${esc(object.id)}" points="${svgPoint(object.points)}" fill="${esc(color)}" opacity=".92"><title>${esc(object.name)}</title></polygon>`;
        }
      }
    }
    if (state.layers.stairs) {
      for (const stair of data.stairs || []) {
        if (!floorMatches(stair) || !stair.points?.length) continue;
        const bbox = bboxOf(stair);
        if (!bbox) continue;
        if (plan) {
          html += planStair(stair, bbox, data);
          continue;
        }
        const horizontal = bbox.maxX - bbox.minX >= bbox.maxZ - bbox.minZ;
        html += `<g class="wb-hit" data-id="${esc(stair.id)}"><polygon class="wb-stairs" points="${svgPoint(stair.points)}"/><text class="wb-label wb-sub-label" x="${(bbox.minX + bbox.maxX) / 2}" y="${-(bbox.minZ + bbox.maxZ) / 2}" font-size="${(labelSize() * .6).toFixed(2)}" text-anchor="middle">${pixelsPerMetre() >= LOD.sub ? `${horizontal ? '↔' : '↕'} ${esc(stair.direction === 'down' ? '下' : '上')}` : ''}</text><title>${esc(stair.name)}</title></g>`;
      }
    }
    if (state.layers.doors) {
      for (const door of data.doors || []) {
        if (!floorMatches(door) || !door.points || door.points.length < 2) continue;
        const [a, b2] = door.points;
        const narrow = playerRadius() > 0 && door.width < playerRadius() * 2;
        if (plan) html += doorSwing(door, narrow);
        else html += `<line class="wb-door${narrow ? ' wb-door-narrow' : ''}" x1="${a[0]}" y1="${-a[1]}" x2="${b2[0]}" y2="${-b2[1]}" pointer-events="none"><title>${esc(door.name)} · ${num(door.width)}m</title></line>`;
        html += `<line class="wb-hit" data-id="${esc(door.id)}" x1="${a[0]}" y1="${-a[1]}" x2="${b2[0]}" y2="${-b2[1]}" stroke="transparent" stroke-width="12" vector-effect="non-scaling-stroke"><title>${esc(door.name)} · ${num(door.width)}m</title></line>`;
      }
    }
    // Player-width corridor along each route (meta.player.radius, true scale).
    if (state.layers.clearance && playerRadius() > 0) {
      for (const route of data.routes || []) {
        if (!floorMatches(route) || !route.points || route.points.length < 2) continue;
        const color = route.color || routeColors[route.kind] || '#a34f40';
        html += `<polyline class="wb-clearance" points="${svgPoint(route.points)}" stroke="${esc(color)}" stroke-width="${playerRadius() * 2}" pointer-events="none"/>`;
      }
    }
    if (state.layers.routes) {
      for (const route of data.routes || []) {
        if (!floorMatches(route) || !route.points || route.points.length < 2) continue;
        const color = route.color || routeColors[route.kind] || '#a34f40';
        const width = route.kind === 'main' ? 2.4 : 1.7;
        html += `<polyline class="wb-route" data-id="${esc(route.id)}" points="${svgPoint(route.points)}" stroke="${esc(color)}" stroke-width="${width}" marker-end="url(#arrow-${esc(route.kind)})"><title>${esc(route.name)}</title></polyline>`;
        html += `<polyline class="wb-hit" data-id="${esc(route.id)}" points="${svgPoint(route.points)}" fill="none" stroke="transparent" stroke-width="12" vector-effect="non-scaling-stroke"><title>${esc(route.name)}</title></polyline>`;
      }
    }
    if (state.layers.enemies) {
      for (const enemy of data.enemies || []) {
        if (!floorMatches(enemy) || !enemy.center) continue;
        const [x, z] = enemy.center;
        const y = -z;
        const color = enemy.tier === 'boss' ? '#805394' : enemy.tier === 'elite' ? '#a55c30' : '#b7524b';
        let shape = `<circle class="wb-enemy wb-hit" data-id="${esc(enemy.id)}" cx="${x}" cy="${y}" r=".42" fill="${color}"><title>${esc(enemy.name)}</title></circle>`;
        if (enemy.tier === 'elite') shape = `<path class="wb-enemy wb-hit" data-id="${esc(enemy.id)}" d="M${x} ${y - .56}l.56 .56-.56 .56-.56-.56Z" fill="${color}"><title>${esc(enemy.name)}</title></path>`;
        if (enemy.tier === 'boss') shape = `<circle class="wb-enemy wb-hit" data-id="${esc(enemy.id)}" cx="${x}" cy="${y}" r=".64" fill="${color}"/><circle cx="${x}" cy="${y}" r=".9" fill="none" stroke="#805394" stroke-width=".09" pointer-events="none"/><title>${esc(enemy.name)}</title>`;
        if (state.layers.labels && pixelsPerMetre() >= LOD.enemy) shape += `<text class="wb-label" x="${x + .62}" y="${y + .18}" font-size="${(labelSize() * .55).toFixed(2)}">${esc(enemy.enemyType || '')}</text>`;
        shape += `<circle class="wb-hit" data-id="${esc(enemy.id)}" cx="${x}" cy="${y}" r="1" fill="transparent"><title>${esc(enemy.name)}</title></circle>`;
        html += shape;
      }
    }
    if (state.compare) html += diffOverlay();
    if (state.layers.labels) {
      const size = labelSize();
      const candidates = (data.rooms || [])
        .filter(room => floorMatches(room) && room.points?.length)
        .map(room => {
          const [x, z] = labelPosition(room);
          const text = `${room.code ? `${room.code} ` : ''}${room.short || room.name}`;
          const rb = bboxOf(room);
          return { room, x, z, text, size, w: Math.max(size * 2, textWidth(text) * size + size * .3), h: size * 1.25, area: room.area || areaOf(room.points), fit: [rb.maxX - rb.minX, rb.maxZ - rb.minZ] };
        })
        .sort((a, b) => b.area - a.area);
      const placed = [];
      const free = box => !placed.some(other => !(box.x2 < other.x1 || box.x1 > other.x2 || box.y2 < other.y1 || box.y1 > other.y2));
      for (const item of candidates) {
        // Zoomed out, a name only shows when its room is big enough on screen to hold it.
        if (item.room.id !== state.selected && (item.fit[0] < item.w * .7 || item.fit[1] < item.h * .9)) continue;
        const box = { x1: item.x - item.w / 2, x2: item.x + item.w / 2, y1: item.z - item.h / 2, y2: item.z + item.h / 2 };
        if (!free(box)) continue;
        placed.push(box);
        html += `<text class="wb-label wb-room-label" x="${item.x}" y="${item.z}" font-size="${item.size.toFixed(2)}" text-anchor="middle">${esc(item.text)}</text>`;
      }
      // Close in, objects get their names too (rooms keep priority).
      if (pixelsPerMetre() >= LOD.object && state.layers.objects) {
        const small = size * .55;
        for (const object of data.objects || []) {
          if (!floorMatches(object) || !object.points?.length || !object.name || ['floor-finish', 'floor-inlay', 'combat-space'].includes(object.kind)) continue;
          const [x, z] = centerOf(object);
          const w = textWidth(object.name) * small + small * .3, h = small * 1.2;
          const box = { x1: x - w / 2, x2: x + w / 2, y1: -z - h / 2, y2: -z + h / 2 };
          if (!free(box)) continue;
          placed.push(box);
          html += `<text class="wb-label wb-sub-label wb-object-label" x="${x}" y="${-z}" font-size="${small.toFixed(2)}" text-anchor="middle" dominant-baseline="middle">${esc(object.name)}</text>`;
        }
      }
    }
    if (state.layers.notes && data.reviewNotes?.length) {
      const notes = data.reviewNotes.filter(note => (note.targetId && index.has(note.targetId)) || Array.isArray(note.at));
      notes.forEach((note, indexNumber) => {
        const target = note.targetId ? index.get(note.targetId) : null;
        if (target ? !floorMatches(target) : (note.floorId && state.floor !== 'all' && note.floorId !== state.floor)) return;
        const [x, z] = Array.isArray(note.at) ? note.at : centerOf(target);
        html += `<g class="wb-hit" ${target ? `data-id="${esc(target.id)}"` : ''} data-note="${esc(note.id)}"><circle class="wb-pin" cx="${x}" cy="${-z}" r=".62"/><text class="wb-pin-text" x="${x}" y="${-z + .3}" font-size="${(labelSize() * .5).toFixed(2)}">${indexNumber + 1}</text><title>${esc(note.text)}</title></g>`;
      });
    }
    if (state.layers.exits) {
      const r = labelSize() * .62;
      for (const candidate of activeExits()) {
        if (state.floor !== 'all' && candidate.floorId !== state.floor) continue;
        const pts = candidate.source.points || [candidate.source.point];
        const [x, z] = [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
        html += `<g class="wb-hit wb-exit-pin" data-id="${esc(candidate.id)}"><circle cx="${x}" cy="${-z}" r="${r.toFixed(2)}"/><text x="${x}" y="${(-z + r * .38).toFixed(2)}" font-size="${(r * 1.05).toFixed(2)}">出</text><title>撤离点：${esc(candidate.label)}</title></g>`;
      }
    }
    // Validation issues pinned to the entity they name (one ring per entity).
    if (state.layers.issues && state.validation) {
      const byId = new Map();
      for (const [level, list] of [['error', state.validation.errors], ['warn', state.validation.warnings]]) {
        for (const item of list) {
          if (!item.id || !index.has(item.id)) continue;
          const entry = byId.get(item.id) || { level, msgs: [] };
          if (level === 'error') entry.level = 'error';
          entry.msgs.push(item.msg);
          byId.set(item.id, entry);
        }
      }
      const r = labelSize() * .55;
      for (const [id, entry] of byId) {
        const target = index.get(id);
        if (!floorMatches(target)) continue;
        const [x, z] = centerOf(target);
        html += `<g class="wb-hit wb-issue wb-issue-${entry.level}" data-id="${esc(id)}" data-issue="${entry.msgs.length}"><circle cx="${x}" cy="${-z}" r="${r.toFixed(2)}"/><text x="${x}" y="${(-z + r * .38).toFixed(2)}" font-size="${(r * 1.1).toFixed(2)}" text-anchor="middle">!</text><title>${esc(entry.msgs.join('\n'))}</title></g>`;
      }
    }

    const selected = state.selected ? index.get(state.selected) : null;
    if (selected && floorMatches(selected)) {
      const box = bboxOf(selected);
      if (box && (box.maxX > box.minX || box.maxZ > box.minZ)) {
        html += `<rect class="wb-selection" x="${box.minX - .25}" y="${-box.maxZ - .25}" width="${box.maxX - box.minX + .5}" height="${box.maxZ - box.minZ + .5}" pointer-events="none"/>`;
      } else if (box) {
        html += `<circle class="wb-selection" cx="${box.minX}" cy="${-box.minZ}" r="1.3" pointer-events="none"/>`;
      }
    }
    svg.innerHTML = html;
    $('empty').hidden = true;
    renderLegend();
    renderMapMeta();
    paintPaceCursor();
    paintTools();
    syncHash();
    view3d?.sync();
  }

  /* Link state: floor and non-default layers ride in the hash on every render, so the
     address bar is always shareable; "复制链接" adds the 3D camera pose on demand. */
  function layersParam() {
    return LAYERS.map(([key]) => key)
      .filter(key => state.layers[key] !== DEFAULT_LAYERS[key])
      .map(key => (state.layers[key] ? key : `-${key}`)).join(',');
  }

  function syncHash() {
    if (!state.key) return;
    const params = new URLSearchParams(location.hash.replace(/^#/, ''));
    if (state.floor !== 'all') params.set('floor', state.floor); else params.delete('floor');
    const layers = layersParam();
    if (layers) params.set('layers', layers); else params.delete('layers');
    const next = `#${params}`;
    if (next !== location.hash) history.replaceState(null, '', `${location.pathname}${location.search}${next}`);
  }

  function applyHashState(params) {
    for (const token of (params.get('layers') || '').split(',').filter(Boolean)) {
      const key = token.replace(/^-/, '');
      if (key in DEFAULT_LAYERS) state.layers[key] = !token.startsWith('-');
    }
    const floor = params.get('floor');
    if (floor && (state.data.floors || []).some(item => item.id === floor)) state.floor = floor;
    renderLayers();
    renderFloors();
    renderLevels();
    renderExitPanel();
    fit();
  }

  async function copyLink() {
    const params = new URLSearchParams(location.hash.replace(/^#/, ''));
    if (state.mode === '3d') params.set('pose', view3d.pose()); else params.delete('pose');
    history.replaceState(null, '', `${location.pathname}${location.search}#${params}`);
    try {
      await navigator.clipboard.writeText(location.href);
      toast('链接已复制');
    } catch {
      window.prompt('复制这个链接：', location.href);
    }
  }

  /* Side panels, theme, help, drag-and-drop import. Panel and theme choices are a
     per-viewer convenience kept in localStorage (guarded: private windows may refuse). */
  const stored = {
    get: key => { try { return localStorage.getItem(key); } catch { return null; } },
    set: (key, value) => { try { localStorage.setItem(key, value); } catch { /* ignore */ } },
  };

  function togglePanel(side, force) {
    const main = document.querySelector('.wb-main');
    const cls = side === 'left' ? 'hide-left' : 'hide-right';
    const hidden = force ?? !main.classList.contains(cls);
    main.classList.toggle(cls, hidden);
    $(side === 'left' ? 'toggleLeftBtn' : 'toggleRightBtn').classList.toggle('active', hidden);
    stored.set(`wb-${cls}`, hidden ? '1' : '');
    requestAnimationFrame(() => { if (state.data) render(); });
  }

  function setTheme(theme) {
    document.documentElement.dataset.theme = theme;
    $('themeBtn').textContent = theme === 'dark' ? '☀' : '☾';
    stored.set('wb-theme', theme);
    if (state.data) render();
  }

  function toggleHelp(force) {
    const panel = $('helpPanel');
    panel.hidden = !(force ?? panel.hidden);
  }

  function bindShell() {
    $('toggleLeftBtn').onclick = () => togglePanel('left');
    $('toggleRightBtn').onclick = () => togglePanel('right');
    $('themeBtn').onclick = () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
    $('helpBtn').onclick = () => toggleHelp();
    $('copyLinkBtn').onclick = copyLink;
    $('helpPanel').addEventListener('click', event => {
      if (event.target === $('helpPanel') || event.target.closest('[data-close-modal]')) toggleHelp(false);
    });
    let depth = 0;
    const hasFiles = event => [...(event.dataTransfer?.types || [])].includes('Files');
    document.addEventListener('dragenter', event => { if (hasFiles(event)) { depth += 1; $('dropHint').hidden = false; } });
    document.addEventListener('dragleave', event => { if (hasFiles(event) && --depth <= 0) { depth = 0; $('dropHint').hidden = true; } });
    document.addEventListener('dragover', event => { if (hasFiles(event)) event.preventDefault(); });
    document.addEventListener('drop', event => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth = 0;
      $('dropHint').hidden = true;
      const file = [...event.dataTransfer.files].find(item => /\.json$/i.test(item.name) || item.type === 'application/json');
      if (file) importFile(file); else toast('只支持拖入 .json 地图文件');
    });
    window.addEventListener('keydown', event => {
      if (event.target instanceof Element && (event.target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName))) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === '?') { toggleHelp(); event.preventDefault(); }
      else if (event.key === 'Escape' && !$('helpPanel').hidden) toggleHelp(false);
      else if (event.key === 'Escape' && !$('statsPanel').hidden) toggleStats(false);
      else if (event.key === 'Escape' && state.tool) toolEscape();
      else if (event.key === 'Enter' && state.tool === 'measure') finishMeasure();
      else if (event.key === '[') togglePanel('left');
      else if (event.key === ']') togglePanel('right');
      else if (state.mode === '2d') tools2dKey(event);
    });
  }

  // 2D tool shortcuts.
  const toolKeys = { m: () => setTool('measure'), n: () => setTool('note'), t: () => toggleStats() };
  function tools2dKey(event) {
    const action = toolKeys[event.key.toLowerCase()];
    if (action) {
      event.preventDefault();
      action();
    }
  }

  /* Version compare: diff the shown map against a base (another map in the list or an
     imported JSON) by entity id. Added = green, removed = red dashed ghost of the old
     shape, moved/reshaped = amber with the old outline and a move arrow, field-only
     edits = amber dot. 2D only; the base is never written anywhere. */
  const DIFF_IGNORE = new Set(['_type']);

  function geometryOf(entity) {
    return JSON.stringify(entity.points || entity.center || null);
  }

  function computeDiff(current, base) {
    const now = indexData(current), before = indexData(base);
    const items = [];
    for (const [id, entity] of now) {
      const old = before.get(id);
      if (!old) { items.push({ kind: 'added', id, entity }); continue; }
      const moved = geometryOf(entity) !== geometryOf(old);
      const fields = unique([...Object.keys(entity), ...Object.keys(old)])
        .filter(key => !DIFF_IGNORE.has(key) && key !== 'points' && key !== 'center' && JSON.stringify(entity[key]) !== JSON.stringify(old[key]));
      if (!moved && !fields.length) continue;
      const a = centerOf(old), b = centerOf(entity);
      items.push({ kind: 'changed', id, entity, old, moved, shift: Math.hypot(b[0] - a[0], b[1] - a[1]), fields });
    }
    for (const [id, old] of before) if (!now.has(id)) items.push({ kind: 'removed', id, old });
    const order = { added: 0, changed: 1, removed: 2 };
    return items.sort((m, n) => order[m.kind] - order[n.kind] || String(m.id).localeCompare(String(n.id)));
  }

  function diffItems() {
    if (!state.compare) return [];
    if (state.compare.forKey !== state.key) {
      state.compare.items = computeDiff(state.data, state.compare.data);
      state.compare.forKey = state.key;
    }
    return state.compare.items;
  }

  function diffShape(entity, cls) {
    if (entity.center && !entity.points) return `<circle class="${cls}" cx="${entity.center[0]}" cy="${-entity.center[1]}" r="1"/>`;
    const points = entity.points || [];
    if (points.length < 2) return '';
    const open = entity._type === 'route' || entity._type === 'door' || points.length < 3;
    return open ? `<polyline class="${cls}" points="${svgPoint(points)}" fill="none"/>` : `<polygon class="${cls}" points="${svgPoint(points)}"/>`;
  }

  function diffOverlay() {
    let html = '';
    for (const item of diffItems()) {
      const entity = item.entity || item.old;
      if (!floorMatches(entity)) continue;
      if (item.kind === 'added') html += diffShape(item.entity, 'wb-diff-added');
      else if (item.kind === 'removed') html += `<g class="wb-hit" data-diff="${esc(item.id)}">${diffShape(item.old, 'wb-diff-removed')}<title>已删除：${esc(item.old.name || item.id)}</title></g>`;
      else if (item.moved) {
        html += diffShape(item.old, 'wb-diff-old') + diffShape(item.entity, 'wb-diff-changed');
        if (item.shift > .2) {
          const [a, b] = [centerOf(item.old), centerOf(item.entity)];
          html += `<line class="wb-diff-move" x1="${a[0]}" y1="${-a[1]}" x2="${b[0]}" y2="${-b[1]}" marker-end="url(#arrow-exit)"/>`;
        }
      } else {
        const [x, z] = centerOf(item.entity);
        html += `<circle class="wb-diff-dot" cx="${x}" cy="${-z}" r="${(labelSize() * .3).toFixed(2)}"/>`;
      }
    }
    return `<g pointer-events="visiblePainted">${html}</g>`;
  }

  function renderDiffPanel() {
    const panel = $('diffPanel');
    panel.hidden = !state.compare || !state.data;
    if (panel.hidden) return;
    const items = diffItems();
    const count = kind => items.filter(item => item.kind === kind).length;
    const tag = { added: '+', removed: '−', changed: '~' };
    const detail = item => {
      if (item.kind === 'added') return typeLabel(item.entity._type);
      if (item.kind === 'removed') return typeLabel(item.old._type);
      return [item.moved ? (item.shift > .2 ? `移动 ${num(item.shift)} m` : '形状') : '', item.fields.join('、')].filter(Boolean).join(' · ');
    };
    panel.innerHTML = `<div class="counts"><span style="color:#2e8a4f">+${count('added')} 新增</span><span style="color:var(--danger)">−${count('removed')} 删除</span><span style="color:var(--amber)">~${count('changed')} 变更</span></div>`
      + (items.length ? items.slice(0, 300).map(item => `<button type="button" data-diff-id="${esc(item.id)}" data-diff-kind="${item.kind}"><b class="wb-diff-tag ${item.kind}">${tag[item.kind]}</b><span>${esc((item.entity || item.old).name || item.id)}</span><small>${esc(detail(item))}</small></button>`).join('')
        : '<p class="wb-hint">两版没有差异</p>');
  }

  function setCompare(base, key) {
    state.compare = base ? { data: base, key, items: [], forKey: null } : null;
    const params = new URLSearchParams(location.hash.replace(/^#/, ''));
    if (key && maps[key]) params.set('cmp', key); else params.delete('cmp');
    history.replaceState(null, '', `${location.pathname}${location.search}#${params}`);
    renderCompareSelect();
    renderDiffPanel();
    render();
    if (state.selected) inspect(state.selected);
  }

  function renderCompareSelect() {
    const select = $('compareSelect');
    const options = Object.keys(maps).filter(key => key !== state.key)
      .map(key => `<option value="${esc(key)}">${esc((maps[key].meta?.title || key).replace(/^AFTER THE 9\s*·\s*/i, ''))}</option>`);
    const imported = state.compare && !maps[state.compare.key] ? `<option value="__file">（导入）${esc(state.compare.data.meta?.title || '基准 JSON')}</option>` : '';
    select.innerHTML = `<option value="">不对比</option>${imported}${options.join('')}`;
    select.value = state.compare ? (maps[state.compare.key] ? state.compare.key : '__file') : '';
  }

  // Centre on a removed entity's old shape (it no longer exists to be selected).
  function showRemoved(id) {
    const item = diffItems().find(entry => entry.id === id && entry.kind === 'removed');
    const box = item && bboxOf(item.old);
    if (!box) return;
    state.view.x = (box.minX + box.maxX) / 2 - state.view.w / 2;
    state.view.y = -(box.minZ + box.maxZ) / 2 - state.view.h / 2;
    applyView();
    toast(`已删除：${item.old.name || id}（基准里的位置）`);
  }

  /* 2D review tools: measure (M), annotate (N), stats (T). Tools take over the map
     click while active; dragging still pans. Notes are kept per map in this browser
     (localStorage) until exported as reviewNotes in a copy of the map JSON. */
  const walkSpeed = () => (Number(state.data?.meta?.player?.walkSpeed) > 0 ? Number(state.data.meta.player.walkSpeed) : 4);

  function planPoint(event) {
    const local = new DOMPoint(event.clientX, event.clientY).matrixTransform($('map').getScreenCTM().inverse());
    return [+local.x.toFixed(2), +(-local.y).toFixed(2)];
  }

  function setTool(tool) {
    state.tool = tool && state.tool !== tool ? tool : null;
    for (const [id, name] of [['measureBtn', 'measure'], ['noteBtn', 'note']]) {
      $(id).classList.toggle('active', state.tool === name);
      $(id).setAttribute('aria-pressed', String(state.tool === name));
    }
    $('map').classList.toggle('tool-measure', state.tool === 'measure');
    $('map').classList.toggle('tool-note', state.tool === 'note');
    if (state.tool !== 'note') closeNoteEditor();
    if (state.tool === 'measure') toast('测量：单击加点，双击 / Enter 结束，点回起点量面积，Esc 清除');
    if (state.tool === 'note') toast('批注：单击地图放钉（点在对象上就钉在该对象）');
    renderNotes();
    paintTools();
  }

  function toolEscape() {
    if (state.tool === 'measure' && state.measure.points.length) {
      state.measure = { points: [], hover: null, done: false, closed: false };
      paintTools();
    } else if (state.tool === 'note' && !$('noteEditor').hidden) closeNoteEditor();
    else setTool(null);
  }

  function measureClick(event) {
    const m = state.measure;
    if (m.done) Object.assign(m, { points: [], hover: null, done: false, closed: false });
    const p = planPoint(event);
    const first = m.points[0];
    if (first && m.points.length >= 3 && Math.hypot(p[0] - first[0], p[1] - first[1]) < labelSize() * .7) {
      Object.assign(m, { closed: true, done: true, hover: null });
    } else m.points.push(p);
    paintTools();
  }

  function finishMeasure() {
    const m = state.measure;
    if (m.points.length >= 2) Object.assign(m, { done: true, hover: null });
    paintTools();
  }

  function measureFigures() {
    const m = state.measure;
    const pts = m.done || !m.hover ? m.points : [...m.points, m.hover];
    const segments = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]));
    if (m.closed) segments.push(Math.hypot(pts[0][0] - pts.at(-1)[0], pts[0][1] - pts.at(-1)[1]));
    return { pts, segments, total: segments.reduce((sum, value) => sum + value, 0), area: m.closed ? areaOf(pts) : 0 };
  }

  function sessionNotes() {
    if (!state.data) return [];
    const key = `wb-notes:${state.data.meta?.title || state.key}`;
    if (state.notes?.key !== key) {
      let list = [];
      try { list = JSON.parse(stored.get(key) || '[]'); } catch { list = []; }
      state.notes = { key, list: Array.isArray(list) ? list : [] };
    }
    return state.notes.list;
  }

  function saveNotes() {
    stored.set(state.notes.key, JSON.stringify(state.notes.list));
    renderNotes();
    paintTools();
  }

  function noteClick(event, targetId) {
    const at = planPoint(event);
    const b = state.data.meta?.bounds;
    if (b && (at[0] < b.minX || at[0] > b.maxX || at[1] < b.minZ || at[1] > b.maxZ)) {
      toast('批注要放在地图范围（meta.bounds）内');
      return;
    }
    const target = targetId ? indexData(state.data).get(targetId) : null;
    const floors = state.data.floors || [];
    const floorId = target?.floorId || target?.fromFloorId || (state.floor !== 'all' ? state.floor : floors.length === 1 ? floors[0].id : undefined);
    state.pendingNote = { at, targetId: target?.id, floorId };
    const editor = $('noteEditor');
    const rect = $('canvasWrap').getBoundingClientRect();
    editor.style.left = `${Math.max(6, Math.min(rect.width - 270, event.clientX - rect.left + 12))}px`;
    editor.style.top = `${Math.max(6, Math.min(rect.height - 140, event.clientY - rect.top + 12))}px`;
    $('noteTarget').textContent = target ? `钉在：${target.name || target.id}` : `位置：(${num(at[0])}, ${num(at[1])})${floorId ? ` · ${floorName(floorId)}` : ''}`;
    $('noteText').value = '';
    editor.hidden = false;
    $('noteText').focus();
  }

  function closeNoteEditor() {
    const editor = $('noteEditor');
    // Hand the keyboard back to the map, otherwise shortcuts (M / N / T) keep typing
    // into the hidden textarea.
    if (!editor.hidden && editor.contains(document.activeElement)) $('map').focus({ preventScroll: true });
    editor.hidden = true;
    state.pendingNote = null;
  }

  function saveNote() {
    const text = $('noteText').value.trim();
    const pending = state.pendingNote;
    if (!pending) return closeNoteEditor();
    if (!text) { toast('先写批注内容'); return; }
    const taken = new Set([...indexData(state.data).keys(), ...(state.data.floors || []).map(floor => floor.id), ...(state.data.reviewNotes || []).map(note => note.id), ...sessionNotes().map(note => note.id)]);
    let n = sessionNotes().length + 1;
    while (taken.has(`rn-${n}`)) n += 1;
    const note = { id: `rn-${n}`, text, status: 'open', at: pending.at };
    if (pending.targetId) note.targetId = pending.targetId;
    if (pending.floorId) note.floorId = pending.floorId;
    sessionNotes().push(note);
    closeNoteEditor();
    saveNotes();
  }

  function showNote(id) {
    const note = sessionNotes().find(item => item.id === id);
    if (!note) return;
    if (note.targetId) return locate(note.targetId);
    if (note.floorId && state.floor !== 'all' && state.floor !== note.floorId) {
      state.floor = note.floorId;
      renderFloors();
      renderLevels();
    }
    state.view.x = note.at[0] - state.view.w / 2;
    state.view.y = -note.at[1] - state.view.h / 2;
    applyView();
  }

  function renderNotes() {
    const list = sessionNotes();
    $('notesSection').hidden = !list.length && state.tool !== 'note';
    $('notesCount').textContent = list.length ? `${list.length} 条` : '';
    const index = state.data ? indexData(state.data) : new Map();
    $('notesList').innerHTML = list.length
      ? list.map((note, i) => `<div class="note" data-note-id="${esc(note.id)}"><b>N${i + 1}</b><span>${esc(note.text)}<small>${esc(note.targetId ? (index.get(note.targetId)?.name || note.targetId) : `(${num(note.at[0])}, ${num(note.at[1])})`)}${note.floorId && (state.data.floors || []).length > 1 ? ` · ${esc(floorName(note.floorId))}` : ''}</small></span><button type="button" data-note-remove="${esc(note.id)}" title="删除" aria-label="删除批注">×</button></div>`).join('')
      : '<p class="wb-hint">在地图上单击放钉，写下意见；最后导出给 AI 修改。</p>';
  }

  function exportNotes() {
    const list = sessionNotes();
    if (!list.length) { toast('还没有批注'); return; }
    const copy = JSON.parse(JSON.stringify(state.data));
    copy.reviewNotes = [...(copy.reviewNotes || []), ...list];
    const result = validate(copy);
    if (result.errors.length) { toast(`导出前校验失败：${result.errors[0].msg}`); return; }
    const blob = new Blob([`${JSON.stringify(copy, null, 2)}\n`], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(state.data.meta?.title || 'map').replace(/[\\/:*?"<>|]/g, '-')}-评审批注.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast(`已导出 ${list.length} 条批注`);
  }

  async function copyNotes() {
    const list = sessionNotes();
    if (!list.length) { toast('还没有批注'); return; }
    const index = indexData(state.data);
    const lines = list.map((note, i) => {
      const where = note.targetId ? `${index.get(note.targetId)?.name || note.targetId}（${note.targetId}）` : `坐标 (${num(note.at[0])}, ${num(note.at[1])})${note.floorId ? ` @${note.floorId}` : ''}`;
      return `${i + 1}. [${where}] ${note.text}`;
    });
    const text = `请按以下评审意见修改地图「${state.data.meta?.title || state.key}」，保持其他内容与所有 ID 不变，输出完整 JSON：\n${lines.join('\n')}`;
    try {
      await navigator.clipboard.writeText(text);
      toast('已复制，可直接发给 AI');
    } catch {
      window.prompt('复制以下内容：', text);
    }
  }

  // Measure overlay + session note pins; redrawn after every render().
  function paintTools() {
    const svg = $('map');
    svg.querySelector('#wbTools')?.remove();
    if (!state.data) return;
    const size = labelSize();
    let html = '';
    const m = state.measure;
    const readout = $('measureReadout');
    readout.hidden = true;
    if (state.tool === 'measure' && m.points.length) {
      const { pts, segments, total, area } = measureFigures();
      html += `<${m.closed ? 'polygon class="wb-measure-area"' : 'polyline class="wb-measure-line"'} points="${svgPoint(pts)}"/>`;
      pts.forEach(p => { html += `<circle class="wb-measure-dot" cx="${p[0]}" cy="${-p[1]}" r="${(size * .22).toFixed(2)}"/>`; });
      segments.forEach((length, i) => {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        if (length > size * 2) html += `<text class="wb-measure-label" x="${(a[0] + b[0]) / 2}" y="${-(a[1] + b[1]) / 2 - size * .3}" font-size="${(size * .62).toFixed(2)}">${num(length)} m</text>`;
      });
      readout.innerHTML = `${segments.length} 段 · 总长 <b>${num(total)} m</b> · 步行约 ${Math.round(total / walkSpeed())} s`
        + (m.closed ? `<br>面积 <b>${num(area)} m²</b> · 周长 ${num(total)} m` : '')
        + (m.done ? '' : '<br><small>双击 / Enter 结束 · 点回起点量面积</small>');
      readout.hidden = false;
    }
    if (state.layers.notes) {
      sessionNotes().forEach((note, i) => {
        if (note.floorId && state.floor !== 'all' && note.floorId !== state.floor) return;
        const r = size * .62;
        html += `<g class="wb-note-pin${note.targetId ? ' wb-hit' : ''}" ${note.targetId ? `data-id="${esc(note.targetId)}"` : ''}><circle cx="${note.at[0]}" cy="${-note.at[1]}" r="${r.toFixed(2)}"/><text x="${note.at[0]}" y="${(-note.at[1] + r * .36).toFixed(2)}" font-size="${(r * .95).toFixed(2)}">N${i + 1}</text><title>${esc(note.text)}</title></g>`;
      });
    }
    if (!html) return;
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.id = 'wbTools';
    g.innerHTML = html;
    svg.appendChild(g);
  }

  /* Stats: a sortable room table (area, enemies, density, objects, doors, mean
     walking distance to an exit when exits are known) plus enemy and area mix. */
  function toggleStats(force) {
    const panel = $('statsPanel');
    const open = force ?? panel.hidden;
    if (open) renderStats();
    panel.hidden = !open;
  }

  function roomRows() {
    const data = state.data;
    const G = window.WorkbenchGeometry;
    const exits = exitCandidates(data).length > 0;
    return (data.rooms || []).filter(room => room.points?.length >= 3).map(room => {
      const area = room.area || areaOf(room.points);
      const enemies = (data.enemies || []).filter(enemy => enemy.roomId === room.id);
      const objects = (data.objects || []).filter(object => object.floorId === room.floorId && object.points?.length && !['floor-finish', 'floor-inlay'].includes(object.kind) && pointInPoly(centerOf(object), room.points));
      const doors = (data.doors || []).filter(door => door.floorId === room.floorId && door.points?.length === 2 && room.points.some((p, i) => {
        const q = room.points[(i + 1) % room.points.length];
        const mid = [(door.points[0][0] + door.points[1][0]) / 2, (door.points[0][1] + door.points[1][1]) / 2];
        return G.segmentDistance(mid, p, q) <= .1;
      }));
      let exit = null;
      if (exits) {
        const field = exitField(room.floorId);
        if (field) {
          let sum = 0, count = 0, blocked = 0;
          const box = bboxOf(room);
          for (let j = 0; j < field.nz; j++) {
            const z = field.bounds.maxZ - (j + .5) * field.cell;
            if (z < box.minZ || z > box.maxZ) continue;
            for (let i = 0; i < field.nx; i++) {
              const x = field.bounds.minX + (i + .5) * field.cell;
              if (x < box.minX || x > box.maxX || !pointInPoly([x, z], room.points)) continue;
              const d = field.dist[j * field.nx + i];
              if (d === Infinity) blocked += 1;
              else if (d >= 0) { sum += d; count += 1; }
            }
          }
          exit = count ? sum / count : blocked ? Infinity : null;
        }
      }
      return {
        id: room.id, name: room.name || room.id, floor: floorName(room.floorId), kind: room.kind || '', area,
        enemies: enemies.length, elite: enemies.filter(enemy => enemy.tier !== 'normal').length,
        density: enemies.length / Math.max(1, area) * 100, objects: objects.length, doors: doors.length, exit,
      };
    });
  }

  function renderStats() {
    const data = state.data;
    const rows = roomRows();
    const { key, dir } = state.statsSort;
    rows.sort((a, b) => {
      const va = a[key], vb = b[key];
      if (typeof va === 'string') return va.localeCompare(vb) * dir;
      return ((va ?? -1) - (vb ?? -1)) * dir;
    });
    const hasExit = rows.some(row => row.exit !== null);
    const columns = [['name', '房间'], ['floor', '楼层'], ['kind', '类型'], ['area', '面积 m²'], ['enemies', '敌人'], ['density', '密度 /100m²'], ['objects', '物件'], ['doors', '门'], ...(hasExit ? [['exit', '平均撤离 m']] : [])];
    const densities = rows.map(row => row.density).filter(value => value > 0).sort((a, b) => a - b);
    const hot = densities.length ? densities[Math.floor(densities.length * .85)] : Infinity;
    const cell = (row, column) => {
      const value = row[column];
      if (column === 'area') return num(value);
      if (column === 'density') return value ? `<span class="${value >= hot && row.enemies >= 3 ? 'hot' : ''}">${value.toFixed(1)}</span>` : '—';
      if (column === 'exit') return value === null ? '—' : value === Infinity ? '<span class="hot">到不了</span>' : num(value);
      if (column === 'enemies') return `${value}${row.elite ? `<small>（精英/Boss ${row.elite}）</small>` : ''}`;
      if (column === 'doors') return value ? value : '<span class="hot">0</span>';
      return esc(value);
    };
    const totalArea = rows.reduce((sum, row) => sum + row.area, 0);
    const enemies = data.enemies || [];
    const byType = new Map();
    for (const enemy of enemies) byType.set(enemy.enemyType || enemy.tier, (byType.get(enemy.enemyType || enemy.tier) || 0) + 1);
    const byKind = new Map();
    for (const row of rows) byKind.set(row.kind || '未分类', (byKind.get(row.kind || '未分类') || 0) + row.area);
    const bars = (map, total, unit) => [...map].sort((a, b) => b[1] - a[1])
      .map(([label, value]) => `<div class="wb-bar"><span title="${esc(label)}">${esc(label)}</span><i style="width:${(value / Math.max(1, ...map.values()) * 100).toFixed(1)}%"></i><span>${unit === '%' ? `${Math.round(value / total * 100)}%` : value}</span></div>`).join('');
    const tiers = ['normal', 'elite', 'boss'].map(tier => [tier, enemies.filter(enemy => enemy.tier === tier).length]);
    $('statsTitle').textContent = `统计 · ${data.meta?.title || state.key}`;
    $('statsBody').innerHTML = `<div class="wb-stats-summary">
        <div><b>${rows.length}</b>房间</div><div><b>${num(totalArea)} m²</b>房间总面积</div>
        <div><b>${enemies.length}</b>敌人（普通 ${tiers[0][1]} · 精英 ${tiers[1][1]} · Boss ${tiers[2][1]}）</div>
        <div><b>${(enemies.length / Math.max(1, totalArea) * 100).toFixed(2)}</b>平均敌人 /100m²</div>
        <div><b>${enemies.filter(enemy => enemy.branch === 'main').length} / ${enemies.filter(enemy => enemy.branch === 'optional').length}</b>主线 / 可选敌人</div>
        <div><b>${rows.filter(row => !row.doors).length}</b>没有门的房间</div>
      </div>
      <div class="wb-stats-grid">
        <div class="wb-table-wrap"><table class="wb-stats-table"><thead><tr>${columns.map(([k, label]) => `<th data-sort="${k}" class="${k === key ? 'sorted' : ''}">${label}${k === key ? (dir < 0 ? ' ▾' : ' ▴') : ''}</th>`).join('')}</tr></thead>
        <tbody>${rows.map(row => `<tr data-room="${esc(row.id)}">${columns.map(([k]) => `<td>${cell(row, k)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
        <div class="wb-stats-bars"><h3>敌人构成</h3>${bars(byType, enemies.length, 'n') || '<p class="wb-hint">没有敌人</p>'}<h3 style="margin-top:14px">面积占比（按房间类型）</h3>${bars(byKind, totalArea, '%')}</div>
      </div>
      <p class="wb-hint">点表头排序，点行定位到房间。红色：敌人密度在前 15% 且 ≥3 敌、没有门、或到不了出口。</p>`;
  }

  /* Plan style (architectural drawing). Walls come from the same merged runs and door
     cuts as the 3D view (map-geometry.js), drawn at true thickness but never thinner
     than ~2 px; open rooms (wallHeight 0) get a dashed outline instead. */
  function tint(hex, amount) {
    const value = /^#[0-9a-f]{6}$/i.test(hex) ? hex : '#e7dcc5';
    const rgb = [1, 3, 5].map(i => parseInt(value.slice(i, i + 2), 16));
    return `rgb(${rgb.map(c => Math.round(c + (255 - c) * amount)).join(',')})`;
  }

  const floorElevation = id => (state.data?.floors || []).find(floor => floor.id === id)?.elevation || 0;

  function planWalls(data) {
    const G = window.WorkbenchGeometry;
    const width = Math.max(.3, labelSize() * .14);
    let html = '';
    for (const floorId of unique((data.rooms || []).filter(room => floorMatches(room)).map(room => room.floorId))) {
      const rooms = (data.rooms || []).filter(room => room.floorId === floorId && room.points?.length >= 3);
      const doors = (data.doors || []).filter(door => door.floorId === floorId && door.points?.length === 2);
      for (const run of G.wallRuns(rooms, room => (Number.isFinite(room.wallHeight) ? room.wallHeight : 1))) {
        for (const [p, q] of G.wallSpans(run.a, run.b, doors)) {
          html += `<line class="wb-wall" x1="${p[0]}" y1="${-p[1]}" x2="${q[0]}" y2="${-q[1]}" stroke-width="${width.toFixed(3)}"/>`;
        }
      }
      for (const room of rooms) if (room.wallHeight === 0) html += `<polygon class="wb-wall-open" points="${svgPoint(room.points)}"/>`;
    }
    return `<g pointer-events="none">${html}</g>`;
  }

  // Door leaf + quarter-circle swing, hinged on the door's first point.
  function doorSwing(door, narrow) {
    const [a, b] = door.points;
    const A = [a[0], -a[1]], B = [b[0], -b[1]];
    const length = Math.hypot(B[0] - A[0], B[1] - A[1]);
    if (length < .05) return '';
    const w = Math.min(length, door.width || length);
    const u = [(B[0] - A[0]) / length, (B[1] - A[1]) / length], n = [-u[1], u[0]];
    const leaf = [A[0] + n[0] * w, A[1] + n[1] * w], jamb = [A[0] + u[0] * w, A[1] + u[1] * w];
    const sweep = n[0] * u[1] - n[1] * u[0] > 0 ? 1 : 0;
    return `<path class="wb-door-swing${narrow ? ' wb-door-narrow' : ''}" d="M${A} L${leaf} A${w} ${w} 0 0 ${sweep} ${jamb}" pointer-events="none"><title>${esc(door.name)} · ${num(door.width)}m</title></path>`;
  }

  // Treads across the run and an arrow pointing up the stair.
  function planStair(stair, box, data) {
    const G = window.WorkbenchGeometry;
    const roomsByFloor = new Map();
    for (const room of data.rooms || []) {
      if (!room.points?.length) continue;
      if (!roomsByFloor.has(room.floorId)) roomsByFloor.set(room.floorId, []);
      roomsByFloor.get(room.floorId).push(room);
    }
    const side = G.stairSide(stair, box, roomsByFloor, floorElevation);
    const up = floorElevation(stair.toFloorId) >= floorElevation(stair.fromFloorId) ? side.sign : -side.sign;
    const [lo, hi] = side.axis === 'x' ? [box.minX, box.maxX] : [box.minZ, box.maxZ];
    const [across1, across2] = side.axis === 'x' ? [box.minZ, box.maxZ] : [box.minX, box.maxX];
    const count = Math.max(3, Math.round((hi - lo) / .3));
    let html = `<g class="wb-hit" data-id="${esc(stair.id)}"><polygon class="wb-stair-plan" points="${svgPoint(stair.points)}"/>`;
    for (let k = 1; k < count; k++) {
      const t = lo + (hi - lo) * k / count;
      html += side.axis === 'x'
        ? `<line class="wb-tread" x1="${t}" y1="${-across1}" x2="${t}" y2="${-across2}"/>`
        : `<line class="wb-tread" x1="${across1}" y1="${-t}" x2="${across2}" y2="${-t}"/>`;
    }
    const mid = (across1 + across2) / 2;
    const [from, to] = up > 0 ? [lo + (hi - lo) * .12, hi - (hi - lo) * .12] : [hi - (hi - lo) * .12, lo + (hi - lo) * .12];
    html += side.axis === 'x'
      ? `<line class="wb-stair-arrow" x1="${from}" y1="${-mid}" x2="${to}" y2="${-mid}" marker-end="url(#arrow-stair)"/>`
      : `<line class="wb-stair-arrow" x1="${mid}" y1="${-from}" x2="${mid}" y2="${-to}" marker-end="url(#arrow-stair)"/>`;
    return `${html}<title>${esc(stair.name)} · ${esc(floorName(stair.fromFloorId))} → ${esc(floorName(stair.toFloorId))}</title></g>`;
  }

  function setStyle(style) {
    state.style = style === 'plan' ? 'plan' : 'schema';
    for (const [id, on] of [['styleSchemaBtn', state.style === 'schema'], ['stylePlanBtn', state.style === 'plan']]) {
      $(id).classList.toggle('active', on);
      $(id).setAttribute('aria-pressed', String(on));
    }
    const params = new URLSearchParams(location.hash.replace(/^#/, ''));
    if (state.style === 'plan') params.set('style', 'plan'); else params.delete('style');
    history.replaceState(null, '', `${location.pathname}${location.search}#${params}`);
    render();
  }

  function renderLegend() {
    const data = state.data;
    if (!data) return;
    const routes = unique((data.routes || []).map(route => route.kind));
    const routeColors = { main: '#a34f40', optional: '#b58a3c', exit: '#2d7c78', secret: '#7d5a8a' };
    const routeLabels = { main: '主线', optional: '可选', exit: '离场', secret: '暗线' };
    let html = '<span><i style="background:#e7dcc5;border:1px solid #6b5b45"></i>房间</span>';
    for (const kind of routes) html += `<span><i style="background:${routeColors[kind] || '#a34f40'}"></i>${routeLabels[kind] || esc(kind)}</span>`;
    if (data.enemies?.some(e => e.tier === 'normal')) html += '<span><i class="dot" style="background:#b7524b"></i>普通</span>';
    if (data.enemies?.some(e => e.tier === 'elite')) html += '<span><i class="diamond" style="background:#a55c30"></i>精英</span>';
    if (data.enemies?.some(e => e.tier === 'boss')) html += '<span><i class="dot" style="background:#805394"></i>Boss</span>';
    if (data.water?.length) html += '<span><i style="background:#6fa6a0;height:6px"></i>水面</span>';
    if (data.objects?.some(o => o.kind === 'loot')) html += '<span><i class="dot" style="background:#d8b453"></i>资源 L</span>';
    if (data.objects?.some(o => o.kind === 'combat-space')) html += '<span><i style="background:#73a78b;height:3px"></i>战斗留白</span>';
    if (state.layers.issues && state.validation && [...state.validation.errors, ...state.validation.warnings].some(item => item.id)) html += '<span><i class="dot" style="background:#fff6df;border:1px solid #8a611f"></i>问题</span>';
    if (state.layers.clearance && playerRadius() > 0) html += `<span><i style="background:#a34f4033;height:6px"></i>通行宽度 ${num(playerRadius() * 2)}m</span>`;
    if (state.layers.exits) html += '<span title="沿可走区域、只穿过门的步行距离；灰色 = 走不到任何出口"><i class="wb-dist-swatch"></i>撤离距离 近→远</span><span><i class="dot" style="background:#8c8c8c"></i>到不了出口</span>';
    if (state.layers.heat) html += '<span title="同压力曲线公式，但计入全部敌人（含可选支线），按本层最大值归一"><i class="wb-heat-swatch"></i>压力热力 低→高</span>';
    $('legend').innerHTML = html;
  }

  function renderMapMeta() {
    const data = state.data;
    if (!data) return;
    const b = boundsOf(data, state.floor);
    $('mapMeta').innerHTML = `${esc(data.meta?.title || '未命名')} · ${num(b.maxX - b.minX)}×${num(b.maxZ - b.minZ)}m · ${esc(state.floor === 'all' ? '全部楼层' : floorName(state.floor))}${state.mode === '3d' ? ' · 3D 块面' : ''}`;
  }

  function renderMapHead() {
    const data = state.data;
    if (!data) return;
    $('mapTitle').textContent = data.meta?.title || '未命名地图';
    $('mapSubtitle').textContent = data.meta?.subtitle || data.meta?.concept || '';
    const badges = [];
    if (data.meta?.provenance?.label) badges.push(data.meta.provenance.label);
    if (data.floors?.length) badges.push(`${data.floors.length} 层`);
    if (data.meta?.player) badges.push(`玩家 ${data.meta.player.radius} m`);
    $('mapBadges').innerHTML = badges.map(item => `<span>${esc(item)}</span>`).join('');
  }

  function renderSummary() {
    const data = state.data;
    if (!data) return;
    const rooms = data.rooms?.length || 0;
    const enemies = data.enemies?.length || 0;
    const main = (data.routes || []).find(route => route.kind === 'main');
    const length = data.meta?.mainLength || (main ? routeLength(main.points || []) : 0);
    const area = data.meta?.area || (data.rooms || []).reduce((sum, room) => sum + areaOf(room.points || []), 0);
    $('summary').innerHTML = [
      [rooms, '房间'], [enemies, '敌人'],
      [`${num(length)} m`, '主线'], [`${num(area)} m²`, '面积'],
    ].map(([value, label]) => `<div><b>${esc(value)}</b><span>${label}</span></div>`).join('');
  }

  function renderLevels() {
    const data = state.data;
    if (!data) return;
    const floors = [...(data.floors || [])].sort((a, b) => a.elevation - b.elevation);
    $('levelsPanel').innerHTML = floors.map(floor => (
      `<button type="button" data-level="${esc(floor.id)}" class="${state.floor === floor.id ? 'active' : ''}"><b>${esc(floor.name)}</b><span>${esc(floor.note || `${num(floor.elevation)} m`)}</span></button>`
    )).join('') || '<p class="wb-hint">无楼层信息</p>';
    $('levelsPanel').querySelectorAll('[data-level]').forEach(button => {
      button.onclick = () => {
        state.floor = button.dataset.level;
        renderFloors();
        renderLevels();
        fit();
      };
    });
  }

  function renderDesignNotes() {
    const notes = Array.isArray(state.data?.meta?.designNotes) ? state.data.meta.designNotes : [];
    $('designNotes').innerHTML = notes.length ? notes.map(note => `<p>${esc(note)}</p>`).join('') : '<p>暂无设计说明</p>';
  }

  function renderPacing() {
    const data = state.data;
    const panel = $('pacingPanel');
    if (!data || !window.ViewerPacing || !(data.routes || []).length || !(data.enemies || []).length) {
      panel.hidden = true;
      return;
    }
    const weights = {};
    for (const enemy of data.enemies) {
      weights[enemy.enemyType] = enemy.tier === 'boss' ? 6 : enemy.tier === 'elite' ? 3 : 1;
    }
    const pacing = data.meta?.pacing || {};
    const m = window.ViewerPacing.compute({
      routes: data.routes, enemies: data.enemies, rooms: data.rooms || [],
      weights: pacing.weights || weights,
      lambda: pacing.lambda || 5.5,
      aggro: pacing.aggro || 8,
      step: pacing.step || 1,
    });
    if (!m) {
      panel.hidden = true;
      state.pacing = null;
      return;
    }
    panel.hidden = false;
    $('pacingSummary').textContent = `主线 ${m.L.toFixed(0)} m · 敌 ${m.mainCount}+${m.optionalCount} · 峰值 ${m.peak.v.toFixed(2)}@${m.peak.s.toFixed(0)}m`;
    $('pacingNote').textContent = '压力 = Σ 权重 × exp(−距离/5.5m)；只算主线附近敌人，不含绕墙、AI 与遮挡，是静态设计近似。';
    const W = 1000, H = 150, padL = 42, padR = 12, padT = 18, padB = 22;
    const pw = W - padL - padR, ph = H - padT - padB;
    const pmax = m.peak.v * 1.16 || 1;
    const X = value => padL + (value / Math.max(1, m.L)) * pw;
    const Y = value => padT + (1 - value / pmax) * ph;
    let svg = '';
    for (const band of m.bands || []) {
      const room = (data.rooms || []).find(item => item.id === band.room);
      svg += `<rect x="${X(band.a).toFixed(1)}" y="${padT}" width="${Math.max(0, X(band.b) - X(band.a)).toFixed(1)}" height="${ph}" fill="${esc(room?.color || '#e9e3d4')}" opacity=".5"/>`;
    }
    svg += `<line x1="${padL}" y1="${Y(m.restThreshold).toFixed(1)}" x2="${W - padR}" y2="${Y(m.restThreshold).toFixed(1)}" stroke="#b58a3c" stroke-width="1" stroke-dasharray="5 4"/>`;
    svg += `<polyline points="${m.samples.map(sample => `${X(sample.s).toFixed(1)},${Y(sample.p).toFixed(1)}`).join(' ')}" fill="none" stroke="#2d7c78" stroke-width="2"/>`;
    const peakX = X(m.peak.s), peakY = Y(m.peak.v);
    svg += `<circle cx="${peakX.toFixed(1)}" cy="${peakY.toFixed(1)}" r="3.2" fill="#a34f40"/>`;
    svg += `<text class="wb-pace-peak" x="${Math.min(W - 90, peakX + 7).toFixed(1)}" y="${Math.max(12, peakY - 6).toFixed(1)}" font-size="10" fill="#a34f40">峰值 ${m.peak.v.toFixed(2)} @ ${m.peak.s.toFixed(0)}m</text>`;
    svg += `<line x1="${padL}" y1="${H - padB}" x2="${W - padR}" y2="${H - padB}" stroke="#c9bea9" stroke-width=".8"/>`;
    svg += `<text x="${padL}" y="${H - 6}" font-size="9" fill="#8a8578">0</text><text x="${W - padR}" y="${H - 6}" text-anchor="end" font-size="9" fill="#8a8578">${m.L.toFixed(0)} m</text>`;
    svg += `<g id="paceHover" pointer-events="none"></g><rect class="wb-pace-hit" x="${padL}" y="0" width="${pw}" height="${H}" fill="transparent"/>`;
    $('pacingChart').innerHTML = svg;
    state.pacing = { m, X, Y, padL, pw, W, H, padT, padB, aggro: pacing.aggro || 8, profile: routeProfile(data) };
    state.paceCursor = null;
  }

  /* Pressure heatmap: the pacing formula (weight × exp(−d/λ)) evaluated over the whole
     floor instead of along the route, coloured only inside rooms. Unlike the curve it
     counts every enemy (main and optional): it answers "where is it dangerous". */
  const HEAT_STOPS = [[255, 236, 160], [244, 170, 70], [214, 84, 52], [128, 28, 46]];
  const heatCache = new Map();

  function heatWeights(data) {
    const pacing = data.meta?.pacing || {};
    return enemy => pacing.weights?.[enemy.enemyType] ?? (enemy.tier === 'boss' ? 6 : enemy.tier === 'elite' ? 3 : 1);
  }

  function heatField(floorId) {
    const data = state.data;
    const key = `${state.key}|${floorId}`;
    if (heatCache.has(key)) return heatCache.get(key);
    const onFloor = entity => floorId === 'all' || entity.floorId === floorId;
    const enemies = (data.enemies || []).filter(enemy => enemy.center && onFloor(enemy));
    const rooms = (data.rooms || []).filter(room => room.points?.length >= 3 && onFloor(room))
      .map(room => ({ points: room.points, box: bboxOf(room) }));
    if (!enemies.length || !rooms.length) {
      heatCache.set(key, null);
      return null;
    }
    const lambda = data.meta?.pacing?.lambda || 5.5;
    const weight = heatWeights(data);
    const b = boundsOf(data, floorId);
    const cell = Math.max(.4, Math.max(b.maxX - b.minX, b.maxZ - b.minZ) / 180);
    const nx = Math.ceil((b.maxX - b.minX) / cell), nz = Math.ceil((b.maxZ - b.minZ) / cell);
    const values = new Float32Array(nx * nz).fill(-1);
    let max = 0;
    for (let j = 0; j < nz; j++) {
      const z = b.maxZ - (j + .5) * cell; // row 0 is the north edge (top of the image)
      for (let i = 0; i < nx; i++) {
        const x = b.minX + (i + .5) * cell;
        if (!rooms.some(room => x >= room.box.minX && x <= room.box.maxX && z >= room.box.minZ && z <= room.box.maxZ && pointInPoly([x, z], room.points))) continue;
        let p = 0;
        for (const enemy of enemies) p += weight(enemy) * Math.exp(-Math.hypot(x - enemy.center[0], z - enemy.center[1]) / lambda);
        values[j * nx + i] = p;
        if (p > max) max = p;
      }
    }
    const canvas = paintField(values, nx, nz, value => {
      const t = value < 0 ? 0 : value / (max || 1);
      return t < .04 ? null : rampColor(HEAT_STOPS, t, 255 * (.2 + .55 * t));
    });
    const field = { canvas, url: canvas.toDataURL(), bounds: { minX: b.minX, maxX: b.minX + nx * cell, minZ: b.maxZ - nz * cell, maxZ: b.maxZ }, max, cell };
    heatCache.set(key, field);
    return field;
  }

  // Colour a grid (row 0 = north) into a canvas; colorOf returns [r, g, b, a] or null.
  function paintField(values, nx, nz, colorOf) {
    const canvas = document.createElement('canvas');
    canvas.width = nx;
    canvas.height = nz;
    const context = canvas.getContext('2d');
    const image = context.createImageData(nx, nz);
    for (let k = 0; k < values.length; k++) {
      const rgba = colorOf(values[k]);
      if (rgba) image.data.set(rgba, k * 4);
    }
    context.putImageData(image, 0, 0);
    return canvas;
  }

  function rampColor(stops, t, alpha) {
    const f = Math.max(0, Math.min(.999, t)) * (stops.length - 1), lo = Math.floor(f), mix = f - lo;
    return [0, 1, 2].map(c => stops[lo][c] + (stops[lo + 1][c] - stops[lo][c]) * mix).concat(alpha);
  }

  /* Extraction distance: walking distance from every walkable spot to the nearest exit,
     per floor (map-geometry.js: rooms only connect through doors, solid objects block).
     Exits are auto-detected — exit-route end points, kind extract/exit, names like
     "E1 …" or containing 撤离点/撤离标记/出口 — and can be switched off in the side panel. */
  const EXIT_NAME = /(^|[\s·|])E\d+(?=$|[\s·|])|撤离点|撤离标记|出口/;
  const EXIT_KINDS = ['extract', 'extraction', 'exit'];
  const DIST_STOPS = [[96, 186, 152], [232, 220, 120], [222, 140, 76], [118, 64, 124]];
  const exitCache = new Map();

  function exitCandidates(data) {
    const list = [];
    for (const route of data.routes || []) {
      if (route.kind !== 'exit' || !route.points?.length) continue;
      const end = route.points[route.points.length - 1];
      list.push({ key: `route:${route.id}`, id: route.id, label: `${route.name || route.id} · 终点`, floorId: route.floorId, source: { point: [end[0], end[1]] }, why: '离场路线' });
    }
    const things = [...(data.rooms || []).map(e => ({ ...e, _type: 'room' })), ...(data.objects || []).map(e => ({ ...e, _type: 'object' }))];
    for (const entity of things) {
      if (!entity.points?.length || entity.kind === 'sign') continue;
      const byKind = EXIT_KINDS.includes(String(entity.kind || '').toLowerCase());
      if (!byKind && !EXIT_NAME.test(entity.name || '')) continue;
      list.push({ key: `${entity._type}:${entity.id}`, id: entity.id, label: entity.name || entity.id, floorId: entity.floorId, source: { points: entity.points }, why: byKind ? `kind ${entity.kind}` : '名称' });
    }
    return list;
  }

  const visibleFloorIds = () => (state.floor === 'all' ? (state.data.floors || []).map(floor => floor.id) : [state.floor]);
  const activeExits = () => exitCandidates(state.data).filter(candidate => !state.exitOff.has(candidate.key));

  /* Fields for every floor at once: stairs are portals, so a floor without an exit is
     still reachable through them. Each pass hands every stair the best distance at its
     footprint on one floor (+ stair length) as a seed for the other floor; repeat until
     nothing improves (distances only shrink, so this settles within a few passes). */
  function exitFields() {
    const data = state.data;
    const active = activeExits();
    const key = `${state.key}|${active.map(candidate => candidate.key).join(',')}`;
    if (exitCache.has(key)) return exitCache.get(key);
    const G = window.WorkbenchGeometry;
    const floorIds = (data.floors || []).length ? data.floors.map(floor => floor.id) : [undefined];
    const elevation = id => (data.floors || []).find(floor => floor.id === id)?.elevation || 0;
    const compute = (floorId, portals) => {
      const rooms = (data.rooms || []).filter(room => room.points?.length >= 3 && room.floorId === floorId);
      if (!rooms.length) return null;
      const b = boundsOf(data, floorId);
      const exits = active.filter(candidate => candidate.floorId === floorId);
      const field = G.distanceField({
        rooms,
        doors: (data.doors || []).filter(door => door.floorId === floorId),
        solids: (data.objects || []).filter(object => object.solid === true && object.floorId === floorId && object.points?.length >= 3),
        sources: [...exits.map(candidate => candidate.source), ...portals],
        bounds: b,
        cell: Math.max(.4, Math.max(b.maxX - b.minX, b.maxZ - b.minZ) / 180),
      });
      return Object.assign(field, { exits: exits.length, portals: portals.length });
    };
    let portals = new Map(), fields = new Map();
    for (let pass = 0; pass <= floorIds.length + 1; pass++) {
      fields = new Map(floorIds.map(floorId => [floorId, compute(floorId, portals.get(floorId) || [])]));
      const next = new Map();
      for (const stair of data.stairs || []) {
        if (!stair.points?.length) continue;
        const box = bboxOf(stair);
        const length = Math.max(box.maxX - box.minX, box.maxZ - box.minZ) + Math.abs(elevation(stair.toFloorId) - elevation(stair.fromFloorId));
        for (const [a, b] of [[stair.fromFloorId, stair.toFloorId], [stair.toFloorId, stair.fromFloorId]]) {
          const field = fields.get(a);
          const d = field ? G.minInPolygon(field, stair.points) : Infinity;
          if (d === Infinity || !fields.get(b)) continue;
          if (!next.has(b)) next.set(b, []);
          next.get(b).push({ points: stair.points, d: d + length });
        }
      }
      const signature = map => JSON.stringify([...map].map(([floorId, list]) => [floorId, list.map(item => Math.round(item.d * 10))]));
      if (signature(next) === signature(portals)) break;
      portals = next;
    }
    // One colour scale across floors so the same colour means the same distance everywhere.
    const globalMax = Math.max(1, ...[...fields.values()].filter(Boolean).map(field => field.max));
    for (const field of fields.values()) {
      if (!field) continue;
      field.canvas = paintField(field.dist, field.nx, field.nz, value => {
        if (value < 0) return null;
        if (value === Infinity) return [140, 140, 140, 165];
        return rampColor(DIST_STOPS, value / globalMax, 150);
      });
      field.url = field.canvas.toDataURL();
    }
    exitCache.set(key, fields);
    return fields;
  }

  const exitField = floorId => exitFields().get(floorId) || null;

  function renderExitPanel() {
    const panel = $('exitPanel');
    panel.hidden = !state.layers.exits || !state.data;
    if (panel.hidden) return;
    const candidates = exitCandidates(state.data);
    const walk = Number(state.data.meta?.player?.walkSpeed) > 0 ? Number(state.data.meta.player.walkSpeed) : 4;
    let html = `<h3>撤离点（${candidates.length - candidates.filter(c => state.exitOff.has(c.key)).length}/${candidates.length}）</h3>`;
    html += candidates.map(candidate => `<label><input type="checkbox" data-exit="${esc(candidate.key)}" ${state.exitOff.has(candidate.key) ? '' : 'checked'}><button type="button" data-exit-locate="${esc(candidate.id)}" title="${esc(candidate.label)}">${esc(candidate.label)}</button><small>${esc(candidate.why)}</small></label>`).join('');
    if (!candidates.length) html += '<p>没识别到出口。在地图里给撤离点写 <code>objects[].kind: "extract"</code>，或加 <code>kind: "exit"</code> 的路线。</p>';
    const lines = visibleFloorIds().map(floorId => {
      const field = exitField(floorId);
      if (!field) return '';
      const share = field.walkable ? Math.round(field.unreachable / field.walkable * 100) : 0;
      const name = (state.data.floors || []).length > 1 ? `${floorName(floorId)}：` : '';
      if (!field.exits && !field.portals) return `<p>${esc(name)}本层没有出口，也没有楼梯通到能撤离的楼层。</p>`;
      return `<p>${esc(name)}最远 ${num(field.max)} m（≈ ${Math.round(field.max / walk)} s，步速 ${num(walk)} m/s）${share ? ` · <b style="color:var(--danger)">${share}% 可走区域到不了出口</b>` : ''}</p>`;
    }).join('');
    panel.innerHTML = html + lines;
  }

  // Readout under the cursor while the distance layer is on.
  function showDistanceTip(event) {
    const tip = $('mapTip');
    if (!state.layers.exits || state.mode !== '2d' || state.drag?.moved) {
      tip.hidden = true;
      return;
    }
    const local = new DOMPoint(event.clientX, event.clientY).matrixTransform($('map').getScreenCTM().inverse());
    const [x, z] = [local.x, -local.y];
    let d = null;
    for (const floorId of visibleFloorIds()) {
      const field = exitField(floorId);
      const value = field ? window.WorkbenchGeometry.sampleField(field, x, z) : null;
      if (value !== null) { d = value; break; }
    }
    if (d === null) {
      tip.hidden = true;
      return;
    }
    const walk = Number(state.data.meta?.player?.walkSpeed) > 0 ? Number(state.data.meta.player.walkSpeed) : 4;
    tip.textContent = d === Infinity ? '到不了任何出口（检查门或出口）' : `到最近出口 ${num(d)} m · 约 ${Math.round(d / walk)} s`;
    const rect = $('canvasWrap').getBoundingClientRect();
    tip.style.left = `${Math.min(rect.width - 190, event.clientX - rect.left + 14)}px`;
    tip.style.top = `${event.clientY - rect.top + 14}px`;
    tip.hidden = false;
  }

  /* Pacing chart ↔ map. Hovering the chart marks that point of the main route on the
     2D map and in 3D (with the aggro ring and the enemies inside it); clicking moves
     the view there. Samples come from viewer-pacing.js, so this matches the curve. */
  // Elevation along main(+exit) route by distance, so the 3D marker sits on the right floor.
  function routeProfile(data) {
    const elevation = id => (data.floors || []).find(floor => floor.id === id)?.elevation || 0;
    const main = (data.routes || []).find(route => route.kind === 'main') || (data.routes || [])[0];
    const exit = (data.routes || []).find(route => route.kind === 'exit');
    if (!main?.points) return [];
    const points = [
      ...main.points.map(p => [p[0], p[1], Number.isFinite(p[2]) ? p[2] : elevation(main.floorId)]),
      ...(exit ? exit.points.slice(1).map(p => [p[0], p[1], Number.isFinite(p[2]) ? p[2] : elevation(exit.floorId)]) : []),
    ];
    let s = 0;
    return points.map((p, index) => {
      if (index) s += Math.hypot(p[0] - points[index - 1][0], p[1] - points[index - 1][1]);
      return { s, y: p[2] };
    });
  }

  function elevationAt(profile, s) {
    if (!profile.length) return 0;
    for (let i = 1; i < profile.length; i++) {
      if (s <= profile[i].s) {
        const a = profile[i - 1], b = profile[i];
        return a.y + (b.y - a.y) * ((s - a.s) / Math.max(1e-6, b.s - a.s));
      }
    }
    return profile[profile.length - 1].y;
  }

  function paceSampleAt(clientX, clientY) {
    const chart = $('pacingChart');
    const pace = state.pacing;
    if (!pace || !chart.getScreenCTM()) return null;
    const local = new DOMPoint(clientX, clientY).matrixTransform(chart.getScreenCTM().inverse());
    const s = Math.max(0, Math.min(pace.m.L, (local.x - pace.padL) / pace.pw * pace.m.L));
    let best = pace.m.samples[0];
    for (const sample of pace.m.samples) if (Math.abs(sample.s - s) < Math.abs(best.s - s)) best = sample;
    return best;
  }

  function setPaceCursor(sample) {
    const pace = state.pacing;
    state.paceCursor = sample && pace ? { ...sample, y: elevationAt(pace.profile, sample.s) } : null;
    const hover = $('paceHover');
    $('pacingChart').classList.toggle('hovering', !!state.paceCursor);
    if (hover) {
      const c = state.paceCursor;
      if (!c) hover.innerHTML = '';
      else {
        const x = pace.X(c.s), y = pace.Y(c.p);
        const room = c.room ? (state.data.rooms || []).find(item => item.id === c.room) : null;
        const text = `${c.s.toFixed(0)} m · 压力 ${c.p.toFixed(2)} · ${pace.aggro}m 内 ${c.n} 敌${room ? ` · ${room.short || room.name}` : ''}`;
        const tx = x > pace.W - 230 ? x - 8 : x + 8;
        hover.innerHTML = `<line x1="${x.toFixed(1)}" y1="${pace.padT}" x2="${x.toFixed(1)}" y2="${pace.H - pace.padB}" stroke="#2f403b" stroke-width="1" stroke-dasharray="3 3"/>`
          + `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4" fill="#2d7c78" stroke="#fff" stroke-width="1.5"/>`
          + `<text x="${tx.toFixed(1)}" y="${pace.padT + 10}" font-size="10.5" fill="#2f403b" text-anchor="${tx < x ? 'end' : 'start'}" class="wb-pace-label">${esc(text)}</text>`;
      }
    }
    paintPaceCursor();
    view3d?.setCursor(state.paceCursor ? [state.paceCursor.x, state.paceCursor.z, state.paceCursor.y] : null, pace?.aggro || 8);
  }

  // 2D marker; redrawn after every render() because render replaces the SVG contents.
  function paintPaceCursor() {
    const svg = $('map');
    svg.querySelector('#wbPaceCursor')?.remove();
    const c = state.paceCursor;
    if (!c || !state.data) return;
    const aggro = state.pacing?.aggro || 8;
    const near = (state.data.enemies || []).filter(enemy => enemy.branch !== 'optional' && enemy.center && floorMatches(enemy)
      && Math.hypot(enemy.center[0] - c.x, enemy.center[1] - c.z) <= aggro);
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.id = 'wbPaceCursor';
    g.setAttribute('pointer-events', 'none');
    g.innerHTML = `<circle class="wb-pace-ring" cx="${c.x}" cy="${-c.z}" r="${aggro}"/>`
      + near.map(enemy => `<circle class="wb-pace-enemy" cx="${enemy.center[0]}" cy="${-enemy.center[1]}" r="1.1"/>`).join('')
      + `<circle class="wb-pace-dot" cx="${c.x}" cy="${-c.z}" r="${(labelSize() * .45).toFixed(2)}"/>`;
    svg.appendChild(g);
  }

  // Click on the chart: bring that route point to the middle of the 2D map / 3D view.
  function centerOnPace() {
    const c = state.paceCursor;
    if (!c) return;
    if (state.mode === '3d') {
      view3d?.lookAt([c.x, c.z, c.y]);
      return;
    }
    state.view.x = c.x - state.view.w / 2;
    state.view.y = -c.z - state.view.h / 2;
    applyView();
  }

  function renderMapList() {
    const keys = Object.keys(maps);
    $('mapCount').textContent = `${keys.length} 张`;
    $('mapList').innerHTML = keys.map(key => {
      const data = maps[key];
      const rooms = data.rooms?.length || 0;
      const enemies = data.enemies?.length || 0;
      const fullTitle = data.meta?.title || key;
      const shortTitle = fullTitle.replace(/^AFTER THE 9\s*·\s*/i, '');
      return `<button type="button" data-map="${esc(key)}" class="${key === state.key ? 'active' : ''}" title="${esc(fullTitle)}"><b>${esc(shortTitle)}</b><small>${rooms} 房 · ${enemies} 敌</small></button>`;
    }).join('');
    $('mapList').querySelectorAll('[data-map]').forEach(button => {
      button.onclick = () => loadMap(button.dataset.map);
    });
  }

  function renderLayers() {
    $('layerList').innerHTML = LAYERS.map(([key, label]) => `<label><input type="checkbox" data-layer="${key}" ${state.layers[key] ? 'checked' : ''}>${label}</label>`).join('');
    $('layerList').querySelectorAll('input').forEach(input => {
      input.onchange = () => {
        state.layers[input.dataset.layer] = input.checked;
        render();
        renderExitPanel();
        if (!state.layers.exits) $('mapTip').hidden = true;
      };
    });
  }

  function renderFloors() {
    const floors = state.data?.floors || [];
    const options = [{ id: 'all', name: '全部' }, ...floors];
    $('floorBar').innerHTML = options.map(floor => `<button type="button" data-floor="${esc(floor.id)}" class="${state.floor === floor.id ? 'active' : ''}" aria-pressed="${state.floor === floor.id}">${esc(floor.name || floor.id)}</button>`).join('');
    $('floorBar').querySelectorAll('[data-floor]').forEach(button => {
      button.onclick = () => {
        state.floor = button.dataset.floor;
        renderFloors();
        renderLevels();
        fit();
      };
    });
  }

  function typeLabel(type) {
    return ({ room: '房间', object: '物件', enemy: '敌人', door: '门', route: '路线', stairs: '楼梯', water: '水面' })[type] || type;
  }

  function inspect(id) {
    const entity = id ? indexData(state.data).get(id) : null;
    if (!entity) {
      $('inspector').innerHTML = '<p class="wb-hint">点击地图上的房间、物件、敌人、路线或门查看详情。</p>';
      return;
    }
    const pairs = [
      ['类型', typeLabel(entity._type)],
      ['ID', entity.id],
      ['楼层', floorName(entity.floorId)],
    ];
    const add = (key, value) => { if (value !== undefined && value !== null && value !== '') pairs.push([key, value]); };
    add('状态', ({existing:'已落地', planned:'设计预设', annotation:'示意标注'})[entity.status] || entity.status);
    if (entity._type === 'room') {
      add('节拍', entity.beat);
      add('面积', `${(entity.area || areaOf(entity.points || [])).toFixed(1)} m²`);
      if (entity.wallHeight !== undefined) add('墙高', entity.wallHeight === 0 ? '0（开放/露天）' : `${num(entity.wallHeight)} m`);
      add('敌人', `${(state.data.enemies || []).filter(e => e.roomId === entity.id).length} 个`);
      add('物件', `${(state.data.objects || []).filter(o => o.floorId === entity.floorId && o.points && pointInPoly(centerOf(o), entity.points)).length} 个`);
      add('职责', entity.role);
      add('预设', entity.preset);
      add('动线', entity.flow);
      add('备注', entity.note);
    } else if (entity._type === 'enemy') {
      add('类型', entity.enemyType);
      add('等级', entity.tier);
      add('分支', entity.branch === 'optional' ? '可选' : '主线');
      add('房间', state.data.rooms?.find(room => room.id === entity.roomId)?.name || entity.roomId);
      add('生命', entity.hp);
      add('移速', entity.speed ? `${entity.speed} m/s` : '');
      add('机制', entity.mechanic);
      add('备注', entity.note);
    } else if (entity._type === 'route') {
      add('路线', entity.kind);
      add('长度', `${(entity.length || routeLength(entity.points || [])).toFixed(1)} m`);
      add('点数', `${(entity.points || []).length}`);
      const heights = (entity.points || []).filter(p => Number.isFinite(p[2])).map(p => p[2]);
      if (heights.length) add('标高', `${num(Math.min(...heights))} → ${num(Math.max(...heights))} m（跨层）`);
      add('备注', entity.note);
    } else if (entity._type === 'door') {
      add('宽度', `${num(entity.width)} m${playerRadius() > 0 ? ` · 玩家直径 ${num(playerRadius() * 2)} m` : ''}`);
      add('备注', entity.note);
    } else if (entity._type === 'stairs') {
      add('连接', `${floorName(entity.fromFloorId)} → ${floorName(entity.toFloorId)}`);
      add('方向', entity.direction === 'down' ? '下行' : '上行');
      add('低端', ({ N: '北侧', S: '南侧', E: '东侧', W: '西侧' })[entity.bottom] || (entity.bottom ? entity.bottom : '未标注（3D 推测）'));
      add('备注', entity.note);
    } else if (entity._type === 'water') {
      add('水面', entity.kind || 'water');
      add('备注', entity.note);
    } else if (entity._type === 'object') {
      add('物件', entity.kind);
      add('阻挡', entity.solid ? '是' : '否');
      add('备注', entity.note);
      add('素材', (entity.assets || []).join('、'));
    }
    const change = state.compare ? diffItems().find(item => item.id === entity.id) : null;
    if (change?.kind === 'added') pairs.push(['对比', '新增（基准里没有）']);
    if (change?.kind === 'changed') pairs.push(['对比', [change.moved ? (change.shift > .2 ? `移动 ${num(change.shift)} m` : '形状改变') : '', change.fields.length ? `字段：${change.fields.join('、')}` : ''].filter(Boolean).join('；')]);
    const issues = issuesFor(entity.id);
    const issueHtml = issues.length ? `<ul class="wb-inspector-issues">${issues.map(item => `<li class="${item.level}">${esc(item.msg)}</li>`).join('')}</ul>` : '';
    $('inspector').innerHTML = `<span class="type">${esc(typeLabel(entity._type))}</span><h3>${esc(entity.name || entity.id)}</h3>${issueHtml}<dl class="wb-kv">${pairs.map(([key, value]) => `<dt>${esc(key)}</dt><dd>${esc(value)}</dd>`).join('')}</dl>`;
  }

  function select(id) {
    state.selected = id;
    render();
    inspect(id);
    const url = new URL(location.href);
    const params = new URLSearchParams(url.hash.replace(/^#/, ''));
    params.set('map', state.key || '');
    if (id) params.set('id', id); else params.delete('id');
    history.replaceState(null, '', `#${params.toString()}`);
    $('live').textContent = id ? `已选择 ${indexData(state.data).get(id)?.name || id}` : '已清除选择';
    syncOutline();
  }

  /* Outline: floors › rooms › what sits in each room, plus doors/routes/stairs/water.
     Typing in the search box flattens it to matches. Clicking an entry locates it. */
  const OUTLINE_LIMIT = 300;
  const outlineTag = entity => ({ room: entity.kind || '房间', object: entity.kind || '物件', enemy: entity.enemyType || entity.tier || '敌人', door: '门', route: entity.kind || '路线', stairs: '楼梯', water: entity.kind || '水面' })[entity._type];

  function outlineItem(entity, depth = 0) {
    return `<button type="button" class="wb-ol-item wb-ol-${entity._type}" data-outline-id="${esc(entity.id)}" style="--depth:${depth}" title="${esc(entity.id)}"><i></i><span>${esc(entity.name || entity.id)}</span><small>${esc(outlineTag(entity))}</small></button>`;
  }

  function outlineGroup(title, items, { open = false, id = null, depth = 0, count = items.length } = {}) {
    if (!items.length && !id) return '';
    const head = id
      ? `<summary class="wb-ol-item wb-ol-room" data-outline-id="${esc(id)}" style="--depth:${depth}"><i></i><span>${esc(title)}</span><small>${count}</small></summary>`
      : `<summary class="wb-ol-group" style="--depth:${depth}"><span>${esc(title)}</span><small>${count}</small></summary>`;
    return `<details${open ? ' open' : ''}${id ? ` data-room="${esc(id)}"` : ''}>${head}${items.join('')}</details>`;
  }

  function renderOutline() {
    const data = state.data;
    if (!data) return;
    const entities = allEntities(data);
    const query = (state.outlineQuery || '').trim().toLowerCase();
    $('outlineCount').textContent = `${entities.length} 项`;
    if (query) {
      const hits = entities.filter(entity => [entity.name, entity.id, entity.kind, entity.enemyType, entity.tier, typeLabel(entity._type)]
        .some(value => String(value ?? '').toLowerCase().includes(query)));
      $('outline').innerHTML = hits.length
        ? hits.slice(0, OUTLINE_LIMIT).map(entity => outlineItem(entity)).join('') + (hits.length > OUTLINE_LIMIT ? `<p class="wb-hint">还有 ${hits.length - OUTLINE_LIMIT} 项，请缩小搜索</p>` : '')
        : '<p class="wb-hint">没有匹配的对象</p>';
      $('outlineCount').textContent = `${hits.length} / ${entities.length}`;
      syncOutline();
      return;
    }
    const floors = data.floors?.length ? data.floors : [{ id: undefined, name: '未分层' }];
    const byType = type => entities.filter(entity => entity._type === type);
    const rooms = byType('room'), objects = byType('object'), enemies = byType('enemy');
    let html = '';
    for (const floor of floors) {
      const onFloor = entity => entity.floorId === floor.id;
      const floorRooms = rooms.filter(onFloor);
      const placed = new Set();
      const roomBlocks = floorRooms.map(room => {
        const inside = [
          ...enemies.filter(enemy => enemy.roomId === room.id),
          ...objects.filter(object => onFloor(object) && object.points?.length && pointInPoly(centerOf(object), room.points || [])),
        ].filter(entity => !placed.has(entity.id));
        inside.forEach(entity => placed.add(entity.id));
        return outlineGroup(room.name || room.id, inside.map(entity => outlineItem(entity, 2)), { id: room.id, depth: 1, count: inside.length });
      });
      const loose = [...enemies, ...objects].filter(entity => onFloor(entity) && !placed.has(entity.id));
      const extras = [
        outlineGroup('房间外', loose.map(entity => outlineItem(entity, 2)), { depth: 1 }),
        outlineGroup('门', byType('door').filter(onFloor).map(entity => outlineItem(entity, 2)), { depth: 1 }),
        outlineGroup('路线', byType('route').filter(onFloor).map(entity => outlineItem(entity, 2)), { depth: 1 }),
        outlineGroup('水面', byType('water').filter(onFloor).map(entity => outlineItem(entity, 2)), { depth: 1 }),
      ];
      const open = floors.length <= 2 || state.floor === floor.id;
      html += outlineGroup(floor.name || floor.id || '未分层', [...roomBlocks, ...extras], { open, count: entities.filter(onFloor).length });
    }
    html += outlineGroup('楼梯（跨层）', byType('stairs').map(entity => outlineItem(entity, 1)));
    $('outline').innerHTML = html;
    syncOutline();
  }

  // Mark the selected entry, open its parents and keep it in view.
  function syncOutline() {
    const root = $('outline');
    if (!root) return;
    root.querySelectorAll('.wb-ol-item.active').forEach(element => element.classList.remove('active'));
    if (!state.selected) return;
    const item = [...root.querySelectorAll('[data-outline-id]')].find(element => element.dataset.outlineId === state.selected);
    if (!item) return;
    item.classList.add('active');
    for (let parent = item.parentElement; parent && parent !== root; parent = parent.parentElement) {
      if (parent.tagName === 'DETAILS' && !(item.tagName === 'SUMMARY' && parent === item.parentElement)) parent.open = true;
    }
    const top = item.offsetTop - root.offsetTop, bottom = top + item.offsetHeight;
    if (top < root.scrollTop || bottom > root.scrollTop + root.clientHeight) root.scrollTop = top - root.clientHeight / 3;
  }

  // Show an entity wherever it is: switch to its floor, frame it in 2D (and 3D), select it.
  function locate(id) {
    const entity = state.data ? indexData(state.data).get(id) : null;
    if (!entity) return;
    if (!floorMatches(entity)) {
      state.floor = entity.floorId || entity.fromFloorId || 'all';
      renderFloors();
      renderLevels();
    }
    const box = bboxOf(entity);
    if (box) {
      const size = Math.max(box.maxX - box.minX, box.maxZ - box.minZ, 1);
      // Frame the entity with some margin; small things get at least a 24 m wide view.
      const want = Math.max(size * 1.5, 24);
      if (state.view.w > want * 2 || state.view.w < size * 1.2) {
        const scale = want / state.view.w;
        state.view.w *= scale;
        state.view.h *= scale;
      }
      state.view.x = (box.minX + box.maxX) / 2 - state.view.w / 2;
      state.view.y = -(box.minZ + box.maxZ) / 2 - state.view.h / 2;
      applyView();
    }
    select(id);
    if (state.mode === '3d') view3d?.focus(id);
  }

  function pointInPoly(point, points) {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const [xi, zi] = points[i], [xj, zj] = points[j];
      if (((zi > point[1]) !== (zj > point[1])) && (point[0] < (xj - xi) * (point[1] - zi) / ((zj - zi) || 1e-9) + xi)) inside = !inside;
    }
    return inside;
  }

  function renderHealth() {
    const result = state.validation || { errors: [], warnings: [], stats: {} };
    const badge = $('healthBadge');
    badge.textContent = result.errors.length ? `${result.errors.length} 错误` : result.warnings.length ? `通过 · ${result.warnings.length} 告警` : '通过';
    badge.style.color = result.errors.length ? 'var(--danger)' : result.warnings.length ? 'var(--amber)' : 'var(--teal)';
    // Same rules/codes as tools/validate_ai_map.py; issues naming an entity are clickable.
    const issue = item => (item.id && state.data && indexData(state.data).has(item.id)
      ? `<button type="button" data-issue-id="${esc(item.id)}" title="${esc(item.code)}">${esc(item.msg)}</button>`
      : `<div title="${esc(item.code)}">${esc(item.msg)}</div>`);
    let html = '';
    if (!result.errors.length) html += '<div class="wb-health-ok">结构校验通过</div>';
    if (result.errors.length) html += `<div class="wb-health-errors">${result.errors.slice(0, 30).map(issue).join('')}</div>`;
    if (result.warnings.length) html += `<details class="wb-health-warnings"${result.warnings.length <= 6 ? ' open' : ''}><summary>${result.warnings.length} 条告警</summary>${result.warnings.slice(0, 60).map(issue).join('')}</details>`;
    html += `<ul><li>${result.stats.rooms} 房间 · ${result.stats.objects} 物件</li><li>${result.stats.enemies} 敌人 · ${result.stats.routes} 路线</li><li>${result.stats.doors} 门 · ${result.stats.stairs} 楼梯 · ${result.stats.water} 水面</li></ul>`;
    $('health').innerHTML = html;
  }

  function renderInfo() {
    const data = state.data;
    if (!data) return;
    const b = boundsOf(data);
    $('mapInfo').innerHTML = `<b>${esc(data.meta?.title || '未命名')}</b><br>${esc(data.meta?.subtitle || '')}<br>${esc(data.meta?.provenance?.label || '无来源')}<br>${num(b.maxX - b.minX)}×${num(b.maxZ - b.minZ)} m · ${data.floors?.length || 0} 层`;
  }

  function loadMap(key, external) {
    const data = external || maps[key];
    if (!data) return;
    if (external && !maps[key]) maps[key] = external;
    state.key = key;
    state.data = data;
    state.validation = validate(data);
    state.floor = 'all';
    state.selected = null;
    state.layers = { ...DEFAULT_LAYERS };
    renderMapList();
    renderLayers();
    renderFloors();
    renderHealth();
    renderInfo();
    renderMapHead();
    renderSummary();
    renderLevels();
    renderDesignNotes();
    renderPacing();
    renderOutline();
    state.exitOff = new Set();
    renderExitPanel();
    if (state.compare?.key === key) state.compare = null;
    renderCompareSelect();
    renderDiffPanel();
    state.measure = { points: [], hover: null, done: false, closed: false };
    closeNoteEditor();
    renderNotes();
    inspect(null);
    fit();
    $('empty').hidden = true;
    const params = new URLSearchParams(location.hash.replace(/^#/, ''));
    if (params.get('map') !== key) params.delete('id');
    params.set('map', key);
    history.replaceState(null, '', `${location.pathname}${location.search}#${params}`);
    if (params.get('id')) select(params.get('id'));
  }

  function loadImportedData(data) {
    const result = validate(data);
    if (result.errors.length) {
      toast(`导入失败：${result.errors[0].msg}${result.errors.length > 1 ? `（共 ${result.errors.length} 个错误）` : ''}`);
      return false;
    }
    const key = `imported-${Date.now()}`;
    maps[key] = data;
    state.validation = result;
    loadMap(key, data);
    toast('已导入地图');
    return true;
  }

  function importFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        loadImportedData(JSON.parse(String(reader.result)));
      } catch (error) {
        toast(`JSON 解析失败：${error.message}`);
      }
    };
    reader.readAsText(file);
  }

  function exportSvg() {
    if (!state.data) return;
    const clone = $('map').cloneNode(true);
    clone.querySelectorAll('.wb-selection, #wbPaceCursor').forEach(element => element.remove());
    const b = boundsOf(state.data, state.floor);
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('width', '1600');
    clone.setAttribute('height', '1000');
    clone.setAttribute('viewBox', `${state.view.x} ${state.view.y} ${state.view.w} ${state.view.h}`);
    const background = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    background.setAttribute('x', String(b.minX - 2));
    background.setAttribute('y', String(-b.maxZ - 2));
    background.setAttribute('width', String(b.maxX - b.minX + 4));
    background.setAttribute('height', String(b.maxZ - b.minZ + 4));
    background.setAttribute('fill', '#f6f1e5');
    clone.insertBefore(background, clone.firstChild);
    const blob = new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(state.data.meta?.title || 'map').replace(/[\\/:*?"<>|]/g, '-')}.svg`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast('SVG 已导出');
  }

  function setPacingCollapsed(collapsed) {
    const panel = $('pacingPanel');
    const button = $('pacingToggle');
    panel.classList.toggle('collapsed', collapsed);
    button.textContent = collapsed ? '展开' : '收起';
    button.setAttribute('aria-expanded', String(!collapsed));
  }

  function bind() {
    $('pacingToggle').onclick = () => setPacingCollapsed(!$('pacingPanel').classList.contains('collapsed'));
    if (window.innerHeight < 860) setPacingCollapsed(true);
    $('fitBtn').onclick = () => (state.mode === '3d' ? view3d.fit() : fit());
    $('zoomIn').onclick = () => (state.mode === '3d' ? view3d.zoom(.8) : zoomAt(0.8, $('map').getBoundingClientRect().left + $('map').clientWidth / 2, $('map').getBoundingClientRect().top + $('map').clientHeight / 2));
    $('zoomOut').onclick = () => (state.mode === '3d' ? view3d.zoom(1.25) : zoomAt(1.25, $('map').getBoundingClientRect().left + $('map').clientWidth / 2, $('map').getBoundingClientRect().top + $('map').clientHeight / 2));
    $('view2dBtn').onclick = () => view3d.setMode('2d');
    $('styleSchemaBtn').onclick = () => setStyle('schema');
    $('stylePlanBtn').onclick = () => setStyle('plan');
    $('view3dBtn').onclick = () => { setTool(null); view3d.setMode('3d'); };
    $('health').addEventListener('click', event => {
      const id = event.target.closest('[data-issue-id]')?.dataset.issueId;
      if (id) locate(id);
    });
    $('outline').addEventListener('click', event => {
      const item = event.target.closest('[data-outline-id]');
      if (!item) return;
      // A room row toggles its children only when clicked again while already selected.
      if (item.tagName === 'SUMMARY' && state.selected !== item.dataset.outlineId) {
        event.preventDefault();
        item.parentElement.open = true;
      }
      locate(item.dataset.outlineId);
    });
    $('pacingChart').addEventListener('pointermove', event => setPaceCursor(paceSampleAt(event.clientX, event.clientY)));
    $('pacingChart').addEventListener('pointerleave', () => setPaceCursor(null));
    $('pacingChart').addEventListener('click', event => {
      setPaceCursor(paceSampleAt(event.clientX, event.clientY));
      centerOnPace();
    });
    $('compareSelect').addEventListener('change', event => {
      const key = event.target.value;
      if (key === '__file') return;
      setCompare(key ? maps[key] : null, key || null);
    });
    $('compareFile').onchange = event => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          setCompare(JSON.parse(String(reader.result)), `file:${file.name}`);
          toast(`对比基准：${file.name}`);
        } catch (error) {
          toast(`JSON 解析失败：${error.message}`);
        }
      };
      reader.readAsText(file);
    };
    $('diffPanel').addEventListener('click', event => {
      const button = event.target.closest('[data-diff-id]');
      if (!button) return;
      if (button.dataset.diffKind === 'removed') showRemoved(button.dataset.diffId);
      else locate(button.dataset.diffId);
    });
    $('exitPanel').addEventListener('change', event => {
      const key = event.target.dataset.exit;
      if (!key) return;
      if (event.target.checked) state.exitOff.delete(key); else state.exitOff.add(key);
      render();
      renderExitPanel();
    });
    $('exitPanel').addEventListener('click', event => {
      const id = event.target.closest('[data-exit-locate]')?.dataset.exitLocate;
      if (id) locate(id);
    });
    $('map').addEventListener('pointermove', showDistanceTip);
    $('map').addEventListener('pointerleave', () => { $('mapTip').hidden = true; });
    $('outlineSearch').addEventListener('input', event => {
      state.outlineQuery = event.target.value;
      renderOutline();
    });
    $('outlineSearch').addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.target.value = '';
        state.outlineQuery = '';
        renderOutline();
      }
      if (event.key === 'Enter') $('outline').querySelector('[data-outline-id]')?.click();
    });
    $('clearBtn').onclick = () => select(null);
    $('exportBtn').onclick = exportSvg;
    $('fileInput').onchange = event => { if (event.target.files?.[0]) importFile(event.target.files[0]); event.target.value = ''; };
    $('pasteBtn').onclick = () => {
      try {
        if (loadImportedData(JSON.parse($('pasteInput').value))) $('pasteInput').value = '';
      } catch (error) {
        toast(`JSON 解析失败：${error.message}`);
      }
    };
    window.addEventListener('resize', () => { if (state.data) render(); });
    const svg = $('map');
    svg.addEventListener('wheel', event => {
      event.preventDefault();
      zoomAt(event.deltaY > 0 ? 1.12 : 0.89, event.clientX, event.clientY);
    }, { passive: false });
    svg.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      svg.setPointerCapture(event.pointerId);
      state.drag = { x: event.clientX, y: event.clientY, ox: state.view.x, oy: state.view.y, moved: false, target: event.target.closest('[data-id]')?.dataset.id || null };
      svg.classList.add('dragging');
    });
    svg.addEventListener('pointermove', event => {
      if (!state.drag) return;
      const dx = event.clientX - state.drag.x;
      const dy = event.clientY - state.drag.y;
      if (Math.hypot(dx, dy) > 4) state.drag.moved = true;
      if (state.drag.moved) {
        state.view.x = state.drag.ox - dx / Math.max(1, svg.clientWidth) * state.view.w;
        state.view.y = state.drag.oy - dy / Math.max(1, svg.clientHeight) * state.view.h;
        svg.setAttribute('viewBox', `${state.view.x} ${state.view.y} ${state.view.w} ${state.view.h}`);
      }
    });
    svg.addEventListener('pointerup', event => {
      if (state.drag && !state.drag.moved) {
        if (state.tool === 'measure') measureClick(event);
        else if (state.tool === 'note') noteClick(event, state.drag.target);
        else select(state.drag.target);
      }
      state.drag = null;
      svg.classList.remove('dragging');
    });
    svg.addEventListener('pointercancel', () => { state.drag = null; svg.classList.remove('dragging'); });
    svg.addEventListener('pointermove', event => {
      if (state.tool !== 'measure' || state.measure.done || !state.measure.points.length || state.drag?.moved) return;
      state.measure.hover = planPoint(event);
      paintTools();
    });
    svg.addEventListener('dblclick', event => {
      if (state.tool !== 'measure') return;
      event.preventDefault();
      // The double click already added its second point; drop the duplicate.
      const pts = state.measure.points;
      if (pts.length > 2 && Math.hypot(pts.at(-1)[0] - pts.at(-2)[0], pts.at(-1)[1] - pts.at(-2)[1]) < labelSize() * .3) pts.pop();
      finishMeasure();
    });
    $('measureBtn').onclick = () => setTool('measure');
    $('noteBtn').onclick = () => setTool('note');
    $('statsBtn').onclick = () => toggleStats();
    $('noteSave').onclick = saveNote;
    $('noteCancel').onclick = closeNoteEditor;
    $('noteText').addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); saveNote(); }
      if (event.key === 'Escape') { event.preventDefault(); closeNoteEditor(); }
    });
    $('notesList').addEventListener('click', event => {
      const remove = event.target.closest('[data-note-remove]');
      if (remove) {
        event.stopPropagation();
        const list = sessionNotes();
        list.splice(list.findIndex(note => note.id === remove.dataset.noteRemove), 1);
        saveNotes();
        return;
      }
      const item = event.target.closest('[data-note-id]');
      if (item) showNote(item.dataset.noteId);
    });
    $('notesExport').onclick = exportNotes;
    $('notesCopy').onclick = copyNotes;
    $('notesClear').onclick = () => {
      if (!sessionNotes().length || !window.confirm(`清空这张图的 ${sessionNotes().length} 条批注？`)) return;
      sessionNotes().length = 0;
      saveNotes();
    };
    $('statsPanel').addEventListener('click', event => {
      if (event.target === $('statsPanel') || event.target.closest('[data-close-modal]')) toggleStats(false);
      const sort = event.target.closest('[data-sort]')?.dataset.sort;
      if (sort) {
        state.statsSort = { key: sort, dir: state.statsSort.key === sort ? -state.statsSort.dir : (sort === 'name' || sort === 'floor' ? 1 : -1) };
        renderStats();
        return;
      }
      const row = event.target.closest('[data-room]');
      if (row) { toggleStats(false); locate(row.dataset.room); }
    });
    svg.addEventListener('keydown', event => {
      const step = state.view.w * .06;
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
        event.preventDefault();
        if (event.key === 'ArrowLeft') state.view.x -= step;
        if (event.key === 'ArrowRight') state.view.x += step;
        if (event.key === 'ArrowUp') state.view.y -= step;
        if (event.key === 'ArrowDown') state.view.y += step;
        applyView();
      }
      if (event.key === 'Escape') select(null);
    });
  }

  function init() {
    if (!Object.keys(maps).length) {
      toast('没有示例地图');
      return;
    }
    view3d = window.WorkbenchView3D({
      state, $, toast, select, applyView, renderMapMeta,
      boundsOf, bboxOf, centerOf, areaOf, pointInPoly, floorMatches, heatField, exitField,
      exitKey: () => [...state.exitOff].sort().join(','),
      theme: () => document.documentElement.dataset.theme || 'light',
      entityById: id => (state.data ? indexData(state.data).get(id) : null),
    });
    const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
    setTheme(stored.get('wb-theme') || 'light');
    if (stored.get('wb-hide-left')) togglePanel('left', true);
    if (stored.get('wb-hide-right')) togglePanel('right', true);
    renderMapList();
    renderLayers();
    bind();
    bindShell();
    const params = new URLSearchParams(location.hash.replace(/^#/, ''));
    const key = params.get('map') && maps[params.get('map')] ? params.get('map') : 'ai-sample';
    loadMap(key);
    applyHashState(params);
    window.__workbench = {
      get state() { return state; },
      get maps() { return maps; },
      loadMap,
      validate,
      select,
      fit,
      setMode: view3d.setMode,
      view3d: view3d.debug,
    };
    if (params.get('style') === 'plan') setStyle('plan');
    if (params.get('cmp') && maps[params.get('cmp')]) setCompare(maps[params.get('cmp')], params.get('cmp'));
    if (params.get('view') === '3d') {
      view3d.setMode('3d').then(() => { if (params.get('pose')) view3d.setPose(params.get('pose')); });
    }
  }

  init();
})();
