// src/world/runtime.ts
// Minimal STRUCTURAL typings for the Cloudflare Workers runtime surface we use
// (Durable Objects + WebSocket Hibernation). Same philosophy as D1Like in
// d1-store.ts: the repo deliberately avoids @cloudflare/workers-types so its
// global redefinitions of Request/Response/fetch/WebSocket can't clash with the
// Node-typed request paths in worker-core.ts. We declare only what we touch.

export interface CfWebSocket {
  send(data: string | ArrayBuffer): void;
  close(code?: number, reason?: string): void;
  // Per-socket identity that survives hibernation — the room stores each
  // socket's district + actor here rather than in DO memory.
  serializeAttachment(value: unknown): void;
  deserializeAttachment(): unknown;
}

export interface WebSocketPairLike {
  0: CfWebSocket; // client — returned in the 101 response
  1: CfWebSocket; // server — accepted by the Durable Object
}

export interface DurableObjectStateLike {
  // Hibernation API (compatibility_date 2026-06-01): the runtime, not an idle
  // timer, keeps the socket alive, so the DO can be evicted between messages.
  acceptWebSocket(ws: CfWebSocket, tags?: string[]): void;
  getWebSockets(tag?: string): CfWebSocket[];
}

export interface DurableObjectIdLike {
  toString(): string;
}

export interface DurableObjectStubLike {
  fetch(request: Request): Promise<Response>;
}

export interface DurableObjectNamespaceLike {
  idFromName(name: string): DurableObjectIdLike;
  get(id: DurableObjectIdLike): DurableObjectStubLike;
}
