import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App.js";
import "./styles.css";

const root = document.querySelector<HTMLDivElement>("#root");

if (!root) {
  throw new Error("找不到 Web 应用挂载节点 #root");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
