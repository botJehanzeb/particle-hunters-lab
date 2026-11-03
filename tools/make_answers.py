#!/usr/bin/env python3
"""Draft answer labels for every event the tool shows (step C5).

Usage:  python3 -I tools/make_answers.py RAW_DIR SITE_DIR OUT_JSON
  RAW_DIR   folder holding the raw masterclass groups (groupA/ ... groupT/)
  SITE_DIR  the tool's repo (reads events/*/index.json to know which events are shown)
  OUT_JSON  where to write the answers. Keep it OUT of the published site: anything in the
            GitHub Pages repo can be downloaded by students (golden rule).

Labels are drafts from ATLAS's own reconstruction (lepton objects and missing energy in the raw files);
'checked' stays false until a person has looked at the event and agreed.
  Z→ee / Z→μμ candidate — two same-flavour, opposite-charge leptons with pT > 20 GeV
  W→eν / W→μν candidate — one lepton with pT > 25 GeV and missing energy > 25 GeV
  4-lepton candidate    — four or more leptons with pT > 7 GeV
  no clear lepton       — none of the above
"""
import json
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


def leptons(root, min_pt):
    out = []
    for el in root:
        if (el.tag, el.get('storeGateKey')) not in (('Muon', 'Muons'), ('Electron', 'ElectronAODCollection')):
            continue
        pt, eta, phi, pdg = nums(el, 'pt'), nums(el, 'eta'), nums(el, 'phi'), nums(el, 'pdgId')
        quality = (el.find('isEMString').text or '').split() if el.find('isEMString') is not None else []
        for i in range(len(pt)):
            if el.tag == 'Electron' and quality[i] not in GOOD_ELECTRON:
                continue  # 'none'/'Loose' entries are mostly jets and photons (E/p far above 1)
            if pt[i] > min_pt and abs(eta[i]) < 2.5:
                out.append({'type': 'muon' if el.tag == 'Muon' else 'electron',
                            'charge': -int(math.copysign(1, pdg[i])),
                            'pT_GeV': round(pt[i], 1), 'eta': round(eta[i], 2), 'phi': round(phi[i], 2)})
    return sorted(out, key=lambda l: -l['pT_GeV'])


def mass(a, b, m=0.0):
    def p4(l):
        pt, eta, phi = l['pT_GeV'], l['eta'], l['phi']
        px, py, pz = pt * math.cos(phi), pt * math.sin(phi), pt * math.sinh(eta)
        return math.sqrt(px * px + py * py + pz * pz + m * m), px, py, pz
    e1, x1, y1, z1 = p4(a)
    e2, x2, y2, z2 = p4(b)
    return round(math.sqrt(max(0.0, (e1 + e2) ** 2 - (x1 + x2) ** 2 - (y1 + y2) ** 2 - (z1 + z2) ** 2)), 1)


def label(raw_path):
    root = ET.parse(raw_path).getroot()
    met = next((e for e in root if e.tag == 'ETMis' and e.get('storeGateKey') == 'MET_RefFinal'), None)
    mx, my = (nums(met, 'etx')[0], nums(met, 'ety')[0]) if met is not None else (0.0, 0.0)
    met_gev = round(math.hypot(mx, my), 1)
    loose, hard = leptons(root, 7), leptons(root, 20)
    out = {'leptons': hard, 'missing_energy_GeV': met_gev}
    if len(loose) >= 4:
        out['label'] = '4-lepton candidate'
        out['leptons'] = loose
    elif len(hard) == 2 and hard[0]['type'] == hard[1]['type'] and hard[0]['charge'] != hard[1]['charge']:
        out['label'] = 'Z→ee candidate' if hard[0]['type'] == 'electron' else 'Z→μμ candidate'
        out['mass_GeV'] = mass(hard[0], hard[1])
    elif len(hard) == 1 and hard[0]['pT_GeV'] > 25 and met_gev > 25:
        out['label'] = 'W→eν candidate' if hard[0]['type'] == 'electron' else 'W→μν candidate'
    else:
        out['label'] = 'no clear lepton'
    out['checked'] = False
    return out


def main():
    raw_dir, site, out_path = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
    answers = {'about': 'Draft labels from ATLAS reconstruction (tools/make_answers.py). NOT for the public site.',
               'sets': {}}
    for index in sorted(site.glob('events/*/index.json')):
        rows = {}
        for e in json.loads(index.read_text())['events']:
            group, name = e['file'].split('-', 1)
            rows[e['file']] = label(raw_dir / f'group{group}' / name)
        answers['sets'][index.parent.name] = rows
    out_path.write_text(json.dumps(answers, indent=1, ensure_ascii=False) + '\n', encoding='utf-8')
    for s, rows in answers['sets'].items():
        counts = {}
        for r in rows.values():
            counts[r['label']] = counts.get(r['label'], 0) + 1
        print(s, len(rows), 'events:', counts)


if __name__ == '__main__':
    main()
