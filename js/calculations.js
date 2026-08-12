// ============================================================
// نظام إدارة التمويل - FINANCIAL ENGINE (calculations.js)
// Version: 2.0.0 (Stabilization - Single Source of Truth)
// Last Updated: 2026-08-05
// ============================================================
//
// القواعد الذهبية لهذا الملف:
// RULE 1: هذا الملف هو المصدر الوحيد لكل الحسابات المالية.
//         لا يجوز لأي شاشة أن تحسب رقمًا ماليًا بنفسها.
// RULE 2: الأموال الفعلية تُشتق من transfers فقط:
//         - تمويل الممول الفعلي  = Investor → Company
//         - تمويل العميل الفعلي  = Company → Client
//         - سداد العميل          = Client → Company
//         - إرجاع رأس المال      = Company → Investor (purpose: capital_return)
//         - توزيع الأرباح        = Company → Investor (purpose: profit_distribution)
// RULE 3: التعهدات (Committed) تأتي من operation_investors.contribution
//         ولا تعني أن الأموال تحركت.
// RULE 4: هذا الملف يحسب فقط — لا يكتب ولا يعدل أي بيانات.
// RULE 5: التوافق الرجعي: كل أسماء الحقول القديمة محفوظة كما هي،
//         وأي معنى جديد يُضاف كحقل جديد أو يُصحَّح مع إبقاء البديل القديم.
//
// يعتمد على: core.js (STATUS, helpers)
// يُستخدم من: dashboard.js, clients.js, investors.js, operations.js (لاحقًا)
// ============================================================

// ============================================================
// 0. SHARED HELPERS
// ============================================================

function _num(v) { var n = parseFloat(v); return isNaN(n) ? 0 : n; }

/**
 * تصنيف التحويل إلى حركات مالية واضحة.
 * يعتمد على type أولًا (الأدق)، ومع غيابه (بعض الشاشات تجلب بدون type)
 * يرجع إلى purpose + investor_id حتى لا تنكسر أي شاشة حالية.
 */
function _classify(t) {
    if (t.type) {
        return {
            investorFunding:  (t.type === 'investor_to_company'),
            clientFunding:    (t.type === 'company_to_client'),
            clientRepayment:  (t.type === 'client_to_company'),
            capitalReturn:    (t.type === 'company_to_investor' && t.purpose === 'capital_return'),
            profitDistribution: (t.type === 'company_to_investor' && t.purpose === 'profit_distribution')
        };
    }
    return {
        investorFunding:  (t.purpose === 'client_funding' && !!t.investor_id),
        clientFunding:    (t.purpose === 'client_funding' && !t.investor_id),
        clientRepayment:  (t.purpose === 'client_repayment'),
        capitalReturn:    (t.purpose === 'capital_return'),
        profitDistribution: (t.purpose === 'profit_distribution')
    };
}

function _sumClassified(transfers, key) {
    var s = 0;
    (transfers || []).forEach(function(t) {
        if (_classify(t)[key]) s += _num(t.amount);
    });
    return s;
}

// ============================================================
// 1. CLIENT ENGINE
// ============================================================

/**
 * ملخص العميل.
 * التصحيح: totalFunded أصبح = التمويلات الفعلية (Company → Client).
 * القيمة القديمة (مجموع قيم العمليات) محفوظة باسم expectedFunding.
 */
function calculateClientSummary(clientId, data) {
    var ops = (data.indexes.clientOperations && data.indexes.clientOperations[clientId]) || [];
    if (ops.length === 0 && data.operations) {
        ops = data.operations.filter(function(op) { return op.client_id === clientId; });
    }

    var activeOps = 0, completedOps = 0, draftOps = 0;
    var expectedFunding = 0, totalExpectedProfit = 0, totalApprovedProfit = 0;
    var lastOperation = null;

    ops.forEach(function(op) {
        expectedFunding += _num(op.amount);
        totalExpectedProfit += _num(op.expected_profit);
        if (op.status === STATUS.ACTIVE) activeOps++;
        else if (op.status === STATUS.COMPLETED) completedOps++;
        else if (op.status === STATUS.DRAFT) draftOps++;
        if (op.final_profit && op.profit_approval_date) totalApprovedProfit += _num(op.final_profit);
        if (!lastOperation || new Date(op.created_at) > new Date(lastOperation.created_at)) lastOperation = op;
    });

    // ✅ الأموال الفعلية من التحويلات فقط (كل تحويلات عمليات العميل)
    var clientTransfers = [];
    ops.forEach(function(op) {
        var opTransfers = (data.indexes.transfersByOperation && data.indexes.transfersByOperation[op.id]) || [];
        opTransfers.forEach(function(t) { clientTransfers.push(t); });
    });

    var totalFunded = _sumClassified(clientTransfers, 'clientFunding');    // Company → Client
    var totalRepaid = _sumClassified(clientTransfers, 'clientRepayment');  // Client → Company
    var balance = totalRepaid - totalFunded;

    return {
        // حقول محفوظة (توافق رجعي)
        totalOperations: ops.length,
        activeOperations: activeOps,
        completedOperations: completedOps,
        draftOperations: draftOps,
        totalFunded: totalFunded,          // ✅ مصحح: فعلي من التحويلات
        totalRepaid: totalRepaid,
        totalApprovedProfit: totalApprovedProfit,
        balance: balance,
        lastOperation: lastOperation,
        // حقول جديدة
        expectedFunding: expectedFunding,
        totalExpectedProfit: totalExpectedProfit,
        outstanding: Math.max(0, totalFunded - totalRepaid)
    };
}

// ============================================================
// 2. INVESTOR ENGINE
// ============================================================

/**
 * ملخص الممول.
 * التصحيح: workingCapital أصبح = المستلم فعليًا (Investor → Company).
 * التصحيح: capitalPending = funded − returned.
 */
function calculateInvestorSummary(investorId, data) {
    var contribs = (data.indexes.opInvestorsByInvestor && data.indexes.opInvestorsByInvestor[investorId]) || [];
    var myTransfers = (data.indexes.transfersByInvestor && data.indexes.transfersByInvestor[investorId]) || [];

    var totalCapital = 0, totalProfit = 0, activeOps = 0;
    contribs.forEach(function(c) {
        totalCapital += _num(c.contribution);
        totalProfit += _num(c.profit);
        var op = data.indexes.operationsById ? data.indexes.operationsById[c.operation_id] : null;
        if (op && op.status === STATUS.ACTIVE) activeOps++;
    });

    // ✅ الأموال الفعلية من التحويلات فقط
    var fundedCapital   = _sumClassified(myTransfers, 'investorFunding');   // Investor → Company
    var capitalReturned = _sumClassified(myTransfers, 'capitalReturn');     // Company → Investor
    var profitPaid      = _sumClassified(myTransfers, 'profitDistribution');// Company → Investor

    var capitalPending   = Math.max(0, fundedCapital - capitalReturned);
    var outstandingProfit = Math.max(0, totalProfit - profitPaid);
    var currentBalance   = capitalPending + outstandingProfit;

    return {
        // حقول محفوظة (توافق رجعي)
        totalCapital: totalCapital,
        workingCapital: fundedCapital,     // ✅ مصحح: فعلي من التحويلات
        capitalReturned: capitalReturned,
        capitalPending: capitalPending,
        totalProfit: totalProfit,
        profitPaid: profitPaid,
        outstandingProfit: outstandingProfit,
        currentBalance: currentBalance,
        activeOperations: activeOps,
        totalOperations: contribs.length,
        // حقول جديدة
        fundedCapital: fundedCapital,
        remainingCommitment: Math.max(0, totalCapital - fundedCapital)
    };
}

// ============================================================
// 3. OPERATION ENGINE
// ============================================================

/**
 * حالة تمويل العملية (Committed vs Funded vs Remaining).
 * القاعدة: التفعيل يتطلب fundedCoverage = 100% وليس committed.
 */
function getOperationFunding(operationId, data) {
    var op = data.indexes.operationsById ? data.indexes.operationsById[operationId] : null;
    var opInv = (data.indexes.opInvestorsByOperation && data.indexes.opInvestorsByOperation[operationId]) || [];
    var opTransfers = (data.indexes.transfersByOperation && data.indexes.transfersByOperation[operationId]) || [];

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
            investorId: oi.investor_id,
            opInvestorId: oi.id,
            committed: _num(oi.contribution),
            profit: _num(oi.profit),
            funded: funded,
            returned: returned,
            profitPaid: profitPaid,
            remaining: Math.max(0, _num(oi.contribution) - funded),
            remainingCapital: Math.max(0, funded - returned),
            remainingProfit: Math.max(0, _num(oi.profit) - profitPaid)
        });
    });

    var funded = _sumClassified(opTransfers, 'investorFunding');
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

/**
 * أرباح العملية مصنفة (متوقع / معتمد / حصة الشركة / حصة الممولين / المتبقي).
 */
function getOperationProfits(operationId, data) {
    var op = data.indexes.operationsById ? data.indexes.operationsById[operationId] : null;
    if (!op) return null;
    var opInv = (data.indexes.opInvestorsByOperation && data.indexes.opInvestorsByOperation[operationId]) || [];
    var opTransfers = (data.indexes.transfersByOperation && data.indexes.transfersByOperation[operationId]) || [];

    var investorEntitlement = 0;
    opInv.forEach(function(oi) { investorEntitlement += _num(oi.profit); });

    var expectedTotal = _num(op.expected_profit);
    var approvedTotal = (op.final_profit && op.profit_approval_date) ? _num(op.final_profit) : 0;

    var companyExpected = _companyShare(op, expectedTotal);
    var companyApproved = _companyShare(op, approvedTotal);

    var investorDistributed = _sumClassified(opTransfers, 'profitDistribution');
    var capitalReturned = _sumClassified(opTransfers, 'capitalReturn');
    var clientRepayment = _sumClassified(opTransfers, 'clientRepayment');

    var grossCollected = Math.max(0, clientRepayment - capitalReturned);

    return {
        expectedTotal: expectedTotal,
        approvedTotal: approvedTotal,
        companyExpected: companyExpected,
        companyApproved: companyApproved,
        investorEntitlement: investorEntitlement,
        investorDistributed: investorDistributed,
        investorRemaining: Math.max(0, investorEntitlement - investorDistributed),
        grossCollected: grossCollected,
        netProfit: Math.max(0, grossCollected - investorDistributed)
    };
}

/** Coverage بنوعيه (للعرض ولقاعدة التفعيل) */
function getCoverage(operationId, data) {
    var f = getOperationFunding(operationId, data);
    return {
        required: f.required,
        committed: f.committed,
        funded: f.funded,
        remainingCommitment: f.remainingCommitment,
        remainingFunding: f.remainingFunding,
        committedCoverage: f.committedCoverage,
        fundedCoverage: f.fundedCoverage
    };
}

/** حصة الشركة من الربح حسب القاعدة (نسبة / ثابت) */
function _companyShare(op, profitBase) {
    var base = _num(profitBase);
    if (!base || !op) return 0;
    if (op.company_profit_type === 'percentage') return (base * _num(op.company_profit_value)) / 100;
    if (op.company_profit_type === 'fixed') return _num(op.company_profit_value);
    return 0;
}

/**
 * ملخص العملية (توافق رجعي كامل + الحقول الجديدة).
 */
function calculateOperationSummary(operationId, data) {
    var op = data.indexes.operationsById ? data.indexes.operationsById[operationId] : null;
    if (!op) return null;

    var f = getOperationFunding(operationId, data);
    var p = getOperationProfits(operationId, data);
    var opInv = (data.indexes.opInvestorsByOperation && data.indexes.opInvestorsByOperation[operationId]) || [];

    return {
        // حقول محفوظة (توافق رجعي)
        investorCount: opInv.length,
        totalInvested: f.committed,
        totalInvestorProfit: p.investorEntitlement,
        companyProfit: p.companyApproved,
        clientRepaid: _sumClassified((data.indexes.transfersByOperation && data.indexes.transfersByOperation[operationId]) || [], 'clientRepayment'),
        capitalReturned: _sumClassified((data.indexes.transfersByOperation && data.indexes.transfersByOperation[operationId]) || [], 'capitalReturn'),
        distributedProfit: p.investorDistributed,
        remainingProfit: p.investorRemaining,
        operation: op,
        // حقول جديدة
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
 * كشف الحساب مع الرصيد المتحرك.
 * التصحيح: كل كشف يشمل فقط الحركات الخاصة بطرفه:
 * - client:   Company↔Client فقط
 * - investor: Investor↔Company فقط
 * - company:  كل الحركات الأربع الرئيسية
 */
function buildStatement(transfers, indexes, type) {
    var statement = [];

    (transfers || []).forEach(function(t) {
        var c = _classify(t);

        var include = false, isCredit = false;
        if (type === 'client') {
            include = c.clientFunding || c.clientRepayment;
            isCredit = c.clientRepayment;              // العميل يدفع = رصيد له
        } else if (type === 'investor') {
            include = c.investorFunding || c.capitalReturn || c.profitDistribution;
            isCredit = c.capitalReturn || c.profitDistribution; // الممول يستلم = رصيد له
        } else if (type === 'company') {
            include = c.investorFunding || c.clientFunding || c.clientRepayment || c.capitalReturn || c.profitDistribution;
            isCredit = c.investorFunding || c.clientRepayment; // الداخل للشركة
        }
        if (!include) return;

        var op = indexes.operationsById ? indexes.operationsById[t.operation_id] : null;
        var inv = indexes.investorsById ? indexes.investorsById[t.investor_id] : null;

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
            isCredit: isCredit,
            notes: t.notes || '-',
            created_at: t.created_at
        });
    });

    // ترتيب زمني لحساب الرصيد المتحرك
    statement.sort(function(a, b) {
        return new Date(a.date || a.created_at) - new Date(b.date || b.created_at);
    });

    var runningBalance = 0;
    statement.forEach(function(item) {
        runningBalance += item.isCredit ? item.amount : -item.amount;
        item.runningBalance = runningBalance;
    });

    statement.reverse(); // الأحدث أولًا للعرض
    return statement;
}

// ============================================================
// END OF CALCULATIONS.JS (v2.0.0)
// ============================================================
if (typeof debug === 'function') {
    debug('💸 بدء تهيئة calculations.js (v2.0.0)', 'info');
    debug('✅ calculations.js v2.0.0 جاهز', 'success');
}
