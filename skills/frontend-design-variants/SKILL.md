---
name: frontend-design-variants
version: 1.0.0
description: Produce three genuinely distinct frontend design directions with tradeoffs and a recommendation. Use when the visual direction is not decided or the user asks for options before implementation.
description_zh: 产出三个真正不同的前端设计方向、取舍与推荐，供用户选择。
user-invocable: false
---

# 前端设计变体

在实现前提供可比较的设计方向。三个方案必须是概念层面的差异，不是同一页面的颜色或间距微调。

## 输入

- 需求、目标用户、品牌约束和交付终点
- 已有设计系统或组件库
- 必须满足的功能、性能和无障碍要求

## 生成规则

1. 给出三个方向，每个都有独立的概念名称和一句话主张。
2. 每个方向说明：
   - 视觉气质与适用场景
   - 标题/正文字体组合
   - 主色、背景、强调色和状态色
   - 布局签名（例如分栏、叠层、对角线、密集网格、超大留白）
   - 动效与背景处理
   - 优点、代价、实现复杂度和风险
3. 至少一个方向明显更克制，至少一个方向更大胆；不要三个都收敛到同一种安全风格。
4. 可用 HTML 或截图表达，但不要实现完整业务逻辑；原型只用于比较。
5. 按任务匹配度、差异度、可实现性和无障碍风险排序，推荐一个方向并说明理由。
6. 不直接向用户提问；把选项和推荐返回主会话，由主会话确认。

## 输出

返回主会话可直接展示的对比摘要：

- 三个方向的概念、关键视觉规则和取舍
- 推荐方向及理由
- 实现前仍需确认的品牌、内容或交互问题

选择未确认前，不进入正式实现。
