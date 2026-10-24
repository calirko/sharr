import { Lock, Plus, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { CopyLinkButton } from "@/components/CopyLinkButton";
import { CreateRoomDialog } from "@/components/CreateRoomDialog";
import { RenameDialog } from "@/components/RenameDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api, type Room } from "@/lib/api";
import { useUser } from "@/lib/user";

const POLL_MS = 10_000;

export function Home() {
  const { user } = useUser();
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState(false);

  useEffect(() => {
    const load = () => api.rooms().then((r) => setRooms(r.rooms), () => {});
    load();
    const timer = setInterval(load, POLL_MS);
    return () => clearInterval(timer);
  }, []);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-6 p-4">
      <header className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">sharr</h1>
        <Button variant="ghost" size="sm" onClick={() => setRenaming(true)}>
          {user?.nickname}
        </Button>
      </header>

      <div className="flex items-center justify-between">
        <h2 className="text-muted-foreground text-sm font-medium">Your rooms</h2>
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus /> New room
        </Button>
      </div>

      <ul className="flex flex-col gap-2">
        {rooms?.length === 0 && <li className="text-muted-foreground text-sm">No rooms yet. Create one and send people the link.</li>}
        {rooms?.map((room) => (
          <li key={room.id} className="flex items-center gap-1 rounded-lg border pr-2">
            <Link
              href={`/r/${room.id}`}
              className="hover:bg-foreground/4 flex min-w-0 flex-1 items-center gap-2 rounded-l-lg px-4 py-3 transition-colors"
            >
              <span className="flex-1 truncate font-medium">{room.name}</span>
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

      {creating && <CreateRoomDialog open onOpenChange={setCreating} />}
      {renaming && <RenameDialog open onOpenChange={setRenaming} />}
    </main>
  );
}
