import { chromium, expect } from "@playwright/test";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
const cached =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
  `${homedir()}/Library/Caches/ms-playwright/chromium_headless_shell-1194/chrome-mac/headless_shell`;
const browser = await chromium.launch({
  headless: true,
  ...(existsSync(cached) ? { executablePath: cached } : {}),
});
const page = await browser.newPage({ viewport: { width: 1200, height: 850 } });
let requests = 0;
// All control responses in this file are explicit test doubles. No Jev API spend.
await page.route("**/api/decide", async (route) => {
  requests++;
  await route.fulfill({
    status: 503,
    contentType: "application/json",
    body: JSON.stringify({ error: "Test: API temporarily unavailable" }),
  });
});
await page.goto(
  new URL("/?seed=42", process.env.BASE_URL || "http://localhost:5173").href,
);
await expect(page.getByText("Jev connected", { exact: true })).toBeVisible();
await page.getByRole("switch", { name: "Jev autopilot" }).click();
await expect(
  page.getByRole("switch", { name: "Jev autopilot" }),
).toHaveAttribute("aria-checked", "false", { timeout: 16000 });
expect(requests).toBe(3);
expect(await page.locator("#speed").innerText()).toBe("0");
expect(await page.locator("#calls").innerText()).toBe("0");
await page.unroute("**/api/decide");
let release;
let observed;
const pending = new Promise((r) => (observed = r));
await page.route("**/api/decide", async (route) => {
  observed();
  await new Promise((r) => (release = r));
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      model: "test-double",
      answers: {
        vector: {
          choice: "R4",
          confidence: 1,
          probabilities: {
            L4: 0,
            L3: 0,
            L2: 0,
            L1: 0,
            L0: 0,
            C: 0,
            R0: 0,
            R1: 0,
            R2: 0,
            R3: 0,
            R4: 1,
          },
        },
        velocity: { choice: "fast", confidence: 1 },
      },
      controls: { steering: 0.85, velocity: 10 },
      usage: { input_tokens: 10, output_tokens: 2 },
      latency_ms: 150,
      cost_usd: 0.00000042,
    }),
  });
});
await page.getByRole("switch", { name: "Jev autopilot" }).click();
await pending;
await page.getByRole("switch", { name: "Jev autopilot" }).click();
release();
await expect(page.locator("#calls")).toHaveText("1");
expect(await page.locator("#steering-output").innerText()).toBe("0.00");
expect(await page.locator("#velocity-output").innerText()).toBe("0 km/h");
await expect(
  page.getByRole("switch", { name: "Jev autopilot" }),
).toHaveAttribute("aria-checked", "false");
console.log(
  "PASS: failed requests brake and back off; three failures disengage; stale decisions cannot regain control; completed usage still counted.",
);
await browser.close();
