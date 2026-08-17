// ==================== Vue 指令 custom data（HTML 语言服务用） ====================
// 以 HTMLDataV1.globalAttributes 形态注入 Vue 特有指令，使 vscode-html-languageservice
// 在 Vue template 上下文给出 v-if / v-for / v-model / :bind / @event 等指令补全。
// 纯数据、零依赖，便于直测与独立维护。

import type { HTMLDataV1, IAttributeData, ITagData } from "vscode-html-languageservice";

/** Vue 指令（globalAttributes 注入，任意标签可用） */
export const VUE_GLOBAL_ATTRIBUTES: IAttributeData[] = [
  { name: "v-if", description: "条件渲染：元素仅当表达式为真时渲染" },
  { name: "v-else-if", description: "v-if 链式条件分支" },
  { name: "v-else", description: "v-if 链的最终分支（无表达式）" },
  { name: "v-for", description: "列表渲染：`item in items` / `(item, index) in items`" },
  {
    name: "v-model",
    description: "双向绑定表单控件",
    values: [
      { name: "v-model", description: "默认绑定 value + input 事件" },
      { name: "v-model.trim", description: "自动去除首尾空白" },
      { name: "v-model.number", description: "自动转数字" },
      { name: "v-model.lazy", description: "change 事件时同步" },
    ],
  },
  { name: "v-bind", description: "动态绑定属性：`:attr=\"expr\"` 简写" },
  { name: "v-on", description: "绑定事件监听：`@click=\"handler\"` 简写" },
  { name: "v-show", description: "切换 display 显隐（元素始终渲染）" },
  { name: "v-html", description: "渲染 HTML 字符串（注意 XSS）" },
  { name: "v-text", description: "渲染文本内容" },
  { name: "v-slot", description: "具名插槽：`v-slot:name` / `#name` 简写" },
  { name: "v-pre", description: "跳过编译，原样输出（无表达式）" },
  { name: "v-cloak", description: "编译完成前隐藏元素（无表达式）" },
  { name: "v-once", description: "只渲染一次（无表达式）" },
  { name: "v-memo", description: "记忆渲染：依赖数组不变则跳过" },
  { name: "v-loading", description: "（VueUse）加载态指令" },
  { name: "ref", description: "模板引用：`ref=\"el\"`，setup 中 `const el = ref()`" },
  { name: "key", description: "列表 diff 标识 / 组件复用控制" },
  { name: "is", description: "动态组件：`<component :is=\"...\">`" },
  { name: "slot", description: "具名插槽（2.x 风格）" },
  // v-bind 简写与 v-on 简写（`:xxx` / `@xxx` 形态由语言服务按前缀处理，
  // 此处补齐以冒号/@ 开头的最小描述，帮助自动触发）
  { name: ":", description: "v-bind 简写：`:attr=\"expr\"`" },
  { name: "@", description: "v-on 简写：`@event=\"handler\"`" },
  { name: "#", description: "v-slot 简写：`#name`" },
];

/** Vue 特有元素（模板根组件常用） */
export const VUE_GLOBAL_TAGS: ITagData[] = [
  { name: "component", description: "动态组件容器（配合 :is）", attributes: [] },
  { name: "transition", description: "单元素/组件过渡", attributes: [] },
  { name: "transition-group", description: "列表过渡", attributes: [] },
  { name: "keep-alive", description: "组件缓存", attributes: [] },
  { name: "teleport", description: "传送门：渲染到指定 DOM 节点", attributes: [] },
  { name: "suspense", description: "异步依赖的协调容器", attributes: [] },
  { name: "slot", description: "插槽出口", attributes: [] },
  { name: "template", description: "模板分组（不渲染 DOM）", attributes: [] },
];

/** 组装 HTMLDataV1（供 newHTMLDataProvider 使用） */
export function buildVueHtmlData(): HTMLDataV1 {
  return {
    version: 1,
    tags: VUE_GLOBAL_TAGS,
    globalAttributes: VUE_GLOBAL_ATTRIBUTES,
  };
}
