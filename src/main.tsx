import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Studio } from "./studio/Studio";
import { OverlayPage } from "./overlay/OverlayPage";
import { DeviceAuth } from "./studio/DeviceAuth";
import "./styles.css";

const isOverlay = window.location.pathname.includes("/overlay/");
const isDeviceAuth = window.location.pathname === "/auth/device";
document.documentElement.dataset.route = isOverlay
  ? "overlay"
  : isDeviceAuth
    ? "device"
    : "studio";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {isOverlay ? <OverlayPage /> : isDeviceAuth ? <DeviceAuth /> : <Studio />}
  </StrictMode>,
);
