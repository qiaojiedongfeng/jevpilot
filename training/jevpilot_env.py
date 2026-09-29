"""Gymnasium bridge to the project's persistent, headless Node process."""
import json
from pathlib import Path
import queue
import shutil
import subprocess
import tempfile
import threading

import gymnasium as gym
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
SCHEMA = "straight-pass-v1"


class JevPilotEnv(gym.Env):
    metadata = {"render_modes": []}

    def __init__(self, timeout=15, server="env-server.mjs", observation_size=10):
        super().__init__()
        self.action_space = gym.spaces.Box(-1, 1, (2,), dtype=np.float32)
        self.observation_space = gym.spaces.Box(-1, 1, (observation_size,), dtype=np.float32)
        node = shutil.which("node")
        if not node:
            raise RuntimeError("Node.js not found in PATH")
        self.timeout = timeout
        self.request_id = 0
        self.closed = False
        self.responses = queue.Queue()
        self.errors = tempfile.TemporaryFile(mode="w+b")
        try:
            self.process = subprocess.Popen(
                [node, str(ROOT / "scripts/rl" / server)], cwd=ROOT,
                stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=self.errors,
                text=True, encoding="utf-8", bufsize=1,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
        except BaseException:
            self.errors.close()
            raise
        self.reader = threading.Thread(target=self._read, daemon=True)
        self.reader.start()

    def _read(self):
        try:
            for line in self.process.stdout:
                self.responses.put(line)
        finally:
            self.responses.put(None)

    def _request(self, command, **kwargs):
        if self.closed:
            raise RuntimeError("Environment is closed")
        self.request_id += 1
        try:
            self.process.stdin.write(json.dumps(dict(
                protocol_version=1, request_id=self.request_id,
                command=command, **kwargs), allow_nan=False) + "\n")
            self.process.stdin.flush()
            line = self.responses.get(timeout=self.timeout)
            if line is None:
                raise RuntimeError("Node process exited")
            message = json.loads(line)
            if message.get("request_id") != self.request_id or message.get("protocol_version") != 1:
                raise RuntimeError("Node response protocol mismatch")
            if "error" in message:
                raise RuntimeError(message["error"])
            return message["result"]
        except KeyboardInterrupt:
            self.close()
            raise
        except Exception as exc:
            self.close()
            raise RuntimeError(f"Node bridge failed: {exc}") from exc

    def reset(self, *, seed=None, options=None):
        super().reset(seed=seed)
        # Reserve >= 2 billion for fixed validation, never sample it in training.
        scenario_seed = int(seed) if seed is not None else int(self.np_random.integers(0, 1_000_000_000))
        result = self._request("reset", seed=scenario_seed)
        return np.asarray(result["observation"], dtype=np.float32), result["info"]

    def step(self, action):
        action = np.asarray(action)
        if action.shape != (2,) or not np.isfinite(action).all():
            raise ValueError("Expected two finite action values")
        result = self._request("step", action=action.tolist())
        return (np.asarray(result["observation"], dtype=np.float32),
                float(result["reward"]), result["terminated"], result["truncated"], result["info"])

    def close(self):
        if self.closed:
            return
        self.closed = True
        if self.process.poll() is None:
            try:
                self.process.stdin.write('{"protocol_version":1,"command":"close"}\n')
                self.process.stdin.flush()
                self.process.wait(timeout=2)
            except (OSError, subprocess.TimeoutExpired):
                self.process.kill()
                self.process.wait(timeout=5)
        self.reader.join(timeout=2)
        for stream in (self.process.stdin, self.process.stdout, self.errors):
            try:
                stream.close()
            except OSError:
                pass  # Windows may flush a broken pipe while closing stdin.


def make_env():
    from stable_baselines3.common.monitor import Monitor
    return Monitor(JevPilotEnv())
