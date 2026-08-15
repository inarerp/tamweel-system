// ============================================================
// نظام إدارة التمويل - App Module (Bootstrap)
// Version: 3.1.0 (Security Hardening)
// Last Updated: 2026-08-15
// ============================================================
// v3.1.0: إضافة canAccessScreen() + guard داخل showScreen()
//         (Defense-in-Depth فقط — الحماية الأساسية للبيانات = RLS)
// ============================================================

// ============================================================
// 1. BOOTSTRAP (DOMContentLoaded واحد فقط)
// ============================================================
document.addEventListener('DOMContentLoaded', function() {
    console.log('🚀 app.js v3.1.0 - DOMContentLoaded');
    debug('🚀 بدء تهيئة التطبيق (app.js v3.1.0)...', 'info');
    if (!APP.supabase) { initSupabase(); }
    registerAllScreenLoaders();
    bindGlobalEvents();
    if (typeof initAuth === 'function') initAuth();
    if (typeof initActivity === 'function') initActivity();
    checkSession();
    debug('✅ اكتملت تهيئة التطبيق', 'success');
});

// ============================================================
// 2. SCREEN LOADERS REGISTRY
// ============================================================
function registerAllScreenLoaders() {
    debug('📝 تسجيل Screen Loaders...', 'info');
    registerScreenLoader('dashboard', loadDashboard);
    registerScreenLoader('clients', loadClients);
    registerScreenLoader('investors', loadInvestors);
    registerScreenLoader('operations', loadOperations);
    registerScreenLoader('transfers', loadTransfers);
    registerScreenLoader('activityLog', loadActivityLog);
    registerScreenLoader('users', loadUsers);
    registerScreenLoader('myAccount', function() {
        debug('⚠️ شاشة حسابي غير منفذة بعد', 'warning');
        var container = document.getElementById('myAccountContent');
        if (container) container.innerHTML = '<div class="empty-state">شاشة حسابي قيد التطوير</div>';
    });
    debug('✅ تم تسجيل ' + Object.keys(SCREEN_LOADERS).length + ' شاشة', 'success');
}

// ============================================================
// 2.5 SCREEN-LEVEL AUTHORIZATION (Defense-in-Depth)
// ============================================================
// ✅ v3.1.0: منع فتح الشاشات الحساسة حتى لو استُدعيت من الـ console.
// ملاحظة: هذه طبقة UX/دفاع إضافي فقط؛ فصل البيانات الحقيقي يتم في Supabase RLS.
function canAccessScreen(screenId) {
    if (!isLoggedIn()) return false;
    switch (screenId) {
        case 'reports':     return isAdmin();
        case 'users':       return isAdmin();
        case 'activityLog': return isAdmin();
        default:            return true; // باقي الشاشات بياناتها مفلترة بـ RLS حسب الدور
    }
}

// ============================================================
// 3. GLOBAL EVENT DELEGATION
// ============================================================
function bindGlobalEvents() {
    debug('🔗 ربط الأحداث العامة...', 'info');
    document.body.addEventListener('click', function(event) {
        var target = event.target.closest('[data-action]');
        if (!target) return;
        if (target.closest('a')) event.preventDefault();
        var action = target.getAttribute('data-action');
        try { handleGlobalAction(action, target, event); }
        catch (err) { debug('❌ خطأ في معالجة الإجراء [' + action + ']: ' + err.message, 'error'); }
    });
    document.body.addEventListener('submit', function(event) {
        var form = event.target.closest('form[data-submit]');
        if (form) { event.preventDefault(); handleFormSubmit(form.getAttribute('data-submit'), form, event); }
    });
    ['loginEmail', 'loginPassword'].forEach(function(id) {
        var el = document.getElementById(id);
        if (el) el.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') { e.preventDefault(); if (typeof handleLoginClick === 'function') handleLoginClick(); }
        });
    });
    document.body.addEventListener('input', function(event) {
        var target = event.target;
        if (target.id === 'opStartDate' || target.id === 'opDurationDays') { if (typeof calculateEndDate === 'function') calculateEndDate(); }
        if (target.id === 'newOpInvestorContribution' || target.id === 'newOpInvestorProfit') { if (typeof validateOpInvestorInputs === 'function') validateOpInvestorInputs(); }
        if (target.id === 'editOpInvestorContribution' || target.id === 'editOpInvestorProfit') { if (typeof validateEditOpInvestorInputs === 'function') validateEditOpInvestorInputs(); }
        if (target.id === 'activityFilterSearch') { if (typeof onActivitySearchInput === 'function') onActivitySearchInput(event); }
    });
    document.body.addEventListener('change', function(event) {
        var target = event.target;
        if (target.id === 'transferFromType' || target.id === 'transferToType') { if (typeof updateTransferFields === 'function') updateTransferFields(); }
        if (target.id === 'clientsFilter' && typeof filterClients === 'function') filterClients(target.value);
        if (target.id === 'investorsFilter' && typeof filterInvestors === 'function') filterInvestors(target.value);
        if (target.id === 'operationsFilter' && typeof filterOperations === 'function') filterOperations(target.value);
        if (target.id === 'transfersFilter' && typeof filterTransfers === 'function') filterTransfers(target.value);
        if (target.id === 'activityFilterEntityType' && typeof filterByEntityType === 'function') filterByEntityType(target.value);
        if (target.id === 'activityFilterActionType' && typeof filterByActionType === 'function') filterByActionType(target.value);
        if (target.id === 'activityFilterUser' && typeof filterByUser === 'function') filterByUser(target.value);
    });
    var searchFields = [
        { id: 'clientsSearch', callback: 'searchClients' },
        { id: 'investorsSearch', callback: 'searchInvestors' },
        { id: 'operationsSearch', callback: 'searchOperations' },
        { id: 'transfersSearch', callback: 'searchTransfers' },
        { id: 'usersSearch', callback: 'searchUsers' }
    ];
    searchFields.forEach(function(field) {
        var input = document.getElementById(field.id);
        if (input && typeof window[field.callback] === 'function') {
            var debouncedSearch = debounce(window[field.callback], 300);
            input.addEventListener('input', function(event) { debouncedSearch(event.target.value); });
        }
    });
    debug('✅ تم ربط الأحداث العامة', 'success');
}

// ============================================================
// 4. ACTION HANDLER
// ============================================================
function handleGlobalAction(action, target, event) {
    debug('🎯 إجراء: ' + action, 'info');
    switch (action) {
        case 'showScreen':
            var screen = target.getAttribute('data-screen');
            if (screen) showScreen(screen, target);
            break;
        case 'navigateToEntity':
            navigateToEntity(target.getAttribute('data-entity-type'), target.getAttribute('data-entity-id'));
            break;
        case 'handleLoginClick': if (typeof handleLoginClick === 'function') handleLoginClick(); break;
        case 'doLogout': if (typeof doLogout === 'function') doLogout(); break;
        case 'closeModal': var modalId = target.getAttribute('data-modal'); if (modalId) closeModal(modalId); break;
        case 'openClientModal': if (typeof openClientModal === 'function') openClientModal(); break;
        case 'openInvestorModal': if (typeof openInvestorModal === 'function') openInvestorModal(); break;
        case 'openOperationModal': if (typeof openOperationModal === 'function') openOperationModal(); break;
        case 'openTransferModal': if (typeof openTransferModal === 'function') openTransferModal(); break;
        case 'openOperationDetails': var detailsId = target.getAttribute('data-param'); if (typeof openOperationDetails === 'function' && detailsId) openOperationDetails(detailsId); break;
        case 'openClientFile': var clientFileId = target.getAttribute('data-param'); if (typeof openClientFile === 'function' && clientFileId) openClientFile(clientFileId); break;
        case 'openInvestorFile': var investorFileId = target.getAttribute('data-param'); if (typeof openInvestorFile === 'function' && investorFileId) openInvestorFile(investorFileId); break;
        case 'activateOperation': if (typeof workflowAction === 'function') workflowAction('activate'); break;
        case 'completeOperation': if (typeof workflowAction === 'function') workflowAction('complete'); break;
        case 'unlockOperation': if (typeof workflowAction === 'function') workflowAction('unlock'); break;
        case 'clientRepayment': if (typeof openWorkflowTransfer === 'function') openWorkflowTransfer('client_repayment'); break;
        case 'profitDistribution': if (typeof openWorkflowTransfer === 'function') openWorkflowTransfer('profit_distribution'); break;
        case 'capitalReturn': if (typeof openWorkflowTransfer === 'function') openWorkflowTransfer('capital_return'); break;
        case 'addInvestorToOp': if (typeof openAddInvestorToOp === 'function') openAddInvestorToOp(); break;
        case 'addTransferToOp': if (typeof openAddTransferToOp === 'function') openAddTransferToOp(); break;
        case 'editOperation': var opId = target.getAttribute('data-param'); if (typeof editOperation === 'function') editOperation(opId || null); break;
        case 'archiveOperation': var archId = target.getAttribute('data-param'); if (typeof archiveOperation === 'function' && archId) archiveOperation(archId); break;
        case 'deleteOpInvestor': var opInvestorId = target.getAttribute('data-param'); if (typeof deleteOpInvestor === 'function' && opInvestorId) deleteOpInvestor(opInvestorId); break;
        case 'openEditOpInvestor': var editOiId = target.getAttribute('data-param'); if (typeof openEditOpInvestor === 'function' && editOiId) openEditOpInvestor(editOiId); break;
        case 'openFundingTransfer': var fundInvestorId = target.getAttribute('data-param'); var fundAmount = target.getAttribute('data-amount'); if (typeof openFundingTransfer === 'function') openFundingTransfer(fundInvestorId, fundAmount); break;
        case 'switchTab': var tabName = target.getAttribute('data-tab'); if (tabName) switchTab(tabName, target); break;
        case 'switchClientTab': var clientTabName = target.getAttribute('data-tab'); if (typeof switchClientTab === 'function' && clientTabName) switchClientTab(clientTabName, target); break;
        case 'switchInvestorTab': var investorTabName = target.getAttribute('data-tab'); if (typeof switchInvestorTab === 'function' && investorTabName) switchInvestorTab(investorTabName, target); break;
        case 'toggleDebug': if (typeof toggleDebug === 'function') toggleDebug(); break;
        case 'clearDebugLog': if (typeof clearDebugLog === 'function') clearDebugLog(); break;
        case 'copyDebugLog': if (typeof copyDebugLog === 'function') copyDebugLog(); break;
        case 'resetActivityFilters': if (typeof resetActivityFilters === 'function') resetActivityFilters(); break;
        default:
            if (typeof window[action] === 'function') {
                var param = target.getAttribute('data-param');
                if (param) window[action](param); else window[action]();
            } else { debug('⚠️ إجراء غير معروف: ' + action, 'warning'); }
    }
}

// ============================================================
// 5. FORM SUBMIT HANDLER
// ============================================================
function handleFormSubmit(handler, form, event) {
    debug('📤 إرسال نموذج: ' + handler, 'info');
    if (form.dataset.submitting === 'true') { debug('⚠️ إرسال مكرر - تجاهل', 'warning'); return; }
    if (typeof window[handler] === 'function') {
        form.dataset.submitting = 'true';
        var result = window[handler](form, event);
        var release = function() { form.dataset.submitting = 'false'; };
        if (result && typeof result.then === 'function') { result.then(release, release); } else { release(); }
    } else { debug('⚠️ handler غير معروف: ' + handler, 'warning'); }
}

// ============================================================
// 6. ROUTER (Screen Navigation)
// ============================================================
function showScreen(screenId, btn) {
    if (APP.currentScreen === screenId) { debug('ℹ️ الشاشة ' + screenId + ' مفتوحة بالفعل - تجاهل', 'info'); return; }
    // ✅ v3.1.0: Screen-level authorization (Defense-in-Depth)
    if (!canAccessScreen(screenId)) {
        debug('🔒 وصول مرفوض للشاشة: ' + screenId, 'warning');
        if (typeof showToast === 'function') showToast('❌ لا توجد صلاحية للوصول لهذه الشاشة', 'error');
        return;
    }
    debug('📱 تغيير الشاشة إلى: ' + screenId, 'info');
    APP.currentScreen = screenId;
    closeAllModals();
    var screens = document.querySelectorAll('.screen');
    for (var i = 0; i < screens.length; i++) screens[i].classList.remove('active');
    var navBtns = document.querySelectorAll('.nav-btn');
    for (var i = 0; i < navBtns.length; i++) navBtns[i].classList.remove('active');
    var targetScreen = document.getElementById(screenId);
    if (targetScreen) targetScreen.classList.add('active');
    if (btn) btn.classList.add('active');
    else { var navBtn = document.querySelector('.nav-btn[data-screen="' + screenId + '"]'); if (navBtn) navBtn.classList.add('active'); }
    window.scrollTo(0, 0);
    loadScreenData(screenId);
}

function loadScreenData(screenId) {
    var loader = SCREEN_LOADERS[screenId];
    if (loader) { debug('📥 تحميل بيانات الشاشة: ' + screenId, 'info'); loader(); }
    else debug('⚠️ لا يوجد loader لـ: ' + screenId, 'warning');
}

// ============================================================
// 7. NAVIGATE TO ENTITY
// ============================================================
function navigateToEntity(entityType, entityId) {
    debug('🧭 الانتقال إلى كيان: ' + entityType + ' / ' + entityId, 'info');
    if (!entityType || !entityId) { debug('⚠️ بيانات الكيان ناقصة', 'warning'); return; }
    if (entityType === 'client') { showScreen('clients'); if (typeof openClientFile === 'function') openClientFile(entityId); else debug('⚠️ openClientFile غير متاحة', 'warning'); }
    else if (entityType === 'investor') { showScreen('investors'); if (typeof openInvestorFile === 'function') openInvestorFile(entityId); else debug('⚠️ openInvestorFile غير متاحة', 'warning'); }
    else if (entityType === 'operation') { showScreen('operations'); if (typeof openOperationDetails === 'function') openOperationDetails(entityId); }
    else debug('⚠️ نوع كيان غير معروف: ' + entityType, 'warning');
}

// ============================================================
// 8. TAB SWITCHER
// ============================================================
function switchTab(tabName, btn) {
    var tabs = document.querySelectorAll('.tab');
    for (var i = 0; i < tabs.length; i++) tabs[i].classList.remove('active');
    var contents = document.querySelectorAll('.tab-content');
    for (var i = 0; i < contents.length; i++) contents[i].classList.remove('active');
    if (btn) btn.classList.add('active');
    var contentId = 'opTab' + tabName.charAt(0).toUpperCase() + tabName.slice(1);
    var content = document.getElementById(contentId);
    if (content) content.classList.add('active');
    debug('📑 تبديل التبويب: ' + tabName, 'info');
}

// ============================================================
// 9. UTILITY FUNCTIONS
// ============================================================
function calculateEndDate() {
    var startDateEl = document.getElementById('opStartDate');
    var durationEl = document.getElementById('opDurationDays');
    var endDateEl = document.getElementById('opEndDate');
    if (startDateEl && durationEl && endDateEl) {
        var startDate = startDateEl.value;
        var days = parseInt(durationEl.value);
        if (startDate && days) { endDateEl.value = formatDateForInput(addDays(startDate, days)); }
    }
}
// ============================================================
// END OF APP.JS (v3.1.0)
// ============================================================
