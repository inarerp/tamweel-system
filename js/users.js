// ============================================================
// نظام إدارة التمويل - Users Management Module
// Version: 2.1.0
// Last Updated: 2026-08-02
// ============================================================
//
// المسؤوليات:
// - initUsers() - تسجيل الدالة في Registry
// - loadUsers() - تحميل قائمة المستخدمين
// - openUserModal() - Modal تعديل صلاحيات المستخدم
// - saveUserProfile() - حفظ التغييرات
// - toggleUserActive() - تفعيل/تعطيل مستخدم
// - searchUsers() - بحث debounced
// - Render (قائمة + Modal)
//
// يعتمد على:
// - core.js (APP, runQuery, debug, Constants, etc.)
// - auth.js (canEdit, isAdmin, etc.)
// - activity.js (window.logActivityToDB)
// - app.js (showScreen)
//
// ملاحظة: لا يحتوي على DOMContentLoaded (app.js هو Bootstrap)
// ملاحظة: لا يُنشئ مستخدمين (يتم من Supabase Dashboard)
// ملاحظة: Business Logic محمية في DB (Triggers + Constraints + RLS)
// ملاحظة: Validation في Frontend هو UX فقط، الحماية الحقيقية في DB
// ============================================================


// ============================================================
// 1. STATE
// ============================================================

var USERS_STATE = {
    search: '',
    records: [],
    referenceCache: {
        clients: null,
        investors: null
    },
    lastSignInCache: null,
    eventsBound: false  // ✅ تحسين 6: Flag لمنع تكرار ربط الأحداث
};


// ============================================================
// 2. CONSTANTS
// ============================================================

var AVAILABLE_ROLES = Object.freeze([
    { value: 'admin', text: 'مدير' },
    { value: 'viewer', text: 'مراقب' },
    { value: 'client', text: 'عميل' },
    { value: 'investor', text: 'ممول' }
]);

var AVAILABLE_PERMISSIONS = Object.freeze([
    { value: 'admin', text: 'صلاحيات كاملة' },
    { value: 'viewer', text: 'مشاهدة فقط' }
]);

var ROLE_PERMISSION_RULES = Object.freeze({
    admin: { allowed: ['admin'], reason: 'الدور Admin يتطلب صلاحية كاملة' },
    viewer: { allowed: ['viewer'], reason: 'الدور مراقب يتطلب صلاحية مشاهدة فقط' },
    client: { allowed: ['admin', 'viewer'], reason: '' },
    investor: { allowed: ['admin', 'viewer'], reason: '' }
});

var ROLES_REQUIRING_ENTITY = Object.freeze(['client', 'investor']);


// ============================================================
// 3. INITIALIZATION
// ============================================================

function initUsers() {
    debug('👥 بدء تهيئة users.js', 'info');
    registerScreenLoader('users', loadUsers);
    
    // ✅ تحسين 6: ربط Event Delegation مرة واحدة فقط
    bindUserModalEvents();
    
    debug('✅ users.js جاهز', 'success');
}

/**
 * ✅ تحسين 6: ربط أحداث Modal مرة واحدة فقط
 * يستخدم Flag لمنع التكرار إذا تم استدعاء initUsers() أكثر من مرة
 */
function bindUserModalEvents() {
    // منع التكرار
    if (USERS_STATE.eventsBound) {
        debug('ℹ️ أحداث User Modal مرتبطة مسبقاً - تخطي', 'info');
        return;
    }
    
    var roleEl = document.getElementById('userRoleSelect');
    if (roleEl) {
        roleEl.addEventListener('change', function() {
            var entityEl = document.getElementById('userEntitySelect');
            var selectedEntityId = entityEl ? entityEl.value : '';
            populateEntitySelect(this.value, selectedEntityId);
            updatePermissionOptions(this.value);
        });
    }
    
    USERS_STATE.eventsBound = true;
    debug('✅ تم ربط أحداث User Modal', 'info');
}


// ============================================================
// 4. MAIN LOADER
// ============================================================

async function loadUsers() {
    debug('👥 بدأ loadUsers', 'info');
    
    // ✅ تحسين 9: التحقق من الصلاحية مع إعادة التوجيه
    if (!isAdmin()) {
        debug('⚠️ مستخدم غير Admin يحاول فتح شاشة المستخدمين', 'warning');
        showToast('❌ لا توجد صلاحية لعرض هذه الشاشة', 'error');
        if (typeof showScreen === 'function') {
            showScreen('dashboard');
        }
        return;
    }
    
    if (!isSupabaseReady()) {
        debug('❌ Supabase غير جاهز', 'error');
        return;
    }
    
    showLoading();
    
    try {
        var results = await Promise.all([
            runQuery(
                function() {
                    return APP.supabase
                        .from('user_profiles')
                        .select('id, email, role, entity_id, permission, is_active, created_at, updated_at')
                        .order('created_at', { ascending: false });
                },
                { context: 'loadUsers-profiles', throwError: true }
            ),
            loadClientsForUsers(),
            loadInvestorsForUsers(),
            loadLastSignInData()
        ]);
        
        var profiles = results[0].data || [];
        var clients = results[1] || [];
        var investors = results[2] || [];
        var lastSignInMap = results[3] || {};
        
        var indexes = buildUsersIndexes(clients, investors);
        
        profiles.forEach(function(profile) {
            profile.last_sign_in = lastSignInMap[profile.id] || null;
            
            if (profile.role === 'client' && profile.entity_id) {
                profile.entity = indexes.clientsById[profile.entity_id] || null;
                profile.entityType = 'client';
            } else if (profile.role === 'investor' && profile.entity_id) {
                profile.entity = indexes.investorsById[profile.entity_id] || null;
                profile.entityType = 'investor';
            } else {
                profile.entity = null;
                profile.entityType = null;
            }
        });
        
        // تطبيق البحث
        var filtered = profiles;
        if (USERS_STATE.search) {
            var searchTerm = USERS_STATE.search.toLowerCase();
            filtered = profiles.filter(function(p) {
                return (p.email && p.email.toLowerCase().indexOf(searchTerm) !== -1) ||
                       (p.entity && p.entity.name && p.entity.name.toLowerCase().indexOf(searchTerm) !== -1) ||
                       (p.role && p.role.toLowerCase().indexOf(searchTerm) !== -1);
            });
        }
        
        USERS_STATE.records = filtered;
        
        debug('✅ تم تحميل ' + USERS_STATE.records.length + ' مستخدم', 'success');
        
        renderUsersList();
        
    } catch (err) {
        debug('❌ خطأ في loadUsers: ' + err.message, 'error');
        showToast(handleSupabaseError(err, 'تحميل المستخدمين'), 'error');
    } finally {
        hideLoading();
    }
}

/**
 * جلب آخر تسجيل دخول من RPC (محمي بـ Admin check داخل الـ RPC)
 */
async function loadLastSignInData() {
    if (USERS_STATE.lastSignInCache) {
        return USERS_STATE.lastSignInCache;
    }
    
    try {
        var result = await runQuery(
            function() {
                return APP.supabase.rpc('get_users_last_sign_in');
            },
            { context: 'loadLastSignInData', throwError: false }
        );
        
        var data = {};
        if (result.data) {
            result.data.forEach(function(row) {
                data[row.user_id] = row.last_sign_in_at;
            });
        }
        
        USERS_STATE.lastSignInCache = data;
        return data;
        
    } catch (err) {
        debug('⚠️ خطأ في loadLastSignInData: ' + err.message, 'warning');
        return {};
    }
}

async function loadClientsForUsers() {
    if (USERS_STATE.referenceCache.clients) {
        return USERS_STATE.referenceCache.clients;
    }
    
    try {
        var result = await runQuery(
            function() {
                return APP.supabase
                    .from('clients')
                    .select('id, name, is_archived')
                    .eq('is_archived', false)
                    .order('name');
            },
            { context: 'loadClientsForUsers', throwError: true }
        );
        
        USERS_STATE.referenceCache.clients = result.data || [];
        return USERS_STATE.referenceCache.clients;
        
    } catch (err) {
        debug('❌ خطأ في loadClientsForUsers: ' + err.message, 'error');
        return [];
    }
}

async function loadInvestorsForUsers() {
    if (USERS_STATE.referenceCache.investors) {
        return USERS_STATE.referenceCache.investors;
    }
    
    try {
        var result = await runQuery(
            function() {
                return APP.supabase
                    .from('investors')
                    .select('id, name, is_archived')
                    .eq('is_archived', false)
                    .order('name');
            },
            { context: 'loadInvestorsForUsers', throwError: true }
        );
        
        USERS_STATE.referenceCache.investors = result.data || [];
        return USERS_STATE.referenceCache.investors;
        
    } catch (err) {
        debug('❌ خطأ في loadInvestorsForUsers: ' + err.message, 'error');
        return [];
    }
}

function buildUsersIndexes(clients, investors) {
    var clientsById = {};
    var investorsById = {};
    
    clients.forEach(function(c) { clientsById[c.id] = c; });
    investors.forEach(function(inv) { investorsById[inv.id] = inv; });
    
    return {
        clientsById: clientsById,
        investorsById: investorsById
    };
}


// ============================================================
// 5. RENDER USERS LIST
// ============================================================

function renderUsersList() {
    var container = document.getElementById('usersTable');
    if (!container) {
        debug('⚠️ usersTable غير موجود', 'warning');
        return;
    }
    
    if (USERS_STATE.records.length === 0) {
        container.innerHTML = '<div class="empty-state">لا يوجد مستخدمين</div>';
        return;
    }
    
    var html = '<table>';
    html += '<thead><tr>';
    html += '<th>البريد الإلكتروني</th>';
    html += '<th>الدور</th>';
    html += '<th>الصلاحية</th>';
    html += '<th>الكيان المرتبط</th>';
    html += '<th>الحالة</th>';
    html += '<th>تاريخ الإنشاء</th>';
    html += '<th>آخر دخول</th>';
    html += '<th>الإجراءات</th>';
    html += '</tr></thead>';
    html += '<tbody>';
    
    USERS_STATE.records.forEach(function(profile) {
        var roleBadge = '<span class="badge badge-' + profile.role + '">' + getUserRoleText(profile.role) + '</span>';
        var permBadge = '<span class="badge badge-' + profile.permission + '">' + 
                        (profile.permission === 'admin' ? 'صلاحيات كاملة' : 'مشاهدة فقط') + '</span>';
        
        var statusBadge = profile.is_active 
            ? '<span class="badge badge-active">مفعل</span>' 
            : '<span class="badge badge-inactive">معطل</span>';
        
        // ✅ تحسين 11: حماية entity_id المحذوف
        var entityDisplay = '-';
        if (profile.entity) {
            var entityLink = '';
            if (profile.entityType === 'client') {
                entityLink = '<a href="#" data-action="openClientFile" data-param="' + profile.entity.id + '">' + escapeHtml(profile.entity.name) + '</a>';
            } else if (profile.entityType === 'investor') {
                entityLink = '<a href="#" data-action="openInvestorFile" data-param="' + profile.entity.id + '">' + escapeHtml(profile.entity.name) + '</a>';
            }
            entityDisplay = entityLink;
        } else if (profile.entity_id) {
            entityDisplay = '<span class="badge badge-inactive" title="الكيان المرتبط غير موجود أو مؤرشف">⚠️ كيان محذوف</span>';
        }
        
        var isCurrentUser = APP.currentUser && APP.currentUser.id === profile.id;
        
        html += '<tr>';
        html += '<td><strong>' + escapeHtml(profile.email || '-') + '</strong>';
        if (isCurrentUser) {
            html += ' <span class="badge badge-admin">(أنت)</span>';
        }
        html += '</td>';
        html += '<td>' + roleBadge + '</td>';
        html += '<td>' + permBadge + '</td>';
        html += '<td>' + entityDisplay + '</td>';
        html += '<td>' + statusBadge + '</td>';
        html += '<td>' + formatDateTime(profile.created_at) + '</td>';
        html += '<td>' + (profile.last_sign_in ? formatDateTime(profile.last_sign_in) : '-') + '</td>';
        html += '<td class="actions-cell">';
        html += '<button class="btn btn-secondary btn-sm" data-action="editUser" data-param="' + profile.id + '">تعديل</button>';
        
        if (!isCurrentUser) {
            html += '<button class="btn ' + (profile.is_active ? 'btn-warning' : 'btn-success') + ' btn-sm" data-action="toggleUserActive" data-param="' + profile.id + '">';
            html += profile.is_active ? 'تعطيل' : 'تفعيل';
            html += '</button>';
        }
        
        html += '</td>';
        html += '</tr>';
    });
    
    html += '</tbody></table>';
    
    container.innerHTML = html;
}


// ============================================================
// 6. USER MODAL
// ============================================================

async function openUserModal(userId) {
    if (!isAdmin()) {
        showToast('❌ لا توجد صلاحية', 'error');
        return;
    }
    
    var titleEl = document.getElementById('userModalTitle');
    var idEl = document.getElementById('userId');
    var roleEl = document.getElementById('userRoleSelect');
    var permEl = document.getElementById('userPermissionSelect');
    var activeEl = document.getElementById('userActiveSelect');
    var emailEl = document.getElementById('userEmailDisplay');
    
    if (!titleEl || !idEl) {
        debug('⚠️ عناصر Modal غير موجودة', 'warning');
        return;
    }
    
    await Promise.all([
        loadClientsForUsers(),
        loadInvestorsForUsers()
    ]);
    
    var profile = USERS_STATE.records.find(function(p) { return p.id === userId; });
    if (!profile) {
        showToast('❌ المستخدم غير موجود', 'error');
        return;
    }
    
    var isCurrentUser = APP.currentUser && APP.currentUser.id === profile.id;
    
    titleEl.textContent = 'تعديل صلاحيات المستخدم';
    idEl.value = profile.id;
    
    if (emailEl) emailEl.textContent = profile.email || '-';
    
    if (roleEl) {
        var roleOptions = '';
        AVAILABLE_ROLES.forEach(function(r) {
            var selected = r.value === profile.role ? ' selected' : '';
            roleOptions += '<option value="' + r.value + '"' + selected + '>' + r.text + '</option>';
        });
        roleEl.innerHTML = roleOptions;
    }
    
    updatePermissionOptions(profile.role, profile.permission);
    populateEntitySelect(profile.role, profile.entity_id);
    
    if (activeEl) {
        activeEl.value = profile.is_active ? 'true' : 'false';
        
        if (isCurrentUser) {
            activeEl.disabled = true;
            activeEl.title = 'لا يمكنك تغيير حالة حسابك الخاص';
        } else {
            activeEl.disabled = false;
            activeEl.title = '';
        }
    }
    
    openModal('userModal');
}

function updatePermissionOptions(role, currentPermission) {
    var permEl = document.getElementById('userPermissionSelect');
    if (!permEl) return;
    
    var rules = ROLE_PERMISSION_RULES[role];
    if (!rules) return;
    
    var options = '';
    AVAILABLE_PERMISSIONS.forEach(function(p) {
        var isAllowed = rules.allowed.indexOf(p.value) !== -1;
        if (isAllowed) {
            var selected = (currentPermission === p.value) ? ' selected' : '';
            options += '<option value="' + p.value + '"' + selected + '>' + p.text + '</option>';
        }
    });
    
    permEl.innerHTML = options;
    
    if (!currentPermission || rules.allowed.indexOf(currentPermission) === -1) {
        permEl.value = rules.allowed[0];
    }
}

function populateEntitySelect(role, selectedEntityId) {
    var entityEl = document.getElementById('userEntitySelect');
    var entityTypeEl = document.getElementById('userEntityType');
    var entityRow = document.getElementById('userEntityRow');
    
    if (!entityEl) return;
    
    if (ROLES_REQUIRING_ENTITY.indexOf(role) === -1) {
        if (entityRow) entityRow.style.display = 'none';
        entityEl.innerHTML = '';
        if (entityTypeEl) entityTypeEl.value = '';
        return;
    }
    
    if (entityRow) entityRow.style.display = 'flex';
    if (entityTypeEl) entityTypeEl.value = role;
    
    var entities = [];
    if (role === 'client') {
        entities = USERS_STATE.referenceCache.clients || [];
    } else if (role === 'investor') {
        entities = USERS_STATE.referenceCache.investors || [];
    }
    
    var options = '<option value="">-- اختر ' + (role === 'client' ? 'العميل' : 'الممول') + ' --</option>';
    entities.forEach(function(e) {
        var selected = e.id === selectedEntityId ? ' selected' : '';
        options += '<option value="' + e.id + '"' + selected + '>' + escapeHtml(e.name) + '</option>';
    });
    
    entityEl.innerHTML = options;
}


// ============================================================
// 7. VALIDATION (UX فقط - الحماية الحقيقية في DB)
// ============================================================

function collectUserFormData() {
    return {
        id: document.getElementById('userId').value,
        role: document.getElementById('userRoleSelect').value,
        permission: document.getElementById('userPermissionSelect').value,
        entityId: document.getElementById('userEntitySelect').value,
        entityType: document.getElementById('userEntityType').value,
        isActive: document.getElementById('userActiveSelect').value === 'true'
    };
}

/**
 * Validation للواجهة (UX)
 * ملاحظة: الحماية الحقيقية في DB Triggers + Constraints
 * هذا Validation يعطي رسائل واضحة قبل إرسال الطلب
 */
function validateUserForm(formData) {
    if (isEmpty(formData.role)) {
        showToast('❌ الدور مطلوب', 'error');
        return false;
    }
    
    if (isEmpty(formData.permission)) {
        showToast('❌ الصلاحية مطلوبة', 'error');
        return false;
    }
    
    // التحقق من توافق الدور مع الصلاحية
    var rules = ROLE_PERMISSION_RULES[formData.role];
    if (rules && rules.allowed.indexOf(formData.permission) === -1) {
        showToast('❌ ' + rules.reason, 'error');
        return false;
    }
    
    // التحقق من الكيان
    if (ROLES_REQUIRING_ENTITY.indexOf(formData.role) !== -1) {
        if (isEmpty(formData.entityId)) {
            showToast('❌ يجب ربط المستخدم بكيان (عميل/ممول)', 'error');
            return false;
        }
    }
    
    // تنظيف entity_id إذا كان الدور لا يحتاج كيان
    if (ROLES_REQUIRING_ENTITY.indexOf(formData.role) === -1) {
        formData.entityId = '';
    }
    
    // منع تعطيل المستخدم الحالي
    var isCurrentUser = APP.currentUser && APP.currentUser.id === formData.id;
    var currentUserProfile = USERS_STATE.records.find(function(p) { return p.id === formData.id; });
    
    if (isCurrentUser && currentUserProfile && formData.isActive !== currentUserProfile.is_active) {
        showToast('❌ لا يمكنك تغيير حالة حسابك الخاص', 'error');
        return false;
    }
    
    return true;
}


// ============================================================
// 8. SAVE USER PROFILE
// ============================================================

async function saveUserProfile() {
    if (!isAdmin()) {
        showToast('❌ لا توجد صلاحية', 'error');
        return;
    }
    
    var formData = collectUserFormData();
    
    if (!validateUserForm(formData)) {
        return;
    }
    
    var data = {
        role: formData.role,
        permission: formData.permission,
        entity_id: formData.entityId || null,
        is_active: formData.isActive
    };
    
    showLoading();
    
    try {
        var oldResult = await runQuery(
            function() {
                return APP.supabase
                    .from('user_profiles')
                    .select('*')
                    .eq('id', formData.id)
                    .single();
            },
            { context: 'saveUserProfile-getOld', throwError: true }
        );
        
        // ✅ ملاحظة: DB Triggers ستتحقق من:
        // - آخر Admin
        // - توافق Role/Permission
        // - وجود الكيان
        // - عدم تكرار entity_id
        // إذا فشل أي تحقق، سيرجع خطأ من DB
        var updateResult = await runQuery(
            function() {
                return APP.supabase
                    .from('user_profiles')
                    .update(data)
                    .eq('id', formData.id);
            },
            { context: 'saveUserProfile-update', throwError: true }
        );
        
        // تسجيل في Activity Log - جميع الحقول المتغيرة
        if (typeof window.logActivityToDB === 'function') {
            var oldData = oldResult.data || {};
            var changes = [];
            
            if (oldData.role !== data.role) {
                changes.push('Role: ' + (oldData.role || '-') + ' → ' + data.role);
            }
            if (oldData.permission !== data.permission) {
                changes.push('Permission: ' + (oldData.permission || '-') + ' → ' + data.permission);
            }
            if ((oldData.entity_id || '') !== (data.entity_id || '')) {
                changes.push('Entity: ' + (oldData.entity_id || 'لا يوجد') + ' → ' + (data.entity_id || 'لا يوجد'));
            }
            if (oldData.is_active !== data.is_active) {
                changes.push('Active: ' + (oldData.is_active ? 'نعم' : 'لا') + ' → ' + (data.is_active ? 'نعم' : 'لا'));
            }
            
            var details = changes.length > 0 ? changes.join(' | ') : 'لا توجد تغييرات';
            
            window.logActivityToDB(
                'تعديل صلاحيات مستخدم', 'user', formData.id,
                JSON.stringify(oldData), JSON.stringify(data),
                details, 'update'
            );
        }
        
        debug('✅ تم تحديث صلاحيات المستخدم', 'success');
        showToast('تم تحديث صلاحيات المستخدم', 'success');
        
        closeModal('userModal');
        loadUsers();
        
    } catch (err) {
        // ✅ عرض رسالة الخطأ من DB Trigger (إن وجدت)
        var errorMessage = err.message || 'حدث خطأ غير معروف';
        
        // ترجمة رسائل DB الشائعة
        if (errorMessage.indexOf('آخر مدير') !== -1) {
            errorMessage = '❌ ' + errorMessage;
        } else if (errorMessage.indexOf('يتطلب ربط بكيان') !== -1) {
            errorMessage = '❌ ' + errorMessage;
        } else if (errorMessage.indexOf('يتطلب صلاحية') !== -1) {
            errorMessage = '❌ ' + errorMessage;
        } else if (errorMessage.indexOf('مؤرشف') !== -1) {
            errorMessage = '❌ ' + errorMessage;
        } else if (errorMessage.indexOf('غير موجود') !== -1) {
            errorMessage = '❌ ' + errorMessage;
        } else if (err.code === '23505') {
            errorMessage = '❌ هذا الكيان مرتبط بالفعل بمستخدم آخر';
        } else {
            errorMessage = '❌ ' + handleSupabaseError(err, 'حفظ التغييرات');
        }
        
        debug('❌ خطأ في saveUserProfile: ' + errorMessage, 'error');
        showToast(errorMessage, 'error');
    } finally {
        hideLoading();
    }
}


// ============================================================
// 9. TOGGLE USER ACTIVE
// ============================================================

async function toggleUserActive(userId) {
    if (!isAdmin()) {
        showToast('❌ لا توجد صلاحية', 'error');
        return;
    }
    
    var profile = USERS_STATE.records.find(function(p) { return p.id === userId; });
    if (!profile) {
        showToast('❌ المستخدم غير موجود', 'error');
        return;
    }
    
    // منع تعطيل المستخدم الحالي
    var isCurrentUser = APP.currentUser && APP.currentUser.id === profile.id;
    if (isCurrentUser) {
        showToast('❌ لا يمكنك تعطيل حسابك الخاص', 'error');
        return;
    }
    
    var newStatus = !profile.is_active;
    var actionText = newStatus ? 'تفعيل' : 'تعطيل';
    
    var confirmMessage = 'هل تريد ' + actionText + ' المستخدم:\n\n' +
        'البريد: ' + (profile.email || '-') + '\n' +
        'الدور: ' + getUserRoleText(profile.role) + '\n\n' +
        (newStatus 
            ? 'سيتمكن المستخدم من تسجيل الدخول واستخدام النظام.' 
            : 'لن يتمكن المستخدم من تسجيل الدخول، لكن بياناته ستبقى محفوظة.');
    
    if (!confirmAction(confirmMessage)) {
        return;
    }
    
    showLoading();
    
    try {
        var oldResult = await runQuery(
            function() {
                return APP.supabase
                    .from('user_profiles')
                    .select('is_active')
                    .eq('id', userId)
                    .single();
            },
            { context: 'toggleUserActive-getOld', throwError: true }
        );
        
        // ✅ DB Trigger سيتحقق من آخر Admin
        await runQuery(
            function() {
                return APP.supabase
                    .from('user_profiles')
                    .update({ is_active: newStatus })
                    .eq('id', userId);
            },
            { context: 'toggleUserActive-update', throwError: true }
        );
        
        if (typeof window.logActivityToDB === 'function') {
            window.logActivityToDB(
                (newStatus ? 'تفعيل' : 'تعطيل') + ' مستخدم',
                'user', userId,
                JSON.stringify(oldResult.data),
                JSON.stringify({ is_active: newStatus }),
                'Email: ' + (profile.email || '-') + ', Role: ' + profile.role,
                newStatus ? 'activate' : 'deactivate'
            );
        }
        
        debug('✅ تم ' + actionText + ' المستخدم', 'success');
        showToast('تم ' + actionText + ' المستخدم', 'success');
        
        loadUsers();
        
    } catch (err) {
        var errorMessage = err.message || 'حدث خطأ غير معروف';
        
        if (errorMessage.indexOf('آخر مدير') !== -1) {
            errorMessage = '❌ ' + errorMessage;
        } else {
            errorMessage = '❌ ' + handleSupabaseError(err, actionText + ' المستخدم');
        }
        
        debug('❌ خطأ في toggleUserActive: ' + errorMessage, 'error');
        showToast(errorMessage, 'error');
    } finally {
        hideLoading();
    }
}


// ============================================================
// 10. SEARCH
// ============================================================

function searchUsers(searchTerm) {
    USERS_STATE.search = searchTerm;
    loadUsers();
}


// ============================================================
// 11. CACHE MANAGEMENT
// ============================================================

/**
 * مسح Reference Cache
 * يُستدعى من clients.js و investors.js عند التعديل
 */
function clearUsersReferenceCache() {
    USERS_STATE.referenceCache.clients = null;
    USERS_STATE.referenceCache.investors = null;
    debug('🗑️ تم مسح Reference Cache للمستخدمين', 'info');
}

// تصدير الدالة للاستخدام من ملفات أخرى
window.clearUsersReferenceCache = clearUsersReferenceCache;


// ============================================================
// 12. HELPER FUNCTIONS
// ============================================================

function editUser(userId) {
    openUserModal(userId);
}


// ============================================================
// END OF USERS.JS
// ============================================================
