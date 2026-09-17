# Jevdrive

https://github.com/user-attachments/assets/4baef58e-54ef-4d17-9982-353a0b6e6f45

A demo project showing Tesla Autopilot-like behavior using [Jev by TypeSafe AI](https://typesafe.ai/).

**Interstate 08:** start on a local road, take the on-ramp, merge with traffic, cruise, and exit into Cedar Town for the final stop.

## How it works

Jev receives the road graph, its global position and destination, and traffic all around the car with explicit ahead/behind positions. The route stays fixed while the car is on or near it; alternative routes are offered only after staying more than 30 meters away for six seconds. Local JSON adds speed, lane boundaries, signals, and predicted hazards.

The simulator samples fresh steering-and-speed combinations for each decision. On the road, it favors paths that keep the whole car on asphalt. Off road, it explores a wider field of forward and reverse paths and supplies a recovery target, road boundaries, and collision predictions.

An explicit `driving_style` describes an aggressive driver: keep progressing, stop at the actual line, and close gaps before stopping behind an obstacle. Jev can choose an approach path that progressively slows to a stop 0.5 m before the line. An immediate **stop** is offered only within 2.5 m of a blocker or required stop line, at the destination, or when no eligible moving path exists. Candidate speeds taper near required stops. Jev receives recent-stop memory and collision timing; an optional safety brake handles collision risks.

Use **Candidates** to show the sampled paths: blue/cyan for forward, purple for reverse, amber for paths leaving the lane, orange for predicted collisions, and bright blue for Jev’s selection. Candidate generation and route searches run in a background worker; the renderer smoothly blends the sampled shapes. Open **JSON** to inspect road boundaries, recovery state, and actual choice probabilities.

## Run locally

```sh
npm ci
cp .env.example .env
# Set TYPESAFE_API_KEY in .env.
npm run dev
```

Open [localhost:5173](http://localhost:5173). Your API key stays server-side in the gitignored `.env`.

**J** toggles autopilot · **WASD** to drive · **Space** to brake.

Asset credits and licenses are included in [public/](public/).
