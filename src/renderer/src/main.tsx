import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { Nudge } from "./components/Nudge";
import "./styles.css";

const requestedTheme = new URLSearchParams(window.location.search).get("theme");
if (["system", "light", "dark"].includes(requestedTheme ?? "")) {
  document.documentElement.dataset.theme = requestedTheme!;
}

const isNudge = window.location.hash === "#nudge";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>{isNudge ? <Nudge /> : <App />}</React.StrictMode>,
);
