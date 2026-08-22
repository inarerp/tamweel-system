# 🗺️ PROJECT DEPENDENCY MAP
> **الإصدار:** 1.0.0  
> **تاريخ الإنشاء:** 22 أغسطس 2026  
> **الحالة:** ✅ مرجع إلزامي قبل أي تعديل  
> **مبني على:** الفحص الفعلي للكود في المستودع (2026-08-22)

---

## 📋 Table of Contents
1. [Executive Summary](#executive-summary)
2. [Architecture Overview](#architecture-overview)
3. [File-by-File Dependency Analysis](#file-dependency-analysis)
4. [HTML ↔ JS Mapping](#html-js-mapping)
5. [Shared Functions & Globals](#shared-globals)
6. [Database Dependency Map](#database-map)
7. [Circular Dependencies](#circular-dependencies)
8. [Top 10 Critical Coupling Points](#critical-coupling)
9. [Impact Matrix](#impact-matrix)
10. [Risk Classification](#risk-classification)

---

## 🎯 Executive Summary

### إحصائيات المشروع
- **إجمالي الملفات:** 13 ملف JavaScript + 3 CSS + 1 HTML
- **إجمالي الحجم:** ~330 KB
- **عدد الجداول:** 7 جداول في Supabase
- **عدد الدوال المشتركة:** ~45 دالة
- **عدد Global Objects:** 8
- **عدد STATE Objects:** 6
- **عدد data-action handlers:** ~40+

### أخطر 3 نقاط في النظام
1. **`calculations.js`** — المحرك المالي (5 ملفات تعتمد عليه)
2. **`TRANSFER_FLOW_MAP`** — عقد التحويلات (2 ملفات حرجة)
3. **`runQuery` + `APP`** — البنية التحتية (كل الملفات)

### الحالة الصحية
- ✅ لا توجد Circular Dependencies في التحميل (Load-time)
- ⚠️ يوجد Runtime Circular بين calculations.js ↔ transfers.js (مقبول)
- ✅ ترتيب التحميل في index.html صحيح
- ✅ الأخطاء الحرجة القديمة (`select('')`) تم إصلاحها

---

## 🏗️ Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    USER LAYER (index.html)                       │
│  8 Screens · 8+ Modals · data-action handlers · DOM IDs         │
└──────────────────────────────┬──────────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────────┐
│              TIER 0 — FOUNDATION (أساس النظام)                   │
│  core.js · auth.js · app.js · activity.js · style.css           │
└──────────────────────────────┬──────────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────────┐
│              TIER 1 — CORE LOGIC (المنطق المشترك)                │
│  calculations.js · transfers.js                                 │
└──────────────────────────────┬──────────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────────┐
│              TIER 2 — BUSINESS MODULES (الوحدات)                 │
│  operations.js · clients.js · investors.js · dashboard.js       │
│  reports.js · users.js · company.js                             │
└──────────────────────────────┬──────────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────────┐
│              SUPABASE (قاعدة البيانات)                           │
│  7 Tables · Triggers · RLS · RPC Functions                      │
└─────────────────────────────────────────────────────────────────┘
```

### ترتيب التحميل الحرج (Script Loading Order)
```html
<!-- 1. Foundation (يجب أن تكون أولاً) -->
<script src="js/core.js"></script>
<script src="js/auth.js"></script>
<script src="js/activity.js"></script>

<!-- 2. Core Logic (قبل أي module يستخدمها) -->
<script src="js/calculations.js"></script>
<script src="js/transfers.js"></script>    <!-- ⚠️ يجب قبل operations.js -->

<!-- 3. Bootstrap (يضبط event delegation) -->
<script src="js/app.js"></script>

<!-- 4. Business Modules -->
<script src="js/dashboard.js"></script>
<script src="js/clients.js"></script>
<script src="js/investors.js"></script>
<script src="js/operations.js"></script>
<script src="js/reports.js"></script>
<script src="js/users.js"></script>

<!-- 5. Dynamic Loading (من dashboard.js) -->
<!-- company.js + company.css تُحمّل ديناميكياً -->
```

---

## 📂 File-by-File Dependency Analysis

### 🔴 Tier 0 — Foundation

#### `core.js` (31 KB) — 🔴 🔴 🔴 CRITICAL
```yaml
المسؤوليات:
  - تعريف APP Object (الحاوية المركزية)
  - تهيئة Supabase
  - نظام Debug Panel
  - دوال المساعدة (Utilities)
  - إدارة Modals و Loading و Toasts
  - Confirmation Dialogs

يعتمد على:
  - Supabase SDK (مكتبة خارجية)
  - DOM (document, window)

يعتمد عليه (12 ملف):
  - app.js, auth.js, activity.js
  - calculations.js, transfers.js
  - operations.js, clients.js, investors.js
  - dashboard.js, reports.js, users.js, company.js

يصدر (Global Exports):
  Objects:
    - APP ⚠️ CRITICAL
    - CONSTANTS, USER_ROLES, PERMISSIONS
    - STATUS ⚠️ CRITICAL
    - STATUS_TEXT, PURPOSE_TEXT_AR
    - SCREEN_LOADERS ⚠️ CRITICAL
  Functions:
    - runQuery ⚠️ CRITICAL
    - initSupabase, isSupabaseReady
    - handleSupabaseError
    - showToast, showLoading, hideLoading
    - openModal, closeModal, closeAllModals
    - confirmAction, confirmDelete, confirmArchive
    - formatMoney, formatDate, formatDateTime, formatDateForInput
    - addDays, getTodayDate
    - escapeHtml, isEmpty, isEmail, isPositiveNumber
    - debug, registerScreenLoader
    - canEdit, isAdmin, isClient, isInvestor, isViewer
    - getUserRoleText, getUserPermissionText
    - toggleDebug, clearDebugLog, copyDebugLog
    - getCurrentUser, getUserProfile
  Window Exports:
    - window.toggleDebug, window.toggleDebugPanel
    - window.clearDebugLog, window.clearDebug
    - window.copyDebugLog, window.copyDebug

الجداول: ❌ لا يوجد (Infrastructure فقط)
DOM Elements: ❌ لا يوجد (ينشئ عناصر ديناميكياً)
data-actions: ❌ لا يوجد
```

#### `auth.js` (9.9 KB) — 🟠 HIGH RISK
```yaml
المسؤوليات:
  - تهيئة المصادقة (initAuth)
  - التحقق من الجلسة (checkSession)
  - تسجيل الدخول والخروج
  - دوال الصلاحيات

يعتمد على:
  - core.js (APP, runQuery, showToast, debug)
  - DOM (loginEmail, loginPassword)

يعتمد عليه:
  - app.js (canAccessScreen)
  - operations.js, clients.js, investors.js, transfers.js (canEdit)
  - dashboard.js (isClient, isInvestor, isViewer, isAdmin)
  - reports.js, users.js (isAdmin)

يصدر (Global Exports):
  - initAuth, checkSession, isLoggedIn
  - handleLoginClick, doLogout
  - canEdit ⚠️ HIGH RISK
  - isAdmin ⚠️ HIGH RISK
  - canViewProfits
  - isClient, isInvestor, isViewer (مكررة من core.js — تضارب محتمل!)

الجداول: user_profiles (قراءة فقط)
DOM Elements: #loginEmail, #loginPassword, #loginError
data-actions: handleLoginClick, doLogout
```

#### `activity.js` (24.8 KB) — 🟠 HIGH RISK
```yaml
المسؤوليات:
  - تسجيل سجل النشاطات (Audit Log)
  - عرض شاشة Activity Log

يعتمد على:
  - core.js (APP, runQuery, showToast, debug, formatDate, formatDateTime)
  - DOM (#activityLogTable)

يعتمد عليه (5 ملفات):
  - operations.js (window.logActivityToDB)
  - clients.js (window.logActivityToDB)
  - investors.js (window.logActivityToDB)
  - transfers.js (window.logActivityToDB)
  - users.js (window.logActivityToDB)

يصدر (Global Exports):
  - window.logActivityToDB ⚠️ CRITICAL
  - initActivity, loadActivityLog
  - filterByEntityType, filterByActionType, filterByUser
  - resetActivityFilters, onActivitySearchInput

الجداول: activity_logs (INSERT/SELECT)
DOM Elements: #activityLogTable, #activityFilterSearch, #activityFilterEntityType, #activityFilterActionType, #activityFilterUser
data-actions: resetActivityFilters
```

#### `app.js` (16.9 KB) — 🔴 🔴 🔴 CRITICAL
```yaml
المسؤوليات:
  - Bootstrap (DOMContentLoaded)
  - Event Delegation (handleGlobalAction)
  - Router (showScreen, navigateToEntity)
  - Tab Switcher
  - Screen Authorization (canAccessScreen)

يعتمد على:
  - core.js (APP, debug, showToast, SCREEN_LOADERS, registerScreenLoader)
  - auth.js (initAuth, isLoggedIn, isAdmin)
  - activity.js (initActivity)
  - DOM (كل الـ data-action handlers)

يعتمد عليه:
  - كل الـ UI (Event Delegation مركزي)

يصدر (Global Exports):
  - showScreen(screenId, btn) ⚠️ CRITICAL
  - navigateToEntity(type, id)
  - switchTab(tabName, btn)
  - handleGlobalAction(action, target, event) ⚠️ CRITICAL
  - handleFormSubmit(handler, form, event)
  - canAccessScreen(screenId)
  - calculateEndDate()

الجداول: ❌ لا يوجد (Router فقط)
DOM Elements: كل .screen, كل .nav-btn
data-actions: ~40+ action (انظر HTML ↔ JS Mapping)
```

---

### 🟠 Tier 1 — Core Logic

#### `calculations.js` (15.9 KB) — 🔴 🔴 🔴 CRITICAL
```yaml
المسؤوليات:
  - المحرك المالي (Financial Engine)
  - حساب الأرصدة والملخصات
  - بناء كشوف الحسابات
  - منطق التمويل والأرباح

يعتمد على:
  - core.js (STATUS, helpers)
  - transfers.js (getTransferTypeText, getPurposeText) — runtime dependency
  - ❌ لا يوجد DB queries مباشرة (Pure Functions)

يعتمد عليه (6 ملفات):
  - clients.js (calculateClientSummary, buildStatement)
  - investors.js (calculateInvestorSummary, buildStatement)
  - operations.js (getOperationFunding, getOperationProfits, getCoverage)
  - dashboard.js (calculateClientSummary, calculateInvestorSummary, calculateOperationSummary, calculateCompanySummary)
  - reports.js (calculateCompanySummary, getCompanyProfitForPeriod)
  - transfers.js (getOperationFunding داخل _validateTransferCaps)

يصدر (Global Exports):
  - buildStatement ⚠️ 🔴 CRITICAL
  - calculateClientSummary ⚠️ 🔴 CRITICAL
  - calculateInvestorSummary ⚠️ 🔴 CRITICAL
  - calculateCompanySummary ⚠️ 🔴 CRITICAL
  - calculateOperationSummary
  - getOperationFunding ⚠️ 🔴 CRITICAL
  - getOperationProfits ⚠️ 🔴 CRITICAL
  - getCoverage
  - getOperationClientFlows
  - getStandaloneClientFlows
  - getCompanyBalance
  - getCompanyProfitForPeriod
  - getOperationCompanySummary
  Internal Helpers:
    - _isInvestorFunding ⚠️ CRITICAL
    - _isClientFunding ⚠️ CRITICAL
    - _isClientRepayment ⚠️ CRITICAL
    - _isInvestorToClient
    - _isClientToInvestor
    - _isFinancing
    - _companyFlowSide
    - _companyShare
    - _operationProfitDate
    - _financingCompanyProfit

الجداول: ❌ لا يوجد (يحسب على data مُمرر إليه)
DOM Elements: ❌ لا يوجد
data-actions: ❌ لا يوجد
```

#### `transfers.js` (24.3 KB) — 🔴 🔴 🔴 CRITICAL
```yaml
المسؤوليات:
  - إنشاء/تعديل/حذف التحويلات
  - التحقق من السقوف المالية (_validateTransferCaps)
  - تصنيف التحويلات (TRANSFER_FLOW_MAP)
  - دوال مساعدة للنصوص

يعتمد على:
  - core.js (APP, runQuery, showToast, debug, formatMoney, formatDate, getTodayDate, canEdit)
  - calculations.js (getOperationFunding, getOperationProfits) — runtime dependency
  - DOM (#transfersTable, #transferModal)

يعتمد عليه:
  - operations.js (TRANSFER_FLOW_MAP, _createTransfer)
  - calculations.js (getTransferTypeText, getPurposeText)

يصدر (Global Exports):
  - TRANSFER_FLOW_MAP ⚠️ 🔴 CRITICAL (Object.freeze)
  - WORKFLOW_TRANSFER_PURPOSES (Object.freeze)
  - PURPOSE_TEXT_AR (Object.freeze)
  - window.getTransferTypeText ⚠️ CRITICAL
  - window.getPurposeText ⚠️ CRITICAL
  - window.PURPOSE_TEXT_AR
  - initTransfers, loadTransfers
  - saveTransfer, deleteTransfer
  - openTransferModal, editTransfer
  - updateTransferFields, populateTransferForm
  - _validateTransferCaps ⚠️ CRITICAL
  - _buildOpCalcDataExcluding
  - refreshRelatedScreens
  - searchTransfers, filterTransfers
  - _getFromText, _getToText

الجداول: 
  - transfers (INSERT/UPDATE/DELETE/SELECT)
  - operations (قراءة للتحقق من الحالة)
  - clients (قراءة للقوائم المنسدلة)
  - investors (قراءة للقوائم المنسدلة)
DOM Elements: #transfersTable, #transferModal, #transferFromType, #transferToType, #transferAmount, #transferOperation, #transferDate, #transferNotes, #transferPurpose, #transferTransactionCategory, #transferFromParty, #transferToParty, #transferPurposeRow, #transferSummary, #summaryFrom, #summaryTo, #summaryCategory
data-actions: editTransfer, deleteTransfer, openTransferModal
```

---

### 🟡 Tier 2 — Business Modules

#### `operations.js` (48.3 KB) — 🟠 HIGH RISK
```yaml
المسؤوليات:
  - إدارة دورة حياة العملية (Workflow)
  - عرض تفاصيل العملية
  - إدارة الممولين في العملية
  - التوريدات الدورية (Recurring)
  - تنفيذ الإجراءات (تفعيل، تمويل، توزيع أرباح، ...)

يعتمد على:
  - core.js (كل الـ helpers)
  - auth.js (canEdit)
  - calculations.js (getOperationFunding, getOperationProfits, getCoverage, _isFinancing)
  - transfers.js (TRANSFER_FLOW_MAP)
  - activity.js (window.logActivityToDB)
  - DOM (#operationsTable, #operationModal, #operationDetailsModal, #opDynamicModal)

يعتمد عليه:
  - dashboard.js (عبر refreshRelatedScreens)
  - reports.js (غير مباشر)

يصدر (Global Exports):
  - OPERATIONS_STATE
  - initOperations, loadOperations
  - openOperationDetails, saveOperation, editOperation, archiveOperation
  - opActivate, opFundClient, opClientPayment
  - opApproveProfit, opDistributeProfit, opReturnCapital
  - opComplete, opUnlock, opReceiveContribution
  - saveOpInvestor, deleteOpInvestor
  - openAddInvestorToOp, openEditOpInvestor, updateOpInvestor
  - submitOpAction
  - _createTransfer
  - _buildCalcData, getOperationFinancials
  - loadOpTransfersTab, loadOpTimelineTab, loadOpInvestorsTab
  - generateNextCycle, stopRecurring, startRecurring
  - searchOperations, filterOperations
  - openAddTransferToOp

الجداول: 
  - operations (INSERT/UPDATE/SELECT)
  - operation_investors (INSERT/UPDATE/DELETE/SELECT)
  - transfers (INSERT/SELECT)
  - clients (قراءة)
  - investors (قراءة)
  - activity_logs (INSERT)
DOM Elements: #operationsTable, #operationModal, #operationDetailsModal, #opDynamicModal, #addInvestorToOpModal, #editOpInvestorModal, #opSummaryGrid, #opCoverageCard, #workflowActions, #opInvestorsList, #opTransfersList, #opTimelineList, #opRecurringSection, #opRecurringCard
data-actions: openOperationDetails, editOperation, archiveOperation, opActivate, opFundClient, opClientPayment, opApproveProfit, opDistributeProfit, opReturnCapital, opComplete, opUnlock, opReceiveContribution, openAddInvestorToOp, deleteOpInvestor, openEditOpInvestor, submitOpAction, generateNextCycle, stopRecurring, startRecurring
```

#### `clients.js` (21.2 KB) — 🟡 MEDIUM RISK
```yaml
المسؤوليات:
  - إدارة ملفات العملاء
  - عرض كشوف الحسابات
  - البحث والفلترة

يعتمد على:
  - core.js, auth.js, calculations.js, activity.js
  - DOM (#clientsTable, #clientModal, #clientFile)

يعتمد عليه:
  - dashboard.js (عبر refreshRelatedScreens)
  - transfers.js (indirect)

يصدر (Global Exports):
  - CLIENTS_STATE
  - initClients, loadClients
  - openClientFile, saveClient, editClient
  - archiveClient, unarchiveClient
  - switchClientTab, buildClientStatement
  - searchClients, filterClients
  - openClientModal

الجداول: 
  - clients (INSERT/UPDATE/SELECT)
  - operations (قراءة)
  - transfers (قراءة)
  - operation_investors (قراءة)
  - investors (قراءة)
DOM Elements: #clientsTable, #clientModal, #clientFile, #clientId, #clientName, #clientPhone, #clientEmail, #clientAddress, #clientNotes, #clientsSearch, #clientsFilter
data-actions: openClientModal, openClientFile, editClient, archiveClient, unarchiveClient, switchClientTab, saveClient
```

#### `investors.js` (34.8 KB) — 🟡 MEDIUM RISK
```yaml
المسؤوليات:
  - إدارة ملفات الممولين
  - عرض كشوف الحسابات
  - البحث والفلترة

يعتمد على:
  - core.js, auth.js, calculations.js, activity.js
  - DOM (#investorsTable, #investorModal, #investorFile)

يعتمد عليه:
  - dashboard.js (عبر refreshRelatedScreens)
  - transfers.js (indirect)

يصدر (Global Exports):
  - INVESTORS_STATE
  - initInvestors, loadInvestors
  - openInvestorFile, saveInvestor, editInvestor
  - archiveInvestor, unarchiveInvestor
  - switchInvestorTab, buildInvestorStatement
  - searchInvestors, filterInvestors
  - openInvestorModal

الجداول: 
  - investors (INSERT/UPDATE/SELECT)
  - operations (قراءة)
  - operation_investors (قراءة)
  - transfers (قراءة)
  - clients (قراءة)
DOM Elements: #investorsTable, #investorModal, #investorFile, #investorId, #investorName, #investorPhone, #investorEmail, #investorAddress, #investorNotes, #investorsSearch, #investorsFilter
data-actions: openInvestorModal, openInvestorFile, editInvestor, archiveInvestor, unarchiveInvestor, switchInvestorTab, saveInvestor
```

#### `dashboard.js` (24.4 KB) — 🟡 MEDIUM RISK
```yaml
المسؤوليات:
  - تجميع الإحصائيات والتنبيهات
  - عرض Dashboard حسب دور المستخدم
  - تحميل company.js ديناميكياً

يعتمد على:
  - core.js, auth.js, calculations.js
  - DOM (#dashboardAlerts, #dashboardStats)
  - يحمّل ديناميكياً: company.js + company.css

يعتمد عليه:
  - ❌ لا شيء (نهاية السلسلة)

يصدر (Global Exports):
  - DASH_STATE, DUE_SOON_DAYS
  - initDashboard, loadDashboard
  - loadDashboardForAdmin, loadDashboardForClient
  - loadDashboardForInvestor, loadDashboardForViewer
  - loadDashboardData, buildDashboardIndexes
  - renderDashboardAlerts, renderDashboardStats, renderDashboardActions

الجداول: 
  - operations (قراءة)
  - operation_investors (قراءة)
  - transfers (قراءة)
  - investors (قراءة)
  - clients (قراءة)
DOM Elements: #dashboardAlerts, #dashboardStats
data-actions: navigateToEntity (من التنبيهات)
```

#### `reports.js` (14.9 KB) — 🟡 MEDIUM RISK
```yaml
المسؤوليات:
  - التقارير المالية الشاملة
  - أرباح الشركة
  - الأرصدة

يعتمد على:
  - core.js, auth.js, calculations.js
  - DOM (#reportsContent)

يعتمد عليه:
  - ❌ لا شيء (نهاية السلسلة)

يصدر (Global Exports):
  - REPORTS_STATE
  - initReports, loadReports
  - loadReportsData, buildReportsIndexes, renderReports
  - reportsSwitchTab, reportsSetPeriod
  - reportsApplyCustomPeriod, searchReports
  - renderCompanySummaryTab, renderOperationsProfitTab
  - renderClientBalancesTab, renderInvestorBalancesTab

الجداول: 
  - operations (قراءة)
  - operation_investors (قراءة)
  - transfers (قراءة)
  - clients (قراءة)
  - investors (قراءة)
DOM Elements: #reportsContent, #reportsTabs, #reportsPeriod
data-actions: reportsSwitchTab, reportsSetPeriod, reportsApplyCustomPeriod
```

#### `users.js` (17.1 KB) — 🟢 LOW RISK
```yaml
المسؤوليات:
  - إدارة المستخدمين والصلاحيات
  - عرض قائمة المستخدمين

يعتمد على:
  - core.js, auth.js, activity.js
  - DOM (#usersTable, #userModal)

يعتمد عليه:
  - ❌ لا شيء (نهاية السلسلة)

يصدر (Global Exports):
  - USERS_STATE
  - window.clearUsersReferenceCache
  - initUsers, loadUsers, saveUser, editUser
  - searchUsers
  - AVAILABLE_ROLES, AVAILABLE_PERMISSIONS
  - ROLE_PERMISSION_RULES, ROLES_REQUIRING_ENTITY
  - loadClientsForUsers, loadInvestorsForUsers

الجداول: 
  - user_profiles (INSERT/UPDATE/SELECT)
  - clients (قراءة)
  - investors (قراءة)
DOM Elements: #usersTable, #userModal, #userId, #userEmail, #userRole, #userPermission, #userEntity, #userIsActive, #usersSearch
data-actions: editUser, saveUser
```

#### `company.js` (19.6 KB) — 🟢 LOW RISK
```yaml
المسؤوليات:
  - شاشة الشركة (ملخص مالي)
  - يُحمّل ديناميكياً من dashboard.js

يعتمد على:
  - core.js, calculations.js
  - DOM (#companyContent) — يُحقن من dashboard.js

يعتمد عليه:
  - dashboard.js (عبر dynamic loading)

يصدر (Global Exports):
  - window.initCompany, loadCompany
  - renderCompanySummary

الجداول: 
  - operations (قراءة)
  - transfers (قراءة)
DOM Elements: #companyContent (ديناميكي)
data-actions: ❌ لا يوجد
```

---

## 🔗 HTML ↔ JS Mapping

### data-action → Function Mapping (من app.js handleGlobalAction)

| data-action | Function | Module | Risk Level |
|---|---|---|---|
| `showScreen` | `showScreen(screen)` | app.js | 🔴 Critical |
| `navigateToEntity` | `navigateToEntity(type, id)` | app.js | 🟠 High |
| `handleLoginClick` | `handleLoginClick()` | auth.js | 🔴 Critical |
| `doLogout` | `doLogout()` | auth.js | 🟠 High |
| `closeModal` | `closeModal(id)` | core.js | 🔴 Critical |
| `openClientModal` | `openClientModal()` | clients.js | 🟡 Medium |
| `openInvestorModal` | `openInvestorModal()` | investors.js | 🟡 Medium |
| `openOperationModal` | `openOperationModal()` | operations.js | 🟠 High |
| `openTransferModal` | `openTransferModal()` | transfers.js | 🔴 Critical |
| `openOperationDetails` | `openOperationDetails(id)` | operations.js | 🟠 High |
| `openClientFile` | `openClientFile(id)` | clients.js | 🟡 Medium |
| `openInvestorFile` | `openInvestorFile(id)` | investors.js | 🟡 Medium |
| `editOperation` | `editOperation(id)` | operations.js | 🟠 High |
| `archiveOperation` | `archiveOperation(id)` | operations.js | 🟠 High |
| `deleteOpInvestor` | `deleteOpInvestor(id)` | operations.js | 🟠 High |
| `openEditOpInvestor` | `openEditOpInvestor(id)` | operations.js | 🟠 High |
| `opActivate` | `opActivate()` | operations.js | 🔴 Critical |
| `opFundClient` | `opFundClient()` | operations.js | 🔴 Critical |
| `opClientPayment` | `opClientPayment()` | operations.js | 🔴 Critical |
| `opApproveProfit` | `opApproveProfit()` | operations.js | 🔴 Critical |
| `opDistributeProfit` | `opDistributeProfit()` | operations.js | 🔴 Critical |
| `opReturnCapital` | `opReturnCapital()` | operations.js | 🔴 Critical |
| `opComplete` | `opComplete()` | operations.js | 🔴 Critical |
| `opUnlock` | `opUnlock()` | operations.js | 🔴 Critical |
| `opReceiveContribution` | `opReceiveContribution(id)` | operations.js | 🔴 Critical |
| `openAddInvestorToOp` | `openAddInvestorToOp()` | operations.js | 🟠 High |
| `submitOpAction` | `submitOpAction(form, event)` | operations.js | 🔴 Critical |
| `editTransfer` | `editTransfer(id)` | transfers.js | 🔴 Critical |
| `deleteTransfer` | `deleteTransfer(id)` | transfers.js | 🔴 Critical |
| `editClient` | `editClient(id)` | clients.js | 🟡 Medium |
| `saveClient` | `saveClient()` | clients.js | 🟡 Medium |
| `archiveClient` | `archiveClient(id)` | clients.js | 🟡 Medium |
| `unarchiveClient` | `unarchiveClient(id)` | clients.js | 🟡 Medium |
| `switchClientTab` | `switchClientTab(name, btn)` | clients.js | 🟢 Low |
| `editInvestor` | `editInvestor(id)` | investors.js | 🟡 Medium |
| `saveInvestor` | `saveInvestor()` | investors.js | 🟡 Medium |
| `archiveInvestor` | `archiveInvestor(id)` | investors.js | 🟡 Medium |
| `unarchiveInvestor` | `unarchiveInvestor(id)` | investors.js | 🟡 Medium |
| `switchInvestorTab` | `switchInvestorTab(name, btn)` | investors.js | 🟢 Low |
| `reportsSwitchTab` | `reportsSwitchTab(id)` | reports.js | 🟢 Low |
| `reportsSetPeriod` | `reportsSetPeriod(period)` | reports.js | 🟢 Low |
| `reportsApplyCustomPeriod` | `reportsApplyCustomPeriod()` | reports.js | 🟢 Low |
| `generateNextCycle` | `generateNextCycle(id)` | operations.js | 🟠 High |
| `stopRecurring` | `stopRecurring(id)` | operations.js | 🟠 High |
| `startRecurring` | `startRecurring(id)` | operations.js | 🟠 High |
| `toggleDebug` | `toggleDebug()` | core.js | 🟢 Low |
| `clearDebugLog` | `clearDebugLog()` | core.js | 🟢 Low |
| `copyDebugLog` | `copyDebugLog()` | core.js | 🟢 Low |
| `resetActivityFilters` | `resetActivityFilters()` | activity.js | 🟢 Low |

### Modal IDs → Module Mapping

| Modal ID | Module | Purpose |
|---|---|---|
| `clientModal` | clients.js | إضافة/تعديل عميل |
| `investorModal` | investors.js | إضافة/تعديل ممول |
| `operationModal` | operations.js | إضافة/تعديل عملية |
| `operationDetailsModal` | operations.js | تفاصيل العملية |
| `addInvestorToOpModal` | operations.js | إضافة ممول لعملية |
| `editOpInvestorModal` | operations.js | تعديل مساهمة |
| `transferModal` | transfers.js | إضافة/تعديل تحويل |
| `userModal` | users.js | تعديل صلاحيات مستخدم |
| `opDynamicModal` | operations.js | dynamic modal (runtime) |

---

## 🌐 Shared Functions & Globals

### 🔴 Critical Shared Objects

| Object | Defined In | Used By | Risk |
|---|---|---|---|
| `APP` | core.js | **كل الملفات** | 🔴 🔴 🔴 |
| `STATUS` | core.js | calculations, operations, dashboard, reports | 🔴 🔴 🔴 |
| `TRANSFER_FLOW_MAP` | transfers.js | operations, transfers | 🔴 🔴 🔴 |
| `SCREEN_LOADERS` | core.js | app.js, كل modules | 🔴 🔴 |
| `PURPOSE_TEXT_AR` | transfers.js + core.js (تكرار!) | operations, calculations | 🟠 |
| `CONSTANTS` | core.js | core.js فقط (داخلياً) | 🟢 |

### 🔴 Critical Shared Functions

| Function | Defined In | Used By | Risk |
|---|---|---|---|
| `runQuery` | core.js | **كل الملفات** (DB operations) | 🔴 🔴 🔴 |
| `showToast` | core.js | **كل الملفات** (UI feedback) | 🔴 🔴 |
| `buildStatement` | calculations.js | clients.js, investors.js | 🔴 🔴 🔴 |
| `getOperationFunding` | calculations.js | operations, transfers, dashboard, reports | 🔴 🔴 🔴 |
| `getOperationProfits` | calculations.js | operations, dashboard, reports, transfers | 🔴 🔴 🔴 |
| `calculateClientSummary` | calculations.js | clients, dashboard, reports | 🔴 🔴 🔴 |
| `calculateInvestorSummary` | calculations.js | investors, dashboard, reports | 🔴 🔴 🔴 |
| `calculateCompanySummary` | calculations.js | reports, dashboard | 🔴 🔴 |
| `window.logActivityToDB` | activity.js | operations, clients, investors, transfers, users | 🔴 🔴 |
| `window.getTransferTypeText` | transfers.js | calculations, operations | 🔴 🔴 |
| `window.getPurposeText` | transfers.js | calculations, operations | 🔴 🔴 |
| `canEdit` | auth.js + core.js (تكرار!) | operations, clients, investors, transfers | 🔴 🔴 |
| `isAdmin` | auth.js + core.js (تكرار!) | dashboard, reports, users, app | 🔴 🔴 |
| `openModal` | core.js | **كل الملفات** | 🔴 🔴 |
| `closeModal` | core.js | **كل الملفات** | 🔴 🔴 |
| `formatMoney` | core.js | **كل الملفات** | 🔴 🔴 |
| `formatDate` | core.js | **كل الملفات** | 🔴 🔴 |
| `escapeHtml` | core.js | **كل الملفات** | 🔴 🔴 |

### 🟡 STATE Objects (معزولة نسبياً)

| STATE Object | Defined In | Used By | Risk |
|---|---|---|---|
| `OPERATIONS_STATE` | operations.js | operations.js فقط | 🟢 |
| `CLIENTS_STATE` | clients.js | clients.js فقط | 🟢 |
| `INVESTORS_STATE` | investors.js | investors.js فقط | 🟢 |
| `TRANSFERS_STATE` | transfers.js | transfers.js فقط | 🟢 |
| `REPORTS_STATE` | reports.js | reports.js فقط | 🟢 |
| `USERS_STATE` | users.js | users.js فقط | 🟢 |
| `DASH_STATE` | dashboard.js | dashboard.js فقط | 🟢 |
| `DEBUG_STATE` | core.js | core.js فقط | 🟢 |

### ⚠️ ملاحظة مهمة: التكرار الخطير

يوجد **تكرار خطير** في الدوال التالية (قد يسبب تضارب):
- `canEdit` — معرّفة في core.js و auth.js
- `isAdmin` — معرّفة في core.js و auth.js
- `isClient`, `isInvestor`, `isViewer` — معرّفة في core.js و auth.js
- `PURPOSE_TEXT_AR` — معرّفة في core.js و transfers.js

**الحكم:** هذا تكرار يجب مراقبته. حالياً auth.js يُحمّل بعد core.js فيستبدل الدوال، لكن هذا سلوك هش.

---

## 🗄️ Database Dependency Map

### الجداول وعلاقتها بالملفات

| الجدول | يكتب فيه | يقرأ منه | الخطورة |
|---|---|---|---|
| **`operations`** | operations.js | operations, clients, investors, dashboard, reports, calculations, transfers | 🔴 🔴 🔴 |
| **`operation_investors`** | operations.js | operations, investors, dashboard, reports, calculations | 🔴 🔴 🔴 |
| **`transfers`** | transfers.js, operations.js | **كل الملفات** (7 ملفات) | 🔴 🔴 🔴 |
| **`clients`** | clients.js, users.js | operations, transfers, dashboard, reports, users, investors | 🔴 🔴 |
| **`investors`** | investors.js, users.js | operations, transfers, dashboard, reports, users, clients | 🔴 🔴 |
| **`activity_logs`** | activity.js (من 5 ملفات) | activity.js, operations.js | 🟠 |
| **`user_profiles`** | users.js | users.js, auth.js | 🟡 |

### العلاقات بين الجداول (Database Schema)

```
operations
  ├── client_id → clients.id
  ├── parent_operation_id → operations.id (self-ref للتوريد الدوري)
  └── 1:N → operation_investors

operation_investors
  ├── operation_id → operations.id
  └── investor_id → investors.id

transfers
  ├── operation_id → operations.id (nullable)
  ├── client_id → clients.id (nullable)
  └── investor_id → investors.id (nullable)

user_profiles
  ├── entity_id → clients.id أو investors.id (حسب الدور)
  └── id → auth.users.id (Supabase Auth)

activity_logs
  ├── entity_id → أي جدول (polymorphic)
  └── action_type → enum
```

### ⚠️ أي تغيير في Schema لأي من الجداول الخمسة الأولى → يتطلب مراجعة كل الملفات التي تستخدمها.

---

## 🔄 Circular Dependencies

### ⚠️ Runtime Circular (مقبول حالياً)

```
calculations.js ←→ transfers.js
```

**التفاصيل:**
- `calculations.js` يستدعي `getTransferTypeText` و `getPurposeText` من `transfers.js` (عبر window globals) داخل `buildStatement`.
- `transfers.js` يستدعي `getOperationFunding` و `getOperationProfits` من `calculations.js` داخل `_validateTransferCaps`.

**الحكم:** 
- ✅ آمن حالياً (يحدث في Runtime، ليس في Load-time)
- ⚠️ يجعل فصل الملفين مستحيلاً دون طبقة وسيطة
- ⚠️ أي تغيير في أي من الملفين يتطلب اختبار الآخر

### ✅ لا توجد Circular Dependencies في التحميل (Load-time)

ترتيب التحميل في `index.html` صحيح ويمنع أي `undefined` errors.

---

## 🎯 Top 10 Critical Coupling Points

### 🔴 🔴 🔴 النقاط التي يجب حمايتها بأقصى درجات الحذر

| # | النقطة | الملف | المستهلكون | التأثير عند التغيير |
|---|---|---|---|---|
| 1 | **`APP` Object** | core.js | كل الملفات | النظام بالكامل يتوقف |
| 2 | **`runQuery`** | core.js | كل الملفات | كل DB operations تفشل |
| 3 | **`TRANSFER_FLOW_MAP`** | transfers.js | operations.js, transfers.js | لا يمكن إنشاء تحويلات |
| 4 | **`buildStatement`** | calculations.js | clients.js, investors.js | كشوف العملاء والممولين تنكسر |
| 5 | **`getOperationFunding`** | calculations.js | operations, transfers, dashboard, reports | منطق التمويل كله + validation |
| 6 | **`getOperationProfits`** | calculations.js | operations, dashboard, reports, transfers | منطق الأرباح كله |
| 7 | **`window.logActivityToDB`** | activity.js | 5 ملفات | Audit Log يفشل بصمت |
| 8 | **`handleGlobalAction`** | app.js | كل الـ UI | كل الأزرار تتوقف |
| 9 | **`STATUS` constant** | core.js | calculations, operations, dashboard, reports | كل workflow ينكسر |
| 10 | **`SCREEN_LOADERS`** | core.js | app.js, كل modules | التنقل بين الشاشات يتوقف |

---

## 📊 Impact Matrix

| الملف | يعتمد على | يعتمد عليه | درجة الخطورة |
|---|---|---|---|
| `core.js` | Supabase SDK | **كل الملفات (12)** | 🔴 🔴 🔴 |
| `calculations.js` | core.js, transfers.js | clients, investors, operations, dashboard, reports, transfers | 🔴 🔴 🔴 |
| `app.js` | core.js, auth.js, activity.js | **كل الـ UI** | 🔴 🔴 🔴 |
| `transfers.js` | core.js, calculations.js | operations.js, calculations.js | 🔴 🔴 🔴 |
| `auth.js` | core.js | كل Tier 2 modules | 🟠 🔴 |
| `operations.js` | core, auth, calculations, transfers, activity | dashboard, reports | 🟠 🔴 |
| `activity.js` | core.js | operations, clients, investors, transfers, users | 🟠 |
| `clients.js` | core, auth, calculations, activity | dashboard | 🟡 |
| `investors.js` | core, auth, calculations, activity | dashboard | 🟡 |
| `dashboard.js` | core, auth, calculations | ❌ لا شيء | 🟡 |
| `reports.js` | core, auth, calculations | ❌ لا شيء | 🟡 |
| `users.js` | core, auth, activity | ❌ لا شيء | 🟢 |
| `company.js` | core, calculations | dashboard | 🟢 |

---

## 🚦 Risk Classification

### 🔴 🔴 🔴 ممنوع تعديلها بشكل عشوائي (Critical)
| الملف | السبب |
|---|---|
| `core.js` | كل النظام يعتمد عليه |
| `calculations.js` | المحرك المالي — 5 ملفات تعتمد عليه |
| `app.js` | Event Delegation المركزي |
| `transfers.js` | TRANSFER_FLOW_MAP + التحقق من السقوف |

### 🟠 يمكن تعديلها لكن مع مراجعة Dependencies
| الملف | ما يجب مراجعته |
|---|---|
| `operations.js` | dashboard.js, reports.js, transfers.js |
| `auth.js` | كل Tier 2 modules |
| `activity.js` | operations, clients, investors, transfers, users |
| `clients.js` | dashboard.js |
| `investors.js` | dashboard.js |

### 🟢 معزولة نسبياً ويمكن تعديلها بأمان
| الملف | السبب |
|---|---|
| `users.js` | لا يعتمد عليها أحد |
| `company.js` | معزول، يُحمّل ديناميكياً |
| `reports.css` | خاص بـ reports.js فقط |
| `company.css` | خاص بـ company.js فقط |

---

## 📝 ملاحظات ختامية

### ✅ نقاط القوة
- بنية Modules واضحة
- Financial Core قوي ومركزي
- STATE Objects معزولة جيداً
- ترتيب التحميل صحيح

### ⚠️ نقاط الضعف
- Global Functions كثيرة (صعوبة التتبع)
- تكرار في دوال الصلاحيات (auth.js + core.js)
- Runtime Circular بين calculations.js و transfers.js
- لا يوجد TypeScript contracts

### 🎯 التوصيات المستقبلية (للمراجعة لاحقاً)
1. إنشاء `js/api.js` لتجميع DB queries
2. إنشاء `js/registry.js` لتوثيق الـ exports
3. إزالة التكرار في دوال الصلاحيات
4. إضافة JSDoc للدوال المشتركة

---

**END OF PROJECT_DEPENDENCY_MAP.md**
