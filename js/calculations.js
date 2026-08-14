// ============================================================
// نظام إدارة التمويل - Calculations Module (مشترك)
// Version: 2.6.0
// Last Updated: 2026-08-14
// ============================================================
// v2.6.0: فصل منطق Financing عن Supply في ربح الشركة:
//  - Financing: الربح المتفق عليه نهائي من البداية (لا يشترط profit_approval_date)
//    ويُدرج في فلاتر الأرباح وفق تاريخ العملية (start_date/created_at)
//  - Supply: يبقى منطق Expected/Approved الحالي كما هو
//  - مبدأ التحويلات كمصدر وحيد للحركة المالية بدون تغيير

// ============================================================
// 0. SHARED HELPERS
// ============================================================
function _isInvestorFunding(t) { if (t.type) return (t.type === 'investor_to_company'); return (t.purpose === 'capital_funding' || t.purpose === 'client_funding'); }
function _isClientFunding(t) { if (t.type) return (t.type === 'company_to_client'); return (t.purpose === 'client_funding' || t.purpose === 'additional_funding'); }
function _isClientRepayment(t) { if (t.type) return (t.type === 'client_to_company'); return (t.purpose === 'client_repayment'); }
function _isFinancing(op) { return !!op && op.type === 'financing'; }
function getOperationClientFlows(operationId, data) {
    var opTransfers = (data.indexes.transfersByOperation && data.indexes.transfersByOperation[operationId]) || [];
    var clientFunded = 0, clientRepaid = 0;
    opTransfers.forEach(function(t) {
        if (_isClientFunding(t)) clientFunded += parseFloat(t.amount || 0);
        else if (_isClientRepayment(t)) clientRepaid += parseFloat(t.amount || 0);
    });
    return { clientFunded: clientFunded, clientRepaid: clientRepaid };
}
// تاريخ الربح المناسب حسب نوع العملية (للفلاتر والعرض)
function _operationProfitDate(op) {
    if (_isFinancing(op)) {
        var d = op.start_date || op.created_at || null;
        return { date: d ? String(d).slice(0, 10) : null, label: 'تاريخ العملية (تمويل)' };
    }
    var d2 = op.profit_approval_date ? String(op.profit_approval_date).slice(0, 10) : null;
    return { date: d2, label: 'تاريخ اعتماد الربح (توريد)' };
}

// ============================================================
// 1. CLIENT CALCULATIONS
// ============================================================
function calculateClientSummary(clientId, data) {
    var ops = (data.indexes.clientOperations && data.indexes.clientOperations[clientId]) || [];
    if (ops.length === 0 && data.operations) ops = data.operations.filter(function(op) { return op.client_id === clientId; });
    var activeOps = 0, completedOps = 0, draftOps = 0, totalFunded = 0, totalRepaid = 0, totalApprovedProfit = 0, lastOperation = null;
    ops.forEach(function(op) {
        if (op.status === STATUS.ACTIVE) activeOps++;
        else if (op.status === STATUS.COMPLETED) completedOps++;
        else if (op.status === STATUS.DRAFT) draftOps++;
        if (op.final_profit && op.profit_approval_date) totalApprovedProfit += parseFloat(op.final_profit || 0);
        if (!lastOperation || new Date(op.created_at) > new Date(lastOperation.created_at)) lastOperation = op;
        var flows = getOperationClientFlows(op.id, data);
        totalFunded += flows.clientFunded; totalRepaid += flows.clientRepaid;
    });
    return { totalOperations: ops.length, activeOperations: activeOps, completedOperations: completedOps, draftOperations: draftOps,
        totalFunded: totalFunded, totalRepaid: totalRepaid, totalApprovedProfit: totalApprovedProfit, balance: totalRepaid - totalFunded, lastOperation: lastOperation };
}

// ============================================================
// 2. INVESTOR CALCULATIONS
// ============================================================
function calculateInvestorSummary(investorId, data) {
    var contribs = (data.indexes.opInvestorsByInvestor && data.indexes.opInvestorsByInvestor[investorId]) || [];
    var myTransfers = (data.indexes.transfersByInvestor && data.indexes.transfersByInvestor[investorId]) || [];
    var totalCapital = 0, totalProfit = 0, activeOps = 0, totalOps = contribs.length;
    contribs.forEach(function(c) {
        totalCapital += parseFloat(c.contribution || 0); totalProfit += parseFloat(c.profit || 0);
        var op = data.indexes.operationsById ? data.indexes.operationsById[c.operation_id] : null;
        if (op && op.status === STATUS.ACTIVE) activeOps++;
    });
    var fundedCapital = 0, capitalReturned = 0, profitPaid = 0;
    myTransfers.forEach(function(t) {
        if (_isInvestorFunding(t)) fundedCapital += parseFloat(t.amount || 0);
        else if (t.purpose === 'capital_return') capitalReturned += parseFloat(t.amount || 0);
        else if (t.purpose === 'profit_distribution') profitPaid += parseFloat(t.amount || 0);
    });
    var capitalPending = Math.max(0, fundedCapital - capitalReturned);
    return { totalCapital: totalCapital, committedCapital: totalCapital, fundedCapital: fundedCapital, workingCapital: fundedCapital,
        capitalReturned: capitalReturned, capitalPending: capitalPending, outstandingCommitment: Math.max(0, totalCapital - fundedCapital),
        totalProfit: totalProfit, profitPaid: profitPaid, outstandingProfit: Math.max(0, totalProfit - profitPaid),
        currentBalance: capitalPending + Math.max(0, totalProfit - profitPaid), activeOperations: activeOps, totalOperations: totalOps };
}

// ============================================================
// 3. OPERATION FUNDING
// ============================================================
function getOperationFunding(operationId, data) {
    var op = data.indexes.operationsById ? data.indexes.operationsById[operationId] : null;
    var opInv = (data.indexes.opInvestorsByOperation && data.indexes.opInvestorsByOperation[operationId]) || [];
    var opTransfers = (data.indexes.transfersByOperation && data.indexes.transfersByOperation[operationId]) || [];
    var required = op ? parseFloat(op.amount || 0) : 0;
    var committed = 0, knownInvestors = {}, perInvestor = [];
    opInv.forEach(function(oi) {
        var cCommitted = parseFloat(oi.contribution || 0), cProfit = parseFloat(oi.profit || 0);
        committed += cCommitted; knownInvestors[oi.investor_id] = true;
        var funded = 0, returned = 0, profitPaid = 0;
        opTransfers.forEach(function(t) {
            if (t.investor_id !== oi.investor_id) return;
            if (_isInvestorFunding(t)) funded += parseFloat(t.amount || 0);
            else if (t.purpose === 'capital_return') returned += parseFloat(t.amount || 0);
            else if (t.purpose === 'profit_distribution') profitPaid += parseFloat(t.amount || 0);
        });
        perInvestor.push({ investorId: oi.investor_id, opInvestorId: oi.id, committed: cCommitted, profit: cProfit, funded: funded, returned: returned, profitPaid: profitPaid,
            remaining: Math.max(0, cCommitted - funded), remainingCapital: Math.max(0, funded - returned), remainingProfit: Math.max(0, cProfit - profitPaid) });
    });
    var funded = 0, clientFunded = 0, clientRepayment = 0, capitalReturned = 0, profitDistributed = 0, unmatched = [];
    opTransfers.forEach(function(t) {
        var a = parseFloat(t.amount || 0);
        if (_isInvestorFunding(t)) { funded += a; if (t.investor_id && !knownInvestors[t.investor_id]) unmatched.push({ transferId: t.id, investorId: t.investor_id, amount: a }); }
        else if (t.type === 'company_to_client') clientFunded += a;
        else if (t.type === 'client_to_company') clientRepayment += a;
        else if (t.purpose === 'capital_return') capitalReturned += a;
        else if (t.purpose === 'profit_distribution') profitDistributed += a;
    });
    return { required: required, committed: committed, funded: funded, clientFunded: clientFunded, clientRepayment: clientRepayment, capitalReturned: capitalReturned, profitDistributed: profitDistributed,
        remainingCommitment: Math.max(0, required - committed), remainingFunding: Math.max(0, required - funded), remainingClientFunding: Math.max(0, required - clientFunded),
        committedCoverage: required > 0 ? (committed / required) * 100 : 0, fundedCoverage: required > 0 ? (funded / required) * 100 : 0, perInvestor: perInvestor, unmatchedInvestorFunding: unmatched };
}

// ============================================================
// 4. OPERATION PROFITS (Financing vs Supply)
// ============================================================
function getOperationProfits(operationId, data) {
    var op = data.indexes.operationsById ? data.indexes.operationsById[operationId] : null;
    if (!op) return null;
    var f = getOperationFunding(operationId, data);
    var opInv = (data.indexes.opInvestorsByOperation && data.indexes.opInvestorsByOperation[operationId]) || [];
    var investorEntitlement = 0; opInv.forEach(function(oi) { investorEntitlement += parseFloat(oi.profit || 0); });
    var expectedTotal = parseFloat(op.expected_profit || 0);
    var approvedTotal;
    if (_isFinancing(op)) {
        // التمويل: الربح المتفق عليه نهائي من البداية (لا يشترط اعتماد)
        approvedTotal = parseFloat(op.final_profit || 0) || expectedTotal;
    } else {
        // التوريد: يبقى المنطق الحالي
        approvedTotal = (op.final_profit && op.profit_approval_date) ? parseFloat(op.final_profit || 0) : 0;
    }
    var companyExpected = _companyShare(op, expectedTotal);
    var companyApproved = _companyShare(op, approvedTotal);
    var totalProfitCollected = Math.max(0, f.clientRepayment - f.clientFunded);
    var netProfit = Math.max(0, totalProfitCollected - f.profitDistributed);
    var clientDueTotal = f.required + approvedTotal;
    var pd = _operationProfitDate(op);
    return { expectedTotal: expectedTotal, approvedTotal: approvedTotal, companyExpected: companyExpected, companyApproved: companyApproved,
        investorEntitlement: investorEntitlement, investorDistributed: f.profitDistributed, investorRemaining: Math.max(0, investorEntitlement - f.profitDistributed),
        capitalReturned: f.capitalReturned, clientRepayment: f.clientRepayment, clientFunded: f.clientFunded,
        totalProfitCollected: totalProfitCollected, netProfit: netProfit, clientDueTotal: clientDueTotal, clientOutstanding: Math.max(0, clientDueTotal - f.clientRepayment),
        profitAllocatedTotal: investorEntitlement + companyApproved, profitReconciliationDifference: (investorEntitlement + companyApproved) - approvedTotal,
        profitReconciled: (approvedTotal > 0) ? Math.abs((investorEntitlement + companyApproved) - approvedTotal) < 0.01 : true,
        profitDate: pd.date, profitDateLabel: pd.label, opType: op.type };
}
function _companyShare(op, profitBase) {
    var base = parseFloat(profitBase || 0);
    if (!base || !op) return 0;
    if (op.company_profit_type === 'percentage') return (base * parseFloat(op.company_profit_value || 0)) / 100;
    if (op.company_profit_type === 'fixed') return parseFloat(op.company_profit_value || 0);
    return 0;
}
function getCoverage(operationId, data) { var f = getOperationFunding(operationId, data); return { required: f.required, committed: f.committed, funded: f.funded, remainingCommitment: f.remainingCommitment, remainingFunding: f.remainingFunding, remainingClientFunding: f.remainingClientFunding, committedCoverage: f.committedCoverage, fundedCoverage: f.fundedCoverage }; }

// ============================================================
// 5. OPERATION SUMMARY
// ============================================================
function calculateOperationSummary(operationId, data) {
    var op = data.indexes.operationsById ? data.indexes.operationsById[operationId] : null;
    if (!op) return null;
    var f = getOperationFunding(operationId, data); var p = getOperationProfits(operationId, data);
    return { investorCount: f.perInvestor.length, totalInvested: f.committed, totalInvestorProfit: p.investorEntitlement, companyProfit: p.companyApproved,
        clientRepaid: f.clientRepayment, capitalReturned: p.capitalReturned, distributedProfit: p.investorDistributed, remainingProfit: p.investorRemaining, operation: op,
        committedCapital: f.committed, fundedCapital: f.funded, clientFunded: f.clientFunded, expectedCompanyProfit: p.companyExpected, realizedCompanyProfit: p.netProfit,
        coverage: { committedCoverage: f.committedCoverage, fundedCoverage: f.fundedCoverage } };
}

// ============================================================
// 6. STATEMENT BUILDER
// ============================================================
function buildStatement(transfers, indexes, type) {
    var statement = [];
    transfers.forEach(function(t) {
        var op = indexes.operationsById ? indexes.operationsById[t.operation_id] : null;
        var inv = indexes.investorsById ? indexes.investorsById[t.investor_id] : null;
        var include = false, isCredit = false;
        if (type === 'client') { include = _isClientFunding(t) || _isClientRepayment(t); isCredit = _isClientRepayment(t); }
        else if (type === 'investor') { include = _isInvestorFunding(t) || t.purpose === 'capital_return' || t.purpose === 'profit_distribution'; isCredit = (t.purpose === 'capital_return' || t.purpose === 'profit_distribution'); }
        if (!include) return;
        statement.push({ date: t.transfer_date, reference: t.reference_number || '-', type: (typeof getTransferTypeText === 'function') ? getTransferTypeText(t.type) : (t.type || '-'),
            purpose: (typeof getPurposeText === 'function') ? getPurposeText(t.purpose) : (t.purpose || '-'), operation: op ? op.name : '-', operationId: t.operation_id,
            investor: inv ? inv.name : '-', investorId: t.investor_id, amount: parseFloat(t.amount || 0), isCredit: isCredit, notes: t.notes || '-', created_at: t.created_at });
    });
    statement.sort(function(a, b) { return new Date(a.date || a.created_at) - new Date(b.date || b.created_at); });
    var rb = 0; statement.forEach(function(i) { rb += i.isCredit ? i.amount : -i.amount; i.runningBalance = rb; });
    statement.reverse(); return statement;
}

// ============================================================
// 7. COMPANY ENGINE
// ============================================================
function _companyFlowSide(t) {
    if (t.type) { if (t.type === 'investor_to_company') return 'in_investor'; if (t.type === 'client_to_company') return 'in_client'; if (t.type === 'company_to_client') return 'out_client'; if (t.type === 'company_to_investor') return 'out_investor'; return null; }
    if (_isInvestorFunding(t)) return 'in_investor'; if (_isClientRepayment(t)) return 'in_client'; if (_isClientFunding(t)) return 'out_client';
    if (t.purpose === 'capital_return' || t.purpose === 'profit_distribution') return 'out_investor'; return null;
}
function getCompanyBalance(data) {
    var tr = data.transfers || [];
    var fi = 0, fc = 0, tc = 0, tcr = 0, tpr = 0;
    tr.forEach(function(t) { var a = parseFloat(t.amount || 0); var s = _companyFlowSide(t);
        if (s === 'in_investor') fi += a; else if (s === 'in_client') fc += a; else if (s === 'out_client') tc += a;
        else if (s === 'out_investor') { if (t.purpose === 'profit_distribution') tpr += a; else tcr += a; } });
    var cashIn = fi + fc, cashOut = tc + tcr + tpr;
    return { companyCashBalance: cashIn - cashOut, cashIn: cashIn, cashOut: cashOut, cashReceivedFromInvestors: fi, cashCollectedFromClients: fc, cashPaidToClients: tc, cashReturnedToInvestors: tcr, cashProfitPaidToInvestors: tpr };
}
function calculateCompanySummary(data) {
    var b = getCompanyBalance(data); var ops = data.operations || [];
    var tCF = 0, tCR = 0, tIF = 0, tICR = 0, tIPE = 0, tIPD = 0, tCE = 0, tCA = 0, tCRP = 0;
    var totalOperations = ops.length, activeOperations = 0, completedOperations = 0, draftOperations = 0, activeOperationsValue = 0;
    ops.forEach(function(op) {
        if (op.status === STATUS.ACTIVE) { activeOperations++; activeOperationsValue += parseFloat(op.amount || 0); }
        else if (op.status === STATUS.COMPLETED) completedOperations++; else if (op.status === STATUS.DRAFT) draftOperations++;
        var f = getOperationFunding(op.id, data); var p = getOperationProfits(op.id, data);
        tCF += f.clientFunded; tCR += f.clientRepayment; tIF += f.funded; tICR += f.capitalReturned;
        if (p) { tIPE += p.investorEntitlement; tIPD += p.investorDistributed; tCE += p.companyExpected; tCA += p.companyApproved; tCRP += p.netProfit; }
    });
    return { companyCashBalance: b.companyCashBalance, cashIn: b.cashIn, cashOut: b.cashOut,
        totalClientFunded: tCF, totalClientRepaid: tCR, clientOutstandingCash: tCF - tCR,
        totalInvestorFunded: tIF, totalInvestorCapitalReturned: tICR, outstandingInvestorCapital: Math.max(0, tIF - tICR),
        totalInvestorProfitEntitlement: tIPE, totalInvestorProfitDistributed: tIPD, outstandingInvestorProfit: Math.max(0, tIPE - tIPD),
        totalCompanyExpectedProfit: tCE, totalCompanyApprovedProfit: tCA, totalCompanyRealizedProfit: tCRP,
        totalCashPaidToClients: b.cashPaidToClients, totalCashCollectedFromClients: b.cashCollectedFromClients, totalCashReceivedFromInvestors: b.cashReceivedFromInvestors,
        totalCashReturnedToInvestors: b.cashReturnedToInvestors, totalProfitPaidToInvestors: b.cashProfitPaidToInvestors,
        totalOperations: totalOperations, activeOperations: activeOperations, completedOperations: completedOperations, draftOperations: draftOperations, activeOperationsValue: activeOperationsValue };
}
function getOperationCompanySummary(operationId, data) {
    var op = data.indexes.operationsById ? data.indexes.operationsById[operationId] : null;
    if (!op) return null;
    var f = getOperationFunding(operationId, data); var p = getOperationProfits(operationId, data); var fl = getOperationClientFlows(operationId, data);
    return { operationValue: parseFloat(op.amount || 0), investorFunded: f.funded, clientFunded: fl.clientFunded, clientRepaid: fl.clientRepaid,
        investorCapitalReturned: f.capitalReturned, investorProfitDistributed: p.investorDistributed, companyExpectedProfit: p.companyExpected, companyApprovedProfit: p.companyApproved,
        companyRealizedProfit: p.netProfit, outstandingInvestorCapital: Math.max(0, f.funded - f.capitalReturned), outstandingInvestorProfit: p.investorRemaining,
        clientOutstandingCash: fl.clientFunded - fl.clientRepaid,
        companyCashImpact: (f.funded + fl.clientRepaid) - (fl.clientFunded + f.capitalReturned + p.investorDistributed) };
}

// ============================================================
// 8. COMPANY PROFIT FOR PERIOD (type-aware)
// ============================================================
function getCompanyProfitForPeriod(data, from, to) {
    var ops = data.operations || [];
    var totalApproved = 0, allTimeExpected = 0, rows = [];
    ops.forEach(function(op) {
        var p = getOperationProfits(op.id, data); if (!p) return;
        allTimeExpected += p.companyExpected;
        var d = p.profitDate; // تمويل: تاريخ العملية / توريد: تاريخ الاعتماد
        var inPeriod = !!d && (!from || d >= from) && (!to || d <= to);
        if (inPeriod) {
            totalApproved += p.companyApproved;
            var client = (data.indexes && data.indexes.clientsById) ? data.indexes.clientsById[op.client_id] : null;
            rows.push({ operationId: op.id, reference: op.reference_number || '-', name: op.name || '-', clientName: client ? client.name : '-',
                totalOperationProfit: p.approvedTotal, companyShare: p.companyApproved, approvalDate: d, profitDate: d, profitDateLabel: p.profitDateLabel, opType: op.type });
        }
    });
    rows.sort(function(a, b) { return (a.profitDate || '').localeCompare(b.profitDate || ''); });
    return { from: from || null, to: to || null, totalCompanyApprovedProfit: totalApproved, allTimeExpectedProfit: allTimeExpected, operations: rows };
}

// ============================================================
// END OF CALCULATIONS.JS (v2.6.0)
// ============================================================
