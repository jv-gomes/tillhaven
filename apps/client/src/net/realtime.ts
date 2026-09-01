import { io, type Socket } from 'socket.io-client';

/**
 * The trade push channel (T-4.10). One socket for the whole session, opened
 * lazily on first use and left connected — Socket.IO reconnects on its own.
 *
 * This is a NOTIFICATION channel, not an intent one (CLAUDE.md §6): the only
 * thing ever read off it is the bare `trade:changed` event, and the only
 * correct reaction is to re-fetch `GET /api/trade/current`. Nothing here ever
 * sends anything TO the socket — there is no `socket.emit` for a game action
 * anywhere in this file, and there must never be one.
 */

let socket: Socket | null = null;

function ensureConnected(): Socket {
  if (!socket) {
    // Same origin as the REST API, so the session cookie rides along exactly
    // as it does for `fetch` — no token to configure here (see net/api.ts).
    socket = io({ withCredentials: true });
  }
  return socket;
}

/**
 * Calls `listener` every time the socket says a trade changed — including
 * once immediately after every (re)connect, unconditionally (the server's
 * side of T-4.10's "reconnect resyncs rather than replaying": nothing was
 * buffered while disconnected, so every reconnect just asks again).
 *
 * Returns an unsubscribe function.
 */
export function onTradeChanged(listener: () => void): () => void {
  const s = ensureConnected();
  s.on('trade:changed', listener);
  return () => s.off('trade:changed', listener);
}

/** For pages that never open the trade panel — no reason to hold a socket open. */
export function disconnectRealtime(): void {
  socket?.disconnect();
  socket = null;
}
