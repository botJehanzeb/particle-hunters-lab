# SPEC — Particle Hunters Lab

Give this file to the AI at the start of every session, with the current files.

## What it is

A browser tool where school students (ages 12–15, English) explore real ATLAS collision events in 3D, modelled on [HYPATIA](https://hypatia.iasa.gr/en/help.html). It belongs to the Particle Hunters course and is live at https://jehanzebwaqar.com/particle-hunters-lab/ (GitHub Pages from `main`, repo `botJehanzeb/particle-hunters-lab`).

## The four stages

Each stage goes live before the next one starts.

1. **Reading Tracks** (building now). Browse 50 real events in two views, click a track to highlight it in both, and answer "In which view is momentum conserved?" (answer: the end view). No particle ID, no masses.
2. **Identify.** Electrons, muons, photons, jets, missing energy; each track's momentum, direction, charge.
3. **Reconstruct.** "Insert as electron / muon", invariant-mass table, 2- and 4-lepton masses, export/import.
4. **Discover.** Live mass histograms, the Z peak near 91 GeV, Higgs candidates.

## Current step

**C1 — download dataset 8:** unzip package A (group A): the 50 events to browse. *Done when:* there are 50 event files and one of them opens in the loader. (Already downloaded outside the repo on 3 Nov: `Projects/Particle-Hunters-Lab/data/dataset8/groupA/`, 50 files, 108 MB.)

Last done: B4. Layer switches (tracks, energy deposits, muon-chamber hits, jets off by default, missing energy) and a colour key under the views; each switch works in both views (tested). `js/prepare.js` turns Phoenix's event data into the two views: barrel-only objects for Phoenix (end view), everything for the side view; one jet collection (`AntiKt4LCTopoJets`), one missing-energy collection (`MET_RefFinal`); particle labels never passed on; cells below 0.5 GeV dropped (same as C2). Phase B is complete (B5 was decided earlier). Open: deposits are drawn thin (6 cm wide, from the test page) and hard to see. Full step list: Phases A–E in the build plan (kept outside this repo).

## How it is built

- **3D display:** [Phoenix](https://hepsoftwarefoundation.org/phoenix/) 4.2.3 with three.js 0.184.0, from a CDN. Versions pinned; do not upgrade. Load three.js as a module, set the global `THREE`, *then* load the Phoenix bundle.
- **Two views:** Phoenix draws the end view (barrel only). The page draws its own ρ–z side view (barrel + end-caps, tracks at full length). The page handles clicks and highlights in both views; Phoenix's own selection is not used.
- **Detector drawing:** our own simplified one, with muon chambers at the real radii.
- **Data:** ATLAS ZPath 2015 Masterclass, dataset 8 ([CERN Open Data record 360](https://opendata.cern.ch/record/360)): real 2012 collisions, CC0, JiveXML files that Phoenix reads directly. Two sets: package A (50 events) to browse, and about 7 hand-picked events for the momentum question. Each event is slimmed to under 1 MB and loaded only when shown.

## Folder layout

Now: `index.html` (page skeleton), `css/style.css` (site colours and fonts), `js/main.js` (loads three.js then Phoenix, reads the test event, renders both views; status list shows progress and any error), `js/detector.js` (simplified detector and muon-chamber geometry), `js/prepare.js` (event data → what each view draws), `events/test/event001.xml` (one test event: dataset 8 group A, `Electron`/`Muon`/`Photon` blocks removed, `TILE` renamed `Tile`), `SPEC.md`.

Planned (proposed, change if a step needs it):

```
index.html        the page
css/  js/         styles and scripts, plain files
events/50/        slimmed JiveXML, package A
events/balance/   the ~7 momentum-question events
answers.json      our labels per event — never loaded into what students see
tools/            Python helpers (slim_jivexml.py, balance-set picker); not used by the page
```

## Rules

- Plain HTML, CSS and JavaScript. No build tools, no npm, no frameworks.
- **Never show the answer** (lepton type, event category) anywhere a student can see it, including Phoenix's info panel. Answers live only in `answers.json`; never put them as extra fields on Phoenix objects.
- Show energies and momenta in **GeV**. In Phoenix's JiveXML loader, cell energies are in GeV but clusters and tracks are in MeV.
- Plain-word labels ("momentum", "direction", "charge"); symbols (p, pT, η, φ, θ, q) only behind a "?" on hover or tap. Short text blocks. A session is about 20 minutes.
- Store a Data / Simulation flag for every event; run numbers alone are not proof.
- Muon-chamber hits: show only on-track hits by default (most hits are background).
- One step = one session = one commit, named with the step ("A3 page skeleton"). Do only the step asked; don't change other features. Return complete changed files plus a one-line summary.
- No analytics or tracking until a consent check for under-16s is decided.

## Known Phoenix quirks

Its selection highlight shows in one view only; its click detection assumes a full-page display; the selected-object value follows the mouse, not clicks; it stops extrapolated tracks at 1.1 m; its JiveXML loader skips `<TILE>` cells unless renamed `<Tile>`.

## Credits (for the help page)

ATLAS Open Data: cite CERN Open Data record 360 (it has no DOI) and state that ATLAS/CERN do not endorse this tool. Phoenix (HEP Software Foundation).
