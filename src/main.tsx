import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import "./fonts.css";
import "@material/web/button/filled-button.js";
import "@material/web/button/filled-tonal-button.js";
import "@material/web/button/outlined-button.js";
import "@material/web/button/text-button.js";
import "@material/web/dialog/dialog.js";
import { MotionConfig } from "motion/react";
import { Toaster } from "sonner";
import { DemoProvider } from "./store";
import App from "./App";
import "./styles.css";
import "./playful.css";
import "./bold.css";
import { ThemeProvider, useTheme } from "./theme";
import { LaunchIntro } from "./components/LaunchIntro";

function ThemedToaster() {
  const { theme } = useTheme();
  return (
    <Toaster
      theme={theme}
      position="bottom-right"
      richColors
      closeButton
      duration={2500}
      visibleToasts={2}
      mobileOffset={{ bottom: 90, left: 16, right: 16 }}
    />
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <MotionConfig reducedMotion="user">
      <HashRouter>
        <ThemeProvider>
          <LaunchIntro>
            <DemoProvider>
              <App />
              <ThemedToaster />
            </DemoProvider>
          </LaunchIntro>
        </ThemeProvider>
      </HashRouter>
    </MotionConfig>
  </React.StrictMode>,
);
