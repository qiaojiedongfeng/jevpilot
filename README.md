# Jevdrive

https://github.com/user-attachments/assets/4baef58e-54ef-4d17-9982-353a0b6e6f45

A demo project showing Tesla Autopilot-like behavior using [Jev by TypeSafe AI](https://typesafe.ai/).

## How it works

Jev receives a compact JSON snapshot: current speed and limit, next turn and destination distance, nearby vehicles and pedestrians with their relative positions and speeds, traffic signals, following gaps, and predicted hazards.

The simulator projects 11 steering options and scores their predicted route error. It also calculates a speed ceiling from traffic, turns, and stopping distance. Jev answers two typed choice questions:

- **Steering:** choose the option with the lowest predicted route error, from hard left through straight to hard right.
- **Speed:** choose the fastest available target speed within the ceiling, including creeping or stopping when appropriate.

The simulator applies these choices through its vehicle physics and repeats as the scene changes. An optional safety brake can further reduce speed for hazards. Open **JSON** in the app to inspect the inputs, choices, and probabilities.

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
