// Najma Al Raeda — shared interactions (a11y-first)
(function () {
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---- Skip link + main landmark ----
  var skip = document.createElement('a');
  skip.className = 'skip-link';
  skip.href = '#main';
  skip.textContent = 'Skip to content';
  document.body.insertBefore(skip, document.body.firstChild);
  var header = document.querySelector('.site-header');
  var firstContent = header ? header.nextElementSibling : null;
  if (firstContent) { firstContent.id = 'main'; firstContent.setAttribute('tabindex', '-1'); firstContent.setAttribute('role', 'main'); }

  // ---- Header shadow on scroll ----
  var onScroll = function () {
    if (header) header.classList.toggle('scrolled', window.scrollY > 12);
    var tt = document.querySelector('.to-top');
    if (tt) tt.classList.toggle('show', window.scrollY > 600);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // ---- Mobile nav toggle ----
  var toggle = document.querySelector('.nav-toggle');
  var nav = document.querySelector('.nav');
  if (toggle && nav) {
    toggle.setAttribute('aria-expanded', 'false');
    toggle.addEventListener('click', function () {
      var open = nav.classList.toggle('open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }

  // ---- aria-current on active nav link ----
  var active = document.querySelector('.nav-links a.active');
  if (active) active.setAttribute('aria-current', 'page');

  // ---- Accessible mega-menu (Services & Industries) ----
  var MEGA = {
    'services.html': [
      ['service-bookkeeping.html', 'Accounting & Bookkeeping', 'Real-time IFRS books'],
      ['service-vat-tax.html', 'VAT & Corporate Tax', 'FTA-registered filing'],
      ['service-audit.html', 'Audit & Assurance', 'Statutory & internal'],
      ['service-cfo.html', 'CFO & Advisory', 'Fractional finance leadership'],
      ['service-company-formation.html', 'Company Formation', 'Mainland & free zone'],
      ['service-payroll.html', 'Payroll & WPS', 'Compliant monthly payroll']
    ],
    'industries.html': [
      ['industry-real-estate.html', 'Real Estate', 'Developers & brokers'],
      ['industry-retail.html', 'Retail & Trading', 'Inventory & multi-outlet'],
      ['industry-ecommerce.html', 'E-commerce', 'Platforms & cross-border VAT'],
      ['industry-fnb.html', 'Food & Beverage', 'Outlet P&Ls'],
      ['industry-construction.html', 'Construction', 'Contract accounting'],
      ['industry-professional-services.html', 'Professional Services', 'WIP & utilisation']
    ]
  };
  Object.keys(MEGA).forEach(function (key) {
    var link = document.querySelector('.nav-links a[href="' + key + '"]');
    if (!link) return;
    var li = link.parentElement;
    li.classList.add('has-mega');
    link.setAttribute('aria-haspopup', 'true');
    link.setAttribute('aria-expanded', 'false');
    var mega = document.createElement('div');
    mega.className = 'mega';
    MEGA[key].forEach(function (it) {
      var a = document.createElement('a');
      a.href = it[0];
      a.innerHTML = '<span class="mt">' + it[1] + '</span><span class="md">' + it[2] + '</span>';
      mega.appendChild(a);
    });
    li.appendChild(mega);
    var setExp = function (v) { link.setAttribute('aria-expanded', v ? 'true' : 'false'); };
    li.addEventListener('mouseenter', function () { setExp(true); });
    li.addEventListener('mouseleave', function () { setExp(false); });
    li.addEventListener('focusin', function () { setExp(true); });
    li.addEventListener('focusout', function () { setExp(false); });
    li.addEventListener('keydown', function (e) { if (e.key === 'Escape') { setExp(false); link.focus(); } });
  });

  // ---- Scroll reveal (respect reduced motion) ----
  var reveals = document.querySelectorAll('.reveal');
  if (reduceMotion) {
    reveals.forEach(function (el) { el.classList.add('in'); });
  } else if ('IntersectionObserver' in window && reveals.length) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
    reveals.forEach(function (el) { io.observe(el); });
  } else {
    reveals.forEach(function (el) { el.classList.add('in'); });
  }

  // ---- Animated counters (respect reduced motion) ----
  var counters = document.querySelectorAll('[data-count]');
  var setFinal = function (el) {
    var t = parseFloat(el.dataset.count); var suf = el.dataset.suffix || '';
    el.textContent = (t % 1 === 0 ? t : t.toFixed(1)) + suf;
  };
  if (reduceMotion) {
    counters.forEach(setFinal);
  } else if ('IntersectionObserver' in window && counters.length) {
    var co = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        var el = e.target, target = parseFloat(el.dataset.count), suffix = el.dataset.suffix || '';
        var dur = 1400, start = performance.now();
        var step = function (now) {
          var p = Math.min((now - start) / dur, 1);
          var eased = 1 - Math.pow(1 - p, 3);
          var val = target % 1 === 0 ? Math.floor(eased * target) : (eased * target).toFixed(1);
          el.textContent = val + suffix;
          if (p < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
        co.unobserve(el);
      });
    }, { threshold: 0.5 });
    counters.forEach(function (el) { co.observe(el); });
  } else {
    counters.forEach(setFinal);
  }

  // ---- Hero logo video: pause for reduced-motion users ----
  if (reduceMotion) {
    var hv = document.querySelector('.hero-logo-video');
    if (hv) { hv.removeAttribute('autoplay'); hv.pause && hv.pause(); }
  }

  // ---- Contact form (validation + AJAX, with email fallback) ----
  var form = document.getElementById('contact-form');
  if (form) {
    var errEl = document.getElementById('form-error');
    var val = function (id) { var el = form.querySelector('#' + id); return el ? el.value.trim() : ''; };
    var emailOk = function (v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v); };
    var showSuccess = function () {
      var ok = document.getElementById('form-success');
      form.style.display = 'none';
      if (ok) { ok.classList.add('show'); ok.setAttribute('role', 'status'); ok.setAttribute('aria-live', 'polite'); ok.setAttribute('tabindex', '-1'); ok.focus(); }
    };
    var showError = function (msg) { if (errEl) { errEl.hidden = false; errEl.textContent = msg; } };
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      if (errEl) { errEl.hidden = true; errEl.textContent = ''; }
      var hp = form.querySelector('[name="_gotcha"]');
      if (hp && hp.value) return; // spam bot caught
      var name = form.querySelector('#name'), email = form.querySelector('#email');
      [name, email].forEach(function (f) { if (f) f.setAttribute('aria-invalid', 'false'); });
      if (!name || !name.value.trim()) { if (name) { name.setAttribute('aria-invalid', 'true'); name.focus(); } showError('Please enter your name.'); return; }
      if (!email || !emailOk(email.value.trim())) { if (email) { email.setAttribute('aria-invalid', 'true'); email.focus(); } showError('Please enter a valid email address.'); return; }

      var endpoint = form.getAttribute('data-endpoint') || '';
      var configured = endpoint && endpoint.indexOf('REPLACE_WITH') === -1;

      if (!configured) {
        // No form backend configured yet: open the visitor's email client, addressed to the firm.
        var lines = ['Name: ' + val('name'), 'Company: ' + val('company'), 'Email: ' + val('email'),
                     'Phone: ' + val('phone'), 'Service: ' + val('service'), '', 'Message:', val('message')];
        window.location.href = 'mailto:hello@nraccounts.com?subject=' + encodeURIComponent('New enquiry from the website') +
          '&body=' + encodeURIComponent(lines.join('\n'));
        showSuccess();
        return;
      }

      var btn = form.querySelector('button[type="submit"]');
      var label = btn ? btn.innerHTML : '';
      if (btn) { btn.disabled = true; btn.innerHTML = 'Sending&hellip;'; }
      fetch(endpoint, { method: 'POST', body: new FormData(form), headers: { 'Accept': 'application/json' } })
        .then(function (r) { if (r.ok) { showSuccess(); } else { throw new Error('bad response'); } })
        .catch(function () {
          if (btn) { btn.disabled = false; btn.innerHTML = label; }
          showError('Sorry, something went wrong sending your message. Please email hello@nraccounts.com or call +971 4 336 0773.');
        });
    });
  }

  // ---- Back to top ----
  var top = document.createElement('button');
  top.className = 'to-top';
  top.type = 'button';
  top.setAttribute('aria-label', 'Back to top');
  top.innerHTML = '↑';
  top.addEventListener('click', function () {
    window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
  });
  document.body.appendChild(top);

  // ---- Footer year ----
  var yr = document.getElementById('year');
  if (yr) yr.textContent = new Date().getFullYear();

  // ---- Floating WhatsApp button (replace number with the real one) ----
  if (!document.querySelector('.fab')) {
    var a = document.createElement('a');
    a.className = 'fab';
    a.href = 'https://wa.me/971507042270?text=Hi%20Najma%20Al%20Raeda%2C%20I%27d%20like%20to%20book%20a%20consultation';
    a.target = '_blank'; a.rel = 'noopener';
    a.setAttribute('aria-label', 'Chat with us on WhatsApp');
    a.innerHTML = '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38c1.45.79 3.08 1.21 4.79 1.21 5.46 0 9.91-4.45 9.91-9.91S17.5 2 12.04 2zm0 18.13c-1.52 0-3.01-.41-4.3-1.18l-.31-.18-3.12.82.83-3.04-.2-.31a8.2 8.2 0 0 1-1.26-4.35c0-4.54 3.7-8.23 8.24-8.23 2.2 0 4.27.86 5.82 2.42a8.18 8.18 0 0 1 2.41 5.82c0 4.54-3.69 8.24-8.24 8.24zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.25-.64.81-.79.97-.14.17-.29.19-.54.06-.25-.12-1.05-.39-1.99-1.23-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.02-.38.11-.51.11-.11.25-.29.37-.43.12-.14.16-.25.25-.41.08-.17.04-.31-.02-.43-.06-.12-.56-1.34-.76-1.84-.2-.48-.41-.42-.56-.43h-.48c-.17 0-.43.06-.66.31-.23.25-.86.85-.86 2.07 0 1.22.89 2.4 1.01 2.56.12.17 1.75 2.67 4.23 3.74.59.26 1.05.41 1.41.52.59.19 1.13.16 1.56.1.48-.07 1.47-.6 1.68-1.18.21-.58.21-1.07.14-1.18-.06-.11-.22-.17-.47-.29z"/></svg><span>WhatsApp</span>';
    document.body.appendChild(a);
  }
})();
