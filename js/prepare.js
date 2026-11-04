// Turns Phoenix's JiveXML event data into what the two views draw.
// Deposit placement, jets and missing energy follow the two-view test page.
import { COLORS, muonHitIsEndcap, barrelSegmentInSector } from './detector.js?v=e3';

export const etaToTheta = (eta) => 2 * Math.atan(Math.exp(-eta));
const MET_LENGTH = 10500; // mm: missing energy is drawn as a direction, out to the muon chambers
const CELL_MIN_GEV = 0.5;  // same threshold as slimming (C2); below it cells are mostly noise

// Place a calorimeter deposit in its layer: barrel deposits at a transverse radius, end-cap deposits at a z.
// The bar grows outward with energy (GeV) as a fraction of its layer's depth (detector.js): 40% at 0.5 GeV,
// half at 1 GeV, the full depth from 7 GeV. 150 mm wide, so it is ~3 px at ×1 (it was 60 mm and invisible).
const LAYER_DEPTH = { em: 440, emEC: 600, tile: 1920, hec: 1750 }; // mm, inside the drawn layer
const DEPOSIT_WIDTH = 150;
function placeDeposit(c, layer) {
  const eta = c.eta, energyGeV = Math.max(0, c.energy || 0);
  const theta = etaToTheta(eta);
  const depth = LAYER_DEPTH[layer === 'em' && Math.abs(eta) >= 1.475 ? 'emEC' : layer];
  const length = depth * Math.min(1, 0.25 + 0.25 * Math.log2(1 + energyGeV));
  const out = { ...c, length, side: DEPOSIT_WIDTH };
  delete out.theta;
  if (layer === 'em' && Math.abs(eta) < 1.475) out.radius = (1520 + length / 2) / Math.sin(theta);
  else if (layer === 'em') out.z = Math.sign(eta) * (3640 + length / 2);
  else if (layer === 'tile') out.radius = (2300 + length / 2) / Math.sin(theta);
  else out.z = Math.sign(eta) * (4320 + length / 2); // hadronic end-cap
  out.color = layer === 'em' ? COLORS.depositEM : COLORS.depositHad;
  out.etGeV = energyGeV * Math.sin(theta);
  out.endcap = out.z !== undefined;
  return out;
}

const pick = (groups, preferred) =>
  (groups && (groups[preferred] || Object.values(groups).find((l) => Array.isArray(l) && l.length))) || [];

// D3: charge comes from the raw XML. JiveXML stores pt with a sign (charge × pT); Phoenix's own q/p sign does not
// match it (≈ half the tracks disagree), while the XML sign matched all 46 checked lepton charges. Phoenix keeps the
// XML track order but renames collections (Tracks → Tracks_), so collections are paired by count and |pt|.
// D6: the same XML gives each long track's hit ids (<numHits> per track, then one flat <hits> list). These match the
// muon hits' <id>: on-track hits sit a median 3 cm from their track in ρ–z, random hits 8.4 m.
const nums = (el, tag) => {
  const e = el.querySelector(tag);
  return e ? e.textContent.trim().split(/\s+/).filter(Boolean).map(Number) : [];
};
function xmlTracks(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
  return [...doc.querySelectorAll('Track')].map((el) => ({ pts: nums(el, 'pt'), numHits: nums(el, 'numHits'), hits: nums(el, 'hits') }));
}
function matchXml(list, xml) {
  return xml.find((x) => x.pts.length === list.length &&
    list.every((t, i) => Math.abs(Math.abs(x.pts[i]) * 1000 - t.pT) < 1)) || null; // XML pt in GeV, Phoenix pT in MeV
}
function hitIdsPerTrack(x) {
  if (!x || x.numHits.length !== x.pts.length) return null;
  let a = 0;
  return x.numHits.map((n) => x.hits.slice(a, (a += n)));
}

// Table row for one track. Energies in GeV, angles in degrees (φ 0–360, as in the header bar).
const DEG = 180 / Math.PI;
const trackRow = (t, q) => {
  const pT = t.pT / 1000;
  return {
    pickId: t.pickId,
    p: pT * Math.cosh(t.eta),
    pT,
    eta: t.eta,
    phi: ((t.phi * DEG) % 360 + 360) % 360,
    theta: etaToTheta(t.eta) * DEG, // Phoenix's dparams θ is folded to ±90°, so θ comes from η
    q,                              // 0 = unknown (shown as "?")
  };
};

// D6: the starting cuts. Track cut on pT, deposit cut on ET (both GeV); muon hits 'track' (on muon tracks) or 'all'.
export const DEFAULT_CUTS = { minPT: 1, minET: 0, hits: 'track' };

// Returns { phoenix, side, meta, rows }:
//   phoenix — event for Phoenix to draw in the end view (barrel objects only, as in HYPATIA)
//   side    — the same objects, all of them, for this page's ρ–z side view
//   rows    — the object table (D3), highest pT first; needs the raw XML text for charges and hit ids
// Called again with new cuts on the same raw event, so nothing here may change `raw` (Phoenix edits the
// objects it is given, e.g. it extends track points; each call therefore gets fresh copies).
export function prepareEvent(raw, xmlText, cuts = DEFAULT_CUTS) {
  const meta = { eventNumber: raw.eventNumber, runNumber: raw.runNumber, met: null, metPhi: null, nTracks: 0 };
  const xml = xmlText ? xmlTracks(xmlText) : [];

  // Tracks: pickId and charge come from the full list, so they stay the same whatever the cut.
  // rzSign = the half (above / below the beam line) the side view draws the track in, fixed here from its own points.
  const tracks = {}, rows = [], onTrackSign = new Map(); // muon hit id -> its track's rzSign
  for (const [name, list] of Object.entries(raw.Tracks || {})) {
    const x = matchXml(list, xml), hitIds = hitIdsPerTrack(x);
    const kept = [];
    list.forEach((t, i) => {
      meta.nTracks++;
      if (t.pT / 1000 < cuts.minPT) return;
      const pos = Array.isArray(t.pos) ? t.pos.map((p) => p.slice()) : t.pos;
      const last = Array.isArray(pos) && pos.length ? pos[pos.length - 1] : null;
      const rzSign = last && last[1] < 0 ? -1 : 1;
      const tr = { ...t, pos, color: COLORS.track, linewidth: 2, pickId: `${name}:${i}`, rzSign };
      kept.push(tr);
      rows.push(trackRow(tr, x ? Math.sign(x.pts[i]) : 0));
      if (hitIds) for (const id of hitIds[i]) onTrackSign.set(id, rzSign);
    });
    if (kept.length) tracks[name] = kept;
  }
  rows.sort((a, b) => b.pT - a.pT);

  // Muon hits: on-track ones by default. They are drawn in their track's half of the side view; a drift tube's
  // centre can sit just across y = 0 from a near-horizontal track and would otherwise be mirrored to the other half.
  const hitsAll = {}, hitsBarrel = {};
  for (const [name, list] of Object.entries(raw.Hits || {})) {
    let ok = list.filter((h) => h && typeof h === 'object' && !Array.isArray(h));
    if (cuts.hits === 'track') ok = ok.filter((h) => onTrackSign.has(h.id)).map((h) => ({ ...h, rzSign: onTrackSign.get(h.id) }));
    if (ok.length) hitsAll[name] = ok;
    const barrel = ok.filter((h) => !muonHitIsEndcap(h, name));
    if (barrel.length) hitsBarrel[name] = barrel.map((h) => ({ ...h, pos: barrelSegmentInSector(h) || h.pos, color: COLORS.hit }));
  }

  const cellsAll = {}, cellsBarrel = {};
  for (const [name, list] of Object.entries(raw.CaloCells || {})) {
    const layer = name === 'LAr' ? 'em' : name === 'Tile' ? 'tile' : 'hec';
    const placed = list.filter((c) => (c.energy || 0) >= CELL_MIN_GEV).map((c) => placeDeposit(c, layer))
      .filter((c) => c.etGeV >= cuts.minET);
    if (placed.length) cellsAll[name] = placed;
    const barrel = placed.filter((c) => !c.endcap);
    if (barrel.length) cellsBarrel[name] = barrel;
  }

  // One jet collection (the standard 2012 one) and one missing-energy collection, so nothing is drawn twice.
  // Jets get a fixed length here; their energy is not shown in Stage 1.
  const jets = pick(raw.Jets, 'AntiKt4LCTopoJets').map((j) => ({ ...j, energy: 20000, color: COLORS.jet }));
  const metRaw = pick(raw.MissingEnergy, 'MET_RefFinal')[0];
  let met = [];
  if (metRaw) {
    const n = Math.hypot(metRaw.etx, metRaw.ety) || 1;
    meta.met = n;                       // GeV (JiveXML)
    meta.metPhi = Math.atan2(metRaw.ety, metRaw.etx);
    met = [{ etx: (metRaw.etx / n) * MET_LENGTH, ety: (metRaw.ety / n) * MET_LENGTH, color: COLORS.met }];
  }

  // Particle labels (Muons, Electrons, Photons) are never passed on: students must not see the answer.
  const base = { eventNumber: raw.eventNumber, runNumber: raw.runNumber, Tracks: tracks, Jets: { Jets: jets }, MissingEnergy: { MET: met } };
  return {
    phoenix: { ...base, Hits: hitsBarrel, CaloCells: cellsBarrel },
    side: { ...base, Hits: hitsAll, CaloCells: cellsAll },
    meta,
    rows,
  };
}
