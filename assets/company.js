/* Company details shown on the website (footer, legal pages). One place to edit them.
   Empty fields are not displayed. Fill rc / ice / if / address only with the official values of
   the company that issues the invoices (docs/WORK_PLAN.md D1–D3). */
window.DDP_COMPANY = {
  brand: "DDPSourcing",
  legalName: "Beast Capital Group",
  city: "Casablanca",
  email: "contact@ddpsourcing.com",
  rc: "",       // Registre de Commerce number
  ice: "",      // Identifiant Commun de l'Entreprise
  if: "",       // Identifiant Fiscal
  address: ""   // registered address (shown only in the Terms)
};

/* Fills every element marked data-company-line with the company sentence, and
   data-company-email with the contact email link. Runs once the page is ready. */
(function () {
  "use strict";
  function line() {
    var c = window.DDP_COMPANY, ids = [];
    if (c.rc) ids.push("RC " + c.rc);
    if (c.ice) ids.push("ICE " + c.ice);
    if (c.if) ids.push("IF " + c.if);
    return c.brand + " is a service of " + c.legalName + (c.city ? ", " + c.city : "") + ". Invoices are issued by " + c.legalName + "." +
      (ids.length ? " " + ids.join(" · ") + "." : "");
  }
  function fill() {
    var c = window.DDP_COMPANY;
    document.querySelectorAll("[data-company-line]").forEach(function (el) { el.textContent = line(); });
    document.querySelectorAll("[data-company-legal-name]").forEach(function (el) { el.textContent = c.legalName; });
    document.querySelectorAll("[data-company-city]").forEach(function (el) { el.textContent = c.city; });
    document.querySelectorAll("[data-company-email]").forEach(function (el) {
      if (!c.email) { el.hidden = true; return; }
      el.textContent = c.email;
      if (el.tagName === "A") el.href = "mailto:" + c.email;
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fill); else fill();
})();
