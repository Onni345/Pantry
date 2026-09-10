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
 * Emails a sign-in link. Deliberately reports success even for an address
 * that is not on any allowlist: telling a stranger "that address isn't
 * recognised" would turn this box into a way to test who is.
 */
export async function sendSignInLink(rawEmail) {
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
