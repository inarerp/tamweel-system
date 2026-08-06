// ============================================================
// نظام إدارة التمويل - FINANCIAL ENGINE (calculations.js)
// Version: 4.0.0 (Final - Single Source of Truth)
// Last Updated: 2026-08-05
// ============================================================
//
// ARCHITECTURE
// ------------------------------------------------------------
// Operations        → Business Truth   (حالة العمل، العلاقات، القيم)
// Transfers         → Accounting Truth (الحركة المالية الفعلية فقط)
// Calculations      → Financial Engine (هذا الملف: أرقام + قواعد)
// operations.js     → Workflow Controller (ينفذ فقط، لا يحسب)
// Dashboard/Clients/Investors/Company → Presentation Layer (تعرض فقط)
//
// RULE 1: Operations are the business truth.
//         حالة العملية (status) تأتي من operations.status فقط —
//         لا تُشتق أبداً من التحويلات.
// RULE 2: Transfers are the accounting truth.
//         أي رقم "أموال تحركت فعلياً" مصدره transfers فقط.
// RULE 3: This file never changes workflow.
//         يحسب ويرجع قواعد فقط — لا Update/Insert/Delete أبداً.
// RULE 4: No screen is allowed to calculate financial numbers.
// RULE 5: Every financial number must come from this file only.
// RULE 6: Visibility ≠ Money.
//         ظهور العملية في ملف العميل ← operations.client_id
//         ظهور العملية في ملف الممول ← operation_investors
//         حتى لو لم يحدث أي تحويل. الملخص المالي فقط من transfers.
// RULE 7: No stored balances — كل الأرصدة Derived.
// RULE 8: ممنوع وجود أي معادلة مالية في أي ملف آخر.
//
// SECTIONS
// 1. Constants   2. Helpers        3. Client Engine
// 4. Investor    5. Operation      6. Company Engine
// 7. Statement   8. Timeline       9. Validation
// 10. Workflow Engine (آخر Section - قواعد فقط)
// ============================================================

if (typeof console !== 'undefined') {
    console.log('📊 calculations.js v4.0.0 loading...');
}

// ============================================================
// 1. CONSTANTS (لا أرقام سحرية)
// ============================================================

var TRANSFER_TYPES = Object.freeze({
    COMPANY_TO_CLIENT: 'company_to_client',
    CLIENT_TO_COMPANY: 'client_to_company',
    COMPANY_TO_INVESTOR: 'company_to_investor',
    INVESTOR_TO_COMPANY: 'investor_to_company',
    CLIENT_TO_INVESTOR: 'client_to_investor',
    INVESTOR_TO_CLIENT: 'investor_to_client'
});

var TRANSFER_PURPOSES = Object.freeze({
    CLIENT_FUNDING: 'client_funding',
    ADDITIONAL_FUNDING: 'additional_funding',
    CLIENT_REPAYMENT: 'client_repayment',
    CAPITAL_RETURN: 'capital_return',
    PROFIT_DISTRIBUTION: 'profit_distribution',
    SETTLEMENT: 'settlement',
    OTHER: 'other'
});

if (typeof STATUS === 'undefined') {
    var STATUS = { DRAFT: 'draft', ACTIVE: 'active', COMPLETED: 'completed', CANCELLED: 'cancelled' };
}

// ============================================================
// 2. SHARED HELPERS
// ============================================================

function _num(v) { var n = parseFloat(v); return isNaN(n) ? 0 : n; }

function _sum(list, pred) {
    var s = 0;
    (list || []).forEach(function(t) { if (pred(t)) s += _num(t.amount); });
    return s;
}

function _companyShare(op, profitBase) {
    var base = _num(profitBase);
    if (!base || !op) return 0;
    if (op.company_profit_type === 'percentage') return (base * _num(op.company_profit_value)) / 100;
    if (op.company_profit_type === 'fixed') return _num(op.company_profit_value);
    return 0;
}

function _hasKeys(obj) { return obj && Object.keys(obj).length > 0; }

/** توحيد الـ Indexes (memoized) - يقبل raw arrays أو indexes جاهزة */
function ensureIndexes(data) {
    data = data || {};
    if (data.__engineIndexes) return data.__engineIndexes;

    var src = data.indexes || {};
    var idx = {
        operationsById: src.operationsById || {},
        clientsById: src.clientsById || {},
        investorsById: src.investorsById || {},
        allOperations: data.operations || [],
        allTransfers: data.transfers || [],
        allOpInvestors: data.opInvestors || data.operationInvestors || []
    };

    idx.clientOperations = _hasKeys(src.clientOperations) ? src.clientOperations : {};
    (idx.allOperations).forEach(function(op) {
        if (!idx.operationsById[op.id]) idx.operationsById[op.id] = op;
        if (!_hasKeys(src.clientOperations)) {
            if (!idx.clientOperations[op.client_id]) idx.clientOperations[op.client_id] = [];
            idx.clientOperations[op.client_id].push(op);
        }
    });

    idx.opInvestorsByOperation = _hasKeys(src.opInvestorsByOperation) ? src.opInvestorsByOperation : {};
    idx.opInvestorsByInvestor = _hasKeys(src.opInvestorsByInvestor) ? src.opInvestorsByInvestor : {};
    if (!_hasKeys(src.opInvestorsByOperation) || !_hasKeys(src.opInvestorsByInvestor)) {
        (idx.allOpInvestors).forEach(function(oi) {
            if (!_hasKeys(src.opInvestorsByOperation)) {
                if (!idx.opInvestorsByOperation[oi.operation_id]) idx.opInvestorsByOperation[oi.operation_id] = [];
                idx.opInvestorsByOperation[oi.operation_id].push(oi);
            }
            if (!_hasKeys(src.opInvestorsByInvestor)) {
                if (!idx.opInvestorsByInvestor[oi.investor_id]) idx.opInvestorsByInvestor[oi.investor_id] = [];
                idx.opInvestorsByInvestor[oi.investor_id].push(oi);
            }
        });
    }

    idx.transfersByOperation = _hasKeys(src.transfersByOperation) ? src.transfersByOperation : {};
    idx.transfersByClient = _hasKeys(src.transfersByClient) ? src.transfersByClient : {};
    idx.transfersByInvestor = _hasKeys(src.transfersByInvestor) ? src.transfersByInvestor : {};
    if (!_hasKeys(src.transfersByOperation)) {
        (idx.allTransfers).forEach(function(t) {
            if (t.operation_id) {
                if (!idx.transfersByOperation[t.operation_id]) idx.transfersByOperation[t.operation_id] = [];
                idx.transfersByOperation[t.operation_id].push(t);
            }
            var clientId = t.client_id;
            if (!clientId && t.operation_id && idx.operationsById[t.operation_id]) {
                clientId = idx.operationsById[t.operation_id].client_id;
            }
            if (clientId) {
                if (!idx.transfersByClient[clientId]) idx.transfersByClient[clientId] = [];
                idx.transfersByClient[clientId].push(t);
            }
            if (t.investor_id) {
                if (!idx.transfersByInvestor[t.investor_id]) idx.transfersByInvestor[t.investor_id] = [];
                idx.transfersByInvestor[t.investor_id].push(t);
            }
        });
    }

    data.__engineIndexes = idx;
    return idx;
}

// ============================================================
// 3. CLIENT ENGINE
// (RULE 6: العمليات تظهر من client_id حتى بدون تحويلات؛
//  الأموال الفعلية من transfers فقط)
// ============================================================

function calculateClientSummary(clientId, data) {
    var idx = ensureIndexes(data);
    var ops = idx.clientOperations[clientId] || [];
    var clientTransfers = idx.transfersByClient[clientId] || [];

    var activeOps = 0, completedOps = 0, draftOps = 0;
    var expectedFunding = 0, totalExpectedProfit = 0, totalApprovedProfit = 0;
    var lastOperation = null;

    ops.forEach(function(op) {
        expectedFunding += _num(op.amount);
        totalExpectedProfit += _num(op.expected_profit);
        if (op.final_profit && op.profit_approval_date) totalApprovedProfit += _num(op.final_profit);
        if (op.status === STATUS.ACTIVE) activeOps++;
        else if (op.status === STATUS.COMPLETED) completedOps++;
        else if (op.status === STATUS.DRAFT) draftOps++;
        if (!lastOperation || new Date(op.created_at) > new Date(lastOperation.created_at)) lastOperation = op;
    });

    var actualFunded = _sum(clientTransfers, function(t) { return t.type === TRANSFER_TYPES.COMPANY_TO_CLIENT && t.purpose === TRANSFER_PURPOSES.CLIENT_FUNDING; });
    var totalRepaid = _sum(clientTransfers, function(t) { return t.type === TRANSFER_TYPES.CLIENT_TO_COMPANY && t.purpose === TRANSFER_PURPOSES.CLIENT_REPAYMENT; });

    return {
        totalOperations: ops.length,
        activeOperations: activeOps,
        completedOperations: completedOps,
        draftOperations: draftOps,
        totalFunded: actualFunded,
        actualFunded: actualFunded,
        expectedFunding: expectedFunding,
        totalRepaid: totalRepaid,
        outstanding: Math.max(0, actualFunded - totalRepaid),
        totalApprovedProfit: totalApprovedProfit,
        totalExpectedProfit: totalExpectedProfit,
        balance: totalRepaid - actualFunded,
        lastOperation: lastOperation
    };
}

function buildClientStatement(clientId, data) {
    var idx = ensureIndexes(data);
    return buildStatement(idx.transfersByClient[clientId] || [], idx, 'client');
}

// ============================================================
// 4. INVESTOR ENGINE
// ============================================================

function calculateInvestorSummary(investorId, data) {
    var idx = ensureIndexes(data);
    var contribs = idx.opInvestorsByInvestor[investorId] || [];
    var myTransfers = idx.transfersByInvestor[investorId] || [];

    var totalCapital = 0, totalProfit = 0, committedInActive = 0, activeOps = 0, completedOps = 0;
    contribs.forEach(function(c) {
        totalCapital += _num(c.contribution);
        totalProfit += _num(c.profit);
        var op = idx.operationsById[c.operation_id];
        if (op) {
            if (op.status === STATUS.ACTIVE) { committedInActive += _num(c.contribution); activeOps++; }
            else if (op.status === STATUS.COMPLETED) completedOps++;
        }
    });

    var fundedCapital = _sum(myTransfers, function(t) { return t.type === TRANSFER_TYPES.INVESTOR_TO_COMPANY; });
    var capitalReturned = _sum(myTransfers, function(t) { return t.type === TRANSFER_TYPES.COMPANY_TO_INVESTOR && t.purpose === TRANSFER_PURPOSES.CAPITAL_RETURN; });
    var profitPaid = _sum(myTransfers, function(t) { return t.type === TRANSFER_TYPES.COMPANY_TO_INVESTOR && t.purpose === TRANSFER_PURPOSES.PROFIT_DISTRIBUTION; });

    var capitalPending = Math.max(0, fundedCapital - capitalReturned);
    var outstandingProfit = Math.max(0, totalProfit - profitPaid);

    return {
        totalCapital: totalCapital,
        workingCapital: committedInActive,
        committedCapital: totalCapital,
        fundedCapital: fundedCapital,
        remainingCommitment: Math.max(0, totalCapital - fundedCapital),
        capitalReturned: capitalReturned,
        capitalPending: capitalPending,
        totalProfit: totalProfit,
        profitPaid: profitPaid,
        outstandingProfit: outstandingProfit,
        currentBalance: capitalPending + outstandingProfit,
        activeOperations: activeOps,
        completedOperations: completedOps,
        totalOperations: contribs.length
    };
}

function buildInvestorStatement(investorId, data) {
    var idx = ensureIndexes(data);
    return buildStatement(idx.transfersByInvestor[investorId] || [], idx, 'investor');
}

// ============================================================
// 5. OPERATION ENGINE (دوال صغيرة + مجمّع)
// ============================================================

function getOperationTransfers(operationId, data) {
    var idx = ensureIndexes(data);
    var list = idx.transfersByOperation[operationId] || [];
    var t = { investorFunding: 0, clientFunding: 0, clientRepayment: 0, capitalReturned: 0, profitDistributed: 0, list: list };
    list.forEach(function(x) {
        var a = _num(x.amount);
        if (x.type === TRANSFER_TYPES.INVESTOR_TO_COMPANY) t.investorFunding += a;
        else if (x.type === TRANSFER_TYPES.COMPANY_TO_CLIENT && x.purpose === TRANSFER_PURPOSES.CLIENT_FUNDING) t.clientFunding += a;
        else if (x.type === TRANSFER_TYPES.CLIENT_TO_COMPANY && x.purpose === TRANSFER_PURPOSES.CLIENT_REPAYMENT) t.clientRepayment += a;
        else if (x.type === TRANSFER_TYPES.COMPANY_TO_INVESTOR && x.purpose === TRANSFER_PURPOSES.CAPITAL_RETURN) t.capitalReturned += a;
        else if (x.type === TRANSFER_TYPES.COMPANY_TO_INVESTOR && x.purpose === TRANSFER_PURPOSES.PROFIT_DISTRIBUTION) t.profitDistributed += a;
    });
    return t;
}

function getOperationFunding(operationId, data) {
    var idx = ensureIndexes(data);
    var op = idx.operationsById[operationId];
    var opInv = idx.opInvestorsByOperation[operationId] || [];
    var tr = getOperationTransfers(operationId, data);
    var required = op ? _num(op.amount) : 0;

    var committed = 0;
    var perInvestor = [];
    opInv.forEach(function(oi) {
        committed += _num(oi.contribution);
        var funded = 0, returned = 0, profitPaid = 0;
        tr.list.forEach(function(x) {
            if (x.investor_id !== oi.investor_id) return;
            if (x.type === TRANSFER_TYPES.INVESTOR_TO_COMPANY) funded += _num(x.amount);
            else if (x.type === TRANSFER_TYPES.COMPANY_TO_INVESTOR && x.purpose === TRANSFER_PURPOSES.CAPITAL_RETURN) returned += _num(x.amount);
            else if (x.type === TRANSFER_TYPES.COMPANY_TO_INVESTOR && x.purpose === TRANSFER_PURPOSES.PROFIT_DISTRIBUTION) profitPaid += _num(x.amount);
        });
        perInvestor.push({
            investorId: oi.investor_id, opInvestorId: oi.id,
            committed: _num(oi.contribution), profit: _num(oi.profit),
            funded: funded, remaining: Math.max(0, _num(oi.contribution) - funded),
            returned: returned, profitPaid: profitPaid,
            remainingCapital: Math.max(0, funded - returned),
            remainingProfit: Math.max(0, _num(oi.profit) - profitPaid)
        });
    });

    return {
        required: required,
        committed: committed,
        funded: tr.investorFunding,
        clientFunded: tr.clientFunding,
        remainingCommitment: Math.max(0, required - committed),
        remainingFunding: Math.max(0, required - tr.investorFunding),
        committedCoverage: required > 0 ? (committed / required) * 100 : 0,
        fundedCoverage: required > 0 ? (tr.investorFunding / required) * 100 : 0,
        perInvestor: perInvestor
    };
}

function getOperationProfits(operationId, data) {
    var idx = ensureIndexes(data);
    var op = idx.operationsById[operationId];
    if (!op) return null;
    var tr = getOperationTransfers(operationId, data);
    var opInv = idx.opInvestorsByOperation[operationId] || [];

    var investorEntitlement = 0;
    opInv.forEach(function(oi) { investorEntitlement += _num(oi.profit); });

    var approvedTotal = (op.final_profit && op.profit_approval_date) ? _num(op.final_profit) : 0;
    var grossCollected = Math.max(0, tr.clientRepayment - tr.capitalReturned);

    return {
        expectedTotal: _num(op.expected_profit),
        approvedTotal: approvedTotal,
        companyExpected: _companyShare(op, op.expected_profit),
        companyApproved: _companyShare(op, approvedTotal),
        investorEntitlement: investorEntitlement,
        investorDistributed: tr.profitDistributed,
        investorRemaining: Math.max(0, investorEntitlement - tr.profitDistributed),
        grossCollected: grossCollected,
        netProfit: Math.max(0, grossCollected - tr.profitDistributed)
    };
}

function getCoverage(operationId, data) {
    var f = getOperationFunding(operationId, data);
    return {
        required: f.required, committed: f.committed, funded: f.funded,
        remainingCommitment: f.remainingCommitment, remainingFunding: f.remainingFunding,
        committedCoverage: f.committedCoverage, fundedCoverage: f.fundedCoverage
    };
}

/** المجمّع (توافق رجعي + الحقول الجديدة) */
function calculateOperationSummary(operationId, data) {
    var idx = ensureIndexes(data);
    var op = idx.operationsById[operationId];
    if (!op) return null;
    var f = getOperationFunding(operationId, data);
    var p = getOperationProfits(operationId, data);
    var tr = getOperationTransfers(operationId, data);
    return {
        investorCount: f.perInvestor.length,
        totalInvested: f.committed,
        committedCapital: f.committed,
        fundedCapital: f.funded,
        clientFunded: f.clientFunded,
        totalInvestorProfit: p.investorEntitlement,
        companyProfit: p.companyApproved,
        expectedCompanyProfit: p.companyExpected,
        realizedCompanyProfit: p.netProfit,
        clientRepaid: tr.clientRepayment,
        capitalReturned: tr.capitalReturned,
        distributedProfit: tr.profitDistributed,
        remainingProfit: p.investorRemaining,
        coverage: { committedCoverage: f.committedCoverage, fundedCoverage: f.fundedCoverage },
        operation: op
    };
}

// ============================================================
// 6. COMPANY ENGINE
// ============================================================

function getCompanyBalance(data) {
    var idx = ensureIndexes(data);
    var cashIn = _sum(idx.allTransfers, function(t) { return t.type === TRANSFER_TYPES.INVESTOR_TO_COMPANY || t.type === TRANSFER_TYPES.CLIENT_TO_COMPANY; });
    var cashOut = _sum(idx.allTransfers, function(t) { return t.type === TRANSFER_TYPES.COMPANY_TO_CLIENT || t.type === TRANSFER_TYPES.COMPANY_TO_INVESTOR; });
    return { cashIn: cashIn, cashOut: cashOut, balance: cashIn - cashOut };
}

function getCompanyProfit(data) {
    var idx = ensureIndexes(data);
    var expected = 0, approved = 0, collected = 0, distributed = 0;

    (idx.allOperations || []).forEach(function(op) {
        if (op.is_archived) return;
        if (op.status === STATUS.ACTIVE) expected += _companyShare(op, op.expected_profit);
        if (op.final_profit && op.profit_approval_date) approved += _companyShare(op, op.final_profit);
        var tr = getOperationTransfers(op.id, data);
        collected += Math.max(0, tr.clientRepayment - tr.capitalReturned);
        distributed += tr.profitDistributed;
    });

    var bal = getCompanyBalance(data);
    return {
        expected: expected, approved: approved, collected: collected,
        distributed: distributed, netProfit: Math.max(0, collected - distributed),
        cashBalance: bal.balance
    };
}

function calculateCompanySummary(data) {
    var idx = ensureIndexes(data);
    var bal = getCompanyBalance(data);
    var profit = getCompanyProfit(data);

    var activeOps = 0, totalOps = 0;
    var expectedCashIn = 0, expectedCashOut = 0, activeCapital = 0;
    var outstandingClientBalance = 0, outstandingInvestorProfit = 0;

    (idx.allOperations || []).forEach(function(op) {
        if (op.is_archived) return;
        totalOps++;
        if (op.status !== STATUS.ACTIVE) return;
        activeOps++;

        var f = getOperationFunding(op.id, data);
        var p = getOperationProfits(op.id, data);
        var tr = getOperationTransfers(op.id, data);

        activeCapital += f.funded;
        var expectedFromClient = f.clientFunded + (p.approvedTotal || p.expectedTotal);
        expectedCashIn += Math.max(0, expectedFromClient - tr.clientRepayment);
        expectedCashOut += Math.max(0, f.funded - tr.capitalReturned) + Math.max(0, p.investorEntitlement - tr.profitDistributed);
        outstandingClientBalance += Math.max(0, f.clientFunded - tr.clientRepayment);
        outstandingInvestorProfit += Math.max(0, p.investorEntitlement - tr.profitDistributed);
    });

    return {
        balance: bal.balance, cashIn: bal.cashIn, cashOut: bal.cashOut,
        currentCash: bal.balance,
        expectedCashIn: expectedCashIn,
        expectedCashOut: expectedCashOut,
        activeCapital: activeCapital,
        outstandingClientBalance: outstandingClientBalance,
        outstandingInvestorProfit: outstandingInvestorProfit,
        expectedProfit: profit.expected, approvedProfit: profit.approved,
        collectedProfit: profit.collected, distributedProfit: profit.distributed,
        netProfit: profit.netProfit,
        activeOperations: activeOps, totalOperations: totalOps
    };
}

function buildCompanyStatement(data) {
    var idx = ensureIndexes(data);
    return buildStatement(idx.allTransfers || [], idx, 'company');
}

// ============================================================
// 7. STATEMENT ENGINE
// ============================================================

function buildStatement(transfers, indexes, type) {
    var idx = (indexes && (indexes.operationsById || indexes.transfersByOperation))
        ? ensureIndexes({ indexes: indexes, transfers: transfers })
        : ensureIndexes({ transfers: transfers });
    var statement = [];

    (transfers || []).forEach(function(t) {
        var op = idx.operationsById[t.operation_id] || null;
        var inv = idx.investorsById[t.investor_id] || null;
        var cli = idx.clientsById[t.client_id] || null;

        var isCredit = false;
        if (type === 'client') isCredit = (t.purpose === TRANSFER_PURPOSES.CLIENT_REPAYMENT);
        else if (type === 'investor') isCredit = (t.purpose === TRANSFER_PURPOSES.CAPITAL_RETURN || t.purpose === TRANSFER_PURPOSES.PROFIT_DISTRIBUTION);
        else if (type === 'company') isCredit = (t.type === TRANSFER_TYPES.INVESTOR_TO_COMPANY || t.type === TRANSFER_TYPES.CLIENT_TO_COMPANY);

        statement.push({
            date: t.transfer_date,
            reference: t.reference_number || '-',
            type: (typeof getTransferTypeText === 'function') ? getTransferTypeText(t.type) : t.type,
            purpose: (typeof getPurposeText === 'function') ? getPurposeText(t.purpose) : t.purpose,
            operation: op ? op.name : '-',
            operationId: t.operation_id || null,
            investor: inv ? inv.name : '-',
            investorId: t.investor_id || null,
            client: cli ? cli.name : '-',
            clientId: t.client_id || null,
            amount: _num(t.amount),
            isCredit: isCredit,
            notes: t.notes || '-',
            created_at: t.created_at
        });
    });

    statement.sort(function(a, b) { return new Date(a.date || a.created_at) - new Date(b.date || b.created_at); });

    var runningBalance = 0;
    statement.forEach(function(item) {
        runningBalance += item.isCredit ? item.amount : -item.amount;
        item.runningBalance = runningBalance;
    });

    statement.reverse();
    return statement;
}

// ============================================================
// 8. TIMELINE ENGINE
// ============================================================

function buildOperationTimeline(operationId, data) {
    var idx = ensureIndexes(data);
    var op = idx.operationsById[operationId];
    if (!op) return [];

    var events = [];

    events.push({ date: op.created_at, type: 'operation_created', icon: '📝', title: 'إنشاء العملية', details: op.name, amount: _num(op.amount) });

    (idx.opInvestorsByOperation[operationId] || []).forEach(function(oi) {
        var inv = idx.investorsById[oi.investor_id];
        events.push({ date: oi.created_at || op.created_at, type: 'investor_added', icon: '🤝', title: 'إضافة ممول (تعهد)', details: inv ? inv.name : 'ممول', amount: _num(oi.contribution) });
    });

    (idx.transfersByOperation[operationId] || []).forEach(function(t) {
        var ev = _transferToTimelineEvent(t, idx);
        if (ev) events.push(ev);
    });

    if (op.final_profit && op.profit_approval_date) {
        events.push({ date: op.profit_approval_date, type: 'profit_approved', icon: '✅', title: 'اعتماد الربح النهائي', details: '', amount: _num(op.final_profit) });
    }

    if (op.status === STATUS.COMPLETED) {
        events.push({ date: op.updated_at || op.end_date || op.created_at, type: 'operation_completed', icon: '🏁', title: 'إنهاء العملية وقفلها', details: '', amount: 0 });
    }

    (data.activityLogs || []).forEach(function(l) {
        if (l.entity_id !== operationId) return;
        var a = (l.action_type || l.action || '');
        if (a.indexOf('تفعيل') !== -1) events.push({ date: l.created_at, type: 'operation_activated', icon: '🚀', title: 'تفعيل العملية', details: l.user_email || '', amount: 0 });
        else if (a.indexOf('فتح قفل') !== -1) events.push({ date: l.created_at, type: 'operation_unlocked', icon: '🔓', title: 'فتح قفل العملية', details: l.user_email || '', amount: 0 });
    });

    events.sort(function(a, b) { return new Date(a.date || 0) - new Date(b.date || 0); });
    return events;
}

function _transferToTimelineEvent(t, idx) {
    var a = _num(t.amount);
    var inv = t.investor_id && idx.investorsById[t.investor_id] ? idx.investorsById[t.investor_id].name : 'ممول';
    var cli = t.client_id && idx.clientsById[t.client_id] ? idx.clientsById[t.client_id].name : 'عميل';

    if (t.type === TRANSFER_TYPES.INVESTOR_TO_COMPANY) return { date: t.transfer_date, type: 'contribution_received', icon: '💼', title: 'استلام مساهمة ممول', details: inv, amount: a };
    if (t.type === TRANSFER_TYPES.COMPANY_TO_CLIENT && t.purpose === TRANSFER_PURPOSES.CLIENT_FUNDING) return { date: t.transfer_date, type: 'client_funded', icon: '💵', title: 'تحويل التمويل للعميل', details: cli, amount: a };
    if (t.type === TRANSFER_TYPES.CLIENT_TO_COMPANY && t.purpose === TRANSFER_PURPOSES.CLIENT_REPAYMENT) return { date: t.transfer_date, type: 'client_repayment', icon: '💰', title: 'سداد من العميل', details: cli, amount: a };
    if (t.type === TRANSFER_TYPES.COMPANY_TO_INVESTOR && t.purpose === TRANSFER_PURPOSES.PROFIT_DISTRIBUTION) return { date: t.transfer_date, type: 'profit_distributed', icon: '📊', title: 'توزيع أرباح لممول', details: inv, amount: a };
    if (t.type === TRANSFER_TYPES.COMPANY_TO_INVESTOR && t.purpose === TRANSFER_PURPOSES.CAPITAL_RETURN) return { date: t.transfer_date, type: 'capital_returned', icon: '🔄', title: 'إرجاع رأس مال لممول', details: inv, amount: a };
    return { date: t.transfer_date, type: 'transfer', icon: '🔁', title: 'تحويل', details: t.notes || '', amount: a };
}

// ============================================================
// 9. VALIDATION ENGINE
// ============================================================

function _vr() { return { valid: true, errors: [], warnings: [] }; }
function _vErr(r, m) { r.valid = false; r.errors.push(m); }
function _vWarn(r, m) { r.warnings.push(m); }

function validateFunding(operationId, data, investorId, amount) {
    var r = _vr();
    var idx = ensureIndexes(data);
    var op = idx.operationsById[operationId];
    if (!op) { _vErr(r, 'العملية غير موجودة'); return r; }
    if (op.is_locked) _vErr(r, 'العملية مقفلة - لا يمكن استلام مساهمات');
    if (op.status !== STATUS.DRAFT && op.status !== STATUS.ACTIVE) _vErr(r, 'لا يمكن استلام مساهمات في عملية منتهية أو ملغاة');
    if (_num(amount) <= 0) _vErr(r, 'المبلغ يجب أن يكون أكبر من صفر');

    var f = getOperationFunding(operationId, data);
    var pi = null;
    f.perInvestor.forEach(function(x) { if (x.investorId === investorId) pi = x; });
    if (!pi) _vErr(r, 'الممول غير مرتبط بهذه العملية');
    else if (_num(amount) > pi.remaining) _vErr(r, 'المبلغ أكبر من المتبقي من تعهد الممول (' + pi.remaining + ')');
    return r;
}

function validateClientTransfer(operationId, data, amount) {
    var r = _vr();
    var idx = ensureIndexes(data);
    var op = idx.operationsById[operationId];
    if (!op) { _vErr(r, 'العملية غير موجودة'); return r; }
    if (op.is_locked) _vErr(r, 'العملية مقفلة');
    if (op.status !== STATUS.ACTIVE) _vErr(r, 'العملية غير نشطة - فعّلها أولاً');

    var f = getOperationFunding(operationId, data);
    if (f.fundedCoverage < 100) _vErr(r, 'التمويل غير مكتمل (' + Math.round(f.fundedCoverage) + '%) - استلم باقي المساهمات أولاً');
    if (_num(amount) <= 0) _vErr(r, 'المبلغ يجب أن يكون أكبر من صفر');
    else if (_num(amount) > f.remainingFunding + 0.01) _vWarn(r, 'المبلغ أكبر من المتبقي لتمويل العملية');
    return r;
}

function validateClientRepayment(operationId, data, amount) {
    var r = _vr();
    var idx = ensureIndexes(data);
    var op = idx.operationsById[operationId];
    if (!op) { _vErr(r, 'العملية غير موجودة'); return r; }
    if (op.is_locked) _vErr(r, 'العملية مقفلة');
    if (op.status !== STATUS.ACTIVE) _vErr(r, 'العملية غير نشطة');
    if (_num(amount) <= 0) _vErr(r, 'المبلغ يجب أن يكون أكبر من صفر');

    var tr = getOperationTransfers(operationId, data);
    var p = getOperationProfits(operationId, data);
    var outstanding = Math.max(0, (tr.clientFunding + p.approvedTotal) - tr.clientRepayment);
    if (_num(amount) > outstanding && outstanding > 0) _vWarn(r, 'الدفعة أكبر من المستحق المتبقي على العميل');
    return r;
}

function validateProfitDistribution(operationId, data, amountsByInvestor) {
    var r = _vr();
    var idx = ensureIndexes(data);
    var op = idx.operationsById[operationId];
    if (!op) { _vErr(r, 'العملية غير موجودة'); return r; }
    if (op.is_locked) _vErr(r, 'العملية مقفلة');
    if (op.status !== STATUS.ACTIVE) _vErr(r, 'العملية غير نشطة');

    var p = getOperationProfits(operationId, data);
    if (p.approvedTotal <= 0) _vErr(r, 'لا يوجد ربح معتمد - اعتمد الربح أولاً');

    var f = getOperationFunding(operationId, data);
    var total = 0;
    Object.keys(amountsByInvestor || {}).forEach(function(invId) {
        var amt = _num(amountsByInvestor[invId]);
        if (amt <= 0) return;
        total += amt;
        var pi = null;
        f.perInvestor.forEach(function(x) { if (x.investorId === invId) pi = x; });
        if (!pi) _vErr(r, 'ممول غير مرتبط بالعملية');
        else if (amt > pi.remainingProfit + 0.01) _vErr(r, 'المبلغ أكبر من الربح المتبقي للممول (' + pi.remainingProfit + ')');
    });
    if (total <= 0) _vErr(r, 'لم يتم إدخال أي مبالغ للتوزيع');
    return r;
}

function validateCapitalReturn(operationId, data, amountsByInvestor) {
    var r = _vr();
    var idx = ensureIndexes(data);
    var op = idx.operationsById[operationId];
    if (!op) { _vErr(r, 'العملية غير موجودة'); return r; }
    if (op.is_locked) _vErr(r, 'العملية مقفلة');
    if (op.status !== STATUS.ACTIVE && op.status !== STATUS.COMPLETED) _vErr(r, 'لا يمكن إرجاع رأس المال في هذه الحالة');

    var f = getOperationFunding(operationId, data);
    var total = 0;
    Object.keys(amountsByInvestor || {}).forEach(function(invId) {
        var amt = _num(amountsByInvestor[invId]);
        if (amt <= 0) return;
        total += amt;
        var pi = null;
        f.perInvestor.forEach(function(x) { if (x.investorId === invId) pi = x; });
        if (!pi) _vErr(r, 'ممول غير مرتبط بالعملية');
        else if (amt > pi.remainingCapital + 0.01) _vErr(r, 'المبلغ أكبر من رأس المال المتبقي للممول (' + pi.remainingCapital + ')');
    });
    if (total <= 0) _vErr(r, 'لم يتم إدخال أي مبالغ للإرجاع');
    return r;
}

function validateActivate(operationId, data) {
    var r = _vr();
    var idx = ensureIndexes(data);
    var op = idx.operationsById[operationId];
    if (!op) { _vErr(r, 'العملية غير موجودة'); return r; }
    if (op.is_locked) _vErr(r, 'العملية مقفلة');
    if (op.status !== STATUS.DRAFT) _vErr(r, 'العملية ليست مسودة');
    var f = getOperationFunding(operationId, data);
    if (f.perInvestor.length === 0) _vErr(r, 'أضف ممولاً واحداً على الأقل');
    if (f.fundedCoverage < 100) _vErr(r, 'التمويل المستلم ' + Math.round(f.fundedCoverage) + '% فقط - يجب اكتمال 100%');
    return r;
}

function validateClose(operationId, data) {
    var r = _vr();
    var idx = ensureIndexes(data);
    var op = idx.operationsById[operationId];
    if (!op) { _vErr(r, 'العملية غير موجودة'); return r; }
    if (op.status !== STATUS.ACTIVE) _vErr(r, 'العملية غير نشطة');

    var f = getOperationFunding(operationId, data);
    var p = getOperationProfits(operationId, data);
    f.perInvestor.forEach(function(pi) {
        if (pi.remainingCapital > 0.01) _vWarn(r, 'لم يُرجع كامل رأس المال للممول (' + pi.remainingCapital + ' متبقي)');
        if (pi.remainingProfit > 0.01) _vWarn(r, 'لم يُوزع كامل الربح للممول (' + pi.remainingProfit + ' متبقي)');
    });
    if (p.investorRemaining > 0.01) _vWarn(r, 'توجد أرباح متبقية للممولين');
    return r;
}

// ============================================================
// 10. WORKFLOW ENGINE (آخر Section)
// قواعد فقط - يرجع حالة الأزرار (can*) - لا تنفيذ أبداً
// ============================================================

function getOperationWorkflowState(operationId, data) {
    var idx = ensureIndexes(data);
    var op = idx.operationsById[operationId];
    if (!op) return null;

    var f = getOperationFunding(operationId, data);
    var p = getOperationProfits(operationId, data);

    var isDraft = op.status === STATUS.DRAFT;
    var isActive = op.status === STATUS.ACTIVE;
    var isCompleted = op.status === STATUS.COMPLETED;
    var locked = !!op.is_locked;

    return {
        status: op.status,
        locked: locked,
        committedCoverage: f.committedCoverage,
        fundedCoverage: f.fundedCoverage,

        canEdit: isDraft && !locked,
        canReceiveFunding: !locked && (isDraft || isActive),
        canActivate: isDraft && !locked && f.fundedCoverage >= 100,
        canSendToClient: isActive && !locked && f.fundedCoverage >= 100,
        canReceiveRepayment: isActive && !locked,
        canApproveProfit: !locked && (isDraft || isActive),
        canDistributeProfit: isActive && !locked && p.approvedTotal > 0,
        canReturnCapital: !locked && (isActive || isCompleted),
        canClose: isActive && !locked,
        canUnlock: locked
    };
}

// ============================================================
// END OF FINANCIAL ENGINE (v4.0.0)
// ============================================================

if (typeof debug === 'function') {
    debug('💸 بدء تهيئة calculations.js (v4.0.0)', 'info');
    debug('✅ calculations.js v4.0.0 جاهز', 'success');
} else if (typeof console !== 'undefined') {
    console.log('✅ calculations.js v4.0.0 جاهز');
}
