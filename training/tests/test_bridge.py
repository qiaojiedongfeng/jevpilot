import sys
from pathlib import Path
import unittest
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from jevpilot_env import JevPilotEnv
from stable_baselines3.common.env_checker import check_env


class BridgeTests(unittest.TestCase):
    def test_contract(self):
        env = JevPilotEnv()
        try:
            check_env(env)
            first, _ = env.reset(seed=42)
            env.step(np.array([0, 1], dtype=np.float32))
            second, _ = env.reset(seed=42)
            np.testing.assert_array_equal(first, second)
        finally:
            env.close()
        self.assertIsNotNone(env.process.poll())

    def test_process_failure_is_reported(self):
        env = JevPilotEnv(timeout=1)
        env.process.kill()
        env.process.wait()
        with self.assertRaises(RuntimeError):
            env.reset(seed=42)
        env.close()


if __name__ == "__main__":
    unittest.main()
