# Traffic continuation and conservative passing

User-approved follow-up to the original-world challenge editor:

- Preserve actor paths, appearance, triggers and speed settings. Moving vehicle
  endpoints default to a waypoint into graph traffic, with native signal and
  following control; explicit stop-at-end remains an authoring option.
- Keep authored actors identifiable through retries and map resets. Import missing
  endpoint behavior as continue; reject paths that cannot join a matching lane.
- Permit a bounded outer-to-inner interstate pass with automatic return only when
  geometry, full corridor, rear traffic and return slot checks allow it. Preserve
  live collision braking. Do not authorize opposing lanes, ramps or queue jumping.
- Test continuation, deliberate stopping, pass/return through actual simulation,
  and rejection when adjacent traffic or exits make the maneuver unsuitable.
