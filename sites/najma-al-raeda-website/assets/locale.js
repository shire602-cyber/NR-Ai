// Static locale routes work without a server-side language redirect.
(function () {
  document.documentElement.classList.add('js');
  var current = document.documentElement.lang;
  var url = new URL(window.location.href);
  var englishSelected = current === 'en' && url.searchParams.get('lang') === 'en';
  var storageKey = 'najma-site-locale';

  if (current === 'ar' || englishSelected) {
    try { localStorage.setItem(storageKey, current); } catch { /* storage is optional */ }
    return;
  }

  var preference;
  try { preference = localStorage.getItem(storageKey); } catch { /* use the browser locale */ }
  if (preference !== 'en' && preference !== 'ar') {
    var languages = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language];
    var supported = languages.find(function (language) { return /^(ar|en)(-|$)/i.test(language); });
    preference = supported ? supported.slice(0, 2).toLowerCase() : 'en';
  }
  if (preference !== 'ar') return;

  var alternate = document.querySelector('link[rel="alternate"][hreflang="ar"]');
  if (alternate) {
    var target = new URL(alternate.href);
    target.search = url.search;
    target.hash = url.hash;
    window.location.replace(target.href);
  }
})();
