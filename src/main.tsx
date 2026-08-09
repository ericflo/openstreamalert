import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Studio } from "./studio/Studio";
import { OverlayPage } from "./overlay/OverlayPage";
import "./styles.css";

const isOverlay = window.location.pathname.startsWith("/overlay/");
document.documentElement.dataset.route = isOverlay ? "overlay" : "studio";

createRoot(document.getElementById("root")!).render(
  <StrictMode>{isOverlay ? <OverlayPage /> : <Studio />}</StrictMode>,
);
