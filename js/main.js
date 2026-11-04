// Particle Hunters Lab — main script.
// B1: load three.js, make it the global THREE, then load and start Phoenix.
// Phoenix's bundle expects THREE as a global, so the order matters.
import * as THREE from 'three';
import { COLORS, buildEndDetector, buildSideDetector } from './detector.js?v=e2c';
import { prepareEvent, etaToTheta, DEFAULT_CUTS } from './prepare.js?v=e2c';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';

const PHOENIX_URL = 'https://cdn.jsdelivr.net/npm/phoenix-event-display@4.2.3/dist/bundle/phoenix.min.js';

// ---------- status line ----------
const statusEl = document.getElementById('status');
function status(msg, kind = 'ok') {
  const li = document.createElement('li');
  if (kind !== 'ok') li.className = kind;
  li.textContent = msg;
  statusEl.appendChild(li);
}

// ---------- three.js ----------
window.THREE = THREE;
status(`three.js r${THREE.REVISION} loaded`);

// ---------- Phoenix ----------
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Could not load ${src}`));
    document.head.appendChild(s);
  });
}

if (!window.EventDisplay) await loadScript(PHOENIX_URL);
if (!window.EventDisplay || !window.PhoenixLoader) {
  throw new Error('Phoenix loaded but EventDisplay / PhoenixLoader are missing');
}

// Phoenix needs an element to start in. This page draws the views itself (Phase D),
// so Phoenix gets a tiny hidden host and is used to read events and build objects.
const host = document.createElement('div');
host.id = 'phoenix-host';
host.setAttribute('aria-hidden', 'true');
host.style.cssText = 'position:fixed;left:0;top:0;width:8px;height:8px;overflow:hidden;opacity:0;pointer-events:none;';
document.body.appendChild(host);

const ed = new EventDisplay();
ed.init({
  elementId: 'phoenix-host',
  eventDataLoader: new PhoenixLoader(),
  allowUrlOptions: false,
  enableDatGUIMenu: false,
  forceColourTheme: 'dark',
});
// Stop Phoenix's own render loop; this page will render when needed.
try { ed.getThreeManager().getRendererManager().getMainRenderer().setAnimationLoop(null); } catch (e) { /* keep Phoenix's hidden loop */ }

status('Phoenix 4.2.3 started');

// ---------- C3: events, loaded one at a time when shown ----------
// events/50/index.json lists the browse set in order. Each event file is fetched only when it is shown;
// its neighbours are fetched in the background so Previous / Next feel instant. Fetched files are kept.
// E1: two sets, switched in place: the browse set (events/50/) and the balance set (events/balance/) for question 1.
const SETS = { 50: 'events/50/', balance: 'events/balance/' };
const setIndex = new Map(); // set name -> Promise<events[]>
function loadIndex(name) {
  if (!setIndex.has(name)) {
    setIndex.set(name, fetch(`${SETS[name]}index.json`).then((res) => {
      if (!res.ok) throw new Error(`Could not load ${SETS[name]}index.json (${res.status})`);
      return res.json();
    }).then((j) => j.events));
    setIndex.get(name).catch(() => setIndex.delete(name));
  }
  return setIndex.get(name);
}
let setName = new URLSearchParams(location.search).get('set') === 'balance' ? 'balance' : '50';
let EVENTS = await loadIndex(setName);
status(`${EVENTS.length} events listed; each loads when shown`);

const fetched = new Map(); // folder + file name -> Promise<string>
function fetchText(i) {
  const file = EVENTS[i].file, key = SETS[setName] + file;
  if (!fetched.has(key)) {
    fetched.set(key, fetch(key).then((res) => {
      if (!res.ok) throw new Error(`Could not load ${file} (${res.status})`);
      return res.text();
    }));
    fetched.get(key).catch(() => fetched.delete(key)); // allow a retry after a failed fetch
  }
  return fetched.get(key);
}
function readEvent(text) {
  if (!window.JiveXMLLoader) throw new Error('Phoenix JiveXMLLoader is missing');
  const loader = new JiveXMLLoader();
  loader.process(text);
  return loader.getEventData();
}

// ---------- B3/B4: the event in two views ----------
// End view: our detector, then Phoenix's event scene on top (barrel objects only, as in HYPATIA).
// Side view: our ρ–z detector, then this page's own ρ–z drawing of the same objects.
const phScene = ed.getThreeManager().getSceneManager().getScene();

// ρ–z: everything is drawn at its distance from the beam (ρ) against its position along the beam (z),
// above the beam line if it is in the upper half of the detector (y ≥ 0), below it otherwise.
const half = (y) => (y >= 0 ? 1 : -1);
function caloCenter(c) {
  const th = etaToTheta(c.eta);
  const ux = Math.sin(th) * Math.cos(c.phi), uy = Math.sin(th) * Math.sin(c.phi), uz = Math.cos(th);
  const k = c.radius ? c.radius : c.z / uz;
  return [ux * k, uy * k, uz * k];
}
function buildRZ(e) {
  const layers = {};

  const tracks = new THREE.Group();
  const trackMat = new THREE.LineBasicMaterial({ color: COLORS.track });
  for (const list of Object.values(e.Tracks || {})) {
    for (const t of list) {
      if (!Array.isArray(t.pos) || t.pos.length < 2) continue;   // e.g. MuonboyTrackParticles: no positions
      const s = t.rzSign ?? half(t.pos[t.pos.length - 1][1]);
      const pts = t.pos.map((p) => new THREE.Vector3(0, s * Math.hypot(p[0], p[1]), p[2]));
      tracks.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), trackMat));
    }
  }
  layers.Tracks = tracks;

  const cells = Object.values(e.CaloCells || {}).flat();
  const deposits = new THREE.Group();
  if (cells.length) {
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateY(-Math.PI / 2); // lies in the ρ–z plane: height = ρ direction, width = z direction
    const mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, depthWrite: false }), cells.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), pos = new THREE.Vector3(), col = new THREE.Color();
    cells.forEach((c, i) => {
      const [x, y, z] = caloCenter(c);
      pos.set(0, half(y) * Math.hypot(x, y), z);
      if (c.radius) sc.set(1, c.length, c.side); else sc.set(1, c.side, c.length);
      m.compose(pos, q, sc);
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, col.set(c.color));
    });
    deposits.add(mesh);
  }
  layers.CaloCells = deposits;

  // A drift tube runs around the beam, so in ρ–z it shrinks to a dot.
  const hitPts = [];
  for (const list of Object.values(e.Hits || {})) {
    for (const h of list) {
      const p = Array.isArray(h.pos) ? h.pos.flat() : null;
      if (!p || p.length < 3) continue;
      const two = p.length >= 6;
      const x = two ? (p[0] + p[3]) / 2 : p[0], y = two ? (p[1] + p[4]) / 2 : p[1], z = two ? (p[2] + p[5]) / 2 : p[2];
      hitPts.push(new THREE.Vector3(0, (h.rzSign ?? half(y)) * Math.hypot(x, y), z)); // on-track hits: their track's half
    }
  }
  layers.Hits = new THREE.Points(new THREE.BufferGeometry().setFromPoints(hitPts),
    new THREE.PointsMaterial({ color: COLORS.hit, size: 3, sizeAttenuation: false }));

  const jets = new THREE.Group();
  const jetMat = new THREE.MeshBasicMaterial({ color: COLORS.jet, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false });
  for (const list of Object.values(e.Jets || {})) {
    for (const j of list) {
      const th = j.theta ?? etaToTheta(j.eta);
      const s = Math.sin(j.phi) >= 0 ? 1 : -1, L = 4000, a = 0.2;
      jets.add(new THREE.Mesh(new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, s * L * Math.sin(th - a), L * Math.cos(th - a)),
        new THREE.Vector3(0, s * L * Math.sin(th + a), L * Math.cos(th + a))]), jetMat));
    }
  }
  layers.Jets = jets;

  // Missing energy lies across the beam, so in ρ–z it points straight up or down.
  const met = new THREE.Group();
  const m0 = e.MissingEnergy && e.MissingEnergy.MET && e.MissingEnergy.MET[0];
  if (m0) {
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, half(m0.ety) * 10500, 0)]),
      new THREE.LineDashedMaterial({ color: COLORS.met, dashSize: 250, gapSize: 180 }));
    line.computeLineDistances();
    met.add(line);
  }
  layers.MissingEnergy = met;

  const scene = new THREE.Scene();
  for (const obj of Object.values(layers)) scene.add(obj);
  return { scene, layers };
}
let rz = null; // the current event's side-view drawing
function disposeRZ() {
  if (!rz) return;
  rz.scene.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) o.material.dispose();
  });
  rz = null;
}

// ---------- B4: layer switches (same names as Phoenix's collection groups) ----------
const LAYER_SWITCHES = {
  'show-tracks': 'Tracks',
  'show-deposits': 'CaloCells',
  'show-hits': 'Hits',
  'show-jets': 'Jets',
  'show-met': 'MissingEnergy',
};
function applyVisibility() {
  const eventData = phScene.getObjectByName('EventData');
  for (const [id, group] of Object.entries(LAYER_SWITCHES)) {
    const on = document.getElementById(id).checked;
    if (eventData) for (const child of eventData.children) if (child.name === group) child.visible = on;
    if (rz && rz.layers[group]) rz.layers[group].visible = on;
  }
  requestRender();
}
for (const id of Object.keys(LAYER_SWITCHES)) document.getElementById(id).addEventListener('change', applyVisibility);

function makeView(kind, detScene) {
  const stage = document.getElementById(`stage-${kind}`);
  const canvas = stage.querySelector('canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.autoClear = false;
  renderer.setClearColor(0x000000, 1);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 10, 200000);
  if (kind === 'end') camera.position.set(0, 0, 80000);
  else camera.position.set(-80000, 0, 0);
  camera.up.set(0, 1, 0);
  camera.lookAt(0, 0, 0);
  // D5: zoom (1 = whole detector) and pan centre (cx, cy) in the view's own screen-aligned units (mm).
  const v = { kind, stage, renderer, camera, detScene, w: 1, h: 1, zoom: 1, cx: 0, cy: 0, dragged: false };
  new ResizeObserver(() => { fit(v); requestRender(); }).observe(stage);
  fit(v);
  return v;
}
function fit(v) {
  v.w = Math.max(1, v.stage.clientWidth);
  v.h = Math.max(1, v.stage.clientHeight);
  v.renderer.setSize(v.w, v.h, false);
  const aspect = v.w / v.h;
  const halfH = v.kind === 'end'
    ? (aspect >= 1 ? 11500 : 11500 / aspect)
    : Math.max(12800, 23000 / aspect);
  v.baseH = halfH;
  v.baseW = halfH * aspect;
  applyCamera(v);
}
// Zoom shrinks the visible window; the centre is kept inside the whole-detector window so the view can't wander off.
function applyCamera(v) {
  const hw = v.baseW / v.zoom, hh = v.baseH / v.zoom;
  v.cx = Math.max(-(v.baseW - hw), Math.min(v.baseW - hw, v.cx));
  v.cy = Math.max(-(v.baseH - hh), Math.min(v.baseH - hh, v.cy));
  Object.assign(v.camera, { left: v.cx - hw, right: v.cx + hw, top: v.cy + hh, bottom: v.cy - hh });
  v.camera.updateProjectionMatrix();
}
// D4: the selected track is drawn again, thick and purple, in a scene of its own on top of each view.
const hl = { end: new THREE.Scene(), side: new THREE.Scene() };
function renderView(v) {
  const r = v.renderer;
  r.clear();
  r.render(v.detScene, v.camera);
  if (v.kind === 'side') {
    if (rz) r.render(rz.scene, v.camera);
  } else {
    const bg = phScene.background;
    phScene.background = null;
    r.render(phScene, v.camera);
    phScene.background = bg;
  }
  hl[v.kind].traverse((o) => { if (o.material && o.material.resolution) o.material.resolution.set(v.w, v.h); });
  r.render(hl[v.kind], v.camera);
}
const views = { end: makeView('end', buildEndDetector()), side: makeView('side', buildSideDetector()) };
let pending = false;
function requestRender() {
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => { pending = false; renderView(views.end); renderView(views.side); });
}
status('Detector drawn in both views');

// ---------- D3: object table ----------
// One row per track, highest pT first. Each row carries the track's pickId for click linking (D4).
// No particle-type column, and nothing marks long tracks: the table must not give away the answer.
const objRows = document.getElementById('obj-rows');
const objCount = document.getElementById('obj-count');
function showRows(rows, total) {
  const f1 = (x) => x.toFixed(1), f2 = (x) => x.toFixed(2);
  objRows.innerHTML = rows.map((r, k) => `<tr data-pick="${r.pickId}">` +
    `<td class="num">${k + 1}</td><td>${f1(r.p)}</td><td>${f1(r.pT)}</td><td>${f2(r.eta)}</td>` +
    `<td>${Math.round(r.phi)}°</td><td>${Math.round(r.theta)}°</td><td>${r.q > 0 ? '+' : r.q < 0 ? '−' : '?'}</td></tr>`).join('');
  objCount.textContent = `${rows.length} of ${total} shown, highest momentum across the beam first · momentum in GeV`;
  objRows.parentElement.parentElement.scrollTop = 0;
}

// "?" explanations: shown on hover, and on tap / click / keyboard (stays until tapped again or tapped elsewhere).
const tipBox = document.getElementById('tip-box');
let tipPinned = null;
function placeTip(btn) {
  tipBox.textContent = btn.dataset.tip;
  tipBox.hidden = false;
  const b = btn.getBoundingClientRect(), w = Math.min(280, window.innerWidth - 32);
  tipBox.style.width = `${w}px`;
  tipBox.style.left = `${Math.max(16, Math.min(b.left + b.width / 2 - w / 2, window.innerWidth - w - 16))}px`;
  const h = tipBox.offsetHeight;
  tipBox.style.top = `${b.top - h - 8 >= 8 ? b.top - h - 8 : b.bottom + 8}px`;
}
function hideTip() { tipBox.hidden = true; tipPinned = null; }
for (const btn of document.querySelectorAll('.tip')) {
  btn.textContent = '?';
  btn.addEventListener('mouseenter', () => { if (!tipPinned) placeTip(btn); });
  btn.addEventListener('mouseleave', () => { if (!tipPinned) tipBox.hidden = true; });
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (tipPinned === btn) { hideTip(); return; }
    tipPinned = btn;
    placeTip(btn);
  });
}
document.addEventListener('click', () => { if (tipPinned) hideTip(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideTip(); });
window.addEventListener('scroll', hideTip, { passive: true });
document.querySelector('.table-wrap').addEventListener('scroll', hideTip, { passive: true });

// ---------- D4: click linking ----------
// Clicks are handled here, not by Phoenix (its highlight shows in one view only and its click detection assumes a
// full-page display). The page finds the track nearest the pointer in either view, in screen pixels, and draws a
// thick purple copy of it in both views; the matching table row is highlighted too. A row click does the same.
const PICK_PX = 8;            // a click within this many pixels of a track picks it
const HL_COLOR = 0xb36bff;    // purple: not used by any detector part or object
let trackPts = new Map();     // pickId -> { end: Vector3[], side: Vector3[] } in each view's drawing coordinates
let selected = null;

function indexTracks(side) {
  trackPts = new Map();
  for (const list of Object.values(side.Tracks || {})) {
    for (const t of list) {
      if (!Array.isArray(t.pos) || t.pos.length < 2) continue;
      const s = t.rzSign ?? half(t.pos[t.pos.length - 1][1]); // same upper/lower choice as the side-view drawing
      trackPts.set(t.pickId, {
        end: t.pos.map((p) => new THREE.Vector3(p[0], p[1], 0)),
        side: t.pos.map((p) => new THREE.Vector3(0, s * Math.hypot(p[0], p[1]), p[2])),
      });
    }
  }
}

function toPixels(v, pts) {
  return pts.map((p) => {
    const n = p.clone().project(v.camera);
    return [((n.x + 1) / 2) * v.w, ((1 - n.y) / 2) * v.h];
  });
}
function segDist(px, py, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy;
  const u = L ? Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / L)) : 0;
  return Math.hypot(px - (a[0] + u * dx), py - (a[1] + u * dy));
}
function nearestTrack(v, px, py) {
  if (!document.getElementById('show-tracks').checked) return null;
  let best = null, bestD = PICK_PX;
  for (const [id, pts] of trackPts) {
    const s = toPixels(v, pts[v.kind]);
    for (let k = 1; k < s.length; k++) {
      const d = segDist(px, py, s[k - 1], s[k]);
      if (d < bestD) { bestD = d; best = id; }
    }
  }
  return best;
}

function thickLine(pts) {
  const geo = new LineGeometry();
  geo.setPositions(pts.flatMap((p) => [p.x, p.y, p.z]));
  const line = new Line2(geo, new LineMaterial({ color: HL_COLOR, linewidth: 4, depthTest: false }));
  line.computeLineDistances();
  line.renderOrder = 10;
  return line;
}
function clearHighlight() {
  for (const scene of Object.values(hl)) {
    for (const o of [...scene.children]) { scene.remove(o); o.geometry.dispose(); o.material.dispose(); }
  }
  for (const tr of objRows.querySelectorAll('tr.selected')) tr.classList.remove('selected');
}
function select(id, fromRow = false) {
  clearHighlight();
  selected = id && trackPts.has(id) ? id : null;
  if (selected) {
    const pts = trackPts.get(selected);
    hl.end.add(thickLine(pts.end));
    hl.side.add(thickLine(pts.side));
    const tr = objRows.querySelector(`tr[data-pick="${CSS.escape(selected)}"]`);
    if (tr) {
      tr.classList.add('selected');
      if (!fromRow) tr.scrollIntoView({ block: 'nearest' });
    }
  }
  syncHighlight();
}
// The highlight follows the Tracks switch: hidden tracks can't be selected or shown.
function syncHighlight() {
  const on = document.getElementById('show-tracks').checked;
  hl.end.visible = hl.side.visible = on;
  requestRender();
}
document.getElementById('show-tracks').addEventListener('change', syncHighlight);

for (const v of Object.values(views)) {
  const canvas = v.renderer.domElement;
  canvas.addEventListener('click', (e) => { if (!v.dragged) select(nearestTrack(v, e.offsetX, e.offsetY)); });
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse' || v.drag) return;
    canvas.style.cursor = nearestTrack(v, e.offsetX, e.offsetY) ? 'pointer' : v.zoom > 1 ? 'grab' : '';
  });
}
objRows.addEventListener('click', (e) => {
  const tr = e.target.closest('tr[data-pick]');
  if (tr) select(tr.dataset.pick === selected ? null : tr.dataset.pick, true);
});

// ---------- D5: zoom slider and drag, one per view ----------
// The slider is logarithmic (0–100 → ×1 to ×30) so each step feels the same. Dragging pans once zoomed in;
// a drag of more than 4 px is not a click, so it never selects a track. At ×1 a touch swipe scrolls the page.
const ZOOM_MAX = 30;
for (const v of Object.values(views)) {
  const slider = document.getElementById(`zoom-${v.kind}`);
  const readout = document.getElementById(`zoom-${v.kind}-val`);
  const canvas = v.renderer.domElement;
  const setZoom = (z) => {
    v.zoom = z;
    if (z <= 1) { v.cx = 0; v.cy = 0; }
    applyCamera(v);
    readout.textContent = `×${z.toFixed(1)}`;
    canvas.style.touchAction = z > 1 ? 'none' : '';
    requestRender();
  };
  slider.addEventListener('input', () => setZoom(Math.pow(ZOOM_MAX, slider.value / 100)));
  document.getElementById(`reset-${v.kind}`).addEventListener('click', () => { slider.value = 0; setZoom(1); });

  canvas.addEventListener('pointerdown', (e) => {
    if (v.zoom <= 1 || e.button !== 0) return;
    v.drag = { x: e.clientX, y: e.clientY, cx: v.cx, cy: v.cy, moved: false };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!v.drag) return;
    const dx = e.clientX - v.drag.x, dy = e.clientY - v.drag.y;
    if (!v.drag.moved && Math.hypot(dx, dy) < 4) return;
    v.drag.moved = true;
    canvas.style.cursor = 'grabbing';
    const perPx = (2 * v.baseW) / v.zoom / v.w; // mm per screen pixel
    v.cx = v.drag.cx - dx * perPx;
    v.cy = v.drag.cy + dy * perPx;
    applyCamera(v);
    requestRender();
  });
  const endDrag = () => {
    if (!v.drag) return;
    v.dragged = v.drag.moved;          // the click that follows this pointerup is ignored after a real drag
    v.drag = null;
    canvas.style.cursor = v.zoom > 1 ? 'grab' : '';
    setTimeout(() => { v.dragged = false; }, 0);
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
}

// ---------- D6: cuts and switches ----------
// Changing a cut prepares the same event again and redraws both views and the table, so all three always agree.
// A selected track stays selected if it passes the new cut.
const PT_STEPS = [0, 0.5, 1, 2, 3, 5, 10, 20];  // GeV
const ET_STEPS = [0, 0.2, 0.5, 1, 2, 5];        // GeV
const cuts = { ...DEFAULT_CUTS };
let shown = null; // { raw, text, file } of the event on screen

function drawEvent(keepId) {
  if (!shown) return;
  const prepared = prepareEvent(shown.raw, shown.text, cuts);
  showMet(prepared.meta);
  showRows(prepared.rows, prepared.meta.nTracks);
  ed.parsePhoenixEvents({ [shown.file]: prepared.phoenix });
  try { ed.getThreeManager().getRendererManager().getMainRenderer().setAnimationLoop(null); } catch (e) { /* keep Phoenix's hidden loop */ }
  disposeRZ();
  rz = buildRZ(prepared.side);
  indexTracks(prepared.side);
  applyVisibility();
  select(keepId);
  window.lab.prepared = prepared;
}

let redrawTimer = 0;
const redrawSoon = () => { clearTimeout(redrawTimer); redrawTimer = setTimeout(() => drawEvent(selected), 120); };
function cutSlider(id, steps, key) {
  const input = document.getElementById(id), out = document.getElementById(`${id}-val`);
  input.max = steps.length - 1;
  input.value = Math.max(0, steps.indexOf(cuts[key]));
  const show = () => { out.textContent = cuts[key] > 0 ? `${cuts[key]} GeV` : 'show all'; };
  show();
  input.addEventListener('input', () => { cuts[key] = steps[Number(input.value)]; show(); redrawSoon(); });
}
cutSlider('cut-pt', PT_STEPS, 'minPT');
cutSlider('cut-et', ET_STEPS, 'minET');
for (const r of document.querySelectorAll('input[name="hits-mode"]')) {
  r.checked = r.value === cuts.hits;
  r.addEventListener('change', () => { if (r.checked) { cuts.hits = r.value; drawEvent(selected); } });
}

// ---------- showing an event ----------
let current = -1, request = 0;
const prevBtn = document.getElementById('prev');
const nextBtn = document.getElementById('next');
const counter = document.getElementById('counter');
const loadNote = document.getElementById('load-note');
const badge = document.getElementById('badge');
// D2: event header bar.
const eb = Object.fromEntries(['index', 'run', 'event', 'date', 'met', 'arrow', 'dir'].map((k) => [k, document.getElementById(`eb-${k}`)]));
const ebMet = eb.met.parentElement;
function showMet(meta) {
  const known = meta && meta.met != null;
  ebMet.classList.toggle('none', !known);
  if (!known) { eb.met.textContent = meta ? 'none recorded' : '…'; eb.dir.textContent = ''; return; }
  // φ is counted anticlockwise from +x; in the end view +x is to the right and +y is up.
  const deg = ((meta.metPhi * 180) / Math.PI + 360) % 360;
  eb.met.textContent = `${meta.met.toFixed(1)} GeV`;
  eb.dir.textContent = `direction ${Math.round(deg)}°`;
  eb.arrow.style.transform = `rotate(${-deg}deg)`;
}
// D1: dropdown of all events (numbers only — nothing that hints at the answer).
const pick = document.getElementById('pick');
function fillPick() {
  pick.length = 0;
  EVENTS.forEach((_, i) => pick.add(new Option(`Event ${i + 1}`, String(i))));
  pick.disabled = false;
}
fillPick();
pick.addEventListener('change', () => showEvent(Number(pick.value)));

async function showEvent(i) {
  const mine = ++request;
  counter.textContent = `Event ${i + 1}/${EVENTS.length}`;
  pick.value = String(i);
  // Data or simulation comes from index.json's flag, never from the run number (see SPEC, Data).
  const info = EVENTS[i];
  badge.textContent = info.data ? 'Real data' : 'Simulation';
  badge.classList.toggle('data', info.data);
  badge.title = info.data ? 'Recorded by the ATLAS detector' : 'Made by a computer simulation of ATLAS';
  eb.index.textContent = `Event ${i + 1} of ${EVENTS.length}`;
  eb.run.textContent = info.run ?? '–';
  eb.event.textContent = info.event ?? '–';
  // Date and time as recorded (seconds dropped); simulated events have none.
  eb.date.textContent = info.data && info.date ? info.date.replace(/^(\S+ \d\d:\d\d):\d\d/, '$1') : 'No recording date';
  showMet(null);
  prevBtn.disabled = i === 0;
  nextBtn.disabled = i === EVENTS.length - 1;
  const t0 = performance.now();
  let text;
  try {
    text = await fetchText(i);
  } catch (err) {
    if (mine === request) loadNote.textContent = `Could not load this event. ${err.message}`;
    return;
  }
  if (mine !== request) return; // the student has already moved on
  shown = { raw: readEvent(text), text, file: SETS[setName] + EVENTS[i].file };
  drawEvent(null);
  current = i;
  loadNote.textContent = `Shown in ${Math.round(performance.now() - t0)} ms`;
  // Fetch the neighbours in the background.
  for (const j of [i + 1, i - 1]) if (j >= 0 && j < EVENTS.length) fetchText(j).catch(() => {});
}
prevBtn.addEventListener('click', () => { if (current > 0) showEvent(current - 1); });
nextBtn.addEventListener('click', () => { if (current < EVENTS.length - 1) showEvent(current + 1); });

// ---------- E1: set switch and question buttons ----------
// Switching set reloads the dropdown and shows the chosen event of the new set; the URL keeps ?set=balance.
const setRadios = [...document.querySelectorAll('input[name="event-set"]')];
const syncSetRadios = () => { for (const r of setRadios) r.checked = r.value === setName; };
async function openSet(name, i = 0) {
  if (name !== setName) {
    let list;
    try {
      list = await loadIndex(name);
    } catch (err) {
      loadNote.textContent = `Could not load this set. ${err.message}`;
      syncSetRadios();
      return;
    }
    setName = name;
    EVENTS = list;
    current = -1;
    fillPick();
    const url = new URL(location.href);
    if (name === 'balance') url.searchParams.set('set', 'balance'); else url.searchParams.delete('set');
    history.replaceState(null, '', url);
  }
  syncSetRadios();
  await showEvent(Math.max(0, Math.min(EVENTS.length - 1, i)));
}
syncSetRadios();
for (const r of setRadios) r.addEventListener('change', () => { if (r.checked) openSet(r.value); });
for (const b of document.querySelectorAll('.questions .go')) {
  b.addEventListener('click', () => {
    openSet(b.dataset.set, Number(b.dataset.event));
    // On a phone the views are above the questions: bring them into sight. On a laptop they already are.
    const d = document.querySelector('.display'), r = d.getBoundingClientRect();
    if (r.top < 0 || r.top > window.innerHeight * 0.5) d.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

// Shared with later steps.
window.lab = { THREE, ed, get EVENTS() { return EVENTS; }, get set() { return setName; }, openSet, fetched, showEvent, views, get rz() { return rz; }, requestRender, applyVisibility, select, get selected() { return selected; }, nearestTrack, toPixels, get trackPts() { return trackPts; } };

await showEvent(0);
setTimeout(requestRender, 500);
