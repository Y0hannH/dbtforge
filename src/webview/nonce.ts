const NONCE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** Per-render nonce so a webview's CSP can allow its own scripts and nothing else. */
export function getNonce(): string {
  let text = '';
  for (let i = 0; i < 32; i++) text += NONCE_CHARS.charAt(Math.floor(Math.random() * NONCE_CHARS.length));
  return text;
}
