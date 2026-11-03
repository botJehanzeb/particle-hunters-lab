// Particle Hunters Lab — main script.
// B1: load three.js, make it the global THREE, then load and start Phoenix.
// Phoenix's bundle expects THREE as a global, so the order matters.
import * as THREE from 'three';

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

// Shared with later steps.
window.lab = { THREE, ed };
