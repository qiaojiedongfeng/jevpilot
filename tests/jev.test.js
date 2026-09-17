import test from "node:test";
import assert from "node:assert/strict";
import { evaluate, questions } from "../server/jev.js";
import { Simulation } from "../src/simulation.js";
import {
  VECTOR_AXES,
  vectorWeights,
  projectVectors,
  physics,
} from "../src/planning.js";
const sample = new Simulation(42).decisionState();
const probabilities = Object.fromEntries(
  Object.keys(VECTOR_AXES).map((id) => [id, id === "L2" ? 0.8 : 0.02]),
);

test("Jev requests two typed choices and returns exact axes with usage-based cost", async () => {
  const original = globalThis.fetch;
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, ...options };
    return Response.json({
      model: "jev-latest",
      answers: {
        vector: { choice: "L2", confidence: 0.8, probabilities },
        velocity: { choice: "slow", confidence: 0.9 },
      },
      usage: { input_tokens: 2000, output_tokens: 80 },
    });
  };
  try {
    const result = await evaluate(sample, {
      TYPESAFE_API_KEY: "test-only-key",
    });
    assert.equal(request.url, "https://api.typesafe.ai/v1/systemone");
    assert.equal(request.headers.Authorization, "Bearer test-only-key");
    const sent = JSON.parse(request.body);
    assert.equal(Object.keys(sent.questions).length, 2);
    assert.equal(sent.questions.vector.type, "choice");
    assert.deepEqual(result.controls, { steering: -0.2, velocity: 5 });
    assert.deepEqual(result.answers.vector.probabilities, probabilities);
    assert.equal(result.cost_usd, 0.000084);
    assert.deepEqual(result.usage, { input_tokens: 2000, output_tokens: 80 });
    assert(!JSON.stringify(result).includes("test-only-key"));
  } finally {
    globalThis.fetch = original;
  }
});

test("API errors and malformed decisions fail explicitly without invented controls", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response("", { status: 429 });
    await assert.rejects(
      () => evaluate(sample, { TYPESAFE_API_KEY: "test" }),
      /rate limit/,
    );
    globalThis.fetch = async () =>
      Response.json({
        answers: {
          vector: { choice: "invented" },
          velocity: { choice: "fast" },
        },
        usage: { input_tokens: 10, output_tokens: 2 },
      });
    await assert.rejects(
      () => evaluate(sample, { TYPESAFE_API_KEY: "test" }),
      /incomplete decision/,
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("probability weighting uses model data and expires without inventing confidence", () => {
  const a = { choice: "L2", probabilities };
  assert.equal(vectorWeights(a).L2.probability, 0.8);
  assert.equal(vectorWeights(a).L2.selected, true);
  assert.equal(vectorWeights(a, 1801), null);
  assert.equal(vectorWeights({ choice: "C" }), null);
});

test("drawn planning lines begin with the exact physical maneuver submitted to Jev", () => {
  const sim = new Simulation(42);
  sim.player.speed = 14;
  for (const v of Object.values(projectVectors(sim.player))) {
    const ghost = { ...sim.player };
    for (let i = 0; i < 24; i++) physics(ghost, v.axis, 14, 0.05);
    assert(Math.abs(ghost.x - v.evaluation.x) < 1e-8);
    assert(Math.abs(ghost.z - v.evaluation.z) < 1e-8);
    assert.equal(v.points.length, 61);
  }
});

test("velocity choices approach distant stops and allow a full stop at the stopping point", () => {
  for (const ceiling of [5, 10, 14, 18, 28]) {
    const options = questions({ speed_ceiling_mps: ceiling }).velocity.criteria;
    assert(!Object.hasOwn(options, "stop"));
    assert(Object.hasOwn(options, "creep"));
  }
  assert.deepEqual(
    Object.keys(questions({ speed_ceiling_mps: 1.4 }).velocity.criteria),
    ["stop"],
  );
  assert.deepEqual(
    Object.keys(questions({ speed_ceiling_mps: 0 }).velocity.criteria),
    ["stop"],
  );
});
