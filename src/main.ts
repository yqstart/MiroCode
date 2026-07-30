import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import "./styles/global.css";

// 禁用 WebView 原生右键菜单；各处自定义菜单自行 preventDefault 后展示
document.addEventListener(
  "contextmenu",
  (event) => {
    event.preventDefault();
  },
  true,
);

const app = createApp(App);
app.use(createPinia());
app.mount("#app");
