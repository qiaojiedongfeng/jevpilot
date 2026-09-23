# JevPilot

## Driving exam playground (fork)

The default page is now a short driving exam editor: place slow cars, parked
cars, e-bikes and pedestrians, set straight paths and immediate/proximity
triggers, then let Jev attempt the 211 m course. Trials finish on arrival,
collision or a 90-second simulation timeout. Network wait freezes exam time;
safety braking remains enabled and intervention episodes are counted.

Use the left toolbox and click the map to place an actor. Drag actors to move
them; choose a destination in the inspector. Right-drag pans, the wheel zooms,
and **Esc** exits placement. **Ctrl+Z** undoes edits. Drafts save locally;
JSON export/import lets you keep and exchange levels. E-bikes use a simple
two-wheel model with a motorcycle collision footprint. This first version is
for local development, with no public leaderboard or hosted level storage.

The original playground remains available at `/?mode=drive`.

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
