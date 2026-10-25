import { LogOut, Pencil } from "lucide-react";
import { DiscordIcon } from "@/components/DiscordIcon";
import { UserAvatar } from "@/components/UserAvatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { api, discordLoginUrl } from "@/lib/api";
import { useUser } from "@/lib/user";

export function UserMenu({ onRename }: { onRename: () => void }) {
  const { user, setUser, discordEnabled } = useUser();
  if (!user) return null;

  async function logout() {
    await api.logout().catch(() => {});
    setUser(null);
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="max-w-48">
          <UserAvatar name={user.nickname} url={user.avatar_url} className="size-6" />
          <span className="truncate">{user.nickname}</span>
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
        <DropdownMenuItem onSelect={onRename}>
          <Pencil /> Change nickname
        </DropdownMenuItem>
        {user.kind === "guest" && discordEnabled && (
          <DropdownMenuItem asChild>
            <a href={discordLoginUrl()}>
              <DiscordIcon /> Log in with Discord
            </a>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={logout}>
          <LogOut /> Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
