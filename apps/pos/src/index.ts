/** @benzo/app-pos — Point-of-sale terminal (scaffold). See README.md for the build-out plan. */
export * from "./platform.js";
import { PosPlatform } from "./platform.js";
export const platform = new PosPlatform();
