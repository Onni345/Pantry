import { supabase, isConfigured } from '../db/supabaseClient.js';

/**
 * Sign-in and household resolution.
 *
 * There are no join codes. A person signs in with their email address, and
 * the database decides which households that address is allowed to reach.
 * Knowing a household's id grants nothing — there is nothing to redeem.
 */

const HOUSEHOLD_KEY = 'pantry.household_id';
const DEVICE_KEY = 'pantry.device_id';

const read = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } };

/** The household this device last used. Only a convenience — never a permission. */
export const getStoredHouseholdId = () => read(HOUSEHOLD_KEY);
export const storeHouseholdId = (id) => write(HOUSEHOLD_KEY, id);

export function clearStoredHousehold() {
  try { localStorage.removeItem(HOUSEHOLD_KEY); } catch { /* storage blocked */ }
}

/** Stable per-device id, used only for the audit column on events. */
export function getDeviceId() {
  let id = read(DEVICE_KEY);
  if (!id) {
    id = crypto.randomUUID();
    write(DEVICE_KEY, id);
  }
  return id;
}

export async function getSession() {
  if (!isConfigured) return null;
  const { data } = await supabase.auth.getSession();
  return data?.session ?? null;
}

export const onAuthChange = (fn) => supabase.auth.onAuthStateChange((_e, session) => fn(session));

/**
 * Emails a 6-digit sign-in code (Supabase's own OTP flow — the same request
 * also puts a clickable link in the email by default, but nothing here reads
 * or depends on it; the code from `verifySignInCode` below is the only path
 * this app uses). Deliberately reports success even for an address that is
 * not on any allowlist: telling a stranger "that address isn't recognised"
 * would turn this box into a way to test who is.
 */
export async function sendSignInCode(rawEmail) {
  const email = String(rawEmail || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new Error('That does not look like an email address.');
  }

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin + window.location.pathname }
  });

  if (error) {
    if (/rate/i.test(error.message)) {
      throw new Error('Too many attempts just now. Wait a minute and try again.');
    }
    throw error;
  }
  return email;
}

/**
 * Verifies the 6-digit code from the same email `sendSignInCode` sent,
 * entirely inside whatever tab is already open.
 *
 * This exists because of an iOS quirk: tapping the magic link opens Safari,
 * not the installed home-screen PWA — they are separate storage contexts on
 * iOS even though they're the same site, so a session created by the link
 * never reaches the PWA at all, and it re-asks for sign-in every time it's
 * opened. Typing the code instead never navigates anywhere, so the session
 * lands directly in whichever context — Safari tab or installed PWA — the
 * person is actually using. `persistSession`/`autoRefreshToken` are already
 * on, so once the session exists in the right place, it just stays there.
 */
export async function verifySignInCode(rawEmail, rawCode) {
  const email = String(rawEmail || '').trim().toLowerCase();
  const token = String(rawCode || '').trim();
  if (!/^\d{4,8}$/.test(token)) {
    throw new Error('That code should just be the digits from the email.');
  }

  const { error } = await supabase.auth.verifyOtp({ email, token, type: 'email' });
  if (error) {
    throw /expired|invalid/i.test(error.message)
      ? new Error('That code is wrong or has expired. Request a new one.')
      : error;
  }
}

export async function signOut() {
  clearStoredHousehold();
  await supabase.auth.signOut();
}

/**
 * Households this signed-in address may reach.
 *
 * The list comes from the database, which returns only rows matching the
 * email inside the session token. A device cannot widen it by asking.
 */
export async function myHouseholds() {
  const { data: rows, error } = await supabase
    .from('household_allowlist')
    .select('household_id, households(id, name)');

  if (error) throw error;

  return (rows || [])
    .map((r) => ({
      id: r.household_id,
      name: r.households?.name || 'Household'
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
