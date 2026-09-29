"""Fixed validation, not a final generalization test."""
import argparse
import json
from pathlib import Path
import numpy as np
import torch
from stable_baselines3 import PPO
from jevpilot_env import JevPilotEnv

VALIDATION_SEEDS = list(range(2_000_000_000, 2_000_000_020))


def evaluate(model, seeds=VALIDATION_SEEDS, record=False):
    env = JevPilotEnv()
    episodes, replay = [], []
    try:
        for seed in seeds:
            obs, info = env.reset(seed=seed)
            total = 0.0
            frames = [{"time": 0, **info["pose"]}]
            while True:
                action, _ = model.predict(obs, deterministic=True)
                obs, reward, terminated, truncated, info = env.step(action)
                total += reward
                if record:
                    frames.append({"time": info["simulation_time"], **info["pose"],
                                   "action": action.tolist()})
                if terminated or truncated:
                    break
            episodes.append(dict(seed=seed, reward=total, reason=info["reason"],
                                 progress=info["progress"], seconds=info["simulation_time"]))
            if record:
                replay.append(dict(seed=seed, frames=frames))
    finally:
        env.close()
    return dict(
        episodes=episodes, count=len(episodes),
        success_rate=sum(e["reason"] == "success" for e in episodes) / len(episodes),
        offroad_rate=sum(e["reason"] == "offroad" for e in episodes) / len(episodes),
        mean_progress=float(np.mean([e["progress"] for e in episodes])),
        mean_reward=float(np.mean([e["reward"] for e in episodes])),
    ), replay


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("checkpoint", type=Path)
    args = parser.parse_args()
    from train import validate_checkpoint
    validate_checkpoint(args.checkpoint)
    torch.set_num_threads(1)
    model = PPO.load(args.checkpoint / "policy.zip", device="cpu")
    result, replay = evaluate(model, record=True)
    (args.checkpoint / "replay.json").write_text(json.dumps(replay), encoding="utf-8")
    print(json.dumps(result, indent=2))
