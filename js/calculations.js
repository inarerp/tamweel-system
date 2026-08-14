// ============================================================
// نظام إدارة التمويل - Calculations Module (مشترك)
// Version: 2.5.0
// Last Updated: 2026-08-14
// ============================================================
// v2.5.0: إضافة getCompanyProfitForPeriod() — ربح الشركة للفترة
//         يعتمد فقط على companyApproved + profit_approval_date
//         (بدون خلط مع cash flow)

// ============================================================
// 0. SHARED HELPERS (Backward Compatibility)
// ============================================================
function _isInvestorFunding(t) {
    if (t.type) return (t.type === 'investor_to_company');
    return (t.purpose === 'capital_funding' || t.purpose === 'client_funding');
}
function _isClientFunding(t) {
    if (t.type) return (t.type === 'company_to_client');
    return (t.purpose === 'client_funding' || t.purpose === 'additional_funding');
}
function _isClientRepayment(t) {
    if (t.type) return (t.type === 'client_to_company');
    return (t.purpose === 'client_repayment');
}
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
        totalFunded += flows.clientFunded;
        totalRepaid += flows.clientRepaid;
    });
    return {
        totalOperations: ops.length, activeOperations: activeOps, completedOperations: completedOps, draftOperations: draftOps,
        totalFunded: totalFunded, totalRepaid: totalRepaid, totalApprovedProfit: totalApprovedProfit,
        balance: totalRepaid - totalFunded, lastOperation: lastOperation
    };
}

// ============================================================
// 2. INVESTOR CALCULATIONS
// ============================================================
function calculateInvestorSummary(investorId, data) {
    var contribs = (data.indexes.opInvestorsByInvestor && data.indexes.opInvestorsByInvestor[investorId]) || [];
    var myTransfers = (data.indexes.transfersByInvestor && data.indexes.transfersByInvestor[investorId]) || [];
    var totalCapital = 0, totalProfit = 0, activeOps = 0, totalOps = contribs.length;
    contribs.forEach(function(c) {
        totalCapital += parseFloat(c.contribution || 0);
        totalProfit += parseFloat(c.profit || 0);
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
    var outstandingCommitment = Math.max(0, totalCapital - fundedCapital);
    var outstandingProfit = Math.max(0, totalProfit - profitPaid);
    return {
        totalCapital: totalCapital, committedCapital: totalCapital, fundedCapital: fundedCapital, workingCapital: fundedCapital,
        capitalReturned: capitalReturned, capitalPending: capitalPending, outstandingCommitment: outstandingCommitment,
        totalProfit: totalProfit, profitPaid: profitPaid, outstandingProfit: outstandingProfit,
        currentBalance: capitalPending + outstandingProfit, activeOperations: activeOps, totalOperations: totalOps
    };
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
    var funded = 0, clientFunded = 0, clientRepayment = 0, capitalReturned = 0, profitDistributed = 0, unmatchedInvestorFunding = [];
    opTransfers.forEach(function(t) {
        var a = parseFloat(t.amount || 0);
        if (_isInvestorFunding(t)) { funded += a; if (t.investor_id && !knownInvestors[t.investor_id]) unmatchedInvestorFunding.push({ transferId: t.id, investorId: t.investor_id, amount: a }); }
        else if (t.type === 'company_to_client') clientFunded += a;
        else if (t.type === 'client_to_company') clientRepayment += a;
        else if (t.purpose === 'capital_return') capitalReturned += a;
        else if (t.purpose === 'profit_distribution') profitDistributed += a;
    });
    return { required: required, committed: committed, funded: funded, clientFunded: clientFunded, clientRepayment: clientRepayment,
        capitalReturned: capitalReturned, profitDistributed: profitDistributed,
        remainingCommitment: Math.max(0, required - committed), remainingFunding: Math.max(0, required - funded), remainingClientFunding: Math.max(0, required - clientFunded),
        committedCoverage: required > 0 ? (committed / required) * 100 : 0, fundedCoverage: required > 0 ? (funded / required) * 100 : 0,
        perInvestor: perInvestor, unmatchedInvestorFunding: unmatchedInvestorFunding };
}

// ============================================================
// 4. OPERATION PROFITS
// ============================================================
function getOperationProfits(operationId, data) {
    var op = data.indexes.operationsById ? data.indexes.operationsById[operationId] : null;
    if (!op) return null;
    var f = getOperationFunding(operationId, data);
    var opInv = (data.indexes.opInvestorsByOperation && data.indexes.opInvestorsByOperation[operationId]) || [];
    var investorEntitlement = 0;
    opInv.forEach(function(oi) { investorEntitlement += parseFloat(oi.profit || 0); });
    var expectedTotal = parseFloat(op.expected_profit || 0);
    var approvedTotal = (op.final_profit && op.profit_approval_date) ? parseFloat(op.final_profit || 0) : 0;
    var companyExpected = _companyShare(op, expectedTotal);
    var companyApproved = _companyShare(op, approvedTotal);
    var totalProfitCollected = Math.max(0, f.clientRepayment - f.clientFunded);
    var netProfit = Math.max(0, totalProfitCollected - f.profitDistributed);
    var clientDueTotal = f.required + approvedTotal;
    var clientOutstanding = Math.max(0, clientDueTotal - f.clientRepayment);
    var profitAllocatedTotal = investorEntitlement + companyApproved;
    return { expectedTotal: expectedTotal, approvedTotal: approvedTotal, companyExpected: companyExpected, companyApproved: companyApproved,
        investorEntitlement: investorEntitlement, investorDistributed: f.profitDistributed, investorRemaining: Math.max(0, investorEntitlement - f.profitDistributed),
        capitalReturned: f.capitalReturned, clientRepayment: f.clientRepayment, clientFunded: f.clientFunded,
        totalProfitCollected: totalProfitCollected, netProfit: netProfit, clientDueTotal: clientDueTotal, clientOutstanding: clientOutstanding,
        profitAllocatedTotal: profitAllocatedTotal, profitReconciliationDifference: profitAllocatedTotal - approvedTotal,
        profitReconciled: (approvedTotal > 0) ? Math.abs(profitAllocatedTotal - approvedTotal) < 0.01 : true };
}
function _companyShare(op, profitBase) {
    var base = parseFloat(profitBase || 0);
    if (!base || !op) return 0;
    if (op.company_profit_type === 'percentage') return (base * parseFloat(op.company_profit_value || 0)) / 100;
    if (op.company_profit_type === 'fixed') return parseFloat(op.company_profit_value || 0);
    return 0;
}
function getCoverage(operationId, data) {
    var f = getOperationFunding(operationId, data);
    return { required: f.required, committed: f.committed, funded: f.funded, remainingCommitment: f.remainingCommitment, remainingFunding: f.remainingFunding, remainingClientFunding: f.remainingClientFunding, committedCoverage: f.committedCoverage, fundedCoverage: f.fundedCoverage };
}

// ============================================================
// 5. OPERATION SUMMARY
// ============================================================
function calculateOperationSummary(operationId, data) {
    var op = data.indexes.operationsById ? data.indexes.operationsById[operationId] : null;
    if (!op) return null;
    var f = getOperationFunding(operationId, data);
    var p = getOperationProfits(operationId, data);
    var companyProfit = 0;
    if (op.company_profit_type === 'percentage' && op.final_profit) companyProfit = (parseFloat(op.final_profit) * parseFloat(op.company_profit_value || 0)) / 100;
    else if (op.company_profit_type === 'fixed') companyProfit = parseFloat(op.company_profit_value || 0);
    return { investorCount: f.perInvestor.length, totalInvested: f.committed, totalInvestorProfit: p.investorEntitlement, companyProfit: companyProfit,
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
    var runningBalance = 0;
    statement.forEach(function(item) { runningBalance += item.isCredit ? item.amount : -item.amount; item.runningBalance = runningBalance; });
    statement.reverse();
    return statement;
}

// ============================================================
// 7. COMPANY ENGINE
// ============================================================
function _companyFlowSide(t) {
    if (t.type) {
        if (t.type === 'investor_to_company') return 'in_investor';
        if (t.type === 'client_to_company') return 'in_client';
        if (t.type === 'company_to_client') return 'out_client';
        if (t.type === 'company_to_investor') return 'out_investor';
        return null;
    }
    if (_isInvestorFunding(t)) return 'in_investor';
    if (_isClientRepayment(t)) return 'in_client';
    if (_isClientFunding(t)) return 'out_client';
    if (t.purpose === 'capital_return' || t.purpose === 'profit_distribution') return 'out_investor';
    return null;
}
function getCompanyBalance(data) {
    var transfers = data.transfers || [];
    var cashFromInvestors = 0, cashFromClients = 0, cashToClients = 0, cashToInvestorsCapital = 0, cashToInvestorsProfit = 0;
    transfers.forEach(function(t) {
        var a = parseFloat(t.amount || 0);
        var side = _companyFlowSide(t);
        if (side === 'in_investor') cashFromInvestors += a;
        else if (side === 'in_client') cashFromClients += a;
        else if (side === 'out_client') cashToClients += a;
        else if (side === 'out_investor') { if (t.purpose === 'profit_distribution') cashToInvestorsProfit += a; else cashToInvestorsCapital += a; }
    });
    var cashIn = cashFromInvestors + cashFromClients;
    var cashOut = cashToClients + cashToInvestorsCapital + cashToInvestorsProfit;
    return { companyCashBalance: cashIn - cashOut, cashIn: cashIn, cashOut: cashOut, cashReceivedFromInvestors: cashFromInvestors, cashCollectedFromClients: cashFromClients,
        cashPaidToClients: cashToClients, cashReturnedToInvestors: cashToInvestorsCapital, cashProfitPaidToInvestors: cashToInvestorsProfit };
}
function calculateCompanySummary(data) {
    var balance = getCompanyBalance(data);
    var operations = data.operations || [];
    var tCF = 0, tCR = 0, tIF = 0, tICR = 0, tIPE = 0, tIPD = 0, tCE = 0, tCA = 0, tCRP = 0;
    var totalOperations = operations.length, activeOperations = 0, completedOperations = 0, draftOperations = 0, activeOperationsValue = 0;
    operations.forEach(function(op) {
        if (op.status === STATUS.ACTIVE) { activeOperations++; activeOperationsValue += parseFloat(op.amount || 0); }
        else if (op.status === STATUS.COMPLETED) completedOperations++;
        else if (op.status === STATUS.DRAFT) draftOperations++;
        var f = getOperationFunding(op.id, data);
        var p = getOperationProfits(op.id, data);
        tCF += f.clientFunded; tCR += f.clientRepayment; tIF += f.funded; tICR += f.capitalReturned;
        if (p) { tIPE += p.investorEntitlement; tIPD += p.investorDistributed; tCE += p.companyExpected; tCA += p.companyApproved; tCRP += p.netProfit; }
    });
    return {
        companyCashBalance: balance.companyCashBalance, cashIn: balance.cashIn, cashOut: balance.cashOut,
        totalClientFunded: tCF, totalClientRepaid: tCR, clientOutstandingCash: tCF - tCR,
        totalInvestorFunded: tIF, totalInvestorCapitalReturned: tICR, outstandingInvestorCapital: Math.max(0, tIF - tICR),
        totalInvestorProfitEntitlement: tIPE, totalInvestorProfitDistributed: tIPD, outstandingInvestorProfit: Math.max(0, tIPE - tIPD),
        totalCompanyExpectedProfit: tCE, totalCompanyApprovedProfit: tCA, totalCompanyRealizedProfit: tCRP,
        totalCashPaidToClients: balance.cashPaidToClients, totalCashCollectedFromClients: balance.cashCollectedFromClients,
        totalCashReceivedFromInvestors: balance.cashReceivedFromInvestors, totalCashReturnedToInvestors: balance.cashReturnedToInvestors, totalProfitPaidToInvestors: balance.cashProfitPaidToInvestors,
        totalOperations: totalOperations, activeOperations: activeOperations, completedOperations: completedOperations, draftOperations: draftOperations, activeOperationsValue: activeOperationsValue
    };
}
function getOperationCompanySummary(operationId, data) {
    var op = data.indexes.operationsById ? data.indexes.operationsById[operationId] : null;
    if (!op) return null;
    var f = getOperationFunding(operationId, data);
    var p = getOperationProfits(operationId, data);
    var flows = getOperationClientFlows(operationId, data);
    return { operationValue: parseFloat(op.amount || 0), investorFunded: f.funded, clientFunded: flows.clientFunded, clientRepaid: flows.clientRepaid,
        investorCapitalReturned: f.capitalReturned, investorProfitDistributed: p.investorDistributed, companyExpectedProfit: p.companyExpected, companyApprovedProfit: p.companyApproved,
        companyRealizedProfit: p.netProfit, outstandingInvestorCapital: Math.max(0, f.funded - f.capitalReturned), outstandingInvestorProfit: p.investorRemaining,
        clientOutstandingCash: flows.clientFunded - flows.clientRepaid,
        companyCashImpact: (f.funded + flows.clientRepaid) - (flows.clientFunded + f.capitalReturned + p.investorDistributed) };
}

// ============================================================
// 8. COMPANY PROFIT FOR PERIOD (v2.5.0)
// الربح المعتمد للفترة = Σ companyApproved حيث profit_approval_date ضمن الفترة
// لا يعتمد على transfer_date / cash flow / client repayment / end_date
// ============================================================
function getCompanyProfitForPeriod(data, from, to) {
    var operations = data.operations || [];
    var totalApproved = 0;
    var allTimeExpected = 0;
    var rows = [];
    operations.forEach(function(op) {
        var p = getOperationProfits(op.id, data);
        if (!p) return;
        allTimeExpected += p.companyExpected;
        var d = op.profit_approval_date ? String(op.profit_approval_date).slice(0, 10) : null;
        var inPeriod = !!d && (!from || d >= from) && (!to || d <= to);
        if (inPeriod) {
            totalApproved += p.companyApproved;
            var client = (data.indexes && data.indexes.clientsById) ? data.indexes.clientsById[op.client_id] : null;
            rows.push({ operationId: op.id, reference: op.reference_number || '-', name: op.name || '-', clientName: client ? client.name : '-',
                totalOperationProfit: p.approvedTotal, companyShare: p.companyApproved, approvalDate: d });
        }
    });
    rows.sort(function(a, b) { return (a.approvalDate || '').localeCompare(b.approvalDate || ''); });
    return { from: from || null, to: to || null, totalCompanyApprovedProfit: totalApproved, allTimeExpectedProfit: allTimeExpected, operations: rows };
}

// ============================================================
// END OF CALCULATIONS.JS (v2.5.0)
// ============================================================
