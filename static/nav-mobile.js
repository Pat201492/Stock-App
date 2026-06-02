// Injects a hamburger toggle into the shared <nav> for mobile. CSS (style.css
// @media <=760px) hides the links by default and shows them as a dropdown when
// <nav> has the .open class.
(function () {
  function init() {
    const nav = document.querySelector("nav");
    if (!nav || nav.querySelector(".nav-toggle")) return;
    const btn = document.createElement("button");
    btn.className = "nav-toggle";
    btn.setAttribute("aria-label", "Menu");
    btn.innerHTML = "☰";
    btn.addEventListener("click", () => nav.classList.toggle("open"));
    const brand = nav.querySelector(".nav-brand");
    if (brand && brand.nextSibling) nav.insertBefore(btn, brand.nextSibling);
    else nav.appendChild(btn);
    // close the menu after tapping a link
    nav.querySelectorAll(".nav-links a").forEach(a =>
      a.addEventListener("click", () => nav.classList.remove("open")));
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
