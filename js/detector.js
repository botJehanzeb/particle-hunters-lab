// Simplified ATLAS detector, drawn by this page (lengths in mm).
// Copied from the two-view test page (Phoenix 4.2.3 / three.js 0.184.0 reference).
import * as THREE from 'three';

export const COLORS = {
  id: 0x2b3238, idLine: 0x75818c, em: 0x7fbf7a, had: 0xc8655d, mu: 0x4f80c4,
  track: 0xdfe5ea, hit: 0xff5a5a,
  depositEM: 0xffd84d, depositHad: 0xffc23d, jet: 0x3f7fd0, met: 0xff6b6b,
};

// Barrel muon chambers: 16 flat sectors, alternating large (centred on multiples of 45°) and small.
// Bands (ρ, mm) and half-lengths (|z|, mm) measured from the MDT and RPC hits of all 50 events in
// dataset 8, group A, with about 5 cm margin. Each band covers the MDT chamber and its RPCs.
export const MUON_STATIONS = {
  large: [{ r: [4700, 5650], z: 6600 }, { r: [6750, 7700], z: 9700 }, { r: [9200, 10200], z: 12350 }],
  small: [{ r: [4400, 4700], z: 7300 }, { r: [7780, 8550], z: 9400 }, { r: [10150, 11000], z: 12900 }],
};
// BIR chambers: an extra inner band, only in the two large sectors at 225° and 315° (the detector's feet).
const BIR = { r: [5900, 6400], z: 7300, phiDeg: [225, 315] };

const ring = (rIn, rOut, color, segs = 1, gapDeg = 0) => {
  const g = new THREE.Group();
  const step = (Math.PI * 2) / segs;
  const gap = THREE.MathUtils.degToRad(gapDeg);
  for (let i = 0; i < segs; i++) {
    const geo = new THREE.RingGeometry(rIn, rOut, segs > 1 ? 8 : 128, 1, i * step + gap / 2, step - gap);
    g.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, depthWrite: false })));
  }
  return g;
};

const circle = (r, color) => {
  const pts = [];
  for (let i = 0; i <= 128; i++) {
    const a = (i / 128) * Math.PI * 2;
    pts.push(new THREE.Vector3(r * Math.cos(a), r * Math.sin(a), 0));
  }
  return new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color, depthWrite: false }));
};

// A rectangle in the ρ–z plane (side view), above and below the beam; mirrored to −z when z0 > 0.
function block(scene, z0, z1, rIn, rOut, color, mirrorZ = true) {
  const mat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, depthWrite: false });
  const zs = mirrorZ && z0 > 0 ? [[z0, z1], [-z1, -z0]] : [[z0, z1]];
  for (const [a, b] of zs) {
    for (const s of [1, -1]) {
      if (rIn === 0 && s === -1) continue;
      const h = rIn === 0 ? 2 * rOut : rOut - rIn;
      const yc = rIn === 0 ? 0 : s * (rIn + rOut) / 2;
      const geo = new THREE.PlaneGeometry(b - a, h);
      geo.rotateY(-Math.PI / 2);
      const m = new THREE.Mesh(geo, mat);
      m.position.set(0, yc, (a + b) / 2);
      scene.add(m);
    }
  }
}

function sectorPlate(g, mat, phi, rIn, rOut, halfAngleDeg) {
  const rMid = (rIn + rOut) / 2;
  const width = 2 * rMid * Math.tan(THREE.MathUtils.degToRad(halfAngleDeg));
  const m = new THREE.Mesh(new THREE.PlaneGeometry(width, rOut - rIn), mat);
  m.position.set(rMid * Math.cos(phi), rMid * Math.sin(phi), 0);
  m.rotation.z = phi - Math.PI / 2;
  g.add(m);
}

function muonSectors() {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: COLORS.mu, side: THREE.DoubleSide, depthWrite: false });
  for (let k = 0; k < 16; k++) {
    const large = k % 2 === 0;
    const phi = (k * Math.PI) / 8;
    for (const st of MUON_STATIONS[large ? 'large' : 'small']) sectorPlate(g, mat, phi, st.r[0], st.r[1], large ? 12.5 : 9);
  }
  for (const deg of BIR.phiDeg) sectorPlate(g, mat, THREE.MathUtils.degToRad(deg), BIR.r[0], BIR.r[1], 12.5);
  return g;
}

// End view: looking down the beam (x–y plane). Barrel only.
export function buildEndDetector() {
  const s = new THREE.Scene();
  s.add(ring(0, 1150, COLORS.id));
  for (const r of [122, 514, 1066]) s.add(circle(r, COLORS.idLine));
  s.add(ring(1500, 1970, COLORS.em));
  s.add(ring(2280, 4250, COLORS.had, 64, 0.6));
  s.add(muonSectors());
  return s;
}

// Side view: ρ (up) against z (across), barrel and end-caps.
export function buildSideDetector() {
  const s = new THREE.Scene();
  block(s, -3500, 3500, 0, 1150, COLORS.id, false);
  block(s, -3200, 3200, 1500, 1970, COLORS.em, false);
  block(s, 3600, 4250, 300, 2000, COLORS.em);
  block(s, -2820, 2820, 2280, 4250, COLORS.had, false);
  block(s, 3100, 6100, 2280, 4250, COLORS.had);
  block(s, 4300, 6100, 470, 2030, COLORS.had);
  // In a ρ–z view every sector lands in the same picture, so all barrel bands show.
  for (const st of [...MUON_STATIONS.large, ...MUON_STATIONS.small, BIR]) block(s, -st.z, st.z, st.r[0], st.r[1], COLORS.mu, false);
  // End-cap chambers (|z| and ρ ranges measured the same way), mirrored to −z.
  block(s, 8750, 11700, 4340, 4480, COLORS.mu);   // BEE (barrel end-cap extra)
  block(s, 6900, 7900, 900, 6400, COLORS.mu);     // inner wheel: EI MDT, CSC, inner TGC
  block(s, 10100, 11500, 5850, 9000, COLORS.mu);  // EE
  block(s, 13200, 15350, 1750, 11950, COLORS.mu); // big wheel: EM MDT + TGC 1–3
  block(s, 21250, 22050, 2750, 12350, COLORS.mu); // outer wheel: EO
  s.add(new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, -23000), new THREE.Vector3(0, 0, 23000)]),
    new THREE.LineBasicMaterial({ color: COLORS.idLine, depthWrite: false })));
  return s;
}

// End-cap muon hits are left out of the end view, as in HYPATIA. JiveXML identifiers name the
// chamber station ("7/BIL/-6/1/MDT/..."): B = barrel, E = end-cap. BEE sits at |z| 9–12 m, so it counts as end-cap.
export function muonHitIsEndcap(h, name) {
  if (['TGC', 'CSC', 'CSCD', 'MM', 'STGC'].includes(name)) return true;
  const station = String((h && h.identifier) || '').split('/')[1] || '';
  if (station) return station[0] !== 'B' || station === 'BEE';
  const p = h && Array.isArray(h.pos) ? h.pos.flat() : null;  // no identifier: fall back to position
  if (!p || p.length < 6) return false;
  return Math.abs((p[2] + p[5]) / 2) > 12900;
}

// End view: a barrel drift tube (MDT) or RPC strip runs across its chamber, and the hit says only how far
// from the beam it is, not where along the tube. Phoenix draws a tube-length line centred on the hit,
// which pokes out of the chamber; instead draw it across the chamber's sector at the hit's distance.
export function barrelSegmentInSector(h) {
  const p = h && Array.isArray(h.pos) ? h.pos.flat() : null;
  if (!p || p.length < 6) return null;
  const x = (p[0] + p[3]) / 2, y = (p[1] + p[4]) / 2, z = (p[2] + p[5]) / 2;
  // Large and small chambers overlap in φ, so take the chamber type from the station name
  // (BIL, BIM, BIR, BML, BOL = large; BIS, BMS, BMF, BOS, BOF, BOG = small), then the nearest sector of that type.
  const station = String(h.identifier || '').split('/')[1] || '';
  const sector8 = Math.atan2(y, x) / (Math.PI / 4);   // in units of 45°
  let k;
  if (/^B(IL|IM|IR|ML|OL)$/.test(station)) k = 2 * Math.round(sector8);
  else if (/^B(IS|MS|MF|OS|OF|OG)$/.test(station)) k = 2 * Math.floor(sector8) + 1;
  else k = Math.round(sector8 * 2);
  k = ((k % 16) + 16) % 16;
  const c = (k * Math.PI) / 8, cos = Math.cos(c), sin = Math.sin(c);
  const u = x * cos + y * sin;                                    // distance from the beam, across the plate
  const large = k % 2 === 0;
  const bands = [...MUON_STATIONS[large ? 'large' : 'small']];
  if (BIR.phiDeg.includes(k * 22.5)) bands.push(BIR);
  const band = bands.find((b) => u >= b.r[0] && u <= b.r[1]);
  const rRef = band ? (band.r[0] + band.r[1]) / 2 : u;            // plates are drawn with their mid-radius width
  const w = rRef * Math.tan(THREE.MathUtils.degToRad(large ? 12.5 : 9)); // half the plate's width
  return [u * cos + w * sin, u * sin - w * cos, z, u * cos - w * sin, u * sin + w * cos, z];
}
