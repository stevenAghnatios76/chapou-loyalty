/* Chapouu — the toys in the margins.
   Small procedural props float beside the content: fries, a slice, a cold cup,
   a beach ball, the hat. They bob on their own, lean and spin with the scroll,
   turn to look at the cursor, perk up when it lands on them, and pop when they
   are clicked or tapped.

   One fixed canvas draws them all, over the page but never catching a click.
   Each prop is drawn on top of an empty .prop anchor in the markup, so the
   stylesheet decides where they sit; hover is worked out from coordinates. */
import * as THREE from 'three';

const host = document.getElementById('props');
const anchors = Array.prototype.slice.call(document.querySelectorAll('.prop[data-prop]'));
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
const easeOutBack = (x) => { const c = 1.9; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* The logo palette, plus the few food colours it does not cover */
const C = {
  flame:   0xE44621,
  clay:    0xAD523F,
  tan:     0xCA7247,
  teal:    0x3E7571,
  tealInk: 0x1B3937,
  sand:    0xF4E3C9,
  cream:   0xFFFBF3,
  cheese:  0xF0A531,
  leaf:    0x5E9A5A
};
const CONFETTI = [C.flame, C.teal, C.cheese, C.cream, C.clay, C.leaf];

function mat(color, roughness = 0.6, extra = {}) {
  return new THREE.MeshStandardMaterial(Object.assign({ color, roughness, metalness: 0 }, extra));
}

function gloss(color, roughness = 0.32, extra = {}) {
  return new THREE.MeshPhysicalMaterial(Object.assign(
    { color, roughness, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.3 }, extra
  ));
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

function canvasTexture(size, draw) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  draw(cv.getContext('2d'), size);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* -------------------------------------------------------------------------
   The props. Each one is built to fit roughly inside a unit sphere.
   ------------------------------------------------------------------------- */
function fries() {
  const g = new THREE.Group();
  const H = 1.0, RT = 0.62, RB = 0.46, Y = -0.32;
  /* a four-sided lathe is a tapered box; turned so a flat face is in front */
  const carton = new THREE.Group();
  carton.rotation.y = Math.PI / 4;
  carton.position.y = Y;
  carton.add(new THREE.Mesh(
    new THREE.CylinderGeometry(RT, RB, H, 4, 1, true),
    mat(C.flame, 0.5, { flatShading: true, side: THREE.DoubleSide })
  ));
  const at = (y) => RB + (RT - RB) * (y + H / 2) / H;
  const y0 = 0.06, y1 = 0.22;
  const band = new THREE.Mesh(
    new THREE.CylinderGeometry(at(y1) * 1.012, at(y0) * 1.012, y1 - y0, 4, 1, true),
    mat(C.cream, 0.6, { flatShading: true })
  );
  band.position.y = (y0 + y1) / 2;
  carton.add(band);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(RB, 4), mat(C.clay, 0.7));
  floor.rotation.x = Math.PI / 2;
  floor.position.y = -H / 2;
  carton.add(floor);
  g.add(carton);

  const fry = new THREE.BoxGeometry(0.12, 1, 0.12);
  const golden = mat(0xF2B544, 0.68);
  const r = rng(5);
  for (let i = 0; i < 14; i++) {
    const m = new THREE.Mesh(fry, golden);
    const len = 0.7 + r() * 0.45;
    const x = (r() - 0.5) * 0.62, z = (r() - 0.5) * 0.62;
    m.scale.y = len;
    m.position.set(x, Y + H / 2 - 0.42 + len / 2, z);
    /* fan out toward the rim of the carton */
    m.rotation.set(z * 0.5, r() * 0.6, -x * 0.5 + (r() - 0.5) * 0.15);
    g.add(m);
  }
  return g;
}

function pizza() {
  const g = new THREE.Group();
  const shape = new THREE.Shape();
  shape.moveTo(0, -0.95);
  shape.lineTo(-0.66, 0.55);
  shape.quadraticCurveTo(0, 0.86, 0.66, 0.55);
  shape.lineTo(0, -0.95);

  const dough = new THREE.ExtrudeGeometry(shape, {
    depth: 0.1, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 2, curveSegments: 24
  });
  dough.translate(0, 0, -0.05);
  g.add(new THREE.Mesh(dough, mat(0xE2A766, 0.8)));

  const cheese = new THREE.ExtrudeGeometry(shape, { depth: 0.03, bevelEnabled: false, curveSegments: 24 });
  cheese.scale(0.86, 0.86, 1);
  cheese.translate(0, -0.03, 0.075);
  g.add(new THREE.Mesh(cheese, gloss(0xF5BE45, 0.45, { clearcoat: 0.3 })));

  const curve = new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(-0.66, 0.55, 0.02), new THREE.Vector3(0, 0.86, 0.02), new THREE.Vector3(0.66, 0.55, 0.02)
  );
  const crustMat = mat(0xD08A4E, 0.7);
  g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 32, 0.12, 12), crustMat));
  [-0.66, 0.66].forEach((x) => {
    const end = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 12), crustMat);
    end.position.set(x, 0.55, 0.02);
    g.add(end);
  });

  const pep = new THREE.CylinderGeometry(0.14, 0.14, 0.035, 24);
  pep.rotateX(Math.PI / 2);
  const pepMat = gloss(0xB8402A, 0.45, { clearcoat: 0.4 });
  [[-0.2, 0.3], [0.22, 0.36], [0.02, -0.08], [0.0, 0.62], [-0.04, -0.46]].forEach(([x, y], i) => {
    const m = new THREE.Mesh(pep, pepMat);
    m.position.set(x, y, 0.11);
    m.scale.setScalar(i === 4 ? 0.7 : 1);
    g.add(m);
  });
  const basil = mat(C.leaf, 0.55);
  [[0.24, 0.05, 0.6], [-0.22, 0.6, -0.4], [0.08, 0.34, 1.6]].forEach(([x, y, a]) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), basil);
    m.position.set(x, y, 0.11);
    m.rotation.z = a;
    m.scale.set(0.05, 0.1, 0.015);
    g.add(m);
  });
  return g;
}

function soda() {
  const g = new THREE.Group();
  g.position.y = -0.2;
  const cup = tint(new THREE.CylinderGeometry(0.52, 0.38, 1.3, 120, 1, true), (c, x, y, z) => {
    c.set(Math.sin(Math.atan2(z, x) * 5) > 0.2 ? C.teal : C.cream);
  });
  g.add(new THREE.Mesh(cup, mat(0xffffff, 0.45, { vertexColors: true })));
  const floor = new THREE.Mesh(new THREE.CircleGeometry(0.38, 40), mat(C.cream, 0.6));
  floor.rotation.x = Math.PI / 2;
  floor.position.y = -0.65;
  g.add(floor);

  const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.57, 0.57, 0.08, 48), gloss(C.flame, 0.35));
  lid.position.y = 0.68;
  g.add(lid);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.5, 40, 12, 0, TAU, 0, Math.PI / 2), gloss(C.cream, 0.25));
  dome.scale.y = 0.34;
  dome.position.y = 0.71;
  g.add(dome);

  const straw = tint(new THREE.CylinderGeometry(0.055, 0.055, 1, 16, 30), (c, x, y, z) => {
    c.set(Math.sin(y * 30 + Math.atan2(z, x)) > 0 ? C.flame : C.cream);
  });
  const s = new THREE.Mesh(straw, mat(0xffffff, 0.4, { vertexColors: true }));
  s.position.set(0.12, 1.12, 0);
  s.rotation.z = -0.28;
  g.add(s);
  return g;
}

/* The logo hat: sombrero brim, clay crown, a ring of pom-poms. */
function sombrero() {
  const g = new THREE.Group();
  g.position.y = -0.22;
  const top = [];
  for (let i = 0; i <= 28; i++) {
    const r = 0.05 + (i / 28) * 1.0;
    const k = Math.max(0, (r - 0.45) / 0.6);
    top.push(new THREE.Vector2(r, 0.34 * Math.pow(k, 2.4)));
  }
  /* underside outward first, then the top back in: outward-facing normals */
  const pts = top.map((p) => new THREE.Vector2(p.x, p.y - 0.05));
  for (let i = top.length - 1; i >= 0; i--) pts.push(top[i]);
  g.add(new THREE.Mesh(new THREE.LatheGeometry(pts, 72), mat(C.flame, 0.6, { side: THREE.DoubleSide })));

  const crownPts = [new THREE.Vector2(0, 0), new THREE.Vector2(0.44, 0)];
  for (let i = 0; i <= 18; i++) {
    const a = (i / 18) * Math.PI / 2;
    crownPts.push(new THREE.Vector2(0.44 * Math.pow(Math.cos(a), 0.6), 0.66 * Math.pow(Math.sin(a), 0.9)));
  }
  g.add(new THREE.Mesh(new THREE.LatheGeometry(crownPts, 56), mat(C.clay, 0.75)));

  const band = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.07, 10, 48), mat(C.cheese, 0.5));
  band.rotation.x = Math.PI / 2;
  band.position.y = 0.09;
  band.scale.z = 0.8;
  g.add(band);

  const pom = new THREE.SphereGeometry(0.075, 14, 10);
  const poms = [mat(C.teal, 0.7), mat(C.cheese, 0.7)];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU;
    const m = new THREE.Mesh(pom, poms[i % 2]);
    m.position.set(Math.cos(a) * 1.06, 0.26, Math.sin(a) * 1.06);
    g.add(m);
  }
  return g;
}

function beachBall() {
  const g = new THREE.Group();
  /* one mesh per panel, so the colour edges stay crisp */
  [C.flame, C.cream, C.teal, C.cream, C.cheese, C.cream].forEach((col, i) => {
    g.add(new THREE.Mesh(new THREE.SphereGeometry(0.92, 12, 36, i * TAU / 6, TAU / 6), gloss(col)));
  });
  const capMat = gloss(C.cream);
  g.add(new THREE.Mesh(new THREE.SphereGeometry(0.925, 36, 3, 0, TAU, 0, 0.27), capMat));
  g.add(new THREE.Mesh(new THREE.SphereGeometry(0.925, 36, 3, 0, TAU, Math.PI - 0.27, 0.27), capMat));
  return g;
}

/* For the board games: a rounded die with its pips pressed in. */
function die() {
  const g = new THREE.Group();
  const S = 1.3, R = 0.2, half = S / 2, h = half - R;
  const geo = new THREE.BoxGeometry(S, S, S, 14, 14, 14);
  const pos = geo.attributes.position, nor = geo.attributes.normal;
  const v = new THREE.Vector3(), inner = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    inner.set(clamp(v.x, -h, h), clamp(v.y, -h, h), clamp(v.z, -h, h));
    v.sub(inner).normalize();
    nor.setXYZ(i, v.x, v.y, v.z);
    pos.setXYZ(i, inner.x + v.x * R, inner.y + v.y * R, inner.z + v.z * R);
  }
  g.add(new THREE.Mesh(geo, gloss(C.cream, 0.3, { clearcoat: 0.8 })));

  const LAYOUT = {
    1: [[0, 0]],
    2: [[-1, -1], [1, 1]],
    3: [[-1, -1], [0, 0], [1, 1]],
    4: [[-1, -1], [1, -1], [-1, 1], [1, 1]],
    5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]],
    6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]]
  };
  const faces = [[[0, 1, 0], 1], [[0, -1, 0], 6], [[1, 0, 0], 2], [[-1, 0, 0], 5], [[0, 0, 1], 3], [[0, 0, -1], 4]];
  const pip = new THREE.SphereGeometry(1, 16, 10);
  const ink = mat(C.tealInk, 0.4), red = mat(C.flame, 0.4);
  const n = new THREE.Vector3(), t1 = new THREE.Vector3(), t2 = new THREE.Vector3(), p = new THREE.Vector3();
  faces.forEach(([dir, k]) => {
    n.fromArray(dir);
    t1.set(Math.abs(n.y) < 0.9 ? 0 : 1, Math.abs(n.y) < 0.9 ? 1 : 0, 0).cross(n).normalize();
    t2.crossVectors(n, t1);
    LAYOUT[k].forEach(([a, b]) => {
      const m = new THREE.Mesh(pip, k === 1 ? red : ink);
      p.copy(n).multiplyScalar(half - 0.012).addScaledVector(t1, a * 0.32).addScaledVector(t2, b * 0.32);
      m.position.copy(p);
      m.lookAt(p.add(n));
      const s = k === 1 ? 0.15 : 0.1;
      m.scale.set(s, s, 0.035);
      g.add(m);
    });
  });
  return g;
}

/* For the court out back. */
function basketball() {
  const g = new THREE.Group();
  const R = 0.92;
  g.add(new THREE.Mesh(new THREE.SphereGeometry(R, 48, 32), mat(0xE0773A, 0.72)));
  const seam = mat(0x2A1610, 0.6);
  const great = new THREE.TorusGeometry(R, 0.022, 8, 120);
  const a = new THREE.Mesh(great, seam);
  a.rotation.y = Math.PI / 2;
  const b = new THREE.Mesh(great, seam);
  b.rotation.x = Math.PI / 2;
  g.add(a, b);
  const off = 0.64, small = new THREE.TorusGeometry(R * Math.sqrt(1 - off * off), 0.022, 8, 96);
  [-1, 1].forEach((s) => {
    const m = new THREE.Mesh(small, seam);
    m.position.z = s * R * off;
    g.add(m);
  });
  return g;
}

/* From the fruit fridge the stand started with. */
function strawberry() {
  const g = new THREE.Group();
  const at = (t) => {
    const u = Math.pow(t, 1.5);
    return { r: 0.74 * Math.pow(Math.sin(u * Math.PI), 0.85), y: -0.95 + t * 1.55 };
  };
  const prof = [];
  for (let i = 0; i <= 32; i++) { const p = at(i / 32); prof.push(new THREE.Vector2(p.r, p.y)); }
  g.add(new THREE.Mesh(new THREE.LatheGeometry(prof, 64), gloss(0xD9302A, 0.3, { clearcoat: 0.7 })));

  const COUNT = 54, r = rng(17);
  const seeds = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 6), mat(0xF8E0A2, 0.5), COUNT);
  const d = new THREE.Object3D(), v = new THREE.Vector3();
  for (let i = 0; i < COUNT; i++) {
    const p = at(0.08 + r() * 0.8), th = r() * TAU;
    v.set(Math.cos(th) * p.r, p.y, Math.sin(th) * p.r);
    d.position.copy(v);
    d.lookAt(v.x * 2, v.y + 0.3, v.z * 2);
    d.scale.set(0.032, 0.05, 0.022);
    d.updateMatrix();
    seeds.setMatrixAt(i, d.matrix);
  }
  g.add(seeds);

  const leafMat = mat(0x4E8F4A, 0.6);
  for (let i = 0; i < 6; i++) {
    const pivot = new THREE.Group();
    pivot.rotation.y = (i / 6) * TAU;
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), leafMat);
    leaf.position.set(0, 0.6, 0.24);
    leaf.rotation.x = 0.45;
    leaf.scale.set(0.12, 0.03, 0.3);
    pivot.add(leaf);
    g.add(pivot);
  }
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.28, 8), mat(0x5C7F3A, 0.7));
  stem.position.set(0.02, 0.73, 0);
  stem.rotation.z = -0.2;
  g.add(stem);
  return g;
}

function watermelon() {
  const g = new THREE.Group();
  const CY = -0.85, A0 = Math.PI / 2 - 0.66, A1 = Math.PI / 2 + 0.66;
  const extrude = (shape, depth) => {
    const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 40 });
    geo.translate(0, 0, -depth / 2);
    return geo;
  };
  const flesh = new THREE.Shape();
  flesh.moveTo(0, CY);
  flesh.absarc(0, CY, 1.4, A0, A1, false);
  flesh.lineTo(0, CY);
  const ring = (r0, r1) => {
    const s = new THREE.Shape();
    s.absarc(0, CY, r1, A0, A1, false);
    s.absarc(0, CY, r0, A1, A0, true);
    s.closePath();
    return s;
  };
  g.add(new THREE.Mesh(extrude(flesh, 0.3), gloss(0xEE4F4A, 0.4, { clearcoat: 0.4 })));
  g.add(new THREE.Mesh(extrude(ring(1.4, 1.48), 0.28), mat(0xF2EFD6, 0.6)));
  g.add(new THREE.Mesh(extrude(ring(1.48, 1.57), 0.26), mat(0x3E7A45, 0.5)));

  const seed = new THREE.SphereGeometry(1, 10, 8), seedMat = gloss(0x2A1A12, 0.3);
  const r = rng(29);
  [1, -1].forEach((side) => {
    for (let i = 0; i < 9; i++) {
      const rad = 0.45 + r() * 0.72, ang = A0 + 0.14 + r() * (A1 - A0 - 0.28);
      const m = new THREE.Mesh(seed, seedMat);
      m.position.set(Math.cos(ang) * rad, CY + Math.sin(ang) * rad, side * 0.152);
      m.rotation.z = ang - Math.PI / 2;
      m.scale.set(0.035, 0.065, 0.02);
      g.add(m);
    }
  });
  return g;
}

/* For the sea. */
function lifebuoy() {
  const g = new THREE.Group();
  const seg = TAU / 8;
  for (let i = 0; i < 8; i++) {
    const m = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.27, 20, 16, seg), gloss(i % 2 ? C.cream : C.flame, 0.35));
    m.rotation.z = i * seg;
    g.add(m);
  }
  g.add(new THREE.Mesh(new THREE.TorusGeometry(0.975, 0.028, 8, 140), mat(C.sand, 0.85)));
  return g;
}

function iceCream() {
  const g = new THREE.Group();
  g.position.y = -0.1;
  g.scale.setScalar(0.82);
  const waffle = canvasTexture(128, (ctx, S) => {
    ctx.fillStyle = '#E6A862';
    ctx.fillRect(0, 0, S, S);
    ctx.strokeStyle = '#B5733A';
    ctx.lineWidth = 5;
    for (let i = -S; i < S * 2; i += 32) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + S, S); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(i, S); ctx.lineTo(i + S, 0); ctx.stroke();
    }
  });
  waffle.wrapS = waffle.wrapT = THREE.RepeatWrapping;
  waffle.repeat.set(3, 2);
  const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.04, 1.2, 40, 1), mat(0xffffff, 0.8, { map: waffle }));
  cone.position.y = -0.5;
  g.add(cone);

  const pink = gloss(0xF29BA2, 0.45, { clearcoat: 0.3 });
  const scoop = new THREE.Mesh(new THREE.SphereGeometry(0.5, 32, 24), pink);
  scoop.position.y = 0.3;
  scoop.scale.y = 0.9;
  g.add(scoop);
  /* the lumpy lip where the scoop sits in the cone */
  const lipGeo = new THREE.TorusGeometry(0.44, 0.1, 10, 48);
  lipGeo.rotateX(Math.PI / 2);
  const lp = lipGeo.attributes.position;
  for (let i = 0; i < lp.count; i++) {
    const th = Math.atan2(lp.getZ(i), lp.getX(i));
    lp.setY(i, lp.getY(i) - Math.max(0, Math.sin(th * 5 + 0.4)) * 0.08);
  }
  lipGeo.computeVertexNormals();
  const lip = new THREE.Mesh(lipGeo, pink);
  lip.position.y = 0.08;
  g.add(lip);

  const top = new THREE.Mesh(new THREE.SphereGeometry(0.4, 32, 24), gloss(0xFFF1D6, 0.5, { clearcoat: 0.25 }));
  top.position.y = 0.8;
  g.add(top);

  const COUNT = 26, r = rng(31);
  const bits = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.018, 0.07, 3, 6), mat(0xffffff, 0.4), COUNT);
  const d = new THREE.Object3D(), tone = new THREE.Color();
  for (let i = 0; i < COUNT; i++) {
    const th = r() * TAU, ph = r() * 1.1;
    d.position.set(Math.cos(th) * Math.sin(ph) * 0.4, 0.8 + Math.cos(ph) * 0.4, Math.sin(th) * Math.sin(ph) * 0.4);
    d.rotation.set(r() * TAU, r() * TAU, r() * TAU);
    d.updateMatrix();
    bits.setMatrixAt(i, d.matrix);
    bits.setColorAt(i, tone.set(CONFETTI[i % 3 === 0 ? 0 : i % 3 === 1 ? 1 : 2]));
  }
  g.add(bits);

  const cherry = new THREE.Mesh(new THREE.SphereGeometry(0.13, 20, 14), gloss(0xD62A1E, 0.2, { clearcoat: 1 }));
  cherry.position.y = 1.24;
  g.add(cherry);
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.018, 0.26, 6), mat(C.clay, 0.7));
  stem.position.set(0.04, 1.42, 0);
  stem.rotation.z = -0.3;
  g.add(stem);
  return g;
}

/* `spin`: turns all the way round at rest. The flat ones sway instead and
   only go all the way round when they are flicked. `pose` is how the model
   sits inside its spin, so it shows its best side; `fit` shrinks the wide ones
   so they fill their anchor about as much as the rest. */
const KINDS = {
  fries:      { make: fries,      spin: true,  pose: [0.18, 0, 0] },
  pizza:      { make: pizza,      spin: false, pose: [-0.2, 0, 0.35] },
  soda:       { make: soda,       spin: true,  pose: [0.15, 0, 0] },
  sombrero:   { make: sombrero,   spin: true,  pose: [0.42, 0, -0.12], fit: 0.8 },
  beachball:  { make: beachBall,  spin: true,  pose: [0.45, 0, 0.3] },
  die:        { make: die,        spin: true,  pose: [0.55, 0.4, 0.25] },
  basketball: { make: basketball, spin: true,  pose: [0.3, 0, 0.45] },
  strawberry: { make: strawberry, spin: true,  pose: [0, 0, -0.3] },
  watermelon: { make: watermelon, spin: false, pose: [-0.1, 0, -0.18] },
  lifebuoy:   { make: lifebuoy,   spin: false, pose: [-0.25, 0, 0] },
  icecream:   { make: iceCream,   spin: true,  pose: [0.1, 0, 0.18] }
};

/* -------------------------------------------------------------------------
   Lighting: the same warm studio the burger is shot in
   ------------------------------------------------------------------------- */
function studio(renderer) {
  const env = new THREE.Scene();
  const zenith = new THREE.Color(1.25, 1.18, 1.05), horizon = new THREE.Color(0.95, 0.88, 0.76), floor = new THREE.Color(0.34, 0.33, 0.29);
  const dome = tint(new THREE.SphereGeometry(20, 32, 16), (c, x, y) => {
    const h = y / 20;
    c.copy(horizon).lerp(h > 0 ? zenith : floor, Math.abs(h));
  });
  env.add(new THREE.Mesh(dome, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  [[9, 12, 9, 13, 9, 6.0], [-12, 4, 6, 8, 10, 2.2]].forEach(([x, y, z, w, h, power]) => {
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

function shadowTexture() {
  return canvasTexture(128, (ctx, S) => {
    const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0, 'rgba(27,57,55,.55)');
    g.addColorStop(0.5, 'rgba(27,57,55,.22)');
    g.addColorStop(1, 'rgba(27,57,55,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
  });
}

/* -------------------------------------------------------------------------
   Confetti, for when a prop is clicked
   ------------------------------------------------------------------------- */
const BITS = 96;
const bits = {
  mesh: null, next: 0, active: false,
  pos: new Float32Array(BITS * 2), vel: new Float32Array(BITS * 2),
  life: new Float32Array(BITS), size: new Float32Array(BITS)
};
const bitDummy = new THREE.Object3D();
const bitTone = new THREE.Color();

function buildBits() {
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.55, 0.14), mat(0xffffff, 0.5), BITS);
  bitDummy.scale.setScalar(0);
  bitDummy.updateMatrix();
  for (let i = 0; i < BITS; i++) {
    mesh.setMatrixAt(i, bitDummy.matrix);
    mesh.setColorAt(i, bitTone.set(CONFETTI[i % CONFETTI.length]));
  }
  mesh.frustumCulled = false;
  bits.mesh = mesh;
  return mesh;
}

function burst(x, y, count) {
  for (let k = 0; k < count; k++) {
    const id = bits.next;
    bits.next = (id + 1) % BITS;
    const a = Math.random() * TAU, speed = 260 + Math.random() * 420;
    bits.pos[id * 2] = x;
    bits.pos[id * 2 + 1] = y;
    bits.vel[id * 2] = Math.cos(a) * speed;
    bits.vel[id * 2 + 1] = Math.sin(a) * speed * 0.8 + 420;
    bits.life[id] = 0.8 + Math.random() * 0.5;
    bits.size[id] = 7 + Math.random() * 7;
  }
  bits.active = true;
}

/* `lift` is how far the page scrolled this frame: the confetti belongs to
   the page, so it rides along with it. */
function stepBits(dt, lift) {
  if (!bits.active) return;
  let alive = false;
  for (let i = 0; i < BITS; i++) {
    let s = 0;
    if (bits.life[i] > 0) {
      bits.life[i] -= dt;
      bits.vel[i * 2 + 1] -= 1500 * dt;
      bits.vel[i * 2] *= Math.exp(-1.2 * dt);
      bits.pos[i * 2] += bits.vel[i * 2] * dt;
      bits.pos[i * 2 + 1] += bits.vel[i * 2 + 1] * dt + lift;
      s = bits.size[i] * clamp(bits.life[i] / 0.3, 0, 1);
      alive = true;
    }
    bitDummy.position.set(bits.pos[i * 2], bits.pos[i * 2 + 1], 40);
    bitDummy.rotation.set(bits.life[i] * 7 + i, bits.life[i] * 9, i);
    bitDummy.scale.setScalar(s);
    bitDummy.updateMatrix();
    bits.mesh.setMatrixAt(i, bitDummy.matrix);
  }
  bits.mesh.instanceMatrix.needsUpdate = true;
  bits.active = alive;
}

function stepSpring(s, stiffness, damping, dt) {
  const n = Math.max(1, Math.ceil(dt / 0.008)), h = dt / n;
  for (let i = 0; i < n; i++) {
    s.v += (-stiffness * s.x - damping * s.v) * h;
    s.x += s.v * h;
  }
}

/* -------------------------------------------------------------------------
   Boot
   ------------------------------------------------------------------------- */
let renderer, scene, camera;
const props = [];
let W = 1, H = 1;
const FOV = 26;

function init() {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  /* Neutral keeps the brand colours saturated where ACES would mute them */
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;
  host.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  scene.environment = studio(renderer);
  scene.environmentIntensity = 0.55;
  camera = new THREE.PerspectiveCamera(FOV, 1, 1, 10000);

  scene.add(new THREE.HemisphereLight(0xFFFBF3, C.tan, 0.9));
  const key = new THREE.DirectionalLight(0xFFF4E2, 2.2);
  key.position.set(0.5, 0.9, 0.7);
  const fill = new THREE.DirectionalLight(0xCFE7E2, 0.55);
  fill.position.set(-0.8, 0.2, 0.6);
  const rim = new THREE.DirectionalLight(C.flame, 0.9);
  rim.position.set(-0.6, -0.3, -0.7);
  scene.add(key, fill, rim);

  const shadowGeo = new THREE.PlaneGeometry(1, 1);
  const shadowMap = shadowTexture();

  anchors.forEach((el, i) => {
    const kind = KINDS[el.dataset.prop];
    if (!kind) return;
    const model = kind.make();
    model.rotation.set(kind.pose[0], kind.pose[1], kind.pose[2]);
    const spin = new THREE.Group();
    spin.add(model);
    const lean = new THREE.Group();
    lean.add(spin);
    const holder = new THREE.Group();
    holder.add(lean);
    holder.visible = false;
    scene.add(holder);

    const shadow = new THREE.Mesh(shadowGeo, new THREE.MeshBasicMaterial({ map: shadowMap, transparent: true, depthWrite: false, opacity: 0 }));
    shadow.visible = false;
    scene.add(shadow);

    const dir = el.dataset.side === 'right' ? -1 : 1;
    props.push({
      el, kind, holder, lean, spin, shadow, dir,
      seed: i * 1.37 + 0.5,
      depth: parseFloat(el.dataset.depth) || 0,
      x: 0, y: 0, size: 0, sx: -1e4, sy: -1e4, r: 0,
      appear: reduced ? 1 : 0, seen: false, wait: 0,
      hover: 0, over: false, lookX: 0, lookY: 0,
      ang: i * 0.9, angV: 0, squash: { x: 0, v: 0 }
    });
  });

  scene.add(buildBits());

  if ('ResizeObserver' in window) {
    new ResizeObserver(onResize).observe(host);
    /* the page grows as fonts and photos land, which moves the anchors */
    let queued = false;
    new ResizeObserver(() => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => { queued = false; measure(); });
    }).observe(document.body);
  } else {
    window.addEventListener('resize', onResize, { passive: true });
  }
  window.addEventListener('load', onResize, { once: true });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(measure);
  onResize();

  window.addEventListener('pointermove', (e) => {
    if (e.pointerType && e.pointerType !== 'mouse') return;
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    pointer.on = true;
  }, { passive: true });
  document.documentElement.addEventListener('mouseleave', () => { pointer.on = false; });
  window.addEventListener('blur', () => { pointer.on = false; });
  /* the canvas never takes the click, so look for a prop under it ourselves */
  window.addEventListener('click', (e) => {
    if (!e.detail) return; // keyboard activation has no position
    const p = hitTest(e.clientX, e.clientY);
    if (p) pop(p);
  }, { passive: true });

  renderer.compile(scene, camera);
  host.classList.add('is-ready');
  renderer.setAnimationLoop(frame);
}

function measure() {
  const sx = window.scrollX, sy = window.scrollY;
  props.forEach((p) => {
    const r = p.el.getBoundingClientRect();
    p.size = r.width;
    p.x = r.left + r.width / 2 + sx;
    p.y = r.top + r.height / 2 + sy;
  });
}

function onResize() {
  if (!renderer) return;
  W = host.clientWidth || window.innerWidth;
  H = host.clientHeight || window.innerHeight;
  /* put the camera where one world unit is one CSS pixel on the z = 0 plane */
  const dist = (H / 2) / Math.tan((FOV / 2) * Math.PI / 180);
  camera.aspect = W / H;
  camera.position.set(0, 0, dist);
  camera.near = dist * 0.2;
  camera.far = dist * 3;
  camera.updateProjectionMatrix();
  renderer.setSize(W, H, false);
  measure();
}

/* -------------------------------------------------------------------------
   Pointer
   ------------------------------------------------------------------------- */
const pointer = { x: -1e4, y: -1e4, on: false };

function hitTest(x, y) {
  let best = null, bestD = Infinity;
  for (const p of props) {
    if (!p.holder.visible) continue;
    const d = Math.hypot(x - p.sx, y - p.sy);
    if (d < p.r * 0.75 && d < bestD) { best = p; bestD = d; }
  }
  return best;
}

function pop(p) {
  p.squash.v += 4.2;
  p.angV += (reduced ? 7 : 15) * p.dir;
  if (!reduced) burst(p.holder.position.x, p.holder.position.y, 22);
}

/* -------------------------------------------------------------------------
   Frame
   ------------------------------------------------------------------------- */
const clock = new THREE.Clock();
let time = 0, lastScroll = window.scrollY, scrollV = 0, drew = false;

function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  time += dt;
  const sy = window.scrollY, sx = window.scrollX;
  const moved = sy - lastScroll;
  lastScroll = sy;
  scrollV = damp(scrollV, dt > 0 ? moved / dt : 0, 6, dt);
  const motion = reduced ? 0 : 1;
  /* how hard the page is being scrolled, as a lean and a push on the spin */
  const lean = clamp(scrollV * 0.0005, -0.45, 0.45) * motion;
  const push = clamp(scrollV * 0.004, -6, 6) * motion;

  let any = false;
  for (const p of props) {
    const r = p.size / 2;
    p.r = r;
    let cx = p.x - sx, cy = p.y - sy;
    /* a little parallax: props with depth drift against the page as it moves */
    cy += (cy - H / 2) * p.depth * motion;
    const onScreen = r > 0 && cy > -r * 1.6 && cy < H + r * 1.6 && cx > -r * 1.6 && cx < W + r * 1.6;
    p.holder.visible = p.shadow.visible = onScreen;
    if (!onScreen) { p.over = false; p.hover = 0; p.sx = p.sy = -1e4; continue; }
    any = true;

    /* the entrance: pops up with a twirl the first time it comes into view */
    if (!p.seen && cy < H - r * 0.4 && cy > r * 0.4) {
      p.seen = true;
      p.wait = 0.1;
      p.angV += 9 * p.dir * motion;
    }
    if (p.seen && p.appear < 1) {
      if (p.wait > 0) p.wait -= dt;
      else p.appear = Math.min(1, p.appear + dt / 0.7);
    }

    /* hover: perk up, squash, and kick into a quick turn */
    const dx = pointer.x - cx, dy = pointer.y - cy;
    const dist = Math.hypot(dx, dy);
    const over = pointer.on && p.appear > 0.5 && dist < r * 0.75;
    if (over && !p.over) {
      p.squash.v += 2.6;
      p.angV += 5 * p.dir;
    }
    p.over = over;
    p.hover = damp(p.hover, over ? 1 : 0, 9, dt);

    /* turn to look at the cursor while it is close */
    const near = pointer.on ? clamp(1 - dist / (r * 3.2), 0, 1) : 0;
    p.lookY = damp(p.lookY, clamp(dx / r, -1.5, 1.5) * 0.5 * near, 6, dt);
    p.lookX = damp(p.lookX, clamp(dy / r, -1.5, 1.5) * 0.4 * near, 6, dt);
    p.lean.rotation.set(
      p.lookX + lean,
      p.lookY,
      Math.sin(time * 0.8 + p.seed) * 0.09 * motion + lean * 0.4 * p.dir
    );

    if (p.kind.spin) {
      p.angV = damp(p.angV, (0.45 + push) * p.dir * motion, 1.4, dt);
    } else {
      /* settle back to face the front, by whichever full turn is closest */
      const home = Math.round(p.ang / TAU) * TAU;
      p.angV += (-14 * (p.ang - home) - 3.2 * p.angV) * dt;
    }
    p.ang += p.angV * dt;
    p.spin.rotation.y = p.ang + (p.kind.spin ? 0 : Math.sin(time * 0.7 + p.seed) * 0.5 * motion);

    stepSpring(p.squash, 190, 11, dt);
    const sq = clamp(p.squash.x, -0.35, 0.35);
    const grow = easeOutBack(p.appear) * (1 + 0.14 * p.hover);
    const s = r * 0.9 * (p.kind.fit || 1) * grow;
    if (s < 0.01) { p.holder.visible = p.shadow.visible = false; continue; }
    p.holder.scale.set(s * (1 - sq * 0.5), s * (1 + sq), s * (1 - sq * 0.5));

    /* float: a slow bob, and drift a touch toward the cursor when it is on it */
    const bob = Math.sin(time * 1.1 + p.seed * 2) * r * 0.08 * motion;
    const px = cx + dx * 0.08 * p.hover;
    const py = cy + bob + dy * 0.08 * p.hover - r * 0.12 * p.hover;
    p.holder.position.set(px - W / 2, H / 2 - py, 0);
    p.sx = px; p.sy = py;

    /* the shadow stays on the page and tightens as the prop dips toward it */
    const high = (bob / r + 0.12 * p.hover) * 2.5;
    p.shadow.position.set(cx - W / 2, H / 2 - (cy + r * 0.98), -r * 0.8);
    p.shadow.scale.set(r * 1.25 * (1 + high * 0.2), r * 0.28 * (1 + high * 0.2), 1);
    p.shadow.material.opacity = 0.3 * Math.min(1, p.appear) * (1 - high * 0.25);
  }

  stepBits(dt, moved);

  if (any || bits.active) {
    renderer.render(scene, camera);
    drew = true;
  } else if (drew) {
    renderer.clear();
    drew = false;
  }
}

/* -------------------------------------------------------------------------
   Start, or step aside quietly
   ------------------------------------------------------------------------- */
if (host && anchors.length) {
  try {
    const probe = document.createElement('canvas');
    if (!(window.WebGLRenderingContext && (probe.getContext('webgl2') || probe.getContext('webgl')))) throw new Error('no webgl');
    init();
  } catch (err) {
    host.style.display = 'none';
    console.warn('Chapouu props disabled:', err && err.message);
  }
}
