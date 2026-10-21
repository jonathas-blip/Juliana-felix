document.documentElement.classList.add('js');

const ehLocal = /^(localhost|127\.|\[::1\])/.test(location.hostname);
const guarda = (tipo, chave, valor) => { try { window[tipo].setItem(chave, valor); } catch (e) { /* modo privado */ } };
const le = (tipo, chave) => { try { return window[tipo].getItem(chave); } catch (e) { return null; } };

// ---------- Conversão do Google Ads: quando a pessoa realmente segue para o WhatsApp ----------
const converteAds = () => {
  if (ehLocal || typeof window.gtag !== 'function' || !window.CONVERSAO_WHATSAPP) return; // testes locais não contam
  window.gtag('event', 'conversion', { send_to: window.CONVERSAO_WHATSAPP, transport_type: 'beacon' });
};

// Qual botão de WhatsApp foi clicado
const localDoBotao = (a) => {
  if (a.closest('.wa-float')) return 'Botão flutuante';
  if (a.closest('#promo')) return 'Pop-up de promoção';
  const card = a.closest('.proc-card');
  if (card) return 'Procedimento: ' + ((card.querySelector('h3') || {}).textContent || '').trim();
  if (a.closest('.site-header')) return 'Cabeçalho';
  if (a.closest('.mobile-panel')) return 'Menu do celular';
  if (a.closest('.hero')) return 'Topo do site';
  if (a.closest('.proc-note')) return 'Não sabe qual escolher';
  if (a.closest('#quem-sou')) return 'Quem sou';
  if (a.closest('#duvidas')) return 'Perguntas frequentes';
  if (a.closest('.cta-block')) return 'Chamada final';
  if (a.closest('#contato')) return 'Seção de contato';
  if (a.closest('.site-footer')) return 'Rodapé';
  return 'Outro';
};

// ---------- Monitoramento próprio: visitas e cliques no WhatsApp (painel/) ----------
// Eventos não guardam dado pessoal. Para não contar seus próprios acessos, abra o site
// uma vez com ?naocontar no endereço (vale para aquele navegador).
const monitor = (() => {
  const url = window.MONITOR_URL;
  const params = new URLSearchParams(location.search);
  if (params.has('naocontar')) guarda('localStorage', 'naoContar', '1');
  const ativo = !!url && !navigator.webdriver && !ehLocal && !le('localStorage', 'naoContar');

  const origemDaVisita = () => {
    const medium = (params.get('utm_medium') || '').toLowerCase();
    if (params.has('gclid') || params.has('gbraid') || params.has('wbraid') || /^(cpc|ppc|paid)/.test(medium)) return 'google_ads';
    if (params.get('utm_source')) return params.get('utm_source').toLowerCase().slice(0, 30);
    let host = '';
    try { host = document.referrer ? new URL(document.referrer).hostname.replace(/^www\./, '') : ''; } catch (e) { /* referrer inválido */ }
    if (!host || host === location.hostname.replace(/^www\./, '')) return 'direto';
    if (/google\./.test(host)) return 'google_organico';
    if (/instagram\./.test(host)) return 'instagram';
    if (/facebook\.|fb\./.test(host)) return 'facebook';
    if (/whatsapp\./.test(host)) return 'whatsapp';
    return host.slice(0, 30);
  };

  const sessao = le('sessionStorage', 'mSessao') || Math.random().toString(36).slice(2, 10);
  const origem = le('sessionStorage', 'mOrigem') || origemDaVisita();
  guarda('sessionStorage', 'mSessao', sessao);
  guarda('sessionStorage', 'mOrigem', origem);
  // Palavra pesquisada no Google que trouxe a visita (vem do anúncio: ?utm_term={keyword})
  const termo = le('sessionStorage', 'mTermo') || (params.get('utm_term') || params.get('kw') || '').toLowerCase().slice(0, 80);
  guarda('sessionStorage', 'mTermo', termo);
  const dispositivo = window.matchMedia('(max-width: 820px)').matches ? 'celular' : 'computador';

  const posta = (endereco, dados) => {
    const corpo = JSON.stringify(dados);
    try {
      if (navigator.sendBeacon && navigator.sendBeacon(endereco, new Blob([corpo], { type: 'text/plain' }))) return;
    } catch (e) { /* cai no fetch */ }
    fetch(endereco, { method: 'POST', mode: 'no-cors', keepalive: true, body: corpo }).catch(() => {});
  };
  const envia = (tipo, local) => {
    if (ativo) posta(url, { t: tipo, l: local || '', o: origem, d: dispositivo, p: location.pathname, s: sessao, k: termo });
  };
  // Cadastro (nome e WhatsApp) vai para uma lista separada, só visível no painel com senha
  const enviaCadastro = (nome, whatsapp, local) => {
    if (url && !ehLocal && !navigator.webdriver) posta(url.replace(/\/api\/?$/, '/api/lead'), { n: nome, w: whatsapp, o: origem, l: local || '', d: dispositivo, s: sessao });
  };

  // Uma visita por sessão (abrir várias páginas/recarregar não conta de novo)
  if (ativo && !le('sessionStorage', 'mVisita')) { envia('visita'); guarda('sessionStorage', 'mVisita', '1'); }
  return { envia, enviaCadastro };
})();

// ---------- Abrir o WhatsApp ----------
// No celular o link abre o app direto. No computador, o wa.me mostra uma página
// intermediária onde muita gente desiste; lá mostramos o QR code e o WhatsApp Web.
const abreWhatsApp = (() => {
  const modal = document.getElementById('waModal');
  const computador = () => window.matchMedia('(hover: hover) and (pointer: fine)').matches && !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  let carregando = null;
  const carregaQr = () => carregando || (carregando = new Promise((ok, erro) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
    s.integrity = 'sha512-CNgIRecGo7nphbeZ04Sc13ka07paqdeTu0WR1IM4kNcpmBAUSHSQX0FslNhTDadL4O5SAGapGt4FodqL8My0mA==';
    s.crossOrigin = 'anonymous';
    s.onload = ok; s.onerror = erro;
    document.head.appendChild(s);
  }));
  if (modal && typeof modal.showModal === 'function') {
    modal.querySelector('.wa-modal-fechar').addEventListener('click', () => modal.close());
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.close(); });
    modal.querySelectorAll('#waWeb, #waApp').forEach((a) => a.addEventListener('click', () => setTimeout(() => modal.close(), 300)));
  }

  return (href) => {
    if (!modal || typeof modal.showModal !== 'function' || !computador()) { location.href = href; return; }
    const url = new URL(href);
    const numero = url.pathname.replace(/\D/g, '');
    const texto = url.searchParams.get('text') || '';
    const q = '?phone=' + numero + (texto ? '&text=' + encodeURIComponent(texto) : '');
    document.getElementById('waWeb').href = 'https://web.whatsapp.com/send' + q;
    document.getElementById('waApp').href = 'whatsapp://send' + q;
    const caixa = document.getElementById('waQr');
    caixa.innerHTML = '';
    caixa.hidden = false;
    carregaQr().then(() => {
      new window.QRCode(caixa, { text: href, width: 200, height: 200, colorDark: '#171717', colorLight: '#ffffff', correctLevel: window.QRCode.CorrectLevel.L });
    }).catch(() => { caixa.hidden = true; });
    modal.showModal();
  };
})();

// ---------- Cadastro antes do WhatsApp ----------
// Ao clicar em qualquer botão de WhatsApp, abre uma janela pedindo nome e WhatsApp
// (para promoções e contato). Quem já se cadastrou neste navegador vai direto.
(() => {
  const janela = document.getElementById('cadastro');
  const form = document.getElementById('cadastroForm');
  const campoNome = document.getElementById('cadNome');
  const campoTel = document.getElementById('cadTel');
  const erro = document.getElementById('cadErro');
  let destino = null;
  let botao = '';
  // Navegadores antigos (iOS antes do 15.4) não têm <dialog>: abre como camada fixa
  const nativo = !!janela && typeof janela.showModal === 'function';
  const aberta = () => !!janela && janela.hasAttribute('open');
  const abrir = () => { if (nativo) janela.showModal(); else { janela.setAttribute('open', ''); janela.classList.add('cad-fallback'); } };
  const fechar = () => { if (!janela) return; if (nativo) janela.close(); else { janela.removeAttribute('open'); janela.classList.remove('cad-fallback'); } };

  const seguir = () => {
    converteAds();
    monitor.envia('whatsapp_aberto', botao);
    if (aberta()) fechar();
    abreWhatsApp(destino);
  };

  // (11) 91234-5678
  const formata = (v) => {
    const d = v.replace(/\D/g, '').slice(0, 11);
    if (d.length <= 2) return d ? '(' + d : '';
    if (d.length <= 6) return '(' + d.slice(0, 2) + ') ' + d.slice(2);
    if (d.length <= 10) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 6) + '-' + d.slice(6);
    return '(' + d.slice(0, 2) + ') ' + d.slice(2, 7) + '-' + d.slice(7);
  };
  const telefoneValido = (d) => (d.length === 10 || d.length === 11) && Number(d.slice(0, 2)) >= 11 && (d.length === 10 || d[2] === '9');

  document.addEventListener('click', (e) => {
    const link = e.target.closest('a[href*="wa.me/"]');
    if (!link) return;
    e.preventDefault();
    destino = link.href;
    botao = localDoBotao(link);
    monitor.envia('clique_whatsapp', botao);
    if (!janela || le('localStorage', 'jfCadastro')) { seguir(); return; }
    erro.textContent = '';
    if (document.getElementById('promo') && document.getElementById('promo').open) document.getElementById('promo').close();
    abrir();
    setTimeout(() => campoNome.focus(), 50);
  }, true);

  if (!janela || !form) return;
  campoTel.addEventListener('input', () => { campoTel.value = formata(campoTel.value); erro.textContent = ''; });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const nome = campoNome.value.trim().replace(/\s+/g, ' ').slice(0, 60);
    const digitos = campoTel.value.replace(/\D/g, '');
    if (!nome || !telefoneValido(digitos)) {
      erro.textContent = !nome ? 'Digite seu nome.' : 'Confira o WhatsApp com DDD, por exemplo (11) 91234-5678.';
      (!nome ? campoNome : campoTel).focus();
      return;
    }
    monitor.enviaCadastro(nome, digitos, botao);
    monitor.envia('lead', botao);
    guarda('localStorage', 'jfCadastro', '1');
    seguir();
  });
  document.getElementById('cadDireto').addEventListener('click', seguir);
  janela.querySelector('.cad-fechar').addEventListener('click', fechar);
  janela.addEventListener('click', (e) => { if (e.target === janela) fechar(); });
})();

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
