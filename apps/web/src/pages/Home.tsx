import { Logo } from "@/components/Logo";
import { DoorOpen, Lock, Plus, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { CopyLinkButton } from "@/components/CopyLinkButton";
import { CenterStack, TopBar } from "@/components/Layout";
import { CreateRoomDialog } from "@/components/CreateRoomDialog";
import { RenameDialog } from "@/components/RenameDialog";
import { UserMenu } from "@/components/UserMenu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api, type Room } from "@/lib/api";

const POLL_MS = 10_000;

export function Home() {
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState(false);

  useEffect(() => {
    const load = () =>
      api.rooms().then(
        (r) => setRooms(r.rooms),
        () => {},
      );
    load();
    const timer = setInterval(load, POLL_MS);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="flex h-dvh flex-col">
      <TopBar>
        <h1 className="min-w-0 flex-1">
          <Logo />
        </h1>
        <UserMenu onRename={() => setRenaming(true)} />
      </TopBar>

      <main className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
        {rooms && (
          <CenterStack
            icon={DoorOpen}
            text={rooms.length ? "Your rooms" : "No rooms yet. Create one and send people the link."}
            className="m-auto w-full max-w-md py-8"
          >
            {rooms.length > 0 && (
              <ul className="flex w-full flex-col gap-2 text-left">
                {rooms.map((room) => (
                  <li key={room.id} className="flex items-center gap-1 rounded-lg border pr-2">
                    <Link
                      href={`/r/${room.id}`}
                      className="hover:bg-foreground/4 flex min-w-0 flex-1 items-center gap-2 rounded-l-lg px-4 py-3 transition-colors"
                    >
                      <span className="font-display flex-1 truncate font-semibold">{room.name}</span>
                      {room.has_pin && (
                        <Badge variant="secondary">
                          <Lock /> PIN
                        </Badge>
                      )}
                      <Badge variant={room.participants > 0 ? "default" : "secondary"}>
                        <Users /> {room.participants}
                      </Badge>
                    </Link>
                    <CopyLinkButton roomId={room.id} roomName={room.name} compact />
                  </li>
                ))}
              </ul>
            )}
            <Button size="lg" onClick={() => setCreating(true)}>
              <Plus /> New room
            </Button>
          </CenterStack>
        )}
      </main>

      {creating && <CreateRoomDialog open onOpenChange={setCreating} />}
      {renaming && <RenameDialog open onOpenChange={setRenaming} />}
    </div>
  );
}
