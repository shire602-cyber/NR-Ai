(function () {
  const ar = document.documentElement.lang === 'ar';
  const locale = ar ? 'ar-AE' : 'en-US';
  const integer = new Intl.NumberFormat(locale);
  const percentage = new Intl.NumberFormat(locale, {
    style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1
  });
  const get = (id) => document.getElementById(id);
  const amount = (id) => parseFloat(get(id).value) || 0;
  const currency = (value) => {
    const formatted = integer.format(Math.round(value));
    return ar ? formatted + ' درهم' : 'AED ' + formatted;
  };

  const tabs = document.querySelectorAll('.calc-tab');
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.forEach((button) => {
        const selected = button === tab;
        button.classList.toggle('active', selected);
        button.setAttribute('aria-pressed', String(selected));
        get(button.getAttribute('aria-controls')).style.display = selected ? '' : 'none';
      });
    });
  });

  function calculateCorporateTax() {
    const profit = amount('ct-profit');
    const reliefRequested = get('ct-sbr').checked;
    const reliefEligible = amount('ct-revenue') <= 3000000;
    const useRelief = reliefRequested && reliefEligible;
    const threshold = 375000;
    const taxed = useRelief ? 0 : Math.max(0, profit - threshold);
    const due = taxed * 0.09;
    let message;
    if (useRelief) {
      message = ar
        ? 'طُبقت تسهيلات الأعمال الصغيرة. الإيرادات ضمن حد 3 ملايين درهم، ويُعامل الدخل الخاضع للضريبة على أنه صفر لهذه الفترة.'
        : 'Small Business Relief applied because revenue is at or below AED 3m. Taxable income is treated as nil for this period.';
    } else {
      message = ar
        ? 'يستند التقدير إلى 0٪ حتى 375,000 درهم و9٪ على ما زاد.'
        : 'Based on 0% up to AED 375,000 and 9% above.';
      if (reliefRequested && !reliefEligible) {
        message += ar
          ? ' أهلية تسهيلات الأعمال الصغيرة تتطلب إيرادات لا تتجاوز 3 ملايين درهم.'
          : ' Small Business Relief requires revenue of AED 3m or less.';
      }
    }
    get('ct-zero').textContent = currency(Math.min(profit, threshold));
    get('ct-taxed').textContent = currency(taxed);
    get('ct-due').textContent = currency(due);
    get('ct-eff').textContent = percentage.format(profit > 0 ? due / profit : 0);
    get('ct-msg').textContent = message;
  }

  function calculateVat() {
    const entered = amount('vat-amount');
    const add = get('vat-dir').value === 'add';
    const net = add ? entered : entered / 1.05;
    const vat = add ? entered * 0.05 : entered - net;
    const gross = add ? entered * 1.05 : entered;
    get('vat-net').textContent = currency(net);
    get('vat-vat').textContent = currency(vat);
    get('vat-gross').textContent = currency(gross);
  }

  ['ct-profit', 'ct-revenue'].forEach((id) => get(id).addEventListener('input', calculateCorporateTax));
  get('ct-sbr').addEventListener('change', calculateCorporateTax);
  ['vat-amount', 'vat-dir'].forEach((id) => get(id).addEventListener('input', calculateVat));
  calculateCorporateTax();
  calculateVat();
})();
