import { lazy, Suspense } from "react";
import { Route, Switch } from "wouter";
import { NicknameForm } from "./components/NicknameForm";
import { isDesktop } from "./lib/desktop";
import { useUser } from "./lib/user";
import { DesktopLoginPage } from "./pages/DesktopLogin";
import { Home } from "./pages/Home";

// LiveKit is most of the bundle, only load it inside a room
const AdminPage = lazy(() => import("./pages/Admin").then((m) => ({ default: m.AdminPage })));
const RoomPage = lazy(() => import("./pages/Room").then((m) => ({ default: m.RoomPage })));
const ActivityPage = lazy(() => import("./pages/Activity").then((m) => ({ default: m.ActivityPage })));

export function App() {
  const { user, loading } = useUser();
  // Inside a Discord Activity, Discord serves us from its own proxy domain
  if (location.hostname.endsWith(".discordsays.com"))
    return (
      <Suspense>
        <ActivityPage />
      </Suspense>
    );
  if (loading) return null;
  // Works logged out too, it offers the Discord login itself
  if (location.pathname === "/desktop-login") return <DesktopLoginPage />;
  if (!user || (isDesktop && user.kind === "guest")) return <NicknameForm />;

  return (
    <Switch>
      <Route path="/r/:id">
        {(params) => (
          <Suspense>
            <RoomPage id={params.id} />
          </Suspense>
        )}
      </Route>
      <Route path="/admin">
        <Suspense>
          <AdminPage />
        </Suspense>
      </Route>
      <Route>
        <Home />
      </Route>
    </Switch>
  );
}
