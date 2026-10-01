/* Chapouu — the burger that puts itself together as you scroll.
   Everything here is procedural geometry: no models, no textures to load. */
import * as THREE from 'three';

const host = document.getElementById('scene');
const state = window.chapouu || { p: 0, pointer: { x: 0, y: 0 }, reduced: false };
const buildSection = document.getElementById('build');

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const easeOutCubic = (x) => 1 - Math.pow(1 - x, 3);
const easeOutBack = (x) => {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
};

/* -------------------------------------------------------------------------
   Brand palette
   ------------------------------------------------------------------------- */
const C = {
  bunTop:   0xD08A4E,
  bunBase:  0xB9683A,
  patty:    0x8A4A34,
  cheese:   0xE9A03C,
  onion:    0xF0DAC0,
  tomato:   0xE44621,
  lettuce:  0x6E9D6E,
  sesame:   0xFBEBCE,
  teal:     0x3E7571,
  tealInk:  0x1B3937,
  clay:     0xAD523F,
  tan:      0xCA7247,
  sand:     0xFDF3E3,
  flame:    0xE44621
};

let renderer, scene, camera, root, spin, shadow, hemi, rim;
const parts = [];
let running = false;

/* -------------------------------------------------------------------------
   Geometry helpers
   ------------------------------------------------------------------------- */
function slabProfile(radius, height, corner, seg = 7) {
  const r = Math.min(corner, height / 2, radius / 2);
  const pts = [new THREE.Vector2(0, 0), new THREE.Vector2(radius - r, 0)];
  for (let i = 0; i <= seg; i++) {
    const a = -Math.PI / 2 + (i / seg) * (Math.PI / 2);
    pts.push(new THREE.Vector2(radius - r + Math.cos(a) * r, r + Math.sin(a) * r));
  }
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * (Math.PI / 2);
    pts.push(new THREE.Vector2(radius - r + Math.cos(a) * r, height - r + Math.sin(a) * r));
  }
  pts.push(new THREE.Vector2(0, height));
  return pts;
}

function slab(radius, height, corner, segments = 72) {
  const geo = new THREE.LatheGeometry(slabProfile(radius, height, corner), segments);
  geo.translate(0, -height / 2, 0);
  geo.computeVertexNormals();
  return geo;
}

function domeGeometry(radius, height, rim = 0.2, seg = 26, segments = 72) {
  const pts = [new THREE.Vector2(0, 0), new THREE.Vector2(radius * 0.965, 0)];
  for (let i = 0; i <= seg; i++) {
    const u = i / seg;
    const a = u * Math.PI / 2;
    pts.push(new THREE.Vector2(
      radius * Math.pow(Math.cos(a), 0.72),
      rim + (height - rim) * Math.pow(Math.sin(a), 0.92)
    ));
  }
  const geo = new THREE.LatheGeometry(pts, segments);
  geo.translate(0, -height / 2, 0);
  geo.computeVertexNormals();
  return geo;
}

function roughen(geo, amp, freq) {
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const n = Math.sin(x * freq + z * freq * 0.8) * Math.cos(z * freq * 0.95 - y * freq * 0.6);
    const r = Math.hypot(x, z);
    if (r > 0.25) {
      pos.setX(i, x * (1 + n * amp));
      pos.setZ(i, z * (1 + n * amp));
    }
    pos.setY(i, y + n * amp * 0.7);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

function mat(color, roughness = 0.82, extra = {}) {
  return new THREE.MeshStandardMaterial(
    Object.assign({ color, roughness, metalness: 0.02 }, extra)
  );
}

function roundedSquare(size, radius) {
  const s = size / 2, r = radius;
  const shape = new THREE.Shape();
  shape.moveTo(-s + r, -s);
  shape.lineTo(s - r, -s);
  shape.quadraticCurveTo(s, -s, s, -s + r);
  shape.lineTo(s, s - r);
  shape.quadraticCurveTo(s, s, s - r, s);
  shape.lineTo(-s + r, s);
  shape.quadraticCurveTo(-s, s, -s, s - r);
  shape.lineTo(-s, -s + r);
  shape.quadraticCurveTo(-s, -s, -s + r, -s);
  return shape;
}

function shadowTexture() {
  const size = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(15,40,38,.62)');
  g.addColorStop(0.45, 'rgba(15,40,38,.28)');
  g.addColorStop(1, 'rgba(15,40,38,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* -------------------------------------------------------------------------
   The stack
   ------------------------------------------------------------------------- */
function buildBun(kind) {
  const g = new THREE.Group();
  if (kind === 'top') {
    const dome = new THREE.Mesh(domeGeometry(2.16, 1.30, 0.22), mat(C.bunTop, 0.86));
    g.add(dome);

    const seedGeo = new THREE.SphereGeometry(1, 10, 8);
    const seeds = new THREE.InstancedMesh(seedGeo, mat(C.sesame, 0.6), 30);
    const dummy = new THREE.Object3D();
    const v = new THREE.Vector3();
    for (let i = 0; i < 30; i++) {
      const u = 0.10 + Math.random() * 0.72;
      const a = u * Math.PI / 2;
      const theta = Math.random() * Math.PI * 2;
      const rr = 2.16 * Math.pow(Math.cos(a), 0.72) * 0.985;
      const yy = 0.22 + (1.30 - 0.22) * Math.pow(Math.sin(a), 0.92) - 1.30 / 2;
      v.set(Math.cos(theta) * rr, yy, Math.sin(theta) * rr);
      dummy.position.copy(v);
      dummy.lookAt(v.x * 1.8, v.y * 1.4 + 0.25, v.z * 1.8);
      dummy.rotation.z = Math.random() * Math.PI;
      dummy.scale.set(0.088, 0.056, 0.035);
      dummy.updateMatrix();
      seeds.setMatrixAt(i, dummy.matrix);
    }
    seeds.instanceMatrix.needsUpdate = true;
    g.add(seeds);
    g.add(buildHats());
  } else {
    g.add(new THREE.Mesh(slab(2.05, 0.70, 0.26), mat(C.bunBase, 0.88)));
    const face = new THREE.Mesh(
      new THREE.CircleGeometry(1.84, 64),
      mat(0xE0BC90, 0.95)
    );
    face.rotation.x = -Math.PI / 2;
    face.position.y = 0.332;
    g.add(face);
  }
  return g;
}

function buildPatty() {
  const geo = roughen(slab(1.94, 0.46, 0.18), 0.02, 8.5);
  return new THREE.Mesh(geo, mat(C.patty, 0.95));
}

function buildCheese() {
  const g = new THREE.Group();
  const shape = roundedSquare(3.05, 0.34);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.06, bevelEnabled: true, bevelSize: 0.045, bevelThickness: 0.03, bevelSegments: 3, curveSegments: 12
  });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, -0.03, 0);
  const material = mat(C.cheese, 0.6);
  const slice = new THREE.Mesh(geo, material);
  slice.rotation.y = Math.PI / 4;
  g.add(slice);

  const dripGeo = new THREE.SphereGeometry(1, 16, 12);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const drip = new THREE.Mesh(dripGeo, material);
    drip.position.set(Math.cos(a) * 1.48, -0.13, Math.sin(a) * 1.48);
    drip.rotation.y = -a;
    drip.scale.set(0.09, 0.34, 0.46);
    g.add(drip);
  }
  return g;
}

function buildOnion() {
  const g = new THREE.Group();
  [[1.62, 0.115], [1.16, 0.10], [0.72, 0.085]].forEach(([r, t], i) => {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(r, t, 10, 64),
      mat(C.onion, 0.72)
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = i * 0.012;
    ring.scale.y = 0.8;
    g.add(ring);
  });
  return g;
}

function buildTomato() {
  const g = new THREE.Group();
  const skin = new THREE.Mesh(slab(1.90, 0.30, 0.11), mat(C.tomato, 0.55));
  g.add(skin);
  const flesh = new THREE.Mesh(new THREE.CircleGeometry(1.66, 48), mat(0xF07A4E, 0.7));
  flesh.rotation.x = -Math.PI / 2;
  flesh.position.y = 0.152;
  g.add(flesh);
  return g;
}

function buildLettuce() {
  const geo = new THREE.TorusGeometry(1.82, 0.30, 14, 160);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const theta = Math.atan2(z, x);
    const wave = Math.sin(theta * 6) * 0.55 + Math.sin(theta * 11 + 1.2) * 0.3 + Math.sin(theta * 19 + 2.4) * 0.14;
    const k = 1 + wave * 0.11;
    pos.setX(i, x * k);
    pos.setZ(i, z * k);
    pos.setY(i, y * 0.46 + wave * 0.26);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, mat(C.lettuce, 0.78, { side: THREE.DoubleSide }));
}

/* -------------------------------------------------------------------------
   Hats. "Chapouu" is a hat — so the burger wears one, and you can swap it.
   ------------------------------------------------------------------------- */
/* Height of the top bun's dome at a given distance from its axis, measured
   from the bun's own centre. Hat brims trace this so they sit on the bread
   instead of slicing through it. */
const BUN_R = 2.16, BUN_H = 1.30, BUN_RIM = 0.22;
function bunSurface(r) {
  const cosA = Math.pow(Math.min(r / BUN_R, 1), 1 / 0.72);
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  return BUN_RIM + (BUN_H - BUN_RIM) * Math.pow(sinA, 0.92) - BUN_H / 2;
}

/* A brim: hugs the dome out to `seat`, then sweeps down and flicks back up. */
function brimGeometry(R, seat, lift, thick, drop, curl, seg = 30, segments = 80) {
  const ySeat = bunSurface(seat) + lift;
  const top = [];
  for (let i = 0; i <= seg; i++) {
    const r = (i / seg) * R;
    top.push(new THREE.Vector2(
      r,
      r <= seat
        ? bunSurface(r) + lift
        : ySeat - drop * ((r - seat) / (R - seat)) + curl * Math.pow((r - seat) / (R - seat), 3.4)
    ));
  }
  /* Trace the underside outward first, then the top back in, so the lathe
     ends up with outward-facing normals. */
  const pts = top.map((p) => new THREE.Vector2(p.x, p.y - thick));
  for (let i = top.length - 1; i >= 0; i--) pts.push(top[i]);
  const geo = new THREE.LatheGeometry(pts, segments);
  geo.computeVertexNormals();
  return geo;
}

/* 1 — the logo hat: sombrero brim, clay crown, and the little parasol. */
function hatSombrero() {
  const g = new THREE.Group();
  const seat = 1.55, lift = 0.15, ySeat = bunSurface(seat) + lift;
  g.add(new THREE.Mesh(brimGeometry(2.62, seat, lift, 0.075, 0.44, 0.46), mat(C.flame, 0.72)));

  const crown = new THREE.Mesh(domeGeometry(seat, 0.86, 0.16), mat(C.clay, 0.85));
  crown.position.y = ySeat + 0.43;
  g.add(crown);

  const band = new THREE.Mesh(new THREE.TorusGeometry(seat + 0.07, 0.11, 10, 56), mat(C.clay, 0.7));
  band.rotation.x = -Math.PI / 2;
  band.position.y = ySeat + 0.06;
  band.scale.y = 0.7;
  g.add(band);

  /* the parasol stick and its ribbon, straight off the logo */
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.04, 0.9, 10), mat(C.clay, 0.6));
  stick.position.set(0.1, ySeat + 1.28, 0);
  stick.rotation.z = -0.12;
  g.add(stick);

  const ribbon = mat(C.flame, 0.6);
  for (let i = 0; i < 3; i++) {
    const f = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.13, 0.07), ribbon);
    f.position.set(0.28 + (i % 2) * 0.22, ySeat + 1.62 + i * 0.2, 0);
    f.rotation.z = i % 2 ? 0.5 : -0.5;
    g.add(f);
  }
  return g;
}

/* 2 — the straw sun hat, for the long afternoons. */
function hatStraw() {
  const g = new THREE.Group();
  const seat = 1.62, lift = 0.15, ySeat = bunSurface(seat) + lift;
  g.add(new THREE.Mesh(brimGeometry(2.86, seat, lift, 0.06, 0.62, 0.12), mat(0xDDBC7E, 0.94)));

  const crown = new THREE.Mesh(domeGeometry(seat, 0.56, 0.14), mat(0xE6CB96, 0.94));
  crown.position.y = ySeat + 0.28;
  g.add(crown);

  const ribbon = new THREE.Mesh(new THREE.TorusGeometry(seat + 0.07, 0.10, 10, 56), mat(C.teal, 0.7));
  ribbon.rotation.x = -Math.PI / 2;
  ribbon.position.y = ySeat + 0.05;
  ribbon.scale.y = 0.75;
  g.add(ribbon);
  return g;
}

/* 3 — the cap, for the people running the grill. */
function hatCap() {
  const g = new THREE.Group();
  const seat = 2.14, lift = 0.21;
  /* turn the bill side-on: pointed at the camera it just reads as a line */
  g.rotation.y = -0.95 - 1.15;
  const ySeat = bunSurface(seat) + lift;

  /* the crown is a shell moulded to the bun, like a cap pulled down */
  g.add(new THREE.Mesh(brimGeometry(seat, seat, lift, 0.09, 0, 0), mat(C.teal, 0.78)));

  /* The bill is a half disc hidden under the crown; only the part past the
     bread shows, so it has to sit high and tilt gently or it vanishes. */
  const billGeo = new THREE.CylinderGeometry(3.25, 3.25, 0.11, 56, 1, false, Math.PI, Math.PI);
  billGeo.rotateY(Math.PI / 2);
  const bill = new THREE.Mesh(billGeo, mat(C.flame, 0.65));
  bill.position.set(0, 0.20, 0);
  bill.rotation.x = 0.19;
  bill.scale.set(0.8, 1, 1);
  g.add(bill);

  const band = new THREE.Mesh(new THREE.TorusGeometry(seat + 0.02, 0.075, 10, 56), mat(C.tealInk, 0.7));
  band.rotation.x = -Math.PI / 2;
  band.position.y = ySeat + 0.02;
  g.add(band);

  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 12), mat(C.flame, 0.6));
  knob.position.y = bunSurface(0) + lift + 0.08;
  g.add(knob);
  return g;
}

const HAT_MAKERS = [hatSombrero, hatStraw, hatCap];
const hats = [];

function buildHats() {
  const mount = new THREE.Group();
  mount.position.y = 0;
  mount.rotation.set(-0.035, 0, 0.07);
  HAT_MAKERS.forEach((make, i) => {
    const hat = make();
    hat.userData.s = i === 0 ? 1 : 0;
    hat.scale.setScalar(hat.userData.s);
    hat.visible = i === 0;
    hats.push(hat);
    mount.add(hat);
  });
  return mount;
}

/* Layer table — bottom of the stack first. --------------------------------- */
const RECIPE = [
  { make: () => buildBun('bottom'), h: 0.70, gap: 0.00, from: [-2.6, -2.8, 1.2], rot: [0.5, 1.2, -0.6] },
  { make: buildPatty,              h: 0.46, gap: -0.09, from: [ 3.0,  1.0, -1.6], rot: [-0.8, -0.6, 0.5] },
  { make: buildCheese,             h: 0.14, gap: -0.06, from: [-2.2,  2.0, -1.0], rot: [1.1, 0.8, 0.9] },
  { make: buildOnion,              h: 0.24, gap: -0.11, from: [ 2.6, -2.2, 0.9], rot: [-1.2, 1.4, -0.4] },
  { make: buildTomato,             h: 0.32, gap: -0.10, from: [-3.0,  0.4, -0.7], rot: [0.9, -1.1, 0.7] },
  { make: buildLettuce,            h: 0.34, gap: -0.17, from: [ 2.2,  1.8, 1.4], rot: [-0.7, 0.9, 1.2] },
  { make: () => buildBun('top'),   h: 1.30, gap: -0.13, from: [ 0.3,  3.0, -0.5], rot: [0.35, -1.5, 0.25] }
];

const SPAN = 0.30;
const LAST = 0.88;
const STEP = (LAST - SPAN) / (RECIPE.length - 1);

/* -------------------------------------------------------------------------
   Boot
   ------------------------------------------------------------------------- */
function init() {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.8));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  host.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(34, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.set(0, 2.4, 14);

  hemi = new THREE.HemisphereLight(0xFFFBF3, C.sand, 1.05);
  scene.add(hemi);

  const key = new THREE.DirectionalLight(0xFFF4E2, 2.15);
  key.position.set(5, 9, 7);
  scene.add(key);

  const fill = new THREE.DirectionalLight(0xCFE7E2, 0.7);
  fill.position.set(-6, 3, 5);
  scene.add(fill);

  rim = new THREE.DirectionalLight(C.flame, 0.6);
  rim.position.set(-5, -2, -7);
  scene.add(rim);

  root = new THREE.Group();
  scene.add(root);

  spin = new THREE.Group();
  root.add(spin);

  shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(7.2, 7.2),
    new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false, opacity: 0 })
  );
  shadow.rotation.x = -Math.PI / 2;
  root.add(shadow);

  let cursor = 0;
  RECIPE.forEach((entry, i) => {
    cursor += entry.gap;
    const targetY = cursor + entry.h / 2;
    cursor += entry.h;

    const obj = entry.make();
    spin.add(obj);
    parts.push({
      obj,
      target: new THREE.Vector3(0, targetY, 0),
      from: new THREE.Vector3().fromArray(entry.from),
      rot: new THREE.Euler().fromArray(entry.rot),
      t0: i * STEP,
      seed: i * 1.7 + 0.4
    });
  });

  /* Centre the stack on the group origin */
  const total = cursor;
  parts.forEach((p) => { p.target.y -= total / 2; });
  shadow.position.y = -total / 2 - 0.02;

  window.addEventListener('resize', onResize, { passive: true });
  onResize();

  host.classList.add('is-ready');
  running = true;
  renderer.setAnimationLoop(frame);
}

function onResize() {
  if (!renderer) return;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

/* -------------------------------------------------------------------------
   Frame
   ------------------------------------------------------------------------- */
const clock = new THREE.Clock();
let camZ = 14, camY = 2.4;
const GROUND_A = new THREE.Color(C.sand);
const GROUND_B = new THREE.Color(C.tealInk);

function frame() {
  const t = clock.getElapsedTime();
  const p = state.reduced ? 1 : clamp(state.p, 0, 1);

  /* Ride the section out of frame, then stop drawing entirely */
  let exit = 0;
  if (buildSection) {
    const rect = buildSection.getBoundingClientRect();
    if (rect.bottom < -80) { host.style.opacity = 0; return; }
    host.style.opacity = '';
    exit = clamp((window.innerHeight - rect.bottom) / window.innerHeight, 0, 1);
  }

  const settle = clamp((p - LAST) / (1 - LAST), 0, 1);

  /* Camera pushes in as the burger comes together, then eases back out */
  const camEase = easeOutCubic(clamp(p / LAST, 0, 1));
  const targetZ = lerp(15.2, 11.4, camEase) + settle * 1.2;
  const targetY = lerp(3.1, 1.35, camEase);
  camZ = lerp(camZ, targetZ, 0.06);
  camY = lerp(camY, targetY, 0.06);

  /* Layout: fit the cluster to the free half of the screen. The bounding box
     shrinks as the parts converge, so the framing tightens with the assembly. */
  const ease = easeOutCubic(clamp(p / LAST, 0, 1));
  const vh = 2 * Math.tan((camera.fov / 2) * Math.PI / 180) * camZ;
  const vw = vh * camera.aspect;
  const narrow = window.innerWidth < 1080;

  const needW = lerp(10.4, 6.6, ease);
  const needH = lerp(7.0, 4.9, ease);
  const availW = vw * (narrow ? 0.90 : lerp(0.50, 0.56, ease));
  const availH = vh * (narrow ? 0.40 : 0.78);

  root.scale.setScalar(clamp(Math.min(availW / needW, availH / needH), 0.25, 2.4));
  root.position.x = narrow ? 0 : vw * lerp(0.25, 0.215, ease);
  root.position.y = (narrow ? -vh * 0.325 : lerp(-0.45, 0.3, ease)) + exit * vh;

  camera.position.set(
    state.pointer.x * 0.5,
    camY - state.pointer.y * 0.35,
    camZ
  );
  camera.lookAt(root.position.x * 0.55, 0.15, 0);

  /* Whole-stack rotation: a slow turn plus a nudge as it locks together */
  spin.rotation.y = -0.6 + ease * 1.55 + t * 0.05;
  spin.rotation.z = lerp(0.06, 0, easeOutCubic(p));

  /* Each ingredient flies in on its own window */
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const lp = clamp((p - part.t0) / SPAN, 0, 1);
    const ePos = easeOutBack(lp);
    const eRot = easeOutCubic(lp);
    const loose = 1 - eRot;

    part.obj.position.set(
      lerp(part.from.x, part.target.x, ePos) + Math.sin(t * 0.7 + part.seed) * 0.20 * loose,
      lerp(part.from.y, part.target.y, ePos) + Math.sin(t * 0.55 + part.seed * 1.6) * 0.24 * loose,
      lerp(part.from.z, part.target.z, ePos) + Math.cos(t * 0.6 + part.seed) * 0.20 * loose
    );

    part.obj.rotation.set(
      part.rot.x * loose + Math.sin(t * 0.4 + part.seed) * 0.25 * loose,
      part.rot.y * loose + t * 0.25 * loose,
      part.rot.z * loose + Math.cos(t * 0.35 + part.seed) * 0.25 * loose
    );

    /* A little squash on landing, then spring back */
    let squash = 1;
    if (lp > 0.72 && lp < 1) squash = 1 - Math.sin(((lp - 0.72) / 0.28) * Math.PI) * 0.07;
    part.obj.scale.set(2 - squash, squash, 2 - squash);
  }

  /* Hat swap: the outgoing one shrinks away, the new one pops in */
  const wanted = Math.min(Math.max(state.hat | 0, 0), hats.length - 1);
  for (let i = 0; i < hats.length; i++) {
    const hat = hats[i];
    const goal = i === wanted ? 1 : 0;
    hat.userData.s = lerp(hat.userData.s, goal, 0.16);
    if (Math.abs(hat.userData.s - goal) < 0.002) hat.userData.s = goal;
    const sc = hat.userData.s;
    hat.visible = sc > 0.01;
    if (!hat.visible) continue;
    hat.scale.setScalar(sc * (1 + Math.sin(Math.min(sc, 1) * Math.PI) * 0.14));
    hat.rotation.y = (1 - sc) * 1.6;
  }

  /* Light and shadow follow the backdrop from sand into deep teal */
  hemi.groundColor.copy(GROUND_A).lerp(GROUND_B, clamp(p * 1.5, 0, 1));
  rim.intensity = 0.5 + clamp(p * 1.4, 0, 1) * 1.2;
  shadow.material.opacity = clamp(p * 1.6, 0, 1) * 0.5;
  shadow.scale.setScalar(lerp(0.7, 1, easeOutCubic(p)));

  renderer.render(scene, camera);
}

/* -------------------------------------------------------------------------
   Start, or step aside quietly
   ------------------------------------------------------------------------- */
try {
  const probe = document.createElement('canvas');
  const ok = !!(window.WebGLRenderingContext &&
    (probe.getContext('webgl2') || probe.getContext('webgl')));
  if (!ok) throw new Error('no webgl');
  init();
} catch (err) {
  document.documentElement.classList.add('no-webgl');
  console.warn('Chapouu scene disabled:', err && err.message);
}
