// Renderer entry point: styles first, then the application controller.
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/components.css";
import { startApp } from "./ui/app";

const root = document.getElementById("app");
if (!root) throw new Error("Missing #app element in index.html");
void startApp(root);
