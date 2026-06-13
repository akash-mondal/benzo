/** @benzo/app-telegram — Telegram bot + mini-app (TWA) (scaffold). See README.md for the build-out plan. */
export * from "./platform.js";
import { TelegramPlatform } from "./platform.js";
export const platform = new TelegramPlatform();
