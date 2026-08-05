// ============================================================
// نظام إدارة التمويل - Financial Engine (calculations.js)
// Version: 2.0.0 (Single Source of Truth)
// Last Updated: 2026-08-05
// ============================================================
//
// هذا الملف هو "العقل المحاسبي الوحيد" في النظام.
// يُمنع على أي ملف آخر كتابة معادلة مالية بنفسه.
// كل الشاشات تستدعي دوال هذا الملف فقط.
//
// ------------------------------------------------------------
// DATA OWNERSHIP MAP (مصدر كل معلومة)
// ------------------------------------------------------------
// Operation Value            -> operations.amount
// Operation Workflow Status  -> operations.status  (يُ_set فقط من عمليات الـ Workflow)
// Client Relation            -> operations.client_id
// Expected Profit            -> operations.expected_profit
// Approved Profit            -> operations.final_profit + profit_approval_date
// Company Profit Rule        -> operations.company_profit_type/value
// Investor Commitment        -> operation_investors.contribution
// Investor Profit Entitle.   -> operation_investors.profit
// Actual Money Movement      -> transfers  (الدفتر الرسمي الوحيد)
//
// قاعدة ذهبية #1: التحويلات = إثبات حركة مالية فقط.
//                 لا تُشتق حالة العملية (status) من التحويلات أبداً.
// قاعدة ذهبية #2: أي رقم "أموال تحركت فعلياً" مصدره transfers فقط.
// قاعدة ذهبية #3: لا يُخزن رصيد؛ كل الأرصدة Derived من transfers.
//
// ------------------------------------------------------------
// SECTIONS
// ------------------------------------------------------------
// 1. Client Engine
// 2. Investor Engine
// 3. Operation Engine
// 4. Company Engine
// 5. Statement Engine
// 6. Shared Helpers
// ============================================================

if (typeof STATUS === 'undefined') {
    var STATUS = { DRAFT: 'draft', ACTIVE: 'active', COMPLETED: 'completed', CANCELLED: 'cancelled' };
}

// ============================================================
// 1. CLIENT ENGINE
// ============================================================

/**
 * ملخص العميل - يُستخدم في: Dashboard + ملف العميل + حسابي
 * العلاقة بالعمليات مصدرها operations.client_id (وليس التحويلات).
 * الأموال الفعلية مصدرها transfers فقط.
 */
function calculateClientSummary(clientId, data) {
    var idx = ensureIndexes(data);
    var ops = idx.clientOperations[clientId] || [];
    var clientTransfers = idx.transfersByClient[clientId] || [];

    var activeOps = 0, completedOps = 0, draftOps = 0;
    var expectedFunding = 0;      // قيمة العمليات المرتبطة (commitment من الشركة للعميل)
    var totalExpectedProfit = 0;  // أرباح متوقعة
    var totalApprovedProfit = 0;  // أرباح معتمدة
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

    // ✅ الأموال الفعلية من Transfers فقط
    var actualFunded = _sum(clientTransfers, function(t) { return t.type === 'company_to_client' && t.purpose === 'client_funding'; });
    var totalRepaid  = _sum(clientTransfers, function(t) { return t.type === 'client_to_company' && t.purpose === 'client_repayment'; });

    return {
        // Counts (رجعي)
        totalOperations: ops.length,
        activeOperations: activeOps,
        completedOperations: completedOps,
        draftOperations: draftOps,
        // Financial (مصحح: فعلي من transfers)
        totalFunded: actualFunded,            // ✅ مصحح: ما حصل عليه العميل فعلياً
        actualFunded: actualFunded,
        expectedFunding: expectedFunding,     // قيمة العمليات المرتبطة
        totalRepaid: totalRepaid,
        outstanding: Math.max(0, actualFunded - totalRepaid),   // المتبقي على العميل
        totalApprovedProfit: totalApprovedProfit,
        totalExpectedProfit: totalExpectedProfit,
        balance: totalRepaid - actualFunded,  // سالب = مدين للشركة
        lastOperation: lastOperation
    };
}

/** كشف حساب العميل */
function buildClientStatement(clientId, data) {
    var idx = ensureIndexes(data);
    return buildStatement(idx.transfersByClient[clientId] || [], idx, 'client');
}

// ============================================================
// 2. INVESTOR ENGINE
// ============================================================

/**
 * ملخص الممول - يُستخدم في: Dashboard + ملف الممول + حسابي
 * الالتزامات من operation_investors، والأموال الفعلية من transfers.
 */
function calculateInvestorSummary(investorId, data) {
    var idx = ensureIndexes(data);
    var contribs = idx.opInvestorsByInvestor[investorId] || [];
    var myTransfers = idx.transfersByInvestor[investorId] || [];

    var totalCapital = 0, totalProfit = 0;
    var committedInActive = 0, activeOps = 0, completedOps = 0;

    contribs.forEach(function(c) {
        totalCapital += _num(c.contribution);
        totalProfit += _num(c.profit);
        var op = idx.operationsById[c.operation_id];
        if (op) {
            if (op.status === STATUS.ACTIVE) { committedInActive += _num(c.contribution); activeOps++; }
            else if (op.status === STATUS.COMPLETED) completedOps++;
        }
    });

    // ✅ الأموال الفعلية من Transfers فقط
    var fundedCapital   = _sum(myTransfers, function(t) { return t.type === 'investor_to_company'; });
    var capitalReturned = _sum(myTransfers, function(t) { return t.type === 'company_to_investor' && t.purpose === 'capital_return'; });
    var profitPaid      = _sum(myTransfers, function(t) { return t.type === 'company_to_investor' && t.purpose === 'profit_distribution'; });

    var capitalPending    = Math.max(0, fundedCapital - capitalReturned); // رأس مال ما زال بالشركة
    var outstandingProfit = Math.max(0, totalProfit - profitPaid);

    return {
        // رجعي
        totalCapital: totalCapital,
        workingCapital: committedInActive,
        capitalReturned: capitalReturned,
        capitalPending: capitalPending,
        totalProfit: totalProfit,
        profitPaid: profitPaid,
        outstandingProfit: outstandingProfit,
        currentBalance: capitalPending + outstandingProfit,
        activeOperations: activeOps,
        totalOperations: contribs.length,
        // جديد (مصحح)
        committedCapital: totalCapital,
        fundedCapital: fundedCapital,                              // ✅ المستثمر فعلياً
        remainingCommitment: Math.max(0, totalCapital - fundedCapital) // المتبقي من التعهد
    };
}

/** كشف حساب الممول */
function buildInvestorStatement(investorId, data) {
    var idx = ensureIndexes(data);
    return buildStatement(idx.transfersByInvestor[investorId] || [], idx, 'investor');
}

// ============================================================
// 3. OPERATION ENGINE
// ============================================================

/**
 * ملخص العملية - يُستخدم في: Dashboard + Operation Center
 * لا يشتق حالة العملية؛ status يأتي من operations.status فقط.
 */
function calculateOperationSummary(operationId, data) {
    var idx = ensureIndexes(data);
    var op = idx.operationsById[operationId];
    if (!op) return null;

    var opInv = idx.opInvestorsByOperation[operationId] || [];
    var opTransfers = idx.transfersByOperation[operationId] || [];

    var committedCapital = 0, totalInvestorProfit = 0;
    opInv.forEach(function(oi) {
        committedCapital += _num(oi.contribution);
        totalInvestorProfit += _num(oi.profit);
    });

    // ✅ كل الأموال الفعلية من Transfers فقط
    var fundedCapital     = _sum(opTransfers, function(t) { return t.type === 'investor_to_company'; });
    var clientFunded      = _sum(opTransfers, function(t) { return t.type === 'company_to_client' && t.purpose === 'client_funding'; });
    var clientRepaid      = _sum(opTransfers, function(t) { return t.type === 'client_to_company' && t.purpose === 'client_repayment'; });
    var capitalReturned   = _sum(opTransfers, function(t) { return t.type === 'company_to_investor' && t.purpose === 'capital_return'; });
    var distributedProfit = _sum(opTransfers, function(t) { return t.type === 'company_to_investor' && t.purpose === 'profit_distribution'; });

    var companyProfit         = _companyShare(op, op.final_profit);
    var expectedCompanyProfit = _companyShare(op, op.expected_profit);
    var investorProfitShare   = Math.max(0, _num(op.final_profit) - companyProfit);
    var remainingProfit       = Math.max(0, investorProfitShare - distributedProfit);
    var realizedCompanyProfit = Math.max(0, clientRepaid - capitalReturned - distributedProfit);

    return {
        investorCount: opInv.length,
        totalInvested: committedCapital,   // رجعي (committed)
        committedCapital: committedCapital,
        fundedCapital: fundedCapital,
        clientFunded: clientFunded,
        totalInvestorProfit: totalInvestorProfit,
        companyProfit: companyProfit,
        expectedCompanyProfit: expectedCompanyProfit,
        realizedCompanyProfit: realizedCompanyProfit,
        clientRepaid: clientRepaid,
        capitalReturned: capitalReturned,
        distributedProfit: distributedProfit,
        remainingProfit: remainingProfit,
        operation: op
    };
}

/**
 * ✅ Coverage بنوعيه (ملاحظتك #3)
 * committedCoverage = التغطية بالتعهدات
 * fundedCoverage    = التغطية بالتمويل الفعلي المستلم
 */
function getCoverage(operationId, data) {
    var idx = ensureIndexes(data);
    var op = idx.operationsById[operationId];
    if (!op) return null;

    var s = calculateOperationSummary(operationId, data);
    var required = _num(op.amount);

    var committedCoverage = required > 0 ? (s.committedCapital / required) * 100 : 0;
    var fundedCoverage    = required > 0 ? (s.fundedCapital / required) * 100 : 0;

    return {
        required: required,
        committed: s.committedCapital,
        funded: s.fundedCapital,
        remainingCommitment: Math.max(0, required - s.committedCapital),
        remainingFunding: Math.max(0, required - s.fundedCapital),
        committedCoverage: committedCoverage,
        fundedCoverage: fundedCoverage,
        isFullyCommitted: committedCoverage >= 100,
        isFullyFunded: fundedCoverage >= 100
    };
}

/**
 * حالة التمويل المالية لممول داخل عملية (Derived من transfers)
 * ترجع: unfunded / partial / fully_funded
 * (هذه حالة مالية فقط، وليست حالة الـ Workflow)
 */
function getInvestorFundingStatus(operationId, investorId, data) {
    var idx = ensureIndexes(data);
    var opInv = idx.opInvestorsByOperation[operationId] || [];
    var commitment = null;
    for (var i = 0; i < opInv.length; i++) {
        if (opInv[i].investor_id === investorId) { commitment = opInv[i]; break; }
    }
    if (!commitment) return null;

    var committed = _num(commitment.contribution);
    var opTransfers = idx.transfersByOperation[operationId] || [];
    var funded = _sum(opTransfers, function(t) { return t.investor_id === investorId && t.type === 'investor_to_company'; });

    var status = 'unfunded';
    if (funded > 0 && funded < committed) status = 'partial';
    else if (funded >= committed && committed > 0) status = 'fully_funded';

    return {
        committed: committed,
        funded: funded,
        remaining: Math.max(0, committed - funded),
        status: status
    };
}

/**
 * نظرة التمويل الكاملة للعملية (لكل الممولين) - للـ Operation Center
 */
function getFundingStatus(operationId, data) {
    var idx = ensureIndexes(data);
    var opInv = idx.opInvestorsByOperation[operationId] || [];
    var investors = [];
    opInv.forEach(function(oi) {
        var st = getInvestorFundingStatus(operationId, oi.investor_id, data);
        if (st) {
            investors.push({
                investorId: oi.investor_id,
                opInvestorId: oi.id,
                profit: _num(oi.profit),
                committed: st.committed,
                funded: st.funded,
                remaining: st.remaining,
                status: st.status
            });
        }
    });
    var coverage = getCoverage(operationId, data);
    return { investors: investors, coverage: coverage };
}

// ============================================================
// 4. COMPANY ENGINE
// ============================================================

/** رصيد الشركة (داخل/خارج/صافي) - من transfers فقط */
function getCompanyBalance(data) {
    var idx = ensureIndexes(data);
    var cashIn  = _sum(idx.allTransfers, function(t) { return t.type === 'investor_to_company' || t.type === 'client_to_company'; });
    var cashOut = _sum(idx.allTransfers, function(t) { return t.type === 'company_to_client' || t.type === 'company_to_investor'; });
    return { cashIn: cashIn, cashOut: cashOut, balance: cashIn - cashOut };
}

/**
 * ✅ أرباح الشركة بثلاث مستويات (ملاحظتك #2)
 * expected : من العمليات النشطة (expected_profit)
 * approved : عمليات لها final_profit + تاريخ اعتماد (أياً كانت حالتها)
 * realized : محصلة فعلياً = المحصل من العميل - المرجوع للممولين - الموزع كأرباح
 */
function getCompanyProfit(data) {
    var idx = ensureIndexes(data);
    var expected = 0, approved = 0, realized = 0;

    (idx.allOperations || []).forEach(function(op) {
        if (op.is_archived) return;
        if (op.status === STATUS.ACTIVE) expected += _companyShare(op, op.expected_profit);
        if (op.final_profit && op.profit_approval_date) approved += _companyShare(op, op.final_profit);

        var opTransfers = idx.transfersByOperation[op.id] || [];
        var clientRepaid      = _sum(opTransfers, function(t) { return t.type === 'client_to_company' && t.purpose === 'client_repayment'; });
        var capitalReturned   = _sum(opTransfers, function(t) { return t.type === 'company_to_investor' && t.purpose === 'capital_return'; });
        var distributedProfit = _sum(opTransfers, function(t) { return t.type === 'company_to_investor' && t.purpose === 'profit_distribution'; });
        realized += Math.max(0, clientRepaid - capitalReturned - distributedProfit);
    });

    return { expected: expected, approved: approved, realized: realized };
}

/** ملخص الشركة الكامل - لشاشة حساب الشركة مستقبلاً */
function calculateCompanySummary(data) {
    var idx = ensureIndexes(data);
    var bal = getCompanyBalance(data);
    var profit = getCompanyProfit(data);
    var activeOps = 0, totalOps = 0;
    (idx.allOperations || []).forEach(function(op) {
        if (op.is_archived) return;
        totalOps++;
        if (op.status === STATUS.ACTIVE) activeOps++;
    });
    return {
        balance: bal.balance, cashIn: bal.cashIn, cashOut: bal.cashOut,
        expectedProfit: profit.expected, approvedProfit: profit.approved, realizedProfit: profit.realized,
        activeOperations: activeOps, totalOperations: totalOps
    };
}

/** كشف حساب الشركة */
function buildCompanyStatement(data) {
    var idx = ensureIndexes(data);
    return buildStatement(idx.allTransfers || [], idx, 'company');
}

// ============================================================
// 5. STATEMENT ENGINE
// ============================================================

/**
 * بناء كشف الحساب مع الرصيد المتحرك
 * type: 'client' | 'investor' | 'company'
 */
function buildStatement(transfers, indexes, type) {
    var idx = indexes && indexes.operationsById ? indexes : ensureIndexes({ indexes: indexes, transfers: transfers });
    var statement = [];

    (transfers || []).forEach(function(t) {
        var op = idx.operationsById[t.operation_id] || null;
        var inv = idx.investorsById[t.investor_id] || null;
        var cli = idx.clientsById[t.client_id] || null;

        var isCredit = false;
        if (type === 'client') {
            isCredit = (t.purpose === 'client_repayment');           // ما دفعه العميل = رصيد له
        } else if (type === 'investor') {
            isCredit = (t.purpose === 'capital_return' || t.purpose === 'profit_distribution'); // ما استلمه الممول
        } else if (type === 'company') {
            isCredit = (t.type === 'investor_to_company' || t.type === 'client_to_company');    // داخل للشركة
        }

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

    statement.sort(function(a, b) {
        return new Date(a.date || a.created_at) - new Date(b.date || b.created_at);
    });

    var runningBalance = 0;
    statement.forEach(function(item) {
        runningBalance += item.isCredit ? item.amount : -item.amount;
        item.runningBalance = runningBalance;
    });

    statement.reverse(); // الأحدث أولاً للعرض
    return statement;
}

// ============================================================
// 6. SHARED HELPERS
// ============================================================

function _num(v) { var n = parseFloat(v); return isNaN(n) ? 0 : n; }

function _sum(list, pred) {
    var s = 0;
    (list || []).forEach(function(t) { if (pred(t)) s += _num(t.amount); });
    return s;
}

/** حصة الشركة من الربح حسب القاعدة (نسبة/ثابت) */
function _companyShare(op, profitBase) {
    var base = _num(profitBase);
    if (!base || !op) return 0;
    if (op.company_profit_type === 'percentage') return (base * _num(op.company_profit_value)) / 100;
    if (op.company_profit_type === 'fixed') return _num(op.company_profit_value);
    return 0;
}

function _hasKeys(obj) { return obj && Object.keys(obj).length > 0; }

/**
 * توحيد الـ Indexes: يقبل data بصيغ مختلفة (raw arrays أو indexes جاهزة)
 * ويبني ما ينقصه مرة واحدة فقط (memoized على نفس الـ data object)
 */
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
        allOpInvestors: data.opInvestors || []
    };

    // operationsById + clientOperations
    idx.clientOperations = _hasKeys(src.clientOperations) ? src.clientOperations : {};
    (idx.allOperations).forEach(function(op) {
        if (!idx.operationsById[op.id]) idx.operationsById[op.id] = op;
        if (!_hasKeys(src.clientOperations)) {
            if (!idx.clientOperations[op.client_id]) idx.clientOperations[op.client_id] = [];
            idx.clientOperations[op.client_id].push(op);
        }
    });

    // opInvestors maps
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

    // transfers maps (مع fallback: التحويل بدون client_id يُنسب لعميل العملية)
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
// END OF FINANCIAL ENGINE
// ============================================================
