---
name: V2T
description: 常驻桌面语音输入工具的克制生产力界面规范
colors:
  bg: "#f6f4ef"
  surface: "#fffaf0"
  soft: "#eeebe3"
  text: "#1f2724"
  muted: "#65706b"
  border: "#d9d5cc"
  control: "#eeebe3"
  success: "#2d6a4f"
  error: "#9a2d25"
  dark-bg: "#151916"
  dark-surface: "#1d231f"
  dark-control: "#222a25"
  dark-text: "#edf2ea"
typography:
  title:
    fontSize: 34px
    fontWeight: 750
    lineHeight: 1.08
  section:
    fontSize: 15px
    fontWeight: 700
    lineHeight: 1.35
  body:
    fontSize: 13px
    fontWeight: 500
    lineHeight: 1.45
  meta:
    fontSize: 11px
    fontWeight: 500
    lineHeight: 1.35
spacing:
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 22px
rounded:
  control: 6px
  panel: 8px
components:
  button-primary:
    height: 36px
    padding: 12px
    backgroundColor: "{colors.text}"
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
  button-secondary:
    height: 36px
    padding: 12px
    backgroundColor: "{colors.control}"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
  button-danger:
    height: 36px
    padding: 12px
    textColor: "{colors.error}"
    rounded: "{rounded.control}"
  setting-strip:
    height: 36px
    padding: 12px
    backgroundColor: "{colors.control}"
    rounded: "{rounded.control}"
  choice-group:
    height: 30px
    itemMinWidth: 74px
    gap: "{spacing.xs}"
    rounded: "{rounded.control}"
  history-text:
    fontSize: "{typography.body.fontSize}"
    lineHeight: 1.5
  dense-table:
    rowGap: "{spacing.sm}"
    columnGap: "{spacing.md}"
  badge:
    height: 20px
    rounded: 999px
  tab:
    height: 34px
    rounded: "{rounded.control}"
---

# V2T Design Guidelines

V2T 是常驻桌面工具，不是营销页面。界面目标是安静、清晰、稳定：用户应能快速判断当前状态、模型、路径和下一步操作。

## Visual Thesis

- 克制的桌面生产力风格：低装饰、强层级、清楚状态。
- 信息密度可以高，但区域边界、间距和按钮尺寸必须统一。
- 只保留一个主强调色，用于主要动作、选中态和成功状态；错误状态使用独立红色。

## Layout

- 左侧导航固定，右侧内容按页面滚动。
- 页面用标题、说明、分隔线和表格组织，不堆叠大面积卡片。
- 同类操作放在同一条工具栏；按钮不应随机换行。窄窗口下优先让区域换行，而不是截断按钮文本。
- 表格如果内容宽，使用整表横向滚动，不允许单行独立右滑。

## Components

- 按钮统一高度、边框、圆角和文字重量。主要操作用 `primary / save`，次要操作用 `secondary`，破坏性操作用 `danger`；新增页面不要写局部 `button` 覆盖。
- 同一组按钮放入 `action-toolbar` 或等价工具条；工具条统一 gap、字号和按钮高度，窄窗口下由容器换行而不是让按钮文本被截断。
- 按钮变体只保留 `primary / secondary / danger`，需要更小尺寸时叠加 `compact`，需要铺满容器时叠加 `full-width`。
- 标题、说明、状态、按钮文字必须使用固定层级：标题 15px/700，正文说明 13px/500，状态和路径 11-12px/500，按钮 13px/650；不要用随机加粗或字号变化表达同一类信息。
- 全局 button 不强制 nowrap；只有工具条按钮、紧凑按钮和分页按钮可以保持单行。
- 说明型按钮卡片必须允许换行，长模型名、URL 和 API 名称应在卡片内自然换行或截断，不得撑破布局。
- 同一设置区内 checkbox、segmented control 和诊断按钮必须使用统一高度、圆角和工具条间距；不要把不同语义控件硬塞进一条杂乱横排。
- 短选项组使用扁平 `choice-group`，不要做“大框里套小按钮”的控件。label 独立在左侧，选项按钮同高同宽。
- 历史正文、统计表和词库编辑器属于高频扫描区域，使用 body/meta 字号和稳定行高，不要用页面正文的大号展示。
- 标签用于表达状态和能力，不承载长句说明。
- 进度展示用百分比、阶段、速度和 ETA，不使用看起来可拖动的 slider。
- 设置项使用紧凑 checkbox；输入框和按钮之间保持稳定间距。
- 只在交互对象本身需要承载状态时使用卡片；普通说明区域用 plain section。

## Dark Mode

- 未选中 tab、engine card、badge、表格文字必须保持可读，不能继承黑色文字。
- 边框只用于结构，不用厚重描边制造老式窗口感。
- 红/绿状态色只用于状态点、错误、成功提示，不铺满大区域。

## Copy

- 使用工具型文案：说明范围、状态、风险和下一步。
- 避免长段介绍模型能力；优先使用短标签和可展开详情。
- 对隐私和云端发送文字的提示必须明确，但不要重复出现在每个按钮旁。
