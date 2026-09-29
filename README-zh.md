# JevPilot 项目全景指南 (中文)

[English](README.md) | [中文说明](README-zh.md)

JevPilot 是一个融合了 **3D 网页端驾驶仿真** 与 **Python 强化学习 (Reinforcement Learning)** 的自动驾驶训练与评测系统。

项目既支持利用商业大模型 API（如 TypeSafe Jev / OpenRouter）进行决策驾驶，也支持基于开源强化学习（PyTorch + Stable-Baselines3 + Gymnasium）在本地通过 PPO 算法训练纯端到端的控制策略，并将训练好的策略导出回浏览器中进行 3D 实时避障与泊车驾驶。

---

## 目录

- [一、项目整体架构](#一项目整体架构)
- [二、两套训练体系与进化阶段](#二两套训练体系与进化阶段)
  - [阶段一：直路通行基准 (`train.py`)](#阶段一直路通行基准-trainpy)
  - [阶段二：障碍挑战与自动课程训练 (`challenge_train.py`)](#阶段二障碍挑战与自动课程训练-challenge_trainpy)
- [三、环境准备与安装](#三环境准备与安装)
- [四、快速上手与训练运行](#四快速上手与训练运行)
  - [4.1 启动基础直道训练](#41-启动基础直道训练)
  - [4.2 启动障碍与自动课程训练（推荐）](#42-启动障碍与自动课程训练推荐)
  - [4.3 训练过程监控与早停](#43-训练过程监控与早停)
- [五、可视化与评测](#五可视化与评测)
  - [5.1 浏览器 3D 实验室实车测试](#51-浏览器-3d-实验室实车测试)
  - [5.2 离线 2D 轨迹回放](#52-离线-2d-轨迹回放)
  - [5.3 训练曲线报表 (`report.html`)](#53-训练曲线报表-reporthtml)
- [六、检查点机制与断点续训](#六检查点机制与断点续训)
- [七、常见疑问与经验沉淀 (FAQ)](#七常见疑问与经验沉淀-faq)

---

## 一、项目整体架构

JevPilot 采用了独特的**「前后端桥接、双语协作」**架构：

```mermaid
flowchart LR
    subgraph Python 端 [Python 强化学习端 (Gymnasium + SB3)]
        EnvBridge[JevPilotEnv / ChallengeEnv]
        PPOModel[PPO Policy MLP]
        Curriculum[Curriculum 课程控制器]
    end

    subgraph Node 通信桥梁 [JSON-RPC over stdin/stdout]
        Protocol[env-server / challenge-server]
    end

    subgraph 前端与仿真核心 [Web / Node.js (Three.js 核心仿真)]
        Simulation[Simulation 物理与运动学]
        Road[RoadGeometry 道路与网格]
        Actors[障碍物、行人、交通流]
        Browser3D[3D 实验页面 challenge-lab.html]
    end

    PPOModel --> EnvBridge
    EnvBridge <--> Protocol
    Protocol <--> Simulation
    Simulation --> Road
    Simulation --> Actors
    PPOModel -.导出 policy.json.-> Browser3D
```

1. **底层物理与仿真 (`src/`)**：使用 JavaScript 编写的真实车辆运动学、刚体碰撞检测与道路边界计算，既可以在浏览器中以 60 FPS 渲染 3D 场景，也可以在 Node.js 中以无头（Headless）极速运行。
2. **通信协议桥 (`scripts/rl/`)**：通过 Node.js 子进程启动持久化环境服务，与 Python 端通过 `stdin/stdout` 以单行 JSON-RPC 格式进行毫秒级状态和动作交互。
3. **算法与训练系统 (`training/`)**：基于 PyTorch 和 Stable-Baselines3 实现 PPO 策略训练、多进程向量化采样、断点恢复校验及自动化课程调度。

---

## 二、两套训练体系与进化阶段

项目中目前包含两个不同阶段的强化学习实现：

### 阶段一：直路通行基准 (`train.py`)
- **规范协议**：`straight-pass-v1`
- **任务目标**：空试车场中，车辆在 30 秒内沿着 6 米宽走廊向前行驶 60 米并通过终点线（**不要求停车**，只求快速稳定通过）。
- **观测空间 (10 维)**：
  - 横向误差偏差、航向角 sin/cos、车速比率、转向进度与轮胎转角、剩余距离比率、剩余时间比率、上一决策动作（方向盘与踏板）。
- **动作空间 (2 维连续)**：`[-1, 1]` 范围：
  - `action[0]`：方向盘转角（-1 左满舵 ~ +1 右满舵）
  - `action[1]`：油门/刹车（>0 施加油门，<0 施加刹车）
- **核心奖惩**：
  - 进度奖励：`+0.2 × 前进米数`
  - 时间惩罚：`-0.05 × 消耗秒数`
  - 抖动惩罚：`-0.02 × 动作变化量平方和`
  - 终局大奖：成功 `+20`，出界/碰撞/超时 `-20`。

### 阶段二：障碍挑战与自动课程训练 (`challenge_train.py`)
- **规范协议**：`challenge-structured-v1`
- **任务目标**：在真实三维游戏场景中绕过静止/移动障碍车，并**精确在终点线前减速停车**（要求距终点 < 3 米且车速 < 1 m/s）。
- **观测空间 (96 维)**：包含自车状态、终点相对位姿、前方预瞄采样点、最多 8 个周围交通参与者/障碍物的几何尺寸、相对坐标、速度及有效掩码位。
- **内置课程学习 (Curriculum)**：
  - **Stage 1**：无障碍短途直行，15~25 米到达并平稳减速停车（30秒）。
  - **Stage 2**：中途 35~45 米，障碍偏离主路线（轻微避让，45秒）。
  - **Stage 3**：60 米完整距离，障碍正挡在车道中央，必须主动变道绕行后回道停车。
  - **Stage 4**：起点沿路线随机偏移 0~15 米，总距离 45~70 米，障碍位置动态变化。
- **晋级机制**：在 10 个固定留出种子上，**连续两次评测成功率 ≥80% 且事故率 ≤10%** 方可晋升下一阶段；晋级后依然保留 25% 概率抽查旧阶段防止遗忘。

---

## 三、环境准备与安装

### 1. 前端与 Node.js 环境
- 确保系统安装了 **Node.js (>= 18)**，且在系统环境变量 `PATH` 中。
- 在项目根目录下安装依赖：
  ```bash
  npm install
  ```

### 2. Python 强化学习环境
推荐使用 Conda 独立环境（避免与系统的其他 Python 包污染）：

```powershell
# 1. 创建专用虚拟环境
conda create -n jevpilot-rl python=3.11 pip -y
conda activate jevpilot-rl

# 2. 安装 PyTorch CPU 版与强化学习核心依赖
python -m pip install --extra-index-url https://download.pytorch.org/whl/cpu -r training/requirements-lock.txt
```

---

## 四、快速上手与训练运行

### 4.1 启动基础直道训练
适合用于验证整套环境管道是否连通：

```powershell
conda activate jevpilot-rl
python training/train.py --steps 100000 --run-dir artifacts/rl/my-straight-run
```
- `--steps`：训练总步数（默认 100,000）。
- `--envs`：并发环境数量（可选 1, 4, 8，默认为 1）。
- `--save-updates`：每多少次 PPO 更新（每次 1024 步）保存一次检查点（默认 25 次，即 25,600 步）。

### 4.2 启动障碍与自动课程训练（推荐）
进行具备避障与减速停车能力的进阶训练：

```powershell
conda activate jevpilot-rl
python training/challenge_train.py --steps 200000 --run-dir artifacts/rl/my-curriculum-01
```
- `--hours 8`：设置最长运行墙钟时间（例如最多跑 8 小时）。
- `--eval-updates 10`：每 10 次更新触发一次课程考核与模型保存。
- `--challenge <path.json>`：关闭自动课程，针对编辑器自定义导出的固定场景进行特训。

### 4.3 训练过程监控与早停
- **安全停止**：在运行目录（如 `artifacts/rl/my-curriculum-01/`）内新建一个名为 **`STOP`**（无后缀）的空文件，训练程序会在执行完当前完整的 update 和保存后优雅退出。
- **磁盘保护**：程序自带保护机制，当磁盘剩余空间小于 2 GiB 时，会自动停止并保存最后的 checkpoint。

---

## 五、可视化与评测

### 5.1 浏览器 3D 实验室实车测试
项目支持将 Python 训练好的策略直接转换为纯数学权重 JSON，在真实的 3D 网页里加载运行：

1. 启动本地开发服务器：
   ```bash
   npm run dev
   ```
2. 在浏览器打开：`http://localhost:5173/challenge-lab.html`
3. 在页面左侧点击**“选择策略”**，选中对应 checkpoint 目录下的 `policy.json`。
4. 页面通过内置的 Python 动作样本（Float 精度对比）校验后，点击**“开始驾驶”**，即可第一人称/第三人称观察智能体在真实的 3D 赛道上起步、避让障碍并减速停车！

### 5.2 离线 2D 轨迹回放
针对 `train.py` 的直道模型，可直接离线导出轻量级 HTML 回放：

```powershell
python scripts/rl/export-replay.py artifacts/rl/<你的训练目录名>
```
运行后双击该目录生成的 `replay.html`，即可在浏览器任意拖动时间轴、观察转向与速度曲线。

### 5.3 训练曲线报表 (`report.html`)
对于 `challenge_train.py` 课程训练，运行目录下会自动生成并动态更新 `report.html`：
- 支持直观展示各个课程阶段的成功率、碰撞率、出界率与距终点平均距离曲线。
- 刷新页面即可实时追踪当前模型的成长进度。

---

## 六、检查点机制与断点续训

每次保存的模型目录结构如下：
```text
artifacts/rl/<run-dir>/
├── config.json              # 训练入参与超参数
├── latest.json              # 指向最近一次完整保存的 checkpoint
├── best.json                # 指向当前全科目评测表现最佳的 checkpoint
├── report.html              # 训练成绩曲线动态网页 (课程训练特有)
└── step-0000025600/         # 具体某一步的 checkpoint 目录
    ├── policy.zip           # 完整 PyTorch + SB3 优化器文件 (用于断点续训)
    ├── policy.json          # 纯静态 Actor 权重与动作校验样例 (用于网页 3D 推理)
    ├── manifest.json        # 源码哈希、观测规范与时间戳元数据
    ├── evaluation.json      # 固定留出种子评测报告
    ├── rng.json             # Python/NumPy/Torch 随机种子状态
    └── replay.json          # 轨迹回放数据
```

如需在已有权重上追加训练：
```powershell
python training/challenge_train.py \
  --resume artifacts/rl/my-curriculum-01/step-0000102400 \
  --steps 100000 \
  --run-dir artifacts/rl/my-curriculum-02
```
> **注意**：断点续训要求代码版本的 `source_hash` 以及 `--envs` 完全一致，以确保实验环境严谨对齐。

---

## 七、常见疑问与经验沉淀 (FAQ)

### Q1：为什么 10 万步感觉几十秒到一两分钟就跑完了？
- 这里的“步数（Steps）”是**强化学习环境交互步（Timesteps）**，单环境每次推进 0.1 秒模拟时间。
- 因为底层模拟器是在无头（Headless）Node 进程中剥离了 3D 渲染，且 PPO MLP 网络只有两层 128 单元，在 CPU 上的矩阵乘法计算极快。10 万步在单核下仅需执行约 98 次小批量梯度更新，属于极轻量级的基准测试。

### Q2：为什么模型训练了一阵，事故率很低（0% 碰撞），但成功率依然是 0%？
- 这往往是强化学习中的**「消极保守策略」**：模型发现一往前冲很容易撞车或出界被扣 20 分，于是学会了原地踩刹车不走，直到 30/45 秒超时。
- 解决此问题正是引入**课程学习（Curriculum）**的初衷：先从 15 米无障碍的 Stage 1 练起，让模型先尝到“到达终点停住能拿大奖”的正反馈，再逐步增加绕障难度。

### Q3：为什么直道的 checkpoint 无法在网页 3D 实验页面中加载？
- 两个阶段的协议规范不同：直道是 `straight-pass-v1`（10 维输入），而障碍挑战赛是 `challenge-structured-v1`（96 维输入）。
- 网页 3D 实验室带有严格的模型契约校验机制，如果观测维度或权重尺寸不匹配会明确提示拒绝加载，防止错误的推理导致不可预期的异常。
