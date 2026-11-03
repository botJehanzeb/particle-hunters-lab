#!/usr/bin/env python3
"""Slim ATLAS masterclass JiveXML events for Particle Hunters Lab (step C2).

Usage:  python3 -I tools/slim_jivexml.py OUT_DIR IN_FILE [IN_FILE ...]

What it keeps and why:
  - Tracks: the inner-detector collection 'Tracks' (only the fields Phoenix reads) and ONE collection of
    long tracks, 'LongTracks': the combined-fit muon tracks, plus any ConvertedStaco track that no combined-fit
    track matches. Each long track replaces its matching inner track, so every muon is one track from the
    beam line to the muon chambers. The neutral name keeps the word "Muon" out of the file (golden rule).
  - Calorimeter cells (LAr, HEC, Tile) with energy >= 0.5 GeV; <TILE> renamed <Tile> so Phoenix reads it.
  - Muon-chamber hits (MDT, RPC, TGC, CSCD), all of them, with their 'identifier' (the page reads the
    chamber station from it) and 'id' (LongTracks' <hits> lists the ids of the hits each track used).
  - One jet collection (AntiKt4LCTopoJets) and one missing-energy collection (MET_RefFinal).
Everything else is dropped, including the particle labels (Muon, Electron, Photon), trigger information
(trigger names such as "mu24" would give the answer away), truth tracks (STr), segments, vertices and FCAL.
"""
import math
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

CELL_MIN_GEV = 0.5
KEEP_JETS = 'AntiKt4LCTopoJets'
KEEP_MET = 'MET_RefFinal'
LONG_PRIMARY = 'CombinedFitMuonTracks'
LONG_EXTRA = 'ConvertedStacoTracks'
ID_TRACK_FIELDS = {'chi2', 'cotTheta', 'd0', 'id', 'nPixHits', 'nSCTHits', 'nTRTHits', 'numDoF',
                   'numPolyline', 'phi0', 'polylineX', 'polylineY', 'polylineZ', 'pt', 'trackAuthor', 'z0'}
LONG_TRACK_FIELDS = ID_TRACK_FIELDS | {'numHits', 'hits'}
PER_POLYLINE = {'polylineX', 'polylineY', 'polylineZ'}
PER_HIT = {'hits', 'driftSign', 'isOutlier'}
MATCH_DR = 0.05  # two tracks are the same particle if they point the same way (ΔR < 0.05) with the same charge


def values(el, tag):
    child = el.find(tag)
    return (child.text or '').split() if child is not None else []


def entries(el):
    """Split a JiveXML collection into one dict per entry: {field: [values...]}."""
    n = int(el.get('count'))
    npl = [int(float(v)) for v in values(el, 'numPolyline')]
    nhit = [int(float(v)) for v in values(el, 'numHits')]
    out = [dict() for _ in range(n)]
    for child in el:
        vals = (child.text or '').split()
        if child.tag in PER_POLYLINE:
            sizes = npl
        elif child.tag in PER_HIT:
            sizes = nhit
        elif len(vals) == n:
            sizes = [1] * n
        elif n and len(vals) % n == 0:
            sizes = [len(vals) // n] * n  # fixed number per entry, e.g. covMatrix
        else:
            raise ValueError(f'{el.tag}/{child.tag}: {len(vals)} values for {n} entries')
        if len(sizes) != n or sum(sizes) != len(vals):
            raise ValueError(f'{el.tag}/{child.tag}: sizes do not add up')
        c = 0
        for i, k in enumerate(sizes):
            out[i][child.tag] = vals[c:c + k]
            c += k
    return out


def build(tag, attrib, rows, fields):
    """Write entries back as a JiveXML collection with only the given fields (in a stable order)."""
    el = ET.Element(tag, dict(attrib, count=str(len(rows))))
    el.text = '\n'
    for f in sorted(fields):
        if not rows or f not in rows[0]:
            continue
        child = ET.SubElement(el, f)
        if f in PER_POLYLINE or f in PER_HIT:
            child.set('multiple', str(round(sum(len(r[f]) for r in rows) / max(1, len(rows)), 4)))
        child.text = '\n' + ' '.join(v for r in rows for v in r[f]) + '\n'
        child.tail = '\n'
    el.tail = '\n\n'
    return el


def direction(row):
    cot = float(row['cotTheta'][0])
    eta = math.asinh(cot)
    return eta, float(row['phi0'][0]), math.copysign(1, float(row['pt'][0]))


def same_particle(a, b):
    ea, pa, qa = direction(a)
    eb, pb, qb = direction(b)
    dphi = math.atan2(math.sin(pa - pb), math.cos(pa - pb))
    return qa == qb and math.hypot(ea - eb, dphi) < MATCH_DR


def slim(src, dst):
    root = ET.parse(src).getroot()
    out = ET.Element('Event', {k: v for k, v in root.attrib.items()
                               if k in ('version', 'runNumber', 'eventNumber', 'lumiBlock', 'dateTime')})
    out.text = '\n'
    by_key = {(el.tag, el.get('storeGateKey', '')): el for el in root}
    report = {}

    # Tracks: long tracks first, then the inner tracks they replace.
    long_rows = entries(by_key[('Track', LONG_PRIMARY)]) if ('Track', LONG_PRIMARY) in by_key else []
    extra = entries(by_key[('Track', LONG_EXTRA)]) if ('Track', LONG_EXTRA) in by_key else []
    added = [r for r in extra if not any(same_particle(r, l) for l in long_rows)]
    long_rows += added
    inner_el = by_key[('Track', 'Tracks')]
    inner = entries(inner_el)
    replaced = [i for i, r in enumerate(inner) if any(same_particle(r, l) for l in long_rows)]
    inner = [r for i, r in enumerate(inner) if i not in set(replaced)]
    out.append(build('Track', {'storeGateKey': 'Tracks'}, inner, ID_TRACK_FIELDS))
    if long_rows:
        out.append(build('Track', {'storeGateKey': 'LongTracks'}, long_rows, LONG_TRACK_FIELDS))
    report['tracks'] = f'{len(inner)} inner + {len(long_rows)} long ({len(added)} from {LONG_EXTRA}, {len(replaced)} inner replaced)'

    # Calorimeter cells above threshold.
    ncells = 0
    for tag, new_tag in (('LAr', 'LAr'), ('HEC', 'HEC'), ('TILE', 'Tile')):
        el = next((e for e in root if e.tag == tag), None)
        if el is None:
            continue
        rows = [r for r in entries(el) if float(r['energy'][0]) >= CELL_MIN_GEV]
        out.append(build(new_tag, el.attrib, rows, rows[0].keys() if rows else []))
        ncells += len(rows)
    report['cells'] = ncells

    # Muon-chamber hits, unchanged.
    nhits = 0
    for tag in ('MDT', 'RPC', 'TGC', 'CSCD'):
        el = next((e for e in root if e.tag == tag), None)
        if el is not None:
            el.tail = '\n\n'
            out.append(el)
            nhits += int(el.get('count'))
    report['hits'] = nhits

    for key in (('Jet', KEEP_JETS), ('ETMis', KEEP_MET)):
        if key in by_key:
            by_key[key].tail = '\n\n'
            out.append(by_key[key])

    text = '<?xml version="1.0"?>\n' + ET.tostring(out, encoding='unicode') + '\n'
    for word in ('Muon', 'Electron', 'Photon', 'muon', 'electron', 'photon'):
        if word in text:
            raise RuntimeError(f'{src.name}: "{word}" still in output')  # golden rule: never ship a label
    dst.write_text(text, encoding='utf-8')
    report['size_kb'] = round(dst.stat().st_size / 1024)
    return report


def main():
    out_dir = Path(sys.argv[1])
    out_dir.mkdir(parents=True, exist_ok=True)
    for name in sys.argv[2:]:
        src = Path(name)
        print(src.name, slim(src, out_dir / src.name))


if __name__ == '__main__':
    main()
