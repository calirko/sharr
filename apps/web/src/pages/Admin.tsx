import { ArrowLeft, Lock, MonitorUp, Radio, SearchX, Shield, Trash2, Users, UserX } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "wouter";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { DiscordIcon } from "@/components/DiscordIcon";
import { CenterStack, TopBar } from "@/components/Layout";
import { Logo } from "@/components/Logo";
import { UserAvatar } from "@/components/UserAvatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api, type AdminParticipant, type AdminRoom, type AdminUser } from "@/lib/api";
import { errorText } from "@/lib/errors";
import { useUser } from "@/lib/user";
import { toast } from "sonner";

const POLL_MS = 5_000;

type Pending =
  | { kind: "close"; room: AdminRoom }
  | { kind: "kick"; room: AdminRoom; participant: AdminParticipant };

function ago(ms: number) {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function AdminPage() {
  const { user } = useUser();
  const [rooms, setRooms] = useState<AdminRoom[] | null>(null);
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);

  const load = useCallback(() => {
    api.admin.rooms().then(
      (r) => setRooms(r.rooms),
      (err) => toast.error(errorText(err)),
    );
  }, []);

  useEffect(() => {
    if (!user?.is_admin) return;
    load();
    api.admin.users().then(
      (r) => setUsers(r.users),
      (err) => toast.error(errorText(err)),
    );
    const timer = setInterval(load, POLL_MS);
    return () => clearInterval(timer);
  }, [user?.is_admin, load]);

  if (!user?.is_admin) {
    return (
      <main className="flex min-h-dvh flex-col justify-center p-4">
        <CenterStack icon={SearchX} text="Page not found.">
          <Button variant="outline" asChild>
            <Link href="/">
              <ArrowLeft /> Back to rooms
            </Link>
          </Button>
        </CenterStack>
      </main>
    );
  }

  return (
    <div className="flex h-dvh flex-col">
      <TopBar>
        <h1 className="flex min-w-0 flex-1 items-center gap-3">
          <Logo />
          <Badge variant="secondary">
            <Shield /> Admin
          </Badge>
        </h1>
        <Button variant="ghost" size="sm" asChild>
          <Link href="/">
            <ArrowLeft /> Rooms
          </Link>
        </Button>
      </TopBar>

      <main className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
        <div className="m-auto flex w-full max-w-3xl flex-col gap-12 py-8">
          {rooms && (
            <CenterStack icon={Radio} text={rooms.length ? `Rooms (${rooms.length})` : "No rooms."}>
              {rooms.length > 0 && (
                <ul className="flex w-full flex-col gap-2 text-left">
                  {rooms.map((room) => (
                    <RoomItem
                      key={room.id}
                      room={room}
                      onClose={() => setPending({ kind: "close", room })}
                      onKick={(participant) => setPending({ kind: "kick", room, participant })}
                    />
                  ))}
                </ul>
              )}
            </CenterStack>
          )}

          {users && (
            <CenterStack
              icon={Users}
              text={users.length ? `Discord users (${users.length})` : "No Discord users yet."}
            >
              {users.length > 0 && (
                <ul className="flex w-full flex-col divide-y rounded-lg border text-left">
                  {users.map((u) => (
                    <li key={u.user_id} className="flex items-center gap-3 px-4 py-2">
                      <UserAvatar name={u.nickname} url={u.avatar_url} className="size-8" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{u.nickname}</p>
                        <p className="text-muted-foreground truncate text-xs">
                          @{u.discord_username} · {u.discord_id}
                        </p>
                      </div>
                      {u.is_admin && (
                        <Badge variant="secondary">
                          <Shield /> Admin
                        </Badge>
                      )}
                      <span className="text-muted-foreground hidden text-xs sm:inline">joined {ago(u.created_at)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CenterStack>
          )}
        </div>
      </main>

      {pending && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setPending(null)}
          {...(pending.kind === "close"
            ? {
                title: "Close room",
                description: `${pending.room.known ? pending.room.name : pending.room.id} will close and everyone in it is disconnected.`,
                confirmLabel: "Close room",
                confirmIcon: Trash2,
                onConfirm: () => api.admin.closeRoom(pending.room.id).then(load),
              }
            : {
                title: "Remove from room",
                description: `${pending.participant.name || pending.participant.identity} will be disconnected. They can't rejoin until the room closes.`,
                confirmLabel: "Remove",
                confirmIcon: UserX,
                onConfirm: () => api.admin.kick(pending.room.id, pending.participant.identity).then(load),
              })}
        />
      )}
    </div>
  );
}

function RoomItem({
  room,
  onClose,
  onKick,
}: {
  room: AdminRoom;
  onClose: () => void;
  onKick: (p: AdminParticipant) => void;
}) {
  return (
    <li className="flex flex-col rounded-lg border">
      <div className="flex items-start gap-2 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {room.known ? (
              <Link href={`/r/${room.id}`} className="font-display truncate font-semibold hover:underline">
                {room.name}
              </Link>
            ) : (
              <span className="text-muted-foreground font-semibold">Unknown room</span>
            )}
            {room.known && room.has_pin && (
              <Badge variant="secondary">
                <Lock /> PIN
              </Badge>
            )}
            <Badge variant={room.participants.length > 0 ? "default" : "secondary"}>
              <Users /> {room.participants.length}
            </Badge>
          </div>
          <p className="text-muted-foreground mt-1 text-xs">
            {room.id}
            {room.known && (
              <>
                {" · by "}
                {room.creator_name ? `${room.creator_name} (@${room.creator_discord_username})` : "a guest"}
                {" · "}
                {room.share_mode === "everyone" ? "everyone shares" : "creator shares"}
                {` · created ${ago(room.created_at)} · active ${ago(room.last_active_at)}`}
              </>
            )}
          </p>
        </div>
        <Button variant="ghost" size="sm" className="text-destructive" title="Close room" onClick={onClose}>
          <Trash2 /> <span className="hidden sm:inline">Close</span>
        </Button>
      </div>
      {room.participants.length > 0 && (
        <ul className="flex flex-col border-t py-1">
          {room.participants.map((p) => (
            <li key={p.identity} className="flex items-center gap-2 px-4 py-1">
              <UserAvatar name={p.name || p.identity} url={p.avatar_url} />
              <span className="truncate text-sm">{p.name || p.identity}</span>
              {p.kind === "discord" ? (
                <span className="text-muted-foreground flex min-w-0 items-center gap-1 text-xs">
                  <DiscordIcon className="size-3 shrink-0" />
                  <span className="truncate">{p.discord_username}</span>
                </span>
              ) : (
                <span className="text-muted-foreground text-xs">guest</span>
              )}
              {p.sharing && (
                <Badge variant="secondary">
                  <MonitorUp /> sharing
                </Badge>
              )}
              <span className="text-muted-foreground ml-auto hidden text-xs sm:inline">{ago(p.joined_at)}</span>
              <Button variant="ghost" size="icon-sm" title="Remove from room" onClick={() => onKick(p)}>
                <UserX />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
