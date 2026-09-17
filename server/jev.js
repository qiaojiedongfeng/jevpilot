import { performance } from "node:perf_hooks";
import {
  CANDIDATE_COUNT,
  decisionOptions,
  decisionSelection,
  stopAvailability,
} from "../src/planning.js";

export function validState(state) {
  if (
    !Number.isFinite(state?.speed_mps) ||
    !Number.isFinite(state?.speed_ceiling_mps) ||
    state.speed_ceiling_mps < 0 ||
    state.speed_ceiling_mps > 28 ||
    !/^b[0-9]+$/.test(state.batch_id) ||
    typeof state.road?.on_road !== "boolean" ||
    typeof state.recovery?.active !== "boolean" ||
    !state.vectors ||
    !state.turn
  )
    return false;
  const entries = Object.entries(state.vectors);
  return (
    entries.length > 0 &&
    entries.length <= CANDIDATE_COUNT &&
    entries.every(
      ([id, v]) =>
        v &&
        id.startsWith(`${state.batch_id}_`) &&
        /^[a-zA-Z0-9_]+$/.test(id) &&
        (v.lane_offset_m === null ||
          (Number.isFinite(v.lane_offset_m) &&
            Math.abs(v.lane_offset_m) <= 1.4 &&
            Number.isFinite(v.lookahead_m) &&
            v.lookahead_m >= 2 &&
            v.lookahead_m <= 10)) &&
        Number.isFinite(v.steering) &&
        Math.abs(v.steering) <= 0.85 &&
        Number.isFinite(v.velocity_mps) &&
        (v.stop_at_line == null ||
          (Number.isFinite(v.lane_offset_m) &&
            ["x", "z", "heading", "clearance_m", "deceleration_mps2"].every(
              (key) => Number.isFinite(v.stop_at_line[key]),
            ) &&
            v.stop_at_line.clearance_m === 0.5 &&
            v.stop_at_line.deceleration_mps2 >= 4 &&
            v.stop_at_line.deceleration_mps2 <= 4.8)) &&
        v.velocity_mps >= (state.recovery.active ? -2 : 0) &&
        Math.abs(v.velocity_mps) <= state.speed_ceiling_mps + 0.001 &&
        typeof v.collision_predicted === "boolean" &&
        typeof v.stays_on_road === "boolean" &&
        Number.isFinite(v.route_error_m) &&
        Number.isFinite(v.offroad_fraction),
    ) &&
    (!stopAvailability(state).available ||
      entries.some(([, v]) => v.velocity_mps === 0))
  );
}

export function questions(state) {
  const { moving, motion } = decisionOptions(state);
  return {
    ...(state.global?.routes && Object.keys(state.global.routes).length > 1
      ? {
          route: {
            type: "choice",
            instructions:
              "Choose how to reach global.destination using the road graph and offered routes. keep continues the current route. Keep it whenever on or near it, including while waiting or turning. Alternatives exist only after a sustained substantial departure. Consider lane direction and join_distance_m. Avoid repeated direction changes. A changed route triggers a fresh maneuver decision.",
            criteria: Object.fromEntries(
              Object.keys(state.global.routes).map((id) => [id, null]),
            ),
          },
        }
      : {}),
    motion: {
      type: "choice",
      instructions: [
        "Follow state.driving_style. Decide DRIVE versus an immediate full STOP independently of which steering path is best. drive includes accelerating, cruising, slowing down, crawling, recovery movement, or a stop_at_line maneuver that advances and then stops at the line; stop means zero target velocity now. Multiple similar paths are all ways to drive, not separate reasons to stop. Choose drive whenever an offered moving maneuver can make useful progress. Choose stop only for a concrete current requirement described in driving_style.",
        "A distant signal or sign is not an immediate stop command. Approach the actual stop line. Use the current scene.intersection.signal, stop_line_ahead_m, stop_completed and stop_memory. A completed stop is remembered while creeping; do not repeat it. An early stop farther back means advance toward the line. Move promptly on green or after the required stop when the path is clear. Once already_entered, clear the junction unless an actual conflict requires braking.",
        "Negative ahead_m means behind. Rear pressure favors prompt forward motion. Nearby vehicles and pedestrians require yielding only if their trajectories conflict with yours. scene.hazard applies to the current maneuver; another candidate may be clear. braking_reduces_risk=false describes a rear threat, not a reason to stop. collision_imminent is an immediate constraint; later collision predictions are warnings to reassess while moving. Respect a blocked queue and a red light at the line.",
        "state.stop_availability explains which actions are offered. When stop is absent from the criteria, choose drive: slowing and shorter vectors remain available. A full stop is offered only within 2.5 m along our path of a blocker or required stop line, at the destination, or when no eligible moving path exists. Objects behind or beside our path do not unlock stopping. If drive is absent, stop is the only eligible action. The vector question separately chooses the best path assuming drive.",
      ].join(" "),
      criteria: motion,
    },
    ...(Object.keys(moving).length
      ? {
          vector: {
            type: "choice",
            instructions: [
              "Assume motion=drive and choose the best offered MOVING maneuver under state.driving_style, even if your separate motion answer is stop. A stop_at_line vector is a moving approach with a planned stop at the actual line, not an immediate stop. The motion question handles stopping now. Select one of the offered criteria IDs. Never choose collision_imminent=true.",
              "Prefer the fastest useful speed, low route_error_m and lane_error_m, and stays_in_lane=true. Stay centered in the right-hand lane. velocity_mps is a cap; steering is the initial command of a maneuver tracking lane_offset_m and lookahead_m. end_speed_mps includes following-distance braking and slowing for the actual U-turn arc. A distant U-turn does not require crawling on the straight approach: faster lane-following vectors slow as they reach the bend, using the same speed profile shown in their projection. Maintain forward progress in queues without passing. Rear pressure favors a faster clear option. In recovery, reduce recovery_distance_m and road_distance_after_m, then align with the route; reverse is allowed if clear.",
              "Use road.boundary_samples as the road map ahead: road_left/right are actual asphalt edges; lane_left/right are the desired lane edges and may be crossed during a merge without leaving asphalt. All points use [right, ahead] meters relative to this car. road.ego_footprint shows the whole car. edge_clearance_samples give the space from its left/right body edges to asphalt at the rear, center and front; negative clearance means over the edge, not a nearby vehicle. Keep the whole body on pavement, not just its center. A candidate's first_offroad gives when and where its body first leaves pavement (zero means already outside); max_offroad_fraction gives the worst body area outside. Choose a continuing lane-tracking path that stays on road instead of driving into grass or the median. Close road edges alone are not a reason to stop. During recovery, favor returning onto pavement and aligning with the route. Optional drivable_polygons form a union; their internal seams are not curbs. Null edges mean unavailable geometry, and the end of the preview is not the end of the road.",
              "On interstate trips, trip.phase distinguishes the local road, onramp, merge, interstate, exit, offramp, and town. Accelerate on a clear onramp, match motorway traffic speed in the merge, then accelerate to the interstate cruising limit. The ramp-to-merge boundary is continuous forward travel: do not stop, turn around, or favor a short path there. Prefer positive route_progress_m, follows_route_direction=true, and a fast lane-following vector. Choose a clear gap using relative traffic positions and candidate collisions; use a slower moving vector to fit behind another vehicle only when there is an actual conflict. Follow the exit into town and stop at the destination. Road-section speed changes are already included in the projected and executed maneuvers.",
              "For an unserved stop sign or red light, prefer a stop_at_line vector: its velocity_mps is the approach cap and its controller brakes progressively to rest with the front bumper 0.5 m before the line. That profile is included in end_speed_mps and stop_line_after_m and also runs on the real car. Do not choose a crossing path merely because its speed is higher. Compare braking distances and crossing flags if a stopping profile is unavailable. On green or after the required stop is complete, choose a continuing vector without stop_at_line when clear. crosses_stop_line=true is then normal forward progress, not a hazard; do not favor a short vector simply to remain behind the line. Assess later predicted conflicts using collision_in_s and collision_object_id; the three-second rollout is continuously replanned. Rear traffic is predicted to brake behind you.",
            ].join(" "),
            criteria: Object.fromEntries(
              Object.keys(moving).map((id) => [id, null]),
            ),
          },
        }
      : {}),
  };
}
export async function evaluate(state, env, signal) {
  if (!validState(state)) {
    const error = new Error(
      "A valid driving observation and candidate batch are required.",
    );
    error.status = 400;
    throw error;
  }
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
  const selection = decisionSelection(state, a);
  if (
    !selection ||
    !Number.isFinite(data.usage?.input_tokens) ||
    !Number.isFinite(data.usage?.output_tokens)
  )
    throw new Error("Jev returned an incomplete decision.");
  if (
    requestQuestions.route &&
    !Object.hasOwn(requestQuestions.route.criteria, a.route?.choice)
  )
    throw new Error("Jev returned an invalid route choice.");
  const selected = state.vectors[selection.choice];
  if (
    (selected.collision_imminent ?? selected.collision_predicted) &&
    selected.velocity_mps !== 0
  )
    throw new Error(
      "Jev selected a path with an imminent collision. Braking before retry.",
    );
  const inputPrice = Number(env.JEV_INPUT_PRICE ?? 0.042),
    outputPrice = Number(env.JEV_OUTPUT_PRICE ?? 0);
  return {
    model: data.model,
    answers: a,
    selection,
    batch_id: state.batch_id,
    controls: { steering: selected.steering, velocity: selected.velocity_mps },
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
      if (!validState(state))
        return send(400, {
          error:
            "A valid driving observation and candidate batch are required.",
        });
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
