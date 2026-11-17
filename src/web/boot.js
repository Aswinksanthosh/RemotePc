'use strict'
// Runs first, before anything is painted: after a swipe to another PC the address says which look to start in, so the very first picture has the right colours.
;(function () {
  try {
    var t = new URLSearchParams(location.hash.slice(1)).get('t')
    if (t === 'neon' || t === 'tactical' || t === 'clean') document.body.dataset.theme = t
  } catch (e) {
    // The page picks its own look a moment later.
  }
})()
