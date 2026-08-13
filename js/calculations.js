// ============================================================
// نظام إدارة التمويل - Calculations Module (مشترك)
// Version: 2.3.1
// Last Updated: 2026-08-05
// ============================================================
//
// المسؤوليات:
// - حسابات مشتركة تُستخدم من عدة شاشات
// - مصدر واحد للحقيقة (Single Source of Truth)
// - يُستخدم من: dashboard.js, clients.js, investors.js, operations.js
//
// يعتمد على:
// - core.js (APP, STATUS, Constants)
//
// ملاحظة: هذا الملف يُحمّل قبل شاشات الاستخدام
// ============================================================

// ============================================================
// 0. SHARED HELPERS (Backward Compatibility)
// ============================================================

/**
 * ✅ هل التحويل تمويل ممول فعلي؟
 * يتعرف على:
 * - type === 'investor_to_company' (الطريقة المفضلة)
 * - purpose === 'capital_funding' (الغرض الجديد)
 * - purpose === 'client_funding' (الغرض القديم - backward compat)
 */
function _isInvestorFunding(t) {
    if (t.type) return (t.type === 'investor_to_company');
    return (t.purpose === 'capital_funding' || t.purpose === 'client_funding');
}

/**
 * ✅ هل التحويل تمويل عميل فعلي؟
 * يتعرف على:
 * - type === 'company_to_client'
 * - purpose === 'client_funding' أو 'additional_funding'
 */
function _isClientFunding(t) {
    if (t.type) return (t.type === 'company_to_client');
    return (t.purpose === 'client_funding' || t.purpose === 'additional_funding');
}

/**
 * ✅ هل التحويل سداد من العميل؟
 */
function _isClientRepayment(t) {
    if (t.type) return (t.type === 'client_to_company');
    return (t.purpose === 'client_repayment');
}

/**
 * ✅ حساب التدفقات المالية للعميل في عملية معينة
 * يُستخدم من: calculateClientSummary, dashboard
 */
function getOperationClientFlows(operationId, data) {
    var opTransfers = (data.indexes.transfersByOperation && data.indexes.transfersByOperation[operationId]) || [];
    var clientFunded = 0, clientRepaid = 0;
    opTransfers.forEach(function(t) {
        if (_isClientFunding(t)) clientFunded += parseFloat(t.amount || 0);
        else if (_isClientRepayment(t)) clientRepaid += parseFloat(t.amount || 0);
    });
    return { clientFunded: clientFunded, clientRepaid: clientRepaid };
}

// ============================================================
// 1. CLIENT CALCULATIONS
// ============================================================

/**
 * حساب ملخص العميل
 * يُستخدم في: Dashboard + ملف العميل + حسابي
 * 
 * ✅ v2.3.1: totalFunded من التحويلات الفعلية (company_to_client) وليس من op.amount
 */
function calculateClientSummary(clientId, data) {
    var ops = (data.indexes.clientOperations && data.indexes.clientOperations[clientId]) || [];
    if (ops.length === 0 && data.operations) {
        ops = data.operations.filter(function(op) { return op.client_id === clientId; });
    }
    
    var activeOps = 0;
    var completedOps = 0;
    var draftOps = 0;
    var totalFunded = 0;
    var totalRepaid = 0;
    var totalApprovedProfit = 0;
    var lastOperation = null;
    
    ops.forEach(function(op) {
        if (op.status === STATUS.ACTIVE) activeOps++;
        else if (op.status === STATUS.COMPLETED) completedOps++;
        else if (op.status === STATUS.DRAFT) draftOps++;
        
        if (op.final_profit && op.profit_approval_date) {
            totalApprovedProfit += parseFloat(op.final_profit || 0);
        }
        
        if (!lastOperation || new Date(op.created_at) > new Date(lastOperation.created_at)) {
            lastOperation = op;
        }
        
        // ✅ BUG#1 FIX: totalFunded/totalRepaid من التحويلات الفعلية فقط (لا op.amount)
        var flows = getOperationClientFlows(op.id, data);
        totalFunded += flows.clientFunded;
        totalRepaid += flows.clientRepaid;
    });
    
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
        lastOperation: lastOperation
    };
}

// ============================================================
// 2. INVESTOR CALCULATIONS
// ============================================================

/**
 * حساب ملخص الممول
 * يُستخدم في: Dashboard + ملف الممول + حسابي
 * 
 * ✅ v2.3.1: workingCapital = fundedCapital الفعلي (ليس التعهدات)
 */
function calculateInvestorSummary(investorId, data) {
    var contribs = (data.indexes.opInvestorsByInvestor && data.indexes.opInvestorsByInvestor[investorId]) || [];
    var myTransfers = (data.indexes.transfersByInvestor && data.indexes.transfersByInvestor[investorId]) || [];
    
    var totalCapital = 0;
    var totalProfit = 0;
    var activeOps = 0;
    var totalOps = contribs.length;
    
    contribs.forEach(function(c) {
        var contribution = parseFloat(c.contribution || 0);
        var profit = parseFloat(c.profit || 0);
        totalCapital += contribution;
        totalProfit += profit;
        
        var op = data.indexes.operationsById ? data.indexes.operationsById[c.operation_id] : null;
        if (op && op.status === STATUS.ACTIVE) activeOps++;
    });
    
    var fundedCapital = 0;
    var capitalReturned = 0;
    var profitPaid = 0;
    
    myTransfers.forEach(function(t) {
        if (_isInvestorFunding(t)) {
            fundedCapital += parseFloat(t.amount || 0);
        } else if (t.purpose === 'capital_return') {
            capitalReturned += parseFloat(t.amount || 0);
        } else if (t.purpose === 'profit_distribution') {
            profitPaid += parseFloat(t.amount || 0);
        }
    });
    
    var capitalPending = Math.max(0, fundedCapital - capitalReturned);
    var outstandingCommitment = Math.max(0, totalCapital - fundedCapital);
    var outstandingProfit = Math.max(0, totalProfit - profitPaid);
    var currentBalance = capitalPending + outstandingProfit;
    
    return {
        totalCapital: totalCapital,
        committedCapital: totalCapital,
        fundedCapital: fundedCapital,
        workingCapital: fundedCapital,
        capitalReturned: capitalReturned,
        capitalPending: capitalPending,
        outstandingCommitment: outstandingCommitment,
        totalProfit: totalProfit,
        profitPaid: profitPaid,
        outstandingProfit: outstandingProfit,
        currentBalance: currentBalance,
        activeOperations: activeOps,
        totalOperations: totalOps
    };
}

// ============================================================
// 3. OPERATION FUNDING (المصدر الوحيد لتمويل العملية)
// ============================================================

/**
 * حساب حالة تمويل العملية
 * يُستخدم في: operations.js (Coverage, Workflow, perInvestor)
 * 
 * ✅ v2.3.1: 
 * - unmatchedInvestorFunding (تحويلات لممولين بلا record)
 * - remainingClientFunding باستخدام clientFunded (ليس clientFunding)
 * - capitalReturned و profitDistributed للإجماليات
 */
function getOperationFunding(operationId, data) {
    var op = data.indexes.operationsById ? data.indexes.operationsById[operationId] : null;
    var opInv = (data.indexes.opInvestorsByOperation && data.indexes.opInvestorsByOperation[operationId]) || [];
    var opTransfers = (data.indexes.transfersByOperation && data.indexes.transfersByOperation[operationId]) || [];
    
    var required = op ? parseFloat(op.amount || 0) : 0;
    var committed = 0;
    var knownInvestors = {};
    var perInvestor = [];
    
    opInv.forEach(function(oi) {
        var cCommitted = parseFloat(oi.contribution || 0);
        var cProfit = parseFloat(oi.profit || 0);
        committed += cCommitted;
        knownInvestors[oi.investor_id] = true;
        
        var funded = 0;
        var returned = 0;
        var profitPaid = 0;
        
        opTransfers.forEach(function(t) {
            if (t.investor_id !== oi.investor_id) return;
            
            if (_isInvestorFunding(t)) {
                funded += parseFloat(t.amount || 0);
            } else if (t.purpose === 'capital_return') {
                returned += parseFloat(t.amount || 0);
            } else if (t.purpose === 'profit_distribution') {
                profitPaid += parseFloat(t.amount || 0);
            }
        });
        
        perInvestor.push({
            investorId: oi.investor_id,
            opInvestorId: oi.id,
            committed: cCommitted,
            profit: cProfit,
            funded: funded,
            returned: returned,
            profitPaid: profitPaid,
            remaining: Math.max(0, cCommitted - funded),
            remainingCapital: Math.max(0, funded - returned),
            remainingProfit: Math.max(0, cProfit - profitPaid)
        });
    });
    
    var funded = 0;
    var clientFunded = 0;
    var clientRepayment = 0;
    var capitalReturned = 0;
    var profitDistributed = 0;
    var unmatchedInvestorFunding = [];
    
    opTransfers.forEach(function(t) {
        var a = parseFloat(t.amount || 0);
        
        if (_isInvestorFunding(t)) {
            funded += a;
            if (t.investor_id && !knownInvestors[t.investor_id]) {
                unmatchedInvestorFunding.push({
                    transferId: t.id,
                    investorId: t.investor_id,
                    amount: a
                });
            }
        } else if (t.type === 'company_to_client') {
            clientFunded += a;
        } else if (t.type === 'client_to_company') {
            clientRepayment += a;
        } else if (t.purpose === 'capital_return') {
            capitalReturned += a;
        } else if (t.purpose === 'profit_distribution') {
            profitDistributed += a;
        }
    });
    
    return {
        required: required,
        committed: committed,
        funded: funded,
        clientFunded: clientFunded,
        clientRepayment: clientRepayment,
        capitalReturned: capitalReturned,
        profitDistributed: profitDistributed,
        remainingCommitment: Math.max(0, required - committed),
        remainingFunding: Math.max(0, required - funded),
        remainingClientFunding: Math.max(0, required - clientFunded),
        committedCoverage: required > 0 ? (committed / required) * 100 : 0,
        fundedCoverage: required > 0 ? (funded / required) * 100 : 0,
        perInvestor: perInvestor,
        unmatchedInvestorFunding: unmatchedInvestorFunding
    };
}

// ============================================================
// 4. OPERATION PROFITS (المصدر الوحيد لأرباح العملية)
// ============================================================

/**
 * حساب أرباح العملية
 * يُستخدم في: operations.js (توزيع، اعتماد، سداد)
 * 
 * ✅ v2.3.1:
 * - profitAllocatedTotal
 * - profitReconciliationDifference
 * - profitReconciled (كشف فقط، لا تصحيح تلقائي)
 */
function getOperationProfits(operationId, data) {
    var op = data.indexes.operationsById ? data.indexes.operationsById[operationId] : null;
    if (!op) return null;
    
    var f = getOperationFunding(operationId, data);
    var opInv = (data.indexes.opInvestorsByOperation && data.indexes.opInvestorsByOperation[operationId]) || [];
    
    var investorEntitlement = 0;
    opInv.forEach(function(oi) {
        investorEntitlement += parseFloat(oi.profit || 0);
    });
    
    var expectedTotal = parseFloat(op.expected_profit || 0);
    var approvedTotal = (op.final_profit && op.profit_approval_date) ? parseFloat(op.final_profit || 0) : 0;
    
    var companyExpected = _companyShare(op, expectedTotal);
    var companyApproved = _companyShare(op, approvedTotal);
    
    var totalProfitCollected = Math.max(0, f.clientRepayment - f.clientFunded);
    var netProfit = Math.max(0, totalProfitCollected - f.profitDistributed);
    
    var clientDueTotal = f.required + approvedTotal;
    var clientOutstanding = Math.max(0, clientDueTotal - f.clientRepayment);
    
    var profitAllocatedTotal = investorEntitlement + companyApproved;
    var profitReconciliationDifference = profitAllocatedTotal - approvedTotal;
    var profitReconciled = (approvedTotal > 0) ? Math.abs(profitReconciliationDifference) < 0.01 : true;
    
    return {
        expectedTotal: expectedTotal,
        approvedTotal: approvedTotal,
        companyExpected: companyExpected,
        companyApproved: companyApproved,
        investorEntitlement: investorEntitlement,
        investorDistributed: f.profitDistributed,
        investorRemaining: Math.max(0, investorEntitlement - f.profitDistributed),
        capitalReturned: f.capitalReturned,
        clientRepayment: f.clientRepayment,
        clientFunded: f.clientFunded,
        totalProfitCollected: totalProfitCollected,
        netProfit: netProfit,
        clientDueTotal: clientDueTotal,
        clientOutstanding: clientOutstanding,
        profitAllocatedTotal: profitAllocatedTotal,
        profitReconciliationDifference: profitReconciliationDifference,
        profitReconciled: profitReconciled
    };
}

function _companyShare(op, profitBase) {
    var base = parseFloat(profitBase || 0);
    if (!base || !op) return 0;
    if (op.company_profit_type === 'percentage') {
        return (base * parseFloat(op.company_profit_value || 0)) / 100;
    } else if (op.company_profit_type === 'fixed') {
        return parseFloat(op.company_profit_value || 0);
    }
    return 0;
}

/**
 * حساب نسبة التغطية
 */
function getCoverage(operationId, data) {
    var f = getOperationFunding(operationId, data);
    return {
        required: f.required,
        committed: f.committed,
        funded: f.funded,
        remainingCommitment: f.remainingCommitment,
        remainingFunding: f.remainingFunding,
        remainingClientFunding: f.remainingClientFunding,
        committedCoverage: f.committedCoverage,
        fundedCoverage: f.fundedCoverage
    };
}

// ============================================================
// 5. OPERATION SUMMARY (توافق رجعي)
// ============================================================

/**
 * حساب ملخص العملية
 * يُستخدم في: Dashboard + ملف العملية
 */
function calculateOperationSummary(operationId, data) {
    var op = data.indexes.operationsById ? data.indexes.operationsById[operationId] : null;
    if (!op) return null;
    
    var f = getOperationFunding(operationId, data);
    var p = getOperationProfits(operationId, data);
    
    var companyProfit = 0;
    if (op.company_profit_type === 'percentage' && op.final_profit) {
        companyProfit = (parseFloat(op.final_profit) * parseFloat(op.company_profit_value || 0)) / 100;
    } else if (op.company_profit_type === 'fixed') {
        companyProfit = parseFloat(op.company_profit_value || 0);
    }
    
    var investorProfitShare = Math.max(0, (parseFloat(op.final_profit) || 0) - companyProfit);
    
    return {
        investorCount: f.perInvestor.length,
        totalInvested: f.committed,
        totalInvestorProfit: p.investorEntitlement,
        companyProfit: companyProfit,
        clientRepaid: f.clientRepayment,
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
// 6. STATEMENT BUILDER (مشترك)
// ============================================================

/**
 * بناء كشف الحساب
 * يُستخدم في: ملف العميل + ملف الممول + حسابي
 * 
 * ✅ v2.3.1: فلاتر إدراج صحيحة لكل طرف
 */
function buildStatement(transfers, indexes, type) {
    var statement = [];
    
    transfers.forEach(function(t) {
        var op = indexes.operationsById ? indexes.operationsById[t.operation_id] : null;
        var inv = indexes.investorsById ? indexes.investorsById[t.investor_id] : null;
        
        var include = false;
        var isCredit = false;
        
        if (type === 'client') {
            include = _isClientFunding(t) || _isClientRepayment(t);
            isCredit = _isClientRepayment(t);
        } else if (type === 'investor') {
            include = _isInvestorFunding(t) || t.purpose === 'capital_return' || t.purpose === 'profit_distribution';
            isCredit = (t.purpose === 'capital_return' || t.purpose === 'profit_distribution');
        }
        
        if (!include) return;
        
        statement.push({
            date: t.transfer_date,
            reference: t.reference_number || '-',
            type: (typeof getTransferTypeText === 'function') ? getTransferTypeText(t.type) : (t.type || '-'),
            purpose: (typeof getPurposeText === 'function') ? getPurposeText(t.purpose) : (t.purpose || '-'),
            operation: op ? op.name : '-',
            operationId: t.operation_id,
            investor: inv ? inv.name : '-',
            investorId: t.investor_id,
            amount: parseFloat(t.amount || 0),
            isCredit: isCredit,
            notes: t.notes || '-',
            created_at: t.created_at
        });
    });
    
    statement.sort(function(a, b) {
        var dateA = new Date(a.date || a.created_at);
        var dateB = new Date(b.date || b.created_at);
        return dateA - dateB;
    });
    
    var runningBalance = 0;
    statement.forEach(function(item) {
        if (item.isCredit) {
            runningBalance += item.amount;
        } else {
            runningBalance -= item.amount;
        }
        item.runningBalance = runningBalance;
    });
    
    statement.reverse();
    return statement;
}

// ============================================================
// END OF CALCULATIONS.JS (v2.3.1)
// ============================================================
