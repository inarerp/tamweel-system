// ============================================================
// نظام إدارة التمويل - Core Module
// Version: 7.0.0 (Final Production - Fully Integrated)
// Last Updated: 2026-08-03
// ============================================================
//
// المسؤوليات:
// - تعريف APP Object والثوابت
// - نظام Debug Panel (زر عائم + Panel جانبي)
// - تهيئة Supabase
// - دوال مساعدة (Utilities)
// - إدارة Modals والـ Loading والـ Toasts
// - Confirmation Dialogs
//
// يعتمد عليه:
// - app.js (Bootstrap & Router)
// - auth.js (Authentication)
// - operations.js, clients.js, investors.js, transfers.js, users.js, dashboard.js, activity.js
//
// لا يقوم بـ:
// - Bootstrap (هذا من مسؤولية app.js)
// - تهيئة الوحدات الأخرى (هذا من مسؤولية app.js)
// ============================================================

// ============================================================
// 1. APP OBJECT (الحاوية المركزية للتطبيق)
// ============================================================

var APP = {
    supabase: null,
    user: null,              // Alias لـ currentUser (للتوافق)
    currentUser: null,       // المستخدم الحالي من Supabase Auth
    userProfile: null,       // Alias لملف المستخدم
    userRole: null,          // الدور (admin, viewer, client, investor)
    userPermission: null,    // الصلاحية (admin, viewer)
    currentEntityId: null,   // كيان المستخدم (client_id أو investor_id)
    currentOperation: null,
    currentOperationData: null,
    currentScreen: null,
    DEBUG_MODE: true,
    VERSION: '7.0.0'
};

// ============================================================
// 2. CONSTANTS (الثوابت العامة)
// ============================================================

var CONSTANTS = {
    TOAST_DURATION: 4000,
    LOADING_MIN_DURATION: 300,
    MAX_LOG_ENTRIES: 500,
    DATE_FORMAT: 'ar-EG',
    CURRENCY: 'ج.م'
};

var USER_ROLES = {
    ADMIN: 'admin',
    VIEWER: 'viewer',
    CLIENT: 'client',
    INVESTOR: 'investor'
};

var PERMISSIONS = {
    ADMIN: 'admin',
    VIEWER: 'viewer'
};
// ============================================================
// 2.1 ADDITIONAL CONSTANTS (مطلوب من dashboard.js و operations.js)
// ============================================================

var STATUS = {
    DRAFT: 'draft',
    ACTIVE: 'active',
    COMPLETED: 'completed',
    CANCELLED: 'cancelled',
    ARCHIVED: 'archived'
};

var STATUS_TEXT = {
    'draft': 'تحت الإنشاء',
    'active': 'نشطة',
    'completed': 'انتهت',
    'cancelled': 'ألغيت',
    'archived': 'مؤرشف'
};

var PURPOSE_TEXT_AR = {
    'client_funding': 'تمويل',
    'client_repayment': 'سداد',
    'capital_return': 'إرجاع رأس مال',
    'profit_distribution': 'توزيع أرباح',
    'settlement': 'تسوية',
    'additional_funding': 'تمويل إضافي',
    'investor_deposit': 'إيداع ممول',
    'investor_withdrawal': 'سحب ممول',
    'other': 'أخرى'
};

// ============================================================
// 2.2 ROLE HELPER FUNCTIONS (مطلوب من auth.js و dashboard.js)
// ============================================================

function getUserRoleText(role) {
    var roleMap = {
        'admin': 'مدير',
        'viewer': 'مشاهد',
        'client': 'عميل',
        'investor': 'ممول'
    };
    return roleMap[role] || role || '-';
}

function getUserPermissionText(permission) {
    var permissionMap = {
        'admin': 'إدارة',
        'viewer': 'مشاهدة'
    };
    return permissionMap[permission] || permission || '-';
}

function isClient() {
    return APP.userRole === USER_ROLES.CLIENT;
}

function isInvestor() {
    return APP.userRole === USER_ROLES.INVESTOR;
}

function isViewer() {
    return APP.userRole === USER_ROLES.VIEWER;
}
// ============================================================
// 3. SCREEN LOADERS REGISTRY (مطلوب من app.js)
// ============================================================

var SCREEN_LOADERS = {};

function registerScreenLoader(screenName, loaderFn) {
    if (!screenName || typeof loaderFn !== 'function') {
        debug('❌ registerScreenLoader: معطيات غير صحيحة لـ ' + screenName, 'error');
        return;
    }
    
    SCREEN_LOADERS[screenName] = loaderFn;
    debug('✅ تم تسجيل Screen Loader: ' + screenName, 'success');
}

// ============================================================
// 4. DEBUG SYSTEM (زر عائم + Panel جانبي)
// ============================================================

var DEBUG_STATE = {
    isOpen: false,
    logCount: 0
};

function initDebugPanel() {
    if (!APP.DEBUG_MODE) return;
    
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _createDebugPanel);
    } else {
        _createDebugPanel();
    }
}

function _createDebugPanel() {
    // إزالة أي Debug قديم
    ['debugWidgetContainer', 'debugFloatingBtn', 'debugPanel'].forEach(function(id) {
        var el = document.getElementById(id);
        if (el) el.remove();
    });

    // إنشاء الزر العائم
    var btn = document.createElement('button');
    btn.id = 'debugFloatingBtn';
    btn.innerHTML = '🐞';
    btn.title = 'Debug Panel';
    btn.setAttribute('aria-label', 'فتح لوحة التصحيح');
    btn.onclick = toggleDebugPanel;
    document.body.appendChild(btn);

    // إنشاء الـ Panel الجانبي
    var panel = document.createElement('div');
    panel.id = 'debugPanel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'لوحة التصحيح');
    
    panel.innerHTML = 
        '<div id="debugPanelHeader">' +
            '<h3>🐞 Debug Panel (<span id="debugCounter">0</span>)</h3>' +
            '<button id="debugCloseBtn" aria-label="إغلاق">✕</button>' +
        '</div>' +
        '<div id="debugPanelContent">' +
            '<div id="debugLog" aria-live="polite"></div>' +
            '<div id="debugPanelControls">' +
                '<button id="debugClearBtn">🗑️ Clear</button>' +
                '<button id="debugCopyBtn">📋 Copy</button>' +
            '</div>' +
        '</div>';
    
    document.body.appendChild(panel);
    
    // ربط الأحداث بعد الإضافة للـ DOM
    setTimeout(function() {
        var closeBtn = document.getElementById('debugCloseBtn');
        var clearBtn = document.getElementById('debugClearBtn');
        var copyBtn = document.getElementById('debugCopyBtn');
        
        if (closeBtn) closeBtn.onclick = toggleDebugPanel;
        if (clearBtn) clearBtn.onclick = clearDebug;
        if (copyBtn) copyBtn.onclick = copyDebug;
    }, 100);
    
    debug('✅ Debug Panel initialized (v' + APP.VERSION + ')', 'success');
}

function toggleDebugPanel() {
    var panel = document.getElementById('debugPanel');
    if (!panel) return;
    
    DEBUG_STATE.isOpen = !DEBUG_STATE.isOpen;
    
    if (DEBUG_STATE.isOpen) {
        panel.classList.add('open');
        var log = document.getElementById('debugLog');
        if (log) log.scrollTop = log.scrollHeight;
    } else {
        panel.classList.remove('open');
    }
}

// ============================================================
// 4.1 ALIASES FOR APP.JS COMPATIBILITY
// ============================================================
// app.js يستدعي: toggleDebug(), clearDebugLog(), copyDebugLog()

window.toggleDebug = toggleDebugPanel;
window.toggleDebugPanel = toggleDebugPanel;

window.clearDebugLog = function() { clearDebug(); };
window.clearDebug = function() {
    var log = document.getElementById('debugLog');
    if (log) log.innerHTML = '';
    
    var counter = document.getElementById('debugCounter');
    if (counter) counter.innerText = '0';
    
    DEBUG_STATE.logCount = 0;
};

window.copyDebugLog = function() { copyDebug(); };
window.copyDebug = function() {
    var log = document.getElementById('debugLog');
    if (!log) return;
    
    var text = log.innerText;
    
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function() {
            showToast('✅ تم نسخ السجل', 'success');
        }).catch(function() {
            _fallbackCopy(text);
        });
    } else {
        _fallbackCopy(text);
    }
};

function _fallbackCopy(text) {
    var textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    
    try {
        document.execCommand('copy');
        showToast('✅ تم نسخ السجل', 'success');
    } catch (e) {
        showToast('❌ فشل النسخ', 'error');
    }
    
    document.body.removeChild(textarea);
}

function updateDebugCount() {
    var counter = document.getElementById('debugCounter');
    if (counter) counter.innerText = DEBUG_STATE.logCount;
}

function appendDebugLog(msg, type) {
    var log = document.getElementById('debugLog');
    if (!log) return;
    
    var color = '#00ff00';
    if (type === 'error') color = '#ff4444';
    else if (type === 'warn') color = '#ffcc00';
    else if (type === 'success') color = '#00ccff';
    else if (type === 'info') color = '#00ff00';
    
    var time = new Date().toLocaleTimeString('ar-EG');
    var entry = document.createElement('div');
    entry.style.color = color;
    entry.textContent = '[' + time + '] ' + msg;
    
    log.appendChild(entry);
    DEBUG_STATE.logCount++;
    
    while (log.children.length > CONSTANTS.MAX_LOG_ENTRIES) {
        log.removeChild(log.firstChild);
    }
    
    updateDebugCount();
    log.scrollTop = log.scrollHeight;
}

function debug(msg, type) {
    if (!APP.DEBUG_MODE) return;
    
    type = type || 'info';
    appendDebugLog(msg, type);
    
    try {
        if (type === 'error') console.error('[DEBUG] ' + msg);
        else if (type === 'warn') console.warn('[DEBUG] ' + msg);
        else if (type === 'success') console.info('[DEBUG] ' + msg);
        else console.log('[DEBUG] ' + msg);
    } catch (e) {}
}

// ============================================================
// 5. SUPABASE INITIALIZATION (يُستدعى من app.js)
// ============================================================

function initSupabase() {
    debug('⚙️ بدء تهيئة Supabase...', 'info');
    
    var SUPABASE_URL = 'https://znkexrtkqzmsqnmzvxoq.supabase.co';
    
    // ✅ المفتاح الصحيح من Supabase Dashboard
    var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inpua2V4cnRrcXptc3FubXp2eG9xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU0MTc3NDYsImV4cCI6MjEwMDk5Mzc0Nn0.QyPjqtKy0dS-uoXiefiPfXURnBqR_FBJcZMpGWj_1Rs';
    
    if (typeof supabase === 'undefined') {
        debug('❌ مكتبة Supabase غير محملة. تأكد من وجود <script> في index.html', 'error');
        showToast('❌ فشل تحميل مكتبة Supabase', 'error');
        return false;
    }
    
    try {
        APP.supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        debug('✅ Supabase تم تهيئته بنجاح', 'success');
        return true;
    } catch (err) {
        debug('❌ خطأ في initSupabase: ' + err.message, 'error');
        showToast('❌ فشل في تهيئة قاعدة البيانات', 'error');
        return false;
    }
}

function isSupabaseReady() {
    return !!(APP.supabase);
}

async function runQuery(queryFn, options) {
    options = options || {};
    var context = options.context || 'unknown';
    var throwError = options.throwError !== false;
    
    try {
        if (!isSupabaseReady()) {
            throw new Error('Supabase غير جاهز');
        }
        
        var query = queryFn();
        var result = await query;
        
        if (result.error) {
            throw result.error;
        }
        
        return result;
    } catch (err) {
        debug('❌ خطأ في runQuery [' + context + ']: ' + err.message, 'error');
        
        if (throwError) throw err;
        return { data: null, error: err };
    }
}

function handleSupabaseError(err, context) {
    context = context || 'Operation';
    var message = 'خطأ في ' + context;
    
    if (err && err.message) {
        if (err.message.includes('duplicate key')) {
            message = '❌ البيانات مكررة. يرجى التحقق من المدخلات.';
        } else if (err.message.includes('foreign key')) {
            message = '❌ لا يمكن تنفيذ العملية بسبب ارتباطات موجودة.';
        } else if (err.message.includes('policy')) {
            message = '❌ لا توجد صلاحية لتنفيذ هذه العملية.';
        } else if (err.message.includes('JWT') || err.message.includes('token')) {
            message = '❌ انتهت صلاحية الجلسة. يرجى تسجيل الدخول مرة أخرى.';
        } else if (err.message.includes('fetch')) {
            message = '❌ فشل الاتصال بالخادم. يرجى التحقق من الإنترنت.';
        } else if (err.message.includes('Invalid API key')) {
            message = '❌ مفتاح API غير صحيح. راجع الإعدادات.';
        } else {
            message = '❌ ' + err.message;
        }
    }
    
    debug('❌ Error in ' + context + ': ' + (err.message || err), 'error');
    return message;
}

// ============================================================
// 6. LOADING
// ============================================================

var LOADING_STATE = { count: 0 };

function showLoading() {
    LOADING_STATE.count++;
    
    var loader = document.getElementById('loadingOverlay');
    if (!loader) {
        loader = document.createElement('div');
        loader.id = 'loadingOverlay';
        loader.innerHTML = '<div class="loading-spinner"><div class="spinner"></div><p>جاري التحميل...</p></div>';
        document.body.appendChild(loader);
    }
    
    loader.style.display = 'flex';
    document.body.style.overflow = 'hidden';
}

function hideLoading() {
    if (LOADING_STATE.count > 0) LOADING_STATE.count--;
    
    if (LOADING_STATE.count <= 0) {
        LOADING_STATE.count = 0;
        var loader = document.getElementById('loadingOverlay');
        if (loader) {
            setTimeout(function() {
                if (LOADING_STATE.count === 0) {
                    loader.style.display = 'none';
                    document.body.style.overflow = '';
                }
            }, CONSTANTS.LOADING_MIN_DURATION);
        }
    }
}

// ============================================================
// 7. TOAST NOTIFICATIONS
// ============================================================

function showToast(message, type) {
    type = type || 'info';
    
    var container = document.getElementById('toastContainer');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toastContainer';
        container.className = 'toast-container';
        document.body.appendChild(container);
    }
    
    var toast = document.createElement('div');
    toast.className = 'toast toast-' + type;
    
    var icon = 'ℹ️';
    if (type === 'success') icon = '✅';
    else if (type === 'error') icon = '❌';
    else if (type === 'warning') icon = '⚠️';
    
    toast.innerHTML = '<span class="toast-icon">' + icon + '</span><span class="toast-message">' + escapeHtml(message) + '</span>';
    container.appendChild(toast);
    
    setTimeout(function() { toast.classList.add('show'); }, 10);
    
    setTimeout(function() {
        toast.classList.remove('show');
        setTimeout(function() {
            if (toast.parentNode) toast.parentNode.removeChild(toast);
        }, 300);
    }, CONSTANTS.TOAST_DURATION);
    
    debug('🔔 Toast [' + type + ']: ' + message, type === 'error' ? 'error' : 'info');
}

// ============================================================
// 8. MODAL HELPERS
// ============================================================

function openModal(modalId) {
    var modal = document.getElementById(modalId);
    if (!modal) {
        debug('❌ المودال غير موجود: ' + modalId, 'error');
        return;
    }
    
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
    
    modal.onclick = function(e) {
        if (e.target === modal) closeModal(modalId);
    };
    
    document.addEventListener('keydown', _modalEscHandler);
    debug('🪟 فتح المودال: ' + modalId, 'info');
}

function closeModal(modalId) {
    var modal = document.getElementById(modalId);
    if (!modal) return;
    
    modal.classList.remove('active');
    document.body.style.overflow = '';
    document.removeEventListener('keydown', _modalEscHandler);
    debug('🪟 إغلاق المودال: ' + modalId, 'info');
}

function _modalEscHandler(e) {
    if (e.key === 'Escape') {
        var activeModals = document.querySelectorAll('.modal.active');
        if (activeModals.length > 0) {
            closeModal(activeModals[activeModals.length - 1].id);
        }
    }
}

function closeAllModals() {
    var activeModals = document.querySelectorAll('.modal.active');
    activeModals.forEach(function(modal) {
        modal.classList.remove('active');
    });
    document.body.style.overflow = '';
    document.removeEventListener('keydown', _modalEscHandler);
}

// ============================================================
// 9. CONFIRMATION DIALOGS
// ============================================================

function confirmAction(message) {
    return confirm(message || 'هل أنت متأكد من تنفيذ هذا الإجراء؟');
}

function confirmDelete(itemName) {
    itemName = itemName || 'هذا العنصر';
    return confirm('⚠️ هل أنت متأكد من حذف ' + itemName + '؟\n\nلا يمكن التراجع عن هذا الإجراء.');
}

function confirmArchive(itemName) {
    itemName = itemName || 'هذا العنصر';
    return confirm('📦 هل أنت متأكد من أرشفة ' + itemName + '؟\n\nسيتم إخفاؤه من القوائم النشطة.');
}

// ============================================================
// 10. PERMISSIONS (مطلوب من auth.js و operations.js)
// ============================================================

function canEdit() {
    // إذا كان المستخدم Admin أو لديه صلاحية admin
    if (APP.userRole === USER_ROLES.ADMIN) return true;
    if (APP.userPermission === PERMISSIONS.ADMIN) return true;
    return false;
}

function isAdmin() {
    return APP.userRole === USER_ROLES.ADMIN;
}

function getCurrentUser() {
    return APP.currentUser || APP.user;
}

function getUserProfile() {
    return APP.userProfile;
}

// دالة تطبق الصلاحيات على الواجهة (مطلوبة من auth.js)
function applyPermissions() {
    debug('🔐 تطبيق الصلاحيات...', 'info');
    
    var role = APP.userRole;
    var permission = APP.userPermission;
    
    debug('👤 Role: ' + role + ', Permission: ' + permission, 'info');
    
    // إذا كان المستخدم ليس Admin، نخفي عناصر الإدارة
    if (!canEdit()) {
        var editButtons = document.querySelectorAll('[data-action*="edit"], [data-action*="delete"], [data-action*="archive"], [data-action*="add"]');
        editButtons.forEach(function(btn) {
            // نتأكد من أنها ليست أزرار View
            if (!btn.getAttribute('data-action').includes('view') && 
                !btn.getAttribute('data-action').includes('open') &&
                !btn.getAttribute('data-action').includes('show')) {
                btn.style.display = 'none';
            }
        });
    }
    
    // Client: يرى فقط شاشته
    if (role === USER_ROLES.CLIENT) {
        _hideScreensForRole(['dashboard', 'myAccount']);
    }
    
    // Investor: يرى فقط شاشته
    if (role === USER_ROLES.INVESTOR) {
        _hideScreensForRole(['dashboard', 'myAccount']);
    }
    
    debug('✅ تم تطبيق الصلاحيات', 'success');
}

function _hideScreensForRole(allowedScreens) {
    var navButtons = document.querySelectorAll('.nav-btn, .nav-item');
    navButtons.forEach(function(btn) {
        var screen = btn.getAttribute('data-screen');
        if (screen && allowedScreens.indexOf(screen) === -1) {
            btn.style.display = 'none';
        }
    });
}

// ============================================================
// 11. UTILITIES (دوال مساعدة)
// ============================================================

function formatMoney(amount) {
    if (amount === null || amount === undefined || isNaN(amount)) {
        return '0 ' + CONSTANTS.CURRENCY;
    }
    
    try {
        var num = parseFloat(amount);
        return num.toLocaleString('ar-EG', {
            minimumFractionDigits: 0,
            maximumFractionDigits: 2
        }) + ' ' + CONSTANTS.CURRENCY;
    } catch (e) {
        return amount + ' ' + CONSTANTS.CURRENCY;
    }
}

function formatDate(dateStr) {
    if (!dateStr) return '-';
    
    try {
        var date = new Date(dateStr);
        if (isNaN(date.getTime())) return '-';
        
        return date.toLocaleDateString('ar-EG', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
    } catch (e) {
        return dateStr;
    }
}

function formatDateTime(dateStr) {
    if (!dateStr) return '-';
    
    try {
        var date = new Date(dateStr);
        if (isNaN(date.getTime())) return '-';
        
        return date.toLocaleDateString('ar-EG', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    } catch (e) {
        return dateStr;
    }
}

function formatDateForInput(dateStr) {
    if (!dateStr) return '';
    
    try {
        var date = new Date(dateStr);
        if (isNaN(date.getTime())) return '';
        
        var year = date.getFullYear();
        var month = String(date.getMonth() + 1).padStart(2, '0');
        var day = String(date.getDate()).padStart(2, '0');
        
        return year + '-' + month + '-' + day;
    } catch (e) {
        return '';
    }
}

function getTodayDate() {
    return formatDateForInput(new Date());
}

// ✅ إضافة أيام لتاريخ (مطلوب من app.js - calculateEndDate)
function addDays(dateStr, days) {
    if (!dateStr) return null;
    
    try {
        var date = new Date(dateStr);
        if (isNaN(date.getTime())) return null;
        
        date.setDate(date.getDate() + parseInt(days));
        return date;
    } catch (e) {
        return null;
    }
}

function escapeHtml(text) {
    if (!text) return '';
    
    var map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    
    return String(text).replace(/[&<>"']/g, function(m) {
        return map[m];
    });
}

function truncateText(text, maxLength) {
    if (!text) return '';
    maxLength = maxLength || 50;
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
}

function isEmpty(value) {
    if (value === null || value === undefined) return true;
    if (typeof value === 'string') return value.trim() === '';
    if (Array.isArray(value)) return value.length === 0;
    if (typeof value === 'object') return Object.keys(value).length === 0;
    return false;
}

function isPositiveNumber(value) {
    var num = parseFloat(value);
    return !isNaN(num) && num > 0;
}

// ✅ التحقق من صحة البريد الإلكتروني (مطلوب من auth.js)
function isEmail(email) {
    if (!email) return false;
    var re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
}

// ✅ تغيير حالة الزر (مطلوب من auth.js)
function setButtonLoading(btnId, isLoading) {
    var btn = document.getElementById(btnId);
    if (!btn) return;
    
    if (isLoading) {
        btn.disabled = true;
        btn.dataset.originalText = btn.innerText;
        btn.innerText = '⏳ جاري...';
        btn.classList.add('loading');
    } else {
        btn.disabled = false;
        if (btn.dataset.originalText) {
            btn.innerText = btn.dataset.originalText;
            delete btn.dataset.originalText;
        }
        btn.classList.remove('loading');
    }
}

function generateId() {
    return 'id_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

function debounce(func, wait) {
    var timeout;
    return function() {
        var context = this;
        var args = arguments;
        clearTimeout(timeout);
        timeout = setTimeout(function() {
            func.apply(context, args);
        }, wait || 300);
    };
}

// ============================================================
// 12. ACTIVITY LOG HELPER
// ============================================================

async function logActivity(action, entityType, entityId, oldValue, newValue, details, actionType) {
    if (typeof window.logActivityToDB === 'function') {
        try {
            await window.logActivityToDB(action, entityType, entityId, oldValue, newValue, details, actionType);
        } catch (err) {
            debug('❌ فشل في تسجيل النشاط: ' + err.message, 'error');
        }
    } else {
        debug('⚠️ window.logActivityToDB غير معرفة', 'warn');
    }
}

// ============================================================
// 13. NAVIGATION HELPER
// ============================================================

function navigateTo(screenName) {
    if (typeof window.showScreen === 'function') {
        window.showScreen(screenName);
    } else {
        debug('⚠️ window.showScreen غير معرفة', 'warn');
    }
}

// ============================================================
// 14. INITIALIZATION (يتم استدعاؤها عند تحميل الملف فقط)
// ============================================================

function initCore() {
    debug('⚙️ بدء تهيئة core.js (v' + APP.VERSION + ')', 'info');
    initDebugPanel();
    debug('✅ core.js جاهز', 'success');
}

// ============================================================
// 15. GLOBAL ERROR HANDLER
// ============================================================

window.onerror = function(message, source, lineno, colno, error) {
    var errorMsg = 'خطأ غير متوقع: ' + message + ' في ' + source + ':' + lineno;
    debug('❌ ' + errorMsg, 'error');
    
    if (APP.DEBUG_MODE) {
        showToast('❌ حدث خطأ غير متوقع. راجع Debug Panel.', 'error');
    }
    
    return false;
};

window.addEventListener('unhandledrejection', function(event) {
    var reason = event.reason;
    var message = reason && reason.message ? reason.message : String(reason);
    debug('❌ Unhandled Promise Rejection: ' + message, 'error');
});

// ============================================================
// 16. STARTUP (تشغيل initCore فور تحميل الملف)
// ============================================================

// تشغيل initCore فوراً (فقط لإنشاء Debug Panel)
// ملاحظة: تهيئة Supabase و Auth تتم من app.js
if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initCore);
    } else {
        initCore();
    }
}
