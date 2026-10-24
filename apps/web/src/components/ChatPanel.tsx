import { SendHorizontal } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { MAX_LENGTH, RateLimitedError, useRoomChat } from "@/lib/chat";

export function ChatPanel() {
  const { messages, send, nameOf } = useRoomChat();
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Grow with the text. max-h in the class caps it, after that it scrolls.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  // Enter sends, Shift+Enter adds a line. On phones Enter adds a line and the button sends.
  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
    if (window.matchMedia("(pointer: coarse)").matches) return;
    e.preventDefault();
    e.currentTarget.form?.requestSubmit();
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const message = text.trim();
    if (!message) return;
    setText("");
    setError("");
    await send(message).catch((err) => {
      setText(message);
      setError(err instanceof RateLimitedError ? "Slow down, you're sending too fast." : "Message not sent.");
    });
  }

  return (
    <>
      <div ref={listRef} className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3 text-sm">
        {messages.length === 0 && <p className="text-muted-foreground">No messages yet.</p>}
        {messages.map((m) =>
          m.kind === "hidden" ? (
            <p key={m.id} className="text-muted-foreground text-xs italic">
              Hiding messages from {nameOf(m.identity)}, too many too fast.
            </p>
          ) : (
            <div key={m.id} className="break-words">
              <span className="font-medium">{nameOf(m.identity)}</span>{" "}
              <span className="text-muted-foreground text-xs">
                {new Date(m.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
              <p className="whitespace-pre-wrap">{m.text}</p>
            </div>
          ),
        )}
      </div>
      {error && <p className="text-destructive px-3 text-sm">{error}</p>}
      <form onSubmit={submit} className="flex items-end gap-2 border-t p-2">
        <textarea
          ref={inputRef}
          rows={1}
          placeholder="Message"
          maxLength={MAX_LENGTH}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          className="placeholder:text-muted-foreground max-h-32 min-h-9 flex-1 resize-none bg-transparent px-3 py-2 text-base outline-none md:text-sm"
        />
        <Button type="submit" size="icon" title="Send" disabled={!text.trim()}>
          <SendHorizontal />
        </Button>
      </form>
    </>
  );
}
