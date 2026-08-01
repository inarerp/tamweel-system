// ============================================
// Configuration & Globals
// ============================================
var SUPABASE_URL = 'https://znkexrtkqzmsqnmzvxoq.supabase.co';
var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inpua2V4cnRrcXptc3FubXp2eG9xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU0MTc3NDYsImV4cCI6MjEwMDk5Mzc0Nn0.QyPjqtKy0dS-uoXiefiPfXURnBqR_FBJcZMpGWj_1Rs';
var supabase, currentUser = null, userRole = 'admin', userPermission = 'admin', currentOpId = null, currentOpData = null, currentEntityId = null;
var DEBUG_MODE = true, debugMessages = [], currentScreen = 'dashboard';

// ============================================
// Debug System
// ============================================
function debug(msg, type) {
    type = type || 'info';
    if (!DEBUG_MODE) return;
    var time = new Date().toLocaleTimeString('ar-EG');
    debugMessages.push({msg: msg, type: type, time: time, screen: currentScreen});
    var debugContent = document.getElementById('debugContent');
    if (debugContent) {
        var line = document.createElement('div');
        line.className = 'debug-line debug-' + type;
        line.textContent = '[' + time + '] [' + currentScreen + '] ' + msg;
        debugContent.appendChild(line);
        var debugBox = document.getElementById('debugBox');
        if (debugBox) debugBox.scrollTop = debugBox.scrollHeight;
    }
}
function toggleDebugBox() { document.getElementById('debugBox').classList.toggle('expanded'); }
function toggleDebug() {
    DEBUG_MODE = !DEBUG_MODE;
    var statusEl = document.getElementById('debugStatus');
    if (statusEl) { statusEl.textContent = DEBUG_MODE ? '[مفعّل]' : '[متوقف]'; statusEl.style.color = DEBUG_MODE ? '#4caf50' : '#f44336'; }
    debug('Debug Mode: ' + (DEBUG_MODE ? 'ON' : 'OFF'), 'info');
}
function clearDebugLog() { debugMessages = []; var el = document.getElementById('debugContent'); if (el) el.innerHTML = ''; debug('تم مسح السجل', 'info'); }
function copyDebugLog() {
    var text = debugMessages.map(function(m) { return '[' + m.time + '] [' + m.screen + '] ' + m.msg; }).join('\n');
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(function() { debug('✅ تم نسخ السجل', 'success'); }).catch(function() { debug('❌ فشل النسخ', 'error'); });
}
window.onerror = function(message, source, line) { debug('❌ JS Error: ' + message + ' (Line: ' + line + ')', 'error'); return true; };
window.onunhandledrejection = function(event) { debug('❌ Promise Error: ' + event.reason, 'error'); };

// ============================================
// Utilities
// ============================================
function showToast(msg, type) {
    type = type || 'success';
    var t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg; t.className = 'toast show ' + type;
    setTimeout(function() { t.className = 'toast'; }, 3000);
}
function formatMoney(n) { return (parseFloat(n) || 0).toLocaleString('ar-EG', {minimumFractionDigits: 2, maximumFractionDigits: 2}) + ' ج.م'; }
function formatDate(d) { return d ? new Date(d).toLocaleDateString('ar-EG') : '-'; }
function getStatusText(status) { return {draft:'تحت الإنشاء',active:'نشطة',completed:'انتهت',cancelled:'ألغيت',locked:'مقفلة',inactive:'غير نشط'}[status] || status; }
function closeModal(id) { var el = document.getElementById(id); if (el) el.classList.remove('active'); }
function generateReferenceNumber(prefix, count) { return prefix + '-' + String(count).padStart(4, '0'); }
function canEdit() { return userPermission === 'admin'; }
function canViewProfits() { return userPermission !== 'viewer'; }
function isAdmin() { return userPermission === 'admin'; }
function isClient() { return userRole === 'client'; }
function isInvestor() { return userRole === 'investor'; }
function hideProfits() {
    var elements = document.querySelectorAll('.profit-field');
    for (var i = 0; i < elements.length; i++) elements[i].style.display = 'none';
}
function applyPermissions() {
    debug('🔐 تطبيق الصلاحيات: ' + userPermission, 'info');
    if (userPermission !== 'admin') {
        var adminElements = document.querySelectorAll('.admin-only');
        for (var i = 0; i < adminElements.length; i++) adminElements[i].style.display = 'none';
    }
    if (isClient() || isInvestor() || userPermission === 'viewer') {
        hideProfits();
        var hiddenNavs = document.querySelectorAll('.nav-clients, .nav-investors, .nav-operations, .nav-transfers');
        for (var i = 0; i < hiddenNavs.length; i++) hiddenNavs[i].style.display = 'none';
        var myAcc = document.querySelector('.nav-myaccount');
        if (myAcc) myAcc.style.display = 'inline-block';
    }
    if (isAdmin()) {
        var actLog = document.querySelector('.nav-activity');
        if (actLog) actLog.style.display = 'inline-block';
    }
}
function logActivity(action, entityType, entityId, oldValue, newValue, details) {
    if (!supabase) return;
    supabase.from('activity_logs').insert({
        user_email: currentUser ? currentUser.email : 'Unknown', action: action, entity_type: entityType || null,
        entity_id: entityId ? String(entityId) : null, old_value: oldValue ? String(oldValue) : null,
        new_value: newValue ? String(newValue) : null, details: details || null
    }).catch(function(err) { debug('⚠️ logActivity Error: ' + err.message, 'warning'); });
}

// ============================================
// Authentication
// ============================================
function handleLoginClick() {
    debug('🔘 تم الضغط على زر تسجيل الدخول', 'success');
    var email = document.getElementById('loginEmail').value;
    var password = document.getElementById('loginPassword').value;
    var errorMsg = document.getElementById('errorMsg');
    if (!email || !password) {
        if (errorMsg) { errorMsg.textContent = '⚠️ يرجى إدخال البريد وكلمة المرور'; errorMsg.style.display = 'block'; }
        return;
    }
    if (errorMsg) errorMsg.style.display = 'none';
    debug('📧 Email: ' + email, 'info');
    if (!supabase) { debug('❌ Supabase غير مهيأ', 'error'); return; }
    
    supabase.auth.signInWithPassword({email: email, password: password}).then(function(result) {
        if (result.error) {
            debug('❌ فشل الدخول: ' + result.error.message, 'error');
            if (errorMsg) { errorMsg.textContent = '❌ ' + result.error.message; errorMsg.style.display = 'block'; }
            return;
        }
        debug('✅ تم تسجيل الدخول', 'success');
        currentUser = result.data.user;
        logActivity('تسجيل دخول', 'auth', currentUser.id, null, null, 'User: ' + currentUser.email);
        loadUserProfile().then(function() { showApp(); });
    }).catch(function(err) {
        debug('❌ Exception: ' + err.message, 'error');
    });
}
function doLogout() {
    if (currentUser) logActivity('تسجيل خروج', 'auth', currentUser.id, null, null, 'User: ' + currentUser.email);
    if (supabase) supabase.auth.signOut().then(function() { location.reload(); });
}
function loadUserProfile() {
    return new Promise(function(resolve) {
        if (!currentUser || !supabase) { resolve(); return; }
        supabase.from('user_profiles').select('role,entity_id,permission').eq('id', currentUser.id).maybeSingle().then(function(result) {
            if (result.data) {
                userRole = result.data.role || 'admin';
                userPermission = result.data.permission || 'admin';
                currentEntityId = result.data.entity_id;
                debug('👤 Role: ' + userRole + ', Permission: ' + userPermission, 'success');
            }
            resolve();
        }).catch(function() { userRole = 'admin'; userPermission = 'admin'; resolve(); });
    });
}

// ============================================
// Navigation & Screens
// ============================================
function showApp() {
    var loginScreen = document.getElementById('loginScreen');
    var appContainer = document.getElementById('appContainer');
    if (loginScreen) loginScreen.style.display = 'none';
    if (appContainer) appContainer.style.display = 'block';
    var userEmailEl = document.getElementById('userEmail');
    if (userEmailEl && currentUser) userEmailEl.textContent = currentUser.email;
    var userRoleEl = document.getElementById('userRole');
    if (userRoleEl) userRoleEl.textContent = userRole === 'admin' ? 'مدير' : userRole === 'investor' ? 'ممول' : 'عميل';
    var userPermEl = document.getElementById('userPermission');
    if (userPermEl) {
        userPermEl.textContent = userPermission === 'admin' ? 'صلاحيات كاملة' : userPermission === 'viewer' ? 'مشاهدة فقط' : userPermission;
        userPermEl.style.display = 'inline-block';
    }
    applyPermissions();
    loadDashboard();
}
function showScreen(screenId, btn) {
    currentScreen = screenId;
    debug('📱 تغيير الشاشة إلى: ' + screenId, 'info');
    var screens = document.querySelectorAll('.screen');
    for (var i = 0; i < screens.length; i++) screens[i].classList.remove('active');
    var navBtns = document.querySelectorAll('.nav button');
    for (var i = 0; i < navBtns.length; i++) navBtns[i].classList.remove('active');
    var target = document.getElementById(screenId);
    if (target) target.classList.add('active');
    if (btn) btn.classList.add('active');
    if (screenId === 'dashboard') loadDashboard();
    else if (screenId === 'clients') loadClients();
    else if (screenId === 'investors') loadInvestors();
    else if (screenId === 'operations') loadOperations();
    else if (screenId === 'transfers') loadTransfers();
    else if (screenId === 'myAccount') loadMyAccount();
    else if (screenId === 'activityLog') loadActivityLog();
}

// ============================================
// Dashboard & Activity Log
// ============================================
async function loadDashboard() {
    debug('📊 بدأ loadDashboard', 'info');
    if (!supabase) return;
    try {
        var ops = (await supabase.from('operations').select('*')).data || [];
        var opInvestors = (await supabase.from('operation_investors').select('*')).data || [];
        var transfers = (await supabase.from('transfers').select('*')).data || [];
        var investors = (await supabase.from('investors').select('*')).data || [];
        var clients = (await supabase.from('clients').select('*')).data || [];
        var totalActive = 0, endingSoon = 0, overdue = 0, completed = 0, alerts = [];
        var today = new Date().toISOString().split('T')[0];
        var next30 = new Date(Date.now() + 30*24*60*60*1000).toISOString().split('T')[0];
        ops.forEach(function(op) {
            if (op.status === 'active') {
                totalActive += parseFloat(op.amount || 0);
                if (op.end_date && op.end_date <= next30 && op.end_date >= today) { endingSoon++; alerts.push({type: 'warning', msg: '⚠️ عملية "' + op.name + '" ستنتهي قريباً'}); }
                if (op.end_date && op.end_date < today) { overdue++; alerts.push({type: 'danger', msg: '🚨 عملية "' + op.name + '" متأخرة'}); }
            }
            if (op.status === 'completed') completed++;
        });
        var alertsHtml = '';
        if (alerts.length > 0) {
            alertsHtml = '<div style="margin-bottom:15px">';
            alerts.forEach(function(a) { alertsHtml += '<div class="alert-box ' + a.type + '">' + a.msg + '</div>'; });
            alertsHtml += '</div>';
        }
        var alertsEl = document.getElementById('dashboardAlerts');
        if (alertsEl) alertsEl.innerHTML = alertsHtml;
        var statsEl = document.getElementById('dashboardStats');
        if (statsEl) {
            statsEl.innerHTML = '<div class="stat-card"><h3>التمويل النشط</h3><div class="value blue">' + formatMoney(totalActive) + '</div></div>' +
                '<div class="stat-card"><h3>تنتهي قريباً</h3><div class="value">' + endingSoon + '</div></div>' +
                '<div class="stat-card"><h3>متأخرة</h3><div class="value red">' + overdue + '</div></div>' +
                '<div class="stat-card"><h3>مكتملة</h3><div class="value green">' + completed + '</div></div>' +
                '<div class="stat-card"><h3>العمليات</h3><div class="value">' + ops.length + '</div></div>' +
                '<div class="stat-card"><h3>العملاء</h3><div class="value">' + clients.length + '</div></div>' +
                '<div class="stat-card"><h3>الممولين</h3><div class="value">' + investors.length + '</div></div>';
        }
        debug('✅ loadDashboard اكتمل', 'success');
    } catch (err) { debug('❌ خطأ: ' + err.message, 'error'); }
}
async function loadActivityLog() {
    debug('📜 بدأ loadActivityLog', 'info');
    if (!supabase) return;
    try {
        var data = (await supabase.from('activity_logs').select('*').order('created_at', {ascending: false}).limit(50)).data || [];
        var tableEl = document.getElementById('activityLogTable');
        if (!tableEl) return;
        if (data.length === 0) { tableEl.innerHTML = '<div class="empty-state">لا يوجد سجل</div>'; return; }
        var html = '<table><thead><tr><th>الوقت</th><th>المستخدم</th><th>العملية</th><th>التفاصيل</th></tr></thead><tbody>';
        data.forEach(function(log) {
            html += '<tr><td>' + new Date(log.created_at).toLocaleString('ar-EG') + '</td><td>' + (log.user_email || '-') + '</td><td><strong>' + log.action + '</strong></td><td>' + (log.details || '-') + '</td></tr>';
        });
        tableEl.innerHTML = html + '</tbody></table>';
        debug('✅ loadActivityLog اكتمل', 'success');
    } catch (err) { debug('❌ خطأ: ' + err.message, 'error'); }
}

// ============================================
// Clients
// ============================================
async function loadClients() {
    debug('👥 بدأ loadClients', 'info');
    if (!supabase) return;
    try {
        var data = (await supabase.from('clients').select('*').order('created_at', {ascending: false})).data || [];
        var tableEl = document.getElementById('clientsTable');
        if (!tableEl) return;
        if (data.length === 0) { tableEl.innerHTML = '<div class="empty-state">لا يوجد عملاء</div>'; return; }
        var html = '<table><thead><tr><th>الرقم</th><th>الاسم</th><th>الهاتف</th><th>الحالة</th>';
        if (canEdit()) html += '<th>الإجراءات</th>';
        html += '</tr></thead><tbody>';
        data.forEach(function(c) {
            html += '<tr><td>' + (c.reference_number || '-') + '</td><td><strong>' + c.name + '</strong></td><td>' + (c.phone || '-') + '</td><td>' + (c.is_archived ? '<span class="badge badge-inactive">أرشيف</span>' : '<span class="badge badge-active">نشط</span>') + '</td>';
            if (canEdit() && !c.is_archived) html += '<td class="actions-cell"><button class="btn btn-secondary btn-sm" onclick="editClient(\'' + c.id + '\')">تعديل</button><button class="btn btn-warning btn-sm" onclick="archiveClient(\'' + c.id + '\')">أرشفة</button></td>';
            html += '</tr>';
        });
        tableEl.innerHTML = html + '</tbody></table>';
        debug('✅ loadClients اكتمل', 'success');
    } catch (err) { debug('❌ خطأ: ' + err.message, 'error'); }
}
function openClientModal(client) {
    client = client || null;
    document.getElementById('clientModalTitle').textContent = client ? 'تعديل عميل' : 'إضافة عميل';
    document.getElementById('clientId').value = client ? client.id : '';
    document.getElementById('clientName').value = client ? client.name : '';
    document.getElementById('clientPhone').value = client ? client.phone : '';
    document.getElementById('clientEmail').value = client ? client.email : '';
    document.getElementById('clientAddress').value = client ? client.address : '';
    document.getElementById('clientNotes').value = client ? client.notes : '';
    document.getElementById('clientModal').classList.add('active');
}
document.getElementById('clientForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    if (!canEdit()) return;
    var id = document.getElementById('clientId').value;
    var data = { name: document.getElementById('clientName').value, phone: document.getElementById('clientPhone').value, email: document.getElementById('clientEmail').value, address: document.getElementById('clientAddress').value, notes: document.getElementById('clientNotes').value };
    if (id) {
        var old = (await supabase.from('clients').select('*').eq('id', id).single()).data;
        await supabase.from('clients').update(data).eq('id', id);
        logActivity('تعديل عميل', 'client', id, JSON.stringify(old), JSON.stringify(data), 'Name: ' + data.name);
    } else {
        var count = (await supabase.from('clients').select('id')).data || [];
        data.reference_number = generateReferenceNumber('CL', count.length + 1);
        await supabase.from('clients').insert(data);
        logActivity('إضافة عميل', 'client', null, null, JSON.stringify(data), 'Name: ' + data.name);
    }
    closeModal('clientModal'); loadClients(); showToast('تم الحفظ');
});
async function editClient(id) { if (!canEdit()) return; var res = await supabase.from('clients').select('*').eq('id', id).single(); if (res.data) openClientModal(res.data); }
async function archiveClient(id) { if (!canEdit()) return; if (confirm('أرشفة العميل؟')) { await supabase.from('clients').update({is_archived: true}).eq('id', id); logActivity('أرشفة عميل', 'client', id, 'نشط', 'أرشيف', null); loadClients(); showToast('تمت الأرشفة'); } }

// ============================================
// Investors
// ============================================
async function loadInvestors() {
    debug('💰 بدأ loadInvestors', 'info');
    if (!supabase) return;
    try {
        var data = (await supabase.from('investors').select('*').order('created_at', {ascending: false})).data || [];
        var tableEl = document.getElementById('investorsTable');
        if (!tableEl) return;
        if (data.length === 0) { tableEl.innerHTML = '<div class="empty-state">لا يوجد ممولين</div>'; return; }
        var opInv = (await supabase.from('operation_investors').select('*')).data || [];
        var transfers = (await supabase.from('transfers').select('*')).data || [];
        var ops = (await supabase.from('operations').select('id,status')).data || [];
        var html = '<table><thead><tr><th>الرقم</th><th>الاسم</th><th>الكلي</th><th>المستثمر</th><th>المُرجع</th><th>المتبقي</th><th class="profit-field">أرباح مستحقة</th><th>الحالة</th>';
        if (canEdit()) html += '<th>الإجراءات</th>';
        html += '</tr></thead><tbody>';
        data.forEach(function(inv) {
            var myC = opInv.filter(function(oi) { return oi.investor_id === inv.id; }) || [];
            var totalCap = myC.reduce(function(s, c) { return s + parseFloat(c.contribution || 0); }, 0);
            var workCap = myC.filter(function(c) { var o = ops.find(function(x) { return x.id === c.operation_id; }); return o && (o.status === 'active' || o.status === 'draft'); }).reduce(function(s, c) { return s + parseFloat(c.contribution || 0); }, 0);
            var capRet = transfers.filter(function(t) { return t.investor_id === inv.id && t.purpose === 'capital_return'; }).reduce(function(s, t) { return s + parseFloat(t.amount || 0); }, 0) || 0;
            var capPend = Math.max(0, (totalCap - workCap) - capRet);
            var totProf = myC.reduce(function(s, c) { return s + parseFloat(c.profit || 0); }, 0);
            var profPaid = transfers.filter(function(t) { return t.investor_id === inv.id && t.purpose === 'profit_distribution'; }).reduce(function(s, t) { return s + parseFloat(t.amount || 0); }, 0) || 0;
            var outProf = Math.max(0, totProf - profPaid);
            html += '<tr><td>' + (inv.reference_number || '-') + '</td><td><strong style="cursor:pointer;color:#667eea" onclick="openInvestorDetail(\'' + inv.id + '\')">' + inv.name + '</strong></td><td>' + formatMoney(totalCap) + '</td><td>' + formatMoney(workCap) + '</td><td>' + formatMoney(capRet) + '</td><td>' + formatMoney(capPend) + '</td><td class="profit-field">' + (canViewProfits() ? formatMoney(outProf) : '<span class="hidden-profit">****</span>') + '</td><td>' + (inv.is_archived ? '<span class="badge badge-inactive">أرشيف</span>' : '<span class="badge badge-active">نشط</span>') + '</td>';
            if (canEdit() && !inv.is_archived) html += '<td class="actions-cell"><button class="btn btn-secondary btn-sm" onclick="editInvestor(\'' + inv.id + '\')">تعديل</button><button class="btn btn-warning btn-sm" onclick="archiveInvestor(\'' + inv.id + '\')">أرشفة</button></td>';
            html += '</tr>';
        });
        tableEl.innerHTML = html + '</tbody></table>';
        debug('✅ loadInvestors اكتمل', 'success');
    } catch (err) { debug('❌ خطأ: ' + err.message, 'error'); }
}
async function openInvestorDetail(invId) {
    try {
        var inv = (await supabase.from('investors').select('*').eq('id', invId).single()).data;
        if (!inv) return;
        document.getElementById('investorDetailName').textContent = 'تفاصيل: ' + inv.name;
        var opInv = (await supabase.from('operation_investors').select('*,operations(name,status,amount)').eq('investor_id', invId)).data || [];
        var transfers = (await supabase.from('transfers').select('*').eq('investor_id', invId)).data || [];
        var ops = (await supabase.from('operations').select('id,status')).data || [];
        var myC = opInv.filter(function(oi) { return oi.investor_id === invId; }) || [];
        var totalCap = myC.reduce(function(s, c) { return s + parseFloat(c.contribution || 0); }, 0);
        var workCap = myC.filter(function(c) { var o = ops.find(function(x) { return x.id === c.operation_id; }); return o && (o.status === 'active' || o.status === 'draft'); }).reduce(function(s, c) { return s + parseFloat(c.contribution || 0); }, 0);
        var capRet = transfers.filter(function(t) { return t.investor_id === invId && t.purpose === 'capital_return'; }).reduce(function(s, t) { return s + parseFloat(t.amount || 0); }, 0) || 0;
        var capPend = Math.max(0, (totalCap - workCap) - capRet);
        var totProf = myC.reduce(function(s, c) { return s + parseFloat(c.profit || 0); }, 0);
        var profPaid = transfers.filter(function(t) { return t.investor_id === invId && t.purpose === 'profit_distribution'; }).reduce(function(s, t) { return s + parseFloat(t.amount || 0); }, 0) || 0;
        var outProf = Math.max(0, totProf - profPaid);
        document.getElementById('investorStatsGrid').innerHTML = '<div class="summary-item"><label>الكلي</label><div class="val">' + formatMoney(totalCap) + '</div></div><div class="summary-item"><label>المستثمر</label><div class="val">' + formatMoney(workCap) + '</div></div><div class="summary-item"><label>المُرجع</label><div class="val green">' + formatMoney(capRet) + '</div></div><div class="summary-item"><label>المتبقي</label><div class="val orange">' + formatMoney(capPend) + '</div></div><div class="summary-item profit-field"><label>مستحقة</label><div class="val">' + (canViewProfits() ? formatMoney(outProf) : '****') + '</div></div><div class="summary-item profit-field"><label>مصروفة</label><div class="val">' + (canViewProfits() ? formatMoney(profPaid) : '****') + '</div></div>';
        var opsHtml = '<table><thead><tr><th>العملية</th><th>الحالة</th><th>المساهمة</th><th class="profit-field">الربح</th></tr></thead><tbody>';
        opInv.forEach(function(oi) { opsHtml += '<tr><td>' + (oi.operations ? oi.operations.name : '-') + '</td><td><span class="badge badge-' + (oi.operations ? oi.operations.status : '') + '">' + getStatusText(oi.operations ? oi.operations.status : '') + '</span></td><td>' + formatMoney(oi.contribution) + '</td><td class="profit-field">' + (canViewProfits() ? formatMoney(oi.profit) : '<span class="hidden-profit">****</span>') + '</td></tr>'; });
        document.getElementById('investorOpsList').innerHTML = opsHtml + '</tbody></table>';
        document.getElementById('investorDetailModal').classList.add('active');
    } catch (err) { debug('❌ خطأ: ' + err.message, 'error'); }
}
function openInvestorModal(inv) {
    if (!canEdit()) return;
    inv = inv || null;
    document.getElementById('investorModalTitle').textContent = inv ? 'تعديل' : 'إضافة';
    document.getElementById('investorId').value = inv ? inv.id : '';
    document.getElementById('investorName').value = inv ? inv.name : '';
    document.getElementById('investorPhone').value = inv ? inv.phone : '';
    document.getElementById('investorEmail').value = inv ? inv.email : '';
    document.getElementById('investorAddress').value = inv ? inv.address : '';
    document.getElementById('investorNotes').value = inv ? inv.notes : '';
    document.getElementById('investorModal').classList.add('active');
}
document.getElementById('investorForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    if (!canEdit()) return;
    var id = document.getElementById('investorId').value;
    var data = { name: document.getElementById('investorName').value, phone: document.getElementById('investorPhone').value, email: document.getElementById('investorEmail').value, address: document.getElementById('investorAddress').value, notes: document.getElementById('investorNotes').value };
    if (id) {
        var old = (await supabase.from('investors').select('*').eq('id', id).single()).data;
        await supabase.from('investors').update(data).eq('id', id);
        logActivity('تعديل ممول', 'investor', id, JSON.stringify(old), JSON.stringify(data), 'Name: ' + data.name);
    } else {
        var count = (await supabase.from('investors').select('id')).data || [];
        data.reference_number = generateReferenceNumber('INV', count.length + 1);
        await supabase.from('investors').insert(data);
        logActivity('إضافة ممول', 'investor', null, null, JSON.stringify(data), 'Name: ' + data.name);
    }
    closeModal('investorModal'); loadInvestors(); showToast('تم الحفظ');
});
async function editInvestor(id) { if (!canEdit()) return; var res = await supabase.from('investors').select('*').eq('id', id).single(); if (res.data) openInvestorModal(res.data); }
async function archiveInvestor(id) { if (!canEdit()) return; if (confirm('أرشفة الممول؟')) { await supabase.from('investors').update({is_archived: true}).eq('id', id); logActivity('أرشفة ممول', 'investor', id, 'نشط', 'أرشيف', null); loadInvestors(); showToast('تمت الأرشفة'); } }

// ============================================
// Operations
// ============================================
async function loadOperations() {
    debug('📋 بدأ loadOperations', 'info');
    if (!supabase) return;
    try {
        var data = (await supabase.from('operations').select('*,clients(name)').order('created_at', {ascending: false})).data || [];
        var tableEl = document.getElementById('operationsTable');
        if (!tableEl) return;
        if (data.length === 0) { tableEl.innerHTML = '<div class="empty-state">لا يوجد عمليات</div>'; return; }
        var html = '<table><thead><tr><th>الرقم</th><th>الاسم</th><th>العميل</th><th>المبلغ</th><th class="profit-field">الربح</th><th>الحالة</th><th>القفل</th><th>الإجراءات</th></tr></thead><tbody>';
        data.forEach(function(o) {
            html += '<tr><td>' + (o.reference_number || '-') + '</td><td><strong>' + o.name + '</strong></td><td>' + (o.clients ? o.clients.name : '-') + '</td><td>' + formatMoney(o.amount) + '</td><td class="profit-field">' + (canViewProfits() ? formatMoney(o.final_profit) : '<span class="hidden-profit">****</span>') + '</td><td><span class="badge badge-' + o.status + '">' + getStatusText(o.status) + '</span></td><td>' + (o.is_locked ? '🔒' : '🔓') + '</td><td class="actions-cell"><button class="btn btn-primary btn-sm" onclick="openOperationDetails(\'' + o.id + '\')">تفاصيل</button>';
            if (canEdit() && !o.is_locked) html += '<button class="btn btn-secondary btn-sm" onclick="editOperation(\'' + o.id + '\')">تعديل</button>';
            html += '</td></tr>';
        });
        tableEl.innerHTML = html + '</tbody></table>';
        debug('✅ loadOperations اكتمل', 'success');
    } catch (err) { debug('❌ خطأ: ' + err.message, 'error'); }
}
async function openOperationModal(op) {
    if (!canEdit()) return;
    op = op || null;
    document.getElementById('operationModalTitle').textContent = op ? 'تعديل' : 'إضافة';
    document.getElementById('operationId').value = op ? op.id : '';
    document.getElementById('opName').value = op ? op.name : '';
    document.getElementById('opType').value = op ? op.type : 'financing';
    document.getElementById('opAmount').value = op ? op.amount : '';
    document.getElementById('opExpectedProfit').value = op ? op.expected_profit : '';
    document.getElementById('opFinalProfit').value = op ? op.final_profit : '';
    document.getElementById('opProfitApprovalDate').value = op ? op.profit_approval_date : '';
    document.getElementById('opGoogleDriveUrl').value = op ? op.google_drive_url : '';
    document.getElementById('opCompanyProfitType').value = op ? op.company_profit_type : '';
    document.getElementById('opCompanyProfitValue').value = op ? op.company_profit_value : '';
    document.getElementById('opStartDate').value = op ? op.start_date : '';
    document.getElementById('opDurationDays').value = op ? op.duration_days : '';
    document.getElementById('opEndDate').value = op ? op.end_date : '';
    document.getElementById('opStatus').value = op ? op.status : 'draft';
    document.getElementById('opNotes').value = op ? op.notes : '';
    var clients = (await supabase.from('clients').select('*')).data || [];
    var opts = '<option value="">اختر</option>';
    clients.forEach(function(c) { if (!c.is_archived) opts += '<option value="' + c.id + '"' + (op && op.client_id === c.id ? ' selected' : '') + '>' + c.name + '</option>'; });
    document.getElementById('opClient').innerHTML = opts;
    document.getElementById('operationModal').classList.add('active');
}
document.getElementById('opStartDate').addEventListener('change', calculateEndDate);
document.getElementById('opDurationDays').addEventListener('change', calculateEndDate);
function calculateEndDate() {
    var sd = document.getElementById('opStartDate').value;
    var days = parseInt(document.getElementById('opDurationDays').value);
    var ed = document.getElementById('opEndDate');
    if (sd && days && ed) { var end = new Date(new Date(sd).getTime() + days*24*60*60*1000); ed.value = end.toISOString().split('T')[0]; }
}
document.getElementById('operationForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    if (!canEdit()) return;
    var id = document.getElementById('operationId').value;
    var amount = parseFloat(document.getElementById('opAmount').value);
    var expProf = parseFloat(document.getElementById('opExpectedProfit').value) || 0;
    var finProf = parseFloat(document.getElementById('opFinalProfit').value) || 0;
    var dur = parseInt(document.getElementById('opDurationDays').value) || 0;
    if (amount <= 0 || expProf < 0 || finProf < 0 || dur < 0) { showToast('❌ قيم غير صالحة', 'error'); return; }
    var data = { name: document.getElementById('opName').value, type: document.getElementById('opType').value, client_id: document.getElementById('opClient').value, amount: amount, expected_profit: expProf || null, final_profit: finProf || null, profit_approval_date: document.getElementById('opProfitApprovalDate').value || null, google_drive_url: document.getElementById('opGoogleDriveUrl').value || null, company_profit_type: document.getElementById('opCompanyProfitType').value || null, company_profit_value: document.getElementById('opCompanyProfitValue').value || null, start_date: document.getElementById('opStartDate').value, duration_days: dur || null, end_date: document.getElementById('opEndDate').value || null, status: document.getElementById('opStatus').value, notes: document.getElementById('opNotes').value };
    if (id) {
        var old = (await supabase.from('operations').select('*').eq('id', id).single()).data;
        if (old && old.is_locked) { showToast('❌ العملية مقفلة', 'error'); return; }
        await supabase.from('operations').update(data).eq('id', id);
        logActivity('تعديل عملية', 'operation', id, JSON.stringify(old), JSON.stringify(data), 'Name: ' + data.name);
    } else {
        var count = (await supabase.from('operations').select('id')).data || [];
        data.reference_number = generateReferenceNumber('OP', count.length + 1);
        var res = await supabase.from('operations').insert(data).select();
        if (res.data && res.data[0]) {
            logActivity('إضافة عملية', 'operation', res.data[0].id, null, JSON.stringify(data), 'Name: ' + data.name);
            closeModal('operationModal'); openOperationDetails(res.data[0].id); return;
        }
    }
    closeModal('operationModal'); loadOperations(); showToast('تم الحفظ');
});
async function editOperation(id) { if (!canEdit()) return; var res = await supabase.from('operations').select('*').eq('id', id).single(); if (res.data) { if (res.data.is_locked) { showToast('❌ مقفلة', 'error'); return; } openOperationModal(res.data); } }
async function openOperationDetails(opId) {
    try {
        currentOpId = opId;
        var op = (await supabase.from('operations').select('*,clients(name)').eq('id', opId).single()).data;
        if (!op) return;
        currentOpData = op;
        document.getElementById('opDetailsTitle').textContent = 'تفاصيل: ' + op.name + (op.reference_number ? ' (' + op.reference_number + ')' : '');
        await refreshOperationSummary();
        loadOpInvestorsTab(op); loadOpTransfersTab(op); loadOpTimelineTab(op);
        var tabs = document.querySelectorAll('#operationDetailsModal .tab');
        for (var i = 0; i < tabs.length; i++) tabs[i].classList.toggle('active', i === 0);
        var tcs = document.querySelectorAll('#operationDetailsModal .tab-content');
        for (var i = 0; i < tcs.length; i++) tcs[i].classList.toggle('active', i === 0);
        document.getElementById('workflowActions').style.display = op.is_locked ? 'none' : 'flex';
        document.getElementById('unlockBtn').style.display = (op.is_locked && isAdmin()) ? 'inline-flex' : 'none';
        if (isClient()) { document.querySelector('.tab[onclick*="investors"]').style.display = 'none'; document.getElementById('opTabInvestors').style.display = 'none'; }
        document.getElementById('operationDetailsModal').classList.add('active');
    } catch (err) { debug('❌ خطأ: ' + err.message, 'error'); }
}
async function refreshOperationSummary() {
    try {
        var op = currentOpData;
        var opInv = (await supabase.from('operation_investors').select('*').eq('operation_id', op.id)).data || [];
        var transfers = (await supabase.from('transfers').select('*').eq('operation_id', op.id)).data || [];
        var totInv = opInv.reduce(function(s, i) { return s + parseFloat(i.contribution || 0); }, 0) || 0;
        var compProf = 0;
        if (op.company_profit_type === 'percentage' && op.final_profit) compProf = (parseFloat(op.final_profit) * parseFloat(op.company_profit_value || 0)) / 100;
        else if (op.company_profit_type === 'fixed') compProf = parseFloat(op.company_profit_value || 0);
        var totInvProf = Math.max(0, (parseFloat(op.final_profit) || 0) - compProf);
        var distProf = transfers.filter(function(t) { return t.purpose === 'profit_distribution'; }).reduce(function(s, t) { return s + parseFloat(t.amount || 0); }, 0) || 0;
        var remProf = Math.max(0, totInvProf - distProf);
        var cliRep = transfers.filter(function(t) { return t.purpose === 'client_repayment'; }).reduce(function(s, t) { return s + parseFloat(t.amount || 0); }, 0) || 0;
        var capRet = transfers.filter(function(t) { return t.purpose === 'capital_return'; }).reduce(function(s, t) { return s + parseFloat(t.amount || 0); }, 0) || 0;
        document.getElementById('opSummaryGrid').innerHTML = '<div class="summary-item"><label>الرقم</label><div class="val">' + (op.reference_number || '-') + '</div></div><div class="summary-item"><label>التمويل</label><div class="val">' + formatMoney(op.amount) + '</div></div><div class="summary-item"><label>الممولين</label><div class="val">' + opInv.length + '</div></div><div class="summary-item"><label>المستثمر</label><div class="val">' + formatMoney(totInv) + '</div></div><div class="summary-item profit-field"><label>الربح النهائي</label><div class="val">' + (canViewProfits() ? formatMoney(op.final_profit) : '<span class="hidden-profit">****</span>') + '</div></div><div class="summary-item profit-field"><label>تاريخ الاعتماد</label><div class="val">' + formatDate(op.profit_approval_date) + '</div></div><div class="summary-item"><label>مرفقات</label><div class="val">' + (op.google_drive_url ? '<a href="' + op.google_drive_url + '" target="_blank">فتح</a>' : '-') + '</div></div><div class="summary-item profit-field"><label>ربح الشركة</label><div class="val">' + (canViewProfits() ? formatMoney(compProf) : '<span class="hidden-profit">****</span>') + '</div></div><div class="summary-item profit-field"><label>ربح الممولين</label><div class="val">' + (canViewProfits() ? formatMoney(totInvProf) : '<span class="hidden-profit">****</span>') + '</div></div><div class="summary-item profit-field"><label>الموزع</label><div class="val green">' + (canViewProfits() ? formatMoney(distProf) : '<span class="hidden-profit">****</span>') + '</div></div><div class="summary-item profit-field"><label>المتبقي</label><div class="val red">' + (canViewProfits() ? formatMoney(remProf) : '<span class="hidden-profit">****</span>') + '</div></div><div class="summary-item"><label>مسدد</label><div class="val">' + formatMoney(cliRep) + '/' + formatMoney(op.amount) + '</div></div><div class="summary-item"><label>مُرجع</label><div class="val">' + formatMoney(capRet) + '/' + formatMoney(totInv) + '</div></div><div class="summary-item"><label>الحالة</label><div class="val"><span class="badge badge-' + op.status + '">' + getStatusText(op.status) + '</span> ' + (op.is_locked ? '🔒' : '') + '</div></div>';
    } catch (err) { debug('❌ خطأ: ' + err.message, 'error'); }
}
function showOpTab(tabName, btn) {
    var tabs = document.querySelectorAll('#operationDetailsModal .tab');
    for (var i = 0; i < tabs.length; i++) tabs[i].classList.remove('active');
    var tcs = document.querySelectorAll('#operationDetailsModal .tab-content');
    for (var i = 0; i < tcs.length; i++) tcs[i].classList.remove('active');
    btn.classList.add('active');
    document.getElementById('opTab' + tabName.charAt(0).toUpperCase() + tabName.slice(1)).classList.add('active');
}
async function workflowAction(action) {
    if (!canEdit()) return;
    if (action === 'activate') {
        if (currentOpData.status !== 'draft' || currentOpData.is_locked) { showToast('لا يمكن التفعيل', 'error'); return; }
        var opInv = (await supabase.from('operation_investors').select('*').eq('operation_id', currentOpId)).data || [];
        var totCont = opInv.reduce(function(s, oi) { return s + parseFloat(oi.contribution || 0); }, 0);
        var opAmt = parseFloat(currentOpData.amount);
        if (Math.abs(totCont - opAmt) > 0.01) { showToast('❌ المساهمات (' + formatMoney(totCont) + ') لا تساوي التمويل (' + formatMoney(opAmt) + ')', 'error'); return; }
        var old = currentOpData.status;
        await supabase.from('operations').update({status: 'active'}).eq('id', currentOpId);
        logActivity('تفعيل عملية', 'operation', currentOpId, old, 'active', 'Op: ' + currentOpData.name);
        showToast('تم التفعيل'); await refreshOperationDetails();
    } else if (action === 'complete') {
        if (currentOpData.is_locked) { showToast('مقفلة', 'error'); return; }
        var op = currentOpData;
        var opInv = (await supabase.from('operation_investors').select('*').eq('operation_id', op.id)).data || [];
        var transfers = (await supabase.from('transfers').select('*').eq('operation_id', op.id)).data || [];
        var totInv = opInv.reduce(function(s, i) { return s + parseFloat(i.contribution || 0); }, 0) || 0;
        var totProf = opInv.reduce(function(s, i) { return s + parseFloat(i.profit || 0); }, 0) || 0;
        var cliRep = transfers.filter(function(t) { return t.purpose === 'client_repayment'; }).reduce(function(s, t) { return s + parseFloat(t.amount || 0); }, 0) || 0;
        var distProf = transfers.filter(function(t) { return t.purpose === 'profit_distribution'; }).reduce(function(s, t) { return s + parseFloat(t.amount || 0); }, 0) || 0;
        var capRet = transfers.filter(function(t) { return t.purpose === 'capital_return'; }).reduce(function(s, t) { return s + parseFloat(t.amount || 0); }, 0) || 0;
        var warns = [];
        if (cliRep < parseFloat(op.amount)) warns.push('لم يسدد العميل');
        if (distProf < totProf) warns.push('لم توزع الأرباح');
        if (capRet < totInv) warns.push('لم يُرجع رأس المال');
        var msg = warns.length > 0 ? '⚠️ تحذير:\n' + warns.join('\n') + '\n\nهل تريد الإنهاء رغم ذلك؟' : 'هل تريد إنهاء العملية؟';
        if (confirm(msg)) {
            var old = currentOpData.status;
            await supabase.from('operations').update({status: 'completed', is_locked: true}).eq('id', currentOpId);
            logActivity('إنهاء عملية', 'operation', currentOpId, old, 'completed+locked', 'Op: ' + currentOpData.name);
            showToast('تم الإنهاء والقفل'); await refreshOperationDetails();
        }
    } else if (action === 'unlock') {
        if (!isAdmin()) { showToast('للمدير فقط', 'error'); return; }
        if (confirm('فتح قفل العملية؟')) {
            await supabase.from('operations').update({is_locked: false}).eq('id', currentOpId);
            logActivity('فتح قفل', 'operation', currentOpId, 'locked', 'unlocked', 'Op: ' + currentOpData.name);
            showToast('تم فتح القفل'); await refreshOperationDetails();
        }
    }
}
async function refreshOperationDetails() {
    try {
        currentOpData = (await supabase.from('operations').select('*,clients(name)').eq('id', currentOpId).single()).data;
        await refreshOperationSummary(); loadOpInvestorsTab(currentOpData); loadOpTransfersTab(currentOpData); loadOpTimelineTab(currentOpData);
    } catch (err) { debug('❌ خطأ: ' + err.message, 'error'); }
}
async function loadOpInvestorsTab(op) {
    try {
        var opInv = (await supabase.from('operation_investors').select('*,investors(name)').eq('operation_id', op.id)).data || [];
        var container = document.getElementById('opInvestorsList');
        if (!container) return;
        if (opInv.length === 0) { container.innerHTML = '<div class="empty-state">لا يوجد ممولين</div>'; return; }
        var html = '<table><thead><tr><th>الممول</th><th>المساهمة</th><th class="profit-field">الربح</th>';
        if (canEdit() && !op.is_locked) html += '<th>الإجراءات</th>';
        html += '</tr></thead><tbody>';
        opInv.forEach(function(oi) {
            html += '<tr><td><strong>' + (oi.investors ? oi.investors.name : '-') + '</strong></td><td>' + formatMoney(oi.contribution) + '</td><td class="profit-field">' + (canViewProfits() ? formatMoney(oi.profit) : '<span class="hidden-profit">****</span>') + '</td>';
            if (canEdit() && !op.is_locked) html += '<td class="actions-cell"><button class="btn btn-secondary btn-sm" onclick="openEditOpInvestor(\'' + oi.id + '\',' + oi.contribution + ',' + oi.profit + ')">تعديل</button><button class="btn btn-danger btn-sm" onclick="confirmDeleteOpInvestor(\'' + oi.id + '\',\'' + op.id + '\',\'' + (oi.investors ? oi.investors.name : '') + '\',' + oi.contribution + ',' + oi.profit + ')">حذف</button></td>';
            html += '</tr>';
        });
        container.innerHTML = html + '</tbody></table>';
    } catch (err) { debug('❌ خطأ: ' + err.message, 'error'); }
}
async function validateOpInvestorInputs() {
    var contrib = parseFloat(document.getElementById('newOpInvestorContribution').value) || 0;
    var profit = parseFloat(document.getElementById('newOpInvestorProfit').value) || 0;
    var opAmt = parseFloat(currentOpData.amount) || 0;
    var opFinProf = parseFloat(currentOpData.final_profit) || 0;
    var existing = (await supabase.from('operation_investors').select('contribution,profit').eq('operation_id', currentOpId)).data || [];
    var totCont = (existing.reduce(function(s, i) { return s + parseFloat(i.contribution || 0); }, 0) || 0) + contrib;
    var totProf = (existing.reduce(function(s, i) { return s + parseFloat(i.profit || 0); }, 0) || 0) + profit;
    var warns = [];
    if (contrib <= 0) warns.push('⚠️ المساهمة > 0');
    if (profit < 0) warns.push('⚠️ الربح >= 0');
    if (totCont > opAmt) warns.push('⚠️ المساهمات تتجاوز التمويل');
    var compProf = 0;
    if (currentOpData.company_profit_type === 'percentage' && opFinProf) compProf = (opFinProf * parseFloat(currentOpData.company_profit_value || 0)) / 100;
    else if (currentOpData.company_profit_type === 'fixed') compProf = parseFloat(currentOpData.company_profit_value || 0);
    var maxInvProf = Math.max(0, opFinProf - compProf);
    if (totProf > maxInvProf) warns.push('⚠️ أرباح الممولين تتجاوز المتاح');
    document.getElementById('opInvestorValidationWarning').innerHTML = warns.length > 0 ? '<div class="warning-box">' + warns.join('<br>') + '</div>' : '';
}
async function validateEditOpInvestorInputs() {
    var editId = document.getElementById('editOpInvestorId').value;
    var contrib = parseFloat(document.getElementById('editOpInvestorContribution').value) || 0;
    var profit = parseFloat(document.getElementById('editOpInvestorProfit').value) || 0;
    var opAmt = parseFloat(currentOpData.amount) || 0;
    var opFinProf = parseFloat(currentOpData.final_profit) || 0;
    var existing = (await supabase.from('operation_investors').select('id,contribution,profit').eq('operation_id', currentOpId)).data || [];
    var totCont = (existing.filter(function(i) { return i.id !== editId; }).reduce(function(s, i) { return s + parseFloat(i.contribution || 0); }, 0) || 0) + contrib;
    var totProf = (existing.filter(function(i) { return i.id !== editId; }).reduce(function(s, i) { return s + parseFloat(i.profit || 0); }, 0) || 0) + profit;
    var warns = [];
    if (contrib <= 0) warns.push('⚠️ المساهمة > 0');
    if (profit < 0) warns.push('⚠️ الربح >= 0');
    if (totCont > opAmt) warns.push('⚠️ المساهمات تتجاوز التمويل');
    var compProf = 0;
    if (currentOpData.company_profit_type === 'percentage' && opFinProf) compProf = (opFinProf * parseFloat(currentOpData.company_profit_value || 0)) / 100;
    else if (currentOpData.company_profit_type === 'fixed') compProf = parseFloat(currentOpData.company_profit_value || 0);
    var maxInvProf = Math.max(0, opFinProf - compProf);
    if (totProf > maxInvProf) warns.push('⚠️ أرباح الممولين تتجاوز المتاح');
    document.getElementById('editOpInvestorValidationWarning').innerHTML = warns.length > 0 ? '<div class="warning-box">' + warns.join('<br>') + '</div>' : '';
}
function openAddInvestorToOp() {
    if (!canEdit() || currentOpData.is_locked) { showToast('لا يمكن الإضافة', 'error'); return; }
    supabase.from('investors').select('*').then(function(res) {
        var data = res.data || [];
        var opts = '<option value="">اختر</option>';
        data.forEach(function(i) { if (!i.is_archived) opts += '<option value="' + i.id + '">' + i.name + '</option>'; });
        document.getElementById('newOpInvestorId').innerHTML = opts;
        document.getElementById('newOpInvestorContribution').value = '';
        document.getElementById('newOpInvestorProfit').value = '';
        document.getElementById('opInvestorValidationWarning').innerHTML = '';
        document.getElementById('addInvestorToOpModal').classList.add('active');
    });
}
document.getElementById('addInvestorToOpForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    if (!canEdit() || document.getElementById('opInvestorValidationWarning').innerHTML !== '') { showToast('راجع التحذيرات', 'warning'); return; }
    var invId = document.getElementById('newOpInvestorId').value;
    var contrib = parseFloat(document.getElementById('newOpInvestorContribution').value);
    var profit = parseFloat(document.getElementById('newOpInvestorProfit').value) || 0;
    if (contrib <= 0 || profit < 0) { showToast('❌ قيم غير صالحة', 'error'); return; }
    var data = { operation_id: currentOpId, investor_id: invId, contribution: contrib, profit: profit };
    var invName = (await supabase.from('investors').select('name').eq('id', invId).single()).data?.name || '';
    await supabase.from('operation_investors').insert(data);
    logActivity('إضافة ممول لعملية', 'operation_investor', currentOpId, null, JSON.stringify(data), 'Investor: ' + invName);
    closeModal('addInvestorToOpModal'); await refreshOperationDetails(); showToast('تم الإضافة');
});
function openEditOpInvestor(oiId, contribution, profit) {
    if (!canEdit() || currentOpData.is_locked) { showToast('لا يمكن التعديل', 'error'); return; }
    document.getElementById('editOpInvestorId').value = oiId;
    document.getElementById('editOpInvestorContribution').value = contribution;
    document.getElementById('editOpInvestorProfit').value = profit;
    document.getElementById('editOpInvestorValidationWarning').innerHTML = '';
    document.getElementById('editOpInvestorModal').classList.add('active');
}
document.getElementById('editOpInvestorForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    if (!canEdit() || document.getElementById('editOpInvestorValidationWarning').innerHTML !== '') { showToast('راجع التحذيرات', 'warning'); return; }
    var oiId = document.getElementById('editOpInvestorId').value;
    var newCont = parseFloat(document.getElementById('editOpInvestorContribution').value);
    var newProf = parseFloat(document.getElementById('editOpInvestorProfit').value) || 0;
    if (newCont <= 0 || newProf < 0) { showToast('❌ قيم غير صالحة', 'error'); return; }
    var old = (await supabase.from('operation_investors').select('*').eq('id', oiId).single()).data;
    await supabase.from('operation_investors').update({contribution: newCont, profit: newProf}).eq('id', oiId);
    logActivity('تعديل ممول عملية', 'operation_investor', oiId, JSON.stringify(old), JSON.stringify({contribution: newCont, profit: newProf}), 'Op: ' + currentOpData.name);
    closeModal('editOpInvestorModal'); await refreshOperationDetails(); showToast('تم التحديث');
});
async function confirmDeleteOpInvestor(oiId, opId, invName, contrib, profit) {
    if (!canEdit()) return;
    if (confirm('حذف ' + invName + '؟')) {
        logActivity('حذف ممول', 'operation_investor', oiId, JSON.stringify({contribution: contrib, profit: profit}), null, 'Investor: ' + invName);
        await supabase.from('operation_investors').delete().eq('id', oiId);
        await refreshOperationDetails(); showToast('تم الحذف');
    }
}
async function loadOpTransfersTab(op) {
    try {
        var transfers = (await supabase.from('transfers').select('*,investors(name)').eq('operation_id', op.id).order('transfer_date', {ascending: false})).data || [];
        var container = document.getElementById('opTransfersList');
        if (!container) return;
        if (transfers.length === 0) { container.innerHTML = '<div class="empty-state">لا يوجد تحويلات</div>'; return; }
        var pMap = {client_funding:'تمويل',client_repayment:'سداد',capital_return:'إرجاع رأس مال',profit_distribution:'توزيع أرباح',settlement:'تسوية',additional_funding:'تمويل إضافي',other:'أخرى'};
        var html = '<table><thead><tr><th>الرقم</th><th>النوع</th><th>الغرض</th><th>الممول/العميل</th><th>المبلغ</th><th>التاريخ</th>';
        if (canEdit()) html += '<th>الإجراءات</th>';
        html += '</tr></thead><tbody>';
        transfers.forEach(function(t) {
            var typeText = {company_to_client:'شركة→عميل',client_to_company:'عميل→شركة',company_to_investor:'شركة→ممول'}[t.type];
            var party = t.investor_id ? (t.investors ? t.investors.name : '-') : (t.type === 'company_to_client' || t.type === 'client_to_company' ? (currentOpData.clients ? currentOpData.clients.name : '-') : '-');
            html += '<tr><td>' + (t.reference_number || '-') + '</td><td>' + typeText + '</td><td>' + (pMap[t.purpose] || t.purpose) + '</td><td>' + (party || '-') + '</td><td>' + formatMoney(t.amount) + '</td><td>' + formatDate(t.transfer_date) + '</td>';
            if (canEdit()) html += '<td><button class="btn btn-danger btn-sm" onclick="confirmDeleteTransfer(\'' + t.id + '\',\'' + op.id + '\',' + t.amount + ',\'' + (pMap[t.purpose] || t.purpose) + '\')">حذف</button></td>';
            html += '</tr>';
        });
        container.innerHTML = html + '</tbody></table>';
    } catch (err) { debug('❌ خطأ: ' + err.message, 'error'); }
}
async function loadOpTimelineTab(op) {
    try {
        var logs = (await supabase.from('operation_logs').select('*').eq('operation_id', op.id).order('created_at', {ascending: false})).data || [];
        var container = document.getElementById('opTimelineList');
        if (!container) return;
        if (logs.length === 0) { container.innerHTML = '<div class="empty-state">لا يوجد سجل</div>'; return; }
        var html = '<div class="timeline">';
        logs.forEach(function(log) { html += '<div class="timeline-item"><div class="timeline-time">' + new Date(log.created_at).toLocaleString('ar-EG') + '</div><div class="timeline-user">👤 ' + (log.user_email || 'مجهول') + '</div><div class="timeline-content"><strong>' + log.action + '</strong><p>' + log.description + '</p></div></div>'; });
        container.innerHTML = html + '</div>';
    } catch (err) { debug('❌ خطأ: ' + err.message, 'error'); }
}

// ============================================
// Transfers
// ============================================
async function loadTransfers() {
    debug('💸 بدأ loadTransfers', 'info');
    if (!supabase) return;
    try {
        var data = (await supabase.from('transfers').select('*,operations(name),investors(name)').order('transfer_date', {ascending: false})).data || [];
        var tableEl = document.getElementById('transfersTable');
        if (!tableEl) return;
        if (data.length === 0) { tableEl.innerHTML = '<div class="empty-state">لا يوجد تحويلات</div>'; return; }
        var pMap = {client_funding:'تمويل',client_repayment:'سداد',capital_return:'إرجاع رأس مال',profit_distribution:'توزيع أرباح',settlement:'تسوية',additional_funding:'تمويل إضافي',other:'أخرى'};
        var html = '<table><thead><tr><th>الرقم</th><th>النوع</th><th>الغرض</th><th>العملية</th><th>الممول/العميل</th><th>المبلغ</th><th>التاريخ</th>';
        if (canEdit()) html += '<th>الإجراءات</th>';
        html += '</tr></thead><tbody>';
        data.forEach(function(t) {
            var typeText = {company_to_client:'شركة→عميل',client_to_company:'عميل→شركة',company_to_investor:'شركة→ممول'}[t.type];
            var party = t.investor_id ? (t.investors ? t.investors.name : '-') : '-';
            html += '<tr><td>' + (t.reference_number || '-') + '</td><td>' + typeText + '</td><td>' + (pMap[t.purpose] || t.purpose) + '</td><td>' + (t.operations ? t.operations.name : '-') + '</td><td>' + (party || '-') + '</td><td>' + formatMoney(t.amount) + '</td><td>' + formatDate(t.transfer_date) + '</td>';
            if (canEdit()) html += '<td><button class="btn btn-danger btn-sm" onclick="confirmDeleteTransfer(\'' + t.id + '\',\'' + t.operation_id + '\',' + t.amount + ',\'' + (pMap[t.purpose] || t.purpose) + '\')">حذف</button></td>';
            html += '</tr>';
        });
        tableEl.innerHTML = html + '</tbody></table>';
        debug('✅ loadTransfers اكتمل', 'success');
    } catch (err) { debug('❌ خطأ: ' + err.message, 'error'); }
}
function toggleInvestorSelect() {
    var type = document.getElementById('transferType').value;
    var row = document.getElementById('investorSelectRow');
    if (type === 'company_to_investor') {
        row.style.display = 'grid';
        supabase.from('investors').select('*').then(function(res) {
            var data = res.data || [];
            var opts = '<option value="">اختر</option>';
            data.forEach(function(i) { if (!i.is_archived) opts += '<option value="' + i.id + '">' + i.name + '</option>'; });
            document.getElementById('transferInvestorId').innerHTML = opts;
        });
    } else { row.style.display = 'none'; }
}
async function openTransferModal() {
    if (!canEdit()) return;
    document.getElementById('transferId').value = '';
    document.getElementById('transferType').value = 'company_to_client';
    document.getElementById('transferPurpose').value = 'client_funding';
    document.getElementById('transferAmount').value = '';
    document.getElementById('transferDate').value = new Date().toISOString().split('T')[0];
    document.getElementById('transferNotes').value = '';
    document.getElementById('transferValidationWarning').innerHTML = '';
    toggleInvestorSelect();
    var ops = (await supabase.from('operations').select('*')).data || [];
    var opts = '<option value="">بدون عملية</option>';
    ops.forEach(function(o) { if (o.status !== 'cancelled' && !o.is_locked) opts += '<option value="' + o.id + '">' + (o.reference_number || '') + ' ' + o.name + ' (' + getStatusText(o.status) + ')</option>'; });
    document.getElementById('transferOperation').innerHTML = opts;
    document.getElementById('transferModal').classList.add('active');
}
function openAddTransferToOp() { if (!canEdit()) return; openTransferModal(); setTimeout(function() { document.getElementById('transferOperation').value = currentOpId; }, 100); }
function openWorkflowTransfer(purpose) {
    if (!canEdit() || currentOpData.is_locked) { showToast('لا يمكن', 'error'); return; }
    openTransferModal();
    setTimeout(function() {
        document.getElementById('transferOperation').value = currentOpId;
        document.getElementById('transferPurpose').value = purpose;
        if (purpose === 'client_repayment') document.getElementById('transferType').value = 'client_to_company';
        else if (purpose === 'profit_distribution' || purpose === 'capital_return') { document.getElementById('transferType').value = 'company_to_investor'; toggleInvestorSelect(); }
    }, 100);
}
document.getElementById('transferForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    if (!canEdit()) return;
    var amount = parseFloat(document.getElementById('transferAmount').value);
    var purpose = document.getElementById('transferPurpose').value;
    var opId = document.getElementById('transferOperation').value;
    if (amount <= 0) { showToast('❌ المبلغ > 0', 'error'); return; }
    var warns = [];
    if (purpose === 'profit_distribution' && opId) {
        var op = (await supabase.from('operations').select('*').eq('id', opId).single()).data;
        if (op) {
            if (!op.final_profit || op.final_profit <= 0) warns.push('❌ لم يدخل الربح النهائي');
            if (!op.profit_approval_date) warns.push('❌ لم يعتمد الربح');
            if (op.status !== 'active' && op.status !== 'completed') warns.push('❌ العملية يجب أن تكون نشطة أو منتهية');
        }
    }
    if ((purpose === 'capital_return' || purpose === 'profit_distribution') && opId) {
        var opSt = (await supabase.from('operations').select('status').eq('id', opId).single()).data;
        if (opSt && (opSt.status === 'draft' || opSt.status === 'cancelled')) warns.push('❌ لا يمكن التوزيع على عملية غير نشطة');
    }
    if (opId && purpose === 'client_repayment') {
        var opAmt = (await supabase.from('operations').select('amount').eq('id', opId).single()).data;
        if (opAmt) {
            var totRep = ((await supabase.from('transfers').select('amount').eq('operation_id', opId).eq('purpose', 'client_repayment')).data || []).reduce(function(s, t) { return s + parseFloat(t.amount || 0); }, 0);
            if (totRep + amount > parseFloat(opAmt.amount)) warns.push('❌ يتجاوز قيمة العملية');
        }
    }
    if (opId && purpose === 'capital_return') {
        var opInv = (await supabase.from('operation_investors').select('*').eq('operation_id', opId)).data || [];
        var totInv = opInv.reduce(function(s, oi) { return s + parseFloat(oi.contribution || 0); }, 0);
        var totRet = ((await supabase.from('transfers').select('amount').eq('operation_id', opId).eq('purpose', 'capital_return')).data || []).reduce(function(s, t) { return s + parseFloat(t.amount || 0); }, 0);
        if (totRet + amount > totInv) warns.push('❌ يتجاوز رأس المال المستثمر');
    }
    if (warns.length > 0) { document.getElementById('transferValidationWarning').innerHTML = '<div class="error-box">' + warns.join('<br>') + '</div>'; showToast('راجع التحذيرات', 'error'); return; }
    document.getElementById('transferValidationWarning').innerHTML = '';
    var invId = document.getElementById('transferType').value === 'company_to_investor' ? document.getElementById('transferInvestorId').value : null;
    var data = { type: document.getElementById('transferType').value, purpose: purpose, operation_id: opId || null, investor_id: invId, amount: amount, transfer_date: document.getElementById('transferDate').value, notes: document.getElementById('transferNotes').value };
    var count = (await supabase.from('transfers').select('id')).data || [];
    data.reference_number = generateReferenceNumber('TR', count.length + 1);
    var res = await supabase.from('transfers').insert(data).select();
    if (res.data && res.data[0]) {
        var pText = document.getElementById('transferPurpose').options[document.getElementById('transferPurpose').selectedIndex].text;
        var iName = invId ? document.getElementById('transferInvestorId').options[document.getElementById('transferInvestorId').selectedIndex].text : '';
        logActivity('إضافة تحويل', 'transfer', res.data[0].id, null, JSON.stringify(data), 'Amount: ' + formatMoney(amount) + ', Purpose: ' + pText);
        if (opId) await addLog(opId, 'تحويل مالي', 'تم تحويل ' + formatMoney(amount) + ' - ' + pText + ' ' + (iName ? 'لـ ' + iName : ''));
    }
    closeModal('transferModal'); loadTransfers(); if (currentOpId) await refreshOperationDetails(); showToast('تم الإضافة');
});
async function confirmDeleteTransfer(tId, opId, amount, purpose) {
    if (!canEdit()) return;
    if (confirm('حذف التحويل؟')) {
        var old = (await supabase.from('transfers').select('*').eq('id', tId).single()).data;
        if (opId) await addLog(opId, 'حذف تحويل', 'تم حذف ' + formatMoney(amount));
        await supabase.from('transfers').delete().eq('id', tId);
        logActivity('حذف تحويل', 'transfer', tId, JSON.stringify(old), null, 'Amount: ' + formatMoney(amount));
        if (opId) await refreshOperationDetails();
        loadTransfers(); showToast('تم الحذف');
    }
}
async function addLog(operation_id, action, description) {
    try { await supabase.from('operation_logs').insert({ operation_id: operation_id, action: action, description: description, user_email: currentUser ? currentUser.email : 'Unknown' }); }
    catch (e) { debug('⚠️ addLog Error: ' + e.message, 'warning'); }
}

// ============================================
// My Account
// ============================================
async function loadMyAccount() {
    debug('👤 بدأ loadMyAccount', 'info');
    var content = document.getElementById('myAccountContent');
    if (!content) return;
    if (isClient() && currentEntityId) {
        var client = (await supabase.from('clients').select('*').eq('id', currentEntityId).single()).data;
        if (!client) { content.innerHTML = '<div class="empty-state">لا توجد بيانات</div>'; return; }
        var ops = (await supabase.from('operations').select('*').eq('client_id', client.id)).data || [];
        var allTrans = (await supabase.from('transfers').select('*')).data || [];
        var totFund = ops.reduce(function(s, o) { return s + parseFloat(o.amount || 0); }, 0);
        var totRep = allTrans.filter(function(t) { return t.operation_id && ops.find(function(o) { return o.id === t.operation_id; }) && t.purpose === 'client_repayment'; }).reduce(function(s, t) { return s + parseFloat(t.amount || 0); }, 0) || 0;
        var bal = totRep - totFund;
        var html = '<div class="account-statement"><h2 style="margin-bottom:15px">👤 حسابي - ' + client.name + '</h2><div class="statement-header">';
        html += '<div class="statement-item"><label>إجمالي التمويلات</label><div class="value negative">' + formatMoney(totFund) + '</div></div>';
        html += '<div class="statement-item"><label>إجمالي المدفوع</label><div class="value positive">' + formatMoney(totRep) + '</div></div>';
        html += '<div class="statement-item"><label>الرصيد الحالي</label><div class="value ' + (bal >= 0 ? 'positive' : 'negative') + '">' + formatMoney(bal) + '</div></div></div>';
        html += '<h3 style="margin:15px 0 10px">📋 عملياتي</h3><div class="table-scroll"><table><thead><tr><th>الرقم</th><th>الاسم</th><th>المبلغ</th><th>الحالة</th></tr></thead><tbody>';
        ops.forEach(function(o) { html += '<tr><td>' + (o.reference_number || '-') + '</td><td>' + o.name + '</td><td>' + formatMoney(o.amount) + '</td><td><span class="badge badge-' + o.status + '">' + getStatusText(o.status) + '</span></td></tr>'; });
        html += '</tbody></table></div></div>';
        content.innerHTML = html;
    } else if (isInvestor() && currentEntityId) {
        var inv = (await supabase.from('investors').select('*').eq('id', currentEntityId).single()).data;
        if (!inv) { content.innerHTML = '<div class="empty-state">لا توجد بيانات</div>'; return; }
        var myC = (await supabase.from('operation_investors').select('*').eq('investor_id', inv.id)).data || [];
        var myTrans = (await supabase.from('transfers').select('*').eq('investor_id', inv.id)).data || [];
        var ops = (await supabase.from('operations').select('id,status')).data || [];
        var totCap = myC.reduce(function(s, c) { return s + parseFloat(c.contribution || 0); }, 0);
        var workCap = myC.filter(function(c) { var o = ops.find(function(x) { return x.id === c.operation_id; }); return o && (o.status === 'active' || o.status === 'draft'); }).reduce(function(s, c) { return s + parseFloat(c.contribution || 0); }, 0);
        var capRet = myTrans.filter(function(t) { return t.purpose === 'capital_return'; }).reduce(function(s, t) { return s + parseFloat(t.amount || 0); }, 0) || 0;
        var capPend = Math.max(0, (totCap - workCap) - capRet);
        var totProf = myC.reduce(function(s, c) { return s + parseFloat(c.profit || 0); }, 0);
        var profPaid = myTrans.filter(function(t) { return t.purpose === 'profit_distribution'; }).reduce(function(s, t) { return s + parseFloat(t.amount || 0); }, 0) || 0;
        var outProf = Math.max(0, totProf - profPaid);
        var html = '<div class="account-statement"><h2 style="margin-bottom:15px">💼 حسابي - ' + inv.name + '</h2><div class="statement-header">';
        html += '<div class="statement-item"><label>الكلي</label><div class="val">' + formatMoney(totCap) + '</div></div>';
        html += '<div class="statement-item"><label>المستثمر</label><div class="val negative">' + formatMoney(workCap) + '</div></div>';
        html += '<div class="statement-item"><label>المتاح</label><div class="val positive">' + formatMoney(capPend) + '</div></div>';
        html += '<div class="statement-item"><label>المُرجع</label><div class="val">' + formatMoney(capRet) + '</div></div>';
        html += '<div class="statement-item profit-field"><label>مستحقة</label><div class="val">' + (canViewProfits() ? formatMoney(outProf) : '<span class="hidden-profit">****</span>') + '</div></div>';
        html += '<div class="statement-item profit-field"><label>مصروفة</label><div class="val">' + (canViewProfits() ? formatMoney(profPaid) : '<span class="hidden-profit">****</span>') + '</div></div></div>';
        html += '<h3 style="margin:15px 0 10px">📋 مشاركاتي</h3><div class="table-scroll"><table><thead><tr><th>العملية</th><th>الحالة</th><th>المساهمة</th><th class="profit-field">الربح</th></tr></thead><tbody>';
        myC.forEach(function(oi) {
            var o = ops.find(function(x) { return x.id === oi.operation_id; });
            html += '<tr><td>' + (oi.operation_id || '-') + '</td><td><span class="badge badge-' + (o ? o.status : '') + '">' + getStatusText(o ? o.status : '') + '</span></td><td>' + formatMoney(oi.contribution) + '</td><td class="profit-field">' + (canViewProfits() ? formatMoney(oi.profit) : '<span class="hidden-profit">****</span>') + '</td></tr>';
        });
        html += '</tbody></table></div></div>';
        content.innerHTML = html;
    } else {
        content.innerHTML = '<div class="empty-state">لا توجد بيانات حسابية</div>';
    }
    debug('✅ loadMyAccount اكتمل', 'success');
}

// ============================================
// Initialization
// ============================================
debug('🚀 بدأ تحميل الصفحة', 'success');
if (typeof window.supabase === 'undefined') {
    debug('❌ مكتبة Supabase لم تُحمّل!', 'error');
} else {
    debug('✅ مكتبة Supabase موجودة', 'success');
}
try {
    if (typeof window.supabase !== 'undefined') {
        supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        debug('✅ تم إنشاء Supabase Client', 'success');
    }
} catch (err) { debug('❌ خطأ في createClient: ' + err.message, 'error'); }

if (supabase) {
    debug('🔍 جاري التحقق من الجلسة...', 'info');
    supabase.auth.getSession().then(function(result) {
        var session = result.data ? result.data.session : null;
        debug('📋 Session: ' + (session ? 'موجود' : 'غير موجود'), session ? 'success' : 'info');
        if (session) { currentUser = session.user; loadUserProfile().then(function() { showApp(); }); }
    }).catch(function(err) { debug('❌ خطأ في getSession: ' + err.message, 'error'); });
}
debug('✅ النظام جاهز تماماً', 'success');
