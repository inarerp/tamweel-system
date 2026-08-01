// ============================================
// Configuration
// ============================================
var SUPABASE_URL = 'https://znkexrtkqzmsqnmzvxoq.supabase.co';
var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inpua2V4cnRrcXptc3FubXp2eG9xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU0MTc3NDYsImV4cCI6MjEwMDk5Mzc0Nn0.QyPjqtKy0dS-uoXiefiPfXURnBqR_FBJcZMpGWj_1Rs';

// ============================================
// Global Variables
// ============================================
var supabase;
var currentUser = null;
var userRole = 'admin';
var userPermission = 'admin';
var currentOpId = null;
var currentOpData = null;
var currentEntityId = null;

// ============================================
// Debug System
// ============================================
var DEBUG_MODE = true;
var debugMessages = [];
var currentScreen = 'dashboard';
var lastSuccess = '';
var lastError = '';

function debug(msg, type) {
    type = type || 'info';
    if (!DEBUG_MODE) return;
    var time = new Date().toLocaleTimeString('ar-EG');
    var fullMsg = '[' + time + '] [' + currentScreen + '] ' + msg;
    debugMessages.push({msg: msg, type: type, time: time, screen: currentScreen});
    var debugContent = document.getElementById('debugContent');
    if (debugContent) {
        var line = document.createElement('div');
        line.className = 'debug-line debug-' + type;
        line.textContent = fullMsg;
        debugContent.appendChild(line);
        var debugBox = document.getElementById('debugBox');
        if (debugBox) debugBox.scrollTop = debugBox.scrollHeight;
    }
    if (type === 'success') lastSuccess = msg;
    if (type === 'error') lastError = msg;
}

function logError(funcName, errorMsg, details) {
    details = details || {};
    var msg = '❌ [' + funcName + '] ' + errorMsg;
    if (details.query) msg += ' | Query: ' + details.query;
    if (details.data) msg += ' | Data: ' + JSON.stringify(details.data).substring(0, 100);
    if (details.response) msg += ' | Response: ' + JSON.stringify(details.response).substring(0, 100);
    if (details.user) msg += ' | User: ' + details.user;
    debug(msg, 'error');
    console.error(msg);
}

function toggleDebug() {
    DEBUG_MODE = !DEBUG_MODE;
    document.getElementById('debugStatus').textContent = DEBUG_MODE ? '[مفعّل]' : '[متوقف]';
    document.getElementById('debugStatus').style.color = DEBUG_MODE ? '#4caf50' : '#f44336';
    debug('Debug Mode: ' + (DEBUG_MODE ? 'ON' : 'OFF'), 'info');
}

function clearDebugLog() {
    debugMessages = [];
    document.getElementById('debugContent').innerHTML = '';
    debug('تم مسح السجل', 'info');
}

function copyDebugLog() {
    var text = debugMessages.map(function(m) { return '[' + m.time + '] [' + m.screen + '] ' + m.msg; }).join('\n');
    if (navigator.clipboard) {
        navigator.clipboard.writeText(text).then(function() { debug('✅ تم نسخ السجل', 'success'); }).catch(function() { debug('❌ فشل النسخ', 'error'); });
    }
}

window.onerror = function(message, source, line, col, error) {
    debug('❌ JavaScript Error: ' + message + ' (Line: ' + line + ', Col: ' + col + ')', 'error');
    if (error && error.stack) debug('Stack: ' + error.stack.substring(0, 200), 'error');
    return true;
};

window.onunhandledrejection = function(event) {
    debug('❌ Promise Error: ' + event.reason, 'error');
};

debug('🚀 بدأ تحميل الصفحة', 'success');

// ============================================
// Utility Functions
// ============================================
function showToast(msg, type) {
    type = type || 'success';
    var t = document.getElementById('toast');
    t.textContent = msg;
    t.className = 'toast show ' + type;
    setTimeout(function() { t.className = 'toast'; }, 3000);
}

function formatMoney(n) {
    return (parseFloat(n) || 0).toLocaleString('ar-EG', {minimumFractionDigits: 2, maximumFractionDigits: 2}) + ' ج.م';
}

function formatDate(d) {
    if (!d) return '-';
    return new Date(d).toLocaleDateString('ar-EG');
}

function getStatusText(status) {
    var map = {draft:'تحت الإنشاء',active:'نشطة',completed:'انتهت',cancelled:'ألغيت',locked:'مقفلة',inactive:'غير نشط'};
    return map[status] || status;
}

function closeModal(id) {
    document.getElementById(id).classList.remove('active');
}

function generateReferenceNumber(prefix, count) {
    return prefix + '-' + String(count).padStart(4, '0');
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
        errorMsg.textContent = '⚠️ يرجى إدخال البريد الإلكتروني وكلمة المرور';
        errorMsg.style.display = 'block';
        debug('⚠️ بيانات ناقصة', 'warning');
        return;
    }

    errorMsg.style.display = 'none';
    debug('📧 Email: ' + email, 'info');

    supabase.auth.signInWithPassword({email: email, password: password}).then(function(result) {
        var data = result.data;
        var error = result.error;
        if (error) {
            debug('❌ فشل تسجيل الدخول: ' + error.message, 'error');
            errorMsg.textContent = '❌ ' + error.message;
            errorMsg.style.display = 'block';
            return;
        }

        debug('✅ تم تسجيل الدخول بنجاح', 'success');
        currentUser = data.user;
        logActivity('تسجيل دخول', 'auth', currentUser.id, null, null, 'User: ' + currentUser.email);
        loadUserProfile().then(function() { showApp(); });
    }).catch(function(err) {
        debug('❌ Exception في signInWithPassword: ' + err.message, 'error');
        errorMsg.textContent = '❌ ' + err.message;
        errorMsg.style.display = 'block';
    });
}

function doLogout() {
    if (currentUser) {
        logActivity('تسجيل خروج', 'auth', currentUser.id, null, null, 'User: ' + currentUser.email);
    }
    supabase.auth.signOut().then(function() { location.reload(); });
}

function loadUserProfile() {
    return new Promise(function(resolve) {
        if (!currentUser) { resolve(); return; }
        supabase.from('user_profiles').select('role,entity_id,permission').eq('id', currentUser.id).maybeSingle().then(function(result) {
            var profile = result.data;
            var error = result.error;
            if (error) {
                debug('⚠️ خطأ في profile: ' + error.message, 'warning');
                userRole = 'admin';
                userPermission = 'admin';
            } else if (profile) {
                userRole = profile.role || 'admin';
                userPermission = profile.permission || 'admin';
                currentEntityId = profile.entity_id;
                debug('👤 Role: ' + userRole + ', Permission: ' + userPermission, 'success');
            } else {
                userRole = 'admin';
                userPermission = 'admin';
            }
            resolve();
        }).catch(function(err) {
            debug('❌ Exception في profile: ' + err.message, 'error');
            userRole = 'admin';
            userPermission = 'admin';
            resolve();
        });
    });
}

// ============================================
// Permissions
// ============================================
function canEdit() { return userPermission === 'admin'; }
function canViewProfits() { return userPermission !== 'viewer'; }
function isAdmin() { return userPermission === 'admin'; }
function isViewer() { return userPermission === 'viewer'; }
function isClient() { return userRole === 'client'; }
function isInvestor() { return userRole === 'investor'; }

function hideProfits() {
    var elements = document.querySelectorAll('.profit-field');
    for (var i = 0; i < elements.length; i++) elements[i].style.display = 'none';
    var profitElements = document.querySelectorAll('.profit-value');
    for (var i = 0; i < profitElements.length; i++) profitElements[i].innerHTML = '<span class="hidden-profit">****</span>';
}

function applyPermissions() {
    debug('🔐 تطبيق الصلاحيات: ' + userPermission, 'info');
    if (userPermission !== 'admin') {
        var adminElements = document.querySelectorAll('.admin-only');
        for (var i = 0; i < adminElements.length; i++) adminElements[i].style.display = 'none';
    }
    if (isViewer()) {
        hideProfits();
        document.querySelectorAll('.nav-clients, .nav-investors, .nav-operations, .nav-transfers').forEach(function(el) { el.style.display = 'none'; });
        document.querySelector('.nav-myaccount').style.display = 'inline-block';
    } else if (isClient()) {
        hideProfits();
        document.querySelectorAll('.nav-clients, .nav-investors, .nav-operations, .nav-transfers').forEach(function(el) { el.style.display = 'none'; });
        document.querySelector('.nav-myaccount').style.display = 'inline-block';
    } else if (isInvestor()) {
        hideProfits();
        document.querySelectorAll('.nav-clients, .nav-operations, .nav-transfers').forEach(function(el) { el.style.display = 'none'; });
        document.querySelector('.nav-myaccount').style.display = 'inline-block';
    }
    if (isAdmin()) {
        document.querySelector('.nav-activity').style.display = 'inline-block';
    }
}

// ============================================
// Activity Log
// ============================================
function logActivity(action, entityType, entityId, oldValue, newValue, details) {
    var data = {
        user_email: currentUser ? currentUser.email : 'Unknown',
        action: action,
        entity_type: entityType || null,
        entity_id: entityId ? String(entityId) : null,
        old_value: oldValue ? String(oldValue) : null,
        new_value: newValue ? String(newValue) : null,
        details: details || null
    };
    supabase.from('activity_logs').insert(data).then(function(result) {
        if (result.error) debug('⚠️ خطأ في logActivity: ' + result.error.message, 'warning');
    }).catch(function(err) {
        debug('⚠️ Exception في logActivity: ' + err.message, 'warning');
    });
}

async function loadActivityLog() {
    debug('📜 بدأ loadActivityLog', 'info');
    try {
        var result = await supabase.from('activity_logs').select('*').order('created_at', {ascending: false}).limit(100);
        var data = result.data || [];
        if (result.error) { debug('❌ خطأ: ' + result.error.message, 'error'); return; }
        var html = '<table><thead><tr><th>الوقت</th><th>المستخدم</th><th>العملية</th><th>النوع</th><th>التفاصيل</th></tr></thead><tbody>';
        data.forEach(function(log) {
            html += '<tr><td>' + new Date(log.created_at).toLocaleString('ar-EG') + '</td><td>' + (log.user_email || '-') + '</td><td><strong>' + log.action + '</strong></td><td>' + (log.entity_type || '-') + '</td><td>' + (log.details || '-') + '</td></tr>';
        });
        html += '</tbody></table>';
        document.getElementById('activityLogTable').innerHTML = html;
        debug('✅ loadActivityLog اكتمل (' + data.length + ')', 'success');
    } catch (err) { debug('❌ خطأ: ' + err.message, 'error'); }
}

// ============================================
// Dashboard
// ============================================
async function loadDashboard() {
    debug('📊 بدأ loadDashboard', 'info');
    try {
        var opsResult = await supabase.from('operations').select('*');
        var ops = opsResult.data || [];
        if (opsResult.error) debug('❌ خطأ في operations: ' + opsResult.error.message, 'error');
        
        var opInvResult = await supabase.from('operation_investors').select('*');
        var opInvestors = opInvResult.data || [];
        
        var transResult = await supabase.from('transfers').select('*');
        var transfers = transResult.data || [];
        
        var invResult = await supabase.from('investors').select('*');
        var investors = invResult.data || [];
        
        var clientsResult = await supabase.from('clients').select('*');
        var clients = clientsResult.data || [];

        var today = new Date().toISOString().split('T')[0];
        var next30Days = new Date(Date.now() + 30*24*60*60*1000).toISOString().split('T')[0];

        var totalActiveFunding = 0, totalOutstandingCapital = 0, totalOutstandingInvestorProfit = 0;
        var operationsEndingSoon = 0, overdueOperations = 0, completedOperations = 0;
        var alerts = [];

        ops.forEach(function(op) {
            if (op.status === 'active') {
                totalActiveFunding += parseFloat(op.amount || 0);
                var repaid = transfers.filter(function(t) { return t.operation_id === op.id && t.purpose === 'client_repayment'; }).reduce(function(s, t) { return s + parseFloat(t.amount || 0); }, 0) || 0;
                totalOutstandingCapital += Math.max(0, parseFloat(op.amount || 0) - repaid);
                var opInv = opInvestors.filter(function(oi) { return oi.operation_id === op.id; }) || [];
                var totalInvProfit = opInv.reduce(function(s, oi) { return s + parseFloat(oi.profit || 0); }, 0);
                var distributedProfit = transfers.filter(function(t) { return t.operation_id === op.id && t.purpose === 'profit_distribution'; }).reduce(function(s, t) { return s + parseFloat(t.amount || 0); }, 0) || 0;
                totalOutstandingInvestorProfit += Math.max(0, totalInvProfit - distributedProfit);
                if (op.end_date && op.end_date <= next30Days && op.end_date >= today) {
                    operationsEndingSoon++;
                    alerts.push({type: 'warning', msg: '⚠️ عملية "' + op.name + '" ستنتهي قريباً (' + formatDate(op.end_date) + ')'});
                }
                if (op.end_date && op.end_date < today) {
                    overdueOperations++;
                    alerts.push({type: 'danger', msg: '🚨 عملية "' + op.name + '" متأخرة (كان يجب أن تنتهي ' + formatDate(op.end_date) + ')'});
                }
                if (op.status === 'active' && op.final_profit && !op.profit_approval_date) {
                    alerts.push({type: 'warning', msg: '⚠️ عملية "' + op.name + '" انتهت ولم يُعتمد الربح بعد'});
                }
            }
            if (op.status === 'completed') completedOperations++;
        });

        investors.forEach(function(inv) {
            var myContribs = opInvestors.filter(function(oi) { return oi.investor_id === inv.id; }) || [];
            var totalProfit = myContribs.reduce(function(s, c) { return s + parseFloat(c.profit || 0); }, 0);
            var profitPaid = transfers.filter(function(t) { return t.investor_id === inv.id && t.purpose === 'profit_distribution'; }).reduce(function(s, t) { return s + parseFloat(t.amount || 0); }, 0) || 0;
            if (totalProfit - profitPaid > 0) {
                alerts.push({type: 'warning', msg: '💰 الممول "' + inv.name + '" له أرباح مستحقة: ' + formatMoney(totalProfit - profitPaid)});
            }
        });

        clients.forEach(function(client) {
            var clientOps = ops.filter(function(o) { return o.client_id === client.id; });
            var totalFunded = clientOps.reduce(function(s, o) { return s + parseFloat(o.amount || 0); }, 0);
            var totalRepaid = transfers.filter(function(t) { return t.operation_id && ops.find(function(o) { return o.id === t.operation_id && o.client_id === client.id; }) && t.purpose === 'client_repayment'; }).reduce(function(s, t) { return s + parseFloat(t.amount || 0); }, 0) || 0;
            var balance = totalRepaid - totalFunded;
            if (balance > 0) {
                alerts.push({type: 'info', msg: '💵 العميل "' + client.name + '" لديه رصيد غير مستخدم: ' + formatMoney(balance)});
            }
        });

        var alertsHtml = '';
        if (alerts.length > 0) {
            alertsHtml = '<div style="margin-bottom:20px">';
            alerts.forEach(function(a) {
                alertsHtml += '<div class="alert-box ' + a.type + '">' + a.msg + '</div>';
            });
            alertsHtml += '</div>';
        }
        document.getElementById('dashboardAlerts').innerHTML = alertsHtml;

        document.getElementById('dashboardStats').innerHTML = 
            '<div class="stat-card"><h3>التمويل النشط</h3><div class="value blue">' + formatMoney(totalActiveFunding) + '</div></div>' +
            '<div class="stat-card"><h3>رأس المال outstanding</h3><div class="value orange">' + formatMoney(totalOutstandingCapital) + '</div></div>' +
            '<div class="stat-card profit-field"><h3>أرباح مستحقة</h3><div class="value red">' + (canViewProfits() ? formatMoney(totalOutstandingInvestorProfit) : '<span class="hidden-profit">****</span>') + '</div></div>' +
            '<div class="stat-card"><h3>تنتهي قريباً</h3><div class="value">' + operationsEndingSoon + '</div></div>' +
            '<div class="stat-card"><h3>متأخرة</h3><div class="value red">' + overdueOperations + '</div></div>' +
            '<div class="stat-card"><h3>مكتملة</h3><div class="value green">' + completedOperations + '</div></div>' +
            '<div class="stat-card"><h3>إجمالي العمليات</h3><div class="value">' + ops.length + '</div></div>' +
            '<div class="stat-card"><h3>العملاء</h3><div class="value">' + clients.length + '</div></div>' +
            '<div class="stat-card"><h3>الممولين</h3><div class="value">' + investors.length + '</div></div>';
        
        debug('✅ loadDashboard اكتمل', 'success');
    } catch (err) { debug('❌ خطأ في loadDashboard: ' + err.message, 'error'); }
}

// ============================================
// My Account
// ============================================
async function loadMyAccount() {
    debug('👤 بدأ loadMyAccount', 'info');
    var content = document.getElementById('myAccountContent');
    
    if (isClient() && currentEntityId) {
        var clientResult = await supabase.from('clients').select('*').eq('id', currentEntityId).single();
        var client = clientResult.data;
        if (!client) { content.innerHTML = '<div class="empty-state">لم يتم العثور على بيانات العميل</div>'; return; }
        
        var opsResult = await supabase.from('operations').select('*').eq('client_id', client.id);
        var ops = opsResult.data || [];
        var transResult = await supabase.from('transfers').select('*');
        var allTransfers = transResult.data || [];
        
        var totalFunded = ops.reduce(function(s, o) { return s + parseFloat(o.amount || 0); }, 0);
        var totalRepaid = allTransfers.filter(function(t) { return t.operation_id && ops.find(function(o) { return o.id === t.operation_id; }) && t.purpose === 'client_repayment'; }).reduce(function(s, t) { return s + parseFloat(t.amount || 0); }, 0) || 0;
        var balance = totalRepaid - totalFunded;
        
        var html = '<div class="account-statement"><h2 style="margin-bottom:20px">👤 حسابي - ' + client.name + '</h2>';
        html += '<div class="statement-header">';
        html += '<div class="statement-item"><label>إجمالي التمويلات</label><div class="value negative">' + formatMoney(totalFunded) + '</div></div>';
        html += '<div class="statement-item"><label>إجمالي المدفوع</label><div class="value positive">' + formatMoney(totalRepaid) + '</div></div>';
        html += '<div class="statement-item"><label>الرصيد الحالي لدى الشركة</label><div class="value ' + (balance >= 0 ? 'positive' : 'negative') + '">' + formatMoney(balance) + '</div></div></div>';
        
        html += '<h3 style="margin:20px 0 10px">📋 عملياتي</h3><div class="table-scroll"><table><thead><tr><th>الرقم</th><th>الاسم</th><th>المبلغ</th><th>الحالة</th><th>البداية</th><th>النهاية</th></tr></thead><tbody>';
        ops.forEach(function(o) {
            html += '<tr><td>' + (o.reference_number || '-') + '</td><td>' + o.name + '</td><td>' + formatMoney(o.amount) + '</td><td><span class="badge badge-' + o.status + '">' + getStatusText(o.status) + '</span></td><td>' + formatDate(o.start_date) + '</td><td>' + formatDate(o.end_date) + '</td></tr>';
        });
        html += '</tbody></table></div>';
        
        html += '<h3 style="margin:20px 0 10px">💸 تحويلاتي</h3><div class="table-scroll"><table><thead><tr><th>الرقم</th><th>النوع</th><th>الغرض</th><th>المبلغ</th><th>التاريخ</th></tr></thead><tbody>';
        var myTransfers = allTransfers.filter(function(t) { return t.operation_id && ops.find(function(o) { return o.id === t.operation_id; }); });
        myTransfers.forEach(function(t) {
            var typeText = {company_to_client:'شركة→عميل',client_to_company:'عميل→شركة',company_to_investor:'شركة→ممول'}[t.type];
            var purposeMap = {client_funding:'تمويل',client_repayment:'سداد',capital_return:'إرجاع رأس مال',profit_distribution:'توزيع أرباح',settlement:'تسوية',additional_funding:'تمويل إضافي',other:'أخرى'};
            html += '<tr><td>' + (t.reference_number || '-') + '</td><td>' + typeText + '</td><td>' + (purposeMap[t.purpose] || t.purpose) + '</td><td>' + formatMoney(t.amount) + '</td><td>' + formatDate(t.transfer_date) + '</td></tr>';
        });
        html += '</tbody></table></div></div>';
        content.innerHTML = html;
        
    } else if (isInvestor() && currentEntityId) {
        var invResult = await supabase.from('investors').select('*').eq('id', currentEntityId).single();
        var inv = invResult.data;
        if (!inv) { content.innerHTML = '<div class="empty-state">لم يتم العثور على بيانات الممول</div>'; return; }
        
        var opInvResult = await supabase.from('operation_investors').select('*').eq('investor_id', inv.id);
        var myContribs = opInvResult.data || [];
        var transResult = await supabase.from('transfers').select('*').eq('investor_id', inv.id);
        var myTransfers = transResult.data || [];
        var opsResult = await supabase.from('operations').select('id,status');
        var ops = opsResult.data || [];
        
        var totalCapital = myContribs.reduce(function(s, c) { return s + parseFloat(c.contribution || 0); }, 0);
        var workingCapital = myContribs.filter(function(c) { var op = ops.find(function(o) { return o.id === c.operation_id; }); return op && (op.status === 'active' || op.status === 'draft'); }).reduce(function(s, c) { return s + parseFloat(c.contribution || 0); }, 0);
        var capitalReturned = myTransfers.filter(function(t) { return t.purpose === 'capital_return'; }).reduce(function(s, t) { return s + parseFloat(t.amount || 0); }, 0) || 0;
        var capitalPendingReturn = Math.max(0, (totalCapital - workingCapital) - capitalReturned);
        var totalProfit = myContribs.reduce(function(s, c) { return s + parseFloat(c.profit || 0); }, 0);
        var profitPaid = myTransfers.filter(function(t) { return t.purpose === 'profit_distribution'; }).reduce(function(s, t) { return s + parseFloat(t.amount || 0); }, 0) || 0;
        var outstandingProfit = Math.max(0, totalProfit - profitPaid);
        var currentBalance = capitalPendingReturn + outstandingProfit;
        
        var html = '<div class="account-statement"><h2 style="margin-bottom:20px">💼 حسابي - ' + inv.name + '</h2>';
        html += '<div class="statement-header">';
        html += '<div class="statement-item"><label>رأس المال الكلي</label><div class="value">' + formatMoney(totalCapital) + '</div></div>';
        html += '<div class="statement-item"><label>رأس المال المستثمر</label><div class="value negative">' + formatMoney(workingCapital) + '</div></div>';
        html += '<div class="statement-item"><label>رأس المال المتاح</label><div class="value positive">' + formatMoney(capitalPendingReturn) + '</div></div>';
        html += '<div class="statement-item"><label>رأس المال المُرجع</label><div class="value">' + formatMoney(capitalReturned) + '</div></div>';
        html += '<div class="statement-item profit-field"><label>الأرباح المستحقة</label><div class="value">' + (canViewProfits() ? formatMoney(outstandingProfit) : '<span class="hidden-profit">****</span>') + '</div></div>';
        html += '<div class="statement-item profit-field"><label>الأرباح المصروفة</label><div class="value">' + (canViewProfits() ? formatMoney(profitPaid) : '<span class="hidden-profit">****</span>') + '</div></div>';
        html += '<div class="statement-item"><label>الرصيد الحالي</label><div class="value positive">' + formatMoney(currentBalance) + '</div></div></div>';
        
        html += '<h3 style="margin:20px 0 10px">📋 العمليات التي شاركت فيها</h3><div class="table-scroll"><table><thead><tr><th>العملية</th><th>الحالة</th><th>المساهمة</th><th class="profit-field">الربح</th></tr></thead><tbody>';
        myContribs.forEach(function(oi) {
            var op = ops.find(function(o) { return o.id === oi.operation_id; });
            html += '<tr><td>' + (oi.operation_id || '-') + '</td><td><span class="badge badge-' + (op ? op.status : '') + '">' + getStatusText(op ? op.status : '') + '</span></td><td>' + formatMoney(oi.contribution) + '</td><td class="profit-field">' + (canViewProfits() ? formatMoney(oi.profit) : '<span class="hidden-profit">****</span>') + '</td></tr>';
        });
        html += '</tbody></table></div>';
        
        html += '<h3 style="margin:20px 0 10px">💸 تحويلاتي</h3><div class="table-scroll"><table><thead><tr><th>الرقم</th><th>الغرض</th><th>المبلغ</th><th>التاريخ</th></tr></thead><tbody>';
        var purposeMap = {client_funding:'تمويل',client_repayment:'سداد',capital_return:'إرجاع رأس مال',profit_distribution:'توزيع أرباح',settlement:'تسوية',additional_funding:'تمويل إضافي',other:'أخرى'};
        myTransfers.forEach(function(t) {
            html += '<tr><td>' + (t.reference_number || '-') + '</td><td>' + (purposeMap[t.purpose] || t.purpose) + '</td><td>' + formatMoney(t.amount) + '</td><td>' + formatDate(t.transfer_date) + '</td></tr>';
        });
        html += '</tbody></table></div></div>';
        content.innerHTML = html;
        
    } else {
        content.innerHTML = '<div class="empty-state">لا توجد بيانات حسابية</div>';
    }
    debug('✅ loadMyAccount اكتمل', 'success');
}

// ============================================
// Clients
// ============================================
async function loadClients() {
    debug('👥 بدأ loadClients', 'info');
    try {
        var result = await supabase.from('clients').select('*').order('created_at', {ascending: false});
        var data = result.data || [];
        if (result.error) { debug('❌ خطأ: ' + result.error.message, 'error'); return; }
        if (data.length === 0) { document.getElementById('clientsTable').innerHTML = '<div class="empty-state">لا يوجد عملاء</div>'; return; }
        var html = '<table><thead><tr><th>الرقم</th><th>الاسم</th><th>الهاتف</th><th>البريد</th><th>الحالة</th>';
        if (canEdit()) html += '<th>الإجراءات</th>';
        html += '</tr></thead><tbody>';
        data.forEach(function(c) {
            html += '<tr><td>' + (c.reference_number || '-') + '</td><td><strong>' + c.name + '</strong></td><td>' + (c.phone || '-') + '</td><td>' + (c.email || '-') + '</td><td>' + (c.is_archived ? '<span class="badge badge-inactive">أرشيف</span>' : '<span class="badge badge-active">نشط</span>') + '</td>';
            if (canEdit()) {
                html += '<td class="actions-cell">';
                if (!c.is_archived) {
                    html += '<button class="btn btn-secondary btn-sm" onclick="editClient(\'' + c.id + '\')">تعديل</button>';
                    html += '<button class="btn btn-warning btn-sm" onclick="archiveClient(\'' + c.id + '\')">أرشفة</button>';
                }
                html += '</td>';
            }
            html += '</tr>';
        });
        html += '</tbody></table>';
        document.getElementById('clientsTable').innerHTML = html;
        debug('✅ loadClients اكتمل (' + data.length + ')', 'success');
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
    if (!canEdit()) { showToast('❌ لا توجد صلاحية', 'error'); return; }
    var id = document.getElementById('clientId').value;
    var data = {
        name: document.getElementById('clientName').value,
        phone: document.getElementById('clientPhone').value,
        email: document.getElementById('clientEmail').value,
        address: document.getElementById('clientAddress').value,
        notes: document.getElementById('clientNotes').value
    };
    if (id) {
        var oldResult = await supabase.from('clients').select('*').eq('id', id).single();
        await supabase.from('clients').update(data).eq('id', id);
        logActivity('تعديل عميل', 'client', id, JSON.stringify(oldResult.data), JSON.stringify(data), 'Name: ' + data.name);
        debug('✅ تم تحديث العميل', 'success');
    } else {
        var countResult = await supabase.from('clients').select('id');
        var refNum = generateReferenceNumber('CL', (countResult.data || []).length + 1);
        data.reference_number = refNum;
        await supabase.from('clients').insert(data);
        logActivity('إضافة عميل', 'client', null, null, JSON.stringify(data), 'Name: ' + data.name + ', Ref: ' + refNum);
        debug('✅ تم إضافة العميل', 'success');
    }
    closeModal('clientModal');
    loadClients();
    showToast('تم الحفظ');
});

async function editClient(id) {
    if (!canEdit()) return;
    var result = await supabase.from('clients').select('*').eq('id', id).single();
    if (result.data) openClientModal(result.data);
}

async function archiveClient(id) {
    if (!canEdit()) return;
    if (confirm('هل تريد أرشفة هذا العميل؟')) {
        await supabase.from('clients').update({is_archived: true}).eq('id', id);
        logActivity('أرشفة عميل', 'client', id, 'نشط', 'أرشيف', null);
        loadClients();
        showToast('تمت الأرشفة');
        debug('📁 تم أرشفة العميل', 'info');
    }
}

// ============================================
// Investors
// ============================================
async function loadInvestors() {
    debug('💰 بدأ loadInvestors', 'info');
    try {
        var invResult = await supabase.from('investors').select('*').order('created_at', {ascending: false});
        var data = invResult.data || [];
        if (invResult.error) { debug('❌ خطأ: ' + invResult.error.message, 'error'); return; }
        if (data.length === 0) { document.getElementById('investorsTable').innerHTML = '<div class="empty-state">لا يوجد ممولين</div>'; return; }
        var opInvResult = await supabase.from('operation_investors').select('*');
        var opInvestors = opInvResult.data || [];
        var transResult = await supabase.from('transfers').select('*');
        var transfers = transResult.data || [];
        var opsResult = await supabase.from('operations').select('id,status');
        var ops = opsResult.data || [];
        
        var html = '<table><thead><tr><th>الرقم</th><th>الاسم</th><th>الهاتف</th><th>الكلي</th><th>المستثمر</th><th>المُرجع</th><th>المتبقي</th><th class="profit-field">أرباح مستحقة</th><th class="profit-field">الرصيد</th><th>الحالة</th>';
        if (canEdit()) html += '<th>الإجراءات</th>';
        html += '</tr></thead><tbody>';
        data.forEach(function(inv) {
            var myContribs = opInvestors.filter(function(oi) { return oi.investor_id === inv.id; }) || [];
            var totalCapital = myContribs.reduce(function(s, c) { return s + parseFloat(c.contribution || 0); }, 0);
            var workingCapital = myContribs.filter(function(c) { var op = ops.find(function(o) { return o.id === c.operation_id; }); return op && (op.status === 'active' || op.status === 'draft'); }).reduce(function(s, c) { return s + parseFloat(c.contribution || 0); }, 0);
            var capitalReturned = transfers.filter(function(t) { return t.investor_id === inv.id && t.purpose === 'capital_return'; }).reduce(function(s, t) { return s + parseFloat(t.amount || 0); }, 0) || 0;
            var capitalPendingReturn = Math.max(0, (totalCapital - workingCapital) - capitalReturned);
            var totalProfit = myContribs.reduce(function(s, c) { return s + parseFloat(c.profit || 0); }, 0);
            var profitPaid = transfers.filter(function(t) { return t.investor_id === inv.id && t.purpose === 'profit_distribution'; }).reduce(function(s, t) { return s + parseFloat(t.amount || 0); }, 0) || 0;
            var outstandingProfit = Math.max(0, totalProfit - profitPaid);
            var currentBalance = capitalPendingReturn + outstandingProfit;
            html += '<tr><td>' + (inv.reference_number || '-') + '</td><td><strong style="cursor:pointer;color:#667eea" onclick="openInvestorDetail(\'' + inv.id + '\')">' + inv.name + '</strong></td><td>' + (inv.phone || '-') + '</td><td>' + formatMoney(totalCapital) + '</td><td>' + formatMoney(workingCapital) + '</td><td>' + formatMoney(capitalReturned) + '</td><td>' + formatMoney(capitalPendingReturn) + '</td><td class="profit-field">' + (canViewProfits() ? formatMoney(outstandingProfit) : '<span class="hidden-profit">****</span>') + '</td><td class="profit-field"><strong>' + (canViewProfits() ? formatMoney(currentBalance) : '<span class="hidden-profit">****</span>') + '</strong></td><td>' + (inv.is_archived ? '<span class="badge badge-inactive">أرشيف</span>' : '<span class="badge badge-active">نشط</span>') + '</td>';
            if (canEdit()) {
                html += '<td class="actions-cell">';
                if (!inv.is_archived) {
                    html += '<button class="btn btn-secondary btn-sm" onclick="editInvestor(\'' + inv.id + '\')">تعديل</button>';
                    html += '<button class="btn btn-warning btn-sm" onclick="archiveInvestor(\'' + inv.id + '\')">أرشفة</button>';
                }
                html += '</td>';
            }
            html += '</tr>';
        });
        html += '</tbody></table>';
        document.getElementById('investorsTable').innerHTML = html;
        debug('✅ loadInvestors اكتمل (' + data.length + ')', 'success');
    } catch (err) { debug('❌ خطأ: ' + err.message, 'error'); }
}

async function openInvestorDetail(invId) {
    try {
        var invResult = await supabase.from('investors').select('*').eq('id', invId).single();
        var inv = invResult.data;
        if (!inv) return;
        document.getElementById('investorDetailName').textContent = 'تفاصيل: ' + inv.name;
        var opInvResult = await supabase.from('operation_investors').select('*,operations(name,status,amount)').eq('investor_id', invId);
        var opInvestors = opInvResult.data || [];
        var transResult = await supabase.from('transfers').select('*').eq('investor_id', invId);
        var transfers = transResult.data || [];
        var opsResult = await supabase.from('operations').select('id,status');
        var ops = opsResult.data || [];
        
        var myContribs = opInvestors.filter(function(oi) { return oi.investor_id === invId; }) || [];
        var totalCapital = myContribs.reduce(function(s, c) { return s + parseFloat(c.contribution || 0); }, 0);
        var workingCapital = myContribs.filter(function(c) { var op = ops.find(function(o) { return o.id === c.operation_id; }); return op && (op.status === 'active' || op.status === 'draft'); }).reduce(function(s, c) { return s + parseFloat(c.contribution || 0); }, 0);
        var capitalReturned = transfers.filter(function(t) { return t.investor_id === invId && t.purpose === 'capital_return'; }).reduce(function(s, t) { return s + parseFloat(t.amount || 0); }, 0) || 0;
        var capitalPendingReturn = Math.max(0, (totalCapital - workingCapital) - capitalReturned);
        var totalProfit = myContribs.reduce(function(s, c) { return s + parseFloat(c.profit || 0); }, 0);
        var profitPaid = transfers.filter(function(t) { return t.investor_id === invId && t.purpose === 'profit_distribution'; }).reduce(function(s, t) { return s + parseFloat(t.amount || 0); }, 0) || 0;
        var outstandingProfit = Math.max(0, totalProfit - profitPaid);
        var currentBalance = capitalPendingReturn + outstandingProfit;
        
        document.getElementById('investorStatsGrid').innerHTML = 
            '<div class="summary-item"><label>رأس المال الكلي</label><div class="val">' + formatMoney(totalCapital) + '</div></div>' +
            '<div class="summary-item"><label>المستثمر</label><div class="val">' + formatMoney(workingCapital) + '</div></div>' +
            '<div class="summary-item"><label>المُرجع</label><div class="val green">' + formatMoney(capitalReturned) + '</div></div>' +
            '<div class="summary-item"><label>المتبقي للإرجاع</label><div class="val orange">' + formatMoney(capitalPendingReturn) + '</div></div>' +
            '<div class="summary-item profit-field"><label>الأرباح المستحقة</label><div class="val">' + (canViewProfits() ? formatMoney(outstandingProfit) : '****') + '</div></div>' +
            '<div class="summary-item profit-field"><label>الأرباح المصروفة</label><div class="val">' + (canViewProfits() ? formatMoney(profitPaid) : '****') + '</div></div>' +
            '<div class="summary-item"><label>الرصيد الحالي</label><div class="val blue">' + formatMoney(currentBalance) + '</div></div>';
        
        var opsHtml = '<table><thead><tr><th>العملية</th><th>الحالة</th><th>المساهمة</th><th class="profit-field">الربح</th></tr></thead><tbody>';
        opInvestors.forEach(function(oi) {
            opsHtml += '<tr><td>' + (oi.operations ? oi.operations.name : '-') + '</td><td><span class="badge badge-' + (oi.operations ? oi.operations.status : '') + '">' + getStatusText(oi.operations ? oi.operations.status : '') + '</span></td><td>' + formatMoney(oi.contribution) + '</td><td class="profit-field">' + (canViewProfits() ? formatMoney(oi.profit) : '<span class="hidden-profit">****</span>') + '</td></tr>';
        });
        opsHtml += '</tbody></table>';
        document.getElementById('investorOpsList').innerHTML = opsHtml || '<div class="empty-state">لا يوجد</div>';
        document.getElementById('investorDetailModal').classList.add('active');
        debug('✅ تم فتح تفاصيل الممول', 'success');
    } catch (err) { debug('❌ خطأ: ' + err.message, 'error'); }
}

function openInvestorModal(investor) {
    if (!canEdit()) return;
    investor = investor || null;
    document.getElementById('investorModalTitle').textContent = investor ? 'تعديل' : 'إضافة';
    document.getElementById('investorId').value = investor ? investor.id : '';
    document.getElementById('investorName').value = investor ? investor.name : '';
    document.getElementById('investorPhone').value = investor ? investor.phone : '';
    document.getElementById('investorEmail').value = investor ? investor.email : '';
    document.getElementById('investorAddress').value = investor ? investor.address : '';
    document.getElementById('investorNotes').value = investor ? investor.notes : '';
    document.getElementById('investorModal').classList.add('active');
}

document.getElementById('investorForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    if (!canEdit()) { showToast('❌ لا توجد صلاحية', 'error'); return; }
    var id = document.getElementById('investorId').value;
    var data = {
        name: document.getElementById('investorName').value,
        phone: document.getElementById('investorPhone').value,
        email: document.getElementById('investorEmail').value,
        address: document.getElementById('investorAddress').value,
        notes: document.getElementById('investorNotes').value
    };
    if (id) {
        var oldResult = await supabase.from('investors').select('*').eq('id', id).single();
        await supabase.from('investors').update(data).eq('id', id);
        logActivity('تعديل ممول', 'investor', id, JSON.stringify(oldResult.data), JSON.stringify(data), 'Name: ' + data.name);
        debug('✅ تم تحديث الممول', 'success');
    } else {
        var countResult = await supabase.from('investors').select('id');
        var refNum = generateReferenceNumber('INV', (countResult.data || []).length + 1);
        data.reference_number = refNum;
        await supabase.from('investors').insert(data);
        logActivity('إضافة ممول', 'investor', null, null, JSON.stringify(data), 'Name: ' + data.name + ', Ref: ' + refNum);
        debug('✅ تم إضافة الممول', 'success');
    }
    closeModal('investorModal');
    loadInvestors();
    showToast('تم الحفظ');
});

async function editInvestor(id) {
    if (!canEdit()) return;
    var result = await supabase.from('investors').select('*').eq('id', id).single();
    if (result.data) openInvestorModal(result.data);
}

async function archiveInvestor(id) {
    if (!canEdit()) return;
    if (confirm('هل تريد أرشفة هذا الممول؟')) {
        await supabase.from('investors').update({is_archived: true}).eq('id', id);
        logActivity('أرشفة ممول', 'investor', id, 'نشط', 'أرشيف', null);
        loadInvestors();
        showToast('تمت الأرشفة');
        debug('📁 تم أرشفة الممول', 'info');
    }
}

// ============================================
// Operations
// ============================================
async function loadOperations() {
    debug('📋 بدأ loadOperations', 'info');
    try {
        var result = await supabase.from('operations').select('*,clients(name)').order('created_at', {ascending: false});
        var data = result.data || [];
        if (result.error) { debug('❌ خطأ: ' + result.error.message, 'error'); return; }
        if (data.length === 0) { document.getElementById('operationsTable').innerHTML = '<div class="empty-state">لا يوجد عمليات</div>'; return; }
        var html = '<table><thead><tr><th>الرقم</th><th>الاسم</th><th>العميل</th><th>المبلغ</th><th class="profit-field">الربح</th><th>الحالة</th><th>القفل</th><th>الإجراءات</th></tr></thead><tbody>';
        data.forEach(function(o) {
            html += '<tr><td>' + (o.reference_number || '-') + '</td><td><strong>' + o.name + '</strong></td><td>' + (o.clients ? o.clients.name : '-') + '</td><td>' + formatMoney(o.amount) + '</td><td class="profit-field">' + (canViewProfits() ? formatMoney(o.final_profit) : '<span class="hidden-profit">****</span>') + '</td><td><span class="badge badge-' + o.status + '">' + getStatusText(o.status) + '</span></td><td>' + (o.is_locked ? '🔒' : '🔓') + '</td><td class="actions-cell"><button class="btn btn-primary btn-sm" onclick="openOperationDetails(\'' + o.id + '\')">تفاصيل</button>';
            if (canEdit() && !o.is_locked) html += '<button class="btn btn-secondary btn-sm" onclick="editOperation(\'' + o.id + '\')">تعديل</button>';
            html += '</td></tr>';
        });
        html += '</tbody></table>';
        document.getElementById('operationsTable').innerHTML = html;
        debug('✅ loadOperations اكتمل (' + data.length + ')', 'success');
    } catch (err) { debug('❌ خطأ: ' + err.message, 'error'); }
}

async function openOperationModal(operation) {
    if (!canEdit()) return;
    operation = operation || null;
    document.getElementById('operationModalTitle').textContent = operation ? 'تعديل' : 'إضافة';
    document.getElementById('operationId').value = operation ? operation.id : '';
    document.getElementById('opName').value = operation ? operation.name : '';
    document.getElementById('opType').value = operation ? operation.type : 'financing';
    document.getElementById('opAmount').value = operation ? operation.amount : '';
    document.getElementById('opExpectedProfit').value = operation ? operation.expected_profit : '';
    document.getElementById('opFinalProfit').value = operation ? operation.final_profit : '';
    document.getElementById('opProfitApprovalDate').value = operation ? operation.profit_approval_date : '';
    document.getElementById('opGoogleDriveUrl').value = operation ? operation.google_drive_url : '';
    document.getElementById('opCompanyProfitType').value = operation ? operation.company_profit_type : '';
    document.getElementById('opCompanyProfitValue').value = operation ? operation.company_profit_value : '';
    document.getElementById('opStartDate').value = operation ? operation.start_date : '';
    document.getElementById('opDurationDays').value = operation ? operation.duration_days : '';
    document.getElementById('opEndDate').value = operation ? operation.end_date : '';
    document.getElementById('opStatus').value = operation ? operation.status : 'draft';
    document.getElementById('opNotes').value = operation ? operation.notes : '';
    
    var clientsResult = await supabase.from('clients').select('*');
    var clients = clientsResult.data || [];
    var options = '<option value="">اختر</option>';
    clients.forEach(function(c) {
        if (!c.is_archived) {
            options += '<option value="' + c.id + '"' + (operation && operation.client_id === c.id ? ' selected' : '') + '>' + c.name + '</option>';
        }
    });
    document.getElementById('opClient').innerHTML = options;
    document.getElementById('operationModal').classList.add('active');
    debug('✅ تم فتح Modal العملية', 'success');
}

document.getElementById('opStartDate').addEventListener('change', calculateEndDate);
document.getElementById('opDurationDays').addEventListener('change', calculateEndDate);

function calculateEndDate() {
    var startDate = document.getElementById('opStartDate').value;
    var days = parseInt(document.getElementById('opDurationDays').value);
    if (startDate && days) {
        var end = new Date(new Date(startDate).getTime() + days*24*60*60*1000);
        document.getElementById('opEndDate').value = end.toISOString().split('T')[0];
    }
}

document.getElementById('operationForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    if (!canEdit()) { showToast('❌ لا توجد صلاحية', 'error'); return; }
    var id = document.getElementById('operationId').value;
    var amount = parseFloat(document.getElementById('opAmount').value);
    var expectedProfit = parseFloat(document.getElementById('opExpectedProfit').value) || 0;
    var finalProfit = parseFloat(document.getElementById('opFinalProfit').value) || 0;
    var durationDays = parseInt(document.getElementById('opDurationDays').value) || 0;
    
    if (amount <= 0) { showToast('❌ قيمة التمويل يجب أن تكون أكبر من صفر', 'error'); return; }
    if (expectedProfit < 0) { showToast('❌ الربح المتوقع لا يمكن أن يكون سالباً', 'error'); return; }
    if (finalProfit < 0) { showToast('❌ الربح النهائي لا يمكن أن يكون سالباً', 'error'); return; }
    if (durationDays < 0) { showToast('❌ مدة العملية لا يمكن أن تكون سالبة', 'error'); return; }
    
    var data = {
        name: document.getElementById('opName').value,
        type: document.getElementById('opType').value,
        client_id: document.getElementById('opClient').value,
        amount: amount,
        expected_profit: expectedProfit || null,
        final_profit: finalProfit || null,
        profit_approval_date: document.getElementById('opProfitApprovalDate').value || null,
        google_drive_url: document.getElementById('opGoogleDriveUrl').value || null,
        company_profit_type: document.getElementById('opCompanyProfitType').value || null,
        company_profit_value: document.getElementById('opCompanyProfitValue').value || null,
        start_date: document.getElementById('opStartDate').value,
        duration_days: durationDays || null,
        end_date: document.getElementById('opEndDate').value || null,
        status: document.getElementById('opStatus').value,
        notes: document.getElementById('opNotes').value
    };
    if (id) {
        var oldResult = await supabase.from('operations').select('*').eq('id', id).single();
        if (oldResult.data && oldResult.data.is_locked) { showToast('❌ العملية مقفلة', 'error'); return; }
        await supabase.from('operations').update(data).eq('id', id);
        logActivity('تعديل عملية', 'operation', id, JSON.stringify(oldResult.data), JSON.stringify(data), 'Name: ' + data.name);
        debug('✅ تم تحديث العملية', 'success');
        showToast('تم التحديث');
    } else {
        var countResult = await supabase.from('operations').select('id');
        var refNum = generateReferenceNumber('OP', (countResult.data || []).length + 1);
        data.reference_number = refNum;
        var result = await supabase.from('operations').insert(data).select();
        if (result.data && result.data[0]) {
            logActivity('إضافة عملية', 'operation', result.data[0].id, null, JSON.stringify(data), 'Name: ' + data.name + ', Ref: ' + refNum);
            debug('✅ تم إضافة العملية', 'success');
            showToast('تم الإضافة');
            closeModal('operationModal');
            openOperationDetails(result.data[0].id);
            return;
        }
    }
    closeModal('operationModal');
    loadOperations();
});

async function editOperation(id) {
    if (!canEdit()) return;
    var result = await supabase.from('operations').select('*').eq('id', id).single();
    if (result.data) {
        if (result.data.is_locked) { showToast('❌ العملية مقفلة', 'error'); return; }
        openOperationModal(result.data);
    }
}

async function openOperationDetails(opId) {
    try {
        currentOpId = opId;
        var result = await supabase.from('operations').select('*,clients(name)').eq('id', opId).single();
        var op = result.data;
        if (!op) return;
        currentOpData = op;
        document.getElementById('opDetailsTitle').textContent = 'تفاصيل: ' + op.name + (op.reference_number ? ' (' + op.reference_number + ')' : '');
        await refreshOperationSummary();
        loadOpInvestorsTab(op);
        loadOpTransfersTab(op);
        loadOpTimelineTab(op);
        var tabs = document.querySelectorAll('#operationDetailsModal .tab');
        for (var i = 0; i < tabs.length; i++) tabs[i].classList.toggle('active', i === 0);
        var tabContents = document.querySelectorAll('#operationDetailsModal .tab-content');
        for (var i = 0; i < tabContents.length; i++) tabContents[i].classList.toggle('active', i === 0);
        if (op.is_locked) {
            document.getElementById('workflowActions').style.display = 'none';
            document.getElementById('unlockBtn').style.display = 'inline-flex';
        } else {
            document.getElementById('workflowActions').style.display = 'flex';
            document.getElementById('unlockBtn').style.display = 'none';
        }
        if (isClient()) {
            document.querySelector('.tab[onclick*="investors"]').style.display = 'none';
            document.getElementById('opTabInvestors').style.display = 'none';
        }
        document.getElementById('operationDetailsModal').classList.add('active');
        debug('✅ تم فتح تفاصيل العملية', 'success');
    } catch (err) { debug('❌ خطأ: ' + err.message, 'error'); }
}

async function refreshOperationSummary() {
    try {
        var op = currentOpData;
        var opInvResult = await supabase.from('operation_investors').select('*').eq('operation_id', op.id);
        var opInvestors = opInvResult.data || [];
        var transResult = await supabase.from('transfers').select('*').eq('operation_id', op.id);
        var transfers = transResult.data || [];
        var investorCount = opInvestors.length;
        var totalInvested = opInvestors.reduce(function(sum, i) { return sum + parseFloat(i.contribution || 0); }, 0) || 0;
        var companyProfit = 0;
        if (op.company_profit_type === 'percentage' && op.final_profit) companyProfit = (parseFloat(op.final_profit) * parseFloat(op.company_profit_value || 0)) / 100;
        else if (op.company_profit_type === 'fixed') companyProfit = parseFloat(op.company_profit_value || 0);
        var totalInvestorProfit = Math.max(0, (parseFloat(op.final_profit) || 0) - companyProfit);
        var distributedProfit = transfers.filter(function(t) { return t.purpose === 'profit_distribution'; }).reduce(function(sum, t) { return sum + parseFloat(t.amount || 0); }, 0) || 0;
        var remainingProfit = Math.max(0, totalInvestorProfit - distributedProfit);
        var clientRepaid = transfers.filter(function(t) { return t.purpose === 'client_repayment'; }).reduce(function(sum, t) { return sum + parseFloat(t.amount || 0); }, 0) || 0;
        var capitalReturned = transfers.filter(function(t) { return t.purpose === 'capital_return'; }).reduce(function(sum, t) { return sum + parseFloat(t.amount || 0); }, 0) || 0;
        
        document.getElementById('opSummaryGrid').innerHTML = 
            '<div class="summary-item"><label>الرقم</label><div class="val">' + (op.reference_number || '-') + '</div></div>' +
            '<div class="summary-item"><label>التمويل</label><div class="val">' + formatMoney(op.amount) + '</div></div>' +
            '<div class="summary-item"><label>الممولين</label><div class="val">' + investorCount + '</div></div>' +
            '<div class="summary-item"><label>المستثمر</label><div class="val">' + formatMoney(totalInvested) + '</div></div>' +
            '<div class="summary-item profit-field"><label>الربح النهائي</label><div class="val">' + (canViewProfits() ? formatMoney(op.final_profit) : '<span class="hidden-profit">****</span>') + '</div></div>' +
            '<div class="summary-item profit-field"><label>تاريخ اعتماد الربح</label><div class="val">' + formatDate(op.profit_approval_date) + '</div></div>' +
            '<div class="summary-item"><label>مرفقات</label><div class="val">' + (op.google_drive_url ? '<a href="' + op.google_drive_url + '" target="_blank">فتح</a>' : '-') + '</div></div>' +
            '<div class="summary-item profit-field"><label>ربح الشركة</label><div class="val">' + (canViewProfits() ? formatMoney(companyProfit) : '<span class="hidden-profit">****</span>') + '</div></div>' +
            '<div class="summary-item profit-field"><label>ربح الممولين</label><div class="val">' + (canViewProfits() ? formatMoney(totalInvestorProfit) : '<span class="hidden-profit">****</span>') + '</div></div>' +
            '<div class="summary-item profit-field"><label>الموزع</label><div class="val green">' + (canViewProfits() ? formatMoney(distributedProfit) : '<span class="hidden-profit">****</span>') + '</div></div>' +
            '<div class="summary-item profit-field"><label>المتبقي</label><div class="val red">' + (canViewProfits() ? formatMoney(remainingProfit) : '<span class="hidden-profit">****</span>') + '</div></div>' +
            '<div class="summary-item"><label>مسدد من العميل</label><div class="val">' + formatMoney(clientRepaid) + '/' + formatMoney(op.amount) + '</div></div>' +
            '<div class="summary-item"><label>رأس المال المُرجع</label><div class="val">' + formatMoney(capitalReturned) + '/' + formatMoney(totalInvested) + '</div></div>' +
            '<div class="summary-item"><label>الحالة</label><div class="val"><span class="badge badge-' + op.status + '">' + getStatusText(op.status) + '</span> ' + (op.is_locked ? '🔒' : '') + '</div></div>';
        
        debug('✅ تم تحديث ملخص العملية', 'success');
    } catch (err) { debug('❌ خطأ: ' + err.message, 'error'); }
}

function showOpTab(tabName, btn) {
    var tabs = document.querySelectorAll('#operationDetailsModal .tab');
    for (var i = 0; i < tabs.length; i++) tabs[i].classList.remove('active');
    var tabContents = document.querySelectorAll('#operationDetailsModal .tab-content');
    for (var i = 0; i < tabContents.length; i++) tabContents[i].classList.remove('active');
    btn.classList.add('active');
    document.getElementById('opTab' + tabName.charAt(0).toUpperCase() + tabName.slice(1)).classList.add('active');
}

async function workflowAction(action) {
    if (!canEdit()) { showToast('❌ لا توجد صلاحية', 'error'); return; }
    if (action === 'activate') {
        if (currentOpData.status !== 'draft') { showToast('العملية ليست تحت الإنشاء', 'warning'); return; }
        if (currentOpData.is_locked) { showToast('العملية مقفلة', 'error'); return; }
        
        var opInvResult = await supabase.from('operation_investors').select('*').eq('operation_id', currentOpId);
        var opInvestors = opInvResult.data || [];
        var totalContributions = opInvestors.reduce(function(sum, oi) { return sum + parseFloat(oi.contribution || 0); }, 0);
        var opAmount = parseFloat(currentOpData.amount);
        
        if (Math.abs(totalContributions - opAmount) > 0.01) {
            var diff = opAmount - totalContributions;
            showToast('❌ مجموع المساهمات (' + formatMoney(totalContributions) + ') لا يساوي قيمة التمويل (' + formatMoney(opAmount) + '). الفرق: ' + formatMoney(diff), 'error');
            debug('❌ فشل التفعيل: فرق في المساهمات = ' + diff, 'error');
            return;
        }
        
        var oldStatus = currentOpData.status;
        await supabase.from('operations').update({status: 'active'}).eq('id', currentOpId);
        logActivity('تفعيل عملية', 'operation', currentOpId, oldStatus, 'active', 'Operation: ' + currentOpData.name);
        showToast('تم التفعيل');
        await refreshOperationDetails();
        debug('🚀 تم تفعيل العملية', 'success');
    } else if (action === 'complete') {
        if (currentOpData.is_locked) { showToast('العملية مقفلة', 'error'); return; }
        var op = currentOpData;
        var opInvResult = await supabase.from('operation_investors').select('*').eq('operation_id', op.id);
        var opInvestors = opInvResult.data || [];
        var transResult = await supabase.from('transfers').select('*').eq('operation_id', op.id);
        var transfers = transResult.data || [];
        var totalInvested = opInvestors.reduce(function(sum, i) { return sum + parseFloat(i.contribution || 0); }, 0) || 0;
        var totalInvestorProfit = opInvestors.reduce(function(sum, i) { return sum + parseFloat(i.profit || 0); }, 0) || 0;
        var clientRepaid = transfers.filter(function(t) { return t.purpose === 'client_repayment'; }).reduce(function(sum, t) { return sum + parseFloat(t.amount || 0); }, 0) || 0;
        var distributedProfit = transfers.filter(function(t) { return t.purpose === 'profit_distribution'; }).reduce(function(sum, t) { return sum + parseFloat(t.amount || 0); }, 0) || 0;
        var capitalReturned = transfers.filter(function(t) { return t.purpose === 'capital_return'; }).reduce(function(sum, t) { return sum + parseFloat(t.amount || 0); }, 0) || 0;
        var warnings = [];
        if (clientRepaid < parseFloat(op.amount)) warnings.push('لم يسدد العميل (' + formatMoney(parseFloat(op.amount) - clientRepaid) + ' متبقي)');
        if (distributedProfit < totalInvestorProfit) warnings.push('لم توزع الأرباح (' + formatMoney(totalInvestorProfit - distributedProfit) + ' متبقي)');
        if (capitalReturned < totalInvested) warnings.push('لم يُرجع رأس المال (' + formatMoney(totalInvested - capitalReturned) + ' متبقي)');
        if (warnings.length > 0) {
            var msg = '⚠️ تحذير:\n' + warnings.join('\n') + '\n\nهل تريد الإنهاء رغم ذلك؟';
            if (confirm(msg)) {
                var oldStatus = currentOpData.status;
                await supabase.from('operations').update({status: 'completed', is_locked: true}).eq('id', currentOpId);
                logActivity('إنهاء عملية', 'operation', currentOpId, oldStatus, 'completed+locked', 'Operation: ' + currentOpData.name);
                showToast('تم الإنهاء وقفل العملية');
                await refreshOperationDetails();
                debug('✅ تم إنهاء العملية وقفلها', 'success');
            }
        } else {
            var oldStatus = currentOpData.status;
            await supabase.from('operations').update({status: 'completed', is_locked: true}).eq('id', currentOpId);
            logActivity('إنهاء عملية', 'operation', currentOpId, oldStatus, 'completed+locked', 'Operation: ' + currentOpData.name);
            showToast('تم الإنهاء وقفل العملية');
            await refreshOperationDetails();
            debug('✅ تم إنهاء العملية وقفلها', 'success');
        }
    } else if (action === 'unlock') {
        if (!isAdmin()) { showToast('❌ المدير فقط', 'error'); return; }
        if (confirm('هل تريد فتح قفل هذه العملية؟ سيتم تسجيل ذلك في سجل النشاط.')) {
            await supabase.from('operations').update({is_locked: false}).eq('id', currentOpId);
            logActivity('فتح قفل عملية', 'operation', currentOpId, 'locked', 'unlocked', 'Operation: ' + currentOpData.name);
            showToast('تم فتح القفل');
            await refreshOperationDetails();
            debug('🔓 تم فتح قفل العملية', 'success');
        }
    }
}

async function refreshOperationDetails() {
    try {
        var result = await supabase.from('operations').select('*,clients(name)').eq('id', currentOpId).single();
        currentOpData = result.data;
        await refreshOperationSummary();
        loadOpInvestorsTab(currentOpData);
        loadOpTransfersTab(currentOpData);
        loadOpTimelineTab(currentOpData);
    } catch (err) { debug('❌ خطأ: ' + err.message, 'error'); }
}

async function loadOpInvestorsTab(op) {
    try {
        var result = await supabase.from('operation_investors').select('*,investors(name)').eq('operation_id', op.id);
        var opInvestors = result.data || [];
        var container = document.getElementById('opInvestorsList');
        if (opInvestors.length === 0) { container.innerHTML = '<div class="empty-state">لا يوجد ممولين</div>'; return; }
        var html = '<table><thead><tr><th>الممول</th><th>المساهمة</th><th class="profit-field">الربح</th>';
        if (canEdit() && !op.is_locked) html += '<th>الإجراءات</th>';
        html += '</tr></thead><tbody>';
        opInvestors.forEach(function(oi) {
            html += '<tr><td><strong>' + (oi.investors ? oi.investors.name : '-') + '</strong></td><td>' + formatMoney(oi.contribution) + '</td><td class="profit-field">' + (canViewProfits() ? formatMoney(oi.profit) : '<span class="hidden-profit">****</span>') + '</td>';
            if (canEdit() && !op.is_locked) html += '<td class="actions-cell"><button class="btn btn-secondary btn-sm" onclick="openEditOpInvestor(\'' + oi.id + '\',' + oi.contribution + ',' + oi.profit + ')">تعديل</button><button class="btn btn-danger btn-sm" onclick="confirmDeleteOpInvestor(\'' + oi.id + '\',\'' + op.id + '\',\'' + (oi.investors ? oi.investors.name : '') + '\',' + oi.contribution + ',' + oi.profit + ')">حذف</button></td>';
            html += '</tr>';
        });
        html += '</tbody></table>';
        container.innerHTML = html;
        debug('✅ تم تحميل ممولين العملية (' + opInvestors.length + ')', 'success');
    } catch (err) { debug('❌ خطأ: ' + err.message, 'error'); }
}

async function validateOpInvestorInputs() {
    var contrib = parseFloat(document.getElementById('newOpInvestorContribution').value) || 0;
    var profit = parseFloat(document.getElementById('newOpInvestorProfit').value) || 0;
    var opAmount = parseFloat(currentOpData.amount) || 0;
    var opFinalProfit = parseFloat(currentOpData.final_profit) || 0;
    var result = await supabase.from('operation_investors').select('contribution,profit').eq('operation_id', currentOpId);
    var existing = result.data || [];
    var totalContrib = (existing.reduce(function(s, i) { return s + parseFloat(i.contribution || 0); }, 0) || 0) + contrib;
    var totalProfit = (existing.reduce(function(s, i) { return s + parseFloat(i.profit || 0); }, 0) || 0) + profit;
    var warnings = [];
    if (contrib <= 0) warnings.push('⚠️ المساهمة يجب أن تكون أكبر من صفر');
    if (profit < 0) warnings.push('⚠️ الربح لا يمكن أن يكون سالباً');
    if (totalContrib > opAmount) warnings.push('⚠️ المساهمات (' + formatMoney(totalContrib) + ') تتجاوز التمويل (' + formatMoney(opAmount) + ')');
    var companyProfit = 0;
    if (currentOpData.company_profit_type === 'percentage' && opFinalProfit) companyProfit = (opFinalProfit * parseFloat(currentOpData.company_profit_value || 0)) / 100;
    else if (currentOpData.company_profit_type === 'fixed') companyProfit = parseFloat(currentOpData.company_profit_value || 0);
    var maxInvestorProfit = Math.max(0, opFinalProfit - companyProfit);
    if (totalProfit > maxInvestorProfit) warnings.push('⚠️ أرباح الممولين (' + formatMoney(totalProfit) + ') تتجاوز المتاح (' + formatMoney(maxInvestorProfit) + ')');
    document.getElementById('opInvestorValidationWarning').innerHTML = warnings.length > 0 ? '<div class="warning-box">' + warnings.join('<br>') + '</div>' : '';
}

async function validateEditOpInvestorInputs() {
    var editId = document.getElementById('editOpInvestorId').value;
    var contrib = parseFloat(document.getElementById('editOpInvestorContribution').value) || 0;
    var profit = parseFloat(document.getElementById('editOpInvestorProfit').value) || 0;
    var opAmount = parseFloat(currentOpData.amount) || 0;
    var opFinalProfit = parseFloat(currentOpData.final_profit) || 0;
    var result = await supabase.from('operation_investors').select('id,contribution,profit').eq('operation_id', currentOpId);
    var existing = result.data || [];
    var totalContrib = (existing.filter(function(i) { return i.id !== editId; }).reduce(function(s, i) { return s + parseFloat(i.contribution || 0); }, 0) || 0) + contrib;
    var totalProfit = (existing.filter(function(i) { return i.id !== editId; }).reduce(function(s, i) { return s + parseFloat(i.profit || 0); }, 0) || 0) + profit;
    var warnings = [];
    if (contrib <= 0) warnings.push('⚠️ المساهمة يجب أن تكون أكبر من صفر');
    if (profit < 0) warnings.push('⚠️ الربح لا يمكن أن يكون سالباً');
    if (totalContrib > opAmount) warnings.push('⚠️ المساهمات (' + formatMoney(totalContrib) + ') تتجاوز التمويل (' + formatMoney(opAmount) + ')');
    var companyProfit = 0;
    if (currentOpData.company_profit_type === 'percentage' && opFinalProfit) companyProfit = (opFinalProfit * parseFloat(currentOpData.company_profit_value || 0)) / 100;
    else if (currentOpData.company_profit_type === 'fixed') companyProfit = parseFloat(currentOpData.company_profit_value || 0);
    var maxInvestorProfit = Math.max(0, opFinalProfit - companyProfit);
    if (totalProfit > maxInvestorProfit) warnings.push('⚠️ أرباح الممولين (' + formatMoney(totalProfit) + ') تتجاوز المتاح (' + formatMoney(maxInvestorProfit) + ')');
    document.getElementById('editOpInvestorValidationWarning').innerHTML = warnings.length > 0 ? '<div class="warning-box">' + warnings.join('<br>') + '</div>' : '';
}

function openAddInvestorToOp() {
    if (!canEdit() || currentOpData.is_locked) { showToast('❌ لا يمكن الإضافة', 'error'); return; }
    supabase.from('investors').select('*').then(function(result) {
        var data = result.data || [];
        var options = '<option value="">اختر</option>';
        data.forEach(function(i) {
            if (!i.is_archived) {
                options += '<option value="' + i.id + '">' + i.name + (i.reference_number ? ' (' + i.reference_number + ')' : '') + '</option>';
            }
        });
        document.getElementById('newOpInvestorId').innerHTML = options;
        document.getElementById('newOpInvestorContribution').value = '';
        document.getElementById('newOpInvestorProfit').value = '';
        document.getElementById('opInvestorValidationWarning').innerHTML = '';
        document.getElementById('addInvestorToOpModal').classList.add('active');
        debug('✅ تم فتح Modal إضافة ممول', 'success');
    });
}

document.getElementById('addInvestorToOpForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    if (!canEdit()) { showToast('❌ لا توجد صلاحية', 'error'); return; }
    if (document.getElementById('opInvestorValidationWarning').innerHTML !== '') { showToast('راجع التحذيرات', 'warning'); return; }
    var invId = document.getElementById('newOpInvestorId').value;
    var contrib = parseFloat(document.getElementById('newOpInvestorContribution').value);
    var profit = parseFloat(document.getElementById('newOpInvestorProfit').value) || 0;
    
    if (contrib <= 0) { showToast('❌ المساهمة يجب أن تكون أكبر من صفر', 'error'); return; }
    if (profit < 0) { showToast('❌ الربح لا يمكن أن يكون سالباً', 'error'); return; }
    
    var data = {
        operation_id: currentOpId,
        investor_id: invId,
        contribution: contrib,
        profit: profit
    };
    var invResult = await supabase.from('investors').select('name').eq('id', invId).single();
    var invName = invResult.data ? invResult.data.name : '';
    await supabase.from('operation_investors').insert(data);
    logActivity('إضافة ممول لعملية', 'operation_investor', currentOpId, null, JSON.stringify(data), 'Investor: ' + invName + ', Contribution: ' + formatMoney(contrib));
    closeModal('addInvestorToOpModal');
    await refreshOperationDetails();
    showToast('تم الإضافة');
    debug('✅ تم إضافة ممول للعملية', 'success');
});

function openEditOpInvestor(oiId, contribution, profit) {
    if (!canEdit() || currentOpData.is_locked) { showToast('❌ لا يمكن التعديل', 'error'); return; }
    document.getElementById('editOpInvestorId').value = oiId;
    document.getElementById('editOpInvestorContribution').value = contribution;
    document.getElementById('editOpInvestorProfit').value = profit;
    document.getElementById('editOpInvestorValidationWarning').innerHTML = '';
    document.getElementById('editOpInvestorModal').classList.add('active');
}

document.getElementById('editOpInvestorForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    if (!canEdit()) { showToast('❌ لا توجد صلاحية', 'error'); return; }
    if (document.getElementById('editOpInvestorValidationWarning').innerHTML !== '') { showToast('راجع التحذيرات', 'warning'); return; }
    var oiId = document.getElementById('editOpInvestorId').value;
    var newContrib = parseFloat(document.getElementById('editOpInvestorContribution').value);
    var newProfit = parseFloat(document.getElementById('editOpInvestorProfit').value) || 0;
    
    if (newContrib <= 0) { showToast('❌ المساهمة يجب أن تكون أكبر من صفر', 'error'); return; }
    if (newProfit < 0) { showToast('❌ الربح لا يمكن أن يكون سالباً', 'error'); return; }
    
    var oldResult = await supabase.from('operation_investors').select('*').eq('id', oiId).single();
    await supabase.from('operation_investors').update({contribution: newContrib, profit: newProfit}).eq('id', oiId);
    logActivity('تعديل ممول عملية', 'operation_investor', oiId, JSON.stringify(oldResult.data), JSON.stringify({contribution: newContrib, profit: newProfit}), 'Operation: ' + currentOpData.name);
    closeModal('editOpInvestorModal');
    await refreshOperationDetails();
    showToast('تم التحديث');
    debug('✅ تم تعديل ممول العملية', 'success');
});

async function confirmDeleteOpInvestor(oiId, opId, invName, contrib, profit) {
    if (!canEdit()) { showToast('❌ لا توجد صلاحية', 'error'); return; }
    if (confirm('حذف ' + invName + '؟\nمساهمة: ' + formatMoney(contrib) + ' | ربح: ' + formatMoney(profit))) {
        logActivity('حذف ممول من عملية', 'operation_investor', oiId, JSON.stringify({contribution: contrib, profit: profit}), null, 'Investor: ' + invName + ', Operation: ' + opId);
        await supabase.from('operation_investors').delete().eq('id', oiId);
        await refreshOperationDetails();
        showToast('تم الحذف');
        debug('🗑️ تم حذف ممول من العملية', 'info');
    }
}

async function loadOpTransfersTab(op) {
    try {
        var result = await supabase.from('transfers').select('*,investors(name)').eq('operation_id', op.id).order('transfer_date', {ascending: false});
        var transfers = result.data || [];
        var container = document.getElementById('opTransfersList');
        if (transfers.length === 0) { container.innerHTML = '<div class="empty-state">لا يوجد تحويلات</div>'; return; }
        var purposeMap = {client_funding:'تمويل',client_repayment:'سداد',capital_return:'إرجاع رأس مال',profit_distribution:'توزيع أرباح',settlement:'تسوية',additional_funding:'تمويل إضافي',other:'أخرى'};
        var html = '<table><thead><tr><th>الرقم</th><th>النوع</th><th>الغرض</th><th>الممول/العميل</th><th>المبلغ</th><th>التاريخ</th>';
        if (canEdit()) html += '<th>الإجراءات</th>';
        html += '</tr></thead><tbody>';
        transfers.forEach(function(t) {
            var typeText = {company_to_client:'شركة→عميل',client_to_company:'عميل→شركة',company_to_investor:'شركة→ممول'}[t.type];
            var partyName = t.investor_id ? (t.investors ? t.investors.name : '-') : (t.type === 'company_to_client' || t.type === 'client_to_company' ? (currentOpData.clients ? currentOpData.clients.name : '-') : '-');
            html += '<tr><td>' + (t.reference_number || '-') + '</td><td>' + typeText + '</td><td>' + (purposeMap[t.purpose] || t.purpose) + '</td><td>' + (partyName || '-') + '</td><td>' + formatMoney(t.amount) + '</td><td>' + formatDate(t.transfer_date) + '</td>';
            if (canEdit()) html += '<td><button class="btn btn-danger btn-sm" onclick="confirmDeleteTransfer(\'' + t.id + '\',\'' + op.id + '\',' + t.amount + ',\'' + (purposeMap[t.purpose] || t.purpose) + '\')">حذف</button></td>';
            html += '</tr>';
        });
        html += '</tbody></table>';
        container.innerHTML = html;
        debug('✅ تم تحميل تحويلات العملية (' + transfers.length + ')', 'success');
    } catch (err) { debug('❌ خطأ: ' + err.message, 'error'); }
}

async function loadOpTimelineTab(op) {
    try {
        var result = await supabase.from('operation_logs').select('*').eq('operation_id', op.id).order('created_at', {ascending: false});
        var logs = result.data || [];
        var container = document.getElementById('opTimelineList');
        if (logs.length === 0) { container.innerHTML = '<div class="empty-state">لا يوجد سجل</div>'; return; }
        var html = '<div class="timeline">';
        logs.forEach(function(log) {
            html += '<div class="timeline-item"><div class="timeline-time">' + new Date(log.created_at).toLocaleString('ar-EG') + '</div><div class="timeline-user">👤 ' + (log.user_email || 'مجهول') + '</div><div class="timeline-content"><strong>' + log.action + '</strong><p>' + log.description + '</p></div></div>';
        });
        html += '</div>';
        container.innerHTML = html;
        debug('✅ تم تحميل سجل الأحداث (' + logs.length + ')', 'success');
    } catch (err) { debug('❌ خطأ: ' + err.message, 'error'); }
}

// ============================================
// Transfers
// ============================================
async function loadTransfers() {
    debug('💸 بدأ loadTransfers', 'info');
    try {
        var result = await supabase.from('transfers').select('*,operations(name),investors(name)').order('transfer_date', {ascending: false});
        var data = result.data || [];
        if (result.error) { debug('❌ خطأ: ' + result.error.message, 'error'); return; }
        if (data.length === 0) { document.getElementById('transfersTable').innerHTML = '<div class="empty-state">لا يوجد تحويلات</div>'; return; }
        var purposeMap = {client_funding:'تمويل',client_repayment:'سداد',capital_return:'إرجاع رأس مال',profit_distribution:'توزيع أرباح',settlement:'تسوية',additional_funding:'تمويل إضافي',other:'أخرى'};
        var html = '<table><thead><tr><th>الرقم</th><th>النوع</th><th>الغرض</th><th>العملية</th><th>الممول/العميل</th><th>المبلغ</th><th>التاريخ</th>';
        if (canEdit()) html += '<th>الإجراءات</th>';
        html += '</tr></thead><tbody>';
        data.forEach(function(t) {
            var typeText = {company_to_client:'شركة→عميل',client_to_company:'عميل→شركة',company_to_investor:'شركة→ممول'}[t.type];
            var partyName = t.investor_id ? (t.investors ? t.investors.name : '-') : '-';
            html += '<tr><td>' + (t.reference_number || '-') + '</td><td>' + typeText + '</td><td>' + (purposeMap[t.purpose] || t.purpose) + '</td><td>' + (t.operations ? t.operations.name : '-') + '</td><td>' + (partyName || '-') + '</td><td>' + formatMoney(t.amount) + '</td><td>' + formatDate(t.transfer_date) + '</td>';
            if (canEdit()) html += '<td><button class="btn btn-danger btn-sm" onclick="confirmDeleteTransfer(\'' + t.id + '\',\'' + t.operation_id + '\',' + t.amount + ',\'' + (purposeMap[t.purpose] || t.purpose) + '\')">حذف</button></td>';
            html += '</tr>';
        });
        html += '</tbody></table>';
        document.getElementById('transfersTable').innerHTML = html;
        debug('✅ loadTransfers اكتمل (' + data.length + ')', 'success');
    } catch (err) { debug('❌ خطأ: ' + err.message, 'error'); }
}

function toggleInvestorSelect() {
    var type = document.getElementById('transferType').value;
    var row = document.getElementById('investorSelectRow');
    if (type === 'company_to_investor') {
        row.style.display = 'grid';
        supabase.from('investors').select('*').then(function(result) {
            var data = result.data || [];
            var options = '<option value="">اختر</option>';
            data.forEach(function(i) {
                if (!i.is_archived) {
                    options += '<option value="' + i.id + '">' + i.name + '</option>';
                }
            });
            document.getElementById('transferInvestorId').innerHTML = options;
        });
    } else {
        row.style.display = 'none';
    }
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
    var opsResult = await supabase.from('operations').select('*');
    var ops = opsResult.data || [];
    var options = '<option value="">بدون عملية</option>';
    ops.forEach(function(o) {
        if (o.status !== 'cancelled' && !o.is_locked) {
            options += '<option value="' + o.id + '">' + (o.reference_number || '') + ' ' + o.name + ' (' + getStatusText(o.status) + ')</option>';
        }
    });
    document.getElementById('transferOperation').innerHTML = options;
    document.getElementById('transferModal').classList.add('active');
    debug('✅ تم فتح Modal التحويل', 'success');
}

function openAddTransferToOp() {
    if (!canEdit()) return;
    openTransferModal();
    setTimeout(function() { document.getElementById('transferOperation').value = currentOpId; }, 100);
}

function openWorkflowTransfer(purpose) {
    if (!canEdit()) return;
    if (currentOpData.is_locked) { showToast('❌ العملية مقفلة', 'error'); return; }
    openTransferModal();
    setTimeout(function() {
        document.getElementById('transferOperation').value = currentOpId;
        document.getElementById('transferPurpose').value = purpose;
        if (purpose === 'client_repayment') document.getElementById('transferType').value = 'client_to_company';
        else if (purpose === 'profit_distribution' || purpose === 'capital_return') {
            document.getElementById('transferType').value = 'company_to_investor';
            toggleInvestorSelect();
        }
    }, 100);
}

document.getElementById('transferForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    if (!canEdit()) { showToast('❌ لا توجد صلاحية', 'error'); return; }
    var amount = parseFloat(document.getElementById('transferAmount').value);
    var purpose = document.getElementById('transferPurpose').value;
    var opId = document.getElementById('transferOperation').value;
    
    if (amount <= 0) { showToast('❌ المبلغ يجب أن يكون أكبر من صفر', 'error'); return; }
    
    var warnings = [];
    
    if (purpose === 'profit_distribution') {
        if (opId) {
            var opResult = await supabase.from('operations').select('*').eq('id', opId).single();
            var op = opResult.data;
            if (op) {
                if (!op.final_profit || op.final_profit <= 0) warnings.push('❌ لم يتم إدخال الربح النهائي للعملية');
                if (!op.profit_approval_date) warnings.push('❌ لم يتم تسجيل تاريخ اعتماد الربح');
                if (op.status !== 'active' && op.status !== 'completed') warnings.push('❌ العملية يجب أن تكون نشطة أو منتهية');
                if (op.is_locked && op.status !== 'completed') warnings.push('❌ العملية مقفلة');
            }
        }
    }
    
    if (purpose === 'capital_return' || purpose === 'profit_distribution') {
        if (opId) {
            var opResult = await supabase.from('operations').select('status').eq('id', opId).single();
            var op = opResult.data;
            if (op && (op.status === 'draft' || op.status === 'cancelled')) {
                warnings.push('❌ لا يمكن التوزيع على عملية غير نشطة');
            }
        }
    }
    
    if (opId && purpose === 'client_repayment') {
        var opResult = await supabase.from('operations').select('amount').eq('id', opId).single();
        var op = opResult.data;
        if (op) {
            var transResult = await supabase.from('transfers').select('amount').eq('operation_id', opId).eq('purpose', 'client_repayment');
            var totalRepaid = (transResult.data || []).reduce(function(s, t) { return s + parseFloat(t.amount || 0); }, 0);
            if (totalRepaid + amount > parseFloat(op.amount)) {
                warnings.push('❌ المبلغ يتجاوز قيمة العملية (المتبقي: ' + formatMoney(parseFloat(op.amount) - totalRepaid) + ')');
            }
        }
    }
    
    if (opId && purpose === 'capital_return') {
        var opInvResult = await supabase.from('operation_investors').select('*').eq('operation_id', opId);
        var opInvestors = opInvResult.data || [];
        var totalInvested = opInvestors.reduce(function(s, oi) { return s + parseFloat(oi.contribution || 0); }, 0);
        var transResult = await supabase.from('transfers').select('amount').eq('operation_id', opId).eq('purpose', 'capital_return');
        var totalReturned = (transResult.data || []).reduce(function(s, t) { return s + parseFloat(t.amount || 0); }, 0);
        if (totalReturned + amount > totalInvested) {
            warnings.push('❌ المبلغ يتجاوز رأس المال المستثمر (المتبقي: ' + formatMoney(totalInvested - totalReturned) + ')');
        }
    }
    
    if (warnings.length > 0) {
        document.getElementById('transferValidationWarning').innerHTML = '<div class="error-box">' + warnings.join('<br>') + '</div>';
        showToast('راجع التحذيرات', 'error');
        return;
    }
    
    document.getElementById('transferValidationWarning').innerHTML = '';
    
    var investorId = document.getElementById('transferType').value === 'company_to_investor' ? document.getElementById('transferInvestorId').value : null;
    var data = {
        type: document.getElementById('transferType').value,
        purpose: purpose,
        operation_id: opId || null,
        investor_id: investorId,
        amount: amount,
        transfer_date: document.getElementById('transferDate').value,
        notes: document.getElementById('transferNotes').value
    };
    
    var countResult = await supabase.from('transfers').select('id');
    var refNum = generateReferenceNumber('TR', (countResult.data || []).length + 1);
    data.reference_number = refNum;
    
    var result = await supabase.from('transfers').insert(data).select();
    if (result.data && result.data[0]) {
        var purposeText = document.getElementById('transferPurpose').options[document.getElementById('transferPurpose').selectedIndex].text;
        var invName = investorId ? document.getElementById('transferInvestorId').options[document.getElementById('transferInvestorId').selectedIndex].text : '';
        logActivity('إضافة تحويل', 'transfer', result.data[0].id, null, JSON.stringify(data), 'Amount: ' + formatMoney(amount) + ', Purpose: ' + purposeText + ', Ref: ' + refNum);
        if (opId) await addLog(opId, 'تحويل مالي', 'تم تحويل ' + formatMoney(amount) + ' - ' + purposeText + ' ' + (invName ? 'لـ ' + invName : ''));
    }
    closeModal('transferModal');
    loadTransfers();
    if (currentOpId) await refreshOperationDetails();
    showToast('تم الإضافة');
    debug('✅ تم إضافة التحويل', 'success');
});

async function confirmDeleteTransfer(tId, opId, amount, purpose) {
    if (!canEdit()) { showToast('❌ لا توجد صلاحية', 'error'); return; }
    if (confirm('حذف التحويل؟\nالمبلغ: ' + formatMoney(amount) + ' | الغرض: ' + purpose)) {
        var oldResult = await supabase.from('transfers').select('*').eq('id', tId).single();
        if (opId) await addLog(opId, 'حذف تحويل (سجل)', 'تم حذف تحويل ' + formatMoney(amount) + ' - ' + purpose);
        await supabase.from('transfers').delete().eq('id', tId);
        logActivity('حذف تحويل', 'transfer', tId, JSON.stringify(oldResult.data), null, 'Amount: ' + formatMoney(amount) + ', Purpose: ' + purpose);
        if (opId) {
            await addLog(opId, 'حذف تحويل', 'تم الحذف');
            await refreshOperationDetails();
        }
        loadTransfers();
        showToast('تم الحذف');
        debug('🗑️ تم حذف التحويل', 'info');
    }
}

async function addLog(operation_id, action, description) {
    try {
        await supabase.from('operation_logs').insert({
            operation_id: operation_id,
            action: action,
            description: description,
            user_email: currentUser ? currentUser.email : 'Unknown'
        });
    } catch (e) {
        debug('⚠️ خطأ في addLog: ' + e.message, 'warning');
    }
}

// ============================================
// Initialization
// ============================================
debug('📦 تم تحميل HTML', 'success');
if (typeof window.supabase === 'undefined') {
    debug('❌ مكتبة Supabase لم تُحمّل!', 'error');
} else {
    debug('✅ مكتبة Supabase تم تحميلها', 'success');
}

try {
    if (typeof window.supabase !== 'undefined') {
        supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        debug('✅ تم إنشاء Supabase Client', 'success');
    } else {
        debug('❌ لا يمكن إنشاء Client', 'error');
    }
} catch (err) {
    debug('❌ خطأ في createClient: ' + err.message, 'error');
}

if (supabase) {
    debug('🔍 جاري التحقق من الجلسة...', 'info');
    supabase.auth.getSession().then(function(result) {
        var session = result.data ? result.data.session : null;
        debug('📋 Session: ' + (session ? 'موجود' : 'غير موجود'), session ? 'success' : 'info');
        if (session) {
            currentUser = session.user;
            loadUserProfile().then(function() { showApp(); });
        }
    }).catch(function(err) {
        debug('❌ خطأ في getSession: ' + err.message, 'error');
    });
}

debug('✅ النظام جاهز تماماً', 'success');
debug('📝 أدخل البيانات واضغط على "تسجيل الدخول"', 'info');
