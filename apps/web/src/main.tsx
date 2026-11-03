import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { Toaster } from "./components/ui/sonner";
import { watchUpdates } from "./lib/desktop";
import { registerServiceWorker } from "./lib/notify";
import { initTheme } from "./lib/theme";
import { UserProvider } from "./lib/user";
import "./index.css";

initTheme();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <UserProvider>
      <App />
      <Toaster />
    </UserProvider>
  </StrictMode>,
);

watchUpdates();
registerServiceWorker();
