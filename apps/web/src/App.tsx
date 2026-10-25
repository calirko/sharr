import { lazy, Suspense } from "react";
import { Route, Switch } from "wouter";
import { NicknameForm } from "./components/NicknameForm";
import { useUser } from "./lib/user";
import { Home } from "./pages/Home";

// LiveKit is most of the bundle, only load it inside a room
const AdminPage = lazy(() => import("./pages/Admin").then((m) => ({ default: m.AdminPage })));
const RoomPage = lazy(() => import("./pages/Room").then((m) => ({ default: m.RoomPage })));

export function App() {
  const { user, loading } = useUser();
  if (loading) return null;
  if (!user) return <NicknameForm />;

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
