"""CPU PPO entry point. Checkpoints are published after complete updates."""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import random
import shutil
import time

os.environ.setdefault("OMP_NUM_THREADS", "1")
os.environ.setdefault("MKL_NUM_THREADS", "1")

import numpy as np
import torch
from stable_baselines3 import PPO
from stable_baselines3.common.vec_env import DummyVecEnv, SubprocVecEnv
from stable_baselines3.common.logger import configure
from evaluate import evaluate, VALIDATION_SEEDS
from jevpilot_env import ROOT, SCHEMA, make_env


def source_hash():
    digest = hashlib.sha256()
    paths = sorted((ROOT / "src").glob("*.js")) + sorted((ROOT / "src/rl").glob("*.js"))
    paths += sorted((ROOT / "scripts/rl").glob("*.mjs"))
    paths += sorted((ROOT / "training").glob("*.py"))
    for path in paths:
        digest.update(path.relative_to(ROOT).as_posix().encode())
        digest.update(path.read_bytes())
    return digest.hexdigest()


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False), encoding="utf-8")


def validate_checkpoint(path):
    manifest = json.loads((path / "manifest.json").read_text(encoding="utf-8"))
    if manifest["schema"] != SCHEMA or manifest["source_hash"] != source_hash():
        raise ValueError("Checkpoint schema/source differs; use the original source version")
    return manifest


def checkpoint(model, directory, config, result, replay):
    final = directory / f"step-{model.num_timesteps:010d}"
    if final.exists():
        raise FileExistsError(final)
    pending = directory / f".pending-{model.num_timesteps}-{os.getpid()}"
    pending.mkdir()
    model.save(pending / "policy.zip")
    write_json(pending / "manifest.json", dict(
        schema=SCHEMA, source_hash=source_hash(), steps=model.num_timesteps,
        course="60 m straight pass; no parking or traffic", safety="raw",
        observation_normalization="fixed scales in environment.js", config=config,
        validation_seeds=VALIDATION_SEEDS, resume="new episodes; no partial rollout restoration",
        torch_version=torch.__version__,
    ))
    write_json(pending / "evaluation.json", result)
    if replay:
        write_json(pending / "replay.json", replay)
    # JSON avoids loading an additional arbitrary pickle when restoring RNGs.
    numpy_state = np.random.get_state()
    write_json(pending / "rng.json", dict(
        python=random.getstate(),
        numpy=[numpy_state[0], numpy_state[1].tolist(), *numpy_state[2:]],
        torch=torch.get_rng_state().tolist(),
    ))
    pending.rename(final)
    pointer = directory / ".latest.tmp"
    write_json(pointer, {"checkpoint": final.name})
    pointer.replace(directory / "latest.json")
    return final


def restore_rng(path):
    state = json.loads((path / "rng.json").read_text(encoding="utf-8"))
    py = state["python"]
    random.setstate((py[0], tuple(py[1]), py[2]))
    ns = state["numpy"]
    np.random.set_state((ns[0], np.asarray(ns[1], dtype=np.uint32), *ns[2:]))
    torch.set_rng_state(torch.tensor(state["torch"], dtype=torch.uint8))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--steps", type=int, default=100_000, help="additional steps, rounded up to a rollout")
    parser.add_argument("--hours", type=float, default=0, help="0 disables wall-clock budget")
    parser.add_argument("--envs", type=int, default=1, choices=[1, 4, 8])
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--save-updates", type=int, default=25)
    parser.add_argument("--run-dir", type=Path, default=ROOT / "artifacts/rl" / time.strftime("%Y%m%d-%H%M%S"))
    parser.add_argument("--resume", type=Path, help="checkpoint directory (not policy.zip)")
    args = parser.parse_args()
    if args.steps <= 0 or not math.isfinite(args.hours) or args.hours < 0 or args.save_updates < 1:
        parser.error("steps/save-updates must be positive; hours must be finite and nonnegative")
    if not 0 <= args.seed < 1_000_000_000 - 8:
        parser.error("seed must be in training seed range [0, 999999992)")
    torch.set_num_threads(1)
    torch.set_num_interop_threads(1)
    config = {k: str(v) if isinstance(v, Path) else v for k, v in vars(args).items()}
    config.update(device="cpu", n_steps=1024, batch_size=256, net_arch=[128, 128])
    if args.resume:
        saved = validate_checkpoint(args.resume)
        if saved["config"]["envs"] != args.envs:
            parser.error("resume must use the checkpoint's --envs value")
    args.run_dir.mkdir(parents=True, exist_ok=False)
    if shutil.disk_usage(args.run_dir).free < 2 * 1024**3:
        raise RuntimeError("At least 2 GiB free disk space is required")
    write_json(args.run_dir / "config.json", config)
    env = None
    started = time.monotonic()
    try:
        env = (DummyVecEnv([make_env]) if args.envs == 1 else
               SubprocVecEnv([make_env] * args.envs, start_method="spawn"))
        env.seed(args.seed)
        if args.resume:
            model = PPO.load(args.resume / "policy.zip", env=env, device="cpu")
            restore_rng(args.resume)
        else:
            model = PPO("MlpPolicy", env, device="cpu", seed=args.seed,
                        n_steps=1024, batch_size=256, n_epochs=5,
                        learning_rate=3e-4, gamma=0.995, gae_lambda=0.95,
                        ent_coef=0.01, target_kl=0.03,
                        policy_kwargs=dict(net_arch=[128, 128]), verbose=0)
        model.set_logger(configure(str(args.run_dir), ["csv"]))
        initial_steps = model.num_timesteps
        evaluation, replay = evaluate(model, record=True)
        checkpoint(model, args.run_dir, config, evaluation, replay)
        print(json.dumps(dict(stage="initial", steps=model.num_timesteps, **{k:v for k,v in evaluation.items() if k != "episodes"})), flush=True)
        write_json(args.run_dir / "best.json", {"checkpoint": f"step-{model.num_timesteps:010d}"})
        best_score = (evaluation["success_rate"], -evaluation["offroad_rate"], evaluation["mean_progress"])
        updates = 0
        last_saved = model.num_timesteps
        while model.num_timesteps - initial_steps < args.steps:
            if shutil.disk_usage(args.run_dir).free < 2 * 1024**3:
                print("Low disk space: stopping at a complete update boundary", flush=True)
                break
            if (args.run_dir / "STOP").exists() or (args.hours and time.monotonic() - started >= args.hours * 3600):
                break
            model.learn(total_timesteps=1024 * args.envs, reset_num_timesteps=False)
            updates += 1
            elapsed = time.monotonic() - started
            finished = model.num_timesteps - initial_steps >= args.steps or (args.hours and elapsed >= args.hours * 3600) or (args.run_dir / "STOP").exists()
            print(json.dumps(dict(stage="update", steps=model.num_timesteps,
                                  elapsed_seconds=round(elapsed, 1),
                                  steps_per_second=round((model.num_timesteps-initial_steps)/elapsed, 1))), flush=True)
            if updates % args.save_updates == 0 or finished:
                evaluation, replay = evaluate(model, record=True)
                saved_path = checkpoint(model, args.run_dir, config, evaluation, replay)
                last_saved = model.num_timesteps
                score = (evaluation["success_rate"], -evaluation["offroad_rate"], evaluation["mean_progress"])
                if score > best_score:
                    best_score = score
                    write_json(args.run_dir / "best.json", {"checkpoint": saved_path.name})
                print(json.dumps(dict(stage="evaluation", steps=model.num_timesteps,
                                      **{k:v for k,v in evaluation.items() if k != "episodes"})), flush=True)
        if last_saved != model.num_timesteps:
            evaluation, replay = evaluate(model, record=True)
            checkpoint(model, args.run_dir, config, evaluation, replay)
        write_json(args.run_dir / "status.json", dict(status="completed", steps=model.num_timesteps))
    except KeyboardInterrupt:
        write_json(args.run_dir / "status.json", dict(status="interrupted", recovery="latest.json points to the last complete checkpoint"))
        print("Interrupted. Resume the last complete checkpoint in latest.json.", flush=True)
    except BaseException as exc:
        write_json(args.run_dir / "status.json", dict(status="failed", error=str(exc)))
        raise
    finally:
        if env is not None:
            env.close()


if __name__ == "__main__":
    main()
