// Polyfill crypto.randomUUID for browsers that lack it (e.g. insecure HTTP contexts).
// Required to prevent Next.js client router crash. See commit 9bf1748.
if (typeof window !== 'undefined' && window.crypto && !window.crypto.randomUUID) {
  window.crypto.randomUUID = function () {
    return '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, function (c) {
      return (
        c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))
      ).toString(16);
    });
  };
}
