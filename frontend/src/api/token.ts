// Single source of truth for the auth token.
//
// "Remember me" selects WHERE the token lives:
//   - remember = true  -> localStorage   (persists across browser restarts)
//   - remember = false -> sessionStorage (cleared when the tab/window closes)
//
// Reads check both stores so existing logins keep working, and writes always
// clear the other store first so a token never lingers in two places.

const KEY = 'wiq_token';

export function getToken(): string | null {
  return localStorage.getItem(KEY) ?? sessionStorage.getItem(KEY);
}

export function setToken(token: string, remember: boolean): void {
  // Drop any prior copy in either store, then write to the chosen one.
  localStorage.removeItem(KEY);
  sessionStorage.removeItem(KEY);
  (remember ? localStorage : sessionStorage).setItem(KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(KEY);
  sessionStorage.removeItem(KEY);
}
