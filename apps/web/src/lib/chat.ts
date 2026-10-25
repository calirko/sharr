import { useParticipants, useRoomContext } from "@livekit/components-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import { playSound } from "./sounds";
import { useUser } from "./user";

const TOPIC = "lk.chat";

// Chat is peer to peer, the server never sees it. So every client enforces these
// on what it receives, and a modified client still can't flood anyone else.
export const MAX_LENGTH = 1000;
const RATE_MAX = 5;
const RATE_WINDOW_MS = 10_000;
const MAX_NEWLINES = 2;
const KEEP_MESSAGES = 300;

export type ChatMessage =
  | { kind: "message"; id: string; identity: string; text: string; timestamp: number }
  | { kind: "hidden"; id: string; identity: string; timestamp: number };

export class RateLimitedError extends Error {}

// Stream ids come from the sender, so list keys are made here instead
let nextId = 0;
const localId = () => String(nextId++);

// Sliding window per key. Returns false once a key goes over the limit.
function createLimiter(max: number, windowMs: number) {
  const hits = new Map<string, number[]>();
  return (key: string) => {
    const now = Date.now();
    const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    const ok = recent.length < max;
    if (ok) recent.push(now);
    hits.set(key, recent);
    return ok;
  };
}

function clean(text: string) {
  return text
    .slice(0, MAX_LENGTH)
    .replace(new RegExp(`\\n{${MAX_NEWLINES + 1},}`, "g"), "\n".repeat(MAX_NEWLINES))
    .trim();
}

// Stops reading once the text is too long, so a huge stream never sits in memory
async function readLimited(reader: AsyncIterable<string>) {
  let text = "";
  for await (const chunk of reader) {
    text += chunk;
    if (text.length > MAX_LENGTH) break;
  }
  return text;
}

// Messages can arrive before LiveKit tells us the sender joined, so keep the identity
// and look the name up on render. Names of people who left are kept for old messages.
export function useRoomChat() {
  const room = useRoomContext();
  const participants = useParticipants();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const people = useRef(new Map<string, { name: string; avatar: string }>());
  for (const p of participants) {
    people.current.set(p.identity, { name: p.name || p.identity, avatar: p.attributes.avatar_url ?? "" });
  }

  const { user } = useUser();
  const sendLimit = useRef(createLimiter(RATE_MAX, RATE_WINDOW_MS));

  const append = useCallback((msg: ChatMessage) => {
    setMessages((m) => [...m, msg].slice(-KEEP_MESSAGES));
  }, []);

  useEffect(() => {
    const allow = createLimiter(RATE_MAX, RATE_WINDOW_MS);
    // One "hidden" note per burst, not one per dropped message
    const noticed = new Map<string, number>();

    room.registerTextStreamHandler(TOPIC, async (reader, { identity }) => {
      // Sender's clock is not trusted for ordering
      const timestamp = Date.now();
      if (!allow(identity)) {
        if (timestamp - (noticed.get(identity) ?? 0) > RATE_WINDOW_MS) {
          noticed.set(identity, timestamp);
          append({ kind: "hidden", id: localId(), identity, timestamp });
        }
        return;
      }
      const text = clean(await readLimited(reader));
      if (!text) return;
      append({ kind: "message", id: localId(), identity, text, timestamp });
      playSound("message");
    });
    return () => room.unregisterTextStreamHandler(TOPIC);
  }, [room, append]);

  const send = useCallback(
    async (raw: string) => {
      const text = clean(raw);
      if (!text) return;
      if (!sendLimit.current(room.localParticipant.identity)) throw new RateLimitedError();
      await room.localParticipant.sendText(text, { topic: TOPIC });
      append({ kind: "message", id: localId(), identity: room.localParticipant.identity, text, timestamp: Date.now() });
      // Discord users' messages go to the backlog. Best effort, chat works without it.
      if (user?.kind === "discord") api.logMessage(room.name, text).catch(() => {});
    },
    [room, append, user?.kind],
  );

  const nameOf = (identity: string) => people.current.get(identity)?.name ?? "...";
  const avatarOf = (identity: string) => people.current.get(identity)?.avatar ?? "";
  return { messages, send, nameOf, avatarOf };
}
