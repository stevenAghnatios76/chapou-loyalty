/* Chapouu — the burger that puts itself together as you scroll.
   Everything here is procedural geometry: no models, no textures to load. */
import * as THREE from 'three';

const host = document.getElementById('scene');
const state = window.chapouu || { p: 0, pointer: { x: 0, y: 0 }, reduced: false };
const buildSection = document.getElementById('build');
const stickyEl = document.querySelector('.build-sticky');
const stageEl = document.querySelector('.build-stage');
const buildCopy = document.querySelector('.build-copy');
const heroCopy = document.querySelector('.hero-copy');
const pickerEl = document.querySelector('.hat-picker');

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const easeOutCubic = (x) => 1 - Math.pow(1 - x, 3);
const easeInOutCubic = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
/* Frame-rate independent smoothing: the same feel at 60, 120 or 30 fps. */
const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));

/* Seeded, so it is the same burger on every load. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* -------------------------------------------------------------------------
   Brand palette
   ------------------------------------------------------------------------- */
const C = {
  bunTop:   0xD08A4E,
  bunBase:  0xB9683A,
  patty:    0x8A4A34,
  cheese:   0xF0A531,
  onion:    0xF0DAC0,
  tomato:   0xE44621,
  lettuce:  0x6E9D6E,
  sesame:   0xFBEBCE,
  sauce:    0xEE8F5A,
  teal:     0x3E7571,
  tealInk:  0x1B3937,
  clay:     0xAD523F,
  tan:      0xCA7247,
  sand:     0xFDF3E3,
  flame:    0xE44621
};

let renderer, scene, camera, root, spin, shadow, hemi, key, rim, hatMount, cheeseMesh;
const parts = [];

/* -------------------------------------------------------------------------
   Geometry helpers
   ------------------------------------------------------------------------- */
function slabProfile(radius, height, corner, seg = 7, flat = 1) {
  const r = Math.min(corner, height / 2, radius / 2);
  const pts = [];
  for (let i = 0; i < flat; i++) pts.push(new THREE.Vector2((radius - r) * (i / flat), 0));
  for (let i = 0; i <= seg; i++) {
    const a = -Math.PI / 2 + (i / seg) * (Math.PI / 2);
    pts.push(new THREE.Vector2(radius - r + Math.cos(a) * r, r + Math.sin(a) * r));
  }
  for (let i = 1; i <= seg; i++) {
    const a = (i / seg) * (Math.PI / 2);
    pts.push(new THREE.Vector2(radius - r + Math.cos(a) * r, height - r + Math.sin(a) * r));
  }
  for (let i = 1; i <= flat; i++) pts.push(new THREE.Vector2((radius - r) * (1 - i / flat), height));
  return pts;
}

/* Recompute normals, then average them across vertices that share a position.
   A lathe duplicates its seam and its poles, and without this the seam shows
   up as a faint crease down one side. */
function weldNormals(geo) {
  geo.computeVertexNormals();
  const pos = geo.attributes.position, nor = geo.attributes.normal;
  const groups = new Map();
  for (let i = 0; i < pos.count; i++) {
    const k = Math.round(pos.getX(i) * 1e4) + ',' + Math.round(pos.getY(i) * 1e4) + ',' + Math.round(pos.getZ(i) * 1e4);
    const g = groups.get(k);
    if (g) g.push(i); else groups.set(k, [i]);
  }
  const n = new THREE.Vector3();
  groups.forEach((g) => {
    if (g.length < 2) return;
    n.set(0, 0, 0);
    g.forEach((i) => { n.x += nor.getX(i); n.y += nor.getY(i); n.z += nor.getZ(i); });
    n.normalize();
    g.forEach((i) => nor.setXYZ(i, n.x, n.y, n.z));
  });
  return geo;
}

function slab(radius, height, corner, segments = 72, flat = 1) {
  const geo = new THREE.LatheGeometry(slabProfile(radius, height, corner, 7, flat), segments);
  geo.translate(0, -height / 2, 0);
  return weldNormals(geo);
}

/* `lip` rounds the underside into the dome — bread, rather than a cut cap. */
function domeGeometry(radius, height, rim = 0.2, seg = 26, segments = 72, lip = 0) {
  const pts = [new THREE.Vector2(0, 0)];
  if (lip > 0) {
    for (let i = 1; i <= 4; i++) pts.push(new THREE.Vector2((radius - lip) * (i / 4), 0));
    for (let i = 1; i <= 5; i++) {
      const a = (i / 6) * (Math.PI / 2);
      pts.push(new THREE.Vector2(radius - lip + Math.sin(a) * lip, rim - Math.cos(a) * rim));
    }
  } else {
    pts.push(new THREE.Vector2(radius * 0.965, 0));
  }
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
  return weldNormals(geo);
}

/* Paint a geometry per vertex. `fn(color, x, y, z)` fills in the colour. */
function tint(geo, fn) {
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    fn(c, pos.getX(i), pos.getY(i), pos.getZ(i));
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

function mat(color, roughness = 0.82, extra = {}) {
  return new THREE.MeshStandardMaterial(
    Object.assign({ color, roughness, metalness: 0.02 }, extra)
  );
}

/* Vertex-painted, with an optional glaze on top. */
function painted(roughness = 0.82, extra = {}) {
  return new THREE.MeshPhysicalMaterial(
    Object.assign({ color: 0xffffff, vertexColors: true, roughness, metalness: 0.02 }, extra)
  );
}

function canvasTexture(size, draw) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  draw(cv.getContext('2d'), size);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function shadowTexture() {
  return canvasTexture(256, (ctx, size) => {
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(15,40,38,.62)');
    g.addColorStop(0.45, 'rgba(15,40,38,.28)');
    g.addColorStop(1, 'rgba(15,40,38,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  });
}

/* The cut face of the bun: pale crumb, toasted darker toward the rim. */
function toastTexture() {
  return canvasTexture(256, (ctx, S) => {
    const c = S / 2, rand = rng(7);
    const g = ctx.createRadialGradient(c, c, 0, c, c, c);
    g.addColorStop(0, '#F3DDB4');
    g.addColorStop(0.62, '#EBC88F');
    g.addColorStop(0.9, '#D49A55');
    g.addColorStop(1, '#B9733A');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 26; i++) {
      const a = rand() * TAU, r = Math.sqrt(rand()) * c * 0.92;
      ctx.fillStyle = 'rgba(176,104,48,' + (0.08 + rand() * 0.16).toFixed(3) + ')';
      ctx.beginPath();
      ctx.ellipse(c + Math.cos(a) * r, c + Math.sin(a) * r, 6 + rand() * 20, 4 + rand() * 12, rand() * Math.PI, 0, TAU);
      ctx.fill();
    }
    for (let i = 0; i < 240; i++) {
      const a = rand() * TAU, r = Math.sqrt(rand()) * c * 0.95;
      ctx.fillStyle = 'rgba(150,92,44,' + (0.18 + rand() * 0.3).toFixed(3) + ')';
      ctx.beginPath();
      ctx.arc(c + Math.cos(a) * r, c + Math.sin(a) * r, 0.5 + rand() * 1.6, 0, TAU);
      ctx.fill();
    }
  });
}

/* A tomato slice, seen face-on: wall, five seed chambers, pale core. */
function tomatoTexture() {
  return canvasTexture(256, (ctx, S) => {
    const c = S / 2, rand = rng(11);
    const g = ctx.createRadialGradient(c, c, 0, c, c, c);
    g.addColorStop(0, '#F5A27A');
    g.addColorStop(0.3, '#EE7A50');
    g.addColorStop(0.82, '#E4502D');
    g.addColorStop(1, '#C93618');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
    for (let k = 0; k < 5; k++) {
      ctx.save();
      ctx.translate(c, c);
      ctx.rotate((k / 5) * TAU + 0.3);
      ctx.fillStyle = '#CF3B1A';
      ctx.beginPath(); ctx.ellipse(c * 0.54, 0, c * 0.29, c * 0.2, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(243,134,66,.8)';
      ctx.beginPath(); ctx.ellipse(c * 0.55, 0, c * 0.22, c * 0.135, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#F8E0A2';
      for (let s = 0; s < 6; s++) {
        ctx.beginPath();
        ctx.ellipse(c * (0.4 + rand() * 0.3), c * (rand() - 0.5) * 0.19, c * 0.036, c * 0.02, rand() * Math.PI, 0, TAU);
        ctx.fill();
      }
      ctx.restore();
    }
    ctx.fillStyle = '#F7B690';
    ctx.beginPath(); ctx.arc(c, c, c * 0.11, 0, TAU); ctx.fill();
  });
}

function puffTexture() {
  return canvasTexture(128, (ctx, S) => {
    const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0, 'rgba(255,251,243,.9)');
    g.addColorStop(0.4, 'rgba(255,251,243,.35)');
    g.addColorStop(1, 'rgba(255,251,243,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
  });
}

/* A small studio to reflect: warm sky, soft floor, two softboxes. It is what
   gives the glaze on the bun and the wet tomato something to catch. */
function buildEnvironment() {
  const env = new THREE.Scene();
  const zenith = new THREE.Color(1.25, 1.18, 1.05);
  const horizon = new THREE.Color(0.95, 0.88, 0.76);
  const floor = new THREE.Color(0.34, 0.33, 0.29);
  const dome = tint(new THREE.SphereGeometry(20, 32, 16), (c, x, y) => {
    const h = y / 20;
    c.copy(horizon).lerp(h > 0 ? zenith : floor, Math.abs(h));
  });
  env.add(new THREE.Mesh(dome, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));

  [[9, 12, 9, 13, 9, 7.0], [-12, 4, 6, 8, 10, 2.2], [-4, 6, -12, 10, 6, 2.6]].forEach(([x, y, z, w, h, power]) => {
    const box = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(power, power * 0.95, power * 0.86), side: THREE.DoubleSide })
    );
    box.position.set(x, y, z);
    box.lookAt(0, 0, 0);
    env.add(box);
  });

  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(env, 0.04).texture;
  pmrem.dispose();
  env.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
  return tex;
}

/* -------------------------------------------------------------------------
   The stack
   ------------------------------------------------------------------------- */
const BUN_R = 2.16, BUN_H = 1.30, BUN_RIM = 0.22;

function buildBun(kind) {
  const g = new THREE.Group();
  const crumb = new THREE.Color(0xF0D8AC), pale = new THREE.Color(0xDFA560);
  const deep = new THREE.Color(0xB0662F), dark = new THREE.Color(0x8A4A24);

  if (kind === 'top') {
    const geo = tint(domeGeometry(BUN_R, BUN_H, BUN_RIM, 26, 96, 0.22), (c, x, y, z) => {
      const h = (y + BUN_H / 2) / BUN_H;
      if (h < 0.004) { c.copy(crumb); return; }
      /* baked darkest on the crown, palest at the seam, mottled like a real crust */
      const mottle = Math.sin(x * 3.1 + z * 2.3) * Math.sin(z * 3.7 - x * 1.1);
      c.copy(pale).lerp(deep, smooth(0.06, 0.7, h)).lerp(dark, Math.max(0, mottle) * 0.22 * smooth(0.2, 0.6, h));
    });
    g.add(new THREE.Mesh(geo, painted(0.56, { clearcoat: 0.32, clearcoatRoughness: 0.38 })));

    const COUNT = 58;
    const rand = rng(23);
    const seeds = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 8), mat(0xffffff, 0.55), COUNT);
    const dummy = new THREE.Object3D();
    const v = new THREE.Vector3();
    const tone = new THREE.Color();
    for (let i = 0; i < COUNT; i++) {
      const u = 0.10 + rand() * 0.72;
      const a = u * Math.PI / 2;
      const theta = rand() * TAU;
      const rr = BUN_R * Math.pow(Math.cos(a), 0.72) * 0.985;
      const yy = BUN_RIM + (BUN_H - BUN_RIM) * Math.pow(Math.sin(a), 0.92) - BUN_H / 2;
      v.set(Math.cos(theta) * rr, yy, Math.sin(theta) * rr);
      dummy.position.copy(v);
      dummy.lookAt(v.x * 1.8, v.y * 1.4 + 0.25, v.z * 1.8);
      dummy.rotation.z = rand() * Math.PI;
      const s = 0.82 + rand() * 0.4;
      dummy.scale.set(0.088 * s, 0.056 * s, 0.035);
      dummy.updateMatrix();
      seeds.setMatrixAt(i, dummy.matrix);
      seeds.setColorAt(i, tone.set(C.sesame).lerp(pale, rand() * 0.45));
    }
    seeds.instanceMatrix.needsUpdate = true;
    seeds.instanceColor.needsUpdate = true;
    g.add(seeds);
    g.add(buildHats());
  } else {
    const H = 0.70;
    const geo = tint(slab(2.05, H, 0.26, 96), (c, x, y, z) => {
      const h = (y + H / 2) / H;
      const mottle = Math.sin(x * 2.7 - z * 3.3) * Math.sin(z * 2.1 + x * 1.9);
      c.copy(dark).lerp(deep, smooth(0, 0.3, h)).lerp(pale, smooth(0.45, 1, h) * 0.85)
        .lerp(dark, Math.max(0, mottle) * 0.16);
    });
    g.add(new THREE.Mesh(geo, painted(0.74, { clearcoat: 0.12, clearcoatRoughness: 0.5 })));

    const face = new THREE.Mesh(
      new THREE.CircleGeometry(1.79, 64),
      mat(0xffffff, 0.95, { map: toastTexture() })
    );
    face.rotation.x = -Math.PI / 2;
    face.position.y = H / 2 + 0.002;
    g.add(face);

    /* The special sauce, pushed out to the rim where the patty presses down. */
    const sauceMat = mat(C.sauce, 0.3);
    const sauceGeo = new THREE.TorusGeometry(1.80, 0.13, 10, 96);
    sauceGeo.rotateX(-Math.PI / 2);
    const sp = sauceGeo.attributes.position;
    for (let i = 0; i < sp.count; i++) {
      const x = sp.getX(i), z = sp.getZ(i);
      const th = Math.atan2(z, x);
      const k = 1 + (Math.sin(th * 4 + 1.1) * 0.5 + Math.sin(th * 9 + 0.3) * 0.3 + Math.sin(th * 2 - 0.8) * 0.4) * 0.035;
      sp.setXYZ(i, x * k, sp.getY(i) * 0.55, z * k);
    }
    sauceGeo.computeVertexNormals();
    const sauce = new THREE.Mesh(sauceGeo, sauceMat);
    sauce.position.y = H / 2 - 0.03;
    g.add(sauce);

    const dripGeo = new THREE.SphereGeometry(1, 12, 10);
    [[0.55, 0.19], [2.35, 0.13], [4.3, 0.16]].forEach(([a, len]) => {
      const drip = new THREE.Mesh(dripGeo, sauceMat);
      drip.position.set(Math.cos(a) * 2.02, H / 2 - 0.1 - len * 0.5, Math.sin(a) * 2.02);
      drip.rotation.y = -a;
      drip.scale.set(0.05, len, 0.075);
      g.add(drip);
    });
  }
  return g;
}

/* Smashed, so the outline wanders and the edge chars darker than the middle. */
function buildPatty() {
  const g = new THREE.Group();
  const R = 1.94, H = 0.46;
  /* a fine mesh, so the grain and the lacy edge have vertices to live on */
  const geo = new THREE.LatheGeometry(slabProfile(R, H, 0.19, 8, 26), 176);
  geo.translate(0, -H / 2, 0);
  const pos = geo.attributes.position;
  /* waves crossing at odd angles, so the surface never settles into a grid */
  const bumpAt = (x, z) =>
    (Math.sin(x * 4.3 + z * 2.9 + 1.3) + Math.sin(z * 5.7 - x * 3.1) * 0.8
      + Math.sin(x * 7.9 - z * 1.3 + 2.0) * 0.5 + Math.sin(x * 2.3 + z * 9.1) * 0.4) / 1.8;
  /* the ground-meat grain: small, quick ripples on top of the big ones */
  const grainAt = (x, z) =>
    (Math.sin(x * 21 + z * 13 + 0.6) * Math.sin(z * 19 - x * 11 + 1.7)
      + Math.sin(x * 33 - z * 27 + 2.4) * 0.6) / 1.6;

  /* where the fat rendered out: shallow pits scattered over the face */
  const rand = rng(41);
  const pits = [];
  for (let i = 0; i < 22; i++) {
    const a = rand() * TAU, d = Math.sqrt(rand()) * R * 0.8;
    pits.push({ x: Math.cos(a) * d, z: Math.sin(a) * d, r: 0.07 + rand() * 0.11, depth: 0.010 + rand() * 0.014 });
  }
  const pitAt = (x, z) => {
    let dip = 0;
    for (const p of pits) {
      const d2 = ((x - p.x) * (x - p.x) + (z - p.z) * (z - p.z)) / (p.r * p.r);
      if (d2 < 9) dip += p.depth * Math.exp(-d2);
    }
    return dip;
  };

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const k = Math.hypot(x, z) / R, th = Math.atan2(z, x);
    const outline = (Math.sin(th * 3 + 0.7) * 0.022 + Math.sin(th * 7 + 2.1) * 0.014 + Math.sin(th * 13 + 4.0) * 0.009) * k * k;
    /* the lacy crust: ragged where the edge splayed out against the griddle */
    const lace = (Math.sin(th * 23 + y * 9) * 0.008 + Math.sin(th * 41 + 1.3) * 0.006 + Math.sin(th * 67 - y * 14) * 0.004)
      * smooth(0.8, 1, k);
    const s = 1 + outline + lace;
    const top = y > 0;
    const lift = bumpAt(x, z) * (top ? 0.016 : 0.006)
      + (top ? grainAt(x, z) * 0.005 * smooth(0.96, 0.7, k) - pitAt(x, z) : 0);
    pos.setXYZ(i, x * s, y + lift, z * s);
  }
  weldNormals(geo);

  const meat = new THREE.Color(0x8E4B33), sear = new THREE.Color(0x6A3524), char = new THREE.Color(0x3A1F17);
  const fat = new THREE.Color(0xB8714A), pepper = new THREE.Color(0x22120D), crust = new THREE.Color(0x4A2819);
  const flake = new THREE.Color();
  tint(geo, (c, x, y, z) => {
    const k = Math.hypot(x, z) / R, th = Math.atan2(z, x);
    const n = bumpAt(x * 1.3 + 2, z * 1.3 - 1) * 0.5 + 0.5;
    c.copy(meat).lerp(sear, clamp(n, 0, 1) * 0.8);
    /* grind: lighter threads of fat and darker lean, running every which way */
    const g1 = grainAt(x * 1.6, z * 1.6) * 0.5 + 0.5;
    c.lerp(fat, smooth(0.62, 0.95, g1) * 0.5).lerp(sear, smooth(0.35, 0.05, g1) * 0.55);
    /* a speckle of its own on every spot, so no two crumbs are the same shade */
    const sp = Math.sin(x * 97 + z * 61) * Math.sin(z * 83 - x * 47);
    c.lerp(pepper, smooth(0.78, 0.98, sp) * 0.65).lerp(fat, smooth(0.85, 1, -sp) * 0.35);
    /* the crust: darkest where the edge is lacy, with a ragged line where the sear starts */
    const edge = 0.86 + Math.sin(th * 17 + 0.5) * 0.03 + Math.sin(th * 31 + 2.2) * 0.02;
    c.lerp(crust, smooth(edge - 0.1, edge + 0.04, k) * 0.6)
      .lerp(char, clamp(smooth(0.9, 1.02, k) * 0.75 + (n - 0.6) * 0.3 * smooth(0.6, 1, k), 0, 0.9));
    /* the bottom is the side that sat on the iron: dark, even and well done */
    if (y < -H * 0.38) c.lerp(char, 0.55);
    /* the cut edge shows the grind in bands, juicier toward the middle height */
    const band = Math.sin(th * 52 + y * 40) * Math.sin(th * 29 - y * 23);
    if (k > 0.97 && Math.abs(y) < H * 0.32) c.lerp(flake.copy(fat), smooth(0.4, 0.95, band) * 0.4);
  });
  g.add(new THREE.Mesh(geo, painted(0.74, { clearcoat: 0.3, clearcoatRoughness: 0.42 })));

  /* Where the top sits, so seasoning rests on the meat instead of floating */
  const topAt = (x, z) => H / 2 + bumpAt(x, z) * 0.016 + grainAt(x, z) * 0.005 - pitAt(x, z);
  const place = (count, seed, kMax, make) => {
    const r2 = rng(seed);
    const out = [];
    for (let i = 0; i < count; i++) {
      const a = r2() * TAU, d = Math.sqrt(r2()) * R * kMax;
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      out.push(make(x, topAt(x, z), z, r2));
    }
    return out;
  };

  const dummy = new THREE.Object3D();
  const tone = new THREE.Color();
  const scatter = (geoS, material, items, tinted) => {
    const mesh = new THREE.InstancedMesh(geoS, material, items.length);
    items.forEach((it, i) => {
      dummy.position.set(it.x, it.y, it.z);
      dummy.rotation.set(it.rx || 0, it.ry || 0, it.rz || 0);
      dummy.scale.set(it.sx, it.sy, it.sz);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      if (tinted) mesh.setColorAt(i, tone.set(it.col));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (tinted) mesh.instanceColor.needsUpdate = true;
    return mesh;
  };

  /* cracked pepper */
  g.add(scatter(new THREE.SphereGeometry(1, 6, 5), mat(0xffffff, 0.8), place(90, 43, 0.86, (x, y, z, r) => {
    const s = 0.016 + r() * 0.022;
    return { x, y: y - 0.002, z, ry: r() * TAU, sx: s * 1.5, sy: s * 0.6, sz: s, col: r() > 0.3 ? 0x1C0E09 : 0x3B2417 };
  }), true));

  /* coarse salt, catching the light */
  g.add(scatter(new THREE.BoxGeometry(1, 1, 1), mat(0xffffff, 0.35, { metalness: 0 }), place(44, 47, 0.84, (x, y, z, r) => {
    const s = 0.012 + r() * 0.014;
    return { x, y: y + s * 0.2, z, rx: r() * 2, ry: r() * TAU, rz: r() * 2, sx: s, sy: s * 0.8, sz: s * 1.2, col: r() > 0.5 ? 0xFFFBF3 : 0xEFE4D2 };
  }), true));

  /* beads of rendered fat, glossy where the rest of the patty is matte */
  const fatMat = mat(0xffffff, 0.12, { transparent: true, opacity: 0.78 });
  fatMat.color.set(0xD9924F);
  g.add(scatter(new THREE.SphereGeometry(1, 12, 8), fatMat, place(26, 53, 0.82, (x, y, z, r) => {
    const s = 0.026 + r() * 0.04;
    return { x, y: y - 0.004, z, ry: r() * TAU, sx: s * (1 + r() * 0.5), sy: s * 0.4, sz: s };
  }), false));

  return g;
}

/* A slice of cheese with two shapes: flat off the board, and slumped over
   the patty. The frame loop blends between them once it lands on the heat. */
function cheeseGeometry(half, corner, thick, n = 34) {
  /* R0 is where the sheet starts to fold: just past the patty's widest point,
     so the corners hang clear of the meat rather than through it. */
  const R0 = 1.9, RHO = 0.2, AMAX = 1.35;
  const row = n + 1, inner = half - corner;
  const flatP = [], flatN = [], meltP = [], meltN = [], index = [];

  const plan = (i, j) => {
    let x = (i / n * 2 - 1) * half, z = (j / n * 2 - 1) * half;
    const cx = clamp(x, -inner, inner), cz = clamp(z, -inner, inner);
    let dx = x - cx, dz = z - cz;
    const d = Math.hypot(dx, dz);
    if (d > corner) { dx = dx / d * corner; dz = dz / d * corner; x = cx + dx; z = cz + dz; }
    return { x, z, ox: dx, oz: dz };
  };

  /* Where a point on the flat sheet ends up once it has bent over the edge. */
  const bend = (x, z) => {
    const rad = Math.hypot(x, z) || 1e-6;
    const dx = x / rad, dz = z / rad;
    const over = Math.max(0, rad - R0);
    const a = Math.min(over / RHO, AMAX);
    const extra = Math.max(0, over - RHO * AMAX);
    const nr = rad - over + RHO * Math.sin(a) + extra * Math.cos(a);
    return {
      x: dx * nr, y: -(RHO * (1 - Math.cos(a)) + extra * Math.sin(a)), z: dz * nr,
      nx: dx * Math.sin(a), ny: Math.cos(a), nz: dz * Math.sin(a),
      tx: dx * Math.cos(a), ty: -Math.sin(a), tz: dz * Math.cos(a)
    };
  };

  const put = (x, z, side, nFlat, nMelt) => {
    const b = bend(x, z), o = side * thick / 2;
    flatP.push(x, o, z);
    flatN.push(nFlat[0], nFlat[1], nFlat[2]);
    meltP.push(b.x + b.nx * o, b.y + b.ny * o, b.z + b.nz * o);
    const m = nMelt(b);
    meltN.push(m[0], m[1], m[2]);
    return flatP.length / 3 - 1;
  };

  /* top and bottom faces */
  [1, -1].forEach((side, s) => {
    for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
      const p = plan(i, j);
      put(p.x, p.z, side, [0, side, 0], (b) => [b.nx * side, b.ny * side, b.nz * side]);
    }
    const base = s * row * row;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const a = base + j * row + i, b = a + 1, c = a + row, d = c + 1;
      if (side > 0) index.push(a, c, b, b, c, d); else index.push(a, b, c, b, d, c);
    }
  });

  /* the cut edge, on its own vertices so it stays crisp */
  const loop = [];
  for (let i = 0; i < n; i++) loop.push([i, 0]);
  for (let j = 0; j < n; j++) loop.push([n, j]);
  for (let i = n; i > 0; i--) loop.push([i, n]);
  for (let j = n; j > 0; j--) loop.push([0, j]);
  const edge = loop.map(([i, j]) => {
    const p = plan(i, j);
    const l = Math.hypot(p.ox, p.oz) || 1;
    const out = [p.ox / l, 0, p.oz / l];
    const tangent = (b) => [b.tx, b.ty, b.tz];
    return [put(p.x, p.z, 1, out, tangent), put(p.x, p.z, -1, out, tangent)];
  });
  for (let k = 0; k < edge.length; k++) {
    const [t0, b0] = edge[k], [t1, b1] = edge[(k + 1) % edge.length];
    index.push(t0, t1, b0, t1, b1, b0);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(flatP, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(flatN, 3));
  geo.morphAttributes.position = [new THREE.Float32BufferAttribute(meltP, 3)];
  geo.morphAttributes.normal = [new THREE.Float32BufferAttribute(meltN, 3)];
  geo.setIndex(index);
  return geo;
}

function buildCheese() {
  const g = new THREE.Group();
  cheeseMesh = new THREE.Mesh(
    cheeseGeometry(1.72, 0.36, 0.07),
    mat(C.cheese, 0.42, { side: THREE.DoubleSide })
  );
  cheeseMesh.rotation.y = Math.PI / 4;
  cheeseMesh.morphTargetInfluences = [0];
  g.add(cheeseMesh);
  return g;
}

/* Red onion: loose rings, white flesh with the purple skin on the outside. */
function buildOnion() {
  const g = new THREE.Group();
  const flesh = new THREE.Color(0xF8ECEF), skin = new THREE.Color(0x92406F);
  const material = painted(0.5, { clearcoat: 0.25, clearcoatRoughness: 0.4 });
  [
    [1.02, -0.72,  0.30, -0.030,  0.05, -0.04],
    [0.86,  0.82,  0.44,  0.000, -0.06,  0.05],
    [0.78,  0.10, -0.94, -0.015,  0.04,  0.07],
    [0.62, -0.96, -0.74,  0.020, -0.05, -0.06],
    [0.50,  0.18,  0.22,  0.030,  0.09,  0.03]
  ].forEach(([r, x, z, y, tx, tz]) => {
    const tube = 0.052;
    const geo = tint(new THREE.TorusGeometry(r, tube, 10, 72), (c, vx, vy) => {
      c.copy(flesh).lerp(skin, smooth(0.15, 0.7, (Math.hypot(vx, vy) - r) / tube));
    });
    const ring = new THREE.Mesh(geo, material);
    ring.rotation.set(-Math.PI / 2 + tx, 0, tz);
    ring.scale.z = 1.7;
    ring.position.set(x, y, z);
    g.add(ring);
  });
  return g;
}

/* Three thick slices, shingled, each with its seeds showing. */
function buildTomato() {
  const g = new THREE.Group();
  /* Each slice sits a full thickness above the last, so where they overlap
     one rests on the other instead of cutting through it. */
  const T = 0.11, RISE = 0.115;
  const skinGeo = slab(1.0, T, 0.05, 56);
  const faceGeo = new THREE.CircleGeometry(0.94, 48);
  const skin = mat(0xDA3A1C, 0.34);
  const flesh = mat(0xffffff, 0.4, { map: tomatoTexture() });
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * TAU + 0.5;
    const slice = new THREE.Group();
    slice.add(new THREE.Mesh(skinGeo, skin));
    [1, -1].forEach((side) => {
      const face = new THREE.Mesh(faceGeo, flesh);
      face.rotation.x = -side * Math.PI / 2;
      face.position.y = side * (T / 2 + 0.0015);
      slice.add(face);
    });
    slice.position.set(Math.cos(a) * 0.86, (i - 1) * RISE, Math.sin(a) * 0.86);
    slice.rotation.y = i * 1.3;
    g.add(slice);
  }
  return g;
}

/* Two ruffled leaves: flat where they are pressed, frilled where they escape. */
function buildLettuce() {
  const g = new THREE.Group();
  const SEG = 260, RINGS = 14, R_IN = 0, R_OUT = 2.2;
  const pale = new THREE.Color(0xD6E4A4), green = new THREE.Color(0x6FA65A), tip = new THREE.Color(0x3F7D43);
  const material = painted(0.58, { side: THREE.DoubleSide, clearcoat: 0.15, clearcoatRoughness: 0.5 });

  [0, 1].forEach((leaf) => {
    const ph = leaf * 2.3;
    const P = [], Cc = [], index = [];
    const c = new THREE.Color();
    for (let j = 0; j < SEG; j++) {
      const th = (j / SEG) * TAU;
      const lobes = Math.sin(th * 5 + 0.8 + ph) * 0.07 + Math.sin(th * 3 - 1.1 + ph) * 0.05;
      for (let i = 0; i <= RINGS; i++) {
        const u = i / RINGS;
        const wave = Math.sin(th * 8 + 0.4 + u * 1.5 + ph) * 0.55
          + Math.sin(th * 15 + 1.9 - u * 2 + ph * 2) * 0.3
          + Math.sin(th * 27 + 3.1 + ph) * 0.15;
        const r = lerp(R_IN, R_OUT * (1 + lobes), u);
        P.push(Math.cos(th) * r, Math.pow(u, 2.2) * 0.21 * wave - u * u * 0.05, Math.sin(th) * r);
        c.copy(pale).lerp(green, smooth(0.25, 0.8, u)).lerp(tip, smooth(0.8, 1, u) * (0.45 + wave * 0.35));
        Cc.push(c.r, c.g, c.b);
      }
    }
    for (let j = 0; j < SEG; j++) {
      const a0 = j * (RINGS + 1), a1 = ((j + 1) % SEG) * (RINGS + 1);
      for (let i = 0; i < RINGS; i++) index.push(a0 + i, a1 + i, a0 + i + 1, a0 + i + 1, a1 + i, a1 + i + 1);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(Cc, 3));
    geo.setIndex(index);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, material);
    mesh.rotation.y = leaf * 2.1;
    mesh.position.y = leaf * 0.04 - 0.02;
    mesh.scale.setScalar(1 - leaf * 0.05);
    g.add(mesh);
  });
  return g;
}

/* -------------------------------------------------------------------------
   Hats. "Chapouu" is a hat — so the burger wears one, and you can swap it.
   ------------------------------------------------------------------------- */
/* Height of the top bun's dome at a given distance from its axis, measured
   from the bun's own centre. Hat brims trace this so they sit on the bread
   instead of slicing through it. */
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
  return weldNormals(geo);
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

  /* The bill is a half disc whose flat edge hides inside the crown; only the
     part past the rim shows. It is narrower than the crown and pivots about
     the rim's front point, so it springs from the rim and droops from there. */
  const billTilt = 0.07;
  const billGeo = new THREE.CylinderGeometry(3.3, 3.3, 0.1, 56, 1, false, Math.PI, Math.PI);
  billGeo.rotateY(Math.PI / 2);
  const bill = new THREE.Mesh(billGeo, mat(C.flame, 0.65));
  bill.scale.set(0.5, 1, 1);
  bill.rotation.x = billTilt;
  bill.position.set(0, ySeat + seat * Math.tan(billTilt) - 0.12, 0);
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
const HAT_TILT = { x: -0.035, z: 0.07 };
const hats = [];

function buildHats() {
  hatMount = new THREE.Group();
  hatMount.rotation.set(HAT_TILT.x, 0, HAT_TILT.z);
  HAT_MAKERS.forEach((make, i) => {
    const hat = make();
    hat.userData.s = i === 0 ? 1 : 0;
    hat.scale.setScalar(hat.userData.s);
    hat.visible = i === 0;
    hats.push(hat);
    hatMount.add(hat);
  });
  return hatMount;
}

/* Layer table — bottom of the stack first. `from` is where the piece floats
   before its turn; `r` and `fleck` shape the crumbs it throws on landing.
   `gap` is tuned so each layer rests on the one below: the cheese clears the
   patty's bumps, the rings sit on the cheese, the tomato on the rings.

   Loose pieces must never touch one another, or the stack, at any scroll
   position. `from`, `tilt` (x, z lean of the piece's axis), `swirl` and the
   flight constants below were solved together for that and only hold as a
   set: every piece waits above the seat it is heading for, and comes down
   onto it flat. Change one and the rest need solving again. `turn` is only
   the angle a piece starts its spin at. --------------------------------- */
const RECIPE = [
  { make: () => buildBun('bottom'), h: 0.70, gap: 0.00, from: [ 1.57, 0.09,  0.71], tilt: [ 0.12, -1.45], turn:  1.2, swirl:  0.89, r: 1.9, fleck: 0xE6B271 },
  { make: buildPatty,              h: 0.46, gap: -0.09, from: [ 2.15, 1.15, -3.57], tilt: [ 0.81,  0.96], turn: -0.6, swirl:  0.35, r: 1.9, fleck: 0x5A2E20 },
  { make: buildCheese,             h: 0.14, gap:  0.00, from: [-2.26, -0.25, -2.77], tilt: [-0.44,  0.97], turn:  0.8, swirl: -0.61, r: 1.8, fleck: C.cheese },
  { make: buildOnion,              h: 0.24, gap: -0.03, from: [-0.39, 2.98,  3.75], tilt: [-1.06,  0.75], turn:  1.4, swirl:  0.69, r: 1.6, fleck: 0xF8ECEF },
  { make: buildTomato,             h: 0.32, gap:  0.02, from: [-4.20, 2.12,  1.47], tilt: [-0.39, -1.42], turn: -1.1, swirl:  0.80, r: 1.7, fleck: 0xE4502D },
  { make: buildLettuce,            h: 0.34, gap: -0.12, from: [ 3.95, 2.93,  1.42], tilt: [-0.44,  1.45], turn:  0.9, swirl: -0.49, r: 2.0, fleck: 0x6FA65A },
  { make: () => buildBun('top'),   h: 1.30, gap: -0.13, from: [-0.69, 3.60, -1.21], tilt: [-0.03,  0.09], turn: -1.5, swirl:  1.14, r: 2.0, fleck: C.sesame }
];

/* Keep SPAN and LAST in step with site.js, which lights the list off them. */
const SPAN = 0.19;
const LAST = 0.88;
/* How far apart the loose pieces start: wider than tall, since the top of the
   frame is the tight side. */
const SPREAD = new THREE.Vector3(1.3, 1.12, 1.3);
const STEP = (LAST - SPAN) / (RECIPE.length - 1);
/* Share of a layer's window spent travelling. The rest belongs to the landing. */
const CONTACT = 0.8;
/* How far above its seat a piece hovers before the drop. The top bun wears a
   hat, so it gets less headroom or it leaves the frame. */
const LIFT = 0.9, LIFT_TOP = 0.55;
/* A piece's flight, as shares of its travel: it has levelled out by LEVEL,
   reached hover height by RISE, and glides in over the stack during GLIDE. */
const RISE = 0.74, LEVEL = 0.55, GLIDE = [0.15, 0.47], FALL = 0.78;
/* How much a loose piece bobs (per axis) and rocks. */
const BOB = [0.12, 0.14, 0.12], ROCK = 0.14;
/* The box the loose pieces are framed in, and the built burger's. The pieces
   float above the spot the stack grows on, so the frame starts RAISE higher. */
const NEED_W = [11.0, 6.6], NEED_H = [7.1, 4.9], RAISE = 1.6;

/* -------------------------------------------------------------------------
   Springs, crumbs and steam — the parts that run on time, not on scroll
   ------------------------------------------------------------------------- */
function stepSpring(s, stiffness, damping, dt) {
  const n = Math.max(1, Math.ceil(dt / 0.008)), h = dt / n;
  for (let i = 0; i < n; i++) {
    s.v += (-stiffness * s.x - damping * s.v) * h;
    s.x += s.v * h;
  }
}

const stack = { x: 0, v: 0 };

const CRUMBS = 72;
const crumbs = {
  mesh: null, next: 0, active: false,
  pos: new Float32Array(CRUMBS * 3), vel: new Float32Array(CRUMBS * 3),
  life: new Float32Array(CRUMBS), size: new Float32Array(CRUMBS)
};
const crumbDummy = new THREE.Object3D();
const crumbTone = new THREE.Color();

function buildCrumbs() {
  const mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), mat(0xffffff, 0.8), CRUMBS);
  crumbDummy.scale.setScalar(0);
  crumbDummy.updateMatrix();
  for (let i = 0; i < CRUMBS; i++) {
    mesh.setMatrixAt(i, crumbDummy.matrix);
    mesh.setColorAt(i, crumbTone.set(0xffffff));
  }
  mesh.frustumCulled = false;
  crumbs.mesh = mesh;
  return mesh;
}

function burst(part, count) {
  for (let k = 0; k < count; k++) {
    const id = crumbs.next;
    crumbs.next = (id + 1) % CRUMBS;
    const a = Math.random() * TAU;
    const r = part.r * (0.9 + Math.random() * 0.15);
    const out = 0.8 + Math.random() * 1.5;
    crumbs.pos.set([Math.cos(a) * r, part.target.y - part.h * 0.5 + 0.05, Math.sin(a) * r], id * 3);
    crumbs.vel.set([Math.cos(a) * out, 1.1 + Math.random() * 2.0, Math.sin(a) * out], id * 3);
    crumbs.life[id] = 0.5 + Math.random() * 0.35;
    crumbs.size[id] = 0.02 + Math.random() * 0.028;
    crumbs.mesh.setColorAt(id, crumbTone.set(part.fleck));
  }
  crumbs.mesh.instanceColor.needsUpdate = true;
  crumbs.active = true;
}

function stepCrumbs(dt) {
  if (!crumbs.active) return;
  let alive = false;
  for (let i = 0; i < CRUMBS; i++) {
    const k = i * 3;
    let s = 0;
    if (crumbs.life[i] > 0) {
      crumbs.life[i] -= dt;
      crumbs.vel[k + 1] -= 11 * dt;
      crumbs.pos[k] += crumbs.vel[k] * dt;
      crumbs.pos[k + 1] += crumbs.vel[k + 1] * dt;
      crumbs.pos[k + 2] += crumbs.vel[k + 2] * dt;
      s = crumbs.size[i] * clamp(crumbs.life[i] / 0.25, 0, 1);
      alive = true;
    }
    crumbDummy.position.set(crumbs.pos[k], crumbs.pos[k + 1], crumbs.pos[k + 2]);
    crumbDummy.rotation.set(crumbs.life[i] * 9, crumbs.life[i] * 7, 0);
    crumbDummy.scale.setScalar(s);
    crumbDummy.updateMatrix();
    crumbs.mesh.setMatrixAt(i, crumbDummy.matrix);
  }
  crumbs.mesh.instanceMatrix.needsUpdate = true;
  crumbs.active = alive;
}

/* A piece has just touched down: it squashes, everything under it takes some
   of the hit, and the whole stack dips. */
function land(i) {
  const top = i === parts.length - 1;
  parts[i].spring.v -= top ? 2.0 : 1.6;
  for (let j = 0; j < i; j++) parts[j].spring.v -= (top ? 1.0 : 0.7) * Math.pow(0.62, i - j - 1);
  stack.v -= top ? 1.5 : 0.8;
  burst(parts[i], top ? 14 : 8);
}

const STEAM = 6;
const steam = [];
let heat = 0, melt = 0;

function buildSteam(y) {
  const map = puffTexture();
  for (let i = 0; i < STEAM; i++) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map, transparent: true, depthWrite: false, opacity: 0 }));
    const a = (i / STEAM) * TAU + 0.6;
    sprite.userData = { x: Math.cos(a) * 1.9, z: Math.sin(a) * 1.9, y, phase: i / STEAM + (i % 2) * 0.37, sway: i * 1.9 };
    sprite.visible = false;
    spin.add(sprite);
    steam.push(sprite);
  }
}

/* -------------------------------------------------------------------------
   Boot
   ------------------------------------------------------------------------- */
const KEY_DIR = new THREE.Vector3(5, 9, 7).normalize();

function init() {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, window.innerWidth < 900 ? 1.5 : 1.8));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  host.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  scene.environment = buildEnvironment();
  scene.environmentIntensity = 0.5;
  camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
  camera.position.set(0, 2.4, 14);

  hemi = new THREE.HemisphereLight(0xFFFBF3, C.sand, 0.62);
  scene.add(hemi);

  /* The key light casts real shadows, so every layer shades the one below. */
  key = new THREE.DirectionalLight(0xFFF4E2, 2.0);
  key.castShadow = true;
  key.shadow.mapSize.setScalar(window.innerWidth < 900 ? 1024 : 2048);
  key.shadow.bias = -0.0003;
  key.shadow.normalBias = 0.035;
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 70;
  scene.add(key, key.target);

  const fill = new THREE.DirectionalLight(0xCFE7E2, 0.55);
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
    obj.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    /* Y innermost: a loose piece spins about its own axis, so it sweeps no
       more room than it would sitting still. */
    obj.rotation.order = 'ZXY';
    spin.add(obj);
    parts.push({
      obj,
      target: new THREE.Vector3(0, targetY, 0),
      from: new THREE.Vector3().fromArray(entry.from).multiply(SPREAD),
      tilt: entry.tilt,
      turn: entry.turn,
      t0: i * STEP,
      seed: i * 1.7 + 0.4,
      h: entry.h,
      r: entry.r,
      fleck: entry.fleck,
      swirl: entry.swirl,
      lift: i === RECIPE.length - 1 ? LIFT_TOP : LIFT,
      spring: { x: 0, v: 0 },
      down: false
    });
  });

  /* Centre the stack on the group origin */
  const total = cursor;
  parts.forEach((p) => { p.target.y -= total / 2; });
  shadow.position.y = -total / 2 - 0.02;

  spin.add(buildCrumbs());
  buildSteam(parts[1].target.y + 0.1);

  /* Watch the canvas box, not the window: on a phone the window resizes every
     time the toolbar slides in or out, and the canvas does not. */
  if ('ResizeObserver' in window) new ResizeObserver(onResize).observe(host);
  else window.addEventListener('resize', onResize, { passive: true });
  window.addEventListener('load', onResize, { once: true });
  onResize();

  /* Compile every shader up front, so the first scroll is not the frame that
     pays for it. */
  renderer.compile(scene, camera);

  host.classList.add('is-ready');
  renderer.setAnimationLoop(frame);
}

let viewW = 1, viewH = 1, heroFloor = 0;

function onResize() {
  if (!renderer) return;
  viewW = host.clientWidth || window.innerWidth;
  viewH = host.clientHeight || window.innerHeight;
  camera.aspect = viewW / viewH;
  camera.updateProjectionMatrix();
  renderer.setSize(viewW, viewH, false);
  heroFloor = heroCopy ? heroCopy.offsetTop + heroCopy.offsetHeight : 0;
}

/* Small screens: the burger is fitted to a box measured off the page, in
   pixels from the top left of the canvas. Under the hero that is the room
   below the copy (beside it, on a phone held sideways); once the build section
   pins, it is the .build-stage slot the stylesheet leaves open. */
const box = { x: 0, y: 0, w: 1, h: 1, fade: 1 };
/* the fixed header's logo and menu button live in the top strip */
const HEADER_CLEAR = 84;

function narrowBox(sectionTop) {
  const winH = window.innerHeight;
  let x = 0, y, w = viewW, h;
  if (viewW > winH) {
    x = viewW * 0.56; w = viewW * 0.42;
    y = winH * 0.18; h = winH * 0.8;
  } else {
    y = winH * 0.5; h = winH * 0.45;
  }
  const slot = stageEl && stickyEl ? stageEl.getBoundingClientRect() : null;
  box.fade = 1;
  if (slot && slot.width > 0 && slot.height > 0) {
    const stickyTop = stickyEl.getBoundingClientRect().top;
    /* where the slot sits once the section has pinned */
    const rest = slot.top - stickyTop;
    if (viewW > winH) {
      const k = smooth(0.1, 0.9, 1 - sectionTop / winH);
      x = lerp(x, slot.left, k);
      w = lerp(w, slot.width, k);
      y = lerp(y, rest, k);
      h = lerp(h, slot.height, k);
    } else {
      /* Upright: the hero copy sits above and the build copy comes up from
         below, and the two scroll together. The burger takes the band between
         them (and under the header), so it travels with the page and neither
         block of words can ever reach it. As that band scrolls away the burger
         fades out, then fades back in at its own slot under the build copy. */
      const top = heroCopy ? heroCopy.getBoundingClientRect().bottom + 12 : 0;
      const bottom = buildCopy ? buildCopy.getBoundingClientRect().top - 16 : slot.top;
      const bandTop = Math.max(top, HEADER_CLEAR), bandBottom = Math.min(bottom, winH);
      const room = bandBottom - bandTop;
      const enough = winH * 0.24;
      if (room > enough * 0.6) {
        y = bandTop; h = room;
        box.fade = smooth(enough * 0.6, enough, room);
      } else {
        x = slot.left;
        w = slot.width;
        y = slot.top - Math.min(stickyTop, 0);
        h = slot.height;
        /* the band is gone off the top (or never fit, on a short phone) */
        box.fade = bottom < winH ? 1 - smooth(enough * 0.15, enough * 0.6, room) : 1;
      }
    }
  }
  if (buildCopy && buildCopy.style.opacity) buildCopy.style.opacity = '';
  box.x = x; box.y = y; box.w = w; box.h = h;
  return box;
}

/* -------------------------------------------------------------------------
   Frame
   ------------------------------------------------------------------------- */
const clock = new THREE.Clock();
let time = 0;
let camZ = 14, camY = 2.4, lookX = 0, lookY = 0;
let primed = false;
const projected = new THREE.Vector3();
const GROUND_A = new THREE.Color(C.sand);
const GROUND_B = new THREE.Color(C.tealInk);

function frame() {
  /* Clamp the step so a backgrounded tab does not come back with a lurch */
  const dt = Math.min(clock.getDelta(), 0.05);
  time += dt;
  const t = time;
  const p = state.reduced ? 1 : clamp(state.p, 0, 1);

  /* Ride the section out of frame, then stop drawing entirely */
  let exit = 0, sectionTop = 0;
  if (buildSection) {
    const rect = buildSection.getBoundingClientRect();
    if (rect.bottom < -80) { host.style.opacity = 0; return; }
    host.style.opacity = '';
    exit = clamp((window.innerHeight - rect.bottom) / window.innerHeight, 0, 1);
    sectionTop = rect.top;
  }

  const settle = clamp((p - LAST) / (1 - LAST), 0, 1);

  /* Camera pushes in as the burger comes together, then eases back out */
  const ease = easeOutCubic(clamp(p / LAST, 0, 1));
  camZ = damp(camZ, lerp(15.2, 11.4, ease) + settle * 1.2, 3.7, dt);
  camY = damp(camY, lerp(3.1, 1.35, ease), 3.7, dt);
  lookX = damp(lookX, state.pointer.x, 5, dt);
  lookY = damp(lookY, state.pointer.y, 5, dt);

  /* Layout: fit the cluster to the free half of the screen. The bounding box
     shrinks as the parts converge, so the framing tightens with the assembly. */
  const vh = 2 * Math.tan((camera.fov / 2) * Math.PI / 180) * camZ;
  const vw = vh * camera.aspect;
  const narrow = window.innerWidth < 1080;

  /* The loose pieces need their room until the last of them has gone in, so
     the box holds wide and closes late. */
  const fit = Math.pow(clamp(p / LAST, 0, 1), 4);
  const needW = lerp(NEED_W[0], NEED_W[1], fit);
  const needH = lerp(NEED_H[0], NEED_H[1], fit);

  /* Once it is built the burger breathes a little, so it never sits dead still */
  const breathe = state.reduced ? 0 : Math.sin(t * 0.9) * 0.05 * ease;

  if (narrow) {
    /* the hat stands well clear of the bun, so the box has to hold that too */
    const b = narrowBox(sectionTop);
    /* on the canvas itself: the host's opacity eases over .9s for the reveal,
       which would let the hand-off between the two boxes show */
    renderer.domElement.style.opacity = b.fade < 1 ? b.fade.toFixed(3) : '';
    const tall = lerp(7.8, 6.1, fit);
    const s = clamp(Math.min((b.w / viewW) * vw * 0.94 / needW, (b.h / viewH) * vh * 0.94 / tall), 0.2, 2.4);
    /* the camera looks 55% of the way toward the burger, hence the 0.45 */
    base.s = s;
    base.x = ((b.x + b.w / 2) / viewW - 0.5) * vw / 0.45;
    base.y = 0.15 + (0.5 - (b.y + b.h / 2) / viewH) * vh - 0.3 * ease * s + exit * vh;
    base.raise = RAISE * (1 - fit);
    base.vw = vw; base.vh = vh; base.exit = exit;
    placeNarrow();
  } else {
    if (buildCopy && buildCopy.style.opacity) buildCopy.style.opacity = '';
    if (renderer.domElement.style.opacity) renderer.domElement.style.opacity = '';
    /* the page content is capped at 1320px wide, so on a big window the burger
       eases toward that column instead of growing with the screen */
    const column = lerp(1, Math.min(1, 1320 / viewW), 0.5);
    const availW = vw * column * lerp(0.45, 0.49, ease);
    const availH = vh * 0.67;
    root.scale.setScalar(clamp(Math.min(availW / needW, availH / needH), 0.25, 2.4));
    root.position.y = lerp(-0.45, 0.3, ease) - 0.35 + exit * vh;
    root.position.y -= RAISE * (1 - fit) * root.scale.y;
  }

  if (narrow) {
    aimNarrow();
  } else {
    /* Centre the burger over the hat picker under it. The camera looks 55% of
       the way toward the burger, so screen x is not linear in root.x: nudge
       it until the projected centre lands on the picker. */
    const pr = pickerEl ? pickerEl.getBoundingClientRect() : null;
    const cx = pr && pr.width > 0 ? pr.left + pr.width / 2 : viewW * 0.7;
    const target = (cx / viewW) * 2 - 1;
    for (let i = 0; i < 4; i++) {
      camera.position.set(lookX * 0.5, camY - lookY * 0.35, camZ);
      camera.lookAt(root.position.x * 0.55, 0.15, 0);
      camera.updateMatrixWorld();
      const ndc = projected.copy(root.position).project(camera);
      root.position.x += (target - ndc.x) * vw / 0.9;
    }
    camera.position.set(lookX * 0.5, camY - lookY * 0.35, camZ);
    camera.lookAt(root.position.x * 0.55, 0.15, 0);
  }

  /* Whole-stack rotation: a slow turn plus a nudge as it locks together */
  spin.rotation.y = -0.6 + ease * 1.55 + t * 0.05;
  spin.rotation.z = lerp(0.06, 0, easeOutCubic(p));

  /* The framing tightens as the build goes on, so the pieces still waiting
     their turn close ranks with it instead of drifting out of shot. */
  const crowd = needH / NEED_H[0];

  /* Each ingredient gets its own window: level out and settle to hover
     height, glide in over the stack on a curve, then drop straight down onto
     its seat. */
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const lp = clamp((p - part.t0) / SPAN, 0, 1);
    const u = Math.min(lp / CONTACT, 1);
    const rise = easeInOutCubic(clamp(u / RISE, 0, 1));
    const glide = easeInOutCubic(clamp((u - GLIDE[0]) / GLIDE[1], 0, 1));
    const fall = clamp((u - FALL) / (1 - FALL), 0, 1);
    const loose = 1 - easeInOutCubic(clamp(u / LEVEL, 0, 1));

    const ang = part.swirl * glide;
    const cs = Math.cos(ang), sn = Math.sin(ang), off = 1 - glide;
    const x = (part.from.x * cs - part.from.z * sn) * off * crowd;
    const z = (part.from.x * sn + part.from.z * cs) * off * crowd;
    /* height closes in faster than width: the top of the frame is the tight side */
    let y = lerp(part.from.y * Math.pow(crowd, 1.27), part.target.y + part.lift, rise) - part.lift * fall * fall;

    const down = lp >= CONTACT;
    if (primed && down !== part.down) {
      if (down) land(i); else part.spring.v += 0.9;
    }
    part.down = down;

    stepSpring(part.spring, 170, 13, dt);
    const sq = clamp(part.spring.x, -0.3, 0.3);
    part.obj.scale.set(1 - sq * 0.5, 1 + sq, 1 - sq * 0.5);
    y += sq * part.h * 0.5;   /* keep the base planted while it squashes */

    part.obj.position.set(
      x + Math.sin(t * 0.7 + part.seed) * BOB[0] * loose,
      y + Math.sin(t * 0.55 + part.seed * 1.6) * BOB[1] * loose,
      z + Math.cos(t * 0.6 + part.seed) * BOB[2] * loose
    );

    part.obj.rotation.set(
      part.tilt[0] * loose + Math.sin(t * 0.4 + part.seed) * ROCK * loose,
      part.turn * loose + t * 0.25 * loose,
      part.tilt[1] * loose + Math.cos(t * 0.35 + part.seed) * ROCK * loose
    );
  }

  stepSpring(stack, 120, 11, dt);
  spin.position.y = stack.x + breathe;
  stepCrumbs(dt);

  /* Cheese slumps once it is on the heat, and stiffens again if you scroll back */
  const meltGoal = parts[2].down ? 1 : 0;
  const heatGoal = parts[1].down && !state.reduced ? 1 : 0;
  if (primed) {
    melt = damp(melt, meltGoal, meltGoal ? 3.2 : 9, dt);
    heat = damp(heat, heatGoal, 1.4, dt);
  } else {
    melt = meltGoal;
    heat = heatGoal;
    primed = true;
  }
  cheeseMesh.morphTargetInfluences[0] = melt;

  /* Steam off the patty */
  for (let i = 0; i < steam.length; i++) {
    const s = steam[i], d = s.userData;
    s.visible = heat > 0.01;
    if (!s.visible) continue;
    const f = (t * 0.3 + d.phase) % 1;
    s.position.set(
      d.x + Math.sin(t * 0.8 + d.sway) * 0.14 * f,
      d.y + f * 1.9,
      d.z + Math.cos(t * 0.7 + d.sway) * 0.14 * f
    );
    s.scale.setScalar(lerp(0.45, 1.25, f));
    s.material.opacity = Math.sin(f * Math.PI) * 0.17 * heat;
  }

  /* The hat takes the landing too, a beat behind the bun */
  const wobble = parts[parts.length - 1].spring.x;
  hatMount.rotation.x = HAT_TILT.x + wobble * 0.5;
  hatMount.rotation.z = HAT_TILT.z + wobble * 0.9;

  /* Hat swap: the outgoing one shrinks away, the new one pops in */
  const wanted = Math.min(Math.max(state.hat | 0, 0), hats.length - 1);
  for (let i = 0; i < hats.length; i++) {
    const hat = hats[i];
    const goal = i === wanted ? 1 : 0;
    hat.userData.s = damp(hat.userData.s, goal, 10.5, dt);
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
  shadow.scale.setScalar(lerp(0.7, 1, easeOutCubic(p)) * (1 - (stack.x + breathe) * 1.4));

  /* Keep the shadow frustum wrapped tightly around wherever the burger is.
     Cast shadows stay soft while the pieces are apart and firm up as they stack. */
  const reach = 5.8 * root.scale.x;
  const sc = key.shadow.camera;
  sc.left = sc.bottom = -reach;
  sc.right = sc.top = reach;
  sc.updateProjectionMatrix();
  key.position.copy(root.position).addScaledVector(KEY_DIR, 30);
  key.target.position.copy(root.position);
  key.shadow.intensity = lerp(0.4, 0.9, ease);

  /* Small screens: measure where the pieces really landed on screen and pull
     them back inside their box, so nothing ever runs over the copy, the meter
     or the hat picker. Two passes: the second checks the first's correction. */
  if (narrow) {
    for (let pass = 0; pass < 2; pass++) {
      keepInBox(dt);
      placeNarrow();
      aimNarrow();
    }
    key.position.copy(root.position).addScaledVector(KEY_DIR, 30);
    key.target.position.copy(root.position);
  }

  renderer.render(scene, camera);
}

/* -------------------------------------------------------------------------
   Keeping the burger inside its box on small screens
   ------------------------------------------------------------------------- */
/* `base` is the layout the frame asks for; `guard` is the measured correction
   on top of it: a shrink (only ever down from the asked size) and a nudge. */
const base = { s: 1, x: 0, y: 0, raise: 0, vw: 1, vh: 1, exit: 0 };
const guard = { k: 1, dx: 0, dy: 0 };
const partBoxes = [];
const corner = new THREE.Vector3();
const RING = 12;

function placeNarrow() {
  const s = base.s * guard.k;
  root.scale.setScalar(s);
  root.position.x = base.x + guard.dx;
  root.position.y = base.y + guard.dy - base.raise * s;
}

function aimNarrow() {
  camera.position.set(lookX * 0.5, camY - lookY * 0.35, camZ);
  camera.lookAt(root.position.x * 0.55, 0.15, 0);
}

/* Each piece's box in its own frame, hats included (all of them, at full
   size, so swapping hats never needs more room than was measured). */
function measureParts() {
  const keep = hats.map((h) => h.scale.x);
  hats.forEach((h) => h.scale.setScalar(1));
  parts.forEach((part) => {
    const o = part.obj;
    const pos = o.position.clone(), rot = o.rotation.clone(), scl = o.scale.clone();
    o.position.set(0, 0, 0); o.rotation.set(0, 0, 0); o.scale.set(1, 1, 1);
    o.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(o.matrixWorld).invert();
    const bb = new THREE.Box3().setFromObject(o).applyMatrix4(inv);
    /* a little extra for the cheese melting wider than it was measured */
    bb.expandByScalar(0.06);
    partBoxes.push(bb);
    o.position.copy(pos); o.rotation.copy(rot); o.scale.copy(scl);
  });
  hats.forEach((h, i) => h.scale.setScalar(keep[i]));
}

/* The pieces circle the stack as it turns, so the envelope is taken around
   the spin axis: a cylinder that holds every piece at any angle. That keeps
   the framing steady while the burger rotates instead of pumping with it. */
function keepInBox(dt) {
  if (!partBoxes.length) measureParts();
  root.updateMatrixWorld(true);
  camera.updateMatrixWorld();

  let reach = 0, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < parts.length; i++) {
    const m = parts[i].obj.matrix, bb = partBoxes[i];
    for (let c = 0; c < 8; c++) {
      corner.set(c & 1 ? bb.max.x : bb.min.x, c & 2 ? bb.max.y : bb.min.y, c & 4 ? bb.max.z : bb.min.z).applyMatrix4(m);
      reach = Math.max(reach, Math.hypot(corner.x, corner.z));
      y0 = Math.min(y0, corner.y);
      y1 = Math.max(y1, corner.y);
    }
  }

  let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
  for (let r = 0; r < RING; r++) {
    const a = (r / RING) * TAU;
    for (let e = 0; e < 2; e++) {
      corner.set(Math.cos(a) * reach, e ? y1 : y0, Math.sin(a) * reach)
        .applyMatrix4(spin.matrixWorld).project(camera);
      const px = (corner.x + 1) / 2 * viewW, py = (1 - corner.y) / 2 * viewH;
      left = Math.min(left, px); right = Math.max(right, px);
      top = Math.min(top, py); bottom = Math.max(bottom, py);
    }
  }

  /* the box rides out of frame with the section, and so does the burger */
  const pad = 6;
  const bx = box.x + pad, bw = Math.max(1, box.w - pad * 2);
  const by = box.y + pad - base.exit * viewH, bh = Math.max(1, box.h - pad * 2);
  const w = right - left, h = bottom - top;
  if (!(w > 0 && h > 0)) return;

  /* shrink at once when it does not fit; grow back gently when there is room */
  const goal = clamp(guard.k * Math.min(bw / w, bh / h), 0.3, 1);
  guard.k = goal < guard.k ? goal : damp(guard.k, goal, 1.5, dt);

  /* then centre what is there in the box. Height is a straight line, so it
     takes the full step. Width is not: the camera turns to follow the burger
     (x shows at 0.45 on screen, less the further out it goes), so a box near
     the edge may sit past where the burger can reach. Half steps, on a short
     leash; the shrink above is what keeps the sides clear. */
  const nudge = ((bx + bw / 2) - (left + right) / 2) / viewW * base.vw / 0.45;
  guard.dx = clamp(guard.dx + nudge * 0.5, -base.vw * 0.2, base.vw * 0.2);
  guard.dy = clamp(guard.dy - ((by + bh / 2) - (top + bottom) / 2) / viewH * base.vh, -base.vh, base.vh);
  if (!Number.isFinite(guard.dx + guard.dy + guard.k)) { guard.k = 1; guard.dx = guard.dy = 0; }
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
