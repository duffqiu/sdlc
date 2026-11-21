---
name: frontend-design-direction
version: 1.0.0
description: Define a distinctive visual direction and DESIGN.md for a frontend task. Use when starting UI work, choosing typography, palette, layout, motion, or preventing generic AI aesthetics.
description_zh: 为前端任务定义鲜明的视觉方向与 DESIGN.md，避免通用 AI 审美。
user-invocable: false
---

# 前端设计方向

把已确认的需求转成一份可直接约束实现和验收的 `DESIGN.md`。目标是选择并有意识地执行一个方向，而不是堆叠所有流行效果。

## 输入

- 需求、目标用户、使用场景和成功标准
- 技术栈、已有组件库、品牌规范和性能/无障碍约束
- 已有页面或设计系统；没有时明确说明

缺少会影响方向的关键信息时，返回 `NEEDS_INPUT` 给主会话，不自行假设品牌或受众。

## 工作步骤

1. 用一句话写清界面要解决的问题、主要用户和交付终点。
2. 选择一个明确方向，例如极简、编辑感、工业感、复古未来、柔和自然、奢华、玩具感、粗野主义；说明为什么适合本任务。
3. 定义视觉系统：
   - 标题与正文字体，避免 Inter、Roboto、Arial 和系统默认字体；说明备选与回退。
   - 主色、辅色、背景、文字和状态色，用 CSS 变量表达；避免紫色渐变等通用 AI 配色。
   - 间距、栅格、圆角、边框、阴影和层级规则。
   - 动效原则：只保留高价值过渡，说明触发、时长和降级。
   - 背景与纹理：网格、噪点、渐变、分层透明或留白，必须服务于方向。
4. 明确组件约束：按钮、输入、卡片、导航、空状态、错误状态和加载状态。
5. 明确无障碍与响应式底线：对比度、键盘操作、焦点、减少动效、窄屏和宽屏行为。
6. 写清非目标和不采用的风格，防止实现阶段自行扩展。

## 输出

返回主会话可直接展示的摘要，并交付 `DESIGN.md` 或完整内容：

- 设计概念与理由
- 字体、配色、间距、动效和背景规则
- 组件与状态规则
- 响应式与无障碍底线
- 非目标与待确认项

`DESIGN.md` 只描述方向和约束，不替代实现、验收或发布授权。
