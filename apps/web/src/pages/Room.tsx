import { LiveKitRoom } from "@livekit/components-react";
import { DisconnectReason } from "livekit-client";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useLocation } from "wouter";
import { RoomView } from "@/components/RoomView";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, ApiError, type JoinInfo, type Room } from "@/lib/api";
import { errorText } from "@/lib/errors";

type State =
  | { kind: "loading" }
  | { kind: "pin"; room: Room; error?: string }
  | { kind: "joined"; room: Room; info: JoinInfo }
  | { kind: "ended"; text: string; rejoin: boolean };

// Remember the PIN for this tab so a reload doesn't ask again
const pinKey = (id: string) => `sharr.pin.${id}`;
function storedPin(id: string) {
  try {
    return sessionStorage.getItem(pinKey(id)) ?? undefined;
  } catch {
    return undefined;
  }
}
function storePin(id: string, pin: string) {
  try {
    sessionStorage.setItem(pinKey(id), pin);
  } catch {}
}

const endedText: Partial<Record<DisconnectReason, string>> = {
  [DisconnectReason.ROOM_DELETED]: "This room was closed.",
  [DisconnectReason.PARTICIPANT_REMOVED]: "You were removed from the room.",
  [DisconnectReason.DUPLICATE_IDENTITY]: "You joined this room from another tab.",
};

export function RoomPage({ id }: { id: string }) {
  const [, navigate] = useLocation();
  const [state, setState] = useState<State>({ kind: "loading" });

  const join = useCallback(
    async (room: Room, pin?: string) => {
      try {
        const info = await api.join(id, pin);
        if (pin) storePin(id, pin);
        setState({ kind: "joined", room, info });
      } catch (err) {
        if (err instanceof ApiError && err.code === "bad_pin") {
          setState({ kind: "pin", room, error: pin ? "Wrong PIN." : undefined });
        } else {
          setState({ kind: "ended", text: errorText(err), rejoin: false });
        }
      }
    },
    [id],
  );

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const { room } = await api.room(id);
      await join(room, room.has_pin ? storedPin(id) : undefined);
    } catch (err) {
      setState({ kind: "ended", text: errorText(err), rejoin: false });
    }
  }, [id, join]);

  useEffect(() => {
    load();
  }, [load]);

  const onDisconnected = useCallback(
    (reason?: DisconnectReason) => {
      if (reason === DisconnectReason.CLIENT_INITIATED) return navigate("/");
      const text = (reason !== undefined && endedText[reason]) || "Disconnected.";
      setState({ kind: "ended", text, rejoin: reason !== DisconnectReason.ROOM_DELETED });
    },
    [navigate],
  );

  if (state.kind === "loading") return null;
  if (state.kind === "pin") return <PinForm room={state.room} error={state.error} onSubmit={(pin) => join(state.room, pin)} />;
  if (state.kind === "ended") {
    return (
      <Centered>
        <p>{state.text}</p>
        <div className="flex gap-2">
          {state.rejoin && <Button onClick={load}>Rejoin</Button>}
          <Button variant="outline" asChild>
            <Link href="/">Back to rooms</Link>
          </Button>
        </div>
      </Centered>
    );
  }

  return (
    <LiveKitRoom
      serverUrl={state.info.url}
      token={state.info.token}
      connect
      options={{ adaptiveStream: true, dynacast: true }}
      onDisconnected={onDisconnected}
      onError={() => setState({ kind: "ended", text: "Could not connect to the media server.", rejoin: true })}
      className="h-dvh"
    >
      <RoomView
        room={state.room}
        info={state.info}
        onRoomChange={(room) => setState((s) => (s.kind === "joined" ? { ...s, room } : s))}
      />
    </LiveKitRoom>
  );
}

function PinForm({ room, error, onSubmit }: { room: Room; error?: string; onSubmit: (pin: string) => void }) {
  const [pin, setPin] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit(pin);
  };
  return (
    <Centered>
      <form onSubmit={submit} className="flex w-full max-w-xs flex-col gap-4">
        <h1 className="truncate text-xl font-semibold">{room.name}</h1>
        <Input
          autoFocus
          inputMode="numeric"
          placeholder="PIN"
          maxLength={12}
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
        />
        {error && <p className="text-destructive text-sm">{error}</p>}
        <div className="flex gap-2">
          <Button type="submit" className="flex-1" disabled={!pin}>
            Join
          </Button>
          <Button variant="outline" asChild>
            <Link href="/">Cancel</Link>
          </Button>
        </div>
      </form>
    </Centered>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <main className="flex min-h-dvh flex-col items-center justify-center gap-4 p-4 text-center">{children}</main>;
}
