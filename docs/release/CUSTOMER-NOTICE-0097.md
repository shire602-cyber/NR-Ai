# Customer notice: bank reconciliation rules (migration 0097)

**DRAFT. Not sent.** The owner reviews this text and sends it through the normal customer channel
before launch. Nothing in this repository sends it.

Internal notes for the sender (not part of the notice):

- **What 0097 does** (`migrations/0097_w3c_banking.sql`):
  - Every reconciliation rule now needs a GL account.
  - Rules saved before this release have none, so every active rule is switched off. On the
    rehearsal data, all 24 of 24 active rules were switched off (docs/release/MIGRATION-REHEARSAL.md).
  - A rule with an unrecognised match type is also reset to "contains" (`equals`/`equal`/`is` become "exact").
- **What it leaves alone:**
  - No rule is deleted; the name, match text and priority are kept.
  - Bank transactions, past matches and posted journals are not changed.
- **Before sending:**
  - Fill in the launch date.
  - Send only to companies that have at least one reconciliation rule. Count them with
    `SELECT company_id, count(*) FROM reconciliation_rules GROUP BY 1` on production before the deploy.

---

## English

**Subject: Action needed after our [launch date] update: review your bank reconciliation rules**

Hello,

On [launch date] we are releasing an update to Muhasib's banking features. Reconciliation rules
now book each matched bank line to the account you choose, so every rule needs a GL account.

Rules you created before this update have no account yet. So that nothing is posted to the wrong
account, **your existing rules will be switched off** when the update goes live.

What does not change:

- Your rules are not deleted. Their names, match text and order are kept.
- Your bank transactions, completed reconciliations and posted entries are not affected.

What you need to do (about a minute per rule):

1. Go to **Banking**, then **Reconciliation rules**.
2. Open each rule and choose the **GL account** it should post to.
3. Check the **match type**. A rule we could not read is now set to "contains".
4. Switch the rule back **on** and save.

Until a rule is switched back on, matching bank lines stay in your review queue, where you can
categorise them by hand.

If you have questions, reply to this email and our team will help.

The Muhasib team

---

## العربية

**الموضوع: إجراء مطلوب بعد تحديث [تاريخ الإطلاق]: راجع قواعد المطابقة البنكية**

مرحبًا،

في [تاريخ الإطلاق] نطلق تحديثًا لخدمات البنوك في محاسب. أصبحت قواعد المطابقة الآن تقيّد كل
حركة بنكية مطابقة في الحساب الذي تختاره، لذلك تحتاج كل قاعدة إلى حساب في دفتر الأستاذ العام.

القواعد التي أنشأتها قبل هذا التحديث لا يوجد بها حساب بعد. وحتى لا يُقيَّد أي مبلغ في حساب خاطئ،
**سيتم إيقاف قواعدك الحالية** عند تفعيل التحديث.

ما الذي لن يتغير:

- لن تُحذف قواعدك. ستبقى أسماؤها ونص المطابقة وترتيبها كما هي.
- لن تتأثر حركاتك البنكية ولا المطابقات المكتملة ولا القيود المرحّلة.

ما المطلوب منك (حوالي دقيقة لكل قاعدة):

1. انتقل إلى **البنوك**، ثم **قواعد المطابقة البنكية**.
2. افتح كل قاعدة واختر **حساب دفتر الأستاذ** الذي تُقيَّد فيه.
3. تحقّق من **نوع المطابقة**. القاعدة التي لم نتمكن من قراءتها أصبحت الآن "يحتوي على".
4. أعد **تفعيل** القاعدة واحفظها.

إلى أن تُعاد تفعيل القاعدة، تبقى الحركات البنكية المطابقة لها في قائمة المراجعة، حيث يمكنك
تصنيفها يدويًا.

إذا كانت لديك أي أسئلة، يُرجى الرد على هذه الرسالة وسيساعدك فريقنا.

فريق محاسب
