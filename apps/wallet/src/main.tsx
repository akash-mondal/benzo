// MUST be first: sets the Node `Buffer` global the Stellar SDK expects, before
// any SDK-importing module is evaluated. (A body statement here would run too
// late — ES modules evaluate all imports before the module body.)
import "./polyfills";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { MotionConfig } from "framer-motion";
import { App } from "./App";
import { WalletProvider } from "./lib/store";
import { ToastProvider } from "./ui/primitives";
import "./index.css";

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      {/* MotionConfig respects the OS reduced-motion setting app-wide. */}
      <MotionConfig reducedMotion="user">
        <BrowserRouter>
          <WalletProvider>
            <ToastProvider>
              <App />
            </ToastProvider>
          </WalletProvider>
        </BrowserRouter>
      </MotionConfig>
    </StrictMode>,
  );
}
