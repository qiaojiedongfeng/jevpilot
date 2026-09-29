# 本机 CPU 最小训练闭环实施计划

**Goal:** 在独立 Conda 环境中跑通现有驾驶物理的直路 PPO 训练，并提供可恢复的夜间训练入口。

**Architecture:** Node 持久子进程复用 Simulation 的 arena 场景与人工踏板物理；Python Gymnasium 适配器提供 PPO 所需接口。首个课程仅学习沿直路通过终点，不包含终点停车、交通和城市驾驶；使用独立版本号，不能冒充完整方案的 structured-v1。

**Tech Stack:** Windows、Conda Python 3.11、Node.js、PyTorch CPU、Gymnasium、Stable-Baselines3。

1. 创建 jevpilot-rl 环境和固定依赖清单，验证导入及 CPU 设备。
2. 新增 src/rl/environment.js 与 scripts/rl/env-server.mjs。测试种子确定性、动作、时间步、越界终止和非法输入。
3. 新增 training/jevpilot_env.py。用 Gym 检查器验证契约，并测试子进程异常及清理。
4. 新增训练/评估入口。保存随机初始模型、检查点、配置、源文件哈希和固定考试；支持新回合恢复、时间预算和停止文件。
5. 跑原项目回归与短训练，报告真实验证成绩和吞吐，不承诺学习效果。提供本机启动说明，整晚训练由用户按需启动。

首版实现不改原游戏控制路径；训练中无渲染、无 Jev 调用。检查点在完整 PPO 更新后发布，用户中断保留上一个完整检查点。训练及验证种子分区，固定考试为验证集，不作为最终泛化测试。
