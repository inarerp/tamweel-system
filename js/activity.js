// ============================================================
// نظام إدارة التمويل - Activity Log Module
// Version: 1.1.0
// Last Updated: 2026-08-02
// ============================================================
//
// المسؤوليات:
// - logActivityToDB() - تسجيل النشاط في قاعدة البيانات
// - loadActivityLog() - تحميل السجل مع فلاتر
// - renderActivityLog() - عرض السجل في الواجهة
// - Pagination (100 سجل في الصفحة)
// - فلاتر: مستخدم / نوع كيان / نوع إجراء / فترة زمنية / بحث عام
// - تنقل للكيانات المرتبطة (Event Delegation)
// - تمييز بصري لأنواع الإجراءات
//
// يعتمد على:
// - core.js (APP, runQuery, debug, Constants, debounce)
//
// يُصدّر:
// - window.logActivityToDB (يستخدمه auth.js وباقي الشاشات)
// ============================================================


// ============================================================
// 1. CONSTANTS
// ============================================================

var ACTIVITY_ENTITY_TYPES = Object.freeze({
    AUTH: 'auth',
    CLIENT: 'client',
    INVESTOR: 'investor',
    OPERATION: 'operation',
    OPERATION_INVESTOR: 'operation_investor',
    TRANSFER: 'transfer',
    USER: 'user',
    SYSTEM: 'system'
});

var ACTIVITY_ENTITY_TYPES_TEXT = Object.freeze({
    auth: 'مصادقة',
    client: 'عميل',
    investor: 'ممول',
    operation: 'عملية',
    operation_investor: 'مساهمة ممول',
    transfer: 'تحويل',
    user: 'مستخدم',
    system: 'نظام'
});

var ACTIVITY_ACTION_TYPES = Object.freeze({
    CREATE: 'create',
    UPDATE: 'update',
    DELETE: 'delete',
    ARCHIVE: 'archive',
    UNARCHIVE: 'unarchive',
    LOGIN: 'login',
    LOGOUT: 'logout',
    ACTIVATE: 'activate',
    DEACTIVATE: 'deactivate',
    LOCK: 'lock',
    UNLOCK: 'unlock',
    TRANSFER: 'transfer',
    SYSTEM: 'system'
});

var ACTIVITY_ACTION_TYPES_TEXT = Object.freeze({
    create: 'إنشاء',
    update: 'تعديل',
    delete: 'حذف',
    archive: 'أرشفة',
    unarchive: 'إلغاء أرشفة',
    login: 'تسجيل دخول',
    logout: 'تسجيل خروج',
    activate: 'تفعيل',
    deactivate: 'تعطيل',
    lock: 'قفل',
    unlock: 'فتح قفل',
    transfer: 'تحويل',
    system: 'نظام'
});

var ACTIVITY_ACTION_COLORS = Object.freeze({
    create: '#28a745',
    update: '#17a2b8',
    delete: '#dc3545',
    archive: '#dc3545',
    unarchive: '#28a745',
    login: '#6c757d',
    logout: '#6c757d',
    activate: '#28a745',
    deactivate: '#dc3545',
    lock: '#fd7e14',
    unlock: '#fd7e14',
    transfer: '#667eea',
    system: '#6c757d'
});


// ============================================================
// 2. STATE
// ============================================================

var ACTIVITY_STATE = {
    currentPage: 1,
    pageSize: 100,
    totalRecords: 0,
    totalPages: 0,
    filters: {
        entityType: '',
        actionType: '',
        userEmail: '',
        dateFrom: '',
        dateTo: '',
        search: ''
    },
    records: []
};


// ============================================================
// 3. LOG ACTIVITY TO DATABASE
// ============================================================

/**
 * تسجيل نشاط في Activity Log
 * يُستدعى من جميع أجزاء النظام
 * 
 * @param {string} action - وصف الإجراء (نص عربي)
 * @param {string} entityType - نوع الكيان (client/investor/operation/etc.)
 * @param {string} entityId - معرّف الكيان (UUID)
 * @param {string} oldValue - القيمة القديمة (JSON stringify)
 * @param {string} newValue - القيمة الجديدة (JSON stringify)
 * @param {string} details - تفاصيل إضافية (نص عربي)
 * @param {string} actionType - نوع الإجراء (create/update/delete/etc.) - اختياري
 */
function logActivityToDB(action, entityType, entityId, oldValue, newValue, details, actionType) {
    // التحقق من Supabase
    if (!isSupabaseReady()) {
        debug('⚠️ Supabase غير جاهز - لن يتم تسجيل النشاط', 'warning');
        return;
    }
    
    // التحقق من وجود مستخدم
    var userEmail = APP.currentUser ? APP.currentUser.email : 'system';
    var userId = APP.currentUser ? APP.currentUser.id : null;
    
    // تحديد action_type (افتراضي: update)
    var finalActionType = actionType || ACTIVITY_ACTION_TYPES.UPDATE;
    
    // بناء البيانات
    var data = {
        user_email: userEmail,
        user_id: userId,
        action: action,
        action_type: finalActionType,
        entity_type: entityType || null,
        entity_id: entityId || null,
        old_value: oldValue || null,
        new_value: newValue || null,
        details: details || null
    };
    
    // تسجيل النشاط (بدون throwError - لا نريد إيقاف العملية بسبب فشل التسجيل)
    runQuery(
        function() {
            return APP.supabase.from('activity_logs').insert(data);
        },
        { context: 'logActivity', throwError: false }
    ).then(function(result) {
        if (result.error) {
            debug('⚠️ فشل تسجيل النشاط: ' + result.error.message, 'warning');
        } else {
            debug('✅ تم تسجيل النشاط: ' + action, 'success');
        }
    });
}

// تصدير الدالة للاستخدام من ملفات أخرى
window.logActivityToDB = logActivityToDB;


// ============================================================
// 4. LOAD ACTIVITY LOG
// ============================================================

/**
 * تحميل سجل النشاط من قاعدة البيانات
 * مع تطبيق الفلاتر و Pagination
 */
async function loadActivityLog() {
    debug('📜 بدأ loadActivityLog', 'info');
    
    if (!isSupabaseReady()) {
        debug('❌ Supabase غير جاهز', 'error');
        return;
    }
    
    showLoading();
    
    try {
        // بناء الاستعلام
        var query = APP.supabase
            .from('activity_logs')
            .select('*', { count: 'exact' });
        
        // تطبيق الفلاتر
        if (ACTIVITY_STATE.filters.entityType) {
            query = query.eq('entity_type', ACTIVITY_STATE.filters.entityType);
        }
        
        if (ACTIVITY_STATE.filters.actionType) {
            query = query.eq('action_type', ACTIVITY_STATE.filters.actionType);
        }
        
        if (ACTIVITY_STATE.filters.userEmail) {
            query = query.eq('user_email', ACTIVITY_STATE.filters.userEmail);
        }
        
        if (ACTIVITY_STATE.filters.dateFrom) {
            query = query.gte('created_at', ACTIVITY_STATE.filters.dateFrom);
        }
        
        if (ACTIVITY_STATE.filters.dateTo) {
            query = query.lte('created_at', ACTIVITY_STATE.filters.dateTo + ' 23:59:59');
        }
        
        if (ACTIVITY_STATE.filters.search) {
            var searchTerm = '%' + ACTIVITY_STATE.filters.search + '%';
            query = query.or(
                'action.ilike.' + searchTerm + 
                ',details.ilike.' + searchTerm + 
                ',user_email.ilike.' + searchTerm
            );
        }
        
        // ترتيب + Pagination
        var from = (ACTIVITY_STATE.currentPage - 1) * ACTIVITY_STATE.pageSize;
        var to = from + ACTIVITY_STATE.pageSize - 1;
        
        query = query
            .order('created_at', { ascending: false })
            .range(from, to);
        
        // تنفيذ الاستعلام
        var result = await runQuery(
            function() { return query; },
            { context: 'loadActivityLog', throwError: true }
        );
        
        ACTIVITY_STATE.records = result.data || [];
        ACTIVITY_STATE.totalRecords = result.count || 0;
        ACTIVITY_STATE.totalPages = Math.ceil(ACTIVITY_STATE.totalRecords / ACTIVITY_STATE.pageSize);
        
        debug('✅ تم تحميل ' + ACTIVITY_STATE.records.length + ' سجل من أصل ' + ACTIVITY_STATE.totalRecords, 'success');
        
        // عرض السجل
        renderActivityLog();
        
    } catch (err) {
        debug('❌ خطأ في loadActivityLog: ' + err.message, 'error');
        showToast(handleSupabaseError(err, 'تحميل سجل النشاط'), 'error');
    } finally {
        hideLoading();
    }
}


// ============================================================
// 5. RENDER ACTIVITY LOG
// ============================================================

/**
 * عرض سجل النشاط في الواجهة
 */
function renderActivityLog() {
    var container = document.getElementById('activityLogTable');
    if (!container) {
        debug('⚠️ activityLogTable غير موجود', 'warning');
        return;
    }
    
    if (ACTIVITY_STATE.records.length === 0) {
        container.innerHTML = '<div class="empty-state">لا توجد سجلات نشاط</div>';
        return;
    }
    
    var html = '';
    
    // معلومات الـ Pagination
    html += '<div style="padding: 10px 15px; background: #f8f9fa; border-bottom: 1px solid #e0e0e0; font-size: 13px; color: #666;">';
    html += 'عرض ' + ((ACTIVITY_STATE.currentPage - 1) * ACTIVITY_STATE.pageSize + 1) + ' - ' + Math.min(ACTIVITY_STATE.currentPage * ACTIVITY_STATE.pageSize, ACTIVITY_STATE.totalRecords);
    html += ' من ' + ACTIVITY_STATE.totalRecords + ' سجل';
    html += ' (الصفحة ' + ACTIVITY_STATE.currentPage + ' من ' + ACTIVITY_STATE.totalPages + ')';
    html += '</div>';
    
    // الجدول
    html += '<table id="activityLogTableBody">';
    html += '<thead><tr>';
    html += '<th>الرقم</th>';
    html += '<th>الوقت</th>';
    html += '<th>المستخدم</th>';
    html += '<th>الإجراء</th>';
    html += '<th>النوع</th>';
    html += '<th>التفاصيل</th>';
    html += '<th>إجراءات</th>';
    html += '</tr></thead>';
    html += '<tbody>';
    
    ACTIVITY_STATE.records.forEach(function(log) {
        // استخدام action_type مباشرة من قاعدة البيانات
        var actionType = log.action_type || ACTIVITY_ACTION_TYPES.UPDATE;
        var actionColor = ACTIVITY_ACTION_COLORS[actionType] || '#6c757d';
        var actionTypeText = ACTIVITY_ACTION_TYPES_TEXT[actionType] || actionType;
        var entityTypeText = ACTIVITY_ENTITY_TYPES_TEXT[log.entity_type] || log.entity_type || '-';
        
        html += '<tr>';
        html += '<td><strong>' + escapeHtml(log.reference_number || '-') + '</strong></td>';
        html += '<td>' + formatDateTime(log.created_at) + '</td>';
        html += '<td>' + escapeHtml(log.user_email || '-') + '</td>';
        html += '<td>';
        html += '<span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: ' + actionColor + '; margin-left: 5px;"></span> ';
        html += '<span style="color: ' + actionColor + '; font-weight: 600;">' + escapeHtml(log.action || '-') + '</span>';
        html += '<div style="font-size: 11px; color: #999; margin-top: 2px;">' + actionTypeText + '</div>';
        html += '</td>';
        html += '<td>' + entityTypeText + '</td>';
        html += '<td>' + escapeHtml(truncateText(log.details, 50)) + '</td>';
        html += '<td>';
        
        // زر التنقل للكيان المرتبط - باستخدام data attributes
        if (log.entity_id && log.entity_type && log.entity_type !== 'auth' && log.entity_type !== 'system') {
            html += '<button class="btn btn-sm btn-primary activity-navigate-btn" ';
            html += 'data-entity-type="' + escapeHtml(log.entity_type) + '" ';
            html += 'data-entity-id="' + escapeHtml(log.entity_id) + '">';
            html += 'فتح';
            html += '</button>';
        } else {
            html += '-';
        }
        
        html += '</td>';
        html += '</tr>';
    });
    
    html += '</tbody></table>';
    
    // أزرار الـ Pagination
    html += renderPagination();
    
    container.innerHTML = html;
    
    // ربط Event Delegation بعد عرض الجدول
    bindActivityEvents();
}


// ============================================================
// 6. EVENT DELEGATION
// ============================================================

/**
 * ربط الأحداث باستخدام Event Delegation
 * يُستدعى بعد كل render للجدول
 */
function bindActivityEvents() {
    var container = document.getElementById('activityLogTable');
    if (!container) return;
    
    // إزالة المستمع القديم إن وجد (لتجنب التكرار)
    if (container._activityListener) {
        container.removeEventListener('click', container._activityListener);
    }
    
    // مستمع جديد
    container._activityListener = function(event) {
        var target = event.target;
        
        // البحث عن أقرب button يحتوي على class activity-navigate-btn
        var btn = target.closest('.activity-navigate-btn');
        
        if (btn) {
            var entityType = btn.getAttribute('data-entity-type');
            var entityId = btn.getAttribute('data-entity-id');
            
            if (entityType && entityId) {
                event.preventDefault();
                navigateToEntity(entityType, entityId);
            }
        }
    };
    
    container.addEventListener('click', container._activityListener);
    
    debug('✅ تم ربط أحداث Activity Log', 'info');
}


// ============================================================
// 7. PAGINATION
// ============================================================

/**
 * عرض أزرار الـ Pagination
 */
function renderPagination() {
    if (ACTIVITY_STATE.totalPages <= 1) return '';
    
    var html = '<div style="padding: 15px; display: flex; justify-content: center; gap: 10px; align-items: center;">';
    
    // زر السابق
    if (ACTIVITY_STATE.currentPage > 1) {
        html += '<button class="btn btn-sm btn-secondary activity-page-btn" data-page="' + (ACTIVITY_STATE.currentPage - 1) + '">السابق</button>';
    } else {
        html += '<button class="btn btn-sm btn-secondary" disabled>السابق</button>';
    }
    
    // معلومات الصفحة
    html += '<span style="font-size: 13px; color: #666;">الصفحة ' + ACTIVITY_STATE.currentPage + ' من ' + ACTIVITY_STATE.totalPages + '</span>';
    
    // زر التالي
    if (ACTIVITY_STATE.currentPage < ACTIVITY_STATE.totalPages) {
        html += '<button class="btn btn-sm btn-secondary activity-page-btn" data-page="' + (ACTIVITY_STATE.currentPage + 1) + '">التالي</button>';
    } else {
        html += '<button class="btn btn-sm btn-secondary" disabled>التالي</button>';
    }
    
    html += '</div>';
    
    return html;
}

/**
 * تغيير الصفحة
 */
function changePage(page) {
    if (page < 1 || page > ACTIVITY_STATE.totalPages) return;
    
    ACTIVITY_STATE.currentPage = page;
    loadActivityLog();
}


// ============================================================
// 8. FILTER FUNCTIONS
// ============================================================

/**
 * تطبيق فلتر نوع الكيان
 */
function filterByEntityType(entityType) {
    ACTIVITY_STATE.filters.entityType = entityType;
    ACTIVITY_STATE.currentPage = 1;
    loadActivityLog();
}

/**
 * تطبيق فلتر نوع الإجراء
 */
function filterByActionType(actionType) {
    ACTIVITY_STATE.filters.actionType = actionType;
    ACTIVITY_STATE.currentPage = 1;
    loadActivityLog();
}

/**
 * تطبيق فلتر المستخدم
 */
function filterByUser(userEmail) {
    ACTIVITY_STATE.filters.userEmail = userEmail;
    ACTIVITY_STATE.currentPage = 1;
    loadActivityLog();
}

/**
 * تطبيق فلتر الفترة الزمنية
 */
function filterByDateRange(dateFrom, dateTo) {
    ACTIVITY_STATE.filters.dateFrom = dateFrom;
    ACTIVITY_STATE.filters.dateTo = dateTo;
    ACTIVITY_STATE.currentPage = 1;
    loadActivityLog();
}

/**
 * تطبيق البحث العام (مع debounce)
 * يُستدعى من حقل البحث بعد 300ms من آخر حرف
 */
var searchActivityLogDebounced = debounce(function(searchTerm) {
    ACTIVITY_STATE.filters.search = searchTerm;
    ACTIVITY_STATE.currentPage = 1;
    loadActivityLog();
}, 300);

/**
 * Handler لحقل البحث - يُستدعى عند كل keystroke
 */
function onActivitySearchInput(event) {
    var searchTerm = event.target.value;
    searchActivityLogDebounced(searchTerm);
}

/**
 * إعادة تعيين جميع الفلاتر
 */
function resetActivityFilters() {
    ACTIVITY_STATE.filters = {
        entityType: '',
        actionType: '',
        userEmail: '',
        dateFrom: '',
        dateTo: '',
        search: ''
    };
    ACTIVITY_STATE.currentPage = 1;
    
    // إعادة تعيين حقول الفلتر في الواجهة
    var entityTypeSelect = document.getElementById('activityFilterEntityType');
    var actionTypeSelect = document.getElementById('activityFilterActionType');
    var userSelect = document.getElementById('activityFilterUser');
    var dateFromInput = document.getElementById('activityFilterDateFrom');
    var dateToInput = document.getElementById('activityFilterDateTo');
    var searchInput = document.getElementById('activityFilterSearch');
    
    if (entityTypeSelect) entityTypeSelect.value = '';
    if (actionTypeSelect) actionTypeSelect.value = '';
    if (userSelect) userSelect.value = '';
    if (dateFromInput) dateFromInput.value = '';
    if (dateToInput) dateToInput.value = '';
    if (searchInput) searchInput.value = '';
    
    loadActivityLog();
}


// ============================================================
// 9. NAVIGATION FUNCTIONS
// ============================================================

/**
 * التنقل للكيان المرتبط
 */
function navigateToEntity(entityType, entityId) {
    debug('🔗 التنقل إلى: ' + entityType + ' - ' + entityId, 'info');
    
    switch (entityType) {
        case 'operation':
            if (typeof openOperationDetails === 'function') {
                openOperationDetails(entityId);
            } else {
                debug('⚠️ openOperationDetails غير متاح', 'warning');
                showToast('لا يمكن فتح العملية', 'warning');
            }
            break;
            
        case 'client':
            if (typeof openClientFile === 'function') {
                openClientFile(entityId);
            } else {
                debug('⚠️ openClientFile غير متاح', 'warning');
                showToast('لا يمكن فتح ملف العميل', 'warning');
            }
            break;
            
        case 'investor':
            if (typeof openInvestorFile === 'function') {
                openInvestorFile(entityId);
            } else {
                debug('⚠️ openInvestorFile غير متاح', 'warning');
                showToast('لا يمكن فتح ملف الممول', 'warning');
            }
            break;
            
        case 'transfer':
            if (typeof openTransferDetails === 'function') {
                openTransferDetails(entityId);
            } else {
                debug('⚠️ openTransferDetails غير متاح', 'warning');
                showToast('لا يمكن فتح تفاصيل التحويل', 'warning');
            }
            break;
            
        case 'user':
            if (typeof openUserDetails === 'function') {
                openUserDetails(entityId);
            } else {
                debug('⚠️ openUserDetails غير متاح', 'warning');
                showToast('لا يمكن فتح بيانات المستخدم', 'warning');
            }
            break;
            
        default:
            debug('⚠️ نوع كيان غير معروف: ' + entityType, 'warning');
            showToast('لا يمكن التنقل إلى هذا الكيان', 'warning');
    }
}


// ============================================================
// 10. LOAD FILTER OPTIONS
// ============================================================

/**
 * تحميل خيارات الفلاتر (قائمة المستخدمين الفريدة + أنواع الإجراءات)
 * يستخدم SELECT DISTINCT لتجنب تحميل آلاف السجلات
 */
async function loadFilterOptions() {
    debug('🔧 جاري تحميل خيارات الفلاتر...', 'info');
    
    if (!isSupabaseReady()) return;
    
    try {
        // تحميل قائمة المستخدمين الفريدة باستخدام RPC أو DISTINCT
        // نستخدم استعلام محسّن مع limit لتجنب التحميل الزائد
        var usersResult = await runQuery(
            function() {
                return APP.supabase
                    .from('activity_logs')
                    .select('user_email')
                    .not('user_email', 'is', null)
                    .limit(1000) // حد أقصى 1000 سجل للتحليل
                    .order('user_email');
            },
            { context: 'loadFilterOptions-users', throwError: false }
        );
        
        if (usersResult.data) {
            // استخراج الفريدة في JavaScript (مع limit 1000، الأداء مقبول)
            var uniqueUsers = [];
            var seen = {};
            
            usersResult.data.forEach(function(log) {
                if (log.user_email && !seen[log.user_email]) {
                    seen[log.user_email] = true;
                    uniqueUsers.push(log.user_email);
                }
            });
            
            // ترتيب أبجدياً
            uniqueUsers.sort();
            
            var userSelect = document.getElementById('activityFilterUser');
            if (userSelect) {
                var options = '<option value="">جميع المستخدمين</option>';
                uniqueUsers.forEach(function(email) {
                    options += '<option value="' + escapeHtml(email) + '">' + escapeHtml(email) + '</option>';
                });
                userSelect.innerHTML = options;
            }
            
            debug('✅ تم تحميل ' + uniqueUsers.length + ' مستخدم فريد', 'info');
        }
        
        // تحميل قائمة أنواع الكيانات (من Constants)
        var entityTypeSelect = document.getElementById('activityFilterEntityType');
        if (entityTypeSelect) {
            var options = '<option value="">جميع الأنواع</option>';
            Object.keys(ACTIVITY_ENTITY_TYPES_TEXT).forEach(function(key) {
                options += '<option value="' + key + '">' + ACTIVITY_ENTITY_TYPES_TEXT[key] + '</option>';
            });
            entityTypeSelect.innerHTML = options;
        }
        
        // تحميل قائمة أنواع الإجراءات (من Constants)
        var actionTypeSelect = document.getElementById('activityFilterActionType');
        if (actionTypeSelect) {
            var options = '<option value="">جميع الإجراءات</option>';
            Object.keys(ACTIVITY_ACTION_TYPES_TEXT).forEach(function(key) {
                options += '<option value="' + key + '">' + ACTIVITY_ACTION_TYPES_TEXT[key] + '</option>';
            });
            actionTypeSelect.innerHTML = options;
        }
        
        debug('✅ تم تحميل خيارات الفلاتر', 'success');
        
    } catch (err) {
        debug('⚠️ خطأ في loadFilterOptions: ' + err.message, 'warning');
    }
}

/**
 * دالة بديلة لاستخدام RPC (إذا تم إنشاء Function في Supabase)
 * يمكن تفعيلها لاحقاً عند الحاجة للأداء الأفضل
 */
async function loadUniqueUsersViaRPC() {
    if (!isSupabaseReady()) return;
    
    try {
        // SQL Function مقترح:
        // CREATE OR REPLACE FUNCTION get_unique_activity_users()
        // RETURNS TABLE(user_email TEXT) AS $$
        //     SELECT DISTINCT user_email FROM activity_logs 
        //     WHERE user_email IS NOT NULL
        //     ORDER BY user_email;
        // $$ LANGUAGE sql;
        
        var result = await runQuery(
            function() {
                return APP.supabase.rpc('get_unique_activity_users');
            },
            { context: 'loadUniqueUsersViaRPC', throwError: false }
        );
        
        if (result.data) {
            var userSelect = document.getElementById('activityFilterUser');
            if (userSelect) {
                var options = '<option value="">جميع المستخدمين</option>';
                result.data.forEach(function(row) {
                    options += '<option value="' + escapeHtml(row.user_email) + '">' + escapeHtml(row.user_email) + '</option>';
                });
                userSelect.innerHTML = options;
            }
        }
    } catch (err) {
        debug('⚠️ RPC غير متاح - استخدام البديل', 'warning');
    }
}


// ============================================================
// 11. INITIALIZATION
// ============================================================

debug('🚀 بدأ تحميل activity.js', 'success');

// تحميل خيارات الفلاتر عند تحميل الصفحة
document.addEventListener('DOMContentLoaded', function() {
    loadFilterOptions();
});

debug('✅ activity.js جاهز', 'success');

// ============================================================
// END OF ACTIVITY.JS
// ============================================================
