document.documentElement.classList.add('js');

// ---------- Conversão do Google Ads: clique em qualquer link de WhatsApp ----------
document.addEventListener('click', (e) => {
  const link = e.target.closest('a[href*="wa.me/"]');
  if (!link || typeof window.gtag !== 'function' || !window.CONVERSAO_WHATSAPP) return;
  window.gtag('event', 'conversion', { send_to: window.CONVERSAO_WHATSAPP, transport_type: 'beacon' });
});

// ---------- Cabeçalho ao rolar ----------
const header = document.getElementById('site-header');
const onScroll = () => header.classList.toggle('scrolled', window.scrollY > 30);
window.addEventListener('scroll', onScroll, { passive: true });
onScroll();

// ---------- Menu mobile ----------
const burger = document.getElementById('burger');
const panel = document.getElementById('mobilePanel');
const setMenu = (open) => {
  panel.classList.toggle('open', open);
  burger.classList.toggle('open', open);
  burger.setAttribute('aria-expanded', open ? 'true' : 'false');
  burger.setAttribute('aria-label', open ? 'Fechar menu' : 'Abrir menu');
  document.body.classList.toggle('menu-open', open);
  document.body.style.overflow = open ? 'hidden' : '';
};
burger.addEventListener('click', () => setMenu(!panel.classList.contains('open')));
panel.querySelectorAll('a').forEach((a) => a.addEventListener('click', () => setMenu(false)));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && panel.classList.contains('open')) { setMenu(false); burger.focus(); }
});
window.matchMedia('(min-width: 981px)').addEventListener('change', (e) => { if (e.matches) setMenu(false); });

// ---------- Animação de entrada ----------
const revealEls = document.querySelectorAll('.reveal');
if ('IntersectionObserver' in window) {
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
  revealEls.forEach((el) => io.observe(el));
} else {
  revealEls.forEach((el) => el.classList.add('in'));
}

// ---------- Item ativo no menu ----------
const navLinks = [...document.querySelectorAll('.main-nav a')];
const sections = navLinks.map((a) => document.querySelector(a.getAttribute('href'))).filter(Boolean);
if ('IntersectionObserver' in window && sections.length) {
  const spy = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      navLinks.forEach((a) => a.classList.toggle('active', a.getAttribute('href') === '#' + e.target.id));
    });
  }, { rootMargin: '-45% 0px -50% 0px' });
  sections.forEach((s) => spy.observe(s));
}

// ---------- Depoimentos: indicadores do carrossel ----------
const track = document.getElementById('testTrack');
const dotsWrap = document.getElementById('testDots');
if (track && dotsWrap) {
  const cards = [...track.children];
  const dots = cards.map((card, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.tabIndex = -1;
    b.addEventListener('click', () => track.scrollTo({ left: card.offsetLeft - track.offsetLeft, behavior: 'smooth' }));
    dotsWrap.appendChild(b);
    return b;
  });
  const update = () => {
    const visible = Math.max(1, Math.round(track.clientWidth / cards[0].offsetWidth));
    const maxStart = Math.max(0, cards.length - visible);
    const start = Math.min(maxStart, Math.round(track.scrollLeft / (cards[0].offsetWidth + 20)));
    dots.forEach((d, i) => {
      d.hidden = i > maxStart;
      d.classList.toggle('active', i === start);
    });
  };
  track.addEventListener('scroll', () => requestAnimationFrame(update), { passive: true });
  window.addEventListener('resize', update);
  update();
}

// ---------- Lightbox dos resultados ----------
const lb = document.getElementById('lightbox');
const zoomBtns = [...document.querySelectorAll('.result-zoom')];
if (lb && zoomBtns.length && typeof lb.showModal === 'function') {
  const lbImg = lb.querySelector('img');
  const lbCap = lb.querySelector('figcaption');
  let current = 0;
  const show = (i) => {
    current = (i + zoomBtns.length) % zoomBtns.length;
    const b = zoomBtns[current];
    lbImg.src = b.dataset.full;
    lbImg.alt = b.querySelector('img').alt;
    lbCap.textContent = b.dataset.caption;
  };
  zoomBtns.forEach((b, i) => b.addEventListener('click', () => { show(i); lb.showModal(); }));
  lb.querySelector('.lb-close').addEventListener('click', () => lb.close());
  lb.querySelector('.lb-prev').addEventListener('click', () => show(current - 1));
  lb.querySelector('.lb-next').addEventListener('click', () => show(current + 1));
  lb.addEventListener('click', (e) => { if (e.target === lb) lb.close(); });
  lb.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') show(current - 1);
    if (e.key === 'ArrowRight') show(current + 1);
  });
  lb.addEventListener('close', () => zoomBtns[current].focus());
}

// ---------- Pop-up de promoção ----------
// Abre sempre que o site é carregado e some sozinho após a data em data-ate.
const promo = document.getElementById('promo');
if (promo) {
  const ate = promo.dataset.ate;
  const vigente = !ate || new Date() <= new Date(ate + 'T23:59:59');
  const nativo = typeof promo.showModal === 'function';
  const fechar = () => {
    if (nativo) promo.close();
    else { promo.removeAttribute('open'); promo.classList.remove('promo-fallback'); document.body.style.overflow = ''; }
  };
  if (vigente) {
    if (nativo) promo.showModal();
    else promo.setAttribute('open', ''), promo.classList.add('promo-fallback'); // navegadores antigos
    document.body.style.overflow = 'hidden';
  }
  promo.querySelectorAll('.promo-close, .promo-skip').forEach((b) => b.addEventListener('click', fechar));
  promo.addEventListener('click', (e) => { if (e.target === promo) fechar(); });
  promo.addEventListener('close', () => { document.body.style.overflow = ''; });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && promo.hasAttribute('open') && !nativo) fechar(); });
}
