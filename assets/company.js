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
  address: "",  // registered address (shown only in the Terms)

  // "Who we are" on the homepage (D20). The founder block stays hidden until name AND story are filled.
  founderName: "",   // e.g. "Yassine Baizou"
  founderRole: "",   // e.g. "Founder"
  founderPhoto: "",  // e.g. "/assets/proof/founder.webp" (square photo, put the file in assets/proof)
  founderStory: "",  // 3 or 4 short sentences, in your own words
  founderRoleFr: "",  // French version for /fr (empty = the English text is used)
  founderStoryFr: "",
  founderRoleAr: "",  // Arabic version for /ar (empty = the English text is used)
  founderStoryAr: "",

  // Social links in the footer: full https:// addresses. Empty = not shown.
  social: { instagram: "", facebook: "", tiktok: "", youtube: "", linkedin: "" }
};

/* Fills every element marked data-company-line with the company sentence, and
   data-company-email with the contact email link. Runs once the page is ready. */
(function () {
  "use strict";
  function fr() { return /^fr/i.test(document.documentElement.lang || ""); }
  function ar() { return /^ar/i.test(document.documentElement.lang || ""); }
  function line() {
    var c = window.DDP_COMPANY, ids = [];
    if (c.rc) ids.push("RC " + c.rc);
    if (c.ice) ids.push("ICE " + c.ice);
    if (c.if) ids.push("IF " + c.if);
    if (ar()) return c.brand + " خدمة تابعة لشركة " + c.legalName + (c.city ? "، " + c.city : "") + ". تصدر الفواتير باسم " + c.legalName + "." +
      (ids.length ? " " + ids.join(" · ") + "." : "");
    if (fr()) return c.brand + " est un service de " + c.legalName + (c.city ? ", " + c.city : "") + ". Les factures sont émises par " + c.legalName + "." +
      (ids.length ? " " + ids.join(" · ") + "." : "");
    return c.brand + " is a service of " + c.legalName + (c.city ? ", " + c.city : "") + ". Invoices are issued by " + c.legalName + "." +
      (ids.length ? " " + ids.join(" · ") + "." : "");
  }
  function fill() {
    var c = window.DDP_COMPANY;
    document.querySelectorAll("[data-company-line]").forEach(function (el) { el.textContent = line(); });
    document.querySelectorAll("[data-company-legal-name]").forEach(function (el) { el.textContent = c.legalName; });
    document.querySelectorAll("[data-company-city]").forEach(function (el) { el.textContent = c.city; });
    var ids = [];
    if (c.rc) ids.push("RC " + c.rc);
    if (c.ice) ids.push("ICE " + c.ice);
    if (c.if) ids.push("IF " + c.if);
    document.querySelectorAll("[data-company-ids]").forEach(function (el) { el.textContent = ids.join(" · "); el.hidden = !ids.length; });
    // Founder (homepage "Who we are"): shown only when the owner filled the name and the story.
    var hasFounder = !!(c.founderName && c.founderStory);
    document.querySelectorAll("[data-founder]").forEach(function (el) { el.hidden = !hasFounder; });
    document.querySelectorAll("[data-founder-story]").forEach(function (el) { el.textContent = (fr() && c.founderStoryFr) || (ar() && c.founderStoryAr) || c.founderStory || ""; el.hidden = !hasFounder; });
    document.querySelectorAll("[data-founder-name]").forEach(function (el) { el.textContent = c.founderName || ""; });
    document.querySelectorAll("[data-founder-role]").forEach(function (el) { el.textContent = (fr() && c.founderRoleFr) || (ar() && c.founderRoleAr) || c.founderRole || ""; });
    document.querySelectorAll("[data-founder-photo]").forEach(function (el) {
      if (hasFounder && c.founderPhoto) { el.src = c.founderPhoto; el.alt = c.founderName; } else el.remove();
    });
    // Social links: only https addresses that are filled.
    var names = { instagram: "Instagram", facebook: "Facebook", tiktok: "TikTok", youtube: "YouTube", linkedin: "LinkedIn" };
    document.querySelectorAll("[data-social]").forEach(function (ul) {
      ul.textContent = "";
      Object.keys(names).forEach(function (k) {
        var u = c.social && c.social[k];
        if (!u || !/^https:\/\/[^\s"'<>]+$/.test(u)) return;
        var li = document.createElement("li"), a = document.createElement("a");
        a.href = u; a.target = "_blank"; a.rel = "noopener"; a.textContent = names[k];
        li.appendChild(a); ul.appendChild(li);
      });
      ul.hidden = !ul.children.length;
    });
    document.querySelectorAll("[data-company-email]").forEach(function (el) {
      if (!c.email) { el.hidden = true; return; }
      el.textContent = c.email;
      if (el.tagName === "A") el.href = "mailto:" + c.email;
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fill); else fill();
})();
