/* Business rules shown to clients: one place for every number, read by /policies, /terms and the homepage FAQ,
   so the pages can never disagree (docs/WORK_PLAN.md decisions D6–D17).
   Sprint 3 moves these values to the business_settings table (CRM → Settings); until then, edit them here.
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
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fill); else fill();
})();
