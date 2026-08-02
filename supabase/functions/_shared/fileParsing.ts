export function mimeFromExt(ext: string): string {
  return ({ pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            doc: 'application/msword', txt: 'text/plain' } as Record<string, string>)[ext] ?? 'application/octet-stream'
}

export function toBase64(bytes: Uint8Array): string {
  const CHUNK = 8192
  let bin = ''
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, Math.min(i + CHUNK, bytes.length)))
  }
  return btoa(bin)
}

export function extractDocxText(bytes: Uint8Array): string {
  const raw = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
  const matches = [...raw.matchAll(/<w:t(?:\s[^>]*)?>([^<]+)<\/w:t>/g)]
  if (matches.length > 0) return matches.map(m => m[1]).join(' ').replace(/\s+/g, ' ').trim()
  return raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}
