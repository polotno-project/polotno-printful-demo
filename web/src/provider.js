// The print step talks to Printful for real through the backend in
// ../server, which holds the API credentials:
//
//   - the print area on the shirt takes Printful's real print file size
//   - "Send to Printful" exports the artwork and shows what Printful returns
//
// Nothing is ordered.

export const PROVIDER = { id: 'printful', name: 'Printful', send: 'mockups' };

const API = (import.meta.env.VITE_POD_API || 'http://localhost:8787').replace(/\/$/, '');

async function call(path, options) {
  const res = await fetch(API + path, options);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `${PROVIDER.name} request failed`);
  return json;
}

/** The provider's print area for the demo tee: { areas: { front, back }, request }. */
export const fetchPrintArea = (colorId) =>
  call(`/${PROVIDER.id}/print-area?color=${encodeURIComponent(colorId)}`);

/**
 * Send the exported sides; returns { mockups: [{ side, url }], requests } and,
 * for Teemill, the productUrl of the page it created.
 */
export const sendDesign = (files, colorId) =>
  call(`/${PROVIDER.id}/${PROVIDER.send}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ color: colorId, files }),
  });
