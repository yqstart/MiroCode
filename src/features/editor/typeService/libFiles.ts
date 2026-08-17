// ==================== TypeScript 标准库内嵌（独立 chunk，类型服务启用时才加载） ====================
// 浏览器无磁盘 typescript/lib，vite ?raw 打包为字符串注入程序。
// 单独文件使 vite 拆独立 chunk，避免 3MB 文本进主包。
import libEs2022 from "typescript/lib/lib.es2022.d.ts?raw";
import libDom from "typescript/lib/lib.dom.d.ts?raw";

export const LIB_FILES: Array<{ path: string; content: string }> = [
  { path: "lib.es2022.d.ts", content: libEs2022 },
  { path: "lib.dom.d.ts", content: libDom },
];
