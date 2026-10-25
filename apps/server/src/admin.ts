// Admin CLI, run on the server. Talks to Redis directly.
//   bun run admin list
//   bun run admin grant <discord-id|user-id>
//   bun run admin revoke <discord-id|user-id>
import { getUser, isAdmin, listUsers, setAdmin } from "./users";

const usage = "usage: bun run admin list | grant <discord-id|user-id> | revoke <discord-id|user-id>";

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
  if ((cmd === "grant" || cmd === "revoke") && ref) {
    // Bare Discord ids are digits, user ids start with d_
    const user = await getUser(/^\d+$/.test(ref) ? `d_${ref}` : ref);
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
