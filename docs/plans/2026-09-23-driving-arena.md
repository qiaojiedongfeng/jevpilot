# Driving Arena Implementation Plan

**Goal:** Build a short, editable driving exam with four actor types, simple paths and triggers, repeatable trials and results.

**Architecture:** Add a fixed arena world to the existing Simulation and worker. Scripted actors remain in the existing traffic/pedestrian arrays so perception, candidate prediction and swept collisions see the same objects as rendering. A separate arena UI owns the draft and trial lifecycle; the original drive remains accessible with `?mode=drive`.

**Tech Stack:** Vite, vanilla JavaScript, Three.js, existing Jev server and background planner, node:test.

## 1. Fixed world and actors
- Add `src/arena-world.js` with a 240 m road, crossroad, fixed seed, 40 km/h limit.
- Add `src/arena-model.js`: draft validation, lane snapping, four actor presets, deterministic path motion and one-shot proximity triggers.
- Update `src/world.js` and `src/simulation.js` to support arena worlds and scripted actors.
- Test placement bounds/overlaps, triggers, reset reproducibility and perception/collision integration in `tests/arena.test.js`.

## 2. Editor and rendering
- Add `src/arena-scene.js` for a lightweight 3D sandbox, object picking, map pan/zoom, selection, path and trigger overlays, and follow camera.
- Add `src/arena.js` and `src/arena.css`: tool palette, inspector, undo, local draft persistence, and accessible actions. Add the arena entry to `src/bootstrap.js`.
- Validate edits before applying. Keep draft coordinates separate from trial positions. Show meaningful errors instead of silently discarding invalid edits.

## 3. Trial lifecycle
- Use the existing planner worker and `/api/decide`; preserve generation checks and abort in-flight requests on stop/retry.
- Freeze simulation while awaiting a fresh decision, and advance with fixed physics steps, keeping network wait separate from simulated exam time.
- Finish on arrival, collision or 90 simulated seconds; API failures are service errors rather than driving failures.
- Report outcome, simulated time, collisions, safety interventions and cost. Retry from the original draft; editing never mutates the completed result.

## 4. Verification
- Run `node --test tests/arena.test.js` and provider tests; run `npm run build`.
- Browser-check all four placements, settings, undo, restart, draft restoration and trial lifecycle. Validate a real Jev trial with bounded calls.
- Existing upstream test failures were previously reproduced; avoid unrelated driving changes in this increment.

## Scope
- No public leaderboard or hosted level database in this increment. Local drafts and JSON export/import support iteration.
- E-bikes are represented by a lightweight two-wheel model and motorcycle physics footprint. Actors follow authored paths and do not implement general pedestrian intelligence.
