import "./polyfills";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { MotionConfig } from "framer-motion";
import { RootGate } from "./app/RootGate";
import { ConsoleProvider } from "./lib/store";
import { ToastProvider } from "./ui/primitives";
import "./index.css";

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <MotionConfig reducedMotion="user">
        <BrowserRouter>
          <ConsoleProvider>
            <ToastProvider>
              <RootGate />
            </ToastProvider>
          </ConsoleProvider>
        </BrowserRouter>
      </MotionConfig>
    </StrictMode>,
  );
}
