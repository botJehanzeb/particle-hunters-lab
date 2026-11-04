// Particle Hunters Lab — main script.
// B1: load three.js, make it the global THREE, then load and start Phoenix.
// Phoenix's bundle expects THREE as a global, so the order matters.
import * as THREE from 'three';
import { COLORS, buildEndDetector, buildSideDetector } from './detector.js';
import { prepareEvent, etaToTheta } from './prepare.js';

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
const EVENT_DIR = new URLSearchParams(location.search).get('set') === 'balance' ? 'events/balance/' : 'events/50/';
const indexRes = await fetch(`${EVENT_DIR}index.json`);
if (!indexRes.ok) throw new Error(`Could not load ${EVENT_DIR}index.json (${indexRes.status})`);
const EVENTS = (await indexRes.json()).events;
status(`${EVENTS.length} events listed; each loads when shown`);

const fetched = new Map(); // file name -> Promise<string>
function fetchText(i) {
  const file = EVENTS[i].file;
  if (!fetched.has(file)) {
    fetched.set(file, fetch(EVENT_DIR + file).then((res) => {
      if (!res.ok) throw new Error(`Could not load ${file} (${res.status})`);
      return res.text();
    }));
    fetched.get(file).catch(() => fetched.delete(file)); // allow a retry after a failed fetch
  }
  return fetched.get(file);
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
      const s = half(t.pos[t.pos.length - 1][1]);
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
      hitPts.push(new THREE.Vector3(0, half(y) * Math.hypot(x, y), z));
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
  const v = { kind, stage, renderer, camera, detScene, w: 1, h: 1 };
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
  const halfW = halfH * aspect;
  Object.assign(v.camera, { left: -halfW, right: halfW, top: halfH, bottom: -halfH });
  v.camera.updateProjectionMatrix();
}
function renderView(v) {
  const r = v.renderer;
  r.clear();
  r.render(v.detScene, v.camera);
  if (v.kind === 'side') { if (rz) r.render(rz.scene, v.camera); return; }
  const bg = phScene.background;
  phScene.background = null;
  r.render(phScene, v.camera);
  phScene.background = bg;
}
const views = { end: makeView('end', buildEndDetector()), side: makeView('side', buildSideDetector()) };
let pending = false;
function requestRender() {
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => { pending = false; renderView(views.end); renderView(views.side); });
}
status('Detector drawn in both views');

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
EVENTS.forEach((_, i) => pick.add(new Option(`Event ${i + 1}`, String(i))));
pick.disabled = false;
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
  const prepared = prepareEvent(readEvent(text));
  showMet(prepared.meta);
  ed.parsePhoenixEvents({ [EVENTS[i].file]: prepared.phoenix });
  try { ed.getThreeManager().getRendererManager().getMainRenderer().setAnimationLoop(null); } catch (e) { /* keep Phoenix's hidden loop */ }
  disposeRZ();
  rz = buildRZ(prepared.side);
  applyVisibility();
  current = i;
  loadNote.textContent = `Shown in ${Math.round(performance.now() - t0)} ms`;
  window.lab.prepared = prepared;
  // Fetch the neighbours in the background.
  for (const j of [i + 1, i - 1]) if (j >= 0 && j < EVENTS.length) fetchText(j).catch(() => {});
}
prevBtn.addEventListener('click', () => { if (current > 0) showEvent(current - 1); });
nextBtn.addEventListener('click', () => { if (current < EVENTS.length - 1) showEvent(current + 1); });

// Shared with later steps.
window.lab = { THREE, ed, EVENTS, fetched, showEvent, views, get rz() { return rz; }, requestRender, applyVisibility };

await showEvent(0);
setTimeout(requestRender, 500);
