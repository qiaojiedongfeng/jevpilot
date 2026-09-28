# Human and Jev Challenges Implementation Plan

**Goal:** Allow families and Jev to attempt the same authored challenge.

**Architecture:** Keep driver choice separate from the exported question. Reuse the existing simulation, reset, scoring and generation invalidation. Track successful user driver changes per attempt; internal shutdowns do not change classification.

**Tech Stack:** JavaScript, Three.js, Vite, Playwright, Node tests.

1. Add initial and next-driver selectors in src/challenge.js. Default to human; gate only Jev starts on API availability.
2. Allow run-phase keyboard, touch and autopilot controls in src/main.js and src/challenge.css. Clear held controls and invalidate pending decisions on switching.
3. Record human/Jev/mixed results and allow human recovery from connection errors. Preserve the existing deterministic reset for retries.
4. Update README and add browser coverage for no-key human play, switching, outcomes and retry reset. Run npm test, npm run build and the new browser script.

Approved design: pre-start choice, in-run switching without resetting time, classified results, and same-question retries with a new driver.
