import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { Toaster } from "./components/ui/sonner";
import { watchUpdates } from "./lib/desktop";
import { UserProvider } from "./lib/user";
import "./index.css";

const dark = window.matchMedia("(prefers-color-scheme: dark)");
const applyTheme = () => document.documentElement.classList.toggle("dark", dark.matches);
applyTheme();
dark.addEventListener("change", applyTheme);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <UserProvider>
      <App />
      <Toaster />
    </UserProvider>
  </StrictMode>,
);

watchUpdates();
