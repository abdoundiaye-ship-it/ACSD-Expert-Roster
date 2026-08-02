// Shared across every Edge Function in this project. Wildcard origin is
// deliberate: auth is enforced via an explicit `Authorization: Bearer`
// header the browser never attaches automatically cross-origin (no
// cookie-based session here), so a wildcard doesn't create a CSRF-style
// exposure the way it would for a cookie-authenticated API.
export const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
}
