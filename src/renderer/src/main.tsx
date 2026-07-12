import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { Nudge } from "./components/Nudge";
import "./styles.css";

const isNudge = window.location.hash === "#nudge";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>{isNudge ? <Nudge /> : <App />}</React.StrictMode>,
);
