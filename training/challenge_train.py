"""Train the actual game's obstacle challenge and export a browser policy."""
import argparse
import json
import os
from pathlib import Path
import time
os.environ.setdefault("OMP_NUM_THREADS", "1")
os.environ.setdefault("MKL_NUM_THREADS", "1")
import gymnasium as gym
import numpy as np
import torch
from stable_baselines3 import PPO
from stable_baselines3.common.monitor import Monitor
from stable_baselines3.common.vec_env import DummyVecEnv
from stable_baselines3.common.logger import configure
from jevpilot_env import JevPilotEnv, ROOT
from train import source_hash, write_json
from curriculum import Curriculum, STAGES, STAGE_SEEDS, FULL_SEEDS, full_configs, score, write_report

SCHEMA = "challenge-structured-v1"


class ChallengeEnv(JevPilotEnv):
    def __init__(self, config=None, curriculum=None):
        super().__init__(server="challenge-server.mjs", observation_size=96)
        self.config = config or {}
        self.curriculum = curriculum

    def reset(self, *, seed=None, options=None):
        gym.Env.reset(self, seed=seed)
        scenario_seed = int(seed) if seed is not None else int(self.np_random.integers(0, 1_000_000_000))
        config = dict(curriculumStage=self.curriculum.sample(self.np_random)) if self.curriculum else self.config
        result = self._request("reset", seed=scenario_seed, config=config)
        return np.asarray(result["observation"], dtype=np.float32), result["info"]


def evaluate(model, config, seeds=range(2_000_000_000, 2_000_000_010), configs=None):
    env = ChallengeEnv(config)
    episodes, examples = [], []
    try:
        for index, seed in enumerate(seeds):
            env.config = configs[index] if configs is not None else config
            obs, _ = env.reset(seed=seed)
            total = 0
            while True:
                action, _ = model.predict(obs, deterministic=True)
                if len(examples) < 32:
                    examples.append(dict(observation=obs.tolist(), action=action.tolist()))
                obs, reward, terminated, truncated, info = env.step(action)
                total += reward
                if terminated or truncated:
                    episodes.append(dict(reward=total, **info))
                    break
    finally:
        env.close()
    rates = {key: sum(e["reason"] == reason for e in episodes)/len(episodes)
             for key, reason in [("success_rate", "success"), ("collision_rate", "collision"),
                                 ("offroad_rate", "offroad"), ("timeout_rate", "deadline")]}
    return dict(**rates, mean_distance_to_goal=float(np.mean([e["distance_to_goal"] for e in episodes])), episodes=episodes), examples


def export_policy(model, examples, config):
    layers = []
    for module in list(model.policy.mlp_extractor.policy_net) + [model.policy.action_net]:
        if isinstance(module, torch.nn.Linear):
            layers.append(dict(weight=module.weight.detach().cpu().tolist(), bias=module.bias.detach().cpu().tolist()))
        elif not isinstance(module, torch.nn.Tanh):
            raise ValueError("Unsupported activation in browser policy")
    return dict(schema=SCHEMA, steps=model.num_timesteps, layers=layers, examples=examples,
                activation="tanh", output="clip(-1,1)", config=config)


def save(model, run, config, evaluation, examples, curriculum=None, history=None, best=None, stale=0):
    folder = run / f"step-{model.num_timesteps:010d}"
    pending = run / f".pending-{model.num_timesteps}"
    pending.mkdir()
    model.save(pending / "policy.zip")
    write_json(pending / "manifest.json", dict(schema=SCHEMA, steps=model.num_timesteps,
               source_hash=source_hash(), config=config, curriculum=curriculum.state() if curriculum else None,
               history=history or [], best_score=best, stale_evaluations=stale,
               resume="new episodes; not bitwise exact"))
    write_json(pending / "evaluation.json", evaluation)
    write_json(pending / "policy.json", export_policy(model, examples, config))
    pending.rename(folder)
    pointer = run / ".latest.tmp"
    write_json(pointer, {"checkpoint": folder.name})
    pointer.replace(run / "latest.json")
    print(json.dumps(dict(steps=model.num_timesteps, **{k:v for k,v in evaluation.items() if k!='episodes'})), flush=True)
    return folder


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--steps", type=int, default=100_000)
    p.add_argument("--hours", type=float, default=0)
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--challenge", type=Path, help="version=2 editor export; optional task: {startS,goalS}")
    p.add_argument("--resume", type=Path)
    p.add_argument("--no-curriculum", action="store_true", help="train the original fixed challenge")
    p.add_argument("--eval-updates", type=int, default=10, help="evaluate every N complete 1024-step updates")
    p.add_argument("--run-dir", type=Path, default=ROOT/'artifacts/rl'/time.strftime('challenge-%Y%m%d-%H%M%S'))
    args=p.parse_args()
    if args.steps<1 or args.eval_updates<1 or not np.isfinite(args.hours) or args.hours<0 or not 0<=args.seed<1_000_000_000:
        p.error('Invalid budget or training seed')
    config={}
    curriculum = None if args.challenge or args.no_curriculum else Curriculum()
    history = []
    if args.challenge:
        draft=json.loads(args.challenge.read_text(encoding='utf-8-sig'))
        config=dict(draft=draft, task=draft.get('task',{}))
    if args.resume:
        manifest=json.loads((args.resume/'manifest.json').read_text(encoding='utf-8'))
        if manifest['schema']!=SCHEMA or manifest['source_hash']!=source_hash():
            p.error('Checkpoint schema/source mismatch')
        if args.challenge and config!=manifest['config']:
            p.error('Cannot change the task while resuming this experiment')
        config=manifest['config']
        saved_curriculum = manifest.get('curriculum')
        if saved_curriculum and (args.no_curriculum or args.challenge):
            p.error('Cannot change curriculum mode while resuming')
        curriculum = Curriculum(**saved_curriculum) if saved_curriculum else None
        history = manifest.get('history', [])
    args.run_dir.mkdir(parents=True,exist_ok=False)
    write_json(args.run_dir/'config.json',dict(environment=config,seed=args.seed,steps=args.steps,hours=args.hours,
               curriculum=curriculum.state() if curriculum else None, eval_updates=args.eval_updates,
               stage_seeds=STAGE_SEEDS, full_seeds=FULL_SEEDS, full_configs=full_configs()))
    torch.set_num_threads(1)
    env=DummyVecEnv([lambda:Monitor(ChallengeEnv(config, curriculum))])
    try:
        model=(PPO.load(args.resume/'policy.zip',env=env,device='cpu') if args.resume else
               PPO('MlpPolicy',env,device='cpu',seed=args.seed,n_steps=1024,batch_size=256,n_epochs=5,
                   gamma=.995,ent_coef=.005,target_kl=.03,policy_kwargs=dict(net_arch=[128,128])))
        env.seed(args.seed)
        model.set_logger(configure(str(args.run_dir),['csv']))
        initial=model.num_timesteps; started=time.monotonic(); last_saved=initial
        best = None
        stale = manifest.get('stale_evaluations', 0) if args.resume else 0
        # Each run's best.json always points to a checkpoint available in that run.
        # Preserve historical comparison via metrics and the parent manifest.
        def assess(advance=True):
            nonlocal best, stale, last_saved
            tested_stage = curriculum.stage if curriculum else None
            stage_result, examples = evaluate(model, dict(curriculumStage=tested_stage) if curriculum else config, STAGE_SEEDS)
            evaluation, full_examples = evaluate(model, {}, FULL_SEEDS, full_configs()) if curriculum else (stage_result, examples)
            promoted = curriculum.assess(stage_result) if curriculum and advance else False
            current_score = score(evaluation)
            improved = best is None or current_score > best
            stale = 0 if improved else stale + int(advance)
            if improved:
                best = current_score
            row = dict(steps=model.num_timesteps, stage_index=tested_stage,
                       stage_name=STAGES[tested_stage] if curriculum else '固定自定义/原始任务',
                       promoted=promoted, stage={k:v for k,v in stage_result.items() if k != 'episodes'},
                       full={k:v for k,v in evaluation.items() if k != 'episodes'})
            # A resumed initial assessment is not another promotion vote.
            if not history or history[-1]['steps'] != model.num_timesteps:
                history.append(row)
            evaluation['stage_evaluation'] = stage_result
            folder = save(model,args.run_dir,config,evaluation,full_examples,curriculum,history,best,stale)
            last_saved = model.num_timesteps
            if improved:
                write_json(args.run_dir/'best.json', {'checkpoint':folder.name})
            write_report(args.run_dir, history)
            print(json.dumps(dict(stage='assessment', tested_stage=tested_stage,
                       stage_success=stage_result['success_rate'], promoted=promoted,
                       next_stage=curriculum.stage if curriculum else None, stale_evaluations=stale)), flush=True)
            if stale >= 5:
                print('No improvement on fixed challenges for 5+ assessments; inspect report.html, observations and rewards before extending the budget.', flush=True)
        assess(advance=False)
        updates=0
        while model.num_timesteps-initial<args.steps:
            if (args.run_dir/'STOP').exists() or (args.hours and time.monotonic()-started>=args.hours*3600):break
            model.learn(1024,reset_num_timesteps=False);updates+=1
            elapsed=time.monotonic()-started
            if updates%10==0:print(json.dumps(dict(stage='update',steps=model.num_timesteps,elapsed_seconds=round(elapsed,1))),flush=True)
            if updates%args.eval_updates==0 or model.num_timesteps-initial>=args.steps:
                assess()
        if last_saved!=model.num_timesteps:
            assess()
        write_json(args.run_dir/'status.json',dict(status='completed',steps=model.num_timesteps,
                   stop_reason='step_budget' if model.num_timesteps-initial>=args.steps else 'stop_file' if (args.run_dir/'STOP').exists() else 'time_budget'))
    except KeyboardInterrupt:
        write_json(args.run_dir/'status.json',dict(status='interrupted',recovery='latest.json'))
    except BaseException as e:
        write_json(args.run_dir/'status.json',dict(status='failed',error=str(e)));raise
    finally:env.close()


if __name__=='__main__':main()
