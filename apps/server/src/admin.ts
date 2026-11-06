// Admin CLI, run on the server. Talks to Redis directly.
//   bun run admin list
//   bun run admin grant <discord-id|user-id>
//   bun run admin revoke <discord-id|user-id>
//   bun run admin logs [discord-id|user-id] [count]   desktop app logs, newest last
import { readLogs } from "./applog";
import { getUser, isAdmin, listUsers, setAdmin } from "./users";

const usage = "usage: bun run admin list | grant <discord-id|user-id> | revoke <discord-id|user-id> | logs [discord-id|user-id] [count]";

const userIdOf = (ref: string) => (/^\d+$/.test(ref) ? `d_${ref}` : ref);

async function main(args: string[]) {
  const [cmd, ref] = args;
  if (cmd === "list") {
    const users = await listUsers();
    for (const u of users) {
      console.log(`${isAdmin(u) ? "admin" : "     "}  ${u.user_id}  @${u.discord_username}  ${u.nickname}`);
    }
    if (users.length === 0) console.log("no Discord users yet");
    return 0;
  }
  if (cmd === "logs") {
    // "logs 200" is a count, "logs 1234 200" a user and a count. Discord ids are far longer.
    const [who, n] = ref && /^\d{1,6}$/.test(ref) ? [undefined, ref] : [ref, args[2]];
    const logs = await readLogs(Number(n) || 100, who && userIdOf(who));
    for (const l of logs) {
      const at = new Date(Number(l.ts)).toISOString();
      console.log(`${at}  ${l.user_id} ${l.os} ${l.version}  ${l.level.padEnd(5)} ${l.target}  ${l.msg}`);
    }
    if (logs.length === 0) console.log("no logs");
    return 0;
  }
  if ((cmd === "grant" || cmd === "revoke") && ref) {
    // Bare Discord ids are digits, user ids start with d_
    const user = await getUser(userIdOf(ref));
    if (!user) {
      console.error(`no user ${ref}. They need to log in with Discord once first.`);
      return 1;
    }
    await setAdmin(user.user_id, cmd === "grant");
    console.log(`${cmd === "grant" ? "granted" : "revoked"} admin: ${user.user_id} @${user.discord_username}`);
    return 0;
  }
  console.error(usage);
  return 1;
}

process.exit(await main(process.argv.slice(2)));
