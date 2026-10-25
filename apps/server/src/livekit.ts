import { AccessToken, RoomServiceClient, TrackSource, type ParticipantPermission } from "livekit-server-sdk";
import { config } from "./config";

export const roomService = new RoomServiceClient(
  config.livekit.apiUrl,
  config.livekit.apiKey,
  config.livekit.apiSecret,
);

// Screen share and its audio only. No camera, no mic.
export function permissionFor(canShare: boolean): ParticipantPermission {
  return {
    canSubscribe: true,
    canPublishData: true,
    canPublish: canShare,
    canPublishSources: canShare ? [TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO] : [],
  } as ParticipantPermission;
}

// Attributes come from the token only (no canUpdateOwnMetadata), so other clients can trust them
export async function mintToken(opts: {
  room: string;
  identity: string;
  name: string;
  canShare: boolean;
  attributes: Record<string, string>;
}) {
  const at = new AccessToken(config.livekit.apiKey, config.livekit.apiSecret, {
    identity: opts.identity,
    name: opts.name,
    attributes: opts.attributes,
    ttl: "10m",
  });
  const p = permissionFor(opts.canShare);
  at.addGrant({
    room: opts.room,
    roomJoin: true,
    canSubscribe: p.canSubscribe,
    canPublishData: p.canPublishData,
    canPublish: p.canPublish,
    canPublishSources: p.canPublishSources,
    canUpdateOwnMetadata: false,
  });
  return at.toJwt();
}

// LiveKit throws when the room doesn't exist yet; treat that as empty
export async function listParticipantsSafe(room: string) {
  try {
    return await roomService.listParticipants(room);
  } catch {
    return [];
  }
}
