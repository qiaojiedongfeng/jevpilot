# Jevpilot

A playable Three.js driving world, built with Vite 8. Jev controls steering and target velocity through TypeSafe's real `jev-latest` API.

Open **http://localhost:5173** after starting the server.

## Run

```sh
npm ci
cp .env.example .env
# Set TYPESAFE_API_KEY in .env.
npm run dev
```

Supply your own TypeSafe API key in `.env`. `.env` and other local environment files are ignored by Git and blocked from Vite file serving. The browser only calls the local `/api/decide` endpoint; the key stays in the server process.

```sh
npm run build
npm run preview
```

Both development and production preview serve the Jev API middleware. The preview uses port 5173, so stop the development server before starting it. A plain static file host alone does not provide the API middleware.

The server binds to localhost by default. Set `JEV_HOST` and, when using a custom hostname, comma-separated `JEV_ALLOWED_HOSTS` in `.env` to override it. Browser checks target `http://localhost:5173` by default; set `BASE_URL` to test a different server.

## Play

- **W / ↑**: hold the accelerator; release it to coast with rolling resistance, engine braking, and aerodynamic drag. **S / ↓**: brake, then reverse.
- **A / D** or **← / →**: tap for small steering corrections; hold for a progressively sharper turn; release to recenter; **Space**: brake.
- **J**: toggle Jev autopilot. Driving keys immediately take back control.
- **C**: chase camera, driver camera, bird's eye view.
- **P**: pause the world and new API requests.
- The **steering** slider sets steering. In free play, the accelerator slider is a pedal that springs back when released. In autopilot, it displays Jev’s target velocity.
- Drag the world to orbit in Chase and Bird’s eye, or to look around from the Driver seat. Scroll to zoom outside; double-click to recenter. Driver position is attached to the car every frame.
- Colliding with a building, pedestrian, car, or motorcycle ends the drive. A game-over dialog offers Restart drive or a new world. Impacts deform vehicles, scatter debris, create smoke/masonry scars, and knock down pedestrians without gore.
- Choose **Skyline City**, **Small town**, or **Interstate 08**. City avenues have 125–179 m blocks and skyscrapers; town blocks are 110–164 m with low buildings. The interstate is a separate divided, four-lane highway with long curves, overpasses and no intersections.
- The world fills the screen, with a white, charcoal and red interface. Sliders, safety settings and session statistics live in the controls popover. The minimap is visible at bottom left by default, centers on the car, rotates to keep its heading upward, and can be toggled; the JSON inspector is an optional overlay. **Restart trip** replays the current seed.
- Follow the route on the minimap to the destination flag. Stop near it to finish a trip. The 3D road has no dashed navigation route.
- **JSON** opens compact Jev input, full perception, the full world, or the latest response with actual probabilities and usage. Freeze or download any view.
- A seed can be replayed with `/?seed=42&world=city`.

## How the model drives

`src/world.js` generates the road graph, neighborhoods, objects, navigation route, and signal schedules. Houses include cottages, townhouses, modern homes, shops, and apartments. The renderer combines generated buildings and streets with locally bundled surface maps and optimized 3D models.

`src/simulation.js` is independent of rendering. The ego car uses bicycle kinematics: steering is normalized to `[-1, 1]`, velocity is a target in meters per second, and acceleration/braking are limited. Autopilot uses target velocity; free play uses separate throttle and brake physics. Manual steering builds a virtual stick over 0.63 seconds with a soft center for precise taps. Holding reaches much stronger steering, including at highway speeds; releasing or countersteering recenters quickly. The steering range still varies with speed, following the general approach in [Unity’s vehicle tutorial](https://docs.unity3d.com/6000.0/Documentation/Manual/WheelColliderTutorial.html), with the input curve tuned for keyboard play. Manual steering can leave the road; the car is not attached to a route. Traffic follows right-side lane paths, obeys signals and full stop dwell, yields to intersection reservations and pedestrians, and brakes for vehicles ahead. Town/city traffic extends its route before reaching the final junction, preserving position. Interstate traffic continues beyond the map and recycles only beyond the view, spawning away from the player. Pedestrians follow actual sidewalk edges rather than fixed offsets into building plots.

Navigation projects **11 candidate motion plans**. Each applies a possible steering setting for 1.2 seconds, then previews a physically feasible return toward the route for a total three-second horizon. The same initial rollout is evaluated for route error and drawn on the road. Jev chooses the maneuver; proposals are recalculated as the car moves. The vehicle is never snapped onto a path.

Two Jev Choice questions run together:

1. **Vector:** choose among the eleven predicted route-tracking errors.
2. **Velocity:** choose a speed from 0, 2, 5, 10, 14, 18 or 28 m/s. A continuously computed speed ceiling describes stopping-distance, traffic and turn constraints. Jev selects among speeds allowed by that ceiling. Full stop becomes available at the stopping point; farther away, positive approach speeds keep the car moving toward the line. The returned `available_velocity_choices` make this constraint inspectable.

**Planning lines** appear only while Jev is engaged and extend ahead on the asphalt without arrowheads. Only the selected line is drawn, in bright iOS blue. Alternative paths and their labels are hidden; their actual probabilities remain available in the JSON inspector. Lines morph smoothly as the scene and choices change. A subtle moving highlight communicates replanning; probabilities are never randomized. Requests run up to 8 Hz with one in flight; actual cadence depends on API latency and browser performance. The path is hidden when its answer expires after 1.8 seconds.

The compact input contains speed/limits, upcoming turn, destination distance, predicted route errors and a **live local scene**. The scanner refreshes at 5 Hz, sees a 130° forward field, checks building occlusion, and extends its range from 80 m to 168 m with speed. Nearby vehicles and pedestrians enter the input as they become visible. The current intersection includes its signal color, distance, stop completion and any reason to yield. A clear green light releases its speed constraint immediately. The full inspector retains discovered object IDs and first/last observation times. Full geometry and decorative objects stay in the simulator.

Real seed-42 city and seed-7 interstate verification averaged **939 and 904 input tokens per call**, versus roughly 4,200 previously, while reaching 65 and 101 km/h. Token counts vary with visible traffic.

Only Jev's returned axes are applied in autopilot. The optional **Safety brake** can cap speed for a missed traffic hazard or destination; the HUD reports interventions. It predicts crossing and merging traffic over 3–5 seconds, follows route bends, compares oriented vehicle footprints, and leaves extra clearance around motorcycles. Following traffic uses bumper gaps; signal stops leave the front bumper behind the stop line. Shadows refresh every rendered frame. Decisions expire after 1.8 seconds and the car brakes until a fresh answer arrives. Errors trigger braking and exponential backoff; three consecutive failures disengage autopilot. Pausing, resetting, or manual takeover invalidates in-flight controls. Completed responses still count toward session usage.

The full perception/world overlays also include pose, controls, visibility and occlusion, buildings, roads, signals, traffic, pedestrians, route geometry and telemetry. Pedestrians face their movement direction and animate their stride. This is a game sensor model, not photographic vision.

## Rendering and assets

The world uses 1K albedo, normal, and roughness maps at consistent physical scale for asphalt, paving, brick, grass, and bark. A 2K HDR daylight environment lights reflections; directional shadows update every frame. Skyscrapers have reflective glass, mullions and floor bands. Nearby trees, shrubs and streetlights use sourced models; spatial instancing and simpler distant foliage keep draw calls bounded. Grass blades and leaf cards animate in the wind. The player car is a Tesla Model Y with pearl white paint, a panoramic glass roof, detailed cabin, and wheels that roll and steer; simplified vehicles populate traffic.

Assets live in `public/` and work without third-party requests after the app loads. Surface and environment maps and tree/shrub/streetlight models are [Poly Haven CC0 assets](https://polyhaven.com/license); individual source links are bundled beside the files. The [Tesla Model Y 2021](https://sketchfab.com/3d-models/tesla-model-y-2021-c0a86cac582d4b33aba0fb1b1912d970) is by 763468712 (CC BY 4.0), via Tina 3D Tesla. Source, license, and optimization notes are in `public/models/model-y/`. Adaptations include polygon reduction, Draco compression, scale, materials, batching, and separate rolling/steering wheel pivots. Credits are also in the in-app help.

## Cost

The footer uses **actual reported input and output token counts** multiplied by configured prices, accumulated across successful calls in the current page session. TypeSafe's published September 14, 2026 launch rate is **$0.042 per million input tokens; output tokens free**. This is an API cost estimate, not an account billing query. Override `JEV_INPUT_PRICE` / `JEV_OUTPUT_PRICE` in `.env` if your account's rate changes.

## Verification

```sh
npm test                      # deterministic simulation checks; no API spend
npm run build                 # Vite production bundle
npm run test:jev               # real Jev drive; incurs token usage
WORLD=town SEED=501 npm run test:jev
WORLD=highway SEED=7 npm run test:jev
WORLD=city SEED=42 npm run test:jev
npm run test:browser           # full browser interaction + real Jev trip
npm run test:experience        # cameras, pedals, crashes, assets, mobile
npm run test:browser:failures  # mocked failures and stale responses; no API spend
npm run test:stop-line         # real Jev red-light approach and green release
```

For the browser test, install Chromium using `npx playwright install chromium` if it is not already available. Screenshots go to `artifacts/`. Real API tests use the local environment key and are bounded by `MAX_CALLS` (default 600). They fail if the destination is not reached or contacts/violations occur.

Simulation checks cover connected roads and valid destinations across 300 generated worlds, steering/braking/reverse, signal exclusivity, stop dwell and intersection priority, visibility/occlusion, pause/reset, NPC traffic compliance, pedestrian heading, progressive scene discovery, green-light release, highway destination braking, and exact physical planning rollouts. Browser checks exercise rendered WebGL, live/frozen/full JSON, both driving axes, cameras, pause, manual takeover, actual Jev arrival, world regeneration, and mobile layout.

## References

Read for this integration: [Introduction](https://docs.typesafe.ai/introduction.md), [documentation index](https://docs.typesafe.ai/llms.txt), [Quick start](https://docs.typesafe.ai/introduction/quickstart.md), [State](https://docs.typesafe.ai/concepts/state.md), [Primitives](https://docs.typesafe.ai/primitives.md), [Choice](https://docs.typesafe.ai/primitives/choice.md), [Score](https://docs.typesafe.ai/primitives/score.md), [Noul](https://docs.typesafe.ai/primitives/noul.md), [structured questions](https://docs.typesafe.ai/primitives/advanced.md), [confidence](https://docs.typesafe.ai/confidence.md), [building with System One](https://docs.typesafe.ai/concepts/how-to-build-with-system-one.md), the architectural patterns, and the complete [HTTP API reference](https://docs.typesafe.ai/api.md).

Pricing: [TypeSafe's launch announcement](https://typesafe.ai/blog/introducing-system-one-models-and-jev).
