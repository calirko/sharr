import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api, type User } from "./api";

type UserState = {
  user: User | null;
  loading: boolean;
  discordEnabled: boolean;
  setUser: (user: User | null) => void;
};

const UserContext = createContext<UserState>({ user: null, loading: true, discordEnabled: false, setUser: () => {} });

export function UserProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [discordEnabled, setDiscordEnabled] = useState(false);

  useEffect(() => {
    api
      .me()
      .then((r) => {
        setUser(r.user);
        setDiscordEnabled(r.discord_enabled);
      })
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  return <UserContext.Provider value={{ user, loading, discordEnabled, setUser }}>{children}</UserContext.Provider>;
}

export const useUser = () => useContext(UserContext);
