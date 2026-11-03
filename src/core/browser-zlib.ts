/** just-bash 3.6.0 statically imports node:zlib even from its browser bundle.
 * Keep unsupported codecs explicit; never turn compressed bytes into text.
 */
export function gunzipSync(): never { throw new Error("ENOSYS: gzip decompression is unavailable in this browser runtime"); }
export function gzipSync(): never { throw new Error("ENOSYS: gzip compression is unavailable in this browser runtime"); }
export const constants = Object.freeze({ Z_DEFAULT_COMPRESSION: -1, Z_BEST_COMPRESSION: 9, Z_BEST_SPEED: 1 });
