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

**D5 — two views with zoom:** two views side by side, each with its own zoom slider and drag: the end view from Phoenix, barrel only (end-cap deposits and hits left out), and your own ρ–z side view. *Done when:* each slider zooms only its own view; tracks show at full length in the side view.

Done: Phases A, B and C; D1 (Previous / Next, "Go to" dropdown with event numbers only, counter — all kept in sync); D2 (full-width header bar: event N of M, run, ATLAS event number, date and time, Real data / Simulation badge, missing energy in GeV with its direction in degrees and an arrow that matches the end view); D3 (track table: #, p, pT, η, φ, θ, q, highest pT first, each symbol with a plain caption and a "?" explanation; each row has `data-pick` = the track's pickId); D4 (click linking: nearest track within 8 px in either view, projected through each view's camera, drawn as a thick purple `Line2` copy in both views plus the table row; row click selects; empty click / event change clears; follows the Tracks switch). C6 checked every event of both sets through the page (load, both views, Real data badge, date): 57/57, no page errors; all 52 long tracks end in the muon system. `?set=balance` opens the balance set until E1 adds the switch. Full step list: Phases A–E in the build plan (kept outside this repo).

Open items: deposits are drawn thin (6 cm wide) and hard to see; the balance set only reads clearly once D6's pT cut hides soft tracks; remove the "Shown in N ms" note in polish (E).

## How it is built

- **3D display:** [Phoenix](https://hepsoftwarefoundation.org/phoenix/) 4.2.3 with three.js 0.184.0, from a CDN. Versions pinned; do not upgrade. Load three.js as a module, set the global `THREE`, *then* load the Phoenix bundle.
- **Two views:** Phoenix draws the end view from barrel-only objects; the page draws its own ρ–z side view (barrel + end-caps) from all objects (`js/prepare.js`). The page handles clicks and highlights in both views; Phoenix's own selection is not used.
- **Detector drawing** (`js/detector.js`): muon-chamber bands measured from the hits of all 50 group A events. Barrel vs end-cap comes from each hit's `identifier` station name (B = barrel; BEE counts as end-cap). In the end view a barrel hit is drawn across its chamber at the hit's distance from the beam.
- **Track table values** (`trackRows` in `js/prepare.js`): Phoenix pT is in MeV → GeV; p = pT·cosh η; θ from η (Phoenix's dparams θ is folded to ±90°); φ in degrees 0–360. **Charge comes from the raw XML's signed `<pt>`, never from Phoenix's q/p**: Phoenix's sign disagrees with the XML on about half the tracks, while the XML sign matched all 46 checked lepton charges. Phoenix keeps XML track order but renames `Tracks` → `Tracks_`, so collections are paired by count and |pt|.
- **Missing energy** = √(etx² + ety²) of `MET_RefFinal`, in GeV (checked against the answer drafts). The XML's `<et>` field is not the missing energy; don't use it. Direction = φ in degrees, anticlockwise from the right of the end view.
- **Events load one at a time** when shown, with the neighbours prefetched (`js/main.js`). Layer switches: tracks, deposits, muon hits, jets (off by default), missing energy.

## Data

- Source: ATLAS ZPath 2015 Masterclass, dataset 8 ([CERN Open Data record 360](https://opendata.cern.ch/record/360)), CC0, JiveXML. Groups mix in simulated events (no date, lumiBlock 0); always check the data flag.
- **Browse set** `events/50/`: 50 real 2012 events (8 runs, 10 June – 6 July): group A's 45 real ones plus group B 001–005 in the slots of A's 5 simulated ones. `index.json` gives the order, source, run, event, date and data flag.
- **Balance set** `events/balance/`: 7 real two-lepton events (C-020, C-022, J-046, L-015, M-021, O-035, P-035) where the end view balances and the side view doesn't (checked: 2–28 GeV across vs 92–469 GeV along the beam). No usable large-missing-energy event was found.
- **Slimming** (`tools/slim_jivexml.py`): keeps inner tracks with silicon hits (TRT-only tracks dropped: no z, absurd momenta), one `LongTracks` collection for muons (combined-fit + unmatched ConvertedStaco, each replacing its inner track; `<hits>` kept for D6), cells ≥ 0.5 GeV, all muon hits with `identifier`/`id`, `AntiKt4LCTopoJets`, `MET_RefFinal`. Drops particle labels, trigger info, truth tracks, segments, vertices, FCAL. Refuses to write a file containing Muon/Electron/Photon.
- **Answers:** `tools/make_answers.py` drafts labels (Z→ee/μμ with mass, W→eν/μν, 4-lepton, no clear lepton; `checked: false`). Electrons count only if `isEMString` is Medium or TightPP. **`answers.json` is kept out of this repo**, since everything here is downloadable; how Stage 2 checks answers is decided then.
- `tools/find_balance_events.py` picked the balance set; it and `make_answers.py` read labels from raw files offline only.

## Folder layout

```
index.html  css/style.css  js/main.js  js/detector.js  js/prepare.js
events/50/        browse set + index.json
events/balance/   balance set + index.json
tools/            Python helpers (not used by the page)
SPEC.md
```

## Rules

- Plain HTML, CSS and JavaScript. No build tools, no npm, no frameworks.
- **Never show the answer** (lepton type, event category) anywhere a student can see it, including Phoenix's info panel. Answers live only in `answers.json`; never put them as extra fields on Phoenix objects.
- Show energies and momenta in **GeV**. In Phoenix's JiveXML loader, cell energies are in GeV but clusters and tracks are in MeV.
- Plain-word labels ("momentum", "direction", "charge"); symbols (p, pT, η, φ, θ, q) only behind a "?" on hover or tap. Short text blocks. A session is about 20 minutes.
- Store a Data / Simulation flag for every event; run numbers alone are not proof.
- Muon-chamber hits: show only on-track hits by default (most hits are background).
- **Cache-busting:** every CSS/JS link and local import carries `?v=<step>` (now `d4`). Bump it in all four places (index.html ×2, main.js ×2, prepare.js ×1) in any commit that changes CSS or JS; Pages lets browsers cache files for 10 min, and a stale mix breaks the page. Every import of a file must use the same `?v=`, or it loads twice.
- One step = one session = one commit, named with the step ("A3 page skeleton"). Do only the step asked; don't change other features. Return complete changed files plus a one-line summary.
- No analytics or tracking until a consent check for under-16s is decided.

## Known Phoenix quirks

Its selection highlight shows in one view only; its click detection assumes a full-page display; the selected-object value follows the mouse, not clicks; it stops extrapolated tracks at 1.1 m; its JiveXML loader skips `<TILE>` cells unless renamed `<Tile>`.

## Credits (for the help page)

ATLAS Open Data: cite CERN Open Data record 360 (it has no DOI) and state that ATLAS/CERN do not endorse this tool. Phoenix (HEP Software Foundation).
