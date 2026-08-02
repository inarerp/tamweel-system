// ============================================================
// نظام إدارة التمويل - Dashboard Module
// Version: 2.0.0
// Last Updated: 2026-08-02
// ============================================================
//
// المسؤوليات:
// - initDashboard() - تسجيل الدالة في Registry
// - loadDashboard() - الدالة الرئيسية (توجّه حسب الصلاحية)
// - loadDashboardData() - تحميل البيانات + بناء Indexes
// - حسابات مشتركة (calculateClientSummary, calculateInvestorSummary, calculateOperationSummary)
// - Render (أقسام + بطاقات + تنبيهات)
//
// يعتمد على:
// - core.js (APP, runQuery, debug, Constants, etc.)
// - auth.js (isAdmin, isClient, isInvestor, isViewer, etc.)
//
// ملاحظة: لا يحتوي على DOMContentLoaded (app.js هو Bootstrap)
// ============================================================


// ============================================================
// 1. INITIALIZATION
// ============================================================

function initDashboard() {
    debug('📊 بدء تهيئة dashboard.js', 'info');
    registerScreenLoader('dashboard', loadDashboard);
    debug('✅ dashboard.js جاهز', 'success');
}


// ============================================================
// 2. MAIN LOADER
// ============================================================

async function loadDashboard() {
    debug('📊 بدأ loadDashboard', 'info');
    
    if (!isSupabaseReady()) {
        debug('❌ Supabase غير جاهز', 'error');
        return;
    }
    
    showLoading();
    
    try {
        if (isClient()) {
            await loadDashboardForClient();
        } else if (isInvestor()) {
            await loadDashboardForInvestor();
        } else if (isViewer() && !isAdmin()) {
            await loadDashboardForViewer();
        } else {
            await loadDashboardForAdmin();
        }
        
        debug('✅ loadDashboard اكتمل', 'success');
    } catch (err) {
        debug('❌ خطأ في loadDashboard: ' + err.message, 'error');
    } finally {
        hideLoading();
    }
}


// ============================================================
// 3. DATA LOADING (مع Indexes)
// ============================================================

/**
 * تحميل جميع البيانات المطلوبة + بناء Indexes
 * يُستدعى مرة واحدة ثم يُستخدم في كل الدوال
 */
async function loadDashboardData() {
    debug('📥 تحميل بيانات Dashboard...', 'info');
    
    // تحميل البيانات (الأعمدة المطلوبة فقط)
    var opsResult = await runQuery(
        function() {
            return APP.supabase.from('operations').select(
                'id, name, status, amount, client_id, end_date, final_profit, profit_approval_date, is_archived'
            );
        },
        { context: 'loadDashboardData-ops', throwError: true }
    );
    
    var opInvResult = await runQuery(
        function() {
            return APP.supabase.from('operation_investors').select(
                'id, operation_id, investor_id, contribution, profit'
            );
        },
        { context: 'loadDashboardData-opInv', throwError: true }
    );
    
    var transResult = await runQuery(
        function() {
            return APP.supabase.from('transfers').select(
                'id, operation_id, investor_id, purpose, amount'
            );
        },
        { context: 'loadDashboardData-trans', throwError: true }
    );
    
    var invResult = await runQuery(
        function() {
            return APP.supabase.from('investors').select(
                'id, name, is_archived'
            );
        },
        { context: 'loadDashboardData-inv', throwError: true }
    );
    
    var clientsResult = await runQuery(
        function() {
            return APP.supabase.from('clients').select(
                'id, name, is_archived'
            );
        },
        { context: 'loadDashboardData-clients', throwError: true }
    );
    
    var operations = opsResult.data || [];
    var operationInvestors = opInvResult.data || [];
    var transfers = transResult.data || [];
    var investors = invResult.data || [];
    var clients = clientsResult.data || [];
    
    // بناء Indexes مرة واحدة
    var indexes = buildIndexes(operations, operationInvestors, transfers, investors, clients);
    
    return {
        operations: operations,
        operationInvestors: operationInvestors,
        transfers: transfers,
        investors: investors,
        clients: clients,
        indexes: indexes
    };
}

/**
 * بناء Indexes للبيانات
 * يمنع N+1 Query Problem
 */
function buildIndexes(operations, operationInvestors, transfers, investors, clients) {
    var operationsById = {};
    var clientsById = {};
    var investorsById = {};
    var clientOperations = {};
    var investorContributions = {};
    var transfersByOperation = {};
    var transfersByInvestor = {};
    var opInvestorsByOperation = {};
    var opInvestorsByInvestor = {};
    
    // Index العمليات
    operations.forEach(function(op) {
        operationsById[op.id] = op;
        
        // تجميع عمليات العميل
        if (!clientOperations[op.client_id]) {
            clientOperations[op.client_id] = [];
        }
        clientOperations[op.client_id].push(op);
    });
    
    // Index العملاء
    clients.forEach(function(c) {
        clientsById[c.id] = c;
    });
    
    // Index الممولين
    investors.forEach(function(inv) {
        investorsById[inv.id] = inv;
    });
    
    // Index مساهمات الممولين
    operationInvestors.forEach(function(oi) {
        // حسب العملية
        if (!opInvestorsByOperation[oi.operation_id]) {
            opInvestorsByOperation[oi.operation_id] = [];
        }
        opInvestorsByOperation[oi.operation_id].push(oi);
        
        // حسب الممول
        if (!opInvestorsByInvestor[oi.investor_id]) {
            opInvestorsByInvestor[oi.investor_id] = [];
        }
        opInvestorsByInvestor[oi.investor_id].push(oi);
    });
    
    // Index التحويلات
    transfers.forEach(function(t) {
        // حسب العملية
        if (t.operation_id) {
            if (!transfersByOperation[t.operation_id]) {
                transfersByOperation[t.operation_id] = [];
            }
            transfersByOperation[t.operation_id].push(t);
        }
        
        // حسب الممول
        if (t.investor_id) {
            if (!transfersByInvestor[t.investor_id]) {
                transfersByInvestor[t.investor_id] = [];
            }
            transfersByInvestor[t.investor_id].push(t);
        }
    });
    
    return {
        operationsById: operationsById,
        clientsById: clientsById,
        investorsById: investorsById,
        clientOperations: clientOperations,
        investorContributions: opInvestorsByInvestor,
        transfersByOperation: transfersByOperation,
        transfersByInvestor: transfersByInvestor,
        opInvestorsByOperation: opInvestorsByOperation,
        opInvestorsByInvestor: opInvestorsByInvestor
    };
}


// ============================================================
// 4. CALCULATIONS (دوال مشتركة)
// ============================================================

/**
 * حساب ملخص العميل
 * يُستخدم في Dashboard + شاشة العملاء
 */
function calculateClientSummary(clientId, data) {
    var ops = data.indexes.clientOperations[clientId] || [];
    var activeOps = 0;
    var completedOps = 0;
    var draftOps = 0;
    var totalFunded = 0;
    var totalRepaid = 0;
    var lastOperation = null;
    
    ops.forEach(function(op) {
        totalFunded += parseFloat(op.amount || 0);
        
        if (op.status === STATUS.ACTIVE) activeOps++;
        else if (op.status === STATUS.COMPLETED) completedOps++;
        else if (op.status === STATUS.DRAFT) draftOps++;
        
        if (!lastOperation || new Date(op.created_at) > new Date(lastOperation.created_at)) {
            lastOperation = op;
        }
    });
    
    // حساب المدفوع من التحويلات
    ops.forEach(function(op) {
        var opTransfers = data.indexes.transfersByOperation[op.id] || [];
        opTransfers.forEach(function(t) {
            if (t.purpose === 'client_repayment') {
                totalRepaid += parseFloat(t.amount || 0);
            }
        });
    });
    
    var balance = totalRepaid - totalFunded;
    
    return {
        totalOperations: ops.length,
        activeOperations: activeOps,
        completedOperations: completedOps,
        draftOperations: draftOps,
        totalFunded: totalFunded,
        totalRepaid: totalRepaid,
        balance: balance,
        lastOperation: lastOperation
    };
}

/**
 * حساب ملخص الممول
 * يُستخدم في Dashboard + شاشة الممولين
 */
function calculateInvestorSummary(investorId, data) {
    var contribs = data.indexes.opInvestorsByInvestor[investorId] || [];
    var myTransfers = data.indexes.transfersByInvestor[investorId] || [];
    
    var totalCapital = 0;
    var workingCapital = 0;
    var capitalReturned = 0;
    var totalProfit = 0;
    var profitPaid = 0;
    var activeOps = 0;
    var totalOps = contribs.length;
    
    contribs.forEach(function(c) {
        var contribution = parseFloat(c.contribution || 0);
        var profit = parseFloat(c.profit || 0);
        
        totalCapital += contribution;
        totalProfit += profit;
        
        var op = data.indexes.operationsById[c.operation_id];
        if (op && (op.status === STATUS.ACTIVE || op.status === STATUS.DRAFT)) {
            workingCapital += contribution;
            if (op.status === STATUS.ACTIVE) activeOps++;
        }
    });
    
    myTransfers.forEach(function(t) {
        if (t.purpose === 'capital_return') {
            capitalReturned += parseFloat(t.amount || 0);
        } else if (t.purpose === 'profit_distribution') {
            profitPaid += parseFloat(t.amount || 0);
        }
    });
    
    var capitalPending = Math.max(0, (totalCapital - workingCapital) - capitalReturned);
    var outstandingProfit = Math.max(0, totalProfit - profitPaid);
    var currentBalance = capitalPending + outstandingProfit;
    
    return {
        totalCapital: totalCapital,
        workingCapital: workingCapital,
        capitalReturned: capitalReturned,
        capitalPending: capitalPending,
        totalProfit: totalProfit,
        profitPaid: profitPaid,
        outstandingProfit: outstandingProfit,
        currentBalance: currentBalance,
        activeOperations: activeOps,
        totalOperations: totalOps
    };
}

/**
 * حساب ملخص العملية
 * يُستخدم في Dashboard + شاشة العمليات
 */
function calculateOperationSummary(operationId, data) {
    var op = data.indexes.operationsById[operationId];
    if (!op) return null;
    
    var opInv = data.indexes.opInvestorsByOperation[operationId] || [];
    var opTransfers = data.indexes.transfersByOperation[operationId] || [];
    
    var investorCount = opInv.length;
    var totalInvested = 0;
    var totalInvestorProfit = 0;
    var clientRepaid = 0;
    var capitalReturned = 0;
    var distributedProfit = 0;
    
    opInv.forEach(function(oi) {
        totalInvested += parseFloat(oi.contribution || 0);
        totalInvestorProfit += parseFloat(oi.profit || 0);
    });
    
    opTransfers.forEach(function(t) {
        if (t.purpose === 'client_repayment') {
            clientRepaid += parseFloat(t.amount || 0);
        } else if (t.purpose === 'capital_return') {
            capitalReturned += parseFloat(t.amount || 0);
        } else if (t.purpose === 'profit_distribution') {
            distributedProfit += parseFloat(t.amount || 0);
        }
    });
    
    // حساب ربح الشركة
    var companyProfit = 0;
    if (op.company_profit_type === 'percentage' && op.final_profit) {
        companyProfit = (parseFloat(op.final_profit) * parseFloat(op.company_profit_value || 0)) / 100;
    } else if (op.company_profit_type === 'fixed') {
        companyProfit = parseFloat(op.company_profit_value || 0);
    }
    
    var investorProfitShare = Math.max(0, (parseFloat(op.final_profit) || 0) - companyProfit);
    var remainingProfit = Math.max(0, investorProfitShare - distributedProfit);
    
    return {
        investorCount: investorCount,
        totalInvested: totalInvested,
        totalInvestorProfit: totalInvestorProfit,
        companyProfit: companyProfit,
        clientRepaid: clientRepaid,
        capitalReturned: capitalReturned,
        distributedProfit: distributedProfit,
        remainingProfit: remainingProfit,
        operation: op
    };
}


// ============================================================
// 5. RENDER HELPERS
// ============================================================

/**
 * بناء بطاقة إحصائية
 */
function renderStatCard(title, value, colorClass, options) {
    options = options || {};
    var clickAttr = '';
    
    if (options.action === 'showScreen') {
        clickAttr = ' data-action="showScreen" data-screen="' + options.screen + '" style="cursor: pointer;"';
    } else if (options.action === 'navigateToEntity') {
        clickAttr = ' data-action="navigateToEntity" data-entity-type="' + options.entityType + '" data-entity-id="' + options.entityId + '" style="cursor: pointer;"';
    }
    
    var extraClass = options.profitField ? ' profit-field' : '';
    
    return '<div class="stat-card' + extraClass + '"' + clickAttr + '>' +
           '<h3>' + escapeHtml(title) + '</h3>' +
           '<div class="value ' + (colorClass || '') + '">' + value + '</div>' +
           '</div>';
}

/**
 * بناء تنبيه
 */
function renderAlert(alert) {
    var clickAttr = '';
    
    if (alert.action === 'showScreen') {
        clickAttr = ' data-action="showScreen" data-screen="' + alert.screen + '" style="cursor: pointer;"';
    } else if (alert.action === 'navigateToEntity') {
        clickAttr = ' data-action="navigateToEntity" data-entity-type="' + alert.entityType + '" data-entity-id="' + alert.entityId + '" style="cursor: pointer;"';
    }
    
    return '<div class="alert-box ' + (alert.type || 'info') + '"' + clickAttr + '>' +
           alert.icon + ' ' + escapeHtml(alert.message) +
           '</div>';
}

/**
 * بناء بطاقة إجراء
 */
function renderActionCard(action) {
    var clickAttr = '';
    
    if (action.action === 'showScreen') {
        clickAttr = ' data-action="showScreen" data-screen="' + action.screen + '" style="cursor: pointer;"';
    } else if (action.action === 'navigateToEntity') {
        clickAttr = ' data-action="navigateToEntity" data-entity-type="' + action.entityType + '" data-entity-id="' + action.entityId + '" style="cursor: pointer;"';
    }
    
    return '<div class="alert-box ' + (action.type || 'info') + '"' + clickAttr + '>' +
           action.icon + ' ' + escapeHtml(action.message) +
           ' <span style="float: left; font-weight: bold;">→</span>' +
           '</div>';
}

/**
 * بناء ترحيب
 */
function renderWelcome(name, subtitle) {
    return '<div style="background: white; padding: 20px; border-radius: 12px; margin-bottom: 20px; box-shadow: 0 2px 8px rgba(0,0,0,0.06);">' +
           '<h2 style="margin-bottom: 10px;">مرحباً، ' + escapeHtml(name) + '</h2>' +
           '<p style="color: #666;">' + escapeHtml(subtitle) + '</p>' +
           '</div>';
}

/**
 * بناء قسم (مع عنوان وحدود)
 */
function renderSection(title, icon, borderColor, content) {
    if (!content || content === '') return '';
    
    return '<div style="background: white; padding: 15px; border-radius: 12px; margin-bottom: 20px; box-shadow: 0 2px 8px rgba(0,0,0,0.06); border-right: 4px solid ' + borderColor + ';">' +
           '<h3 style="margin-bottom: 12px; color: #333;">' + icon + ' ' + escapeHtml(title) + '</h3>' +
           content +
           '</div>';
}


// ============================================================
// 6. ADMIN DASHBOARD
// ============================================================

async function loadDashboardForAdmin() {
    debug('👔 تحميل Dashboard للإدارة', 'info');
    
    var alertsContainer = document.getElementById('dashboardAlerts');
    var statsContainer = document.getElementById('dashboardStats');
    
    if (!alertsContainer || !statsContainer) {
        debug('⚠️ حاويات Dashboard غير موجودة', 'warning');
        return;
    }
    
    var data = await loadDashboardData();
    
    // بناء الأقسام الثلاثة
    var html = '';
    html += renderDashboardActions(data);
    html += renderDashboardAlerts(data);
    
    alertsContainer.innerHTML = html;
    statsContainer.innerHTML = renderDashboardStats(data);
}

async function loadDashboardForViewer() {
    debug('👁️ تحميل Dashboard للمراقب', 'info');
    await loadDashboardForAdmin();
}


// ============================================================
// 7. CLIENT DASHBOARD
// ============================================================

async function loadDashboardForClient() {
    debug('👤 تحميل Dashboard للعميل', 'info');
    
    var alertsContainer = document.getElementById('dashboardAlerts');
    var statsContainer = document.getElementById('dashboardStats');
    
    if (!alertsContainer || !statsContainer || !APP.currentEntityId) {
        debug('⚠️ حاويات Dashboard أو Entity ID غير موجودة', 'warning');
        return;
    }
    
    try {
        // تحميل بيانات العميل
        var clientResult = await runQuery(
            function() {
                return APP.supabase
                    .from('clients')
                    .select('id, name, email, phone')
                    .eq('id', APP.currentEntityId)
                    .single();
            },
            { context: 'loadDashboardClient', throwError: true }
        );
        
        var client = clientResult.data;
        
        // تحميل البيانات المطلوبة فقط
        var data = await loadDashboardData();
        
        // حساب الملخص باستخدام الدالة المشتركة
        var summary = calculateClientSummary(APP.currentEntityId, data);
        
        // تنبيهات العميل
        var alerts = [];
        
        if (summary.balance > 0) {
            alerts.push({
                type: 'info',
                icon: '💵',
                message: 'لديك رصيد غير مستخدم بقيمة ' + formatMoney(summary.balance),
                action: 'showScreen',
                screen: 'myAccount'
            });
        }
        
        // عمليات ستنتهي قريباً
        var ops = data.indexes.clientOperations[APP.currentEntityId] || [];
        ops.forEach(function(op) {
            if (op.status === STATUS.ACTIVE && op.end_date && isDateWithinDays(op.end_date, 7)) {
                alerts.push({
                    type: 'warning',
                    icon: '⏰',
                    message: 'عملية "' + op.name + '" ستنتهي قريباً (' + formatDate(op.end_date) + ')',
                    action: 'navigateToEntity',
                    entityType: 'operation',
                    entityId: op.id
                });
            }
        });
        
        // عرض Dashboard
        var html = '';
        html += renderWelcome(client.name, 'هذه لوحة التحكم الخاصة بك');
        
        if (alerts.length > 0) {
            var alertsHtml = '';
            alerts.forEach(function(alert) {
                alertsHtml += renderAlert(alert);
            });
            html += alertsHtml;
        }
        
        alertsContainer.innerHTML = html;
        
        // البطاقات
        var statsHtml = '';
        statsHtml += renderStatCard('إجمالي التمويلات', formatMoney(summary.totalFunded), '');
        statsHtml += renderStatCard('إجمالي المدفوع', formatMoney(summary.totalRepaid), 'green');
        statsHtml += renderStatCard('الرصيد الحالي', formatMoney(summary.balance), summary.balance >= 0 ? 'green' : 'red');
        statsHtml += renderStatCard('عمليات نشطة', summary.activeOperations, 'blue');
        statsHtml += renderStatCard('عمليات منتهية', summary.completedOperations, '');
        statsHtml += renderStatCard('مسودات', summary.draftOperations, '');
        
        statsContainer.innerHTML = statsHtml;
        
    } catch (err) {
        debug('❌ خطأ في loadDashboardForClient: ' + err.message, 'error');
        alertsContainer.innerHTML = '<div class="error-box">حدث خطأ في تحميل البيانات</div>';
    }
}


// ============================================================
// 8. INVESTOR DASHBOARD
// ============================================================

async function loadDashboardForInvestor() {
    debug('💼 تحميل Dashboard للممول', 'info');
    
    var alertsContainer = document.getElementById('dashboardAlerts');
    var statsContainer = document.getElementById('dashboardStats');
    
    if (!alertsContainer || !statsContainer || !APP.currentEntityId) {
        debug('⚠️ حاويات Dashboard أو Entity ID غير موجودة', 'warning');
        return;
    }
    
    try {
        // تحميل بيانات الممول
        var invResult = await runQuery(
            function() {
                return APP.supabase
                    .from('investors')
                    .select('id, name, email, phone')
                    .eq('id', APP.currentEntityId)
                    .single();
            },
            { context: 'loadDashboardInvestor', throwError: true }
        );
        
        var investor = invResult.data;
        
        // تحميل البيانات المطلوبة
        var data = await loadDashboardData();
        
        // حساب الملخص باستخدام الدالة المشتركة
        var summary = calculateInvestorSummary(APP.currentEntityId, data);
        
        // تنبيهات الممول
        var alerts = [];
        
        if (summary.outstandingProfit > 0 && canViewProfits()) {
            alerts.push({
                type: 'warning',
                icon: '💰',
                message: 'لديك أرباح مستحقة بقيمة ' + formatMoney(summary.outstandingProfit),
                action: 'showScreen',
                screen: 'myAccount'
            });
        }
        
        if (summary.capitalPending > 0) {
            alerts.push({
                type: 'info',
                icon: '🏦',
                message: 'لديك رأس مال جاهز للإرجاع بقيمة ' + formatMoney(summary.capitalPending),
                action: 'showScreen',
                screen: 'myAccount'
            });
        }
        
        // عرض Dashboard
        var html = '';
        html += renderWelcome(investor.name, 'هذه لوحة التحكم الخاصة بك');
        
        if (alerts.length > 0) {
            var alertsHtml = '';
            alerts.forEach(function(alert) {
                alertsHtml += renderAlert(alert);
            });
            html += alertsHtml;
        }
        
        alertsContainer.innerHTML = html;
        
        // البطاقات
        var statsHtml = '';
        statsHtml += renderStatCard('رأس المال الكلي', formatMoney(summary.totalCapital), '');
        statsHtml += renderStatCard('المستثمر حالياً', formatMoney(summary.workingCapital), 'orange');
        statsHtml += renderStatCard('رأس المال المُرجع', formatMoney(summary.capitalReturned), 'green');
        statsHtml += renderStatCard('المتاح للإرجاع', formatMoney(summary.capitalPending), 'blue');
        
        if (canViewProfits()) {
            statsHtml += renderStatCard('الأرباح المستحقة', formatMoney(summary.outstandingProfit), 'green', { profitField: true });
            statsHtml += renderStatCard('الأرباح المصروفة', formatMoney(summary.profitPaid), '', { profitField: true });
        }
        
        statsHtml += renderStatCard('الرصيد الحالي', formatMoney(summary.currentBalance), summary.currentBalance >= 0 ? 'green' : 'red');
        statsHtml += renderStatCard('عمليات نشطة', summary.activeOperations, 'blue');
        statsHtml += renderStatCard('إجمالي المشاركات', summary.totalOperations, '');
        
        statsContainer.innerHTML = statsHtml;
        
    } catch (err) {
        debug('❌ خطأ في loadDashboardForInvestor: ' + err.message, 'error');
        alertsContainer.innerHTML = '<div class="error-box">حدث خطأ في تحميل البيانات</div>';
    }
}


// ============================================================
// 9. RENDER ACTIONS
// ============================================================

function renderDashboardActions(data) {
    var actions = [];
    
    // 1. عمليات Draft في انتظار التفعيل
    var draftOps = data.operations.filter(function(op) {
        return op.status === STATUS.DRAFT && !op.is_archived;
    });
    
    if (draftOps.length > 0) {
        actions.push({
            type: 'warning',
            icon: '📝',
            message: draftOps.length + ' عملية مسودة في انتظار التفعيل',
            action: 'showScreen',
            screen: 'operations'
        });
    }
    
    // 2. عمليات تحتاج اعتماد الربح
    var needsApproval = data.operations.filter(function(op) {
        return op.status === STATUS.ACTIVE && 
               op.final_profit && 
               op.final_profit > 0 && 
               !op.profit_approval_date;
    });
    
    if (needsApproval.length > 0) {
        actions.push({
            type: 'warning',
            icon: '💰',
            message: needsApproval.length + ' عملية تحتاج اعتماد الربح',
            action: 'navigateToEntity',
            entityType: 'operation',
            entityId: needsApproval[0].id
        });
    }
    
    // 3. أرباح جاهزة للصرف
    var readyForProfitCount = 0;
    var firstReadyOp = null;
    
    data.operations.forEach(function(op) {
        if (op.status !== STATUS.ACTIVE && op.status !== STATUS.COMPLETED) return;
        if (!op.profit_approval_date) return;
        
        var summary = calculateOperationSummary(op.id, data);
        if (summary && summary.remainingProfit > 0) {
            readyForProfitCount++;
            if (!firstReadyOp) firstReadyOp = op;
        }
    });
    
    if (readyForProfitCount > 0) {
        actions.push({
            type: 'info',
            icon: '📊',
            message: readyForProfitCount + ' عملية بها أرباح جاهزة للصرف',
            action: 'navigateToEntity',
            entityType: 'operation',
            entityId: firstReadyOp.id
        });
    }
    
    // 4. رأس مال جاهز للإرجاع
    var readyForReturnCount = 0;
    var firstReturnOp = null;
    
    data.operations.forEach(function(op) {
        if (op.status !== STATUS.COMPLETED) return;
        
        var summary = calculateOperationSummary(op.id, data);
        if (summary && (summary.totalInvested - summary.capitalReturned) > 0) {
            readyForReturnCount++;
            if (!firstReturnOp) firstReturnOp = op;
        }
    });
    
    if (readyForReturnCount > 0) {
        actions.push({
            type: 'info',
            icon: '🏦',
            message: readyForReturnCount + ' عملية بها رأس مال جاهز للإرجاع',
            action: 'navigateToEntity',
            entityType: 'operation',
            entityId: firstReturnOp.id
        });
    }
    
    // 5. عملاء لديهم رصيد كبير غير مستخدم
    var clientsWithBalance = [];
    data.clients.forEach(function(client) {
        if (client.is_archived) return;
        
        var summary = calculateClientSummary(client.id, data);
        if (summary.balance > 100000) {
            clientsWithBalance.push({ client: client, balance: summary.balance });
        }
    });
    
    if (clientsWithBalance.length > 0) {
        actions.push({
            type: 'info',
            icon: '💵',
            message: clientsWithBalance.length + ' عميل لديهم رصيد كبير غير مستخدم',
            action: 'navigateToEntity',
            entityType: 'client',
            entityId: clientsWithBalance[0].client.id
        });
    }
    
    // إذا لا توجد إجراءات
    if (actions.length === 0) {
        return '<div style="background: #d4edda; color: #155724; padding: 15px; border-radius: 8px; margin-bottom: 20px; border: 1px solid #c3e6cb;">' +
               '✅ <strong>لا توجد إجراءات مطلوبة حالياً</strong> - كل شيء تحت السيطرة' +
               '</div>';
    }
    
    // بناء HTML
    var actionsHtml = '';
    actions.forEach(function(action) {
        actionsHtml += renderActionCard(action);
    });
    
    return renderSection('إجراءات مطلوبة', '⚡', '#fd7e14', actionsHtml);
}


// ============================================================
// 10. RENDER ALERTS
// ============================================================

function renderDashboardAlerts(data) {
    var alerts = [];
    var today = new Date().toISOString().split('T')[0];
    var next30Days = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    
    // 1. عمليات متأخرة
    data.operations.forEach(function(op) {
        if (op.status === STATUS.ACTIVE && op.end_date && op.end_date < today) {
            alerts.push({
                priority: 1,
                type: 'danger',
                icon: '🚨',
                message: 'عملية "' + op.name + '" متأخرة (كان يجب أن تنتهي ' + formatDate(op.end_date) + ')',
                action: 'navigateToEntity',
                entityType: 'operation',
                entityId: op.id
            });
        }
    });
    
    // 2. عمليات ستنتهي قريباً
    data.operations.forEach(function(op) {
        if (op.status === STATUS.ACTIVE && op.end_date && op.end_date >= today && op.end_date <= next30Days) {
            alerts.push({
                priority: 2,
                type: 'warning',
                icon: '⏰',
                message: 'عملية "' + op.name + '" ستنتهي قريباً (' + formatDate(op.end_date) + ')',
                action: 'navigateToEntity',
                entityType: 'operation',
                entityId: op.id
            });
        }
    });
    
    // 3. ممولون لديهم أرباح مستحقة
    data.investors.forEach(function(inv) {
        if (inv.is_archived) return;
        
        var summary = calculateInvestorSummary(inv.id, data);
        if (summary.outstandingProfit > 0) {
            alerts.push({
                priority: 3,
                type: 'warning',
                icon: '💰',
                message: 'الممول "' + inv.name + '" له أرباح مستحقة: ' + formatMoney(summary.outstandingProfit),
                action: 'navigateToEntity',
                entityType: 'investor',
                entityId: inv.id
            });
        }
    });
    
    // 4. عملاء لديهم رصيد غير مستخدم (صغير)
    data.clients.forEach(function(client) {
        if (client.is_archived) return;
        
        var summary = calculateClientSummary(client.id, data);
        if (summary.balance > 0 && summary.balance <= 100000) {
            alerts.push({
                priority: 4,
                type: 'info',
                icon: '💵',
                message: 'العميل "' + client.name + '" لديه رصيد: ' + formatMoney(summary.balance),
                action: 'navigateToEntity',
                entityType: 'client',
                entityId: client.id
            });
        }
    });
    
    // إذا لا توجد تنبيهات
    if (alerts.length === 0) {
        return '';
    }
    
    // ترتيب حسب الأولوية
    alerts.sort(function(a, b) { return a.priority - b.priority; });
    
    // أخذ أول 10 فقط
    var topAlerts = alerts.slice(0, 10);
    var hasMore = alerts.length > 10;
    
    // بناء HTML
    var alertsHtml = '';
    topAlerts.forEach(function(alert) {
        alertsHtml += renderAlert(alert);
    });
    
    if (hasMore) {
        alertsHtml += '<button class="btn btn-secondary btn-block" data-action="showScreen" data-screen="activityLog" style="margin-top: 10px;">';
        alertsHtml += 'عرض الكل (' + alerts.length + ') →';
        alertsHtml += '</button>';
    }
    
    return renderSection('تنبيهات (' + alerts.length + ')', '🔔', '#17a2b8', alertsHtml);
}


// ============================================================
// 11. RENDER STATS
// ============================================================

function renderDashboardStats(data) {
    var today = new Date().toISOString().split('T')[0];
    var next30Days = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    
    var totalActiveFunding = 0;
    var endingSoon = 0;
    var overdue = 0;
    var completed = 0;
    var draft = 0;
    var totalOutstandingInvestorProfit = 0;
    var totalOutstandingCapital = 0;
    
    data.operations.forEach(function(op) {
        if (op.status === STATUS.ACTIVE) {
            totalActiveFunding += parseFloat(op.amount || 0);
            
            if (op.end_date && op.end_date <= next30Days && op.end_date >= today) {
                endingSoon++;
            }
            if (op.end_date && op.end_date < today) {
                overdue++;
            }
            
            var summary = calculateOperationSummary(op.id, data);
            if (summary) {
                totalOutstandingCapital += Math.max(0, parseFloat(op.amount || 0) - summary.clientRepaid);
                totalOutstandingInvestorProfit += summary.remainingProfit;
            }
        }
        
        if (op.status === STATUS.COMPLETED) completed++;
        if (op.status === STATUS.DRAFT) draft++;
    });
    
    var activeClients = data.clients.filter(function(c) { return !c.is_archived; }).length;
    var activeInvestors = data.investors.filter(function(i) { return !i.is_archived; }).length;
    
    // بناء البطاقات
    var html = '';
    
    html += renderStatCard('التمويل النشط', formatMoney(totalActiveFunding), 'blue', {
        action: 'showScreen', screen: 'operations'
    });
    
    html += renderStatCard('عمليات متأخرة', overdue, 'red', {
        action: 'showScreen', screen: 'operations'
    });
    
    html += renderStatCard('تنتهي قريباً', endingSoon, 'orange', {
        action: 'showScreen', screen: 'operations'
    });
    
    html += renderStatCard('عمليات مكتملة', completed, 'green', {
        action: 'showScreen', screen: 'operations'
    });
    
    html += renderStatCard('مسودات', draft, '', {
        action: 'showScreen', screen: 'operations'
    });
    
    html += renderStatCard('إجمالي العمليات', data.operations.length, '', {
        action: 'showScreen', screen: 'operations'
    });
    
    html += renderStatCard('العملاء', activeClients, '', {
        action: 'showScreen', screen: 'clients'
    });
    
    html += renderStatCard('الممولين', activeInvestors, '', {
        action: 'showScreen', screen: 'investors'
    });
    
    // بطاقات مالية (مخفية عن Viewer)
    html += renderStatCard('رأس المال المستحق', formatMoney(totalOutstandingCapital), 'orange', {
        profitField: true
    });
    
    html += renderStatCard('أرباح مستحقة للممولين', formatMoney(totalOutstandingInvestorProfit), 'red', {
        profitField: true
    });
    
    return html;
}


// ============================================================
// END OF DASHBOARD.JS
// ============================================================
