// ============================================================
// نظام إدارة التمويل - FINANCIAL ENGINE (calculations.js)
// Version: 2.1.0 (Final - Reviewed & Corrected)
// Last Updated: 2026-08-05
// ============================================================
//
// RULE 1: هذا الملف هو المصدر الوحيد لكل الحسابات المالية.
// RULE 2: الأموال الفعلية من transfers فقط:
//         Funded   = Investor → Company
//         ClientFunded = Company → Client
//         Repaid   = Client → Company
//         Returned = Company → Investor (capital_return)
//         ProfitPaid = Company → Investor (profit_distribution)
// RULE 3: التعهدات (Committed) من operation_investors.contribution فقط.
// RULE 4: هذا الملف يحسب فقط — لا يكتب ولا يعدل بيانات.
// RULE 5: توافق رجعي كامل: كل أسماء الحقول القديمة محفوظة.
// RULE 6: مرونة الـ Indexes: يقرأ من أي شكل data متاح
//         (indexes أو raw arrays) مع إزالة التكرار بالـ id.
//
// يعتمد على: core.js (STATUS, helpers)
// يُستخدم من: dashboard.js, clients.js, investors.js, operations.js (لاحقاً)
// ============================================================

// ============================================================
// 0. SHARED HELPERS
// ============================================================

function _num(v) { var n = parseFloat(v); return isNaN(n) ? 0 : n; }

/**
 * تصنيف التحويل إلى حركات مالية.
 * type أولاً (الأدق)، ومع غيابه fallback بالـ purpose + investor_id
 * لأن بعض الشاشات تجلب التحويلات بدون عمود type.
 */
function _classify(t) {
    if (t.type) {
        return {
            investorFunding:   (t.type === 'investor_to_company'),
            clientFunding:     (t.type === 'company_to_client'),
            clientRepayment:   (t.type === 'client_to_company'),
            capitalReturn:     (t.type === 'company_to_investor' && t.purpose === 'capital_return'),
            profitDistribution:(t.type === 'company_to_investor' && t.purpose === 'profit_distribution')
        };
    }
    return {
        investorFunding:   (t.purpose === 'client_funding' && !!t.investor_id),
        clientFunding:     (t.purpose === 'client_funding' && !t.investor_id),
        clientRepayment:   (t.purpose === 'client_repayment'),
        capitalReturn:     (t.purpose === 'capital_return'),
        profitDistribution:(t.purpose === 'profit_distribution')
    };
}

function _sumClassified(transfers, key) {
    var s = 0;
    (transfers || []).forEach(function(t) {
        if (_classify(t)[key]) s += _num(t.amount);
    });
    return s;
}

/** تجميع تحويلات العميل من كل المصادر المتاحة (بدون فقدان المباشر) */
function _clientTransfers(clientId, data) {
    var seen = {}, out = [];
    function push(t) { if (!t || seen[t.id]) return; seen[t.id] = 1; out.push(t); }

    if (data.indexes && data.indexes.transfersByClient && data.indexes.transfersByClient[clientId]) {
        data.indexes.transfersByClient[clientId].forEach(push);
    }
    (data.transfers || []).forEach(function(t) { if (t.client_id === clientId) push(t); });

    var ops = (data.indexes && data.indexes.clientOperations && data.indexes.clientOperations[clientId])
        || (data.operations || []).filter(function(op) { return op.client_id === clientId; });
    ops.forEach(function(op) {
        var list = (data.indexes && data.indexes.transfersByOperation && data.indexes.transfersByOperation[op.id]) || [];
        list.forEach(function(t) {
            if (t.client_id === clientId) { push(t); return; }
            var c = _classify(t);
            if (c.clientFunding || c.clientRepayment) push(t);
        });
    });
    return out;
}

/** تجميع تحويلات الممول من كل المصادر المتاحة */
function _investorTransfers(investorId, data) {
    var seen = {}, out = [];
    function push(t) { if (!t || seen[t.id]) return; seen[t.id] = 1; out.push(t); }
    if (data.indexes && data.indexes.transfersByInvestor && data.indexes.transfersByInvestor[investorId]) {
        data.indexes.transfersByInvestor[investorId].forEach(push);
    }
    (data.transfers || []).forEach(function(t) { if (t.investor_id === investorId) push(t); });
    return out;
}

/** تجميع تحويلات العملية من كل المصادر المتاحة */
function _operationTransfers(operationId, data) {
    var seen = {}, out = [];
    function push(t) { if (!t || seen[t.id]) return; seen[t.id] = 1; out.push(t); }
    if (data.indexes && data.indexes.transfersByOperation && data.indexes.transfersByOperation[operationId]) {
        data.indexes.transfersByOperation[operationId].forEach(push);
    }
    (data.transfers || []).forEach(function(t) { if (t.operation_id === operationId) push(t); });
    return out;
}

/** حصة الشركة من الربح (نسبة / ثابت) */
function _companyShare(op, profitBase) {
    var base = _num(profitBase);
    if (!base || !op) return 0;
    if (op.company_profit_type === 'percentage') return (base * _num(op.company_profit_value)) / 100;
    if (op.company_profit_type === 'fixed') return _num(op.company_profit_value);
    return 0;
}

// ============================================================
// 1. CLIENT ENGINE
// ============================================================

function calculateClientSummary(clientId, data) {
    var ops = (data.indexes && data.indexes.clientOperations && data.indexes.clientOperations[clientId]) || [];
    if (ops.length === 0 && data.operations) {
        ops = data.operations.filter(function(op) { return op.client_id === clientId; });
    }

    var activeOps = 0, completedOps = 0, draftOps = 0;
    var expectedFunding = 0, totalExpectedProfit = 0, totalApprovedProfit = 0;
    var lastOperation = null;

    ops.forEach(function(op) {
        expectedFunding += _num(op.amount);               // قيمة العمليات (ليس أموالاً فعلية)
        totalExpectedProfit += _num(op.expected_profit);
        if (op.status === STATUS.ACTIVE) activeOps++;
        else if (op.status === STATUS.COMPLETED) completedOps++;
        else if (op.status === STATUS.DRAFT) draftOps++;
        if (op.final_profit && op.profit_approval_date) totalApprovedProfit += _num(op.final_profit);
        if (!lastOperation || new Date(op.created_at) > new Date(lastOperation.created_at)) lastOperation = op;
    });

    var ct = _clientTransfers(clientId, data);
    var totalFunded = _sumClassified(ct, 'clientFunding');    // Company → Client فقط
    var totalRepaid = _sumClassified(ct, 'clientRepayment');  // Client → Company فقط
    var balance = totalRepaid - totalFunded;

    return {
        totalOperations: ops.length,
        activeOperations: activeOps,
        completedOperations: completedOps,
        draftOperations: draftOps,
        totalFunded: totalFunded,
        totalRepaid: totalRepaid,
        totalApprovedProfit: totalApprovedProfit,
        balance: balance,
        lastOperation: lastOperation,
        expectedFunding: expectedFunding,
        totalExpectedProfit: totalExpectedProfit,
        outstanding: Math.max(0, totalFunded - totalRepaid)
    };
}

// ============================================================
// 2. INVESTOR ENGINE
// ============================================================

function calculateInvestorSummary(investorId, data) {
    var contribs = (data.indexes && data.indexes.opInvestorsByInvestor && data.indexes.opInvestorsByInvestor[investorId]) || [];
    var myTransfers = _investorTransfers(investorId, data);

    var totalCapital = 0, totalProfit = 0, activeOps = 0;
    contribs.forEach(function(c) {
        totalCapital += _num(c.contribution);             // Committed فقط
        totalProfit += _num(c.profit);
        var op = data.indexes && data.indexes.operationsById ? data.indexes.operationsById[c.operation_id] : null;
        if (op && op.status === STATUS.ACTIVE) activeOps++;
    });

    var fundedCapital   = _sumClassified(myTransfers, 'investorFunding');    // Investor → Company
    var capitalReturned = _sumClassified(myTransfers, 'capitalReturn');      // Company → Investor
    var profitPaid      = _sumClassified(myTransfers, 'profitDistribution'); // Company → Investor

    var capitalPending    = Math.max(0, fundedCapital - capitalReturned);
    var outstandingProfit = Math.max(0, totalProfit - profitPaid);
    var currentBalance    = capitalPending + outstandingProfit;

    return {
        totalCapital: totalCapital,
        workingCapital: fundedCapital,
        capitalReturned: capitalReturned,
        capitalPending: capitalPending,
        totalProfit: totalProfit,
        profitPaid: profitPaid,
        outstandingProfit: outstandingProfit,
        currentBalance: currentBalance,
        activeOperations: activeOps,
        totalOperations: contribs.length,
        fundedCapital: fundedCapital,
        remainingCommitment: Math.max(0, totalCapital - fundedCapital)
    };
}

// ============================================================
// 3. OPERATION ENGINE
// ============================================================

function getOperationFunding(operationId, data) {
    var op = data.indexes && data.indexes.operationsById ? data.indexes.operationsById[operationId] : null;
    var opInv = (data.indexes && data.indexes.opInvestorsByOperation && data.indexes.opInvestorsByOperation[operationId]) || [];
    var opTransfers = _operationTransfers(operationId, data);

    var required = op ? _num(op.amount) : 0;
    var committed = 0;
    var perInvestor = [];

    opInv.forEach(function(oi) {
        committed += _num(oi.contribution);
        var funded = 0, returned = 0, profitPaid = 0;
        opTransfers.forEach(function(t) {
            if (t.investor_id !== oi.investor_id) return;
            var c = _classify(t);
            if (c.investorFunding) funded += _num(t.amount);
            else if (c.capitalReturn) returned += _num(t.amount);
            else if (c.profitDistribution) profitPaid += _num(t.amount);
        });
        perInvestor.push({
            investorId: oi.investor_id, opInvestorId: oi.id,
            committed: _num(oi.contribution), profit: _num(oi.profit),
            funded: funded, returned: returned, profitPaid: profitPaid,
            remaining: Math.max(0, _num(oi.contribution) - funded),
            remainingCapital: Math.max(0, funded - returned),
            remainingProfit: Math.max(0, _num(oi.profit) - profitPaid)
        });
    });

    var funded = _sumClassified(opTransfers, 'investorFunding');       // لا يأتي أبداً من contribution
    var clientFunded = _sumClassified(opTransfers, 'clientFunding');

    return {
        required: required,
        committed: committed,
        funded: funded,
        clientFunded: clientFunded,
        remainingCommitment: Math.max(0, required - committed),
        remainingFunding: Math.max(0, required - funded),
        committedCoverage: required > 0 ? (committed / required) * 100 : 0,
        fundedCoverage: required > 0 ? (funded / required) * 100 : 0,
        perInvestor: perInvestor
    };
}

function getOperationProfits(operationId, data) {
    var op = data.indexes && data.indexes.operationsById ? data.indexes.operationsById[operationId] : null;
    if (!op) return null;
    var opInv = (data.indexes && data.indexes.opInvestorsByOperation && data.indexes.opInvestorsByOperation[operationId]) || [];
    var opTransfers = _operationTransfers(operationId, data);

    var investorEntitlement = 0;
    opInv.forEach(function(oi) { investorEntitlement += _num(oi.profit); });

    var expectedTotal = _num(op.expected_profit);
    var approvedTotal = (op.final_profit && op.profit_approval_date) ? _num(op.final_profit) : 0;

    var clientRepayment   = _sumClassified(opTransfers, 'clientRepayment');
    var clientFunded      = _sumClassified(opTransfers, 'clientFunding');
    var capitalReturned   = _sumClassified(opTransfers, 'capitalReturn');
    var profitDistributed = _sumClassified(opTransfers, 'profitDistribution');

    // ✅ المعادلة المصححة:
    // الربح المحصل = ما سدده العميل فوق ما استلمه (R − C).
    // صافي الشركة = الربح المحصل − ما وُزع على الممولين.
    var totalProfitCollected = Math.max(0, clientRepayment - clientFunded);
    var netProfit = Math.max(0, totalProfitCollected - profitDistributed);

    return {
        expectedTotal: expectedTotal,
        approvedTotal: approvedTotal,
        companyExpected: _companyShare(op, expectedTotal),
        companyApproved: _companyShare(op, approvedTotal),
        investorEntitlement: investorEntitlement,
        investorDistributed: profitDistributed,
        investorRemaining: Math.max(0, investorEntitlement - profitDistributed),
        capitalReturned: capitalReturned,
        totalProfitCollected: totalProfitCollected,
        netProfit: netProfit
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

function calculateOperationSummary(operationId, data) {
    var op = data.indexes && data.indexes.operationsById ? data.indexes.operationsById[operationId] : null;
    if (!op) return null;
    var f = getOperationFunding(operationId, data);
    var p = getOperationProfits(operationId, data);
    var opInv = (data.indexes && data.indexes.opInvestorsByOperation && data.indexes.opInvestorsByOperation[operationId]) || [];

    return {
        investorCount: opInv.length,
        totalInvested: f.committed,
        totalInvestorProfit: p.investorEntitlement,
        companyProfit: p.companyApproved,
        clientRepaid: _sumClassified(_operationTransfers(operationId, data), 'clientRepayment'),
        capitalReturned: p.capitalReturned,
        distributedProfit: p.investorDistributed,
        remainingProfit: p.investorRemaining,
        operation: op,
        committedCapital: f.committed,
        fundedCapital: f.funded,
        clientFunded: f.clientFunded,
        expectedCompanyProfit: p.companyExpected,
        realizedCompanyProfit: p.netProfit,
        coverage: { committedCoverage: f.committedCoverage, fundedCoverage: f.fundedCoverage }
    };
}

// ============================================================
// 4. STATEMENT ENGINE
// ============================================================

/**
 * دور التحويل داخل كشف طرف معين (include + isCredit).
 * type-first لكل الأنواع، وfallback بالـ purpose عند غياب type.
 */
function _statementRole(t, type) {
    var hasType = !!t.type;

    if (type === 'client') {
        if (hasType) {
            if (t.type === 'company_to_client') return { include: true, isCredit: false };
            if (t.type === 'client_to_company') return { include: true, isCredit: true };
            return { include: false };
        }
        if (t.purpose === 'client_repayment') return { include: true, isCredit: true };
        if (t.purpose === 'client_funding' && !t.investor_id) return { include: true, isCredit: false };
        return { include: false };
    }

    if (type === 'investor') {
        if (hasType) {
            if (t.type === 'investor_to_company') return { include: true, isCredit: false };
            if (t.type === 'company_to_investor') return { include: true, isCredit: true };
            return { include: false };
        }
        if (t.purpose === 'client_funding' && !!t.investor_id) return { include: true, isCredit: false };
        if (t.purpose === 'capital_return' || t.purpose === 'profit_distribution') return { include: true, isCredit: true };
        return { include: false };
    }

    // company: كل الأنواع الأربعة التي تخص الشركة بأي purpose
    if (hasType) {
        if (t.type === 'investor_to_company' || t.type === 'client_to_company') return { include: true, isCredit: true };
        if (t.type === 'company_to_client' || t.type === 'company_to_investor') return { include: true, isCredit: false };
        return { include: false }; // client ↔ investor لا يخص الشركة
    }
    if (t.purpose === 'client_funding' && !!t.investor_id) return { include: true, isCredit: true };
    if (t.purpose === 'client_repayment') return { include: true, isCredit: true };
    if (t.purpose === 'client_funding' && !t.investor_id) return { include: true, isCredit: false };
    if (t.purpose === 'capital_return' || t.purpose === 'profit_distribution') return { include: true, isCredit: false };
    return { include: false };
}

function buildStatement(transfers, indexes, type) {
    var statement = [];

    (transfers || []).forEach(function(t) {
        var role = _statementRole(t, type);
        if (!role.include) return;

        var op = indexes && indexes.operationsById ? indexes.operationsById[t.operation_id] : null;
        var inv = indexes && indexes.investorsById ? indexes.investorsById[t.investor_id] : null;

        statement.push({
            date: t.transfer_date,
            reference: t.reference_number || '-',
            type: (typeof getTransferTypeText === 'function') ? getTransferTypeText(t.type) : (t.type || '-'),
            purpose: (typeof getPurposeText === 'function') ? getPurposeText(t.purpose) : (t.purpose || '-'),
            operation: op ? op.name : '-',
            operationId: t.operation_id || null,
            investor: inv ? inv.name : '-',
            investorId: t.investor_id || null,
            amount: _num(t.amount),
            isCredit: role.isCredit,
            notes: t.notes || '-',
            created_at: t.created_at
        });
    });

    statement.sort(function(a, b) {
        return new Date(a.date || a.created_at) - new Date(b.date || b.created_at);
    });

    var runningBalance = 0;
    statement.forEach(function(item) {
        runningBalance += item.isCredit ? item.amount : -item.amount;
        item.runningBalance = runningBalance;
    });

    statement.reverse();
    return statement;
}

// ============================================================
// END OF CALCULATIONS.JS (v2.1.0)
// ============================================================
if (typeof debug === 'function') {
    debug('💸 بدء تهيئة calculations.js (v2.1.0)', 'info');
    debug('✅ calculations.js v2.1.0 جاهز', 'success');
}
