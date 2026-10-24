import { config } from "./config";
import { roomService } from "./livekit";
import { listRooms, removeRoom, updateRoom } from "./rooms";

const INTERVAL_MS = 60_000;

// Rooms with people in them stay alive. Empty rooms are closed after ROOM_IDLE_MINUTES.
export async function sweepRooms() {
  const rooms = await listRooms();
  if (rooms.length === 0) return;
  const live = await roomService.listRooms(rooms.map((r) => r.id));
  const occupied = new Set(live.filter((r) => r.numParticipants > 0).map((r) => r.name));
  const now = Date.now();
  const idleMs = config.roomIdleMinutes * 60_000;

  for (const room of rooms) {
    if (occupied.has(room.id)) {
      await updateRoom(room.id, { last_active_at: String(now) });
    } else if (now - Number(room.last_active_at) > idleMs) {
      await roomService.deleteRoom(room.id).catch(() => {});
      await removeRoom(room.id);
      console.log(`closed idle room ${room.id}`);
    }
  }
}

export function startRoomSweeper() {
  setInterval(() => {
    sweepRooms().catch((err) => console.error("room sweep failed:", err));
  }, INTERVAL_MS);
}
