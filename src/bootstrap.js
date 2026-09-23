import { loadingFailed, nextPaint } from "./loading-screen.js";

// Paint the lightweight HTML loader before downloading/building the 3D world.
nextPaint()
  .then(() => new URLSearchParams(location.search).get("mode") === "drive" ? import("./main.js") : import("./arena.js"))
  .catch(loadingFailed);
