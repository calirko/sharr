import { LogOut, Monitor, Moon, Pencil, Settings, Shield, Sun } from "lucide-react";
import { useState } from "react";
import { Link } from "wouter";
import { DiscordIcon } from "@/components/DiscordIcon";
import { RenameDialog } from "@/components/RenameDialog";
import { SettingsDialog } from "@/components/SettingsDialog";
import { UserAvatar } from "@/components/UserAvatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { api, discordLoginUrl } from "@/lib/api";
import { setTheme, type Theme, useTheme } from "@/lib/theme";
import { useUser } from "@/lib/user";
import { cn } from "@/lib/utils";

const THEMES = [
  { value: "system", label: "System", icon: Monitor },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
] as const;

// compact: avatar only on narrow screens, for the room header
export function UserMenu({ compact = false }: { compact?: boolean }) {
  const { user, setUser, discordEnabled } = useUser();
  const theme = useTheme();
  const [renaming, setRenaming] = useState(false);
  const [settings, setSettings] = useState(false);
  if (!user) return null;

  async function logout() {
    await api.logout().catch(() => {});
    setUser(null);
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className={cn("max-w-48", compact && "max-sm:px-1.5")}
            title={user.nickname}
          >
            <UserAvatar name={user.nickname} url={user.avatar_url} className="size-6" />
            <span className={cn("truncate", compact && "max-sm:hidden")}>{user.nickname}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel className="text-muted-foreground flex items-center gap-2 font-normal">
            {user.kind === "discord" ? (
              <>
                <DiscordIcon /> {user.discord_username}
              </>
            ) : (
              "Guest"
            )}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {user.kind === "guest" && (
            <DropdownMenuItem onSelect={() => setRenaming(true)}>
              <Pencil /> Change nickname
            </DropdownMenuItem>
          )}
          {user.kind === "discord" && (
            <DropdownMenuItem onSelect={() => setSettings(true)}>
              <Settings /> Settings
            </DropdownMenuItem>
          )}
          {user.kind === "guest" && discordEnabled && (
            <DropdownMenuItem asChild>
              <a href={discordLoginUrl()}>
                <DiscordIcon /> Log in with Discord
              </a>
            </DropdownMenuItem>
          )}
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              {theme === "dark" ? <Moon /> : theme === "light" ? <Sun /> : <Monitor />} Theme
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuRadioGroup value={theme} onValueChange={(v) => setTheme(v as Theme)}>
                {THEMES.map(({ value, label, icon: Icon }) => (
                  <DropdownMenuRadioItem key={value} value={value}>
                    <Icon /> {label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          {user.is_admin && (
            <DropdownMenuItem asChild>
              <Link href="/admin">
                <Shield /> Admin
              </Link>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={logout}>
            <LogOut /> Log out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {renaming && <RenameDialog open onOpenChange={setRenaming} />}
      {settings && <SettingsDialog open onOpenChange={setSettings} />}
    </>
  );
}
