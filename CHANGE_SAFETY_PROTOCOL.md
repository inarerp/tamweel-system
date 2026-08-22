# 🛡️ CHANGE SAFETY PROTOCOL
> **الإصدار:** 1.0.0  
> **تاريخ الإنشاء:** 22 أغسطس 2026  
> **الحالة:** ✅ إلزامي لكل تعديل مستقبلي  
> **المرجع:** `PROJECT_DEPENDENCY_MAP.md`

---

## 🎯 الهدف

هذا البروتوكول يضمن أن **كل تعديل في المشروع** يتم بطريقة آمنة لا تكسر الوظائف الأخرى.

**القاعدة الذهبية:**
> **"TRACE → IMPACT → PATCH → REGRESSION CHECK"**
> 
> وليس: "BUG → EDIT FILE → HOPE IT WORKS"

---

## 📋 البروتوكول الإلزامي (4 مراحل)

### المرحلة 1: TRACE (التتبع)
قبل أي تعديل، يجب الإجابة على:

- [ ] ما هو الملف الذي سأعدله؟
- [ ] ما هي الدالة/المتغير/الـ Global الذي سيتغير؟
- [ ] ما هي الملفات التي تعتمد عليه (حسب Dependency Map)؟
- [ ] ما هي الجداول المتأثرة؟
- [ ] ما هي عناصر الـ UI / DOM / data-actions المرتبطة؟
- [ ] ما هي الوظائف التي يجب إعادة اختبارها؟

### المرحلة 2: IMPACT ANALYSIS (تحليل التأثير)
كتابة تقرير رسمي قبل البدء:

```markdown
## IMPACT ANALYSIS

### المشكلة
[وصف مختصر للمشكلة]

### الملفات التي تحتاج تعديل
- [ ] `file1.js`
- [ ] `file2.js`

### الدوال التي ستتغير
- `functionName1` في `file1.js`
- `functionName2` في `file2.js`

### الملفات التي تعتمد عليها
- `dependent1.js` — يستخدم `functionName1` في [مكان]
- `dependent2.js` — يستخدم `functionName2` في [مكان]

### الـ Globals / window functions المتأثرة
- `GLOBAL_NAME` — مستخدم في [ملفات]

### جداول قاعدة البيانات المتأثرة
- `table_name` — [نوع التأثير: INSERT/UPDATE/DELETE/SELECT]

### شاشات الـ UI المتأثرة
- [اسم الشاشة] — [كيف تتأثر]

### الوظائف التي قد تتأثر
- [وظيفة 1]
- [وظيفة 2]

### مستوى الخطورة
- 🔴 Critical / 🟠 High / 🟡 Medium / 🟢 Low

### لماذا؟
[شرح مختصر]

### خطة التعديل الأقل خطورة
1. [خطوة 1]
2. [خطوة 2]

### ما الذي لن نلمسه؟
- [عنصر 1 محمي]
- [عنصر 2 محمي]
```

### المرحلة 3: MINIMUM PATCH (التعديل الأدنى)

#### الأولويات (من الأهم للأقل):
1. ✅ إصلاح المشكلة المحددة فقط
2. ✅ أقل عدد ممكن من الملفات
3. ✅ أقل عدد ممكن من الدوال
4. ✅ عدم إعادة كتابة ملفات كاملة بدون ضرورة
5. ✅ عدم تغيير API أو Global names بدون سبب
6. ✅ عدم تغيير Database schema إلا إذا كان ضرورياً
7. ✅ عدم تغيير UI غير المرتبط بالمشكلة
8. ✅ عدم عمل Refactoring جانبي أثناء إصلاح Bug

#### ممنوعات صارمة:
- ❌ "بما أننا هنا، خلينا نحسن الملف كله"
- ❌ تغيير معادلات مالية بدون سبب موثق
- ❌ حذف كود موجود بدون سبب موثق
- ❌ إضافة Features من عندك
- ❌ تعديل Critical Coupling Points دون تحليل كامل
- ❌ إرسال Patch أو أجزاء من الملف — فقط FULL FILE REPLACEMENT
- ❌ افتراض محتوى ملف لم تقرأه

### المرحلة 4: REGRESSION CHECK (فحص التراجع)
بعد التنفيذ، يجب كتابة:

```markdown
## REGRESSION CHECK

### Files changed:
- [ ] `file1.js`
- [ ] `file2.js`

### Functions changed:
- `functionName1` — [ما الذي تغير]
- `functionName2` — [ما الذي تغير]

### Direct dependents:
- [ملف 1] — [كيف تأثر]
- [ملف 2] — [كيف تأثر]

### Indirect dependents:
- [ملف 1] — [كيف تأثر]

### Database tables affected:
- `table_name` — [نوع التأثير]

### UI screens affected:
- [شاشة 1] — [كيف تأثرت]

### Must test:
- [ ] [وظيفة 1]
- [ ] [وظيفة 2]
- [ ] [وظيفة 3]

### Potential regression:
- [خطر محتمل 1]
- [خطر محتمل 2]

### Unchanged (ما تأكدنا أنه لم يتأثر):
- ✅ [عنصر 1]
- ✅ [عنصر 2]
- ✅ [عنصر 3]
```

---

## 🚫 المحظورات الخاصة (Critical Coupling Points)

### 🔴 🔴 🔴 ممنوع تعديل هذه العناصر دون تحليل كامل:

| العنصر | الملف | السبب |
|---|---|---|
| `APP` Object | core.js | كل النظام يعتمد عليه |
| `runQuery` | core.js | كل DB operations |
| `STATUS` constant | core.js | كل workflow |
| `SCREEN_LOADERS` | core.js | التنقل بين الشاشات |
| `TRANSFER_FLOW_MAP` | transfers.js | عقد التحويلات |
| `buildStatement` | calculations.js | كشوف العملاء والممولين |
| `getOperationFunding` | calculations.js | منطق التمويل + validation |
| `getOperationProfits` | calculations.js | منطق الأرباح |
| `window.getTransferTypeText` | transfers.js | نصوص التحويلات |
| `window.getPurposeText` | transfers.js | نصوص الأغراض |
| `window.logActivityToDB` | activity.js | Audit Log |

### 🔴 ممنوع تغيير المعادلات المالية:
- `runningBalance` في `buildStatement`
- `client balances` في `calculateClientSummary`
- `investor balances` في `calculateInvestorSummary`
- `operation funding` في `getOperationFunding`
- `investor profit` في `getOperationProfits`
- `company profit` في `calculateCompanySummary`
- `company cash` في `getCompanyBalance`
- `client funding / repayment` في `getOperationClientFlows`
- `capital return` في `getOperationProfits`
- `profit distribution` في `getOperationProfits`

---

## 📝 Template للـ Commit Messages

### قبل كل PR/Commit:

```markdown
## 📝 Impact Statement

**الملف المُعدَّل:** [اسم الملف]  
**الدالة المُعدَّلة:** [اسم الدالة]  
**الملفات التي يجب فحصها:** [قائمة الملفات]  
**الوظائف التي يجب اختبارها:** [قائمة الوظائف]  
**ما يجب ألا يتغير:** [قائمة العناصر المحمية]

## 🔍 TRACE
- [ ] راجعت Dependency Map
- [ ] حددت الملفات المتأثرة
- [ ] حددت الجداول المتأثرة
- [ ] حددت الـ UI المتأثر

## 🛡️ SAFETY
- [ ] التعديل Minimal Patch
- [ ] لم أغير أي معادلة مالية (إن لم يكن مطلوباً)
- [ ] لم أغير أي Global names (إن لم يكن مطلوباً)
- [ ] لم أعمل Refactoring جانبي

## ✅ REGRESSION CHECK
- [ ] اختبرت الشاشات المتأثرة
- [ ] اختبرت الـ workflows المتأثرة
- [ ] تأكدت من عدم وجود side effects
```

---

## 🔄 Workflow الكامل للتعديل

```
┌─────────────────────────────────────────────────────────┐
│ 1. استلام طلب التعديل                                    │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│ 2. قراءة PROJECT_DEPENDENCY_MAP.md                       │
│    - تحديد الملف                                        │
│    - تحديد الدالة                                       │
│    - تحديد المستهلكين                                   │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│ 3. قراءة الكود الفعلي (ليس الاعتماد على الذاكرة)        │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│ 4. كتابة IMPACT ANALYSIS                                 │
│    - عرضها على المستخدم للموافقة                        │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│ 5. تنفيذ MINIMUM PATCH                                   │
│    - FULL FILE REPLACEMENT فقط                          │
│    - لا Refactoring جانبي                               │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│ 6. كتابة REGRESSION CHECK                                │
│    - ما الذي تم تغييره                                  │
│    - ما الذي تم اختباره                                 │
│    - ما الذي تأكد أنه لم يتأثر                          │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│ 7. تحديث PROJECT_DEPENDENCY_MAP.md (إذا لزم)             │
└─────────────────────────────────────────────────────────┘
```

---

## 🎯 أمثلة تطبيقية

### مثال 1: تعديل في `reports.js` (🟢 Low Risk)

```markdown
## IMPACT ANALYSIS

### المشكلة
التقارير لا تظهر بيانات صحيحة

### الملفات التي تحتاج تعديل
- `reports.js` فقط

### الدوال التي ستتغير
- `loadReportsData`

### الملفات التي تعتمد عليها
- ❌ لا شيء (نهاية السلسلة)

### مستوى الخطورة
- 🟢 Low

### خطة التعديل
- تعديل `loadReportsData` فقط
- لا نلمس أي دالة أخرى

### ما الذي لن نلمسه؟
- calculations.js
- transfers.js
- أي ملف آخر
```

### مثال 2: تعديل في `calculations.js` (🔴 🔴 🔴 Critical)

```markdown
## IMPACT ANALYSIS

### المشكلة
[وصف المشكلة]

### الملفات التي تحتاج تعديل
- `calculations.js`
- [ربما] `clients.js` — إذا تأثرت الواجهة
- [ربما] `investors.js` — إذا تأثرت الواجهة

### الدوال التي ستتغير
- `functionName` في `calculations.js`

### الملفات التي تعتمد عليها
- `clients.js` — يستخدم `calculateClientSummary`
- `investors.js` — يستخدم `calculateInvestorSummary`
- `operations.js` — يستخدم `getOperationFunding`
- `dashboard.js` — يستخدم 4 دوال
- `reports.js` — يستخدم `calculateCompanySummary`
- `transfers.js` — يستخدم `getOperationFunding`

### مستوى الخطورة
- 🔴 🔴 🔴 Critical

### خطة التعديل
1. قراءة كل الملفات المستهلكة
2. تحديد السلوك الحالي
3. تعديل الدالة المطلوبة فقط
4. اختبار كل الملفات المستهلكة

### ما الذي لن نلمسه؟
- أي معادلة مالية أخرى
- أي دالة مشتركة أخرى
- أي Global Object
```

---

## 📊 Decision Matrix (متى نوافق على التعديل؟)

| الحالة | القرار |
|---|---|
| الملف في Tier 0 (core, app, auth, activity) | 🔴 توقف — تحليل كامل مطلوب |
| الملف في Tier 1 (calculations, transfers) | 🔴 توقف — تحليل كامل مطلوب |
| الملف في Tier 2 (operations, clients, investors) | 🟠 حذر — راجع Dependencies |
| الملف في Tier 3 (users, company) | 🟢 آمن نسبياً |
| التعديل يمس معادلة مالية | 🔴 توقف — تحليل كامل مطلوب |
| التعديل يمس Global Function | 🔴 توقف — راجع كل المستهلكين |
| التعديل يمس DB Schema | 🔴 توقف — راجع كل الملفات |
| التعديل يمس data-action | 🟠 حذر — راجع app.js |
| التعديل في CSS فقط | 🟢 آمن |
| التعديل في UI فقط (HTML) | 🟡 متوسط — راجع JS المرتبط |

---

## 🛠️ أدوات مساعدة

### Madge (للتحليل التلقائي)
```bash
# التثبيت
npm install -g madge

# تحليل الاعتماديات
madge --image dependency-graph.png js/

# تصدير JSON
madge --json js/ > dependencies.json

# اكتشاف Circular Dependencies
madge --circular js/
```

### Checklist قبل كل Commit
```bash
# 1. هل قرأت PROJECT_DEPENDENCY_MAP.md؟
# 2. هل كتبت IMPACT ANALYSIS؟
# 3. هل التعديل Minimal Patch؟
# 4. هل اختبرت كل الملفات المتأثرة؟
# 5. هل كتبت REGRESSION CHECK؟
```

---

## 🎯 الخلاصة

### ✅ هذا البروتوكول إلزامي
- كل تعديل يجب أن يمر بالمراحل الأربع
- لا استثناءات (حتى للـ "تعديلات الصغيرة")
- أي تعديل بدون IMPACT ANALYSIS = مرفوض

### 🔴 القاعدة الذهبية
> **"لو مش متأكد من التأثير، لا تُعدِّل. اسأل أولاً."**

### 🟢 الخطوة التالية
بعد تثبيت هذا البروتوكول، كل تعديل قادم سيبدأ بـ:
1. قراءة `PROJECT_DEPENDENCY_MAP.md`
2. كتابة `IMPACT ANALYSIS`
3. انتظار موافقة المستخدم
4. تنفيذ `MINIMUM PATCH`
5. كتابة `REGRESSION CHECK`

---

**END OF CHANGE_SAFETY_PROTOCOL.md**
