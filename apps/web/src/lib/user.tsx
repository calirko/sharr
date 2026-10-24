import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api, type User } from "./api";

type UserState = { user: User | null; loading: boolean; setUser: (user: User | null) => void };

const UserContext = createContext<UserState>({ user: null, loading: true, setUser: () => {} });

export function UserProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .me()
      .then((r) => setUser(r.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  return <UserContext.Provider value={{ user, loading, setUser }}>{children}</UserContext.Provider>;
}

export const useUser = () => useContext(UserContext);
