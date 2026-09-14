/**
 * Finding a Chromium to drive, wherever this is running.
 *
 * Three cases, in order:
 *   1. CHROMIUM_PATH, or the cloud sandbox's fixed path, when it exists.
 *   2. Playwright's own downloaded browser, when `playwright install` worked.
 *   3. The Google Chrome already on the machine.
 *
 * Case 3 matters on macOS 13: Playwright has stopped shipping a prebuilt
 * Chromium for mac13-arm64, so `npx playwright install chromium` fails
 * outright there and case 2 never exists. Driving the installed Chrome is a
 * perfectly good substitute — it is the same engine.
 */
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

const ARGS = ['--no-sandbox'];

export function launchOptions() {
  const pinned = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';
  if (existsSync(pinned)) return { args: ARGS, executablePath: pinned };

  // Playwright's own copy, if `playwright install` was able to fetch one.
  try {
    if (existsSync(chromium.executablePath())) return { args: ARGS };
  } catch { /* no browsers installed at all */ }

  // Fall back to the browser the machine already has.
  return { args: ARGS, channel: 'chrome' };
}

/** Launches with a message that names the fix, rather than an ENOENT. */
export async function launchChromium() {
  const opts = launchOptions();
  try {
    return await chromium.launch(opts);
  } catch (e) {
    throw new Error(
      `Could not start a browser (${e.message.split('\n')[0]}).\n` +
      'Try `npx playwright install chromium`, or install Google Chrome — ' +
      'this falls back to it automatically.'
    );
  }
}
