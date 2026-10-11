import React from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/noto-sans-tc/400.css";
import "@fontsource/noto-sans-tc/600.css";
import "@fontsource/barlow/500.css";
import "@fontsource/barlow/700.css";
import "./style.css";
import "./desk.css";
import "./login.css";
import { App } from "./App";
import { StatusPage } from "./StatusPage";
import { AccessPage } from "./AccessPage";
const page =
  location.pathname === "/status" ? (
    <StatusPage />
  ) : ["/console", "/admin"].includes(location.pathname) ? (
    <App />
  ) : (
    <AccessPage />
  );
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>{page}</React.StrictMode>,
);
