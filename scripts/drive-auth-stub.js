/* Signed-in stand-in for src/auth/household.js, used only by the browser
   drive script. Everything past the auth gate is the real app. */
const H = '00000000-0000-0000-0000-000000000000';
export const getStoredHouseholdId = () => H;
export const storeHouseholdId = () => {};
export const clearStoredHousehold = () => {};
export const getDeviceId = () => 'drive-device';
export const getSession = async () => ({ user: { id: 'u1', email: 'drive@test.local' } });
export const onAuthChange = () => ({ data: { subscription: { unsubscribe() {} } } });
export const sendSignInLink = async () => {};
export const signOut = async () => {};
export const myHouseholds = async () => [{ id: H, label: 'Seattle Apartment' }];
