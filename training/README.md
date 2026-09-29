# 本机 CPU 训练

当前实现是 `straight-pass-v1`：空试车场中，在 30 秒内沿 6 米宽走廊前进 60 米并通过终点。初始位置和朝向有小幅随机扰动，整车离开走廊立即失败。**该课程不要求终点停车，不包含转弯、交通或城市驾驶**；它是训练接口和学习信号的最小验证，不是完整训练方案的交付。

Node 复用现有 `Simulation`、arena 世界与人工踏板物理；关闭自动驾驶、安全辅助、自动到达和重规划。每个策略步最多推进 4 × 0.025 秒，发生结束事件即停止。Python 模型为 PPO 两层 128 单元 MLP，固定尺度的 10 维观测，二维转向/纵向动作。全过程无渲染、无 Jev API 调用。

## 环境

已创建的专用环境：`jevpilot-rl`，位置 `D:\Python\conda_envs\jevpilot-rl`。不要在 base 环境中安装这些依赖。

如在另一台 Windows 电脑重建，在项目根目录运行：

```powershell
conda create -n jevpilot-rl python=3.11 pip -y
conda activate jevpilot-rl
python -m pip install --extra-index-url https://download.pytorch.org/whl/cpu -r training/requirements-lock.txt
```

Node.js 也须在 PATH 中。`requirements.txt` 固定核心依赖，`requirements-lock.txt` 是本机验证环境的完整 pip 版本清单。

## 开始训练

打开 Anaconda Prompt 或已初始化 Conda 的 PowerShell：

```powershell
cd D:\MyProjects\NodeProjects\jevpilot
conda activate jevpilot-rl
python training/train.py --steps 100000 --run-dir artifacts/rl/my-first-run
```

每次使用新的 `--run-dir`；已有目录不会被覆盖。默认单环境、CPU 单计算线程。`--envs 4` 或 `--envs 8` 使用 Windows spawn 多进程，每个环境拥有独立 Node 子进程；环境数更大不保证更快。

需要长跑时，可设置最多 8 小时或追加 1000 万策略步，先到者停止：

```powershell
python training/train.py --steps 10000000 --hours 8 --run-dir artifacts/rl/overnight-01
```

先确认短训练有学习信号。此命令只训练简单直路，不会自动升级课程；如果直路已稳定通过，应增加后续课程，而不是为了凑满一晚重复训练。训练步数会向完整 rollout（单环境 1024 步）取整。时间预算在完整更新之间检查，保存和考试也需要时间。

接通电源，在 Windows 电源设置中确认运行期间不会进入睡眠；可关闭屏幕。程序不修改系统电源设置。初次启动时需至少 2 GiB 剩余磁盘，训练中低于阈值会结束并尝试保存最终检查点。全部历史检查点保留，长跑注意磁盘空间。

## 检查点、停止和恢复

- 随机初始模型保存为 `step-0000000000`；默认每 25 次 PPO 更新保存一次，并在正常结束时保存。
- 每个版本包含 `policy.zip`（网络和优化器）、`manifest.json`（配置、源码哈希、规范）、`rng.json`、`evaluation.json` 和 `replay.json`。固定归一化定义在版本绑定的 JS 源码中，当前只有一个课程。
- `latest.json` 指向最近完整版本；`best.json` 按成功率、离路率、进度排序。评估为 20 个固定留出种子，属于验证集，不是最终泛化测试。
- `progress.csv` 保存 SB3 训练指标，终端显示步数、吞吐和评估结果。`status.json` 在结束或失败时记录状态。
- 在运行目录新建一个名为 `STOP`、无扩展名的空文件，即可在当前完整更新后停止并保存。按 Ctrl+C 是紧急中断，只保证上一个完整检查点可恢复。
- `replay.json` 是位姿数据，可用下方独立回放页观看；尚未接入游戏的三维观战界面。

恢复到新的运行目录，`--resume` 指向某个完整检查点目录（模型文件的上一级）：

```powershell
python training/train.py --resume artifacts/rl/my-first-run/step-0000100352 --steps 100000 --run-dir artifacts/rl/resumed-01
```

目录名以实际 `latest.json` 内容为准。恢复时 `--envs` 必须与原训练相同；代码版本必须匹配。恢复模型、优化器、累计步数以及 Python/NumPy/Torch 随机状态，从新回合开始；不恢复环境瞬时状态、各环境随机序列位置或未完成采样，不承诺逐步精确续训。

单独考试并生成回放数据：

```powershell
python training/evaluate.py artifacts/rl/my-first-run/step-0000100352
```

只加载自己生成且信任的 SB3 模型。

## 可视化观看训练效果

在项目根目录运行（参数是整次训练目录）：

```powershell
python scripts/rl/export-replay.py artifacts/rl/20260929-134945
```

将目录替换为你自己的运行目录。随后双击该目录生成的 `replay.html` 即可在浏览器观看，不需要重新训练、加载模型或连接网络。页面内嵌真实评估轨迹，支持训练前后同步播放、切换所有已保存阶段与共同验证场景、拖动时间、暂停及调速。

该回放是二维俯视展示，不是实时推理。结束后保持最后一帧，速度等指标也保持最后记录值，不表示模型已经停车。当前课程没有速度限制或停车要求，快速通过终点只说明通过了这个简单任务。

直接运行 `train.py` 会新建实验并从随机初始化开始，只有指定 `--resume` 才会接着已有模型训练。回放导出工具放在训练源码哈希范围之外，生成页面不会导致已有检查点失效。

## 验证

```powershell
node --test tests/rl-environment.test.js
python -m unittest discover -s training/tests -v
npm test
```

`tests/rl-environment.test.js` 位于已有测试匹配范围内，无需另设嵌套目录。训练产物在已忽略的 `artifacts/rl/` 中，Python 缓存也已忽略。
