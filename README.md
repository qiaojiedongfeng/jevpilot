# JevPilot

## Timed driving challenges (fork)

The default experience uses the original 3D renderer, detailed hero vehicle,
scenery, navigation and city/town/highway maps. Click **出题模式** to freeze the
world and add slow cars, parked cars, motorcycles or pedestrians using the
original models. Ambient traffic and pedestrians remain present.

Click a tool, then the road to place an actor. Drag to move, set speed and an
immediate/proximity trigger, or choose a path endpoint in the inspector.
Vehicles follow sampled road paths; pedestrians follow a straight segment.
Moving cars and motorcycles default to continuing into native traffic after the
waypoint, obeying signals and following rules at their configured speed. Choose
**到终点停车** to deliberately block the road; pedestrians and stop-at-end scripts
still follow their authored motion without independently avoiding traffic. Older
v2 vehicle drafts without an endpoint setting default to continuing. Right-drag
pans the editor camera, the wheel zooms, and the route slider follows navigation.
**Esc** exits placement; **Ctrl+Z** undoes edits. Drafts save locally and support
JSON export/import (v2, including map seed, type and time limit).

Choose a 30–1800 second deadline and start the exam. Jev drives using the original
control loop and safety brake; manual takeover is disabled during the exam.
Arrival succeeds, collision or timeout fails. Results report time, collisions,
violations, safety interventions and API cost. Pauses and hidden tabs do not
advance simulation time; normal API latency is part of the original live drive.
Repeated API errors pause the exam with a resume action. Retries regenerate the
same map and ambient traffic and restore authored actors to their starting poses.

The earlier separate low-poly arena is no longer the application entry point.
No public leaderboard or hosted level storage is included yet.

Jev can select a checked same-direction pass around a stopped or very slow
vehicle on a clear interstate section. The bounded maneuver changes to the inner
lane and returns before exits, with traffic clearance checks and live collision
braking. Highway passes require at least 12 m of space to begin the maneuver.
On straight city/town roads, a checked low-speed bypass (3 m/s) can borrow the
opposing lane after the lead vehicle has stopped for 8 seconds, with a 6–30 m
starting gap. Junctions, crossings, oncoming traffic, pedestrians and occupied
return spaces prevent this maneuver. These checks remain conservative; a bypass
is not guaranteed for every blockage or traffic queue.

Signal-controlled junction reservations now check whether the reserved vehicle
actually conflicts with the waiting vehicle's path, while preserving red-light
stops and checks for vehicles still occupying the junction. Double-click a vehicle
or click **路况诊断** during an exam to inspect its waiting reason. **保存卡住现场**
downloads a diagnostic JSON snapshot with vehicle states and junction reservations
(no API credentials); this is a debugging snapshot, not a replay/import format.

https://github.com/user-attachments/assets/4baef58e-54ef-4d17-9982-353a0b6e6f45

<p align="center">
  <a href="https://jevpilot.standardagents.ai">
    <img src="docs/try-jevpilot.svg" alt="Try JevPilot →" width="256" height="64" />
  </a>
</p>

A demo project showing Tesla Autopilot-like behavior using [Jev by TypeSafe AI](https://typesafe.ai/).

Sign in with Standard Agents for $0.25 of free Jev play credit. Joining the early-access list is optional.

The hosted `/api/decide` endpoint requires a valid login session. The browser sends its secure, HttpOnly session cookie; the Jev API key stays on the server.

**Interstate 08:** start in Millbrook, turn onto the signed on-ramp, merge, cruise, and exit into Cedar Town for the final stop.

## How it works

Jev receives compact tables of eligible paths, road boundaries, nearby traffic, signals, stop memory, and destination guidance. Shared table values are sent once, and instructions include only relevant situations. The road graph is sent only when choosing an alternative route after staying more than 30 meters off course for six seconds. Detailed geometry and control calculations stay local.

The simulator samples fresh steering-and-speed combinations for each decision. On the road, it favors paths that keep the whole car on asphalt. Off road, it explores a wider field of forward and reverse paths and supplies a recovery target, road boundaries, and collision predictions.

An explicit `driving_style` describes an aggressive driver: keep progressing, stop at the actual line, and close gaps before stopping behind an obstacle. Jev can choose an approach path that progressively slows to a stop 0.5 m before the line. An immediate **stop** is offered only within 2.5 m of a blocker or required stop line, at the destination, or when no eligible moving path exists. Candidate speeds taper near required stops. Jev receives recent-stop memory and collision timing; a safety brake handles collision risks.

Use **Candidates** to show the sampled paths: blue/cyan for forward, purple for reverse, amber for paths leaving the lane, orange for predicted collisions, and bright blue for Jev’s selection. Candidate generation and route searches run in a background worker; the renderer smoothly blends the sampled shapes. Open **JSON** to inspect road boundaries, recovery state, and actual choice probabilities.

Requests run up to 4 times/second near turns or traffic, and about 1.5 times/second on clear roads. Questions with one eligible answer are resolved locally. **JSON → Jev input** shows the exact API payload; the cost tooltip and response tab show average payload size and billed input tokens.

## Run locally

```sh
npm ci
cp .env.example .env
# Set OPENROUTER_API_KEY or TYPESAFE_API_KEY in .env.
npm run dev
```

Add your own [OpenRouter](https://openrouter.ai/docs/guides/community/typesafe-sdk) API key to `.env`:

```dotenv
OPENROUTER_API_KEY=your_key_here
JEV_MODEL=jev-latest
```

OpenRouter uses its TypeSafe-compatible `/api/v1/systemone` endpoint, preserving
the structured decisions and choice probabilities. Reported OpenRouter costs
are used when available. `OPENROUTER_API_KEY` takes precedence if both keys are
set. You can pin `JEV_MODEL=typesafe/jev-1.13` when using OpenRouter.

Alternatively, use a [TypeSafe AI](https://typesafe.ai/) API key:

```dotenv
TYPESAFE_API_KEY=your_key_here
```

Open [localhost:5173](http://localhost:5173). **Local development skips all login, signup, and demo credit limits.** No Standard Agents OAuth credentials are needed. Jev calls use your own key and the selected provider's billing; free play works without a key. The key stays server-side in the gitignored `.env`—never use a `VITE_` variable for it.

This also applies to `npm run preview` after `npm run build`. Restart the local server after changing `.env`.

**J** toggles autopilot · **WASD** to drive · **Space** to brake.

Asset credits and licenses are included in [public/](public/).

Cloudflare deployment details: [docs/hosting.md](docs/hosting.md).
