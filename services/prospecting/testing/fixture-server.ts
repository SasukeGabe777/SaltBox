/**
 * Deterministic local HTTP server for fixtures and analyzer tests. Binds to
 * 127.0.0.1 on an ephemeral port; callers pass allowPrivateNetworks to the
 * analyzer because these are intentionally loopback destinations.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

export type FixtureHandler = (req: IncomingMessage, res: ServerResponse) => void;

export interface LocalSite {
  url: string;
  close: () => Promise<void>;
}

export async function serveLocalSite(handler: FixtureHandler): Promise<LocalSite> {
  const server: Server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("fixture server failed to bind to an ephemeral port");
  }
  return {
    url: `http://127.0.0.1:${address.port}/`,
    close: () => new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
  };
}

export function htmlHandler(html: string): FixtureHandler {
  return (_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(html);
  };
}
