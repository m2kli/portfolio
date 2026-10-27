/* 3D massing view for the workbench.
   Rebuilt from the same AI_MAP_SPEC data (no second model): floor plates at
   floors[].elevation, walls from room edges (merged per line, door openings cut,
   rooms[].wallHeight 0 = open), objects extruded by objects[].height (or a per-kind
   estimate), stairs as steps between fromFloorId/toFloorId (stairs[].bottom picks the
   low end), routes may climb via [x,z,y] points. Read-only, never exported; if WebGL
   or three.js is unavailable the workbench stays in 2D.
   workbench.js creates it with window.WorkbenchView3D(ctx). */
(() => {
  'use strict';

  const OBJECT_HEIGHT = {
    hero: 1.3, case: 1, display: 1, artifact: .9, altar: 1.1, column: 3, pier: 3, bench: .45, couch: .5,
    table: .75, desk: .8, planter: .8, rope: .9, sign: 1.8, relief: 2, supply: .6, hearth: .8, fountain: .6,
    mosaic: .04, dome: .04, spawn: .04, object: .8,
  };
  const ROUTE_COLORS = { main: '#a34f40', optional: '#b58a3c', exit: '#2d7c78', secret: '#7d5a8a' };
  const TIER_COLORS = { normal: '#b7524b', elite: '#a55c30', boss: '#805394' };
  const CUT_HEIGHT = 1.2;     // cutaway section height for walls, metres
  const ISO_PITCH = Math.PI / 4;
  const ISO_DISTANCE = 1500;  // ortho eye stand-off; far enough to clear any map

  window.WorkbenchView3D = ctx => {
    const { state, $ } = ctx;
    const gl = {
      THREE: null, loading: null, renderer: null, camera: null, scene: null,
      helper: null, tag: null, pickables: [], labels: [], walls: 0, ghosts: 0,
      signature: '', fitKey: '', frame: 0, error: '', drag: null, pointers: new Map(),
      cam: { x: 0, y: 20, z: 40, yaw: 1, pitch: .78, fov: 45 },
      pivot: [0, 0, 0], lastSelected: null,
      fly: { keys: new Set(), level: 3, shift: false, rmb: false, frame: 0, last: 0 },
      view: 'persp', iso: { size: 60 }, persp: null, ortho: null,
      cutaway: true, shadows: true, wallTop: 0, cursor: null,
      mini: { on: true, key: '', plan: null, map: null, footprint: [] },
    };

    function loadThree() {
      if (window.THREE) return Promise.resolve(window.THREE);
      if (!gl.loading) {
        gl.loading = new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = 'vendor/three.min.js';
          script.onload = () => (window.THREE ? resolve(window.THREE) : reject(new Error('three.js 未定义')));
          script.onerror = () => reject(new Error('vendor/three.min.js 加载失败'));
          document.head.appendChild(script);
        }).catch(error => { gl.loading = null; throw error; });
      }
      return gl.loading;
    }

    const floorOf = id => (state.data?.floors || []).find(item => item.id === id) || null;
    const elevationOf = id => (Number.isFinite(floorOf(id)?.elevation) ? floorOf(id).elevation : 0);
    const defaultWallHeight = id => Math.min(2.4, (floorOf(id)?.height > 0 ? floorOf(id).height : 3) * .8);
    const wallHeightOf = room => (Number.isFinite(room.wallHeight) ? room.wallHeight : defaultWallHeight(room.floorId));
    const color3d = (value, fallback) => (/^#[0-9a-f]{6}$/i.test(String(value || '')) ? value : fallback);

    // Plan (x, z) → world (x, up, -z), so the 3D view reads north-up like the 2D map.
    function planMesh(THREE, points, { y, depth = 0, color, opacity = 1, material = null }) {
      const shape = new THREE.Shape();
      points.forEach(([x, z], index) => (index ? shape.lineTo(x, z) : shape.moveTo(x, z)));
      shape.closePath();
      const geometry = depth > 0 ? new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false }) : new THREE.ShapeGeometry(shape);
      const mesh = new THREE.Mesh(geometry, material || new THREE.MeshLambertMaterial({
        color, transparent: opacity < 1, opacity, side: THREE.DoubleSide, depthWrite: opacity >= 1,
      }));
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = y;
      return mesh;
    }

    function outline(THREE, points, y, material) {
      return new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(points.map(([x, z]) => new THREE.Vector3(x, y, -z))), material);
    }

    // Horizontal box from plan point a to b, standing on y.
    function segmentBox(THREE, a, b, { y, height, width, material }) {
      const dx = b[0] - a[0], dz = b[1] - a[1];
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(Math.hypot(dx, dz), height, width), material);
      mesh.position.set((a[0] + b[0]) / 2, y + height / 2, -(a[1] + b[1]) / 2);
      mesh.rotation.y = Math.atan2(dz, dx);
      return mesh;
    }

    // Flat ribbon between two world points; follows slopes (cross-floor routes).
    function ribbon(THREE, from, to, { width, material }) {
      const axis = to.clone().sub(from);
      const length = axis.length();
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(length, .06, width), material);
      axis.normalize();
      let side = new THREE.Vector3().crossVectors(axis, new THREE.Vector3(0, 1, 0));
      if (side.lengthSq() < 1e-6) side = new THREE.Vector3(0, 0, 1);
      side.normalize();
      const up = new THREE.Vector3().crossVectors(side, axis);
      mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(axis, up, side));
      mesh.position.copy(from).add(to).multiplyScalar(.5);
      return mesh;
    }

    const G = window.WorkbenchGeometry;

    // Merge many indexed geometries (each with its own transform) into one, keeping
    // material groups, so hundreds of wall pieces cost one draw call per material.
    function mergeMeshes(THREE, parts) {
      const positions = [], normals = [], byMaterial = new Map();
      for (const { geometry, matrix } of parts) {
        const g = geometry.clone().applyMatrix4(matrix);
        const base = positions.length / 3;
        positions.push(...g.attributes.position.array);
        normals.push(...g.attributes.normal.array);
        const groups = g.groups.length ? g.groups : [{ start: 0, count: g.index ? g.index.count : g.attributes.position.count, materialIndex: 0 }];
        for (const group of groups) {
          if (!byMaterial.has(group.materialIndex)) byMaterial.set(group.materialIndex, []);
          const list = byMaterial.get(group.materialIndex);
          for (let k = group.start; k < group.start + group.count; k++) list.push(base + (g.index ? g.index.getX(k) : k));
        }
        g.dispose();
      }
      const merged = new THREE.BufferGeometry();
      merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      merged.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
      const index = [];
      for (const materialIndex of [...byMaterial.keys()].sort((a, b) => a - b)) {
        merged.addGroup(index.length, byMaterial.get(materialIndex).length, materialIndex);
        index.push(...byMaterial.get(materialIndex));
      }
      merged.setIndex(index);
      return merged;
    }

    // Closed plan outlines and loose segments, all as one LineSegments.
    function linesMesh(THREE, { loops = [], segments = [] }, material) {
      const positions = [];
      for (const { points, y } of loops) {
        points.forEach((a, index) => {
          const b = points[(index + 1) % points.length];
          positions.push(a[0], y, -a[1], b[0], y, -b[1]);
        });
      }
      for (const [a, b] of segments) positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      return new THREE.LineSegments(geometry, material);
    }

    // All edge outlines of many meshes as one LineSegments.
    function mergedEdges(THREE, parts, material) {
      const positions = [];
      for (const { geometry, matrix } of parts) {
        const edges = new THREE.EdgesGeometry(geometry).applyMatrix4(matrix);
        positions.push(...edges.attributes.position.array);
        edges.dispose();
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      return new THREE.LineSegments(geometry, material);
    }

    function textSprite(THREE, text, { color = '#35443c', background = null } = {}) {
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      const font = '600 40px "Microsoft YaHei", sans-serif';
      context.font = font;
      canvas.width = Math.ceil(context.measureText(text).width) + 28;
      canvas.height = 60;
      context.font = font;
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      if (background) {
        context.fillStyle = background;
        context.fillRect(0, 4, canvas.width, 52);
      } else {
        context.lineWidth = 8;
        context.strokeStyle = 'rgba(246,241,229,.95)';
        context.strokeText(text, canvas.width / 2, 31);
      }
      context.fillStyle = color;
      context.fillText(text, canvas.width / 2, 31);
      const texture = new THREE.CanvasTexture(canvas);
      texture.minFilter = THREE.LinearFilter;
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true }));
      sprite.renderOrder = 10;
      sprite.userData.aspect = canvas.width / canvas.height;
      return sprite;
    }

    function disposeObject(root) {
      root.traverse(object => {
        object.geometry?.dispose();
        for (const material of [].concat(object.material || [])) {
          material.map?.dispose();
          material.dispose();
        }
      });
    }

    function build() {
      const THREE = gl.THREE;
      const data = state.data;
      const layers = state.layers;
      if (gl.scene) disposeObject(gl.scene);
      gl.helper = null;
      gl.tag = null;
      const dark = ctx.theme?.() === 'dark';
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(dark ? 0x1c2321 : 0xf1eadb);
      // Sun with a shadow camera sized to the visible map; a ground slab under the lowest
      // floor catches shadows so masses read as standing on something.
      const bounds = ctx.boundsOf(data, state.floor);
      const visibleFloors = state.floor === 'all' ? (data.floors || []) : [floorOf(state.floor)].filter(Boolean);
      const lowest = Math.min(0, ...visibleFloors.map(floor => floor.elevation || 0));
      const center = [(bounds.minX + bounds.maxX) / 2, lowest, -(bounds.minZ + bounds.maxZ) / 2];
      const radius = Math.hypot(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ) / 2 + 6;
      scene.add(new THREE.HemisphereLight(0xffffff, 0xb9b09c, gl.shadows ? .7 : .9));
      const sun = new THREE.DirectionalLight(0xfff4e0, gl.shadows ? .9 : .75);
      sun.position.set(center[0] + radius * .55, lowest + radius * 1.3 + 20, center[2] + radius * .75);
      sun.target.position.set(...center);
      scene.add(sun, sun.target);
      if (gl.shadows) {
        sun.castShadow = true;
        Object.assign(sun.shadow.camera, { left: -radius, right: radius, top: radius, bottom: -radius, near: 1, far: radius * 5 + 80 });
        sun.shadow.camera.updateProjectionMatrix();
        sun.shadow.mapSize.set(radius > 120 ? 4096 : 2048, radius > 120 ? 4096 : 2048);
        sun.shadow.bias = -.0006;
        sun.shadow.normalBias = .03;
      }
      const ground = new THREE.Mesh(new THREE.PlaneGeometry(radius * 3, radius * 3), new THREE.MeshLambertMaterial({ color: dark ? 0x27302c : 0xe4dac7 }));
      ground.rotation.x = -Math.PI / 2;
      ground.position.set(center[0], lowest - .08, center[2]);
      ground.receiveShadow = true;
      ground.userData.flat = true;
      scene.add(ground);
      gl.pickables = [];
      gl.labels = [];
      gl.walls = 0;
      gl.wallTop = 0;
      gl.ghosts = 0;
      const pick = (object, id, type) => {
        object.userData.id = id;
        object.userData.type = type;
        gl.pickables.push(object);
        scene.add(object);
        return object;
      };
      const multiFloor = state.floor === 'all' && (data.floors || []).length > 1;
      const roomsByFloor = new Map();
      for (const room of data.rooms || []) {
        if (!room.points?.length) continue;
        if (!roomsByFloor.has(room.floorId)) roomsByFloor.set(room.floorId, []);
        roomsByFloor.get(room.floorId).push(room);
      }
      const shown = list => (list || []).filter(entity => ctx.floorMatches(entity));

      if (layers.grid) {
        const b = ctx.boundsOf(data, state.floor);
        const size = Math.ceil(Math.max(b.maxX - b.minX, b.maxZ - b.minZ) / 5) * 5 + 10;
        const floors = state.floor === 'all' ? (data.floors || []) : [floorOf(state.floor)].filter(Boolean);
        const grid = new THREE.GridHelper(size, size / 5, dark ? 0x3e4a45 : 0xc9bea9, dark ? 0x333d39 : 0xd8cdb8);
        grid.material.transparent = true;
        grid.material.opacity = .45;
        grid.position.set((b.minX + b.maxX) / 2, Math.min(0, ...floors.map(f => f.elevation || 0)) - .06, -(b.minZ + b.maxZ) / 2);
        scene.add(grid);
      }

      if (layers.rooms) {
        // Other floors stay as faint plates so a single floor keeps its vertical context.
        if (state.floor !== 'all') {
          const ghostLine = new THREE.LineBasicMaterial({ color: 0x8a7a66, transparent: true, opacity: .3 });
          const ghostLoops = [];
          for (const room of data.rooms || []) {
            if (!room.points?.length || room.floorId === state.floor) continue;
            const y = elevationOf(room.floorId);
            scene.add(planMesh(THREE, room.points, { y, color: '#cfc4ae', opacity: .14 }));
            ghostLoops.push({ points: room.points, y: y + .02 });
            gl.ghosts += 1;
          }
          if (ghostLoops.length) scene.add(linesMesh(THREE, { loops: ghostLoops }, ghostLine));
        }
        const outlineMaterial = new THREE.LineBasicMaterial({ color: 0x6b5b45 });
        const roomLoops = [];
        for (const room of shown(data.rooms)) {
          if (!room.points?.length) continue;
          const y = elevationOf(room.floorId);
          pick(planMesh(THREE, room.points, { y, color: color3d(room.color, '#e7dcc5'), opacity: multiFloor ? .88 : 1 }), room.id, 'room');
          roomLoops.push({ points: room.points, y: y + .02 });
        }
        scene.add(linesMesh(THREE, { loops: roomLoops }, outlineMaterial));
        // Solid walls; with cutaway on they stop at CUT_HEIGHT and the cut face is drawn
        // dark, like a plan section, so routes and rooms behind stay readable.
        const wallSide = new THREE.MeshLambertMaterial({ color: 0xe9e0cd });
        const wallTop = new THREE.MeshLambertMaterial({ color: gl.cutaway ? 0x4d4437 : 0xd7ccb5 });
        const wallMaterials = [wallSide, wallSide, wallTop, wallSide, wallSide, wallSide];
        const edgeMaterial = new THREE.LineBasicMaterial({ color: 0x5f5140, transparent: true, opacity: .45 });
        const floorIds = [...new Set(shown(data.rooms).map(room => room.floorId))];
        const wallParts = [];
        for (const floorId of floorIds) {
          const y = elevationOf(floorId);
          const doors = (data.doors || []).filter(door => door.floorId === floorId && door.points?.length === 2);
          for (const run of G.wallRuns(roomsByFloor.get(floorId) || [], wallHeightOf)) {
            const height = gl.cutaway ? Math.min(run.height, CUT_HEIGHT) : run.height;
            gl.wallTop = Math.max(gl.wallTop, height);
            for (const [p, q] of G.wallSpans(run.a, run.b, doors)) {
              const wall = segmentBox(THREE, p, q, { y, height, width: .2, material: wallMaterials });
              wall.updateMatrix();
              wallParts.push({ geometry: wall.geometry, matrix: wall.matrix });
              gl.walls += 1;
            }
          }
        }
        // One mesh + one outline for every wall on screen (they are never picked).
        if (wallParts.length) {
          scene.add(new THREE.Mesh(mergeMeshes(THREE, wallParts), wallMaterials));
          scene.add(mergedEdges(THREE, wallParts, edgeMaterial));
          wallParts.forEach(part => part.geometry.dispose());
        }
        const finishes = new Map();
        for (const object of shown(data.objects)) {
          if (!['floor-finish', 'floor-inlay'].includes(object.kind) || !object.points?.length) continue;
          const lift = object.kind === 'floor-inlay' ? .025 : .015;
          const color = color3d(object.color, '#ded6c2');
          const plate = planMesh(THREE, object.points, { y: elevationOf(object.floorId) + lift, color });
          plate.updateMatrix();
          if (!finishes.has(color)) finishes.set(color, []);
          finishes.get(color).push({ geometry: plate.geometry, matrix: plate.matrix });
          plate.material.dispose();
        }
        for (const [color, parts] of finishes) {
          scene.add(new THREE.Mesh(mergeMeshes(THREE, parts), new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide })));
          parts.forEach(part => part.geometry.dispose());
        }
      }

      // Pressure heatmap draped on each visible floor (same field as the 2D layer).
      gl.heatPlanes = 0;
      if (layers.heat) {
        const floorIds = state.floor === 'all' ? (data.floors || []).map(floor => floor.id) : [state.floor];
        for (const floorId of floorIds) {
          const field = ctx.heatField(floorId);
          if (!field) continue;
          const fb = field.bounds;
          const texture = new THREE.CanvasTexture(field.canvas);
          texture.minFilter = THREE.LinearFilter;
          const plane = new THREE.Mesh(
            new THREE.PlaneGeometry(fb.maxX - fb.minX, fb.maxZ - fb.minZ),
            new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }),
          );
          plane.rotation.x = -Math.PI / 2;
          plane.position.set((fb.minX + fb.maxX) / 2, elevationOf(floorId) + .035, -(fb.minZ + fb.maxZ) / 2);
          plane.renderOrder = 2;
          scene.add(plane);
          gl.heatPlanes += 1;
        }
      }

      // Extraction-distance field draped the same way, just above the heat layer.
      gl.distPlanes = 0;
      if (layers.exits) {
        const floorIds = state.floor === 'all' ? (data.floors || []).map(floor => floor.id) : [state.floor];
        for (const floorId of floorIds) {
          const field = ctx.exitField(floorId);
          if (!field) continue;
          const fb = field.bounds;
          const texture = new THREE.CanvasTexture(field.canvas);
          texture.minFilter = THREE.LinearFilter;
          const plane = new THREE.Mesh(
            new THREE.PlaneGeometry(fb.maxX - fb.minX, fb.maxZ - fb.minZ),
            new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }),
          );
          plane.rotation.x = -Math.PI / 2;
          plane.position.set((fb.minX + fb.maxX) / 2, elevationOf(floorId) + .045, -(fb.minZ + fb.maxZ) / 2);
          plane.renderOrder = 3;
          scene.add(plane);
          gl.distPlanes += 1;
        }
      }

      if (layers.water) {
        for (const water of shown(data.water)) {
          if (!water.points?.length) continue;
          pick(planMesh(THREE, water.points, { y: elevationOf(water.floorId) + .04, color: '#6fa6a0', opacity: .78 }), water.id, 'water');
        }
      }

      if (layers.objects) {
        const objectMaterials = new Map(), objectEdges = [];
        for (const object of shown(data.objects)) {
          if (!object.points?.length || ['floor-finish', 'floor-inlay'].includes(object.kind)) continue;
          const y = elevationOf(object.floorId);
          if (object.kind === 'combat-space') {
            const line = outline(THREE, object.points, y + .06, new THREE.LineDashedMaterial({ color: color3d(object.color, '#73a78b'), dashSize: .6, gapSize: .4 }));
            line.computeLineDistances();
            pick(line, object.id, 'object');
          } else if (['loot', 'interaction'].includes(object.kind)) {
            const [x, z] = ctx.centerOf(object);
            const marker = new THREE.Mesh(
              new THREE.CylinderGeometry(.45, .45, .5, 18),
              new THREE.MeshLambertMaterial({ color: object.kind === 'loot' ? 0xd8b453 : 0x287c7b }),
            );
            marker.position.set(x, y + .25, -z);
            pick(marker, object.id, 'object');
          } else {
            const ceiling = (floorOf(object.floorId)?.height || 3) - .1;
            const height = Math.min(ceiling, Number.isFinite(object.height) && object.height > 0 ? object.height : (OBJECT_HEIGHT[object.kind] ?? .8));
            const color = color3d(object.color, '#a99a7e'), opacity = object.solid === false ? .6 : 1;
            const key = `${color}|${opacity}`;
            if (!objectMaterials.has(key)) {
              objectMaterials.set(key, new THREE.MeshLambertMaterial({ color, transparent: opacity < 1, opacity, side: THREE.DoubleSide, depthWrite: opacity >= 1 }));
            }
            const mass = planMesh(THREE, object.points, { y, depth: height, material: objectMaterials.get(key) });
            mass.updateMatrix();
            objectEdges.push({ geometry: mass.geometry, matrix: mass.matrix });
            pick(mass, object.id, 'object');
          }
        }
        if (objectEdges.length) scene.add(mergedEdges(THREE, objectEdges, new THREE.LineBasicMaterial({ color: 0x5f5140, transparent: true, opacity: .4 })));
      }

      if (layers.stairs) {
        const stepMaterial = new THREE.MeshLambertMaterial({ color: 0xc4b89f });
        const stepEdge = new THREE.LineBasicMaterial({ color: 0x6b5b45, transparent: true, opacity: .5 });
        const stepEdges = [];
        for (const stair of shown(data.stairs)) {
          const box = ctx.bboxOf(stair);
          if (!box) continue;
          const from = elevationOf(stair.fromFloorId), to = elevationOf(stair.toFloorId);
          const side = G.stairSide(stair, box, roomsByFloor, elevationOf);
          const steps = Math.max(3, Math.min(20, Math.round(Math.abs(to - from) / .18)));
          const [lo, hi] = side.axis === 'x' ? [box.minX, box.maxX] : [box.minZ, box.maxZ];
          const [acrossLo, acrossHi] = side.axis === 'x' ? [box.minZ, box.maxZ] : [box.minX, box.maxX];
          const depth = (hi - lo) / steps, across = acrossHi - acrossLo, base = Math.min(from, to);
          const c = (acrossLo + acrossHi) / 2;
          for (let index = 0; index < steps; index++) {
            const top = from + (to - from) * (index + 1) / steps;
            const height = Math.max(.05, top - base);
            const s = side.sign > 0 ? lo + (index + .5) * depth : hi - (index + .5) * depth;
            const step = new THREE.Mesh(
              side.axis === 'x' ? new THREE.BoxGeometry(depth, height, across) : new THREE.BoxGeometry(across, height, depth),
              stepMaterial,
            );
            step.position.set(side.axis === 'x' ? s : c, base + height / 2, -(side.axis === 'x' ? c : s));
            step.updateMatrix();
            stepEdges.push({ geometry: step.geometry, matrix: step.matrix });
            pick(step, stair.id, 'stairs');
          }
        }
        if (stepEdges.length) scene.add(mergedEdges(THREE, stepEdges, stepEdge));
      }

      if (layers.doors) {
        const doorMaterial = new THREE.MeshLambertMaterial({ color: 0x8b5a45 });
        for (const door of shown(data.doors)) {
          if (door.points?.length !== 2) continue;
          pick(segmentBox(THREE, door.points[0], door.points[1], { y: elevationOf(door.floorId), height: .06, width: .5, material: doorMaterial }), door.id, 'door');
        }
      }

      if (layers.routes) {
        for (const route of shown(data.routes)) {
          const points = route.points || [];
          if (points.length < 2) continue;
          const base = elevationOf(route.floorId);
          const world = points.map(p => new THREE.Vector3(p[0], (Number.isFinite(p[2]) ? p[2] : base) + .08, -p[1]));
          const material = new THREE.MeshLambertMaterial({ color: color3d(route.color, ROUTE_COLORS[route.kind] || '#a34f40') });
          const width = route.kind === 'main' ? .4 : .26;
          const parts = [];
          for (let index = 1; index < world.length; index++) {
            if (world[index].distanceTo(world[index - 1]) < .01) continue;
            const piece = ribbon(THREE, world[index - 1], world[index], { width, material });
            piece.updateMatrix();
            parts.push({ geometry: piece.geometry, matrix: piece.matrix });
          }
          const end = world[world.length - 1];
          const direction = end.clone().sub(world[world.length - 2]).normalize();
          const arrow = new THREE.Mesh(new THREE.ConeGeometry(width * 1.4, width * 2.6, 12), material);
          arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
          arrow.position.copy(end).add(new THREE.Vector3(0, .05, 0));
          arrow.updateMatrix();
          parts.push({ geometry: arrow.geometry, matrix: arrow.matrix });
          if (!parts.length) continue;
          pick(new THREE.Mesh(mergeMeshes(THREE, parts), material), route.id, 'route');
          parts.forEach(part => part.geometry.dispose());
        }
      }

      if (layers.enemies) {
        const pinMaterial = new THREE.LineBasicMaterial({ color: 0x8a7a66 });
        const pins = [], tierMaterials = new Map();
        for (const enemy of shown(data.enemies)) {
          if (!enemy.center) continue;
          const [x, z] = enemy.center;
          const y = elevationOf(enemy.floorId);
          const color = TIER_COLORS[enemy.tier] || TIER_COLORS.normal;
          const lift = enemy.tier === 'boss' ? 1.3 : 1;
          const geometry = enemy.tier === 'elite' ? new THREE.OctahedronGeometry(.5) : new THREE.SphereGeometry(enemy.tier === 'boss' ? .62 : .36, 16, 12);
          if (!tierMaterials.has(color)) tierMaterials.set(color, new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: .2 }));
          const marker = new THREE.Mesh(geometry, tierMaterials.get(color));
          marker.position.set(x, y + lift, -z);
          pick(marker, enemy.id, 'enemy');
          pins.push([new THREE.Vector3(x, y, -z), new THREE.Vector3(x, y + lift, -z)]);
        }
        if (pins.length) scene.add(linesMesh(THREE, { segments: pins }, pinMaterial));
      }

      if (layers.labels) {
        for (const room of shown(data.rooms)) {
          if (!room.points?.length) continue;
          const [x, z] = Array.isArray(room.label) ? room.label : ctx.centerOf(room);
          const sprite = textSprite(THREE, `${room.code ? `${room.code} ` : ''}${room.short || room.name || room.id}`);
          sprite.position.set(x, elevationOf(room.floorId) + Math.max(wallHeightOf(room), defaultWallHeight(room.floorId) * .5) + .4, -z);
          sprite.userData.area = room.area || ctx.areaOf(room.points);
          scene.add(sprite);
          gl.labels.push(sprite);
        }
        gl.labels.sort((a, b) => b.userData.area - a.userData.area);
      }

      if (gl.shadows) {
        scene.traverse(object => {
          if (!object.isMesh || object === ground) return;
          const material = [].concat(object.material)[0];
          if (material.transparent && material.opacity < .5) return; // ghost floors
          const flat = object.geometry.type === 'ShapeGeometry' || object.geometry.type === 'PlaneGeometry' || object.userData.type === 'route';
          object.castShadow = !flat;
          object.receiveShadow = true;
        });
      }
      scene.updateMatrixWorld(true);
      gl.scene = scene;
    }

    /* Camera — modelled on the Unreal Editor perspective viewport.
       The camera is free (eye + yaw/pitch); a separate pivot (map centre, the last
       focused or selected object) is what Alt+drag orbits and dollies around.
       forward(yaw, pitch) = (-cosP·cosY, -sinP, -cosP·sinY); pitch > 0 looks down. */
    const SPEED_LEVELS = [.125, .25, .5, 1, 1.5, 2.5, 4, 8];
    const DEFAULT_FOV = 45;
    const clampPitch = pitch => Math.max(-1.5, Math.min(1.5, pitch));
    const forwardOf = (yaw, pitch) => [-Math.cos(pitch) * Math.cos(yaw), -Math.sin(pitch), -Math.cos(pitch) * Math.sin(yaw)];
    const rightOf = yaw => [Math.sin(yaw), 0, -Math.cos(yaw)];
    const eyeOf = () => [gl.cam.x, gl.cam.y, gl.cam.z];
    const pivotDistance = () => Math.hypot(gl.cam.x - gl.pivot[0], gl.cam.y - gl.pivot[1], gl.cam.z - gl.pivot[2]);

    function moveEye(vector, amount) {
      gl.cam.x += vector[0] * amount;
      gl.cam.y += vector[1] * amount;
      gl.cam.z += vector[2] * amount;
    }

    // Place the eye `distance` metres back from `point` along the current view direction.
    function frame(point, distance) {
      const forward = forwardOf(gl.cam.yaw, gl.cam.pitch);
      gl.pivot = [...point];
      Object.assign(gl.cam, { x: point[0] - forward[0] * distance, y: point[1] - forward[1] * distance, z: point[2] - forward[2] * distance });
    }

    /* 2.5D: an orthographic camera at a fixed 45° pitch looking at the pivot from
       ISO_DISTANCE away; yaw steps in 90° and gl.iso.size is the visible height in metres. */
    const isIso = () => gl.view === 'iso';
    const viewAspect = () => ($('gl3d').clientWidth || 1) / ($('gl3d').clientHeight || 1);
    const snapIsoYaw = yaw => Math.PI / 4 + Math.round((yaw - Math.PI / 4) / (Math.PI / 2)) * (Math.PI / 2);
    const groundForward = () => [-Math.cos(gl.cam.yaw), 0, -Math.sin(gl.cam.yaw)];

    function cameraUp() {
      const forward = forwardOf(gl.cam.yaw, gl.cam.pitch), right = rightOf(gl.cam.yaw);
      return [right[1] * forward[2] - right[2] * forward[1], right[2] * forward[0] - right[0] * forward[2], right[0] * forward[1] - right[1] * forward[0]];
    }

    // Fit the ortho view around a world-space box (pivot at its centre).
    function fitIsoBox(min, max) {
      const right = rightOf(gl.cam.yaw), up = cameraUp();
      const corners = [];
      for (const x of [min[0], max[0]]) for (const y of [min[1], max[1]]) for (const z of [min[2], max[2]]) corners.push([x, y, z]);
      const across = corners.map(p => p[0] * right[0] + p[1] * right[1] + p[2] * right[2]);
      const vertical = corners.map(p => p[0] * up[0] + p[1] * up[1] + p[2] * up[2]);
      const width = Math.max(...across) - Math.min(...across), height = Math.max(...vertical) - Math.min(...vertical);
      gl.pivot = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
      gl.iso.size = Math.max(6, Math.max(height, width / viewAspect()) * 1.12);
    }

    function fit() {
      const b = ctx.boundsOf(state.data, state.floor);
      const floors = state.floor === 'all' ? (state.data.floors || []) : [floorOf(state.floor)].filter(Boolean);
      const elevations = floors.length ? floors.map(floor => floor.elevation || 0) : [0];
      const w = Math.max(4, b.maxX - b.minX), d = Math.max(4, b.maxZ - b.minZ);
      if (isIso()) {
        Object.assign(gl.cam, { yaw: snapIsoYaw(gl.cam.yaw), pitch: ISO_PITCH, fov: DEFAULT_FOV });
        fitIsoBox([b.minX, Math.min(...elevations), -b.maxZ], [b.maxX, Math.max(...elevations) + 2, -b.minZ]);
        return;
      }
      Object.assign(gl.cam, { yaw: Math.PI / 2 - .55, pitch: .78, fov: DEFAULT_FOV });
      frame([(b.minX + b.maxX) / 2, (Math.min(...elevations) + Math.max(...elevations)) / 2 + .8, -(b.minZ + b.maxZ) / 2], Math.max(12, Math.hypot(w, d) * .95));
    }

    function boxOf(id) {
      const box = new gl.THREE.Box3();
      for (const object of gl.pickables) if (object.userData.id === id) box.expandByObject(object);
      return box;
    }

    // F / double-click: frame the object and make it the orbit pivot (like UE's F).
    function focus(id) {
      const box = boxOf(id);
      if (box.isEmpty()) return;
      const center = box.getCenter(new gl.THREE.Vector3());
      const size = box.getSize(new gl.THREE.Vector3()).length();
      if (isIso()) {
        gl.pivot = [center.x, center.y, center.z];
        gl.iso.size = Math.max(8, Math.min(400, size * 3));
      } else {
        frame([center.x, center.y, center.z], Math.max(6, Math.min(120, size * 2.2)));
      }
      request();
    }

    function applyCamera() {
      const forward = forwardOf(gl.cam.yaw, gl.cam.pitch);
      if (isIso()) {
        gl.camera = gl.ortho;
        const half = gl.iso.size / 2, aspect = viewAspect();
        Object.assign(gl.ortho, { left: -half * aspect, right: half * aspect, top: half, bottom: -half });
        gl.ortho.updateProjectionMatrix();
        const [px, py, pz] = gl.pivot;
        gl.ortho.position.set(px - forward[0] * ISO_DISTANCE, py - forward[1] * ISO_DISTANCE, pz - forward[2] * ISO_DISTANCE);
        gl.ortho.lookAt(px, py, pz);
      } else {
        gl.camera = gl.persp;
        gl.persp.position.set(gl.cam.x, gl.cam.y, gl.cam.z);
        gl.persp.lookAt(gl.cam.x + forward[0], gl.cam.y + forward[1], gl.cam.z + forward[2]);
        if (gl.persp.fov !== gl.cam.fov) {
          gl.persp.fov = gl.cam.fov;
          gl.persp.updateProjectionMatrix();
        }
      }
      gl.camera.updateMatrixWorld();
    }

    function draw() {
      gl.frame = 0;
      if (state.mode !== '3d' || !gl.renderer || !gl.scene) return;
      const host = $('gl3d');
      const width = host.clientWidth || 1, height = host.clientHeight || 1;
      const size = gl.renderer.getSize(new gl.THREE.Vector2());
      if (size.x !== width || size.y !== height) {
        gl.renderer.setSize(width, height, false);
        gl.persp.aspect = width / height;
        gl.persp.updateProjectionMatrix();
      }
      applyCamera();
      // Labels keep a constant screen size; larger rooms win when labels collide (same rule as 2D).
      const pixelsPerUnit = height / (2 * Math.tan(gl.persp.fov * Math.PI / 360));
      const placed = [];
      const place = sprite => {
        let scale, h;
        if (isIso()) {
          scale = gl.iso.size * .036;
          h = scale * height / gl.iso.size;
        } else {
          const distance = Math.max(.1, gl.camera.position.distanceTo(sprite.position));
          scale = distance * .03 * gl.camera.fov / DEFAULT_FOV;
          h = scale * pixelsPerUnit / distance;
        }
        sprite.scale.set(scale * sprite.userData.aspect, scale, 1);
        const screen = sprite.position.clone().project(gl.camera);
        return { screen, box: { x: (screen.x + 1) / 2 * width, y: (1 - screen.y) / 2 * height, w: h * sprite.userData.aspect / 2, h: h / 2 } };
      };
      if (gl.tag) placed.push(place(gl.tag).box);
      for (const sprite of gl.labels) {
        const { screen, box } = place(sprite);
        sprite.visible = screen.z < 1 && !placed.some(o => Math.abs(o.x - box.x) < o.w + box.w && Math.abs(o.y - box.y) < o.h + box.h);
        if (sprite.visible) placed.push(box);
      }
      gl.renderer.render(gl.scene, gl.camera);
      drawMini();
    }

    /* Minimap (top-right): the visible floor plan, the eye and the ground footprint of
       the view; clicking or dragging on it moves the camera there. */
    const MINI_MAX = 200, MINI_PAD = 8;

    function miniPlan() {
      const key = `${state.key}|${state.floor}`;
      if (gl.mini.key === key && gl.mini.plan) return;
      const b = ctx.boundsOf(state.data, state.floor);
      const w = Math.max(1, b.maxX - b.minX), d = Math.max(1, b.maxZ - b.minZ);
      const scale = (MINI_MAX - MINI_PAD * 2) / Math.max(w, d);
      const width = Math.round(w * scale + MINI_PAD * 2), height = Math.round(d * scale + MINI_PAD * 2);
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      const plan = document.createElement('canvas');
      plan.width = width * ratio;
      plan.height = height * ratio;
      const c = plan.getContext('2d');
      c.scale(ratio, ratio);
      const to = ([x, z]) => [MINI_PAD + (x - b.minX) * scale, MINI_PAD + (b.maxZ - z) * scale];
      const trace = (points, close) => {
        c.beginPath();
        points.forEach((p, i) => (i ? c.lineTo(...to(p)) : c.moveTo(...to(p))));
        if (close) c.closePath();
      };
      for (const room of state.data.rooms || []) {
        if (!room.points?.length || !ctx.floorMatches(room)) continue;
        trace(room.points, true);
        c.fillStyle = color3d(room.color, '#e7dcc5');
        c.fill();
        c.lineWidth = .8;
        c.strokeStyle = '#6b5b45';
        c.stroke();
      }
      const main = (state.data.routes || []).find(route => route.kind === 'main' && ctx.floorMatches(route));
      if (main?.points?.length > 1) {
        trace(main.points, false);
        c.lineWidth = 1.4;
        c.strokeStyle = '#a34f40';
        c.stroke();
      }
      Object.assign(gl.mini, { key, plan, map: { b, scale, width, height, ratio } });
      const mini = $('gl3dMini');
      mini.width = width * ratio;
      mini.height = height * ratio;
      mini.style.width = `${width}px`;
      mini.style.height = `${height}px`;
    }

    // Where the four screen corners land on the ground (pivot height); rays that
    // never reach it are clamped so a horizon view still shows a sensible wedge.
    function groundFootprint() {
      const THREE = gl.THREE, ray = new THREE.Raycaster(), height = gl.pivot[1];
      return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => {
        ray.setFromCamera(new THREE.Vector2(x, y), gl.camera);
        const { origin, direction } = ray.ray;
        const t = direction.y < -1e-4 ? (height - origin.y) / direction.y : Infinity;
        // The ortho eye stands ISO_DISTANCE away, so only perspective rays get clamped.
        const reach = isIso() ? Math.max(0, t) : Math.min(Math.max(0, t), 250);
        return [origin.x + direction.x * reach, -(origin.z + direction.z * reach)];
      });
    }

    function drawMini() {
      const mini = $('gl3dMini');
      mini.hidden = !gl.mini.on || state.mode !== '3d';
      if (mini.hidden || !state.data) return;
      miniPlan();
      const { b, scale, width, height, ratio } = gl.mini.map;
      const c = mini.getContext('2d');
      c.setTransform(ratio, 0, 0, ratio, 0, 0);
      c.clearRect(0, 0, width, height);
      c.drawImage(gl.mini.plan, 0, 0, width, height);
      const to = ([x, z]) => [MINI_PAD + (x - b.minX) * scale, MINI_PAD + (b.maxZ - z) * scale];
      gl.mini.footprint = groundFootprint();
      c.beginPath();
      gl.mini.footprint.forEach((p, i) => (i ? c.lineTo(...to(p)) : c.moveTo(...to(p))));
      c.closePath();
      c.fillStyle = 'rgba(45,124,120,.18)';
      c.fill();
      c.lineWidth = 1.2;
      c.strokeStyle = '#2d7c78';
      c.stroke();
      const [px, py] = to([gl.pivot[0], -gl.pivot[2]]);
      c.strokeStyle = '#2f403b';
      c.beginPath();
      c.moveTo(px - 4, py); c.lineTo(px + 4, py); c.moveTo(px, py - 4); c.lineTo(px, py + 4);
      c.stroke();
      if (!isIso()) {
        // Eye and heading in plan space (world z is plan -z).
        const [ex, ey] = to([gl.cam.x, -gl.cam.z]);
        const heading = [-Math.cos(gl.cam.yaw), Math.sin(gl.cam.yaw)];
        c.fillStyle = '#2d7c78';
        c.strokeStyle = '#2d7c78';
        c.beginPath();
        c.arc(ex, ey, 4, 0, Math.PI * 2);
        c.fill();
        c.beginPath();
        c.moveTo(ex, ey);
        c.lineTo(ex + heading[0] * 12, ey - heading[1] * 12);
        c.lineWidth = 2;
        c.stroke();
      }
    }

    // Minimap click/drag → move the view so that plan point is in the middle.
    function miniTeleport(event) {
      const { b, scale } = gl.mini.map || {};
      if (!b) return;
      const rect = $('gl3dMini').getBoundingClientRect();
      const x = b.minX + (event.clientX - rect.left - MINI_PAD) / scale;
      const z = b.maxZ - (event.clientY - rect.top - MINI_PAD) / scale;
      lookAtPoint([x, z, gl.pivot[1]]);
    }

    function request() {
      if (!gl.frame) gl.frame = requestAnimationFrame(draw);
    }

    function highlight() {
      if (!gl.scene) return;
      for (const key of ['helper', 'tag']) {
        if (!gl[key]) continue;
        gl.scene.remove(gl[key]);
        disposeObject(gl[key]);
        gl[key] = null;
      }
      const changed = gl.lastSelected !== state.selected;
      gl.lastSelected = state.selected;
      if (!state.selected) return;
      const box = boxOf(state.selected);
      if (box.isEmpty()) return;
      const center = box.getCenter(new gl.THREE.Vector3());
      if (changed) gl.pivot = [center.x, center.y, center.z]; // Alt+drag orbits the selection, as in UE
      box.expandByScalar(.25);
      gl.helper = new gl.THREE.Box3Helper(box, 0x2d7c78);
      gl.scene.add(gl.helper);
      const entity = ctx.entityById(state.selected);
      gl.tag = textSprite(gl.THREE, entity?.name || state.selected, { color: '#ffffff', background: 'rgba(45,124,120,.92)' });
      gl.tag.position.set(center.x, box.max.y + .6, center.z);
      gl.tag.renderOrder = 11;
      gl.scene.add(gl.tag);
    }

    /* Pacing cursor from the 2D chart: aggro ring on the floor + a marker post.
       Kept outside build() so hovering the chart never rebuilds the scene. */
    function setCursor(point, radius = 8) {
      gl.cursorPoint = point ? { point, radius } : null;
      paintCursor();
      request();
    }

    function paintCursor() {
      if (!gl.scene) return;
      if (gl.cursor) {
        gl.scene.remove(gl.cursor);
        disposeObject(gl.cursor);
        gl.cursor = null;
      }
      if (!gl.cursorPoint) return;
      const THREE = gl.THREE;
      const { point: [x, z, y], radius } = gl.cursorPoint;
      const group = new THREE.Group();
      const flat = mesh => { mesh.rotation.x = -Math.PI / 2; mesh.renderOrder = 9; return mesh; };
      group.add(flat(new THREE.Mesh(new THREE.CircleGeometry(radius, 64), new THREE.MeshBasicMaterial({ color: 0x2d7c78, transparent: true, opacity: .1, depthWrite: false, side: THREE.DoubleSide }))));
      group.add(flat(new THREE.Mesh(new THREE.RingGeometry(radius - .12, radius, 64), new THREE.MeshBasicMaterial({ color: 0x2d7c78, transparent: true, opacity: .8, depthTest: false, side: THREE.DoubleSide }))));
      const post = new THREE.Mesh(new THREE.CylinderGeometry(.1, .1, 3, 10), new THREE.MeshBasicMaterial({ color: 0x2d7c78 }));
      post.position.y = 1.5;
      const head = new THREE.Mesh(new THREE.SphereGeometry(.35, 16, 12), new THREE.MeshBasicMaterial({ color: 0x2d7c78 }));
      head.position.y = 3.1;
      group.add(post, head);
      group.position.set(x, y + .07, -z);
      gl.scene.add(group);
      gl.cursor = group;
    }

    // Bring a plan point [x, z, elevation] to the middle of the view.
    function lookAtPoint([x, z, y]) {
      if (isIso()) gl.pivot = [x, y, -z];
      else frame([x, y + 1, -z], Math.max(10, Math.min(80, pivotDistance())));
      request();
    }

    // Called after every 2D render: rebuild only when map/floor/layers changed.
    function sync() {
      if (state.mode !== '3d' || !gl.renderer || !state.data) return;
      const signature = JSON.stringify([state.key, state.floor, state.layers, gl.cutaway, gl.shadows, ctx.exitKey?.(), ctx.theme?.()]);
      if (signature !== gl.signature || !gl.scene) {
        gl.cursor = null; // its meshes went with the old scene
        build();
        paintCursor();
        gl.signature = signature;
      }
      const fitKey = `${state.key}|${state.floor}`;
      if (fitKey !== gl.fitKey) {
        gl.fitKey = fitKey;
        fit();
      }
      highlight();
      request();
    }

    function pick(clientX, clientY) {
      if (!gl.scene) return null;
      const rect = $('gl3d').getBoundingClientRect();
      const pointer = new gl.THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
      applyCamera();
      const raycaster = new gl.THREE.Raycaster();
      raycaster.params.Line.threshold = .3;
      raycaster.setFromCamera(pointer, gl.camera);
      const hit = raycaster.intersectObjects(gl.pickables, false)[0];
      return hit ? hit.object.userData.id : null;
    }

    function screenOf(id) {
      const box = boxOf(id);
      if (box.isEmpty()) return null;
      applyCamera();
      const center = box.getCenter(new gl.THREE.Vector3()).project(gl.camera);
      const rect = $('gl3d').getBoundingClientRect();
      return { x: rect.left + (center.x + 1) / 2 * rect.width, y: rect.top + (1 - center.y) / 2 * rect.height };
    }

    // Toolbar +/−, pinch and Alt+right-drag: dolly toward / away from the pivot (2.5D: scale).
    function zoom(factor) {
      if (isIso()) {
        gl.iso.size = Math.max(4, Math.min(1500, gl.iso.size * factor));
        request();
        return;
      }
      const distance = pivotDistance();
      const next = Math.max(1, Math.min(600, distance * factor));
      const t = 1 - next / Math.max(1e-6, distance);
      gl.cam.x += (gl.pivot[0] - gl.cam.x) * t;
      gl.cam.y += (gl.pivot[1] - gl.cam.y) * t;
      gl.cam.z += (gl.pivot[2] - gl.cam.z) * t;
      request();
    }

    // Swing the eye around the pivot and keep looking at it (Alt+left-drag).
    function orbit(dx, dy) {
      const distance = Math.max(.5, pivotDistance());
      const toPivot = [gl.pivot[0] - gl.cam.x, gl.pivot[1] - gl.cam.y, gl.pivot[2] - gl.cam.z].map(v => v / distance);
      const pitch = clampPitch(Math.asin(Math.max(-1, Math.min(1, -toPivot[1]))) + dy * .006);
      const yaw = Math.atan2(-toPivot[2], -toPivot[0]) + dx * .008;
      Object.assign(gl.cam, { yaw, pitch });
      frame(gl.pivot, distance);
    }

    // Turn the view in place (right-drag).
    function look(dx, dy) {
      gl.cam.yaw += dx * .004;
      gl.cam.pitch = clampPitch(gl.cam.pitch + dy * .004);
    }

    // Pan the camera in screen space; it follows the mouse (middle-drag / left+right).
    function pan(dx, dy) {
      const scale = Math.max(5, pivotDistance()) / Math.max(300, $('gl3d').clientHeight) * 1.1;
      const forward = forwardOf(gl.cam.yaw, gl.cam.pitch);
      const right = rightOf(gl.cam.yaw);
      const up = [right[1] * forward[2] - right[2] * forward[1], right[2] * forward[0] - right[0] * forward[2], right[0] * forward[1] - right[1] * forward[0]];
      moveEye(right, dx * scale);
      moveEye(up, -dy * scale);
    }

    // Left-drag: vertical moves along the ground, horizontal turns (UE default).
    function walk(dx, dy) {
      gl.cam.yaw += dx * .005;
      moveEye([-Math.cos(gl.cam.yaw), 0, -Math.sin(gl.cam.yaw)], -dy * flySpeed() * .012);
    }

    // 2.5D navigation works on the ground plane: the map follows the mouse like a 2D map.
    function isoPanPixels(dx, dy) {
      const perPixel = gl.iso.size / Math.max(1, $('gl3d').clientHeight);
      const right = rightOf(gl.cam.yaw), ahead = groundForward();
      const along = dy * perPixel / Math.sin(gl.cam.pitch);
      for (let i = 0; i < 3; i++) gl.pivot[i] += -right[i] * dx * perPixel + ahead[i] * along;
    }

    // Wheel zoom in 2.5D keeps the ground point under the cursor in place.
    function isoZoomAt(factor, clientX, clientY) {
      const rect = $('gl3d').getBoundingClientRect();
      const ox = clientX - rect.left - rect.width / 2, oy = clientY - rect.top - rect.height / 2;
      const before = gl.iso.size;
      gl.iso.size = Math.max(4, Math.min(1500, gl.iso.size * factor));
      const shrink = (before - gl.iso.size) / Math.max(1, rect.height);
      const right = rightOf(gl.cam.yaw), ahead = groundForward();
      for (let i = 0; i < 3; i++) gl.pivot[i] += right[i] * ox * shrink - ahead[i] * oy * shrink / Math.sin(gl.cam.pitch);
    }

    // ⟲ / ⟳ and Q / E in 2.5D: turn 90° around the pivot (perspective view too).
    function rotateStep(sign) {
      if (isIso()) {
        gl.cam.yaw = snapIsoYaw(gl.cam.yaw) + sign * Math.PI / 2;
      } else {
        const distance = Math.max(.5, pivotDistance());
        gl.cam.yaw += sign * Math.PI / 2;
        frame(gl.pivot, distance);
      }
      request();
    }

    function setView(view) {
      if (view === gl.view || !gl.renderer) return;
      stopFlying();
      if (view === 'iso') {
        gl.iso.size = Math.max(6, Math.min(1500, 2 * Math.max(5, pivotDistance()) * Math.tan(gl.cam.fov * Math.PI / 360)));
        Object.assign(gl.cam, { yaw: snapIsoYaw(gl.cam.yaw), pitch: ISO_PITCH, fov: DEFAULT_FOV });
      } else {
        // Back to perspective at the same spot, a little steeper than eye level.
        Object.assign(gl.cam, { pitch: .7, fov: DEFAULT_FOV });
        frame(gl.pivot, Math.max(8, gl.iso.size / (2 * Math.tan(DEFAULT_FOV * Math.PI / 360))));
      }
      gl.view = view;
      syncTools();
      const params = new URLSearchParams(location.hash.replace(/^#/, ''));
      if (view === 'iso') params.set('cam', 'iso'); else params.delete('cam');
      history.replaceState(null, '', `${location.pathname}${location.search}#${params}`);
      request();
    }

    const HINTS = {
      persp: '按住<b>右键</b>：拖动环视 · <b>WASD</b> 飞行 · <b>Q/E</b> 降/升 · <b>Z/C</b> 视野 · 滚轮调速　|　<b>左键</b>拖动 前进/转向 · <b>中键</b>或左右键同按 平移 · <b>Alt</b>+左/右/中 绕转/推拉/平移 · 滚轮 前后 · 方向键 移动 · <b>F</b> 聚焦',
      iso: '<b>2.5D</b>：<b>左键</b>/<b>中键</b>拖动 平移 · <b>WASD</b>/方向键 平移 · 滚轮 缩放 · <b>Q/E</b> 或 ⟲⟳ 转 90° · <b>右键</b>拖动 自由旋转 · <b>F</b> 聚焦',
    };

    function syncTools() {
      const pairs = [['viewPerspBtn', !isIso()], ['viewIsoBtn', isIso()], ['cutBtn', gl.cutaway], ['shadowBtn', gl.shadows], ['miniBtn', gl.mini.on]];
      for (const [id, on] of pairs) {
        $(id).classList.toggle('active', on);
        $(id).setAttribute('aria-pressed', String(on));
      }
      $('gl3dHint').innerHTML = HINTS[gl.view];
    }

    /* Keyboard flight. WASD / QE / Z C only while the right button is held (UE);
       arrows and PageUp/PageDown work any time 3D is shown. Never while typing. */
    const RMB_KEYS = { KeyW: 'forward', KeyS: 'back', KeyA: 'left', KeyD: 'right', KeyE: 'up', KeyQ: 'down', KeyZ: 'fovOut', KeyC: 'fovIn' };
    const FREE_KEYS = { ArrowUp: 'forward', ArrowDown: 'back', ArrowLeft: 'left', ArrowRight: 'right', PageUp: 'up', PageDown: 'down' };
    const typing = target => target instanceof Element && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

    function flyBaseSpeed() {
      const b = ctx.boundsOf(state.data, state.floor);
      return Math.max(4, Math.min(30, Math.hypot(b.maxX - b.minX, b.maxZ - b.minZ) * .2));
    }

    function flySpeed() {
      return flyBaseSpeed() * SPEED_LEVELS[gl.fly.level] * (gl.fly.shift ? 3 : 1);
    }

    function showFlySpeed() {
      $('gl3dSpeed').textContent = `相机速度 ${gl.fly.level + 1}/${SPEED_LEVELS.length} · ${flySpeed().toFixed(1)} m/s`;
      $('gl3dSpeed').hidden = false;
      clearTimeout(showFlySpeed.timer);
      showFlySpeed.timer = setTimeout(() => { $('gl3dSpeed').hidden = true; }, 1200);
    }

    function flyTick(now) {
      gl.fly.frame = 0;
      if (state.mode !== '3d' || !gl.fly.keys.size) {
        gl.fly.last = 0;
        return;
      }
      const dt = gl.fly.last ? Math.min(.05, (now - gl.fly.last) / 1000) : 1 / 60;
      gl.fly.last = now;
      if (isIso()) {
        // Keyboard pans the map in 2.5D: about 80% of the view height per second.
        const step = gl.iso.size * .8 * (gl.fly.shift ? 3 : 1) * dt;
        const right = rightOf(gl.cam.yaw), ahead = groundForward();
        const dirs = { forward: [ahead, 1], back: [ahead, -1], right: [right, 1], left: [right, -1] };
        for (const key of gl.fly.keys) {
          if (!dirs[key]) continue;
          const [vector, sign] = dirs[key];
          for (let i = 0; i < 3; i++) gl.pivot[i] += vector[i] * sign * step;
        }
        draw();
        gl.fly.frame = requestAnimationFrame(flyTick);
        return;
      }
      const forward = forwardOf(gl.cam.yaw, gl.cam.pitch);
      const right = rightOf(gl.cam.yaw);
      const axes = { forward: [forward, 1], back: [forward, -1], right: [right, 1], left: [right, -1], up: [[0, 1, 0], 1], down: [[0, 1, 0], -1] };
      const move = [0, 0, 0];
      for (const key of gl.fly.keys) {
        if (key === 'fovOut') gl.cam.fov = Math.min(120, gl.cam.fov + 60 * dt);
        if (key === 'fovIn') gl.cam.fov = Math.max(10, gl.cam.fov - 60 * dt);
        if (!axes[key]) continue;
        const [vector, sign] = axes[key];
        for (let i = 0; i < 3; i++) move[i] += vector[i] * sign;
      }
      const length = Math.hypot(...move);
      if (length > 0) moveEye(move, flySpeed() * dt / length);
      draw();
      gl.fly.frame = requestAnimationFrame(flyTick);
    }

    function setFlyKey(code, down) {
      const action = RMB_KEYS[code] || FREE_KEYS[code];
      if (!action) return false;
      if (isIso()) {
        // 2.5D: WASD/arrows pan without the right button; Q/E turn 90°; the rest do nothing.
        if (code === 'KeyQ' || code === 'KeyE') {
          if (down) rotateStep(code === 'KeyQ' ? -1 : 1);
          return true;
        }
        if (!['forward', 'back', 'left', 'right'].includes(action)) return false;
      } else if (down && RMB_KEYS[code] && !gl.fly.rmb) return false;
      if (down) gl.fly.keys.add(action);
      else releaseAction(action);
      if (gl.fly.keys.size && !gl.fly.frame) gl.fly.frame = requestAnimationFrame(flyTick);
      return true;
    }

    // Z/C zoom only lasts while held; letting go springs the FOV back (UE).
    function releaseAction(action) {
      gl.fly.keys.delete(action);
      if ((action === 'fovOut' || action === 'fovIn') && gl.cam.fov !== DEFAULT_FOV) {
        gl.cam.fov = DEFAULT_FOV;
        request();
      }
    }

    function setRightButton(down) {
      if (gl.fly.rmb === down) return;
      gl.fly.rmb = down;
      if (!down) for (const action of new Set(Object.values(RMB_KEYS))) releaseAction(action);
    }

    function stopFlying() {
      for (const action of [...gl.fly.keys]) releaseAction(action);
      gl.fly.shift = false;
      gl.fly.rmb = false;
    }

    function bind() {
      const host = $('gl3d');
      const pinchDistance = () => {
        const [a, b] = [...gl.pointers.values()];
        return Math.hypot(a.x - b.x, a.y - b.y) || 1;
      };
      // Which drag the current button chord means (re-read on every move, so pressing a
      // second button mid-drag switches mode like UE's left+right pan).
      const dragMode = event => {
        if (isIso()) {
          if (event.buttons & 2) return 'isoRotate';
          return event.buttons & 5 || event.pointerType === 'touch' ? 'isoPan' : null;
        }
        if (event.pointerType === 'touch') return 'orbit';
        const left = event.buttons & 1, right = event.buttons & 2, middle = event.buttons & 4;
        if (event.altKey) return left ? 'orbit' : right ? 'dolly' : middle ? 'pan' : null;
        if (middle || (left && right)) return 'pan';
        if (right) return 'look';
        if (left) return event.shiftKey ? 'pan' : 'walk';
        return null;
      };
      host.addEventListener('contextmenu', event => event.preventDefault());
      host.addEventListener('pointerdown', event => {
        host.setPointerCapture(event.pointerId);
        gl.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        host.focus({ preventScroll: true });
        if (event.button === 1) event.preventDefault();
        setRightButton(!!(event.buttons & 2));
        gl.drag = {
          x: event.clientX, y: event.clientY, travel: gl.drag?.travel || 0,
          button: event.button, alt: event.altKey,
          mode: dragMode(event),
          pinch: gl.pointers.size === 2 ? pinchDistance() : 0,
        };
        host.classList.add('dragging');
      });
      host.addEventListener('pointermove', event => {
        if (!gl.drag || !gl.pointers.has(event.pointerId)) return;
        gl.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (gl.pointers.size === 2) {
          const distance = pinchDistance();
          if (gl.drag.pinch) zoom(gl.drag.pinch / distance);
          gl.drag.pinch = distance;
          gl.drag.travel += 10;
          return;
        }
        setRightButton(!!(event.buttons & 2));
        gl.drag.mode = dragMode(event) || gl.drag.mode;
        const dx = event.clientX - gl.drag.x, dy = event.clientY - gl.drag.y;
        gl.drag.x = event.clientX;
        gl.drag.y = event.clientY;
        gl.drag.travel += Math.abs(dx) + Math.abs(dy);
        if (gl.drag.travel <= 4) return;
        if (gl.drag.mode === 'walk') walk(dx, dy);
        else if (gl.drag.mode === 'look') look(dx, dy);
        else if (gl.drag.mode === 'pan') pan(dx, dy);
        else if (gl.drag.mode === 'orbit') orbit(dx, dy);
        else if (gl.drag.mode === 'dolly') zoom(Math.exp((dy - dx) * .005));
        else if (gl.drag.mode === 'isoPan') isoPanPixels(dx, dy);
        else if (gl.drag.mode === 'isoRotate') gl.cam.yaw += dx * .008;
        request();
      });
      const end = event => {
        const click = event.type === 'pointerup' && gl.drag?.button === 0 && !gl.drag.alt && gl.drag.travel <= 4 && gl.pointers.size === 1;
        setRightButton(!!(event.buttons & 2));
        if (event.buttons) return; // another button is still down: keep dragging
        gl.pointers.delete(event.pointerId);
        if (click) ctx.select(pick(event.clientX, event.clientY));
        if (!gl.pointers.size) {
          gl.drag = null;
          host.classList.remove('dragging');
        }
      };
      host.addEventListener('pointerup', end);
      host.addEventListener('pointercancel', end);
      host.addEventListener('dblclick', event => {
        const id = pick(event.clientX, event.clientY);
        if (!id) return;
        if (state.selected !== id) ctx.select(id);
        focus(id);
      });
      host.addEventListener('wheel', event => {
        event.preventDefault();
        if (isIso()) {
          isoZoomAt(Math.exp(event.deltaY * .0012), event.clientX, event.clientY);
          request();
          return;
        }
        if (gl.fly.rmb) {
          // Right button held: the wheel steps the camera speed (UE).
          gl.fly.level = Math.max(0, Math.min(SPEED_LEVELS.length - 1, gl.fly.level + (event.deltaY < 0 ? 1 : -1)));
          showFlySpeed();
          return;
        }
        // Otherwise move straight along the view, bigger steps when far from the pivot.
        const step = Math.max(.5, Math.min(40, pivotDistance() * .12)) * (event.deltaY < 0 ? 1 : -1);
        moveEye(forwardOf(gl.cam.yaw, gl.cam.pitch), step);
        request();
      }, { passive: false });
      window.addEventListener('keydown', event => {
        gl.fly.shift = event.shiftKey;
        if (state.mode !== '3d' || typing(event.target) || event.ctrlKey || event.metaKey || event.altKey) return;
        if (setFlyKey(event.code, true)) {
          event.preventDefault();
          return;
        }
        if (event.code === 'KeyF' && state.selected) focus(state.selected);
        if (event.key === 'Escape' && document.activeElement === host) ctx.select(null);
      });
      window.addEventListener('keyup', event => {
        gl.fly.shift = event.shiftKey;
        const action = RMB_KEYS[event.code] || FREE_KEYS[event.code];
        if (action) releaseAction(action);
      });
      window.addEventListener('blur', stopFlying);
      if (window.ResizeObserver) new ResizeObserver(request).observe(host);
      $('viewPerspBtn').onclick = () => setView('persp');
      $('viewIsoBtn').onclick = () => setView('iso');
      $('rotLeftBtn').onclick = () => rotateStep(-1);
      $('rotRightBtn').onclick = () => rotateStep(1);
      $('cutBtn').onclick = () => { gl.cutaway = !gl.cutaway; syncTools(); sync(); };
      $('shadowBtn').onclick = () => { gl.shadows = !gl.shadows; syncTools(); sync(); };
      $('miniBtn').onclick = () => { gl.mini.on = !gl.mini.on; syncTools(); request(); };
      const mini = $('gl3dMini');
      mini.addEventListener('pointerdown', event => { mini.setPointerCapture(event.pointerId); miniTeleport(event); });
      mini.addEventListener('pointermove', event => { if (event.buttons & 1) miniTeleport(event); });
    }

    async function setMode(mode) {
      const want3d = mode === '3d';
      state.mode = want3d ? '3d' : '2d';
      $('map').hidden = want3d;
      $('gl3d').hidden = !want3d;
      $('gl3dHint').hidden = !want3d;
      $('tools3d').hidden = !want3d;
      if (!want3d) $('gl3dMini').hidden = true;
      for (const [id, active] of [['view2dBtn', !want3d], ['view3dBtn', want3d]]) {
        $(id).classList.toggle('active', active);
        $(id).setAttribute('aria-pressed', String(active));
      }
      const params = new URLSearchParams(location.hash.replace(/^#/, ''));
      if (want3d) params.set('view', '3d'); else params.delete('view');
      history.replaceState(null, '', `${location.pathname}${location.search}#${params}`);
      if (!want3d) {
        stopFlying();
        ctx.applyView();
        $('live').textContent = '已切换到 2D 平面';
        return;
      }
      $('zoomLabel').textContent = '';
      try {
        if (!gl.renderer) {
          $('gl3d').innerHTML = '<div class="wb-gl-msg">正在加载 3D 块面…</div>';
          gl.THREE = await loadThree();
          const renderer = new gl.THREE.WebGLRenderer({ antialias: true });
          renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
          renderer.shadowMap.enabled = true;
          renderer.shadowMap.type = gl.THREE.PCFSoftShadowMap;
          $('gl3d').innerHTML = '';
          $('gl3d').appendChild(renderer.domElement);
          gl.renderer = renderer;
          gl.persp = new gl.THREE.PerspectiveCamera(DEFAULT_FOV, 1, .1, 3000);
          gl.ortho = new gl.THREE.OrthographicCamera(-1, 1, 1, -1, 1, ISO_DISTANCE * 2 + 500);
          gl.camera = gl.persp;
          bind();
          if (new URLSearchParams(location.hash.replace(/^#/, '')).get('cam') === 'iso') gl.view = 'iso';
          syncTools();
        }
        if (state.mode !== '3d') return;
        gl.error = '';
        ctx.renderMapMeta();
        sync();
        $('live').textContent = '已切换到 3D 块面';
      } catch (error) {
        gl.error = String(error?.message || error);
        console.warn('[workbench 3D]', error);
        $('gl3d').innerHTML = '';
        ctx.toast(`3D 不可用：${gl.error}；已回到 2D`);
        setMode('2d');
      }
    }

    // "x,y,z,yaw,pitch,view,isoSize,pivotX,pivotY,pivotZ" — what 复制链接 stores as #pose=.
    function pose() {
      const r = value => +value.toFixed(2);
      const angle = value => +value.toFixed(4);
      return [r(gl.cam.x), r(gl.cam.y), r(gl.cam.z), angle(gl.cam.yaw), angle(gl.cam.pitch)]
        .concat(gl.view, r(gl.iso.size), ...gl.pivot.map(r)).join(',');
    }

    function setPose(text) {
      const parts = String(text || '').split(',');
      const nums = parts.map(Number);
      if (parts.length < 10 || [0, 1, 2, 3, 4, 6, 7, 8, 9].some(i => !Number.isFinite(nums[i]))) return false;
      if (parts[5] !== gl.view) setView(parts[5] === 'iso' ? 'iso' : 'persp');
      Object.assign(gl.cam, { x: nums[0], y: nums[1], z: nums[2], yaw: nums[3], pitch: nums[4] });
      gl.iso.size = nums[6];
      gl.pivot = [nums[7], nums[8], nums[9]];
      request();
      return true;
    }

    return {
      setMode,
      pose,
      setPose,
      sync,
      fit: () => { if (gl.scene) { fit(); request(); } },
      zoom,
      focus,
      setCursor,
      lookAt: lookAtPoint,
      debug: {
        get ready() { return state.mode === '3d' && !!gl.scene; },
        get error() { return gl.error; },
        get stats() {
          const counts = { walls: gl.walls, ghosts: gl.ghosts, labels: gl.labels.length, pickables: gl.pickables.length, tag: !!gl.tag };
          for (const object of gl.pickables) counts[object.userData.type] = (counts[object.userData.type] || 0) + 1;
          return counts;
        },
        get camera() {
          const round = value => +value.toFixed(3);
          return {
            eye: eyeOf().map(round), yaw: gl.cam.yaw, pitch: gl.cam.pitch, fov: gl.cam.fov,
            forward: forwardOf(gl.cam.yaw, gl.cam.pitch), pivot: gl.pivot.map(round), dist: pivotDistance(),
            view: gl.view, ortho: !!gl.camera?.isOrthographicCamera, isoSize: gl.iso.size,
          };
        },
        get look() {
          let shadowCasters = 0;
          gl.scene?.traverse(object => { if (object.castShadow) shadowCasters += 1; });
          let meshes = 0;
          gl.scene?.traverse(object => { if (object.isMesh || object.isLine) meshes += 1; });
          return { mini: !$('gl3dMini').hidden, footprint: gl.mini.footprint, cutaway: gl.cutaway, shadows: gl.shadows, wallTop: gl.wallTop, shadowCasters, cursor: !!gl.cursor, heatPlanes: gl.heatPlanes || 0, distPlanes: gl.distPlanes || 0, drawables: meshes, drawCalls: gl.renderer?.info.render.calls || 0 };
        },
        get fly() { return { keys: [...gl.fly.keys], level: gl.fly.level, rmb: gl.fly.rmb, speed: flySpeed() }; },
        // Each mesh of an entity as plan [centre x, centre z, top y] (merged meshes keep
        // their transform baked into the vertices, so read the bounding box, not .position).
        positions(id) {
          return gl.pickables.filter(object => object.userData.id === id).map(object => {
            const box = new gl.THREE.Box3().setFromObject(object);
            const center = box.getCenter(new gl.THREE.Vector3());
            return [+center.x.toFixed(2), +(-center.z).toFixed(2), +box.max.y.toFixed(2)];
          });
        },
        screenOf,
        pick,
      },
    };
  };
})();
