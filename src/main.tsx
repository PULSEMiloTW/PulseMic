import React from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/noto-sans-tc/400.css";
import "@fontsource/noto-sans-tc/600.css";
import "@fontsource/barlow/500.css";
import "@fontsource/barlow/700.css";
import "./style.css";
import { App } from "./App";
import { AccessPage } from "./AccessPage";
const gated =
  location.pathname === "/output" ||
  location.pathname === "/caster-output" ||
  (location.hostname === "mic.pulse-studio.live" &&
    location.pathname !== "/console");
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>{gated ? <AccessPage /> : <App />}</React.StrictMode>,
);
