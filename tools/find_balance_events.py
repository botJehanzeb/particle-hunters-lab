#!/usr/bin/env python3
"""Find candidate events for the momentum-balance question (step C4).

Usage:  python3 -I tools/find_balance_events.py RAW_FILE [RAW_FILE ...]

Runs on the RAW masterclass files (offline only): it reads ATLAS's own lepton labels to find candidates.
Those labels never reach the site; tools/slim_jivexml.py strips them from every published event.

Two kinds of real-data event (simulated events, which have no date, are skipped):
  pair  — exactly two leptons (pT > 20 GeV, same flavour, opposite charge), back to back in the end view
          (|Δφ − π| < 0.25) with similar pT (within 15 %) and little missing energy (< 15 GeV), both moving
          the same way along the beam (same sign of η) with |pz1 + pz2| > 1.0 (pT1 + pT2).
          End view balances; side view clearly doesn't.
  met   — exactly one lepton (pT > 25 GeV) and missing energy > 25 GeV pointing the opposite way in the end view
          (|Δφ − π| < 0.5, sizes within 25 %), with the lepton far from 90° (|η| > 0.8). The missing energy balances
          the end view; it has no part along the beam, so the side view can't balance.
"""
import math
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

# Electrons count only if ATLAS's identification (isEMString) is Medium or TightPP. In dataset 8, entries
# marked 'none' have E/p of about 3–14 (fakes); TightPP ones have E/p near 1, as real electrons do.
GOOD_ELECTRON = {'Medium', 'TightPP'}


def nums(el, tag):
    c = el.find(tag)
    return [float(v) for v in (c.text or '').split()] if c is not None else []


def leptons(root):
    out = []
    for el in root:
        key = el.get('storeGateKey')
        if (el.tag, key) not in (('Muon', 'Muons'), ('Electron', 'ElectronAODCollection')):
            continue
        pt, eta, phi, pdg = nums(el, 'pt'), nums(el, 'eta'), nums(el, 'phi'), nums(el, 'pdgId')
        quality = (el.find('isEMString').text or '').split() if el.find('isEMString') is not None else []
        for i in range(len(pt)):
            if el.tag == 'Electron' and quality[i] not in GOOD_ELECTRON:
                continue  # 'none'/'Loose' entries are mostly jets and photons (E/p far above 1)
            lim = 2.5 if el.tag == 'Muon' else 2.47
            if pt[i] > 20 and abs(eta[i]) < lim:
                out.append({'flav': el.tag, 'q': -math.copysign(1, pdg[i]), 'pt': pt[i], 'eta': eta[i], 'phi': phi[i],
                            'pz': pt[i] * math.sinh(eta[i])})
    return out


def dphi(a, b):
    return abs(math.atan2(math.sin(a - b), math.cos(a - b)))


def scan(path):
    root = ET.parse(path).getroot()
    if not root.get('dateTime'):
        return None  # simulated
    met = next((e for e in root if e.tag == 'ETMis' and e.get('storeGateKey') == 'MET_RefFinal'), None)
    mx, my = (nums(met, 'etx')[0], nums(met, 'ety')[0]) if met is not None else (0.0, 0.0)
    met_et, met_phi = math.hypot(mx, my), math.atan2(my, mx)
    inner = next((int(e.get('count')) for e in root if e.tag == 'Track' and e.get('storeGateKey') == 'Tracks'), 0)
    lep = leptons(root)
    base = {'file': f'{path.parent.name}/{path.name}', 'run': root.get('runNumber'), 'event': root.get('eventNumber'),
            'met': round(met_et, 1), 'tracks': inner}
    if len(lep) == 2:
        a, b = lep
        if (a['flav'] == b['flav'] and a['q'] != b['q'] and abs(dphi(a['phi'], b['phi']) - math.pi) < 0.25
                and abs(a['pt'] - b['pt']) / (a['pt'] + b['pt']) < 0.15 and met_et < 15
                and a['eta'] * b['eta'] > 0 and abs(a['pz'] + b['pz']) > 1.0 * (a['pt'] + b['pt'])):
            return dict(base, kind='pair', flav=a['flav'], pt=(round(a['pt']), round(b['pt'])),
                        eta=(round(a['eta'], 2), round(b['eta'], 2)), dphi=round(dphi(a['phi'], b['phi']), 2),
                        score=round(abs(a['pz'] + b['pz']) / (a['pt'] + b['pt']), 2))
    if len(lep) == 1:
        a = lep[0]
        if (a['pt'] > 25 and met_et > 25 and abs(dphi(a['phi'], met_phi) - math.pi) < 0.5
                and abs(a['pt'] - met_et) / (a['pt'] + met_et) < 0.25 and abs(a['eta']) > 0.8):
            return dict(base, kind='met', flav=a['flav'], pt=(round(a['pt']),), eta=(round(a['eta'], 2),),
                        dphi=round(dphi(a['phi'], met_phi), 2), score=round(abs(a['eta']), 2))
    return None


def main():
    hits = [r for r in (scan(Path(p)) for p in sys.argv[1:]) if r]
    for kind in ('pair', 'met'):
        rows = sorted((r for r in hits if r['kind'] == kind), key=lambda r: -r['score'])
        print(f'--- {kind}: {len(rows)} candidates (best first)')
        for r in rows:
            print(r)


if __name__ == '__main__':
    main()
