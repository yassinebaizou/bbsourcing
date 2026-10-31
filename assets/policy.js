/* Business rules shown to clients: one place for every number, read by /policies, /terms and the homepage FAQ,
   so the pages can never disagree (docs/WORK_PLAN.md decisions D6–D17).
   The rule numbers (quote validity, refund days, claim hours, storage fee…) are edited in CRM → Settings
   (table business_settings). The values below are the static fallback written in the HTML; on load, the
   live values are read from the database (public_settings) and replace them. Keep both equal when you
   change a rule, so the page reads correctly without JavaScript too.
   null = not decided yet: the sentence that needs it is hidden. */
window.DDP_POLICY = {
  termsVersion: "2026-11-v1",
  lastUpdated: "31 October 2026",
  depositPct: 40,                 // paid after accepting the quote
  balancePct: 60,                 // paid after customs clearance, before delivery
  quoteValidityDays: 7,           // D8
  deliveryDays: "15 to 20",       // express air, from the verified deposit
  paymentMethod: "bank transfer", // D7: bank transfer only
  bankName: "CFG Bank",           // D6: account in the company name
  refundBusinessDays: 7,          // D17 (default, to confirm)
  delayGraceDays: 10,             // D14 (default, to confirm)
  claimHours: 72,                 // D16 (default, to confirm)
  storageFeeAfterDays: 7,         // D15 (default, to confirm)
  unpaidCancelAfterDays: 30,      // D15 (default, to confirm)
  storageFeeMad: null             // D15: amount set by the owner (hidden until then)
};

/* Fills [data-policy="key"] with the value, hides [data-policy-if="key"] blocks whose value is null,
   and fills [data-company-details] with the legal identity of the company (empty fields skipped). */
(function () {
  "use strict";
  function fill() {
    var p = window.DDP_POLICY, c = window.DDP_COMPANY || {};
    document.querySelectorAll("[data-policy]").forEach(function (el) {
      var v = p[el.getAttribute("data-policy")];
      if (v !== null && v !== undefined) el.textContent = String(v);
    });
    document.querySelectorAll("[data-policy-if]").forEach(function (el) {
      var v = p[el.getAttribute("data-policy-if")];
      el.hidden = v === null || v === undefined || v === "";
    });
    document.querySelectorAll("[data-company-details]").forEach(function (el) {
      var parts = [c.legalName, c.address || c.city];
      if (c.rc) parts.push("RC " + c.rc);
      if (c.ice) parts.push("ICE " + c.ice);
      if (c.if) parts.push("IF " + c.if);
      el.textContent = parts.filter(Boolean).join(", ");
    });
  }
  // Live values from CRM → Settings (no bank account details: public_settings never returns them).
  function live() {
    var cfg = window.DDP_CONFIG;
    if (!cfg || !window.fetch || !document.querySelector("[data-policy],[data-policy-if]")) return;
    fetch(cfg.SUPABASE_URL + "/rest/v1/rpc/public_settings", {
      method: "POST", body: "{}",
      headers: { apikey: cfg.SUPABASE_ANON_KEY, "Content-Type": "application/json" }
    }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      if (!d || typeof d !== "object") return;
      Object.keys(d).forEach(function (k) { if (k in window.DDP_POLICY) window.DDP_POLICY[k] = d[k]; });
      fill();
    }).catch(function () {});
  }
  function start() { fill(); live(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
