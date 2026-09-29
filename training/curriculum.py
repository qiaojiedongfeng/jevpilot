"""Serializable curriculum and offline assessment report (no model dependencies)."""
import html
from dataclasses import asdict, dataclass
import json

STAGES = ['短距离到达停车', '越过终点后倒车停车', '偏离路线的障碍', '挡路障碍绕行', '变化起终点和障碍', '80～200米长距离停车']
STAGE_SEEDS = tuple(range(2_100_000_000, 2_100_000_010))
FULL_SEEDS = (tuple(range(2_000_000_000, 2_000_000_010)) + tuple(range(2_200_000_000, 2_200_000_010))
              + tuple(range(2_300_000_000, 2_300_000_010)) + tuple(range(2_400_000_000, 2_400_000_010)))


@dataclass
class Curriculum:
    stage: int = 0
    streak: int = 0
    review_probability: float = .25

    def sample(self, random):
        if self.stage and random.random() < self.review_probability:
            return int(random.integers(0, self.stage))
        return self.stage

    def assess(self, result):
        passed = result['success_rate'] >= .8 and result['collision_rate'] + result['offroad_rate'] <= .1
        self.streak = self.streak + 1 if passed else 0
        if self.streak >= 2 and self.stage < len(STAGES) - 1:
            self.stage += 1
            self.streak = 0
            return True
        return False

    def state(self):
        return asdict(self)


def full_configs():
    # Balanced legacy layouts plus mandatory blocking, variable start/goal layouts.
    # Explicit held-out seeds: never sampled by the training environment.
    return [{}] * 10 + [dict(curriculumStage=4)] * 10 + [dict(curriculumStage=1)] * 10 + [dict(curriculumStage=5)] * 10


def score(result):
    return (result['success_rate'], -(result['collision_rate'] + result['offroad_rate']),
            -result['timeout_rate'], -result['mean_distance_to_goal'])


def write_report(run, history):
    """Self-contained SVG: works from file:// without network or JS dependencies."""
    pending = run / '.metrics.tmp'
    pending.write_text(json.dumps(history, ensure_ascii=False, indent=2), encoding='utf-8')
    pending.replace(run / 'metrics.json')
    panels = []
    colors = ['#16803c', '#ce3333', '#d48600', '#7044bb']
    for group, title in [('full', '固定完整挑战（用于选择最佳模型）'), ('stage', '当前阶段考试（晋级后难度改变）')]:
        charts = [(['success_rate', 'collision_rate', 'timeout_rate', 'offroad_rate'], '比例'), (['mean_distance_to_goal'], '距终点 / m')]
        if group == 'full' and all('reverse_success_rate' in row[group] and 'long_success_rate' in row[group] for row in history):
            charts.append((['reverse_success_rate', 'long_success_rate'], '比例'))
        for keys, label in charts:
            ceiling = 1 if label == '比例' else max(1, max(row[group][keys[0]] for row in history))
            first, last = history[0]['steps'], history[-1]['steps']
            lines = []
            for i, key in enumerate(keys):
                points = ' '.join(f'{55 + 690 * (r["steps"] - first) / max(1, last-first):.1f},{220 - 180 * r[group][key] / ceiling:.1f}' for r in history)
                lines.append(f'<polyline fill="none" stroke="{colors[i]}" stroke-width="3" points="{points}"/>')
                for r in history:
                    x = 55 + 690 * (r['steps'] - first) / max(1, last-first)
                    y = 220 - 180 * r[group][key] / ceiling
                    lines.append(f'<circle cx="{x}" cy="{y}" r="3" fill="{colors[i]}"><title>{r["steps"]}: {key}={r[group][key]:.3f}</title></circle>')
            legend = ' · '.join(f'<span style="color:{colors[i]}">{html.escape(k)}</span>' for i, k in enumerate(keys))
            panels.append(f'<h2>{title}：{label}</h2><p>{legend}</p><svg viewBox="0 0 800 260"><path d="M55 30V220H750" fill="none" stroke="#888"/><text x="5" y="45">{ceiling:.1f}</text><text x="20" y="220">0</text><text x="55" y="250">{first}</text><text x="660" y="250">{last} 步</text>{"".join(lines)}</svg>')
    rows = ''.join(f'<tr><td>{r["steps"]}</td><td>{html.escape(r["stage_name"])}</td><td>{r["full"]["success_rate"]:.0%}</td><td>{r["full"]["mean_distance_to_goal"]:.2f}</td><td>{"晋级" if r["promoted"] else "—"}</td></tr>' for r in history)
    document = f'<!doctype html><meta charset="utf-8"><title>驾驶课程训练成绩</title><style>body{{max-width:960px;margin:40px auto;font:16px system-ui;padding:20px;color:#243247}}svg{{width:100%;background:#f5f7fa}}td,th{{padding:10px;border-bottom:1px solid #ddd;text-align:left}}</style><h1>驾驶课程训练成绩</h1><p>重新打开或刷新以查看最新保存结果。成功必须到达并停车；低事故率不能代替成功率。固定挑战用于验证和模型选择，不是最终独立测试。</p>{"".join(panels)}<table><tr><th>步数</th><th>本次考试阶段</th><th>完整挑战成功率</th><th>距终点 m</th><th>结果</th></tr>{rows}</table>'
    pending = run / '.report.tmp'
    pending.write_text(document, encoding='utf-8')
    pending.replace(run / 'report.html')
