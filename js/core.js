// ============================================================
// نظام إدارة التمويل - Core Module
// Version: 1.1.0
// Last Updated: 2026-08-02
// ============================================================
//
// المسؤوليات:
// - Configuration
// - Constants
// - Global State (APP Object)
// - Debug System
// - Utility Functions
// - Shared Helpers
// - Supabase Helpers
//
// ملاحظة: هذا الملف لا يعتمد على أي ملف آخر
// ============================================================


// ============================================================
// 1. CONFIGURATION
// ============================================================

var SUPABASE_URL = 'https://znkexrtkqzmsqnmzvxoq.supabase.co';
var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inpua2V4cnRrcXptc3FubXp2eG9xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU0MTc3NDYsImV4cCI6MjEwMDk5Mzc0Nn0.QyPjqtKy0dS-uoXiefiPfXURnBqR_FBJcZMpGWj_1Rs';


// ============================================================
// 2. CONSTANTS
// ============================================================

var STATUS = Object.freeze({
    DRAFT: 'draft',
    ACTIVE: 'active',
    COMPLETED: 'completed',
    CANCELLED: 'cancelled'
});

var STATUS_TEXT = Object.freeze({
    draft: 'تحت الإنشاء',
    active: 'نشطة',
    completed: 'انتهت',
    cancelled: 'ألغيت'
});

var USER_ROLES = Object.freeze({
    ADMIN: 'admin',
    VIEWER: 'viewer',
    CLIENT: 'client',
    INVESTOR: 'investor'
});

var USER_ROLES_TEXT = Object.freeze({
    admin: 'مدير',
    viewer: 'مراقب',
    client: 'عميل',
    investor: 'ممول'
});

var PERMISSIONS = Object.freeze({
    ADMIN: 'admin',
    VIEWER: 'viewer'
});

var OPERATION_TYPES = Object.freeze({
    FINANCING: 'financing',
    SUPPLY: 'supply'
});

var OPERATION_TYPES_TEXT = Object.freeze({
    financing: 'تمويل',
    supply: 'توريد'
});

var COMPANY_PROFIT_TYPES = Object.freeze({
    PERCENTAGE: 'percentage',
    FIXED: 'fixed'
});

var TRANSFER_TYPES = Object.freeze({
    COMPANY_TO_CLIENT: 'company_to_client',
    CLIENT_TO_COMPANY: 'client_to_company',
    COMPANY_TO_INVESTOR: 'company_to_investor'
});

var TRANSFER_TYPES_TEXT = Object.freeze({
    company_to_client: 'شركة → عميل',
    client_to_company: 'عميل → شركة',
    company_to_investor: 'شركة → ممول'
});

var TRANSFER_PURPOSES = Object.freeze({
    CLIENT_FUNDING: 'client_funding',
    CLIENT_REPAYMENT: 'client_repayment',
    CAPITAL_RETURN: 'capital_return',
    PROFIT_DISTRIBUTION: 'profit_distribution',
    SETTLEMENT: 'settlement',
    ADDITIONAL_FUNDING: 'additional_funding',
    OTHER: 'other'
});

var TRANSFER_PURPOSES_TEXT = Object.freeze({
    client_funding: 'تمويل',
    client_repayment: 'سداد',
    capital_return: 'إرجاع رأس مال',
    profit_distribution: 'توزيع أرباح',
    settlement: 'تسوية',
    additional_funding: 'تمويل إضافي',
    other: 'أخرى'
});

var PARTY_TYPES = Object.freeze({
    CLIENT: 'client',
    INVESTOR: 'investor',
    COMPANY: 'company'
});

var PARTY_TYPES_TEXT = Object.freeze({
    client: 'عميل',
    investor: 'ممول',
    company: 'شركة'
});

var TRANSACTION_CATEGORIES = Object.freeze({
    CLIENT_DEPOSIT_IN: 'client_deposit_in',
    CLIENT_USE_OUT: 'client_use_out',
    CLIENT_RETURN_OUT: 'client_return_out',
    CLIENT_ADJUST: 'client_adjust',
    INVESTOR_CAPITAL_IN: 'investor_capital_in',
    INVESTOR_OPERATION_IN: 'investor_operation_in',
    INVESTOR_RETURN_OUT: 'investor_return_out',
    INVESTOR_PROFIT_OUT: 'investor_profit_out',
    COMPANY_EXPENSE_OUT: 'company_expense_out',
    COMPANY_INCOME_IN: 'company_income_in',
    COMPANY_TRANSFER: 'company_transfer'
});

var TRANSACTION_CATEGORIES_TEXT = Object.freeze({
    client_deposit_in: 'إيداع لدى الشركة',
    client_use_out: 'استخدام رصيد في عملية',
    client_return_out: 'رد رصيد للعميل',
    client_adjust: 'تعديل رصيد',
    investor_capital_in: 'إضافة رأس مال',
    investor_operation_in: 'دخول عملية',
    investor_return_out: 'إرجاع رأس مال',
    investor_profit_out: 'صرف أرباح',
    company_expense_out: 'مصروف',
    company_income_in: 'إيراد',
    company_transfer: 'تحويل داخلي'
});


// ============================================================
// 3. GLOBAL STATE (APP Object)
// ============================================================
// ملاحظة: userRole و userPermission يبدأان بـ null
// يتم تعيينهما فقط بعد التحقق من user_profiles في auth.js
// ============================================================

var APP = {
    supabase: null,
    currentUser: null,
    userRole: null,
    userPermission: null,
    currentOperation: null,
    currentOperationData: null,
    currentEntityId: null,
    currentScreen: 'dashboard',
    isLoading: false
};


// ============================================================
// 4. SUPABASE INITIALIZATION
// ============================================================

function initSupabase() {
    try {
        if (typeof window.supabase === 'undefined') {
            debug('❌ مكتبة Supabase لم تُحمّل!', 'error');
            return false;
        }
        
        APP.supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        debug('✅ تم إنشاء Supabase Client', 'success');
        return true;
    } catch (err) {
        debug('❌ خطأ في createClient: ' + err.message, 'error');
        return false;
    }
}


// ============================================================
// 5. DEBUG SYSTEM
// ============================================================

var DEBUG_MODE = true;
var debugMessages = [];

/**
 * نظام Debug المرن - يدعم String أو Object
 * @param {string|Object} input - الرسالة أو الكائن
 * @param {string} type - نوع الرسالة (info, success, warning, error)
 */
function debug(input, type) {
    type = type || 'info';
    if (!DEBUG_MODE) return;
    
    var msg, data;
    
    // دعم String (توافق عكسي)
    if (typeof input === 'string') {
        msg = input;
        data = null;
    }
    // دعم Object (مرونة)
    else if (typeof input === 'object' && input !== null) {
        msg = input.message || 'Debug message';
        type = input.type || type;
        data = input.data || null;
    } else {
        msg = String(input);
        data = null;
    }
    
    var time = new Date().toLocaleTimeString('ar-EG');
    var fullMsg = '[' + time + '] [' + APP.currentScreen + '] ' + msg;
    
    debugMessages.push({
        msg: msg,
        type: type,
        time: time,
        screen: APP.currentScreen,
        data: data
    });
    
    var debugContent = document.getElementById('debugContent');
    if (debugContent) {
        var line = document.createElement('div');
        line.className = 'debug-line debug-' + type;
        line.textContent = fullMsg;
        debugContent.appendChild(line);
        
        var debugBox = document.getElementById('debugBox');
        if (debugBox) {
            debugBox.scrollTop = debugBox.scrollHeight;
        }
    }
}

function logError(funcName, errorMsg, details) {
    details = details || {};
    var msg = '❌ [' + funcName + '] ' + errorMsg;
    
    if (details.query) msg += ' | Query: ' + details.query;
    if (details.data) msg += ' | Data: ' + JSON.stringify(details.data).substring(0, 100);
    if (details.response) msg += ' | Response: ' + JSON.stringify(details.response).substring(0, 100);
    if (details.user) msg += ' | User: ' + details.user;
    if (details.stack) msg += ' | Stack: ' + details.stack;
    
    debug(msg, 'error');
    console.error(msg);
}

function toggleDebugBox() {
    var debugBox = document.getElementById('debugBox');
    if (debugBox) {
        debugBox.classList.toggle('expanded');
    }
}

function toggleDebug() {
    DEBUG_MODE = !DEBUG_MODE;
    var statusEl = document.getElementById('debugStatus');
    if (statusEl) {
        statusEl.textContent = DEBUG_MODE ? '[مفعّل]' : '[متوقف]';
        statusEl.style.color = DEBUG_MODE ? '#4caf50' : '#f44336';
    }
    debug('Debug Mode: ' + (DEBUG_MODE ? 'ON' : 'OFF'), 'info');
}

function clearDebugLog() {
    debugMessages = [];
    var el = document.getElementById('debugContent');
    if (el) el.innerHTML = '';
    debug('تم مسح السجل', 'info');
}

function copyDebugLog() {
    var text = debugMessages.map(function(m) {
        var line = '[' + m.time + '] [' + m.screen + '] ' + m.msg;
        if (m.data) line += ' | Data: ' + JSON.stringify(m.data);
        return line;
    }).join('\n');
    
    if (navigator.clipboard) {
        navigator.clipboard.writeText(text)
            .then(function() { debug('✅ تم نسخ السجل', 'success'); })
            .catch(function() { debug('❌ فشل النسخ', 'error'); });
    } else {
        debug('⚠️ Clipboard غير متاح', 'warning');
    }
}

// التقاط الأخطاء العامة
window.onerror = function(message, source, line, col, error) {
    debug('❌ JavaScript Error: ' + message + ' (Line: ' + line + ')', 'error');
    if (error && error.stack) {
        debug('Stack: ' + error.stack.substring(0, 200), 'error');
    }
    return true;
};

window.onunhandledrejection = function(event) {
    debug('❌ Promise Error: ' + event.reason, 'error');
};


// ============================================================
// 6. UTILITY FUNCTIONS
// ============================================================

// ------------------------------------------------------------
// 6.1 Toast Notifications
// ------------------------------------------------------------

function showToast(msg, type) {
    type = type || 'success';
    var t = document.getElementById('toast');
    if (!t) return;
    
    t.textContent = msg;
    t.className = 'toast show ' + type;
    
    setTimeout(function() {
        t.className = 'toast';
    }, 3000);
}

// ------------------------------------------------------------
// 6.2 Money Helpers
// ------------------------------------------------------------

function formatMoney(n) {
    return (parseFloat(n) || 0).toLocaleString('ar-EG', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }) + ' ج.م';
}

function parseMoney(value) {
    return safeParseFloat(value, 0);
}

// ------------------------------------------------------------
// 6.3 Date Helpers
// ------------------------------------------------------------

function formatDate(d) {
    if (!d) return '-';
    return new Date(d).toLocaleDateString('ar-EG');
}

function formatDateTime(d) {
    if (!d) return '-';
    return new Date(d).toLocaleString('ar-EG');
}

function formatDateForInput(date) {
    if (!date) return '';
    var d = new Date(date);
    var year = d.getFullYear();
    var month = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return year + '-' + month + '-' + day;
}

function getTodayDate() {
    return formatDateForInput(new Date());
}

function addDays(date, days) {
    var result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
}

function addMonths(date, months) {
    var result = new Date(date);
    var originalDay = result.getDate();
    result.setMonth(result.getMonth() + months);
    
    // Last Day of Month - إذا تجاوز اليوم نهاية الشهر الجديد
    if (result.getDate() !== originalDay) {
        result.setDate(0);
    }
    
    return result;
}

function isDatePast(date) {
    if (!date) return false;
    return new Date(date) < new Date();
}

function isDateFuture(date) {
    if (!date) return false;
    return new Date(date) > new Date();
}

function isDateWithinDays(date, days) {
    if (!date) return false;
    var target = new Date(date);
    var now = new Date();
    var diff = target - now;
    var daysDiff = diff / (1000 * 60 * 60 * 24);
    return daysDiff >= 0 && daysDiff <= days;
}

function daysBetween(date1, date2) {
    if (!date1 || !date2) return 0;
    var d1 = new Date(date1);
    var d2 = new Date(date2);
    var diff = Math.abs(d2 - d1);
    return Math.floor(diff / (1000 * 60 * 60 * 24));
}

// ------------------------------------------------------------
// 6.4 Text Helpers
// ------------------------------------------------------------

function getStatusText(status) {
    return STATUS_TEXT[status] || status;
}

function getPartyTypeText(type) {
    return PARTY_TYPES_TEXT[type] || type;
}

function getTransferTypeText(type) {
    return TRANSFER_TYPES_TEXT[type] || type;
}

function getPurposeText(purpose) {
    return TRANSFER_PURPOSES_TEXT[purpose] || purpose;
}

function getTransactionCategoryText(category) {
    return TRANSACTION_CATEGORIES_TEXT[category] || category;
}

function getUserRoleText(role) {
    return USER_ROLES_TEXT[role] || role;
}

function getOperationTypeText(type) {
    return OPERATION_TYPES_TEXT[type] || type;
}

function escapeHtml(text) {
    if (!text) return '';
    var div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function truncateText(text, maxLength) {
    if (!text) return '';
    maxLength = maxLength || 50;
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
}

// ------------------------------------------------------------
// 6.5 Modal Helpers
// ------------------------------------------------------------

function closeModal(id) {
    var el = document.getElementById(id);
    if (el) el.classList.remove('active');
}

function openModal(id) {
    var el = document.getElementById(id);
    if (el) el.classList.add('active');
}

function closeAllModals() {
    var modals = document.querySelectorAll('.modal.active');
    for (var i = 0; i < modals.length; i++) {
        modals[i].classList.remove('active');
    }
}

// ------------------------------------------------------------
// 6.6 Validation Helpers
// ------------------------------------------------------------

function isEmpty(value) {
    if (value === null || value === undefined) return true;
    if (typeof value === 'string') return value.trim() === '';
    if (Array.isArray(value)) return value.length === 0;
    if (typeof value === 'object') return Object.keys(value).length === 0;
    return false;
}

function isNotEmpty(value) {
    return !isEmpty(value);
}

function isUUID(value) {
    if (!value || typeof value !== 'string') return false;
    var uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return uuidRegex.test(value);
}

function isEmail(value) {
    if (!value || typeof value !== 'string') return false;
    var emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(value);
}

function isPositiveNumber(value) {
    var num = parseFloat(value);
    return !isNaN(num) && num > 0;
}

function isNonNegativeNumber(value) {
    var num = parseFloat(value);
    return !isNaN(num) && num >= 0;
}

function isValidDate(value) {
    if (!value) return false;
    var d = new Date(value);
    return !isNaN(d.getTime());
}

function isDateInRange(date, startDate, endDate) {
    if (!date || !startDate || !endDate) return false;
    var d = new Date(date);
    var start = new Date(startDate);
    var end = new Date(endDate);
    return d >= start && d <= end;
}

// ------------------------------------------------------------
// 6.7 Confirmation Helpers
// ------------------------------------------------------------

function confirmAction(message) {
    return window.confirm(message);
}

function confirmDelete(itemName) {
    return window.confirm('هل أنت متأكد من حذف "' + itemName + '"؟\nلا يمكن التراجع عن هذه العملية.');
}

function confirmArchive(itemName) {
    return window.confirm('هل تريد أرشفة "' + itemName + '"؟\nسيتم إخفاؤه من القوائم الرئيسية.');
}

function confirmUnarchive(itemName) {
    return window.confirm('هل تريد إلغاء أرشفة "' + itemName + '"؟');
}

function confirmUnlock(operationName) {
    return window.confirm('هل تريد فتح قفل العملية "' + operationName + '"؟\nسيتم تسجيل هذا الإجراء في سجل النشاط.');
}

function confirmActivate(operationName) {
    return window.confirm('هل تريد تفعيل العملية "' + operationName + '"؟\nتأكد من اكتمال جميع البيانات قبل التفعيل.');
}

function confirmComplete(operationName) {
    return window.confirm('هل تريد إنهاء العملية "' + operationName + '"؟\nسيتم قفلها تلقائياً بعد الإنهاء.');
}


// ============================================================
// 7. LOADING HELPERS
// ============================================================

function showLoading() {
    APP.isLoading = true;
    var overlay = document.getElementById('loadingOverlay');
    if (overlay) {
        overlay.style.display = 'flex';
    }
}

function hideLoading() {
    APP.isLoading = false;
    var overlay = document.getElementById('loadingOverlay');
    if (overlay) {
        overlay.style.display = 'none';
    }
}

function setButtonLoading(buttonId, isLoading) {
    var btn = document.getElementById(buttonId);
    if (!btn) return;
    
    if (isLoading) {
        btn.disabled = true;
        btn.setAttribute('data-original-text', btn.textContent);
        btn.textContent = 'جاري التحميل...';
        btn.classList.add('loading');
    } else {
        btn.disabled = false;
        var originalText = btn.getAttribute('data-original-text');
        if (originalText) btn.textContent = originalText;
        btn.classList.remove('loading');
    }
}

function clearButtonLoading(buttonId) {
    setButtonLoading(buttonId, false);
}

function disableButton(buttonId) {
    var btn = document.getElementById(buttonId);
    if (btn) btn.disabled = true;
}

function enableButton(buttonId) {
    var btn = document.getElementById(buttonId);
    if (btn) btn.disabled = false;
}


// ============================================================
// 8. SUPABASE HELPERS
// ============================================================

/**
 * تنفيذ استعلام Supabase مع معالجة الأخطاء الموحدة
 * @param {Function} queryFn - دالة الاستعلام
 * @param {string|Object} options - سياق العملية أو خيارات متقدمة
 * @param {string} options.context - سياق العملية (للتقارير)
 * @param {boolean} options.throwError - هل نرمي الخطأ أم نرجعه؟
 * @returns {Promise<Object>} - { data, error }
 */
async function runQuery(queryFn, options) {
    // دعم التوافق العكسي - إذا كان options string، نعامله كـ context
    if (typeof options === 'string') {
        options = { context: options, throwError: false };
    }
    
    options = options || {};
    var context = options.context || 'unknown';
    var throwError = options.throwError || false;
    
    try {
        var result = await queryFn();
        
        if (result.error) {
            debug({
                message: '❌ خطأ في ' + context + ': ' + result.error.message,
                type: 'error',
                data: {
                    context: context,
                    error: result.error,
                    code: result.error.code
                }
            }, 'error');
            
            if (throwError) {
                throw result.error;
            }
            
            return { data: null, error: result.error };
        }
        
        return { data: result.data, error: null };
    } catch (err) {
        // إذا كان الخطأ من Supabase (result.error)، لا نعيد تسجيله
        if (!err.code) {
            debug({
                message: '❌ Exception في ' + context + ': ' + err.message,
                type: 'error',
                data: {
                    context: context,
                    stack: err.stack
                }
            }, 'error');
        }
        
        if (throwError) {
            throw err;
        }
        
        return { data: null, error: err };
    }
}

/**
 * معالجة أخطاء Supabase الموحدة
 * @param {Object} error - كائن الخطأ
 * @param {string} context - سياق العملية
 * @returns {string} - رسالة خطأ مفهومة للمستخدم
 */
function handleSupabaseError(error, context) {
    context = context || 'العملية';
    
    if (!error) return 'حدث خطأ غير معروف';
    
    var userMessage = '';
    
    switch (error.code) {
        case '23505': // Unique violation
            userMessage = 'هذا السجل موجود بالفعل';
            break;
        case '23503': // Foreign key violation
            userMessage = 'لا يمكن تنفيذ العملية بسبب وجود سجلات مرتبطة';
            break;
        case '23502': // Not null violation
            userMessage = 'بعض الحقول المطلوبة فارغة';
            break;
        case '42501': // Permission denied
            userMessage = 'ليس لديك صلاحية لتنفيذ هذه العملية';
            break;
        case 'PGRST301': // JWT expired
            userMessage = 'انتهت صلاحية الجلسة، يرجى تسجيل الدخول مرة أخرى';
            break;
        default:
            userMessage = error.message || 'حدث خطأ أثناء ' + context;
    }
    
    logError(context, userMessage, { error: error });
    
    return userMessage;
}

/**
 * التحقق من وجود Supabase Client
 * @returns {boolean}
 */
function isSupabaseReady() {
    if (!APP.supabase) {
        debug('❌ Supabase Client غير مهيأ', 'error');
        showToast('خطأ في الاتصال بالنظام', 'error');
        return false;
    }
    return true;
}


// ============================================================
// 9. SHARED HELPERS
// ============================================================

function safeParseFloat(value, defaultValue) {
    defaultValue = defaultValue || 0;
    var parsed = parseFloat(value);
    return isNaN(parsed) ? defaultValue : parsed;
}

function safeParseInt(value, defaultValue) {
    defaultValue = defaultValue || 0;
    var parsed = parseInt(value);
    return isNaN(parsed) ? defaultValue : parsed;
}

function generateId() {
    return 'id-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
}

function debounce(func, wait) {
    var timeout;
    return function() {
        var context = this, args = arguments;
        clearTimeout(timeout);
        timeout = setTimeout(function() {
            func.apply(context, args);
        }, wait);
    };
}

function throttle(func, limit) {
    var inThrottle;
    return function() {
        var context = this, args = arguments;
        if (!inThrottle) {
            func.apply(context, args);
            inThrottle = true;
            setTimeout(function() {
                inThrottle = false;
            }, limit);
        }
    };
}

function deepClone(obj) {
    if (obj === null || typeof obj !== 'object') return obj;
    try {
        return JSON.parse(JSON.stringify(obj));
    } catch (e) {
        return obj;
    }
}

function objectToArray(obj) {
    if (!obj || typeof obj !== 'object') return [];
    return Object.keys(obj).map(function(key) {
        return { key: key, value: obj[key] };
    });
}

function arrayToObject(arr, keyField) {
    if (!Array.isArray(arr)) return {};
    var obj = {};
    arr.forEach(function(item) {
        if (item && item[keyField]) {
            obj[item[keyField]] = item;
        }
    });
    return obj;
}


// ============================================================
// 10. INITIALIZATION
// ============================================================

debug('🚀 بدأ تحميل core.js', 'success');

// تهيئة Supabase عند تحميل الصفحة
document.addEventListener('DOMContentLoaded', function() {
    initSupabase();
});

debug('✅ core.js جاهز', 'success');

// ============================================================
// END OF CORE.JS
// ============================================================
