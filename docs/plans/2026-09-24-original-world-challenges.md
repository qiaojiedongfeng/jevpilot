# Original-world timed challenges

Supersedes the separate low-poly arena as the default experience. Preserve the original DriveScene, hero model, scenery, three maps, route navigation, background traffic and Jev decision loop.

1. Add a world-aware challenge draft with map seed/type, adjustable 30–1800 second limit, four actor types, sampled road paths and immediate/proximity triggers. Keep scripted actors in the real simulation arrays. Validate imported paths against roads, buildings, bounds and actor overlaps.
2. Extend DriveScene only with dynamic actor refresh and an editor camera focus. Reuse carModel/personModel; preserve materials, lights, asset loading and quality settings. Make scripted pedestrian animation IDs safe.
3. Add a floating challenge editor to main.js using a controller module. Freeze simulation while editing; route slider and right-drag locate obstacles. Maintain speed, destination, trigger, drag, delete, undo, local draft and JSON controls.
4. Hook challenge lifecycle into the original drive: reset the same seed before every attempt, keep ambient traffic, lock manual takeover during an AI exam, count simulation time (excluding pause/tab-hidden), preserve collision failure and show unified arrival/collision/timeout results. API failures pause the exam and allow retry instead of counting as a driving failure.
5. Validate placement and path geometry on all three maps, triggers, reproducible retries, score timing, model reuse, browser editing and a bounded live Jev test. Run build and relevant simulation regression tests.

The original sandbox source may remain as a development reference, but is no longer an entry point. No hosted scoreboard or new graphical vehicle models are part of this change.
