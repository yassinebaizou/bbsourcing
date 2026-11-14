/* Language choice (owner rule: English by default; the site changes only when the client changes it).
   - Tapping FR / ع / EN (any [data-lang-switch] link) remembers the choice on this device (localStorage "ddp-lang").
   - An English page opened by a client who chose French or Arabic sends them to the same page in that language.
   - Pages under /fr or /ar never redirect: their address is already a choice.
   Loaded in <head> (no defer) so the redirect happens before the page is drawn. */
(function () {
  var KEY = "ddp-lang", PAGES = { "/": "", "/estimate": "/estimate", "/policies": "/policies", "/terms": "/terms", "/privacy": "/privacy", "/account": "/account" };
  var chosen = null;
  try { chosen = localStorage.getItem(KEY); } catch (e) {}
  var path = location.pathname.replace(/\/+$/, "") || "/";
  if ((chosen === "fr" || chosen === "ar") && Object.prototype.hasOwnProperty.call(PAGES, path)) {
    location.replace("/" + chosen + PAGES[path] + location.search + location.hash);
    return;
  }
  document.addEventListener("click", function (e) {
    var a = e.target && e.target.closest ? e.target.closest("[data-lang-switch]") : null;
    if (!a) return;
    try { localStorage.setItem(KEY, a.getAttribute("data-lang-switch") || "en"); } catch (err) {}
  }, true);
})();
