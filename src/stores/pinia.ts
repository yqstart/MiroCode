import { createPinia } from "pinia";

/** 供非组件上下文（如 appUpdate 异步检查）安全访问 store */
export const pinia = createPinia();
