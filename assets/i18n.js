/* Client account in French (Sprint 7). Loaded in <head> of /account, before the page script.
   The page is the same file for every language; on /fr/account this script:
   - sets <html lang="fr"> and hides the page until the French texts are in place (max 3 s);
   - loads /assets/i18n/fr.json: { "English text": "French text" }. A key with {1}, {2}… is a pattern:
     "Sent on {1}" matches "Sent on 3 November 2026"; each part is translated too when it is itself a key;
   - translates every text, placeholder, title, aria-label and alt now and each time the page changes
     (MutationObserver), and the messages of confirm() and alert();
   - points public links to the French pages (/estimate → /fr/estimate…), shows dates in French.
   Texts inside an element with translate="no" (client messages, product names) are never changed.
   window.DDP_I18N = { lang, t(text) } lets the page translate a text itself. */
(function () {
  "use strict";
  var lang = /^\/fr(\/|$)/.test(location.pathname) ? "fr" : "en";
  var dict = {}, pats = [];
  var api = window.DDP_I18N = { lang: lang, t: function (s) { return s; } };
  if (lang === "en") return;

  var root = document.documentElement;
  root.lang = lang;
  var hide = document.createElement("style");
  hide.textContent = "body{visibility:hidden}";
  document.head.appendChild(hide);
  var shown = false;
  function show() { if (!shown) { shown = true; hide.remove(); } }
  setTimeout(show, 3000);

  // Dates in French wherever the page asks for an English format.
  ["toLocaleDateString", "toLocaleString", "toLocaleTimeString"].forEach(function (m) {
    var orig = Date.prototype[m];
    Date.prototype[m] = function (loc, opt) {
      return orig.call(this, !loc || /^en/i.test(String(loc)) ? "fr-FR" : loc, opt);
    };
  });

  var norm = function (s) { return String(s).replace(/\s+/g, " ").trim(); };
  function lookup(s) {
    var k = norm(s);
    if (!k) return null;
    if (Object.prototype.hasOwnProperty.call(dict, k)) return dict[k];
    for (var i = 0; i < pats.length; i++) {
      var m = pats[i].re.exec(k);
      if (m) return pats[i].fr.replace(/\{(\d)\}/g, function (_, n) { var v = m[pats[i].order.indexOf(n) + 1] || ""; var t = lookup(v); return t === null ? v : t; });
    }
    return null;
  }
  function t(s) {
    var r = lookup(s);
    if (r === null) return s;
    var lead = /^\s*/.exec(s)[0], tail = /\s*$/.exec(s)[0];
    return lead + r + tail;
  }
  api.t = t;

  var PUBLIC = /^\/(account|estimate|policies|terms|privacy)?([?#].*)?$/;
  var ATTRS = ["placeholder", "title", "aria-label", "alt"];
  function skip(el) { return !el || /^(SCRIPT|STYLE|TEXTAREA|NOSCRIPT)$/.test(el.tagName) || !!(el.closest && el.closest('[translate="no"]')); }
  function doEl(el) {
    if (skip(el)) return;
    for (var i = 0; i < ATTRS.length; i++) {
      var v = el.getAttribute(ATTRS[i]);
      if (v) { var r = t(v); if (r !== v) el.setAttribute(ATTRS[i], r); }
    }
    if (el.tagName === "INPUT" && /^(submit|button)$/i.test(el.type) && el.value) { var w = t(el.value); if (w !== el.value) el.value = w; }
    if (el.tagName === "A") {
      var h = el.getAttribute("href");
      var m = h && PUBLIC.exec(h);
      if (m) el.setAttribute("href", "/fr" + (m[1] ? "/" + m[1] : "") + (m[2] || ""));
    }
  }
  function doText(n) {
    if (skip(n.parentElement)) return;
    var r = t(n.nodeValue);
    if (r !== n.nodeValue) n.nodeValue = r;
  }
  function walk(node) {
    if (node.nodeType === 3) return doText(node);
    if (node.nodeType !== 1 || skip(node)) return;
    doEl(node);
    var tw = document.createTreeWalker(node, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) { return n.nodeType === 1 && skip(n) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT; }
    });
    var n;
    while ((n = tw.nextNode())) { if (n.nodeType === 3) doText(n); else doEl(n); }
  }

  ["confirm", "alert"].forEach(function (f) {
    var orig = window[f];
    window[f] = function (msg) { return orig.call(window, t(String(msg == null ? "" : msg))); };
  });

  function start() {
    // The language switch points back to the English page.
    document.querySelectorAll("[data-lang-switch]").forEach(function (a) {
      a.setAttribute("href", location.pathname.replace(/^\/fr(?=\/|$)/, "") || "/");
      a.setAttribute("hreflang", "en"); a.setAttribute("lang", "en"); a.setAttribute("aria-label", "English version");
      a.setAttribute("translate", "no"); a.textContent = "EN";
    });
    walk(document.body);
    new MutationObserver(function (list) {
      list.forEach(function (m) {
        if (m.type === "characterData") doText(m.target);
        else if (m.type === "attributes") doEl(m.target);
        else m.addedNodes.forEach(walk);
      });
    }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS.concat(["href", "value"]) });
    document.title = t(document.title);
    show();
  }
  fetch("/assets/i18n/" + lang + ".json").then(function (r) { return r.ok ? r.json() : {}; }).then(function (d) {
    Object.keys(d).forEach(function (k) {
      if (k.charAt(0) === "_") return;
      if (/\{\d\}/.test(k)) {
        var order = [];
        var src = norm(k).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\{(\d)\\\}/g, function (_, n) { order.push(n); return "(.+?)"; });
        pats.push({ re: new RegExp("^" + src + "$"), fr: d[k], order: order, lit: k.replace(/\{\d\}/g, "").length });
      } else dict[norm(k)] = d[k];
    });
    // The most specific patterns first: "{1} per unit × {2} units" before "{1} units".
    pats.sort(function (a, b) { return b.lit - a.lit; });
    if (document.body) start(); else document.addEventListener("DOMContentLoaded", start);
  }).catch(show);
})();
