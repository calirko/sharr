import { ApiError } from "./api";

const messages: Record<string, string> = {
  not_found: "Room not found. It may have closed.",
  bad_pin: "Wrong PIN.",
  forbidden: "Only the room creator can do that.",
  rate_limited: "Too many requests. Try again in a bit.",
  too_many_attempts: "Too many wrong PINs. Try again later.",
  too_many_rooms: "You have too many rooms. Close one first.",
  not_logged_in: "Your session expired. Reload the page.",
};

export function errorText(err: unknown) {
  if (err instanceof ApiError) return messages[err.code] ?? "Something went wrong.";
  if (err instanceof Error && err.name === "NotAllowedError") return "Permission denied.";
  return "Something went wrong.";
}
