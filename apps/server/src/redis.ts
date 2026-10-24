import { RedisClient } from "bun";
import { config } from "./config";

export const redis = new RedisClient(config.redisUrl);

// Bun stops retrying after maxRetries and never reconnects on its own,
// so a Redis restart would leave the app broken. Keep trying.
let reconnecting = false;
redis.onclose = function (err) {
  if (reconnecting) return;
  reconnecting = true;
  console.error("redis connection lost:", err.message);
  const retry = () => {
    redis.connect().then(
      () => {
        reconnecting = false;
        console.log("redis reconnected");
      },
      () => setTimeout(retry, 3000),
    );
  };
  setTimeout(retry, 3000);
};

// Short random id, url safe
export function randomId(bytes = 6): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))).toString("base64url");
}
