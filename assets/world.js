/* Chapouu — the hat map. A globe you can spin, with every country's hat
   standing on it and ours marking Lebanon. Like the burger, it is all
   procedural: the only thing loaded is the coastline. */
import * as THREE from 'three';

const section = document.getElementById('hats');
const stage = section && section.querySelector('.world-stage');
const reduced = !!(window.chapouu && window.chapouu.reduced);

const TAU = Math.PI * 2;
const RAD = Math.PI / 180;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));

const C = {
  teal: 0x3E7571, tealDeep: 0x2C5754, tealInk: 0x1B3937,
  flame: 0xE44621, clay: 0xAD523F, tan: 0xCA7247,
  sand: 0xFDF3E3, cream: 0xFFFBF3
};

/* -------------------------------------------------------------------------
   Hat-making kit
   ------------------------------------------------------------------------- */
function M(color, roughness = 0.85, extra) {
  return new THREE.MeshStandardMaterial(Object.assign({ color, roughness, metalness: 0.02 }, extra));
}

function lathe(pts, material, seg = 36) {
  return new THREE.Mesh(new THREE.LatheGeometry(pts.map((p) => new THREE.Vector2(p[0], p[1])), seg), material);
}

function ball(r, material, x, y, z, sx = 1, sy = 1, sz = 1) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10), material);
  m.position.set(x, y, z);
  m.scale.set(sx, sy, sz);
  return m;
}

function rod(r, len, material, x, y, z, rz = 0) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 8), material);
  m.position.set(x, y, z);
  m.rotation.z = rz;
  return m;
}

/* A crown: straight (or tapering) side from r0 to r1, rounded over the top.
   `round` runs from a hard-edged pillbox (0) to a full dome (1). */
function crownPts(r0, r1, h, round = 0.3, y0 = 0) {
  const k = Math.max(0.001, Math.min(round, 1) * Math.min(h, r1));
  const pts = [];
  if (Math.abs(r0 - r1) > 1e-3 || h - k > 1e-3) pts.push([r0, y0]);
  for (let i = 0; i <= 7; i++) {
    const a = (i / 7) * Math.PI / 2;
    pts.push([r1 - k + Math.cos(a) * k, y0 + h - k + Math.sin(a) * k]);
  }
  if (r1 - k > 1e-3) pts.push([0, y0 + h]);
  return pts;
}

/* A brim with a little thickness: the underside is traced outward first, then
   the top back in, so the normals face out. */
function brimPts(R, rIn, droop = 0, curl = 0, t = 0.03) {
  const top = [];
  for (let i = 0; i <= 10; i++) {
    const u = i / 10;
    top.push([lerp(rIn * 0.9, R, u), -droop * u + curl * u * u * u]);
  }
  const pts = [[0, top[0][1] - t]].concat(top.map((p) => [p[0], p[1] - t]));
  for (let i = top.length - 1; i >= 0; i--) pts.push(top[i]);
  return pts;
}

/* Roll the brim up at the sides (or one side only, for a slouch hat). */
function curlSides(geo, rIn, R, amount, oneSide) {
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const r = Math.hypot(x, z);
    if (r <= rIn) continue;
    const u = (r - rIn) / (R - rIn), c = x / r;
    pos.setY(i, pos.getY(i) + amount * u * u * (oneSide ? Math.max(0, c) * c : c * c));
  }
  geo.computeVertexNormals();
}

function pattern(w, h, draw, ru = 1, rv = 1) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  draw(cv.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(ru, rv);
  return tex;
}

/* Stripes running round the hat. Listed tip first. */
const bands = (cols) => pattern(8, 64, (c, w, h) => {
  cols.forEach((col, i) => { c.fillStyle = col; c.fillRect(0, Math.floor(i * h / cols.length), w, Math.ceil(h / cols.length)); });
});

const knitted = (base, a, b) => pattern(64, 64, (c, w, h) => {
  c.fillStyle = base; c.fillRect(0, 0, w, h);
  c.fillStyle = a; c.fillRect(0, 6, w, 4); c.fillRect(0, 50, w, 5);
  c.fillStyle = b; c.fillRect(0, 26, w, 14);
  c.strokeStyle = a; c.lineWidth = 3; c.beginPath();
  for (let x = 0; x <= w; x += 16) { c.moveTo(x, 38); c.lineTo(x + 8, 28); c.lineTo(x + 16, 38); }
  c.stroke();
  c.strokeStyle = b; c.beginPath();
  for (let x = 0; x <= w; x += 16) { c.moveTo(x, 22); c.lineTo(x + 8, 14); c.lineTo(x + 16, 22); }
  c.stroke();
}, 6, 1);

const plaid = (base, a, b, ru = 10, rv = 3) => pattern(32, 32, (c, w, h) => {
  c.fillStyle = base; c.fillRect(0, 0, w, h);
  c.globalAlpha = 0.75;
  c.fillStyle = a; c.fillRect(4, 0, 7, h); c.fillRect(0, 4, w, 7);
  c.fillStyle = b; c.fillRect(20, 0, 3, h); c.fillRect(0, 20, w, 3);
}, ru, rv);

const camo = () => pattern(64, 64, (c, w, h) => {
  c.fillStyle = '#6F7A4E'; c.fillRect(0, 0, w, h);
  const cols = ['#3F4A30', '#A39A6B', '#54432F', '#8A9463'];
  let s = 5;
  const rand = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  for (let i = 0; i < 40; i++) {
    c.fillStyle = cols[i % cols.length];
    c.beginPath();
    c.ellipse(rand() * w, rand() * h, 4 + rand() * 9, 3 + rand() * 6, rand() * 3, 0, TAU);
    c.fill();
  }
}, 3, 2);

/* The big family: anything with a crown and a brim. */
function brimmed(o) {
  const g = new THREE.Group();
  const r1 = o.r1 == null ? o.r0 * 0.85 : o.r1;
  const brim = lathe(brimPts(o.R, o.r0, o.droop, o.curl), M(o.brim == null ? o.color : o.brim, o.rough, o.map && { map: o.map }), 48);
  if (o.sides) curlSides(brim.geometry, o.r0, o.R, o.sides, o.one);
  g.add(brim);

  const top = new THREE.Group();
  top.add(lathe(crownPts(o.r0, r1, o.h, o.round), M(o.color, o.rough, o.map && { map: o.map })));
  if (o.band != null) {
    const bh = o.bandH || 0.07;
    const rb = Math.max(o.r0, lerp(o.r0, r1, bh / o.h));
    top.add(lathe([[o.r0 * 1.035, 0.004], [rb * 1.035, bh]], M(o.band, 0.7, { side: THREE.DoubleSide })));
  }
  if (o.pinch) top.scale.x = o.pinch;
  g.add(top);
  return g;
}

/* Anything with a bill out front. */
function cap(o) {
  const g = new THREE.Group();
  const r = o.r || 0.34, len = o.len || 0.24;
  g.add(lathe(crownPts(r, o.r1 == null ? r : o.r1, o.h, o.round == null ? 1 : o.round), M(o.color, 0.8, o.map && { map: o.map })));
  const bill = new THREE.Mesh(
    new THREE.CylinderGeometry(r + len, r + len, 0.03, 28, 1, false, -Math.PI / 2, Math.PI),
    M(o.bill == null ? o.color : o.bill, 0.7)
  );
  bill.scale.x = r / (r + len);
  bill.position.y = 0.03;
  bill.rotation.x = 0.16;
  g.add(bill);
  if (o.band != null) g.add(lathe([[r * 1.03, 0.004], [r * 1.03, 0.07]], M(o.band, 0.7, { side: THREE.DoubleSide })));
  if (o.button != null) g.add(ball(0.035, M(o.button, 0.6), 0, o.h, 0));
  return g;
}

/* Knitted: a dome, with ear flaps, tassels and a pompom as wanted. */
function knit(o) {
  const g = new THREE.Group();
  const r = 0.32, h = o.h || 0.34;
  g.add(lathe(crownPts(r, r, h, 1), M(0xffffff, 0.95, { map: o.map })));
  if (o.flaps != null) {
    [-1, 1].forEach((s) => {
      g.add(ball(0.17, M(o.flaps, 0.95), s * r * 0.95, -0.09, 0, 0.3, 1, 0.85));
      g.add(rod(0.012, 0.3, M(o.tassel == null ? o.flaps : o.tassel, 0.9), s * r * 0.95, -0.4, 0));
    });
  }
  if (o.pom != null) g.add(ball(0.075, M(o.pom, 1), 0, h + 0.05, 0));
  return g;
}

/* Fur: a round crown with flaps tied up, or left down for the cold. */
function fur(o) {
  const g = new THREE.Group();
  g.add(lathe(crownPts(o.r0, o.r1, o.h, o.round), M(o.color, 1)));
  const trim = M(o.trim == null ? o.color : o.trim, 1);
  if (o.up) {
    [-1, 1].forEach((s) => g.add(ball(1, trim, s * o.r0 * 1.04, o.h * 0.55, 0, 0.08, o.h * 0.5, 0.2)));
    g.add(ball(1, trim, 0, o.h * 0.45, o.r0, 0.2, o.h * 0.4, 0.07));
  }
  if (o.down) {
    [-1, 1].forEach((s) => g.add(ball(1, trim, s * o.r0, -0.07, 0, 0.09, 0.22, 0.2)));
    g.add(ball(1, trim, 0, 0.1, o.r0 * 0.96, 0.22, 0.1, 0.07));
  }
  return g;
}

/* -------------------------------------------------------------------------
   The hats, one by one
   ------------------------------------------------------------------------- */
function hatChapouu() {
  const g = brimmed({ R: 0.62, r0: 0.25, r1: 0.2, h: 0.24, round: 1, droop: 0.1, curl: 0.2, color: C.clay, brim: C.flame, band: C.tan, rough: 0.72 });
  g.add(rod(0.014, 0.34, M(C.clay, 0.6), 0.03, 0.39, 0, -0.12));
  const ribbon = M(C.flame, 0.6);
  for (let i = 0; i < 3; i++) {
    const f = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.045, 0.025), ribbon);
    f.position.set(0.09 + (i % 2) * 0.07, 0.5 + i * 0.065, 0);
    f.rotation.z = i % 2 ? 0.5 : -0.5;
    g.add(f);
  }
  return g;
}

function hatAlpine() {
  const g = brimmed({ R: 0.42, r0: 0.27, r1: 0.19, h: 0.34, round: 0.6, droop: 0.03, curl: 0.07, color: 0x8B7F6E, band: 0x4A4036 });
  const feather = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.3, 8), M(C.flame, 0.7));
  feather.position.set(0.27, 0.2, 0);
  feather.rotation.z = -0.25;
  g.add(feather);
  return g;
}

function hatTam() {
  const g = new THREE.Group();
  g.add(lathe([[0.25, 0], [0.27, 0.05], [0.44, 0.09], [0.5, 0.13], [0.5, 0.17], [0.42, 0.22], [0.22, 0.26], [0, 0.27]],
    M(0xffffff, 0.95, { map: plaid('#2E5FA8', '#F0C63A', '#2F7D4F') })));
  g.add(lathe([[0.26, -0.02], [0.26, 0.05]], M(0x1D2B4A, 0.9, { side: THREE.DoubleSide })));
  g.add(ball(0.065, M(0xC8372D, 1), 0, 0.3, 0));
  return g;
}

function hatBeret() {
  const g = new THREE.Group();
  g.add(lathe([[0.25, 0], [0.3, 0.04], [0.45, 0.09], [0.46, 0.14], [0.36, 0.2], [0.18, 0.23], [0, 0.235]], M(0x5F7183, 0.95)));
  g.add(rod(0.012, 0.06, M(0x44525F, 0.9), 0, 0.26, 0));
  g.rotation.z = 0.12;
  return g;
}

function hatFlatCap() {
  const g = cap({ r: 0.36, h: 0.2, len: 0.12, color: 0xffffff, bill: 0x6E4630, map: plaid('#8A5A3C', '#B5412F', '#3F2A1E', 8, 2) });
  g.scale.z = 1.2;
  g.rotation.x = 0.14;
  return g;
}

function hatTailCap() {
  const g = new THREE.Group();
  const black = M(0x1F1D22, 0.8);
  g.add(lathe(crownPts(0.3, 0.3, 0.2, 1), black));
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0.2, 0), new THREE.Vector3(0.2, 0.23, 0),
    new THREE.Vector3(0.36, 0.06, 0), new THREE.Vector3(0.4, -0.36, 0)
  ]);
  g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 18, 0.03, 8), black));
  g.add(rod(0.042, 0.08, M(0xC9CED3, 0.35, { metalness: 0.6 }), 0.375, -0.02, 0, 0.08));
  return g;
}

function hatFez() {
  const g = new THREE.Group();
  g.add(lathe(crownPts(0.3, 0.23, 0.42, 0.1), M(0xB3202A, 0.9)));
  const cord = M(0x1C1A1A, 0.8);
  g.add(rod(0.012, 0.24, cord, 0.12, 0.43, 0, Math.PI / 2));
  g.add(rod(0.022, 0.22, cord, 0.25, 0.32, 0));
  return g;
}

function hatToque() {
  return lathe([[0.29, 0], [0.29, 0.3], [0.4, 0.37], [0.45, 0.45], [0.41, 0.54], [0.24, 0.6], [0, 0.615]], M(0xFBFAF6, 0.9));
}

function hatDastar() {
  const g = new THREE.Group();
  const cloth = M(0xEE8A3C, 0.9);
  g.add(ball(1, cloth, 0, 0.2, 0, 0.38, 0.3, 0.42));
  for (let i = 0; i < 4; i++) {
    const wrap = new THREE.Mesh(new THREE.TorusGeometry(0.33 - i * 0.03, 0.075, 8, 32), cloth);
    wrap.rotation.set(Math.PI / 2, (i % 2 ? 1 : -1) * (0.28 + i * 0.05), 0);
    wrap.position.y = 0.1 + i * 0.075;
    g.add(wrap);
  }
  return g;
}

function hatRice() {
  return lathe([[0, -0.03], [0.5, -0.03], [0.52, 0], [0.27, 0.15], [0, 0.3]],
    M(0xffffff, 0.95, { map: bands(['#CDAF72', '#E2C88E', '#D4B679', '#E6CD95', '#CFB274', '#E2C88E']) }));
}

function hatRasta() {
  return lathe([[0.3, 0], [0.36, 0.1], [0.41, 0.24], [0.34, 0.37], [0.16, 0.44], [0, 0.45]],
    M(0xffffff, 0.95, { map: bands(['#C9302B', '#EBC43A', '#2F8A4B', '#1C1C1C', '#C9302B', '#EBC43A', '#2F8A4B', '#1C1C1C']) }));
}

function hatKufi() {
  return lathe(crownPts(0.32, 0.31, 0.25, 0.4), M(0xffffff, 0.95, { map: plaid('#6F7176', '#8E9096', '#55575C', 14, 3) }));
}

/* West to east and round again — the order the arrows walk the globe in. */
const HATS = [
  { name: 'Chapouu', place: 'Lebanon', at: [33.9, 35.6], make: hatChapouu },
  { name: 'Fiddler', place: 'Greece', at: [39, 22], make: () => cap({ r: 0.33, r1: 0.37, h: 0.2, round: 0.35, len: 0.14, color: 0x7C8455, bill: 0x2A2B26, band: 0x8C3B2E }) },
  { name: 'Cossack', place: 'Ukraine', at: [49, 32], make: () => fur({ r0: 0.33, r1: 0.37, h: 0.4, round: 0.25, color: 0xC2BCAE }) },
  { name: 'Alpine', place: 'Germany', at: [51, 10], make: hatAlpine },
  { name: 'Toque', place: 'France', at: [46.5, 2.5], make: hatToque },
  { name: 'Bowler', place: 'England', at: [52, -1], make: () => brimmed({ R: 0.45, r0: 0.3, r1: 0.3, h: 0.34, round: 1, curl: 0.07, color: 0x1E1E20, band: 0x38383C, rough: 0.5 }) },
  { name: 'Flat Cap', place: 'Ireland', at: [53, -8], make: hatFlatCap },
  { name: 'Tam o’ Shanter', place: 'Scotland', at: [57, -4], make: hatTam },
  { name: 'Tail Cap', place: 'Iceland', at: [65, -19], make: hatTailCap },
  { name: 'Beret', place: 'Spain', at: [40, -4], make: hatBeret },
  { name: 'Fez', place: 'Morocco', at: [32, -6], make: hatFez },
  { name: 'Kufi', place: 'Kenya', at: [0, 38], make: hatKufi },
  { name: 'Ushanka', place: 'Russia', at: [60, 75], make: () => fur({ r0: 0.34, r1: 0.35, h: 0.3, round: 0.3, color: 0x6F5642, trim: 0x8E7359, up: true }) },
  { name: 'Dastar', place: 'India', at: [22, 79], make: hatDastar },
  { name: 'Sherpa', place: 'Nepal', at: [28, 84], make: () => knit({ map: knitted('#F2EEE4', '#1E1E22', '#1E1E22'), flaps: 0xF2EEE4, tassel: 0x1E1E22 }) },
  { name: 'Rice Hat', place: 'Vietnam', at: [16, 107], make: hatRice },
  { name: 'Boonie', place: 'Philippines', at: [13, 122], make: () => brimmed({ R: 0.46, r0: 0.29, r1: 0.27, h: 0.24, round: 0.3, droop: 0.12, color: 0xffffff, map: camo() }) },
  { name: 'Slouch', place: 'Australia', at: [-25, 134], make: () => brimmed({ R: 0.52, r0: 0.28, r1: 0.22, h: 0.3, round: 0.5, pinch: 0.82, droop: 0.03, sides: 0.26, one: true, color: 0x6B4A35, band: 0x3A281D }) },
  { name: 'Bolero', place: 'Argentina', at: [-35, -64], make: () => brimmed({ R: 0.52, r0: 0.27, r1: 0.26, h: 0.22, round: 0.1, color: 0x1D1B1C, band: 0xB98A4E, bandH: 0.05, rough: 0.6 }) },
  { name: 'Chullo', place: 'Peru', at: [-10, -75], make: () => knit({ map: knitted('#5E86A6', '#F4F1EA', '#2E3F55'), flaps: 0x5E86A6, tassel: 0xF4F1EA, pom: 0x2E3F55 }) },
  { name: 'Panama', place: 'Ecuador', at: [-1.5, -78], make: () => brimmed({ R: 0.47, r0: 0.28, r1: 0.23, h: 0.3, round: 0.5, pinch: 0.82, droop: 0.03, curl: 0.03, color: 0xF4EAD2, band: 0x1E1E1E }) },
  { name: 'Cadet Cap', place: 'Venezuela', at: [7, -66], make: () => cap({ r: 0.33, r1: 0.34, h: 0.24, round: 0.15, len: 0.2, color: 0x66704A }) },
  { name: 'Rasta Cap', place: 'Jamaica', at: [18, -77], make: hatRasta },
  { name: 'Trilby', place: 'Cuba', at: [22, -79], make: () => brimmed({ R: 0.4, r0: 0.27, r1: 0.22, h: 0.3, round: 0.5, pinch: 0.82, droop: 0.05, color: 0xF3EEDF, band: 0x23221F }) },
  { name: 'Sombrero', place: 'Mexico', at: [23, -102], make: () => brimmed({ R: 0.62, r0: 0.2, r1: 0.11, h: 0.42, round: 0.9, droop: 0.04, curl: 0.24, color: 0xE2C277, band: C.flame, bandH: 0.09 }) },
  { name: 'Western', place: 'USA', at: [31, -100], make: () => brimmed({ R: 0.56, r0: 0.27, r1: 0.22, h: 0.34, round: 0.4, pinch: 0.8, sides: 0.18, color: 0xE8DCC2, band: 0x6A4A32 }) },
  { name: 'Fedora', place: 'USA', at: [41.9, -87.6], make: () => brimmed({ R: 0.46, r0: 0.28, r1: 0.22, h: 0.32, round: 0.45, pinch: 0.8, droop: 0.02, curl: 0.04, color: 0x263247, band: 0xC9A772 }) },
  { name: 'Ball Cap', place: 'USA', at: [41, -74], make: () => cap({ h: 0.3, color: 0xF7F6F2, bill: C.teal, button: C.teal }) },
  { name: 'Trapper', place: 'Canada', at: [56, -106], make: () => fur({ r0: 0.34, r1: 0.34, h: 0.3, round: 0.9, color: 0x4A3526, trim: 0x8C7358, down: true }) }
];

/* -------------------------------------------------------------------------
   The card beside the globe. This part works with or without WebGL.
   ------------------------------------------------------------------------- */
const ui = section && {
  card: section.querySelector('.hat-card'),
  name: section.querySelector('.hat-card-name'),
  place: section.querySelector('.hat-card-place'),
  index: section.querySelector('.hat-card-count b'),
  total: section.querySelector('.hat-card-count i')
};

let active = 0;
let touched = false;   /* once someone takes the wheel, the tour stops */
let fly = () => {};    /* filled in once there is a globe to turn */

const pad = (n) => (n < 10 ? '0' : '') + n;

function select(i, turn = true) {
  const next = (i + HATS.length) % HATS.length;
  const changed = next !== active;
  active = next;
  if (ui && ui.card && changed) {
    ui.name.textContent = HATS[active].name;
    ui.place.textContent = HATS[active].place;
    ui.index.textContent = pad(active + 1);
    ui.card.classList.toggle('is-home', active === 0);
    ui.card.classList.remove('is-swap');
    void ui.card.offsetWidth;
    ui.card.classList.add('is-swap');
  }
  if (turn) fly(active);
}

if (ui && ui.total) ui.total.textContent = HATS.length;

if (section) {
  section.querySelectorAll('[data-world]').forEach((btn) => {
    btn.addEventListener('click', () => {
      touched = true;
      const what = btn.dataset.world;
      select(what === 'home' ? 0 : active + (what === 'prev' ? -1 : 1));
    });
  });
}

/* -------------------------------------------------------------------------
   The globe
   ------------------------------------------------------------------------- */
const R = 3;            /* globe radius */
const ALT = 0.34;       /* how far above the ground a hat floats on its pin */
const HAT = 0.44;       /* hat size */
const SPREAD = 8.6 * RAD;  /* closest two hats may stand, so Europe is not a pile */
const RISE = 42;       /* degrees above dead centre the chosen hat is shown at —
                           face-on it would just be a circle seen from the top */
const TILT_MAX = 52;

/* lat/lon in degrees to a unit vector, matching three's sphere UVs */
function toDir(lat, lon, out = new THREE.Vector3()) {
  const a = lat * RAD, b = lon * RAD;
  return out.set(Math.cos(a) * Math.cos(b), Math.sin(a), -Math.cos(a) * Math.sin(b));
}

let renderer, scene, camera, tilt, globe, sphere, stems;
const pins = [];
const hits = [];
const view = { lon: 35.6, tilt: 0, toLon: 35.6, toTilt: 0 };
let seen = false, dragging = false, tour = 0;

/* Paint the map: pale land on a deep blue sea. */
function mapTexture(rings) {
  const W = 2048, H = 1024;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const sea = ctx.createLinearGradient(0, 0, 0, H);
  sea.addColorStop(0, '#1F4A5C');
  sea.addColorStop(0.5, '#173B4D');
  sea.addColorStop(1, '#0F2A3A');
  ctx.fillStyle = sea;
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = 'rgba(255,251,243,.09)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let lon = 0; lon < 360; lon += 30) { ctx.moveTo(lon / 360 * W, 0); ctx.lineTo(lon / 360 * W, H); }
  for (let lat = 30; lat < 180; lat += 30) { ctx.moveTo(0, lat / 180 * H); ctx.lineTo(W, lat / 180 * H); }
  ctx.stroke();

  if (rings) {
    ctx.beginPath();
    rings.forEach((ring) => {
      /* A coast that crosses the date line jumps from one edge of the map to
         the other. Unroll it so it runs on continuously, then draw it three
         times, a whole turn apart, and let the canvas clip the spares. */
      const pts = [];
      let shift = 0, wraps = false;
      for (let i = 0; i < ring.length; i += 2) {
        const lon = ring[i] / 10;
        if (i) {
          const step = lon + shift - pts[pts.length - 1][0];
          if (step > 180) { shift -= 360; wraps = true; } else if (step < -180) { shift += 360; wraps = true; }
        }
        pts.push([lon + shift, ring[i + 1] / 10]);
      }
      /* Antarctica goes all the way round: close it off along the pole */
      const first = pts[0], last = pts[pts.length - 1];
      if (Math.abs(last[0] - first[0]) > 180) {
        const pole = first[1] < 0 ? -90 : 90;
        pts.push([last[0], pole], [first[0], pole]);
      }
      (wraps ? [-360, 0, 360] : [0]).forEach((turn) => {
        pts.forEach((p, i) => {
          const x = (p[0] + turn + 180) / 360 * W, y = (90 - p[1]) / 180 * H;
          if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
        });
        ctx.closePath();
      });
    });
    ctx.fillStyle = '#F3EEE1';
    ctx.fill('evenodd');
    ctx.strokeStyle = 'rgba(15,42,58,.45)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/* Hats start on their country and shoulder each other apart until none
   overlap. Ours does not budge. Each keeps a line back to where it belongs. */
function settle(anchors) {
  const dirs = anchors.map((a) => a.clone());
  const d = new THREE.Vector3();
  for (let n = 0; n < 120; n++) {
    for (let i = 0; i < dirs.length; i++) {
      for (let j = i + 1; j < dirs.length; j++) {
        const ang = dirs[i].angleTo(dirs[j]);
        if (ang >= SPREAD) continue;
        d.subVectors(dirs[i], dirs[j]);
        if (d.lengthSq() < 1e-8) d.set(0.01, 0.01, 0);
        d.normalize().multiplyScalar((SPREAD - ang) * 0.5);
        if (i === 0) dirs[j].addScaledVector(d, -2).normalize();
        else {
          dirs[i].add(d).normalize();
          dirs[j].sub(d).normalize();
        }
      }
    }
    for (let i = 1; i < dirs.length; i++) dirs[i].lerp(anchors[i], 0.02).normalize();
  }
  return dirs;
}

function init() {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  stage.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);

  scene.add(new THREE.HemisphereLight(C.cream, 0x2C5754, 1.5));
  const key = new THREE.DirectionalLight(0xFFF4E2, 2.1);
  key.position.set(5, 7, 9);
  scene.add(key);
  const rim = new THREE.DirectionalLight(C.flame, 0.9);
  rim.position.set(-7, -3, -4);
  scene.add(rim);

  tilt = new THREE.Group();
  globe = new THREE.Group();
  tilt.add(globe);
  scene.add(tilt);

  sphere = new THREE.Mesh(
    new THREE.SphereGeometry(R, 96, 64),
    M(0xffffff, 0.92, { map: mapTexture(null) })
  );
  globe.add(sphere);

  fetch('/assets/land.json')
    .then((res) => (res.ok ? res.json() : Promise.reject(new Error(res.status))))
    .then((rings) => {
      sphere.material.map.dispose();
      sphere.material.map = mapTexture(rings);
      sphere.material.needsUpdate = true;
    })
    .catch((err) => console.warn('Chapouu globe: no coastline,', err && err.message));

  const anchors = HATS.map((h) => toDir(h.at[0], h.at[1]));
  const dirs = settle(anchors);
  const up = new THREE.Vector3(0, 1, 0);
  const dot = new THREE.SphereGeometry(1, 12, 8);
  const dotMat = M(C.tealInk, 0.6);
  const hitGeo = new THREE.SphereGeometry(0.62, 8, 6);
  const hitMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });

  HATS.forEach((h, i) => {
    const home = i === 0;
    const pin = new THREE.Group();
    pin.quaternion.setFromUnitVectors(up, dirs[i]);
    const inner = new THREE.Group();
    inner.add(h.make());
    const hit = new THREE.Mesh(hitGeo, hitMat);
    hit.position.y = 0.2;
    hit.userData.hat = i;
    inner.add(hit);
    hits.push(hit);
    pin.add(inner);
    globe.add(pin);

    /* the marker on the map itself — ours is the red pin off the poster */
    const mark = new THREE.Mesh(dot, home ? M(C.flame, 0.4) : dotMat);
    mark.position.copy(anchors[i]).multiplyScalar(R);
    mark.scale.setScalar(home ? 0.085 : 0.035);
    globe.add(mark);

    pins.push({ pin, inner, dir: dirs[i], anchor: anchors[i], k: home ? 1 : 0, was: -1 });
  });

  stems = new THREE.LineSegments(
    new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(HATS.length * 6), 3)),
    new THREE.LineBasicMaterial({ color: C.tealInk, transparent: true, opacity: 0.7 })
  );
  stems.frustumCulled = false;
  globe.add(stems);

  /* Turn the globe to put a hat in the showing position, the short way round */
  fly = (i) => {
    const d = pins[i].dir;
    const lat = Math.asin(clamp(d.y, -1, 1)) / RAD;
    const lon = Math.atan2(-d.z, d.x) / RAD;
    view.toLon = view.lon + ((lon - view.lon + 540) % 360) - 180;
    view.toTilt = clamp(lat - RISE, -TILT_MAX, TILT_MAX);
    tour = 0;
  };
  fly(0);
  view.lon = view.toLon - (reduced ? 0 : 70);   /* arrive with a turn */
  view.tilt = view.toTilt;

  bindPointer();

  new ResizeObserver(resize).observe(stage);
  resize();

  if ('IntersectionObserver' in window) {
    new IntersectionObserver((entries) => { seen = entries[0].isIntersecting; }, { rootMargin: '120px' }).observe(stage);
  } else {
    seen = true;
  }

  renderer.compile(scene, camera);
  stage.classList.add('is-ready');
  renderer.setAnimationLoop(frame);
}

function resize() {
  const w = stage.clientWidth, h = stage.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  /* keep the whole globe, and the tallest hat on it, inside the short side */
  camera.position.set(0, 0, 16 / Math.min(1, camera.aspect));
  camera.updateProjectionMatrix();
}

/* -------------------------------------------------------------------------
   Pointer: drag to spin, tap a hat to pick it
   ------------------------------------------------------------------------- */
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();

function pick(e) {
  const rect = renderer.domElement.getBoundingClientRect();
  ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  /* the globe is in the list too, so hats round the back cannot be picked */
  const hit = ray.intersectObjects([sphere].concat(hits), false)[0];
  return hit && hit.object.userData.hat != null ? hit.object.userData.hat : -1;
}

function bindPointer() {
  const el = renderer.domElement;
  let id = null, lastX = 0, lastY = 0, moved = 0;

  el.addEventListener('pointerdown', (e) => {
    id = e.pointerId;
    lastX = e.clientX; lastY = e.clientY; moved = 0;
    el.setPointerCapture(id);
  });

  el.addEventListener('pointermove', (e) => {
    if (id === null) {
      el.style.cursor = pick(e) >= 0 ? 'pointer' : '';
      return;
    }
    if (e.pointerId !== id) return;
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
    moved += Math.abs(dx) + Math.abs(dy);
    if (moved < 6) return;
    dragging = touched = true;
    stage.classList.add('is-dragging');
    const k = 150 / Math.max(stage.clientWidth, 1);
    view.toLon = view.lon = view.lon - dx * k;
    view.toTilt = view.tilt = clamp(view.tilt + dy * k, -TILT_MAX, TILT_MAX);
  });

  const release = (e) => {
    if (e.pointerId !== id) return;
    id = null;
    stage.classList.remove('is-dragging');
    if (!dragging && e.type === 'pointerup') {
      const i = pick(e);
      if (i >= 0) { touched = true; select(i); }
    }
    dragging = false;
  };
  el.addEventListener('pointerup', release);
  el.addEventListener('pointercancel', release);
}

/* -------------------------------------------------------------------------
   Frame
   ------------------------------------------------------------------------- */
const clock = new THREE.Clock();
const focus = new THREE.Vector3();

function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  if (!seen) return;

  /* Left alone, the globe walks itself from hat to hat */
  if (!touched && !reduced) {
    tour += dt;
    if (tour > 3.4) select(active + 1);
  }

  /* While it is being dragged, whichever hat is nearest the showing position
     becomes the chosen one */
  if (dragging) {
    toDir(view.tilt + RISE, view.lon, focus);
    let best = active, most = -2;
    for (let i = 0; i < pins.length; i++) {
      const d = pins[i].dir.dot(focus);
      if (d > most) { most = d; best = i; }
    }
    if (best !== active) select(best, false);
  }

  const ease = reduced ? 60 : 3.6;
  view.lon = damp(view.lon, view.toLon, ease, dt);
  view.tilt = damp(view.tilt, view.toTilt, ease, dt);
  globe.rotation.y = -Math.PI / 2 - view.lon * RAD;
  tilt.rotation.x = view.tilt * RAD;

  /* The chosen hat rises off the map, grows, and turns to show itself */
  const line = stems.geometry.attributes.position;
  let moved = false;
  for (let i = 0; i < pins.length; i++) {
    const p = pins[i];
    const goal = i === active ? 1 : 0;
    p.k = damp(p.k, goal, 7, dt);
    if (Math.abs(p.k - goal) < 0.001) p.k = goal;
    if (p.k > 0 && !reduced) p.inner.rotation.y += dt * 0.7 * p.k;
    if (p.k === p.was) continue;
    p.was = p.k;
    moved = true;
    const alt = R + ALT + p.k * 0.34;
    p.pin.position.copy(p.dir).multiplyScalar(alt);
    p.inner.scale.setScalar(HAT * (1 + p.k * 1.15));
    line.setXYZ(i * 2, p.anchor.x * R, p.anchor.y * R, p.anchor.z * R);
    line.setXYZ(i * 2 + 1, p.dir.x * alt, p.dir.y * alt, p.dir.z * alt);
  }
  if (moved) line.needsUpdate = true;

  renderer.render(scene, camera);
}

/* -------------------------------------------------------------------------
   Start, or leave the card to do the talking
   ------------------------------------------------------------------------- */
if (section && stage) {
  try {
    const probe = document.createElement('canvas');
    if (!(window.WebGLRenderingContext && (probe.getContext('webgl2') || probe.getContext('webgl')))) throw new Error('no webgl');
    init();
  } catch (err) {
    section.classList.add('no-globe');
    console.warn('Chapouu globe disabled:', err && err.message);
  }
}
