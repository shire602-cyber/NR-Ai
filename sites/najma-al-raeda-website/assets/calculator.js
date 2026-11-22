(function () {
  const ar = document.documentElement.lang === 'ar';
  const locale = ar ? 'ar-AE' : 'en-US';
  const integer = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
  const decimal = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2, maximumFractionDigits: 2
  });
  const percentage = new Intl.NumberFormat(locale, {
    style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1
  });
  const get = (id) => document.getElementById(id);
  const amount = (id) => {
    const input = get(id);
    const valid = input.validity.valid && Number.isFinite(input.valueAsNumber);
    input.setAttribute('aria-invalid', String(!valid));
    return valid ? input.valueAsNumber : null;
  };
  const currency = (value, formatter = integer) => {
    const formatted = formatter.format(value);
    return ar ? formatted + ' درهم' : 'AED ' + formatted;
  };
  const clearResults = (ids) => ids.forEach((id) => { get(id).textContent = '—'; });

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
    const revenue = amount('ct-revenue');
    if (revenue === null || profit === null) {
      clearResults(['ct-zero', 'ct-taxed', 'ct-due', 'ct-eff']);
      get('ct-msg').textContent = ar
        ? 'أدخل الدخل الخاضع للضريبة والإيرادات بمبالغ صحيحة لا تقل عن صفر.'
        : 'Enter valid amounts of zero or more for taxable income and revenue.';
      return;
    }

    const elected = get('ct-sbr').checked;
    const confirmed = get('ct-sbr-eligible').checked;
    const withinCap = revenue <= 3000000;
    const useRelief = elected && confirmed && withinCap;
    const threshold = 375000;
    const taxable = useRelief ? 0 : profit;
    const taxed = Math.max(0, taxable - threshold);
    const due = taxed * 0.09;
    let message = ar
      ? 'يستند التقدير إلى 0٪ حتى 375,000 درهم و9٪ على ما زاد. وقد تؤثر فيه قواعد الدخل المؤهل في المناطق الحرة والتسهيلات الأخرى.'
      : 'Based on 0% up to AED 375,000 and 9% above. Free-zone qualifying income and other reliefs may change this.';
    if (useRelief) {
      message = ar
        ? 'هذا تقدير مشروط. تكون الضريبة صفرًا إذا استوفيت شروط الأهلية واخترت تسهيلات الأعمال الصغيرة في إقرار هذه الفترة.'
        : 'This is a conditional estimate. Tax is AED 0 if you meet the eligibility conditions and elect Small Business Relief in your return for this period.';
    } else if (elected) {
      message += withinCap
        ? ar
          ? ' أكّد جميع شروط الأهلية لعرض تقدير يشمل التسهيلات.'
          : ' Confirm all eligibility conditions to see an estimate with relief.'
        : ar
          ? ' تتجاوز إيرادات هذه الفترة حد 3 ملايين درهم.'
          : ' Current-period revenue exceeds AED 3 million.';
    }
    get('ct-zero').textContent = currency(Math.min(taxable, threshold));
    get('ct-taxed').textContent = currency(taxed);
    get('ct-due').textContent = currency(due);
    get('ct-eff').textContent = percentage.format(profit > 0 ? due / profit : 0);
    get('ct-msg').textContent = message;
  }

  function calculateVat() {
    const amountInDirhams = amount('vat-amount');
    if (amountInDirhams === null) {
      clearResults(['vat-net', 'vat-vat', 'vat-gross']);
      return;
    }
    const enteredFils = Math.round(amountInDirhams * 100);
    const add = get('vat-dir').value === 'add';
    // At 5%, VAT is 1/20 of net or 1/21 of gross. Round VAT once, in fils.
    const vatFils = Math.round(enteredFils / (add ? 20 : 21));
    const netFils = add ? enteredFils : enteredFils - vatFils;
    const grossFils = netFils + vatFils;
    get('vat-net').textContent = currency(netFils / 100, decimal);
    get('vat-vat').textContent = currency(vatFils / 100, decimal);
    get('vat-gross').textContent = currency(grossFils / 100, decimal);
  }

  ['ct-profit', 'ct-revenue'].forEach((id) => get(id).addEventListener('input', calculateCorporateTax));
  ['ct-sbr-eligible', 'ct-sbr'].forEach((id) => get(id).addEventListener('change', calculateCorporateTax));
  get('vat-amount').addEventListener('input', calculateVat);
  get('vat-dir').addEventListener('change', calculateVat);
  calculateCorporateTax();
  calculateVat();
})();
