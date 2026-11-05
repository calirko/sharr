import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { SourcePicker } from "./components/SourcePicker";
import { TitleBar } from "./components/TitleBar";
import { VersionTag } from "./components/VersionTag";
import { Toaster } from "./components/ui/sonner";
import { disguiseBrowser, isDesktop, watchUpdates } from "./lib/desktop";
import { registerServiceWorker } from "./lib/notify";
import { watchOffline } from "./lib/offline";
import { initTheme } from "./lib/theme";
import { UserProvider } from "./lib/user";
import "./index.css";

initTheme();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <UserProvider>
      <TitleBar />
      <App />
      {isDesktop && <SourcePicker />}
      {isDesktop && <VersionTag />}
      <Toaster />
    </UserProvider>
  </StrictMode>,
);

watchUpdates();
disguiseBrowser();
registerServiceWorker();
watchOffline();
