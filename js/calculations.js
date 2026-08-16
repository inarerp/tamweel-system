// ============================================================
// نظام إدارة التمويل - Calculations Module (مشترك)
// Version: 2.11.0
// ============================================================
// v2.11.0: Option A — تسويات investor_to_client / client_to_investor تظهر في
//          كشوف الطرفين كسطور معلوماتية (isSettlement:true) بدون أي تأثير على
//          runningBalance أو أي معادلة مالية أو كاش الشركة + حل اسم الطرف المقابل.
// v2.10.1: توحيد تصنيف client flows في getOperationFunding
// v2.10.0: احتساب standalone client flows في Company Summary
// ============================================================
function _isInvestorFunding(t){ if(t.type) return (t.type==='investor_to_company'); return (t.purpose==='capital_funding'||t.purpose==='client_funding'); }
function _isClientFunding(t){ if(t.type) return (t.type==='company_to_client'); return (t.purpose==='client_funding'||t.purpose==='additional_funding'); }
function _isClientRepayment(t){ if(t.type) return (t.type==='client_to_company'); return (t.purpose==='client_repayment'); }
// ✅ v2.11.0: التسويات المباشرة ممول↔عميل
function _isInvestorToClient(t){ return t.type==='investor_to_client'; }
function _isClientToInvestor(t){ return t.type==='client_to_investor'; }
function _isFinancing(op){ return !!op && op.type==='financing'; }
function getOperationClientFlows(id,data){ var ot=(data.indexes.transfersByOperation&&data.indexes.transfersByOperation[id])||[]; var cf=0,cr=0; ot.forEach(function(t){ if(_isClientFunding(t))cf+=parseFloat(t.amount||0); else if(_isClientRepayment(t))cr+=parseFloat(t.amount||0); }); return {clientFunded:cf,clientRepaid:cr}; }
function getStandaloneClientFlows(clientId,data){
var cf=0,cr=0;
(data.transfers||[]).forEach(function(t){
if(t.operation_id) return;
if(!t.client_id) return;
if(clientId && t.client_id!==clientId) return;
if(_isClientFunding(t)) cf+=parseFloat(t.amount||0);
else if(_isClientRepayment(t)) cr+=parseFloat(t.amount||0);
});
return {clientFunded:cf,clientRepaid:cr};
}
function _operationProfitDate(op){ if(_isFinancing(op)){ var d=op.start_date||op.created_at||null; return {date:d?String(d).slice(0,10):null,label:'تاريخ العملية (تمويل)'}; } var d2=op.profit_approval_date?String(op.profit_approval_date).slice(0,10):null; return {date:d2,label:'تاريخ اعتماد الربح (توريد)'}; }
function _financingCompanyProfit(op){ if(!op)return 0; if(op.company_profit_type==='fixed')return parseFloat(op.company_profit_value||0); if(op.company_profit_type==='percentage'){ var b=parseFloat(op.final_profit||0)||parseFloat(op.expected_profit||0); return (b*parseFloat(op.company_profit_value||0))/100; } return 0; }
function calculateClientSummary(clientId,data){
var ops=(data.indexes.clientOperations&&data.indexes.clientOperations[clientId])||[];
if(ops.length===0&&data.operations)ops=data.operations.filter(function(op){return op.client_id===clientId;});
var a=0,c=0,dr=0,tf=0,tr=0,tap=0,last=null;
ops.forEach(function(op){ if(op.status===STATUS.ACTIVE)a++; else if(op.status===STATUS.COMPLETED)c++; else if(op.status===STATUS.DRAFT)dr++; if(op.final_profit&&op.profit_approval_date)tap+=parseFloat(op.final_profit||0); if(!last||new Date(op.created_at)>new Date(last.created_at))last=op; var fl=getOperationClientFlows(op.id,data); tf+=fl.clientFunded; tr+=fl.clientRepaid; });
var st=getStandaloneClientFlows(clientId,data); tf+=st.clientFunded; tr+=st.clientRepaid;
return {totalOperations:ops.length,activeOperations:a,completedOperations:c,draftOperations:dr,totalFunded:tf,totalRepaid:tr,totalApprovedProfit:tap,balance:tr-tf,lastOperation:last}; }
function calculateInvestorSummary(investorId,data){ var co=(data.indexes.opInvestorsByInvestor&&data.indexes.opInvestorsByInvestor[investorId])||[]; var mt=(data.indexes.transfersByInvestor&&data.indexes.transfersByInvestor[investorId])||[];
var tc=0,tp=0,act=0; co.forEach(function(x){ tc+=parseFloat(x.contribution||0); tp+=parseFloat(x.profit||0); var op=data.indexes.operationsById?data.indexes.operationsById[x.operation_id]:null; if(op&&op.status===STATUS.ACTIVE)act++; });
var fc=0,cr=0,pp=0; mt.forEach(function(t){ if(_isInvestorFunding(t))fc+=parseFloat(t.amount||0); else if(t.purpose==='capital_return')cr+=parseFloat(t.amount||0); else if(t.purpose==='profit_distribution')pp+=parseFloat(t.amount||0); });
var pend=Math.max(0,fc-cr);
return {totalCapital:tc,committedCapital:tc,fundedCapital:fc,workingCapital:fc,capitalReturned:cr,capitalPending:pend,outstandingCommitment:Math.max(0,tc-fc),totalProfit:tp,profitPaid:pp,outstandingProfit:Math.max(0,tp-pp),currentBalance:pend+Math.max(0,tp-pp),activeOperations:act,totalOperations:co.length}; }
function getOperationFunding(id,data){ var op=data.indexes.operationsById?data.indexes.operationsById[id]:null; var oi=(data.indexes.opInvestorsByOperation&&data.indexes.opInvestorsByOperation[id])||[]; var ot=(data.indexes.transfersByOperation&&data.indexes.transfersByOperation[id])||[];
var req=op?parseFloat(op.amount||0):0, com=0, known={}, per=[];
oi.forEach(function(x){ var cc=parseFloat(x.contribution||0),cp=parseFloat(x.profit||0); com+=cc; known[x.investor_id]=true; var f=0,r=0,p=0; ot.forEach(function(t){ if(t.investor_id!==x.investor_id)return; if(_isInvestorFunding(t))f+=parseFloat(t.amount||0); else if(t.purpose==='capital_return')r+=parseFloat(t.amount||0); else if(t.purpose==='profit_distribution')p+=parseFloat(t.amount||0); }); per.push({investorId:x.investor_id,opInvestorId:x.id,committed:cc,profit:cp,funded:f,returned:r,profitPaid:p,remaining:Math.max(0,cc-f),remainingCapital:Math.max(0,f-r),remainingProfit:Math.max(0,cp-p)}); });
var f=0,cf=0,cr=0,crtn=0,pd=0,un=[];
ot.forEach(function(t){ var a=parseFloat(t.amount||0); if(_isInvestorFunding(t)){ f+=a; if(t.investor_id&&!known[t.investor_id])un.push({transferId:t.id,investorId:t.investor_id,amount:a}); } else if(_isClientFunding(t))cf+=a; else if(_isClientRepayment(t))cr+=a; else if(t.purpose==='capital_return')crtn+=a; else if(t.purpose==='profit_distribution')pd+=a; });
return {required:req,committed:com,funded:f,clientFunded:cf,clientRepayment:cr,capitalReturned:crtn,profitDistributed:pd,remainingCommitment:Math.max(0,req-com),remainingFunding:Math.max(0,req-f),remainingClientFunding:Math.max(0,req-cf),committedCoverage:req>0?(com/req)*100:0,fundedCoverage:req>0?(f/req)*100:0,perInvestor:per,unmatchedInvestorFunding:un}; }
function getOperationProfits(id,data){ var op=data.indexes.operationsById?data.indexes.operationsById[id]:null; if(!op)return null;
var f=getOperationFunding(id,data); var oi=(data.indexes.opInvestorsByOperation&&data.indexes.opInvestorsByOperation[id])||[];
var ent=0; oi.forEach(function(x){ent+=parseFloat(x.profit||0);});
var exp=parseFloat(op.expected_profit||0); var approved,cExp,cApp,due;
if(_isFinancing(op)){ approved=parseFloat(op.final_profit||0)||exp; cApp=_financingCompanyProfit(op); cExp=cApp; due=f.required+ent+cApp; }
else { approved=(op.final_profit&&op.profit_approval_date)?parseFloat(op.final_profit||0):0; cExp=_companyShare(op,exp); cApp=_companyShare(op,approved); due=f.required+approved; }
var collected=(f.clientFunded<=0)?0:Math.max(0,f.clientRepayment-f.clientFunded);
var net=Math.max(0,collected-f.profitDistributed); var pdt=_operationProfitDate(op);
return {expectedTotal:exp,approvedTotal:approved,companyExpected:cExp,companyApproved:cApp,investorEntitlement:ent,investorDistributed:f.profitDistributed,investorRemaining:Math.max(0,ent-f.profitDistributed),capitalReturned:f.capitalReturned,clientRepayment:f.clientRepayment,clientFunded:f.clientFunded,totalProfitCollected:collected,netProfit:net,clientDueTotal:due,clientOutstanding:Math.max(0,due-f.clientRepayment),profitAllocatedTotal:ent+cApp,profitReconciliationDifference:(ent+cApp)-approved,profitReconciled:(approved>0)?Math.abs((ent+cApp)-approved)<0.01:true,profitDate:pdt.date,profitDateLabel:pdt.label,opType:op.type}; }
function _companyShare(op,base){ base=parseFloat(base||0); if(!base||!op)return 0; if(op.company_profit_type==='percentage')return (base*parseFloat(op.company_profit_value||0))/100; if(op.company_profit_type==='fixed')return parseFloat(op.company_profit_value||0); return 0; }
function getCoverage(id,data){ var f=getOperationFunding(id,data); return {required:f.required,committed:f.committed,funded:f.funded,remainingCommitment:f.remainingCommitment,remainingFunding:f.remainingFunding,remainingClientFunding:f.remainingClientFunding,committedCoverage:f.committedCoverage,fundedCoverage:f.fundedCoverage}; }
function calculateOperationSummary(id,data){ var op=data.indexes.operationsById?data.indexes.operationsById[id]:null; if(!op)return null; var f=getOperationFunding(id,data),p=getOperationProfits(id,data);
return {investorCount:f.perInvestor.length,totalInvested:f.committed,totalInvestorProfit:p.investorEntitlement,companyProfit:p.companyApproved,clientRepaid:f.clientRepayment,capitalReturned:p.capitalReturned,distributedProfit:p.investorDistributed,remainingProfit:p.investorRemaining,operation:op,committedCapital:f.committed,fundedCapital:f.funded,clientFunded:f.clientFunded,expectedCompanyProfit:p.companyExpected,realizedCompanyProfit:p.netProfit,coverage:{committedCoverage:f.committedCoverage,fundedCoverage:f.fundedCoverage}}; }
// ✅ v2.11.0: buildStatement يدعم التسويات كسطور معلوماتية محايدة + اسم الطرف المقابل
function buildStatement(transfers,indexes,type){ var st=[]; transfers.forEach(function(t){ var op=indexes.operationsById?indexes.operationsById[t.operation_id]:null; var inv=indexes.investorsById?indexes.investorsById[t.investor_id]:null; var cl=indexes.clientsById?indexes.clientsById[t.client_id]:null; var inc=false,cr=false,settlement=false;
if(type==='client'){
if(_isClientFunding(t)||_isClientRepayment(t)){ inc=true; cr=_isClientRepayment(t); }
else if(_isInvestorToClient(t)){ inc=true; cr=true; settlement=true; }
else if(_isClientToInvestor(t)){ inc=true; cr=false; settlement=true; }
} else if(type==='investor'){
if(_isInvestorFunding(t)||t.purpose==='capital_return'||t.purpose==='profit_distribution'){ inc=true; cr=(t.purpose==='capital_return'||t.purpose==='profit_distribution'); }
else if(_isInvestorToClient(t)){ inc=true; cr=false; settlement=true; }
else if(_isClientToInvestor(t)){ inc=true; cr=true; settlement=true; }
}
if(!inc)return;
st.push({date:t.transfer_date,reference:t.reference_number||'-',type:(typeof getTransferTypeText==='function')?getTransferTypeText(t.type):(t.type||'-'),purpose:(typeof getPurposeText==='function')?getPurposeText(t.purpose):(t.purpose||'-'),operation:op?op.name:'-',operationId:t.operation_id,investor:inv?inv.name:'-',investorId:t.investor_id,client:cl?cl.name:'-',clientId:t.client_id,amount:parseFloat(t.amount||0),isCredit:cr,isSettlement:settlement,notes:t.notes||'-',created_at:t.created_at}); });
st.sort(function(a,b){return new Date(a.date||a.created_at)-new Date(b.date||b.created_at);});
var rb=0; st.forEach(function(i){ if(!i.isSettlement){ rb+=i.isCredit?i.amount:-i.amount; } i.runningBalance=rb; }); st.reverse(); return st; }
function _companyFlowSide(t){ if(t.type){ if(t.type==='investor_to_company')return'in_investor'; if(t.type==='client_to_company')return'in_client'; if(t.type==='company_to_client')return'out_client'; if(t.type==='company_to_investor')return'out_investor'; return null; } if(_isInvestorFunding(t))return'in_investor'; if(_isClientRepayment(t))return'in_client'; if(_isClientFunding(t))return'out_client'; if(t.purpose==='capital_return'||t.purpose==='profit_distribution')return'out_investor'; return null; }
function getCompanyBalance(data){ var tr=data.transfers||[],fi=0,fc=0,tc=0,tcr=0,tpr=0,toth=0;
tr.forEach(function(t){ var a=parseFloat(t.amount||0),s=_companyFlowSide(t); if(s==='in_investor')fi+=a; else if(s==='in_client')fc+=a; else if(s==='out_client')tc+=a; else if(s==='out_investor'){ if(t.purpose==='profit_distribution')tpr+=a; else if(t.purpose==='capital_return')tcr+=a; else toth+=a; } });
var ci=fi+fc,co=tc+tcr+tpr+toth;
return {companyCashBalance:ci-co,cashIn:ci,cashOut:co,cashReceivedFromInvestors:fi,cashCollectedFromClients:fc,cashPaidToClients:tc,cashReturnedToInvestors:tcr,cashProfitPaidToInvestors:tpr,cashOtherToInvestors:toth}; }
function calculateCompanySummary(data){ var b=getCompanyBalance(data),ops=data.operations||[]; var tCF=0,tCR=0,tIF=0,tICR=0,tIPE=0,tIPD=0,tCE=0,tCA=0,tCRP=0,tO=ops.length,aO=0,cO=0,dO=0,aOV=0;
ops.forEach(function(op){ if(op.status===STATUS.ACTIVE){aO++;aOV+=parseFloat(op.amount||0);} else if(op.status===STATUS.COMPLETED)cO++; else if(op.status===STATUS.DRAFT)dO++; var f=getOperationFunding(op.id,data),p=getOperationProfits(op.id,data); tCF+=f.clientFunded;tCR+=f.clientRepayment;tIF+=f.funded;tICR+=f.capitalReturned; if(p){tIPE+=p.investorEntitlement;tIPD+=p.investorDistributed;tCE+=p.companyExpected;tCA+=p.companyApproved;tCRP+=p.netProfit;} });
var st=getStandaloneClientFlows(null,data); tCF+=st.clientFunded; tCR+=st.clientRepaid;
return {companyCashBalance:b.companyCashBalance,cashIn:b.cashIn,cashOut:b.cashOut,totalClientFunded:tCF,totalClientRepaid:tCR,clientOutstandingCash:tCF-tCR,totalInvestorFunded:tIF,totalInvestorCapitalReturned:tICR,outstandingInvestorCapital:Math.max(0,tIF-tICR),totalInvestorProfitEntitlement:tIPE,totalInvestorProfitDistributed:tIPD,outstandingInvestorProfit:Math.max(0,tIPE-tIPD),totalCompanyExpectedProfit:tCE,totalCompanyApprovedProfit:tCA,totalCompanyRealizedProfit:tCRP,totalCashPaidToClients:b.cashPaidToClients,totalCashCollectedFromClients:b.cashCollectedFromClients,totalCashReceivedFromInvestors:b.cashReceivedFromInvestors,totalCashReturnedToInvestors:b.cashReturnedToInvestors,totalProfitPaidToInvestors:b.cashProfitPaidToInvestors,totalOperations:tO,activeOperations:aO,completedOperations:cO,draftOperations:dO,activeOperationsValue:aOV}; }
function getOperationCompanySummary(id,data){ var op=data.indexes.operationsById?data.indexes.operationsById[id]:null; if(!op)return null; var f=getOperationFunding(id,data),p=getOperationProfits(id,data),fl=getOperationClientFlows(id,data);
return {operationValue:parseFloat(op.amount||0),investorFunded:f.funded,clientFunded:fl.clientFunded,clientRepaid:fl.clientRepaid,investorCapitalReturned:f.capitalReturned,investorProfitDistributed:p.investorDistributed,companyExpectedProfit:p.companyExpected,companyApprovedProfit:p.companyApproved,companyRealizedProfit:p.netProfit,outstandingInvestorCapital:Math.max(0,f.funded-f.capitalReturned),outstandingInvestorProfit:p.investorRemaining,clientOutstandingCash:fl.clientFunded-fl.clientRepaid,companyCashImpact:(f.funded+fl.clientRepaid)-(fl.clientFunded+f.capitalReturned+p.investorDistributed)}; }
function getCompanyProfitForPeriod(data,from,to){ var ops=data.operations||[],ta=0,ae=0,rows=[]; ops.forEach(function(op){ var p=getOperationProfits(op.id,data); if(!p)return; ae+=p.companyExpected; var d=p.profitDate; var inP=!!d&&(!from||d>=from)&&(!to||d<=to); if(inP){ ta+=p.companyApproved; var cl=(data.indexes&&data.indexes.clientsById)?data.indexes.clientsById[op.client_id]:null; rows.push({operationId:op.id,reference:op.reference_number||'-',name:op.name||'-',clientName:cl?cl.name:'-',totalOperationProfit:p.approvedTotal,companyShare:p.companyApproved,approvalDate:d,profitDate:d,profitDateLabel:p.profitDateLabel,opType:op.type}); } }); rows.sort(function(a,b){return (a.profitDate||'').localeCompare(b.profitDate||'');}); return {from:from||null,to:to||null,totalCompanyApprovedProfit:ta,allTimeExpectedProfit:ae,operations:rows}; }
// ============================================================
// END OF CALCULATIONS.JS (v2.11.0)
// ============================================================
