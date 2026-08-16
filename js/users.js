// ============================================================
// نظام إدارة التمويل - Users Management Module
// Version: 3.0.0 (Username + Create + Change Password)
// ============================================================
var USERS_STATE = { search: '', records: [], referenceCache: { clients: null, investors: null }, lastSignInCache: null, eventsBound: false, changePasswordUserId: null };

var AVAILABLE_ROLES = Object.freeze([
    { value: 'admin', text: 'مدير' }, { value: 'viewer', text: 'مراقب' },
    { value: 'client', text: 'عميل' }, { value: 'investor', text: 'ممول' }
]);
var AVAILABLE_PERMISSIONS = Object.freeze([
    { value: 'admin', text: 'صلاحيات كاملة' }, { value: 'viewer', text: 'مشاهدة فقط' }
]);
var ROLE_PERMISSION_RULES = Object.freeze({
    admin: { allowed: ['admin'], reason: 'الدور Admin يتطلب صلاحية كاملة' },
    viewer: { allowed: ['viewer'], reason: 'الدور مراقب يتطلب صلاحية مشاهدة فقط' },
    client: { allowed: ['admin', 'viewer'], reason: '' },
    investor: { allowed: ['admin', 'viewer'], reason: '' }
});
var ROLES_REQUIRING_ENTITY = Object.freeze(['client', 'investor']);
var USERNAME_RE = /^[a-z0-9_.-]{3,30}$/;

function initUsers() {
    registerScreenLoader('users', loadUsers);
    bindUserModalEvents();
}
function bindUserModalEvents() {
    if (USERS_STATE.eventsBound) return;
    var roleEl = document.getElementById('userRoleSelect');
    if (roleEl) roleEl.addEventListener('change', function() {
        populateEntitySelect(this.value, document.getElementById('userEntitySelect').value);
        updatePermissionOptions(this.value, null, 'userPermissionSelect');
    });
    var cRoleEl = document.getElementById('createUserRoleSelect');
    if (cRoleEl) cRoleEl.addEventListener('change', function() {
        populateEntitySelectFor(this.value, '', 'createUserEntitySelect', 'createUserEntityType', 'createUserEntityRow');
        updatePermissionOptions(this.value, null, 'createUserPermissionSelect');
    });
    USERS_STATE.eventsBound = true;
}

async function loadUsers() {
    if (!isAdmin()) { showToast('❌ لا توجد صلاحية لعرض هذه الشاشة', 'error'); if (typeof showScreen==='function') showScreen('dashboard'); return; }
    if (!isSupabaseReady()) return;
    showLoading();
    try {
        var results = await Promise.all([
            runQuery(function() { return APP.supabase.from('user_profiles')
                .select('id, email, username, role, entity_id, permission, is_active, created_at, updated_at')
                .order('created_at', { ascending: false }); }, { context: 'loadUsers-profiles', throwError: true }),
            loadClientsForUsers(), loadInvestorsForUsers(), loadLastSignInData()
        ]);
        var profiles = results[0].data || [];
        var indexes = buildUsersIndexes(results[1] || [], results[2] || []);
        var lastMap = results[3] || {};
        profiles.forEach(function(p) {
            p.last_sign_in = lastMap[p.id] || null;
            if (p.role === 'client' && p.entity_id) { p.entity = indexes.clientsById[p.entity_id] || null; p.entityType = 'client'; }
            else if (p.role === 'investor' && p.entity_id) { p.entity = indexes.investorsById[p.entity_id] || null; p.entityType = 'investor'; }
            else { p.entity = null; p.entityType = null; }
        });
        var filtered = profiles;
        if (USERS_STATE.search) {
            var t = USERS_STATE.search.toLowerCase();
            filtered = profiles.filter(function(p) {
                return (p.username && p.username.toLowerCase().indexOf(t) !== -1) ||
                       (p.entity && p.entity.name && p.entity.name.toLowerCase().indexOf(t) !== -1) ||
                       (p.role && p.role.toLowerCase().indexOf(t) !== -1);
            });
        }
        USERS_STATE.records = filtered;
        renderUsersList();
    } catch (err) { showToast(handleSupabaseError(err, 'تحميل المستخدمين'), 'error'); }
    finally { hideLoading(); }
}
async function loadLastSignInData() {
    if (USERS_STATE.lastSignInCache) return USERS_STATE.lastSignInCache;
    try {
        var r = await runQuery(function() { return APP.supabase.rpc('get_users_last_sign_in'); }, { context: 'lastSignIn', throwError: false });
        var data = {}; (r.data || []).forEach(function(row) { data[row.user_id] = row.last_sign_in_at; });
        USERS_STATE.lastSignInCache = data; return data;
    } catch (e) { return {}; }
}
async function loadClientsForUsers() {
    if (USERS_STATE.referenceCache.clients) return USERS_STATE.referenceCache.clients;
    var r = await runQuery(function() { return APP.supabase.from('clients').select('id, name, is_archived').eq('is_archived', false).order('name'); }, { context: 'clientsForUsers', throwError: true });
    USERS_STATE.referenceCache.clients = r.data || []; return USERS_STATE.referenceCache.clients;
}
async function loadInvestorsForUsers() {
    if (USERS_STATE.referenceCache.investors) return USERS_STATE.referenceCache.investors;
    var r = await runQuery(function() { return APP.supabase.from('investors').select('id, name, is_archived').eq('is_archived', false).order('name'); }, { context: 'investorsForUsers', throwError: true });
    USERS_STATE.referenceCache.investors = r.data || []; return USERS_STATE.referenceCache.investors;
}
function buildUsersIndexes(clients, investors) {
    var c = {}, i = {};
    clients.forEach(function(x) { c[x.id] = x; }); investors.forEach(function(x) { i[x.id] = x; });
    return { clientsById: c, investorsById: i };
}

function renderUsersList() {
    var container = document.getElementById('usersTable');
    if (!container) return;
    if (!USERS_STATE.records.length) { container.innerHTML = '<div class="empty-state">لا يوجد مستخدمين</div>'; return; }
    var html = '<table><thead><tr>';
    html += '<th>اسم المستخدم</th><th>الدور</th><th>الصلاحية</th><th>الكيان المرتبط</th><th>الحالة</th><th>آخر دخول</th><th>الإجراءات</th>';
    html += '</tr></thead><tbody>';
    USERS_STATE.records.forEach(function(p) {
        var isMe = APP.currentUser && APP.currentUser.id === p.id;
        var entityDisplay = '-';
        if (p.entity) entityDisplay = escapeHtml(p.entity.name);
        else if (p.entity_id) entityDisplay = '<span class="badge badge-inactive">⚠️ كيان محذوف</span>';
        html += '<tr>';
        html += '<td><strong>' + escapeHtml(p.username || '-') + '</strong>' + (isMe ? ' <span class="badge badge-admin">(أنت)</span>' : '') + '</td>';
        html += '<td><span class="badge badge-' + p.role + '">' + getUserRoleText(p.role) + '</span></td>';
        html += '<td><span class="badge badge-' + p.permission + '">' + (p.permission === 'admin' ? 'صلاحيات كاملة' : 'مشاهدة فقط') + '</span></td>';
        html += '<td>' + entityDisplay + '</td>';
        html += '<td>' + (p.is_active ? '<span class="badge badge-active">مفعل</span>' : '<span class="badge badge-inactive">معطل</span>') + '</td>';
        html += '<td>' + (p.last_sign_in ? formatDateTime(p.last_sign_in) : '-') + '</td>';
        html += '<td class="actions-cell">';
        html += '<button class="btn btn-secondary btn-sm" data-action="editUser" data-param="' + p.id + '">تعديل</button>';
        html += '<button class="btn btn-info btn-sm" data-action="changeUserPassword" data-param="' + p.id + '">كلمة المرور</button>';
        if (!isMe) html += '<button class="btn ' + (p.is_active ? 'btn-warning' : 'btn-success') + ' btn-sm" data-action="toggleUserActive" data-param="' + p.id + '">' + (p.is_active ? 'تعطيل' : 'تفعيل') + '</button>';
        html += '</td></tr>';
    });
    html += '</tbody></table>';
    container.innerHTML = html;
}

// ---------- Modal تعديل ----------
async function openUserModal(userId) {
    if (!isAdmin()) { showToast('❌ لا توجد صلاحية', 'error'); return; }
    await Promise.all([loadClientsForUsers(), loadInvestorsForUsers()]);
    var p = USERS_STATE.records.find(function(x) { return x.id === userId; });
    if (!p) { showToast('❌ المستخدم غير موجود', 'error'); return; }
    var isMe = APP.currentUser && APP.currentUser.id === p.id;
    document.getElementById('userModalTitle').textContent = 'تعديل المستخدم';
    document.getElementById('userId').value = p.id;
    document.getElementById('userUsernameInput').value = p.username || '';
    var roleEl = document.getElementById('userRoleSelect');
    roleEl.innerHTML = AVAILABLE_ROLES.map(function(r) { return '<option value="' + r.value + '"' + (r.value === p.role ? ' selected' : '') + '>' + r.text + '</option>'; }).join('');
    updatePermissionOptions(p.role, p.permission, 'userPermissionSelect');
    populateEntitySelect(p.role, p.entity_id);
    var activeEl = document.getElementById('userActiveSelect');
    activeEl.value = p.is_active ? 'true' : 'false';
    activeEl.disabled = isMe;
    openModal('userModal');
}
function updatePermissionOptions(role, currentPermission, selectId) {
    var el = document.getElementById(selectId); if (!el) return;
    var rules = ROLE_PERMISSION_RULES[role]; if (!rules) return;
    el.innerHTML = AVAILABLE_PERMISSIONS.filter(function(p) { return rules.allowed.indexOf(p.value) !== -1; })
        .map(function(p) { return '<option value="' + p.value + '"' + (currentPermission === p.value ? ' selected' : '') + '>' + p.text + '</option>'; }).join('');
    if (!currentPermission || rules.allowed.indexOf(currentPermission) === -1) el.value = rules.allowed[0];
}
function populateEntitySelect(role, selectedEntityId) { populateEntitySelectFor(role, selectedEntityId, 'userEntitySelect', 'userEntityType', 'userEntityRow'); }
function populateEntitySelectFor(role, selectedEntityId, selId, typeId, rowId) {
    var sel = document.getElementById(selId), typeEl = document.getElementById(typeId), row = document.getElementById(rowId);
    if (!sel) return;
    if (ROLES_REQUIRING_ENTITY.indexOf(role) === -1) { if (row) row.style.display = 'none'; sel.innerHTML = ''; if (typeEl) typeEl.value = ''; return; }
    if (row) row.style.display = 'flex'; if (typeEl) typeEl.value = role;
    var list = role === 'client' ? (USERS_STATE.referenceCache.clients || []) : (USERS_STATE.referenceCache.investors || []);
    sel.innerHTML = '<option value="">-- اختر --</option>' + list.map(function(e) { return '<option value="' + e.id + '"' + (e.id === selectedEntityId ? ' selected' : '') + '>' + escapeHtml(e.name) + '</option>'; }).join('');
}
function collectUserFormData() {
    return {
        id: document.getElementById('userId').value,
        username: document.getElementById('userUsernameInput').value.trim().toLowerCase(),
        role: document.getElementById('userRoleSelect').value,
        permission: document.getElementById('userPermissionSelect').value,
        entityId: document.getElementById('userEntitySelect').value,
        isActive: document.getElementById('userActiveSelect').value === 'true'
    };
}
function validateProfileForm(f) {
    if (!USERNAME_RE.test(f.username)) { showToast('❌ اسم مستخدم غير صالح', 'error'); return false; }
    var rules = ROLE_PERMISSION_RULES[f.role];
    if (rules && rules.allowed.indexOf(f.permission) === -1) { showToast('❌ ' + rules.reason, 'error'); return false; }
    if (ROLES_REQUIRING_ENTITY.indexOf(f.role) !== -1 && isEmpty(f.entityId)) { showToast('❌ يجب ربط المستخدم بكيان', 'error'); return false; }
    if (ROLES_REQUIRING_ENTITY.indexOf(f.role) === -1) f.entityId = '';
    return true;
}
async function saveUserProfile() {
    if (!isAdmin()) { showToast('❌ لا توجد صلاحية', 'error'); return; }
    var f = collectUserFormData();
    if (!validateProfileForm(f)) return;
    showLoading();
    try {
        await runQuery(function() { return APP.supabase.from('user_profiles').update({
            username: f.username, role: f.role, permission: f.permission,
            entity_id: f.entityId || null, is_active: f.isActive
        }).eq('id', f.id); }, { context: 'saveUserProfile', throwError: true });
        showToast('تم تحديث المستخدم', 'success'); closeModal('userModal'); loadUsers();
    } catch (err) { showToast(translateProfileError(err), 'error'); }
    finally { hideLoading(); }
}
function translateProfileError(err) {
    var m = err.message || '';
    if (err.code === '23505' || m.indexOf('username') !== -1) return '❌ اسم المستخدم مستخدم بالفعل';
    if (m.indexOf('آخر مدير') !== -1 || m.indexOf('يتطلب') !== -1 || m.indexOf('مؤرشف') !== -1 || m.indexOf('غير موجود') !== -1) return '❌ ' + m;
    return '❌ ' + handleSupabaseError(err, 'حفظ التغييرات');
}

// ---------- إنشاء مستخدم (Edge Function) ----------
function openCreateUserModal() {
    if (!isAdmin()) { showToast('❌ لا توجد صلاحية', 'error'); return; }
    document.getElementById('createUsername').value = '';
    document.getElementById('createPassword').value = '';
    var roleEl = document.getElementById('createUserRoleSelect');
    roleEl.innerHTML = AVAILABLE_ROLES.map(function(r) { return '<option value="' + r.value + '">' + r.text + '</option>'; }).join('');
    updatePermissionOptions(roleEl.value, null, 'createUserPermissionSelect');
    populateEntitySelectFor(roleEl.value, '', 'createUserEntitySelect', 'createUserEntityType', 'createUserEntityRow');
    document.getElementById('createUserStatus').value = 'true';
    openModal('createUserModal');
}
async function saveNewUser() {
    if (!isAdmin()) { showToast('❌ لا توجد صلاحية', 'error'); return; }
    var username = document.getElementById('createUsername').value.trim().toLowerCase();
    var password = document.getElementById('createPassword').value;
    var role = document.getElementById('createUserRoleSelect').value;
    var permission = document.getElementById('createUserPermissionSelect').value;
    var entityId = document.getElementById('createUserEntitySelect').value;
    var isActive = document.getElementById('createUserStatus').value === 'true';
    if (!USERNAME_RE.test(username)) { showToast('❌ اسم مستخدم غير صالح', 'error'); return; }
    if (password.length < 6) { showToast('❌ كلمة المرور 6 أحرف على الأقل', 'error'); return; }
    var rules = ROLE_PERMISSION_RULES[role];
    if (rules.allowed.indexOf(permission) === -1) { showToast('❌ ' + rules.reason, 'error'); return; }
    if (ROLES_REQUIRING_ENTITY.indexOf(role) !== -1 && isEmpty(entityId)) { showToast('❌ يجب ربط المستخدم بكيان', 'error'); return; }
    showLoading();
    try {
        var res = await APP.supabase.functions.invoke('admin_user_ops', { body: {
            action: 'create_user', username: username, password: password,
            role: role, permission: permission, entity_id: entityId || null, is_active: isActive
        }});
        var data = res.data || {};
        if (res.error || !data.ok) { showToast('❌ ' + (data.error || 'فشل الإنشاء'), 'error'); }
        else { showToast('تم إنشاء المستخدم', 'success'); closeModal('createUserModal'); USERS_STATE.lastSignInCache = null; loadUsers(); }
    } catch (err) { showToast('❌ ' + err.message, 'error'); }
    finally { hideLoading(); }
}

// ---------- تغيير كلمة المرور (Edge Function) ----------
function changeUserPassword(userId) {
    if (!isAdmin()) { showToast('❌ لا توجد صلاحية', 'error'); return; }
    USERS_STATE.changePasswordUserId = userId;
    document.getElementById('newPassword').value = '';
    document.getElementById('confirmPassword').value = '';
    openModal('changePasswordModal');
}
async function savePasswordChange() {
    if (!isAdmin()) { showToast('❌ لا توجد صلاحية', 'error'); return; }
    var p1 = document.getElementById('newPassword').value;
    var p2 = document.getElementById('confirmPassword').value;
    if (p1.length < 6) { showToast('❌ كلمة المرور 6 أحرف على الأقل', 'error'); return; }
    if (p1 !== p2) { showToast('❌ كلمتا المرور غير متطابقتين', 'error'); return; }
    showLoading();
    try {
        var res = await APP.supabase.functions.invoke('admin_user_ops', { body: {
            action: 'set_password', user_id: USERS_STATE.changePasswordUserId, new_password: p1
        }});
        var data = res.data || {};
        if (res.error || !data.ok) showToast('❌ ' + (data.error || 'فشل التغيير'), 'error');
        else { showToast('تم تغيير كلمة المرور', 'success'); closeModal('changePasswordModal'); }
    } catch (err) { showToast('❌ ' + err.message, 'error'); }
    finally { hideLoading(); }
}

// ---------- تعطيل / تفعيل ----------
async function toggleUserActive(userId) {
    if (!isAdmin()) { showToast('❌ لا توجد صلاحية', 'error'); return; }
    var p = USERS_STATE.records.find(function(x) { return x.id === userId; });
    if (!p) return;
    if (APP.currentUser && APP.currentUser.id === p.id) { showToast('❌ لا يمكنك تعطيل حسابك', 'error'); return; }
    var newStatus = !p.is_active;
    if (!confirmAction((newStatus ? 'تفعيل' : 'تعطيل') + ' المستخدم: ' + (p.username || '-'))) return;
    showLoading();
    try {
        await runQuery(function() { return APP.supabase.from('user_profiles').update({ is_active: newStatus }).eq('id', userId); }, { context: 'toggleUser', throwError: true });
        showToast('تم ' + (newStatus ? 'تفعيل' : 'تعطيل') + ' المستخدم', 'success'); loadUsers();
    } catch (err) { showToast(translateProfileError(err), 'error'); }
    finally { hideLoading(); }
}

function searchUsers(t) { USERS_STATE.search = t; loadUsers(); }
function clearUsersReferenceCache() { USERS_STATE.referenceCache.clients = null; USERS_STATE.referenceCache.investors = null; }
window.clearUsersReferenceCache = clearUsersReferenceCache;
function editUser(id) { openUserModal(id); }
// ============================================================
// END OF USERS.JS (v3.0.0)
// ============================================================
