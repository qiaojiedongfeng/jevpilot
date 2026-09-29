import sys
from pathlib import Path
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from challenge_train import ChallengeEnv
from stable_baselines3.common.env_checker import check_env

class ChallengeTests(unittest.TestCase):
    def test_gym_contract(self):
        env=ChallengeEnv()
        try:
            check_env(env)
            self.assertEqual(env.observation_space.shape,(97,))
            self.assertEqual(env.action_space.shape,(3,))
        finally:
            env.close()

if __name__=='__main__':unittest.main()
