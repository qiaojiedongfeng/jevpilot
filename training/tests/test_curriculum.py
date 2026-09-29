import sys
from pathlib import Path
import tempfile
import unittest
import numpy as np
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from curriculum import Curriculum, STAGES, STAGE_SEEDS, FULL_SEEDS, full_configs, score, write_report
from challenge_train import ChallengeEnv


def result(success=1, collision=0, offroad=0, timeout=0, distance=0):
    return dict(success_rate=success, collision_rate=collision, offroad_rate=offroad,
                timeout_rate=timeout, mean_distance_to_goal=distance)


class CurriculumTests(unittest.TestCase):
    def test_promotion_requires_consecutive_safe_passes(self):
        c = Curriculum()
        self.assertFalse(c.assess(result()))
        self.assertFalse(c.assess(result(.8, .2)))
        self.assertEqual(c.streak, 0)
        self.assertFalse(c.assess(result(.8, .1)))
        self.assertTrue(c.assess(result(.8, .1)))
        self.assertEqual(c.stage, 1)
        self.assertEqual(Curriculum(**c.state()), c)
        c.stage = len(STAGES)-1
        for _ in range(4):
            self.assertFalse(c.assess(result()))
        self.assertEqual(c.stage, len(STAGES)-1)

    def test_review_sampling_and_holdout(self):
        c = Curriculum(stage=3)
        random = np.random.default_rng(42)
        sampled = [c.sample(random) for _ in range(10000)]
        self.assertEqual(set(sampled), {0, 1, 2, 3})
        self.assertTrue(.72 < sampled.count(3)/len(sampled) < .78)
        self.assertFalse(set(STAGE_SEEDS) & set(FULL_SEEDS))
        self.assertGreater(min(STAGE_SEEDS + FULL_SEEDS), 1_000_000_000)
        self.assertEqual(len(FULL_SEEDS), len(full_configs()))
        self.assertEqual(len(FULL_SEEDS), 40)
        self.assertEqual(sum(c.get('curriculumStage') == 1 for c in full_configs()), 10)
        self.assertEqual(sum(c.get('curriculumStage') == 5 for c in full_configs()), 10)

    def test_stage_change_applies_on_next_reset(self):
        c = Curriculum()
        env = ChallengeEnv(curriculum=c)
        try:
            _, info = env.reset(seed=42)
            self.assertEqual(info['curriculum_stage'], 0)
            c.stage = 2
            c.review_probability = 0
            _, info = env.reset(seed=43)
            self.assertEqual(info['curriculum_stage'], 2)
        finally:
            env.close()

    def test_success_outranks_waiting_and_report_is_offline(self):
        self.assertGreater(score(result(.1, .1)), score(result(0, 0, timeout=1, distance=60)))
        with tempfile.TemporaryDirectory() as path:
            run = Path(path)
            write_report(run, [dict(steps=0, stage_name='短途', promoted=False,
                                   stage=result(), full=result(0, timeout=1, distance=60))])
            self.assertIn('<svg', (run/'report.html').read_text(encoding='utf-8'))
            self.assertTrue((run/'metrics.json').exists())
