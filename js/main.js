// Particle Hunters Lab — main script.
// B1: load three.js, make it the global THREE, then load and start Phoenix.
// Phoenix's bundle expects THREE as a global, so the order matters.
import * as THREE from 'three';
import { COLORS, buildEndDetector, buildSideDetector, muonHitIsEndcap, barrelSegmentInSector } from './detector.js';

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

// ---------- B2: read one event with Phoenix's JiveXML loader ----------
// Test event: dataset 8, group A, event001, with particle labels removed and <TILE> renamed <Tile>.
const TEST_EVENT = 'events/test/event001.xml';

const countAll = (groups) =>
  Object.values(groups || {}).reduce((n, list) => n + (Array.isArray(list) ? list.length : 0), 0);

async function readEvent(url) {
  if (!window.JiveXMLLoader) throw new Error('Phoenix JiveXMLLoader is missing');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load ${url} (${res.status})`);
  const loader = new JiveXMLLoader();
  loader.process(await res.text());
  return loader.getEventData();
}

const ev = await readEvent(TEST_EVENT);
const nTracks = countAll(ev.Tracks);
const nDeposits = countAll(ev.CaloCells) + countAll(ev.CaloClusters);
const nHits = countAll(ev.Hits);
status(`Event ${ev.eventNumber} (run ${ev.runNumber}): ${nTracks} tracks, ${nDeposits} energy deposits, ${nHits} muon-chamber hits`);

// ---------- B3: detector drawing in two views ----------
// End view: our detector, then Phoenix's event scene on top (tracks and barrel muon hits).
// Side view: our ρ–z detector, then every muon hit as a dot at (ρ, z). Deposits and switches come in B4.
const phScene = ed.getThreeManager().getSceneManager().getScene();

function eventForPhoenix(raw) {
  const out = {
    eventNumber: raw.eventNumber, runNumber: raw.runNumber,
    Tracks: {}, Hits: {},
  };
  for (const [name, list] of Object.entries(raw.Tracks || {})) {
    out.Tracks[name] = list.map((t) => ({ ...t, color: COLORS.track, linewidth: 2 }));
  }
  for (const [name, list] of Object.entries(raw.Hits || {})) {
    const barrel = list.filter((h) => h && typeof h === 'object' && !Array.isArray(h) && !muonHitIsEndcap(h, name));
    if (barrel.length) out.Hits[name] = barrel.map((h) => ({ ...h, pos: barrelSegmentInSector(h) || h.pos, color: COLORS.hit }));
  }
  return out;
}
ed.parsePhoenixEvents({ test: eventForPhoenix(ev) });

// Side-view hits: a drift tube runs around the beam, so in ρ–z it shrinks to a dot. Upper half above the beam line.
const rzScene = new THREE.Scene();
{
  const pts = [];
  for (const list of Object.values(ev.Hits || {})) {
    for (const h of list) {
      const p = h && Array.isArray(h.pos) ? h.pos.flat() : null;
      if (!p || p.length < 3) continue;
      const two = p.length >= 6;
      const x = two ? (p[0] + p[3]) / 2 : p[0], y = two ? (p[1] + p[4]) / 2 : p[1], z = two ? (p[2] + p[5]) / 2 : p[2];
      pts.push(new THREE.Vector3(0, (y >= 0 ? 1 : -1) * Math.hypot(x, y), z));
    }
  }
  rzScene.add(new THREE.Points(new THREE.BufferGeometry().setFromPoints(pts),
    new THREE.PointsMaterial({ color: COLORS.hit, size: 3, sizeAttenuation: false })));
}

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
  if (v.kind === 'side') { r.render(rzScene, v.camera); return; }
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
requestRender();
setTimeout(requestRender, 500);
status('Detector drawn in both views');

// Shared with later steps.
window.lab = { THREE, ed, readEvent, ev, views, requestRender };
