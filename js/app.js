// ============================================================
// نظام إدارة التمويل - App Module (Bootstrap)
// Version: 2.0.0
// Last Updated: 2026-08-02
// ============================================================
//
// المسؤوليات:
// - Bootstrap واحد (DOMContentLoaded)
// - Router (Screen Navigation)
// - Global Event Delegation (data-action + data-submit)
// - Registry Initialization
//
// يعتمد على:
// - core.js (APP, debug, Constants, etc.)
// - auth.js (initAuth, checkSession, etc.)
// - activity.js (initActivity, loadActivityLog, etc.)
// - dashboard.js (loadDashboard)
// - clients.js (loadClients, etc.)
// - investors.js (loadInvestors, etc.)
// - operations.js (loadOperations, etc.)
// - transfers.js (loadTransfers, etc.)
// - users.js (loadUsers, etc.)
// ============================================================


// ============================================================
// 1. BOOTSTRAP (DOMContentLoaded واحد فقط)
// ============================================================

document.addEventListener('DOMContentLoaded', function() {
    debug('🚀 بدء تهيئة التطبيق...', 'info');
    
    // 1. تهيئة Supabase (من core.js)
    initSupabase();
    
    // 2. تسجيل Screen Loaders في Registry
    registerAllScreenLoaders();
    
    // 3. ربط الأحداث العامة (Event Delegation)
    bindGlobalEvents();
    
    // 4. تهيئة الوحدات الأخرى
    if (typeof initAuth === 'function') initAuth();
    if (typeof initActivity === 'function') initActivity();
    
    // 5. التحقق من الجلسة
    checkSession();
    
    debug('✅ اكتملت تهيئة التطبيق', 'success');
});


// ============================================================
// 2. SCREEN LOADERS REGISTRY
// ============================================================

/**
 * تسجيل جميع دوال تحميل الشاشات
 */
function registerAllScreenLoaders() {
    debug('📝 تسجيل Screen Loaders...', 'info');
    
    registerScreenLoader('dashboard', loadDashboard);
    registerScreenLoader('clients', loadClients);
    registerScreenLoader('investors', loadInvestors);
    registerScreenLoader('operations', loadOperations);
    registerScreenLoader('transfers', loadTransfers);
    //registerScreenLoader('myAccount', loadMyAccount);
    registerScreenLoader('activityLog', loadActivityLog);
    registerScreenLoader('users', loadUsers);
    
    debug('✅ تم تسجيل ' + Object.keys(SCREEN_LOADERS).length + ' شاشة', 'success');
}


// ============================================================
// 3. GLOBAL EVENT DELEGATION
// ============================================================

/**
 * ربط جميع الأحداث العامة باستخدام Event Delegation
 * Listener واحد لكل التطبيق
 */
function bindGlobalEvents() {
    debug('🔗 ربط الأحداث العامة...', 'info');
    
    // 1. Global Action Delegation (data-action)
    document.body.addEventListener('click', function(event) {
        var target = event.target.closest('[data-action]');
        if (target) {
            var action = target.getAttribute('data-action');
            handleGlobalAction(action, target, event);
        }
    });
    
    // 2. Form Submissions (data-submit)
    document.body.addEventListener('submit', function(event) {
        var form = event.target.closest('form[data-submit]');
        if (form) {
            event.preventDefault();
            var submitHandler = form.getAttribute('data-submit');
            handleFormSubmit(submitHandler, form, event);
        }
    });
    
    // 3. Input Changes (لحقول معينة)
    document.body.addEventListener('input', function(event) {
        var target = event.target;
        
        // Operation Date Calculation
        if (target.id === 'opStartDate' || target.id === 'opDurationDays') {
            calculateEndDate();
        }
        
        // Operation Investor Validation
        if (target.id === 'newOpInvestorContribution' || target.id === 'newOpInvestorProfit') {
            if (typeof validateOpInvestorInputs === 'function') validateOpInvestorInputs();
        }
        if (target.id === 'editOpInvestorContribution' || target.id === 'editOpInvestorProfit') {
            if (typeof validateEditOpInvestorInputs === 'function') validateEditOpInvestorInputs();
        }
        
        // Activity Search (Debounce)
        if (target.id === 'activityFilterSearch') {
            if (typeof onActivitySearchInput === 'function') onActivitySearchInput(event);
        }
    });
    
    // 4. Select Changes (للفلاتر)
    document.body.addEventListener('change', function(event) {
        var target = event.target;
        
        // Transfer Type Toggle
        if (target.id === 'transferType') {
            if (typeof toggleInvestorSelect === 'function') toggleInvestorSelect();
        }
        
        // Screen Filters
        if (target.id === 'clientsFilter' && typeof filterClients === 'function') {
            filterClients(target.value);
        }
        if (target.id === 'investorsFilter' && typeof filterInvestors === 'function') {
            filterInvestors(target.value);
        }
        if (target.id === 'operationsFilter' && typeof filterOperations === 'function') {
            filterOperations(target.value);
        }
        if (target.id === 'transfersFilter' && typeof filterTransfers === 'function') {
            filterTransfers(target.value);
        }
        
        // Activity Filters
        if (target.id === 'activityFilterEntityType' && typeof filterByEntityType === 'function') {
            filterByEntityType(target.value);
        }
        if (target.id === 'activityFilterActionType' && typeof filterByActionType === 'function') {
            filterByActionType(target.value);
        }
        if (target.id === 'activityFilterUser' && typeof filterByUser === 'function') {
            filterByUser(target.value);
        }
    });
    
    // 5. Search Inputs (Debounce)
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
            input.addEventListener('input', function(event) {
                debouncedSearch(event.target.value);
            });
        }
    });
    
    debug('✅ تم ربط الأحداث العامة', 'success');
}


// ============================================================
// 4. ACTION HANDLER
// ============================================================

/**
 * معالجة الإجراءات العامة (data-action)
 */
function handleGlobalAction(action, target, event) {
    debug('🎯 إجراء: ' + action, 'info');
    
    switch (action) {
        // Navigation
        case 'showScreen':
            var screen = target.getAttribute('data-screen');
            if (screen) showScreen(screen, target);
            break;
        
        // Auth
        case 'handleLoginClick':
            handleLoginClick();
            break;
        
        case 'doLogout':
            doLogout();
            break;
        
        // Modals
        case 'closeModal':
            var modalId = target.getAttribute('data-modal');
            if (modalId) closeModal(modalId);
            break;
        
        case 'openClientModal':
            if (typeof openClientModal === 'function') openClientModal();
            break;
        
        case 'openInvestorModal':
            if (typeof openInvestorModal === 'function') openInvestorModal();
            break;
        
        case 'openOperationModal':
            if (typeof openOperationModal === 'function') openOperationModal();
            break;
        
        case 'openTransferModal':
            if (typeof openTransferModal === 'function') openTransferModal();
            break;
        
        // Operation Workflow
        case 'activateOperation':
            if (typeof workflowAction === 'function') workflowAction('activate');
            break;
        
        case 'completeOperation':
            if (typeof workflowAction === 'function') workflowAction('complete');
            break;
        
        case 'unlockOperation':
            if (typeof workflowAction === 'function') workflowAction('unlock');
            break;
        
        case 'clientRepayment':
            if (typeof openWorkflowTransfer === 'function') openWorkflowTransfer('client_repayment');
            break;
        
        case 'profitDistribution':
            if (typeof openWorkflowTransfer === 'function') openWorkflowTransfer('profit_distribution');
            break;
        
        case 'capitalReturn':
            if (typeof openWorkflowTransfer === 'function') openWorkflowTransfer('capital_return');
            break;
        
        case 'addInvestorToOp':
            if (typeof openAddInvestorToOp === 'function') openAddInvestorToOp();
            break;
        
        case 'addTransferToOp':
            if (typeof openAddTransferToOp === 'function') openAddTransferToOp();
            break;
        
        case 'editOperation':
            if (typeof editOperation === 'function' && APP.currentOperation) {
                closeModal('operationDetailsModal');
                editOperation(APP.currentOperation);
            }
            break;
        
        // Tabs
        case 'switchTab':
            var tabName = target.getAttribute('data-tab');
            if (tabName) switchTab(tabName, target);
            break;
        
        // Debug
        case 'toggleDebug':
            toggleDebug();
            break;
        
        case 'clearDebugLog':
            clearDebugLog();
            break;
        
        case 'copyDebugLog':
            copyDebugLog();
            break;
        
        // Activity Log
        case 'resetActivityFilters':
            if (typeof resetActivityFilters === 'function') resetActivityFilters();
            break;
        
        // Dynamic Actions (from rendered HTML)
        default:
            if (typeof window[action] === 'function') {
                var param = target.getAttribute('data-param');
                if (param) {
                    window[action](param);
                } else {
                    window[action]();
                }
            } else {
                debug('⚠️ إجراء غير معروف: ' + action, 'warning');
            }
    }
}


// ============================================================
// 5. FORM SUBMIT HANDLER
// ============================================================

/**
 * معالجة إرسال النماذج (data-submit)
 */
function handleFormSubmit(handler, form, event) {
    debug('📝 إرسال نموذج: ' + handler, 'info');
    
    if (typeof window[handler] === 'function') {
        window[handler](form, event);
    } else {
        debug('⚠️ handler غير معروف: ' + handler, 'warning');
    }
}


// ============================================================
// 6. ROUTER (Screen Navigation)
// ============================================================

/**
 * التنقل بين الشاشات
 * يمنع إعادة تحميل الشاشة الحالية
 */
function showScreen(screenId, btn) {
    // منع إعادة تحميل الشاشة الحالية
    if (APP.currentScreen === screenId) {
        debug('ℹ️ الشاشة ' + screenId + ' مفتوحة بالفعل - تجاهل', 'info');
        return;
    }
    
    debug('📱 تغيير الشاشة إلى: ' + screenId, 'info');
    
    // تحديث APP.currentScreen
    APP.currentScreen = screenId;
    
    // إغلاق أي Modal مفتوح
    closeAllModals();
    
    // إخفاء كل الشاشات
    var screens = document.querySelectorAll('.screen');
    for (var i = 0; i < screens.length; i++) {
        screens[i].classList.remove('active');
    }
    
    // إزالة active من كل أزرار التنقل
    var navBtns = document.querySelectorAll('.nav-btn');
    for (var i = 0; i < navBtns.length; i++) {
        navBtns[i].classList.remove('active');
    }
    
    // إظهار الشاشة المحددة
    var targetScreen = document.getElementById(screenId);
    if (targetScreen) {
        targetScreen.classList.add('active');
    }
    
    // تفعيل زر التنقل المحدد
    if (btn) {
        btn.classList.add('active');
    } else {
        var navBtn = document.querySelector('.nav-btn[data-screen="' + screenId + '"]');
        if (navBtn) navBtn.classList.add('active');
    }
    
    // تحميل بيانات الشاشة من Registry
    loadScreenData(screenId);
}

/**
 * تحميل بيانات الشاشة المطلوبة من Registry
 */
function loadScreenData(screenId) {
    var loader = SCREEN_LOADERS[screenId];
    
    if (loader) {
        debug('📥 تحميل بيانات الشاشة: ' + screenId, 'info');
        loader();
    } else {
        debug('⚠️ لا يوجد loader لـ: ' + screenId, 'warning');
    }
}


// ============================================================
// 7. TAB SWITCHER
// ============================================================

/**
 * تبديل التبويب
 */
function switchTab(tabName, btn) {
    // إزالة active من كل التبويبات
    var tabs = document.querySelectorAll('.tab');
    for (var i = 0; i < tabs.length; i++) {
        tabs[i].classList.remove('active');
    }
    
    // إزالة active من كل المحتوى
    var contents = document.querySelectorAll('.tab-content');
    for (var i = 0; i < contents.length; i++) {
        contents[i].classList.remove('active');
    }
    
    // تفعيل التبويب المحدد
    if (btn) btn.classList.add('active');
    
    // تفعيل المحتوى المحدد
    var contentId = 'opTab' + tabName.charAt(0).toUpperCase() + tabName.slice(1);
    var content = document.getElementById(contentId);
    if (content) content.classList.add('active');
    
    debug('📑 تبديل التبويب: ' + tabName, 'info');
}


// ============================================================
// 8. UTILITY FUNCTIONS
// ============================================================

/**
 * حساب تاريخ النهاية تلقائياً
 */
function calculateEndDate() {
    var startDateEl = document.getElementById('opStartDate');
    var durationEl = document.getElementById('opDurationDays');
    var endDateEl = document.getElementById('opEndDate');
    
    if (startDateEl && durationEl && endDateEl) {
        var startDate = startDateEl.value;
        var days = parseInt(durationEl.value);
        
        if (startDate && days) {
            var endDate = addDays(startDate, days);
            endDateEl.value = formatDateForInput(endDate);
        }
    }
}


// ============================================================
// END OF APP.JS
// ============================================================
