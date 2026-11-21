---
name: frontend-design-implementation
version: 1.0.0
description: Implement a frontend interface from an approved DESIGN.md or mock with production quality and distinctive visual execution. Use for UI implementation, redesign, or polishing after the direction is decided.
description_zh: 按已确认的设计方向或 mock 实现生产级前端界面，避免通用 AI 审美。
user-invocable: false
---

# 前端设计实现

按已确认的 `DESIGN.md` 或 mock 实现界面。方向未确认时返回 `NEEDS_INPUT`，不自行选风格。若 `DESIGN.md` 来自 `design-styles/<slug>/DESIGN.md`，保留来源 slug 和上游链接；只调整与本项目内容和组件相关的 token，不擅自替换为另一种风格。

## 实现原则

1. 先读现有技术栈、组件库、路由、状态管理和样式方案，沿用项目模式，不引入未批准的框架或依赖。
2. 执行已确认方向，不夹带无关重构、全局改版或额外功能。
3. 字体、颜色、间距、圆角、阴影和动效通过变量或设计 token 统一表达；避免散落魔法值。
4. 排版要有明确层级；避免 Inter、Roboto、Arial 和系统默认字体，除非项目规范强制。
5. 配色要有一致的主色和锐利强调色；避免紫色渐变、无意义玻璃拟态和通用卡片堆叠。
6. 布局允许不对称、叠层、网格突破或大留白，但必须服务信息层级和可用性。
7. 动效只用于高价值时刻：首屏进入、状态变化、悬停和焦点；提供减少动效降级。
8. 完成正常、空、加载、错误、禁用、悬停、焦点和窄屏/宽屏状态。
9. 检查键盘操作、焦点可见性、对比度和语义结构；不删除已有无障碍能力。
10. 在真实浏览器或项目现有测试环境中自测，记录截图、交互结果和未验证项。

## 输出

返回主会话可直接展示的摘要：

- 已实现页面与对应设计规则
- 变更文件和关键组件
- 真实浏览器/测试证据
- 与设计方向的偏差及原因
- 未覆盖状态、风险和下一步

实现完成不等于独立验收或发布授权。
