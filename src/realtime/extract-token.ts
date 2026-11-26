/** Lấy JWT từ handshake Socket.IO: auth.token (ưu tiên) hoặc header Authorization: Bearer. */
export function extractToken(client: {
  handshake: { auth?: Record<string, unknown>; headers?: Record<string, unknown> };
}): string | null {
  const fromAuth = client.handshake.auth?.token;
  if (typeof fromAuth === 'string' && fromAuth.length > 0) return fromAuth;
  const header = client.handshake.headers?.authorization;
  if (typeof header === 'string' && header.startsWith('Bearer ')) return header.slice(7);
  return null;
}
