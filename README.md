# Jevdrive

https://github.com/user-attachments/assets/4baef58e-54ef-4d17-9982-353a0b6e6f45

A demo project showing Tesla Autopilot-like behavior using [Jev by TypeSafe AI](https://typesafe.ai/).

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
