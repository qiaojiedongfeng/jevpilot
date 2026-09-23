// Server-only provider selection. Never expose the API key in status responses.
export function jevConfig(env) {
  const openrouter = !!env.OPENROUTER_API_KEY;
  return {
    apiKey: openrouter ? env.OPENROUTER_API_KEY : env.TYPESAFE_API_KEY,
    endpoint: openrouter
      ? "https://openrouter.ai/api/v1/systemone"
      : "https://api.typesafe.ai/v1/systemone",
    model: env.JEV_MODEL || "jev-latest",
    keyName: openrouter ? "OPENROUTER_API_KEY" : "TYPESAFE_API_KEY",
    pricingSource: openrouter
      ? "https://openrouter.ai/typesafe/jev-1.13"
      : "https://typesafe.ai/blog/introducing-system-one-models-and-jev",
  };
}
