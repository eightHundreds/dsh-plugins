import { readFile } from 'node:fs/promises'
import { resolve, sep, extname } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'

const types: Record<string, string> = { '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.ttf': 'font/ttf' }

/** Serve only packaged assets below the fixed route, never workspace files. */
export function assetHandler(root: string, prefix: string) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); return
    }
    let path: string
    try { path = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname) }
    catch { res.writeHead(400); res.end(); return }
    const target = resolve(root, '.' + path.slice(prefix.length))
    if (!path.startsWith(prefix + '/') || !target.startsWith(root + sep)) {
      res.writeHead(403); res.end(); return
    }
    try {
      const bytes = await readFile(target)
      res.writeHead(200, { 'content-type': types[extname(target)] ?? 'application/octet-stream', 'cache-control': 'no-cache', 'content-length': bytes.length })
      res.end(req.method === 'HEAD' ? undefined : bytes)
    } catch { res.writeHead(404); res.end() }
  }
}
