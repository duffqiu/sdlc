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

## 选择内置样式

用户未指定品牌或视觉风格时，先读取插件根目录的 `design-styles/index.json`（相对本 Skill 为 `../../design-styles/index.json`），不要凭空生成方向：

1. 按任务从四个视觉气质中推荐一个：`tech`（技术／产品感）、`minimal`（简洁／效率感）、`creative`（创意／视觉感）、`expressive`（大胆／品牌感）；行业分类只作为元数据，不作为一级选择。
2. 在类别内按任务相关性选 3–4 个风格，每个给出名称、slug、气质、适用场景、取舍和预览链接。
3. 返回 `NEEDS_INPUT` 给主会话，由主会话用 AskMe 分两层让用户选择；本会话不直接调用 AskMe，也不一次列出全部 84 个样式。
4. 用户给出品牌名、slug 或参考网站时直接匹配；选中项为 `bundled: true` 时读取对应 `design-styles/<slug>/DESIGN.md`，未内置时交主会话确认后再获取。
5. 选中后以该 `DESIGN.md` 为基线，结合本项目内容调整 token 和规则；记录来源 slug 和上游链接，不把上游预览页当成已审核的项目规范。

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
