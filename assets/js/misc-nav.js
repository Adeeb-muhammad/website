const menu = document.querySelector('#mobile-nav');
const toggle = document.querySelector('.menu-toggle');
const main = document.querySelector('#main');
const year = document.querySelector('#copyright-year');
if (year) year.textContent = new Date().getFullYear();

function closeMenu(restoreFocus = false) {
  const wasOpen = !menu.hidden;
  menu.hidden = true;
  main.inert = false;
  document.body.classList.remove('nav-open');
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-label', 'Open navigation');
  if (wasOpen && restoreFocus) toggle.focus();
}
toggle.addEventListener('click', () => {
  if (!menu.hidden) return closeMenu();
  menu.hidden = false;
  main.inert = true;
  document.body.classList.add('nav-open');
  toggle.setAttribute('aria-expanded', 'true');
  toggle.setAttribute('aria-label', 'Close navigation');
  menu.querySelector('a').focus();
});
menu.addEventListener('click', event => { if (event.target.closest('a')) closeMenu(); });
document.addEventListener('click', event => { if (!menu.hidden && !event.target.closest('#mobile-nav, .menu-toggle')) closeMenu(); });
document.addEventListener('keydown', event => { if (event.key === 'Escape' && !menu.hidden) { event.preventDefault(); closeMenu(true); } });
window.matchMedia('(max-width: 1100px)').addEventListener('change', event => { if (!event.matches) closeMenu(); });
