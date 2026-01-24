(function () {
  // Mobile nav
  const toggle = document.getElementById("navToggle");
  const nav = document.getElementById("nav");

  if (toggle && nav) {
    toggle.addEventListener("click", () => {
      const open = nav.classList.toggle("open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });

    // Close menu when clicking a link (mobile)
    nav.querySelectorAll("a").forEach((a) => {
      a.addEventListener("click", () => {
        nav.classList.remove("open");
        toggle.setAttribute("aria-expanded", "false");
      });
    });
  }

  // Footer year
  const y = document.getElementById("year");
  if (y) y.textContent = new Date().getFullYear();

  // Copy “setup message” helper
  const copyBtn = document.getElementById("copyEmailBtn");
  if (copyBtn) {
    copyBtn.addEventListener("click", async () => {
      const biz = (document.getElementById("biz")?.value || "").trim();
      const emps = (document.getElementById("emps")?.value || "").trim();
      const notes = (document.getElementById("notes")?.value || "").trim();

      const msg =
`RevTags Setup Request

Business: ${biz || "(business name)"}
Employees: ${emps || "(employee names)"}
Notes: ${notes || "(optional notes)"}

Google review links/place IDs:
- (paste Google review link for each employee/business)

Shipping address:
- (name)
- (street)
- (city, state zip)

Thanks!`;

      try {
        if (navigator.clipboard && window.isSecureContext) {
          await navigator.clipboard.writeText(msg);
          copyBtn.textContent = "Copied ✓";
          setTimeout(() => (copyBtn.textContent = "Copy setup message"), 1400);
          return;
        }
      } catch (e) {}

      // Fallback
      const ta = document.createElement("textarea");
      ta.value = msg;
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, ta.value.length);
      document.execCommand("copy");
      document.body.removeChild(ta);

      copyBtn.textContent = "Copied ✓";
      setTimeout(() => (copyBtn.textContent = "Copy setup message"), 1400);
    });
  }
})();
