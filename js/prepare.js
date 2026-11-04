// Turns Phoenix's JiveXML event data into what the two views draw.
// Deposit placement, jets and missing energy follow the two-view test page.
import { COLORS, muonHitIsEndcap, barrelSegmentInSector } from './detector.js?v=d5';

export const etaToTheta = (eta) => 2 * Math.atan(Math.exp(-eta));
const MET_LENGTH = 10500; // mm: missing energy is drawn as a direction, out to the muon chambers
const CELL_MIN_GEV = 0.5;  // same threshold as slimming (C2); below it cells are mostly noise

// Place a calorimeter deposit in its layer: barrel deposits at a transverse radius, end-cap deposits at a z.
// The bar grows outward with energy (GeV).
function placeDeposit(c, layer) {
  const eta = c.eta, energyGeV = Math.max(0, c.energy || 0);
  const theta = etaToTheta(eta);
  const length = Math.min(420, 40 + 28 * energyGeV);
  const out = { ...c, length, side: 60 };
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
function xmlTrackPts(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
  return [...doc.querySelectorAll('Track')].map((el) => {
    const ptEl = el.querySelector('pt');
    return ptEl ? ptEl.textContent.trim().split(/\s+/).map(Number) : [];
  });
}
function chargesFor(list, xmlLists) {
  const x = xmlLists.find((pts) => pts.length === list.length &&
    list.every((t, i) => Math.abs(Math.abs(pts[i]) * 1000 - t.pT) < 1)); // XML pt in GeV, Phoenix pT in MeV
  return x ? x.map(Math.sign) : null;
}

// One table row per track, highest pT first. Energies in GeV, angles in degrees (φ 0–360, as in the header bar).
const DEG = 180 / Math.PI;
function trackRows(tracks, xmlLists) {
  const rows = [];
  for (const [name, list] of Object.entries(tracks)) {
    const q = chargesFor(list, xmlLists);
    list.forEach((t, i) => {
      const pT = t.pT / 1000;
      rows.push({
        pickId: t.pickId,
        p: pT * Math.cosh(t.eta),
        pT,
        eta: t.eta,
        phi: ((t.phi * DEG) % 360 + 360) % 360,
        theta: etaToTheta(t.eta) * DEG, // Phoenix's dparams θ is folded to ±90°, so θ comes from η
        q: q ? q[i] : 0,                // 0 = unknown (shown as "?")
      });
    });
  }
  return rows.sort((a, b) => b.pT - a.pT);
}

// Returns { phoenix, side, meta, rows }:
//   phoenix — event for Phoenix to draw in the end view (barrel objects only, as in HYPATIA)
//   side    — the same objects, all of them, for this page's ρ–z side view
//   rows    — the object table (D3); needs the raw XML text for the charges
export function prepareEvent(raw, xmlText) {
  const meta = { eventNumber: raw.eventNumber, runNumber: raw.runNumber, met: null, metPhi: null };

  const tracks = {};
  for (const [name, list] of Object.entries(raw.Tracks || {})) {
    tracks[name] = list.map((t, i) => ({ ...t, color: COLORS.track, linewidth: 2, pickId: `${name}:${i}` }));
  }

  const hitsAll = {}, hitsBarrel = {};
  for (const [name, list] of Object.entries(raw.Hits || {})) {
    const ok = list.filter((h) => h && typeof h === 'object' && !Array.isArray(h));
    hitsAll[name] = ok;
    const barrel = ok.filter((h) => !muonHitIsEndcap(h, name));
    if (barrel.length) hitsBarrel[name] = barrel.map((h) => ({ ...h, pos: barrelSegmentInSector(h) || h.pos, color: COLORS.hit }));
  }

  const cellsAll = {}, cellsBarrel = {};
  for (const [name, list] of Object.entries(raw.CaloCells || {})) {
    const layer = name === 'LAr' ? 'em' : name === 'Tile' ? 'tile' : 'hec';
    const placed = list.filter((c) => (c.energy || 0) >= CELL_MIN_GEV).map((c) => placeDeposit(c, layer));
    cellsAll[name] = placed;
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
    rows: trackRows(tracks, xmlText ? xmlTrackPts(xmlText) : []),
  };
}
