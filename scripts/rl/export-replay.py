"""Export recorded straight-pass-v1 evaluations as a self-contained browser replay.

Kept outside training/*.py so adding a viewer does not invalidate model hashes.
"""
import argparse
import json
from pathlib import Path


def export(run):
    versions = []
    for folder in sorted(run.glob("step-*")):
        if not (folder / "replay.json").exists():
            continue
        manifest = json.loads((folder / "manifest.json").read_text(encoding="utf-8"))
        if manifest["schema"] != "straight-pass-v1":
            raise ValueError("This viewer supports only straight-pass-v1")
        evaluation = json.loads((folder / "evaluation.json").read_text(encoding="utf-8"))
        replays = json.loads((folder / "replay.json").read_text(encoding="utf-8"))
        scores = {item["seed"]: item for item in evaluation["episodes"]}
        episodes = []
        for episode in replays:
            frames = episode["frames"]
            if not frames or any(b["time"] <= a["time"] for a, b in zip(frames, frames[1:])):
                raise ValueError(f"Invalid replay time sequence: {folder}")
            # Pose and action are recorded at the end of each step; the initial
            # frame has no action. Retain every frame; only round display data.
            packed = [[round(f[k], 6) for k in ("time", "x", "z", "heading", "speed")]
                      + [round(a, 6) for a in f.get("action", [0, 0])] for f in frames]
            episodes.append(dict(seed=episode["seed"], score=scores[episode["seed"]], frames=packed))
        versions.append(dict(steps=manifest["steps"], success=evaluation["success_rate"],
                             offroad=evaluation["offroad_rate"], episodes=episodes))
    if not versions:
        raise ValueError("No completed checkpoints with replay.json found")
    shared = set(e["seed"] for e in versions[0]["episodes"])
    for v in versions:
        shared &= {e["seed"] for e in v["episodes"]}
    if not shared:
        raise ValueError("No shared evaluation seeds for synchronized comparison")
    data = dict(run=run.name, versions=versions, seeds=sorted(shared),
                course=dict(center=3, startZ=106, length=60, laneWidth=6))
    template = Path(__file__).with_name("replay.html").read_text(encoding="utf-8")
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"), allow_nan=False).replace("<", "\\u003c")
    output = run / "replay.html"
    output.write_text(template.replace("/*__REPLAY_DATA__*/", payload), encoding="utf-8")
    return output


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("run", type=Path, help="training run directory, not an individual checkpoint")
    args = parser.parse_args()
    print(export(args.run.resolve()))
