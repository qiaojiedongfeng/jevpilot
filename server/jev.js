import { performance } from "node:perf_hooks";
import {
  VECTOR_AXES,
  VELOCITY,
  vectorAxis,
  vectorWeights,
} from "../src/planning.js";
export function questions(state) {
  const result = {
    vector: {
      type: "choice",
      instructions:
        "Select the motion vector with the smallest numeric value in `vectors`. Values are predicted route-tracking errors after 1.2s; smaller is better. This directly sets steering.",
      criteria: Object.fromEntries(
        Object.keys(VECTOR_AXES).map((id) => [id, null]),
      ),
    },
    velocity: {
      type: "choice",
      instructions:
        "Choose the fastest available speed within speed_ceiling_mps. Approach a distant red light or stop sign; stop at its line, or behind the vehicle ahead. The ceiling already includes braking distance, traffic clearance and turns. Green and clear means proceed.",
      criteria: {
        stop: "speed_ceiling_mps < 2",
        creep: "2 <= speed_ceiling_mps < 5",
        slow: "5 <= speed_ceiling_mps < 10",
        cruise: "10 <= speed_ceiling_mps < 14",
        fast: "14 <= speed_ceiling_mps < 18",
        city: "18 <= speed_ceiling_mps < 28",
        open: "speed_ceiling_mps >= 28",
      },
    },
  };
  if (state) {
    // Keep progressing toward the stopping point while there is safe room.
    // The per-frame safety brake can still stop for a newly arriving hazard.
    const ceiling = state.speed_ceiling_mps;
    result.velocity.criteria = Object.fromEntries(
      Object.entries(result.velocity.criteria).filter(([id]) =>
        id === "stop" ? ceiling < VELOCITY.creep : VELOCITY[id] <= ceiling,
      ),
    );
  }
  return result;
}
export async function evaluate(state, env, signal) {
  const start = performance.now();
  const requestQuestions = questions(state);
  const res = await fetch("https://api.typesafe.ai/v1/systemone", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.TYPESAFE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "jev-latest",
      state,
      questions: requestQuestions,
    }),
    signal: signal || AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    const error = new Error(
      res.status === 401
        ? "Jev rejected the API key. Update TYPESAFE_API_KEY in .env."
        : res.status === 429
          ? "Jev rate limit reached. Pausing before retry."
          : `Jev API returned HTTP ${res.status}.`,
    );
    error.status = res.status;
    throw error;
  }
  const data = await res.json();
  const a = data.answers;
  if (
    !Object.hasOwn(VECTOR_AXES, a?.vector?.choice) ||
    !vectorWeights(a?.vector) ||
    !Object.hasOwn(VELOCITY, a?.velocity?.choice) ||
    !Object.hasOwn(requestQuestions.velocity.criteria, a?.velocity?.choice) ||
    !Number.isFinite(data.usage?.input_tokens) ||
    !Number.isFinite(data.usage?.output_tokens)
  )
    throw new Error("Jev returned an incomplete decision.");
  const inputPrice = Number(env.JEV_INPUT_PRICE ?? 0.042),
    outputPrice = Number(env.JEV_OUTPUT_PRICE ?? 0);
  return {
    model: data.model,
    answers: a,
    available_velocity_choices: Object.keys(requestQuestions.velocity.criteria),
    controls: {
      steering: vectorAxis(a.vector.choice, state.speed_mps),
      velocity: VELOCITY[a.velocity.choice],
    },
    usage: data.usage,
    latency_ms: Math.round(performance.now() - start),
    cost_usd:
      (data.usage.input_tokens * inputPrice +
        data.usage.output_tokens * outputPrice) /
      1e6,
    pricing: {
      input_per_million: inputPrice,
      output_per_million: outputPrice,
      source: "https://typesafe.ai/blog/introducing-system-one-models-and-jev",
    },
  };
}
export function jevMiddleware(env) {
  let active = 0;
  return async (req, res, next) => {
    if (!req.url?.startsWith("/api/")) return next();
    const send = (code, value) => {
      res.writeHead(code, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify(value));
    };
    if (req.url === "/api/status" && req.method === "GET")
      return send(200, {
        configured: !!env.TYPESAFE_API_KEY,
        model: "jev-latest",
        pricing: {
          input_per_million: Number(env.JEV_INPUT_PRICE ?? 0.042),
          output_per_million: Number(env.JEV_OUTPUT_PRICE ?? 0),
        },
      });
    if (req.url !== "/api/decide" || req.method !== "POST")
      return send(404, { error: "Not found" });
    if (!env.TYPESAFE_API_KEY)
      return send(503, {
        error: "Set TYPESAFE_API_KEY in .env and restart the server.",
      });
    if (
      req.headers.origin &&
      req.headers.origin !== `http://${req.headers.host}` &&
      req.headers.origin !== `https://${req.headers.host}`
    )
      return send(403, { error: "Origin not allowed" });
    if (active >= 3)
      return send(429, { error: "Too many active Jev requests." });
    active++;
    try {
      let body = "";
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 250000) {
          send(413, { error: "State is too large" });
          return;
        }
      }
      const { state } = JSON.parse(body);
      if (
        !Number.isFinite(state?.speed_mps) ||
        !Number.isFinite(state?.speed_ceiling_mps) ||
        state.speed_ceiling_mps < 0 ||
        !state?.vectors ||
        !state?.turn
      )
        return send(400, { error: "A valid driving observation is required." });
      const result = await evaluate(state, env);
      send(200, result);
    } catch (e) {
      send(e.status || 502, {
        error:
          e.name === "TimeoutError"
            ? "Jev timed out. Car stopped; retrying."
            : e.message,
      });
    } finally {
      active--;
    }
  };
}
