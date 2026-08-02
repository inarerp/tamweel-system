// ============================================================
// نظام إدارة التمويل - Calculations Module (مشترك)
// Version: 1.0.0
// Last Updated: 2026-08-02
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
// 1. CLIENT CALCULATIONS
// ============================================================

/**
 * حساب ملخص العميل
 * يُستخدم في: Dashboard + ملف العميل + حسابي
 */
function calculateClientSummary(clientId, data) {
    var ops = (data.indexes.clientOperations && data.indexes.clientOperations[clientId]) || [];
    
    // إذا لم يكن الـ Index موجوداً، استخدم العمليات المباشرة
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
        totalFunded += parseFloat(op.amount || 0);
        
        if (op.status === STATUS.ACTIVE) activeOps++;
        else if (op.status === STATUS.COMPLETED) completedOps++;
        else if (op.status === STATUS.DRAFT) draftOps++;
        
        if (op.final_profit && op.profit_approval_date) {
            totalApprovedProfit += parseFloat(op.final_profit || 0);
        }
        
        if (!lastOperation || new Date(op.created_at) > new Date(lastOperation.created_at)) {
            lastOperation = op;
        }
    });
    
    // حساب المدفوع من التحويلات
    ops.forEach(function(op) {
        var opTransfers = (data.indexes.transfersByOperation && data.indexes.transfersByOperation[op.id]) || [];
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
 */
function calculateInvestorSummary(investorId, data) {
    var contribs = (data.indexes.opInvestorsByInvestor && data.indexes.opInvestorsByInvestor[investorId]) || [];
    var myTransfers = (data.indexes.transfersByInvestor && data.indexes.transfersByInvestor[investorId]) || [];
    
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


// ============================================================
// 3. OPERATION CALCULATIONS
// ============================================================

/**
 * حساب ملخص العملية
 * يُستخدم في: Dashboard + ملف العملية
 */
function calculateOperationSummary(operationId, data) {
    var op = data.indexes.operationsById[operationId];
    if (!op) return null;
    
    var opInv = (data.indexes.opInvestorsByOperation && data.indexes.opInvestorsByOperation[operationId]) || [];
    var opTransfers = (data.indexes.transfersByOperation && data.indexes.transfersByOperation[operationId]) || [];
    
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
// 4. STATEMENT BUILDER (مشترك)
// ============================================================

/**
 * بناء كشف الحساب
 * يُستخدم في: ملف العميل + ملف الممول + حسابي
 * 
 * @param {Array} transfers - قائمة التحويلات
 * @param {Object} indexes - Indexes للعمليات
 * @param {string} type - نوع الكشف (client/investor)
 * @returns {Array} - كشف الحساب مع الرصيد المتحرك
 */
function buildStatement(transfers, indexes, type) {
    var statement = [];
    
    transfers.forEach(function(t) {
        var op = indexes.operationsById ? indexes.operationsById[t.operation_id] : null;
        var inv = indexes.investorsById ? indexes.investorsById[t.investor_id] : null;
        
        var isCredit = false;
        if (type === 'client') {
            isCredit = (t.purpose === 'client_repayment');
        } else if (type === 'investor') {
            isCredit = (t.purpose === 'capital_return' || t.purpose === 'profit_distribution');
        }
        
        statement.push({
            date: t.transfer_date,
            reference: t.reference_number || '-',
            type: getTransferTypeText(t.type),
            purpose: getPurposeText(t.purpose),
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
    
    // ترتيب من الأقدم للأحدث لحساب الرصيد
    statement.sort(function(a, b) {
        var dateA = new Date(a.date || a.created_at);
        var dateB = new Date(b.date || b.created_at);
        return dateA - dateB;
    });
    
    // حساب الرصيد المتحرك
    var runningBalance = 0;
    statement.forEach(function(item) {
        if (item.isCredit) {
            runningBalance += item.amount;
        } else {
            runningBalance -= item.amount;
        }
        item.runningBalance = runningBalance;
    });
    
    // عكس للعرض (الأحدث أولاً)
    statement.reverse();
    
    return statement;
}


// ============================================================
// END OF CALCULATIONS.JS
// ============================================================
