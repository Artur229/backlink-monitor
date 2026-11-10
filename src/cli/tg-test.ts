import { Bot } from "grammy";
import { config } from "../lib/config";

/** Checks TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID: npm run tg:test */
if (!config.TELEGRAM_BOT_TOKEN || !config.TELEGRAM_CHAT_ID) {
  console.error("✖ TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be set in .env");
  process.exit(2);
}
const bot = new Bot(config.TELEGRAM_BOT_TOKEN);
try {
  const me = await bot.api.getMe();
  console.log(`✔ token ok: @${me.username}`);
  await bot.api.sendMessage(config.TELEGRAM_CHAT_ID, "🛠 <b>Backlink Monitor</b>: тестове повідомлення, зв'язок працює.", {
    parse_mode: "HTML",
  });
  console.log(`✔ message delivered to chat ${config.TELEGRAM_CHAT_ID}`);
} catch (e) {
  console.error(`✖ ${(e as Error).message}`);
  process.exitCode = 1;
}
