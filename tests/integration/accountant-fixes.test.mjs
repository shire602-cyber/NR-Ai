// Accountant-audit fix verification — born from the 10-blind-agent teardown (TD5).
// Run: server up with rate limits raised, then BASE_URL=... node tests/integration/accountant-fixes.test.mjs
const B=process.env.BASE_URL??"http://127.0.0.1:5000";const h={"Content-Type":"application/json"};
const api=async(m,p,b,t)=>{const r=await fetch(B+p,{method:m,headers:t?{...h,Authorization:"Bearer "+t}:h,body:b?JSON.stringify(b):undefined});const x=await r.text();try{return{s:r.status,j:JSON.parse(x)}}catch{return{s:r.status,t:x.slice(0,150)}}};
let pass=0,fail=0;const ok=(n,c,d)=>{console.log((c?"PASS  ":"FAIL  ")+n+(c?"":"  "+JSON.stringify(d)));c?pass++:fail++};
const today=new Date().toISOString().slice(0,10);
const monthStart=today.slice(0,8)+"01";
const reg=await api("POST","/api/auth/register",{name:"V",email:`v12_${Date.now()}@e.com`,password:"Password123!"});
const T=reg.j.token,C=reg.j.company.id;
await api("PATCH",`/api/companies/${C}`,{trnVatNumber:"100123456700003",vatRegistered:true,emirate:"dubai"},T);
const ACC=(await api("GET",`/api/companies/${C}/accounts`,null,T)).j;
const tbRow=async(code)=>{const tb=(await api("GET",`/api/companies/${C}/reports/trial-balance`,null,T)).j;return (tb.rows||[]).find(r=>(r.accountCode||r.code)===code)||{}};

// FIX 1: bill fallback → 5000 General Expenses (not 5130)
const bill=(await api("POST",`/api/companies/${C}/bills`,{vendor_name:"V1",bill_date:today,due_date:today,currency:"AED",line_items:[{description:"misc goods",quantity:1,unit_price:4000,vat_rate:0.05}]},T)).j;
await api("POST",`/api/bills/${bill.id}/approve`,{},T);
let r5000=await tbRow("5000"),r5130=await tbRow("5130");
ok("bill posts to 5000 General Expenses",Number(r5000.totalDebit??r5000.debit)===4000,{r5000});
ok("nothing lands in 5130 Loss on Asset Disposal",Number(r5130.totalDebit??r5130.debit??0)===0,{r5130});

// FIX 2+3: claims in box9/13; entertainment VAT blocked
const c1=(await api("POST",`/api/companies/${C}/expense-claims`,{title:"Taxi",items:[{expense_date:today,category:"taxi",description:"t",amount:100,vat_amount:5}]},T)).j;
await api("POST",`/api/expense-claims/${c1.id}/submit`,{},T);
await api("POST",`/api/expense-claims/${c1.id}/approve`,{review_notes:"ok"},T);
const c2=(await api("POST",`/api/companies/${C}/expense-claims`,{title:"Client dinner",items:[{expense_date:today,category:"entertainment",description:"e",amount:300,vat_amount:15}]},T)).j;
await api("POST",`/api/expense-claims/${c2.id}/submit`,{},T);
await api("POST",`/api/expense-claims/${c2.id}/approve`,{review_notes:"ok"},T);
const r1050=await tbRow("1050");
ok("input VAT GL = 200(bill)+5(taxi), entertainment 15 NOT recovered",Math.abs(Number(r1050.totalDebit??r1050.debit)-205)<0.01,{r1050});
const inv=(await api("POST",`/api/companies/${C}/invoices`,{customerName:"X",date:today,dueDate:today,lines:[{description:"a",quantity:1,unitPrice:15000,vatRate:0.05}]},T)).j;
await api("PATCH",`/api/invoices/${inv.id}/status`,{status:"sent"},T);
const vat=(await api("POST",`/api/companies/${C}/vat-returns/generate`,{periodStart:monthStart,periodEnd:today},T)).j;
ok("box9 includes bill 4000 + claims 400 net",Math.abs(vat.box9ExpensesAmount-4400)<0.01,{box9:vat.box9ExpensesAmount});
ok("box9 VAT = 205 (claims incl., entertainment excl.)",Math.abs(vat.box9ExpensesVat-205)<0.01,{v:vat.box9ExpensesVat});
ok("box13 recoverable = 205",Math.abs(vat.box13RecoverableTax-205)<0.01,{v:vat.box13RecoverableTax});
ok("box14 = 750-205 = 545",Math.abs(vat.box14PayableTax-545)<0.01,{v:vat.box14PayableTax});

// FIX 4: mark-paid posts cash JE
const before1020=Number((await tbRow("1020")).totalCredit||0);
const mp=await api("POST",`/api/expense-claims/${c1.id}/mark-paid`,{payment_reference:"TT-9"},T);
const r2045=await tbRow("2045");const after1020=await tbRow("1020");
ok("mark-paid ok",mp.s===200,{s:mp.s});
ok("reimbursement payable settled (2045 net 0 for paid claim; 315 left for unpaid)",Math.abs((Number(r2045.totalCredit)-Number(r2045.totalDebit))-315)<0.01,{r2045});
ok("bank credited 105 by reimbursement",Math.abs(Number(after1020.totalCredit||0)-before1020-105)<0.01,{after:after1020});

// FIX 5: credit note honours date
const inv2=(await api("POST",`/api/companies/${C}/invoices`,{customerName:"Y",date:monthStart,dueDate:today,lines:[{description:"b",quantity:1,unitPrice:1000,vatRate:0.05}]},T)).j;
await api("PATCH",`/api/invoices/${inv2.id}/status`,{status:"sent"},T);
const cn=await api("POST",`/api/companies/${C}/invoices/${inv2.id}/credit-note`,{date:monthStart,lines:[{description:"r",quantity:1,unitPrice:200,vatRate:0.05}]},T);
ok("CN with explicit date accepted",cn.s===201,{s:cn.s});
ok("CN document dated to requested date",String(cn.j?.date).slice(0,10)===monthStart,{d:cn.j?.date});
const cnFuture=await api("POST",`/api/companies/${C}/invoices/${inv2.id}/credit-note`,{date:"2030-01-01"},T);
ok("future CN date → 422",cnFuture.s===422,{s:cnFuture.s});

// FIX 6: cost centre without code → 400 not 500
const cc=await api("POST",`/api/companies/${C}/cost-centers`,{name:"NoCode"},T);
ok("cost centre without code → 400",cc.s===400,{s:cc.s,code:cc.j?.code});

// Ledger integrity after everything
const tb=(await api("GET",`/api/companies/${C}/reports/trial-balance`,null,T)).j;
const dr=(tb.rows||[]).reduce((s,x)=>s+Number(x.totalDebit??x.debit??0),0);
const cr=(tb.rows||[]).reduce((s,x)=>s+Number(x.totalCredit??x.credit??0),0);
ok("trial balance still balances",Math.abs(dr-cr)<0.02,{dr,cr});
console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail?1:0);
