// ============================================================
// نظام إدارة التمويل - Core Module
// Version: 6.0.0 (Production Ready - Complete Rewrite)
// Last Updated: 2026-08-03
// 
// يحتوي على:
// - APP State & Constants
// - Debug System (زر عائم + Panel جانبي)
// - Supabase Helpers
// - Loading & Notifications
// - Modal Helpers
// - Confirmation Dialogs
// - Screen Helpers
// - Utilities
// - Error Handling
// ============================================================

// ============================================================
// 1. APP OBJECT & CONSTANTS
// ============================================================

var APP = {
    supabase: null,
    user: null,
    userProfile: null,
    DEBUG_MODE: true,
    VERSION: '6.0.0',
    currentScreen: null,
    screenLoaders: {},
    isLoading: false
};

var CONSTANTS = {
    TOAST_DURATION: 4000,
    LOADING_MIN_DURATION: 300,
    MAX_LOG_ENTRIES: 500,
    DATE_FORMAT: 'ar-EG',
    CURRENCY: 'ج.م'
};

// ============================================================
// 2. DEBUG SYSTEM (New Design - Floating Button + Side Panel)
// ============================================================

var DEBUG_STATE = {
    isOpen: false,
    logCount: 0
};

function initDebugPanel() {
    if (!APP.DEBUG_MODE) return;
    
    // الانتظار حتى يتم تحميل DOM بالكامل
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _createDebugPanel);
    } else {
        _createDebugPanel();
    }
}

function _createDebugPanel() {
    // إزالة أي Debug قديم
    var oldElements = ['debugWidgetContainer', 'debugFloatingBtn', 'debugPanel'];
    oldElements.forEach(function(id) {
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
            '<button id="debugCloseBtn" onclick="toggleDebugPanel()" aria-label="إغلاق">✕</button>' +
        '</div>' +
        '<div id="debugPanelContent">' +
            '<div id="debugLog" aria-live="polite"></div>' +
            '<div id="debugPanelControls">' +
                '<button onclick="clearDebug()">🗑️ Clear</button>' +
                '<button onclick="copyDebug()">📋 Copy</button>' +
            '</div>' +
        '</div>';
    
    document.body.appendChild(panel);
    
    debug('✅ Debug Panel initialized (v' + APP.VERSION + ')', 'success');
}

function toggleDebugPanel() {
    var panel = document.getElementById('debugPanel');
    if (!panel) return;
    
    DEBUG_STATE.isOpen = !DEBUG_STATE.isOpen;
    
    if (DEBUG_STATE.isOpen) {
        panel.classList.add('open');
        // Scroll to bottom
        var log = document.getElementById('debugLog');
        if (log) log.scrollTop = log.scrollHeight;
    } else {
        panel.classList.remove('open');
    }
}

function clearDebug() {
    var log = document.getElementById('debugLog');
    if (log) log.innerHTML = '';
    
    var counter = document.getElementById('debugCounter');
    if (counter) counter.innerText = '0';
    
    DEBUG_STATE.logCount = 0;
}

function copyDebug() {
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
}

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
    if (counter) {
        counter.innerText = DEBUG_STATE.logCount;
    }
}

function appendDebugLog(msg, type) {
    var log = document.getElementById('debugLog');
    if (!log) return;
    
    // تحديد اللون حسب النوع
    var color = '#00ff00'; // default: green
    if (type === 'error') color = '#ff4444';
    else if (type === 'warn') color = '#ffcc00';
    else if (type === 'success') color = '#00ccff';
    else if (type === 'info') color = '#00ff00';
    
    var time = new Date().toLocaleTimeString('ar-EG');
    var entry = document.createElement('div');
    entry.style.color = color;
    entry.textContent = '[' + time + '] ' + msg;
    
    log.appendChild(entry);
    
    // تحديد عدد السجلات
    DEBUG_STATE.logCount++;
    
    // إزالة السجلات القديمة إذا تجاوزت الحد
    while (log.children.length > CONSTANTS.MAX_LOG_ENTRIES) {
        log.removeChild(log.firstChild);
    }
    
    updateDebugCount();
    
    // Auto-scroll to bottom
    log.scrollTop = log.scrollHeight;
}

function debug(msg, type) {
    if (!APP.DEBUG_MODE) return;
    
    type = type || 'info';
    
    // إضافة إلى الـ Panel
    appendDebugLog(msg, type);
    
    // إضافة إلى console
    try {
        if (type === 'error') console.error('[DEBUG] ' + msg);
        else if (type === 'warn') console.warn('[DEBUG] ' + msg);
        else if (type === 'success') console.info('[DEBUG] ' + msg);
        else console.log('[DEBUG] ' + msg);
    } catch (e) {
        // console غير متاح
    }
}

// ============================================================
// 3. SUPABASE HELPERS
// ============================================================

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
        
        if (throwError) {
            throw err;
        }
        
        return { data: null, error: err };
    }
}

function handleSupabaseError(err, context) {
    context = context || 'Operation';
    
    var message = 'خطأ في ' + context;
    
    if (err && err.message) {
        // ترجمة رسائل Supabase الشائعة
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
        } else {
            message = '❌ ' + err.message;
        }
    }
    
    debug('❌ Error in ' + context + ': ' + (err.message || err), 'error');
    
    return message;
}

// ============================================================
// 4. LOADING
// ============================================================

var LOADING_STATE = {
    count: 0,
    timer: null
};

function showLoading() {
    LOADING_STATE.count++;
    
    var loader = document.getElementById('loadingOverlay');
    if (!loader) {
        // إنشاء loader إذا لم يكن موجوداً
        loader = document.createElement('div');
        loader.id = 'loadingOverlay';
        loader.innerHTML = '<div class="loading-spinner"><div class="spinner"></div><p>جاري التحميل...</p></div>';
        document.body.appendChild(loader);
    }
    
    loader.style.display = 'flex';
    
    // منع التمرير
    document.body.style.overflow = 'hidden';
}

function hideLoading() {
    if (LOADING_STATE.count > 0) {
        LOADING_STATE.count--;
    }
    
    if (LOADING_STATE.count <= 0) {
        LOADING_STATE.count = 0;
        
        var loader = document.getElementById('loadingOverlay');
        if (loader) {
            // تأخير بسيط لتحسين UX
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
// 5. TOAST / NOTIFICATIONS
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
    
    // Animation in
    setTimeout(function() {
        toast.classList.add('show');
    }, 10);
    
    // Auto remove
    setTimeout(function() {
        toast.classList.remove('show');
        setTimeout(function() {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
        }, 300);
    }, CONSTANTS.TOAST_DURATION);
    
    // تسجيل في Debug
    debug('🔔 Toast [' + type + ']: ' + message, type === 'error' ? 'error' : 'info');
}

// ============================================================
// 6. MODAL HELPERS
// ============================================================

function openModal(modalId) {
    var modal = document.getElementById(modalId);
    if (!modal) {
        debug('❌ المودال غير موجود: ' + modalId, 'error');
        return;
    }
    
    modal.classList.add('active');
    
    // منع التمرير في الخلفية
    document.body.style.overflow = 'hidden';
    
    // إغلاق عند الضغط على الخلفية
    modal.onclick = function(e) {
        if (e.target === modal) {
            closeModal(modalId);
        }
    };
    
    // إغلاق عند الضغط على Escape
    document.addEventListener('keydown', _modalEscHandler);
    
    debug('🪟 فتح المودال: ' + modalId, 'info');
}

function closeModal(modalId) {
    var modal = document.getElementById(modalId);
    if (!modal) return;
    
    modal.classList.remove('active');
    
    // إعادة التمرير
    document.body.style.overflow = '';
    
    // إزالة مستمع Escape
    document.removeEventListener('keydown', _modalEscHandler);
    
    debug('🪟 إغلاق المودال: ' + modalId, 'info');
}

function _modalEscHandler(e) {
    if (e.key === 'Escape') {
        var activeModals = document.querySelectorAll('.modal.active');
        if (activeModals.length > 0) {
            var lastModal = activeModals[activeModals.length - 1];
            closeModal(lastModal.id);
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
// 7. CONFIRMATION DIALOGS
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
// 8. SCREEN HELPERS
// ============================================================

function registerScreenLoader(screenName, loaderFn) {
    if (!screenName || typeof loaderFn !== 'function') {
        debug('❌ registerScreenLoader: معطيات غير صحيحة', 'error');
        return;
    }
    
    APP.screenLoaders[screenName] = loaderFn;
    debug('✅ تم تسجيل Screen Loader: ' + screenName, 'success');
}

async function loadScreen(screenName) {
    if (!screenName) return;
    
    APP.currentScreen = screenName;
    
    var loader = APP.screenLoaders[screenName];
    if (loader && typeof loader === 'function') {
        debug('📱 تحميل الشاشة: ' + screenName, 'info');
        
        try {
            await loader();
        } catch (err) {
            debug('❌ خطأ في تحميل الشاشة ' + screenName + ': ' + err.message, 'error');
            showToast('❌ فشل في تحميل الشاشة', 'error');
        }
    } else {
        debug('⚠️ لا يوجد Screen Loader للشاشة: ' + screenName, 'warn');
    }
}

// ============================================================
// 9. UTILITIES
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
// 10. AUTH HELPERS (Wrapper Functions)
// ============================================================

// ملاحظة: هذه الدوال تستدعي الدوال المعرفة في auth.js
// إذا لم تكن موجودة، تعيد قيم افتراضية آمنة

function canEdit() {
    if (typeof window._canEdit === 'function') {
        return window._canEdit();
    }
    
    // Fallback: التحقق من userProfile
    if (APP.userProfile) {
        return APP.userProfile.permission === 'admin' || APP.userProfile.role === 'admin';
    }
    
    return false;
}

function isAdmin() {
    if (typeof window._isAdmin === 'function') {
        return window._isAdmin();
    }
    
    if (APP.userProfile) {
        return APP.userProfile.role === 'admin';
    }
    
    return false;
}

function getCurrentUser() {
    return APP.user;
}

function getUserProfile() {
    return APP.userProfile;
}

// ============================================================
// 11. ACTIVITY LOG HELPER
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
// 12. NAVIGATION HELPERS
// ============================================================

function navigateTo(screenName) {
    if (typeof window.showScreen === 'function') {
        window.showScreen(screenName);
    } else {
        debug('⚠️ window.showScreen غير معرفة', 'warn');
    }
}

// ============================================================
// 13. INITIALIZATION
// ============================================================

function initCore() {
    debug('⚙️ بدء تهيئة core.js (v' + APP.VERSION + ')', 'info');
    
    // تهيئة Debug Panel
    initDebugPanel();
    
    // الاستماع لأحداث DOM
    document.addEventListener('DOMContentLoaded', function() {
        debug('✅ DOM جاهز', 'success');
    });
    
    debug('✅ core.js جاهز', 'success');
}

// ============================================================
// 14. GLOBAL ERROR HANDLER
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
    
    if (APP.DEBUG_MODE) {
        showToast('❌ حدث خطأ في العملية. راجع Debug Panel.', 'error');
    }
});

// ============================================================
// 15. STARTUP
// ============================================================

// تهيئة core.js عند تحميل الملف
if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initCore);
    } else {
        initCore();
    }
}
