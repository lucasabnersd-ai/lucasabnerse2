const BOOT = window.__SE2__ || { data: [], updatedAt: "", monitoredInit: {}, pagamentosInit: {} };
const BACKUP = window.__SE2_BACKUP__ || { pagamentos_uuid: {}, monitored_uuid: {}, uuids_vistos: [], exportadoEm: "" };
const DATA = BOOT.data || [];
// PAGAMENTOS_INIT / MONITORED_INIT: prioridade ao que vem do Python (datos.js).
// Fallback: usa o que foi salvo no backup.js (gerado do JSON de backup).
const PAGAMENTOS_INIT = (BOOT.pagamentosInit && Object.keys(BOOT.pagamentosInit).length) ? BOOT.pagamentosInit : {};
const MONITORED_INIT = (BOOT.monitoredInit && Object.keys(BOOT.monitoredInit).length) ? BOOT.monitoredInit : {};
// Conjunto de UUIDs da última base (usado em "Novos Títulos" p/ diff com a carga anterior).
const UUIDS_BASE_ANTERIOR = new Set((BACKUP.uuids_vistos || []).map(u => String(u).toUpperCase()));
function applyBootMeta(){
  const el = document.getElementById("hdt");
  if(!el || !BOOT.updatedAt) return;
  const d = new Date(BOOT.updatedAt);
  el.textContent = isNaN(d.getTime()) ? String(BOOT.updatedAt) : d.toLocaleString("pt-BR",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"});
}

// ===== TOAST =====
let _toastTimer = null;
function showToast(msg, type='warn', duration=3500){
  const el = document.getElementById('toast');
  if(!el) return;
  el.textContent = msg;
  el.className = 'toast ' + type;
  void el.offsetWidth;
  el.classList.add('show');
  if(_toastTimer) clearTimeout(_toastTimer);
  _toastTimer = setTimeout(()=>{ el.classList.remove('show'); }, duration);
}

// ===== FILTRO ESPECIAL: ABERRAÇÃO DE DATA =====
let filterAberracao = false;

const sel = {emp:new Set(), st:new Set()};
const fmtBR = v => 'R$ ' + Number(v).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
const fmtDt = s => s?s.split('-').reverse().join('/'):'—';
// === CHAVE COMPOSTA p/ pagamentos: permite mesmo título em dias diferentes ===
function pagCompKey(id, dt){ return id + '|' + dt; }
function pagOrigId(key){ return parseInt(String(key).split('|')[0]); }
function pagKeyDate(key){ return String(key).split('|')[1] || ''; }
function getPagSendDate(){ const el=document.getElementById('pag-date-send'); return (el&&el.value)?el.value:today(); }
function escHtml(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
/** Separa "usuario.protheus - 05/02/2025" em nome e data DD/MM/AAAA */
function splitUserDate(s){
  const str = String(s||'').trim();
  if(!str) return {name:'', date:''};
  const m = str.match(/^(.+?)\s*-\s*(\d{2}\/\d{2}\/\d{4})\s*$/);
  if(m) return {name:(m[1]||'').trim()||'—', date:m[2]};
  const m2 = str.match(/(\d{2}\/\d{2}\/\d{4})\s*$/);
  if(m2){
    const name = str.slice(0, m2.index).replace(/\s*-\s*$/,'').trim();
    return {name:name||'—', date:m2[1]};
  }
  return {name:str, date:''};
}
function brDateToISO(d){
  const m = String(d||'').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
}
function rowMatchesUserFilters(r, pfx){
  const gv = id=>{ const el=document.getElementById(pfx+id); return el?el.value:''; };
  const uq = gv('uuid').trim().toLowerCase().replace(/\s+/g,'');
  if(uq && !String(r.uuid||'').toLowerCase().replace(/\s+/g,'').includes(uq)) return false;
  const incN = gv('inc-name').toLowerCase();
  const inc = splitUserDate(r.usrInc);
  if(incN && !String(inc.name||'').toLowerCase().includes(incN)) return false;
  const isoInc = brDateToISO(inc.date);
  if(gv('inc1') && (!isoInc || isoInc < gv('inc1'))) return false;
  if(gv('inc2') && (!isoInc || isoInc > gv('inc2'))) return false;
  const altN = gv('alt-name').toLowerCase();
  const alt = splitUserDate(r.usrAlt);
  if(altN && !String(alt.name||'').toLowerCase().includes(altN)) return false;
  const isoAlt = brDateToISO(alt.date);
  if(gv('alt1') && (!isoAlt || isoAlt < gv('alt1'))) return false;
  if(gv('alt2') && (!isoAlt || isoAlt > gv('alt2'))) return false;
  return true;
}
function copyUUID(btn){
  const t = String(btn&&btn.dataset&&btn.dataset.uuid!=null?btn.dataset.uuid:'').trim();
  if(!t){ alert('Sem UUID'); return; }
  const ok = ()=>{ const o=btn.textContent; btn.textContent='Copiado!'; setTimeout(()=>{ btn.textContent=o||'📋 Copiar'; }, 1200); };
  if(navigator.clipboard&&navigator.clipboard.writeText){ navigator.clipboard.writeText(t).then(ok).catch(()=>{}); }
  else { const ta=document.createElement('textarea'); ta.value=t; document.body.appendChild(ta); ta.select(); try{document.execCommand('copy');}catch(e){} ta.remove(); ok(); }
}
// AJUSTE FILTRO EMPRESA: extrai todas as relacoes filial+empresa da base SE2
function companyPairKey(filial, empresa){ return `${String(filial||'').trim()}|${String(empresa||'').trim()}`; }
function companyPairFromRow(r){ return companyPairKey(r?.filial, r?.empresa); }
function buildCompanyPairsFromSE2(){
  const map = new Map();
  DATA.forEach(r=>{
    const filial = String(r?.filial||'').trim();
    const empresa = String(r?.empresa||'').trim();
    if(!filial && !empresa) return;
    const key = companyPairKey(filial, empresa);
    // Filtro exibido no formato EMPRESA - FILIAL (com numero da filial)
    if(!map.has(key)) map.set(key, { key, filial, empresa, label: `${empresa} - ${filial}`.trim() });
  });
  return [...map.values()].sort((a,b)=>{
    // Ordenacao por EMPRESA - FILIAL para bater com o filtro visual
    const ea = a.empresa.localeCompare(b.empresa, 'pt-BR');
    if(ea !== 0) return ea;
    return a.filial.localeCompare(b.filial, 'pt-BR');
  });
}
const COMPANY_PAIRS_ALL = buildCompanyPairsFromSE2();
function populateFilialFilter(){
  const selFilial = document.getElementById('f-filial');
  if(!selFilial) return;
  selFilial.innerHTML = `<option value="">Todas</option>` + COMPANY_PAIRS_ALL.map(c=>`<option value="${c.key}">${c.label}</option>`).join('');
}

(function(){
  document.getElementById('emps').innerHTML=COMPANY_PAIRS_ALL.map(c=>`<span class="pill" data-emp="${c.key}" onclick="togEmp(this)">${c.label}</span>`).join('');
})();
function togEmp(el){ const v=el.dataset.emp; if(sel.emp.has(v)){sel.emp.delete(v);el.classList.remove('on')} else{sel.emp.add(v);el.classList.add('on')} render(true); }
function togSt(el){ const v=el.dataset.st; if(sel.st.has(v)){sel.st.delete(v);el.classList.remove('on')} else{sel.st.add(v);el.classList.add('on')} render(true); }
function clearF(){ filterAberracao=false; ['f-num','f-razao','f-forn','f-vmin','f-vmax','f-vliq1','f-vliq2','f-em1','f-em2','f-vr1','f-vr2','f-tipo','f-hist','f-uuid','f-inc-name','f-inc1','f-inc2','f-alt-name','f-alt1','f-alt2'].forEach(i=>{const el=document.getElementById(i);if(el)el.value='';}); sel.emp.clear(); sel.st.clear(); document.querySelectorAll('#p-all .pill.on').forEach(p=>p.classList.remove('on')); render(true); }

function atrCls(n){ if(!n) return 'atr-0'; if(n>180) return 'atr-crit'; if(n>60) return 'atr-hi'; return 'atr-med'; }
function stCls(s){ return {'Vencido':'st-venc','Baixado':'st-baix','A Vencer':'st-aven','Baixa Parcial':'st-parc'}[s]||''; }

function filtered(){
  const gv=i=>{const el=document.getElementById(i); return el?el.value:'';};
  const q=gv('f-num').toLowerCase(), rz=gv('f-razao').toLowerCase(), fn=gv('f-forn').toLowerCase();
  const tp=gv('f-tipo').toLowerCase(), ht=gv('f-hist').toLowerCase();
  const vmin=parseFloat(gv('f-vmin'))||-Infinity, vmax=parseFloat(gv('f-vmax'))||Infinity;
  const vliq1=parseFloat(gv('f-vliq1'))||-Infinity, vliq2=parseFloat(gv('f-vliq2'))||Infinity;
  const em1=gv('f-em1'), em2=gv('f-em2');
  const vr1=gv('f-vr1'), vr2=gv('f-vr2');
  return DATA.filter(r=>{
    if(q && !r.num.toLowerCase().includes(q)) return false;
    if(rz && !r.razao.toLowerCase().includes(rz)) return false;
    if(fn && !r.fornecedor.toLowerCase().includes(fn)) return false;
    if(tp && !r.tipo.toLowerCase().includes(tp)) return false;
    if(ht && !r.historico.toLowerCase().includes(ht)) return false;
    if(r.valor<vmin||r.valor>vmax) return false;
    if((r.valLiqBaix||0)<vliq1||(r.valLiqBaix||0)>vliq2) return false;
    if(em1 && r.emissao<em1) return false;
    if(em2 && r.emissao>em2) return false;
    if(vr1 && r.vencReal<vr1) return false;
    if(vr2 && r.vencReal>vr2) return false;
    if(sel.emp.size && !sel.emp.has(companyPairFromRow(r))) return false;
    if(sel.st.size && !sel.st.has(r.status)) return false;
    if(filterAberracao){ const y=r.vencimento?+r.vencimento.slice(0,4):0; if(y<=2030) return false; }
    if(!rowMatchesUserFilters(r, 'f-')) return false;
    return true;
  });
}



// ===== ESTADO =====
const pagamentos = {}; // id -> {obs,dt,acrescimo,decrescimo,statusPag}
const monitored  = {}; // id -> {obs,ts}
const selPag = {emp:new Set(), st:new Set()};
const selMon = {emp:new Set(), st:new Set()};
const titulosManuais = []; // títulos inseridos manualmente
let _manualIdCounter = -1; // IDs negativos para manuais

function getManualById(id){ return titulosManuais.find(t=>t.id===id); }

function updatePagAcrescimo(keyOrId, val){
  const v = parseFloat(String(val).replace(',','.')) || 0;
  const k = String(keyOrId);
  if(/^-\d+$/.test(k)){
    const m = getManualById(parseInt(k));
    if(m) m.acrescimo = v;
  } else {
    if(!pagamentos[k]) return;
    pagamentos[k].acrescimo = v;
  }
  salvarEstado(); renderPagTotals();
}
function updatePagDecrescimo(keyOrId, val){
  const v = parseFloat(String(val).replace(',','.')) || 0;
  const k = String(keyOrId);
  if(/^-\d+$/.test(k)){
    const m = getManualById(parseInt(k));
    if(m) m.decrescimo = v;
  } else {
    if(!pagamentos[k]) return;
    pagamentos[k].decrescimo = v;
  }
  salvarEstado(); renderPagTotals();
}
function updatePagStatus(keyOrId, val){
  const k = String(keyOrId);
  if(/^-\d+$/.test(k)){
    const m = getManualById(parseInt(k));
    if(m) m.statusPag = val;
  } else {
    if(!pagamentos[k]) return;
    pagamentos[k].statusPag = val;
  }
  salvarEstado();
}
function togAllPag(master, dt){
  const cbs = document.querySelectorAll('#p-pag .pag-cb');
  cbs.forEach(cb=>{ cb.checked = master.checked; });
}
function marcarStatusBulk(status){
  const cbs = [...document.querySelectorAll('#p-pag .pag-cb:checked')];
  if(!cbs.length){ showToast('⚠️ Selecione pelo menos um título','warn'); return; }
  const keys = cbs.map(cb=>cb.dataset.id);
  keys.forEach(k=>updatePagStatus(k, status));
  salvarEstado();
  const lbl = status==='Debitado'?'✅ Debitado':status==='Rejeitado'?'❌ Rejeitado':'🔄 Status limpo';
  showToast(`${lbl} — ${keys.length} título(s) atualizado(s)`, status==='Rejeitado'?'warn':'ok');
  renderPAG();
}
function calcValorTotalPago(saldo, acrescimo, decrescimo){
  return (saldo||0) + (acrescimo||0) - (decrescimo||0);
}
function renderPagTotals(){
  // Atualiza apenas os campos de valor total pago visíveis na tela
  document.querySelectorAll('.pag-vtp').forEach(el=>{
    const saldo = parseFloat(el.dataset.saldo)||0;
    const idVal = el.dataset.id;
    let acr=0, dec=0;
    const acrEl = document.querySelector(`.pag-acr-input[data-id="${idVal}"]`);
    const decEl = document.querySelector(`.pag-dec-input[data-id="${idVal}"]`);
    if(acrEl) acr = parseFloat(String(acrEl.value).replace(',','.'))||0;
    if(decEl) dec = parseFloat(String(decEl.value).replace(',','.'))||0;
    el.textContent = fmtBR(calcValorTotalPago(saldo, acr, dec));
  });
  // Atualiza estatísticas
  updatePagStats();
}
function updatePagStats(){
  let allEntries = Object.entries(pagamentos).map(([key,p])=>{const oid=p._origId!==undefined?p._origId:pagOrigId(key);return{r:DATA.find(x=>x.id===oid),...p,_id:key};}).filter(e=>e.r);
  titulosManuais.forEach(m=>{ allEntries.push({r:m, ...m, _id:m.id}); });
  const totPago = allEntries.reduce((s,e)=>{
    const saldo = e.r.saldo||0;
    const acr = e.acrescimo||e.r.acrescimo||0;
    const dec = e.decrescimo||e.r.decrescimo||0;
    return s + calcValorTotalPago(saldo, acr, dec);
  },0);
  const totSaldo = allEntries.reduce((s,e)=>s+(e.r.saldo||0),0);
  const statEl = document.getElementById('pag-stats');
  if(statEl){
    const hj = allEntries.filter(e=>e.dt===today()).length;
    const dias = new Set(allEntries.map(e=>e.dt)).size;
    statEl.innerHTML = `
      <div class="pag-stat"><div class="l">Títulos</div><div class="v">${allEntries.length}</div></div>
      <div class="pag-stat"><div class="l">Saldo Total</div><div class="v">${fmtBR(totSaldo)}</div></div>
      <div class="pag-stat"><div class="l">Total Pago</div><div class="v">${fmtBR(totPago)}</div></div>
      <div class="pag-stat"><div class="l">Dias com envios</div><div class="v">${dias}</div></div>
      <div class="pag-stat"><div class="l">Enviados hoje</div><div class="v">${hj}</div></div>`;
  }
}


// ===== PERSISTÊNCIA DE ESTADO (localStorage + UUID) =====
function _buildUUIDState(){
  // Converte estado atual (por chave composta) para estado por UUID|dt (para exportação segura)
  const pagUUID = {}, monUUID = {};
  Object.entries(pagamentos).forEach(([key, val]) => {
    const origId = val._origId !== undefined ? val._origId : pagOrigId(key);
    const r = DATA.find(x => x.id === origId);
    if(r && r.uuid){
      const dt = val.dt || pagKeyDate(key) || '';
      const exportKey = r.uuid + '|' + dt;
      pagUUID[exportKey] = val;
    }
  });
  Object.entries(monitored).forEach(([id, val]) => {
    const r = DATA.find(x => x.id === +id);
    if(r && r.uuid) monUUID[r.uuid] = val;
  });
  return {pagUUID, monUUID};
}

function salvarEstado(){
  try{
    const {pagUUID, monUUID} = _buildUUIDState();
    localStorage.setItem('se2_pagamentos', JSON.stringify(pagamentos));
    localStorage.setItem('se2_monitored',  JSON.stringify(monitored));
    localStorage.setItem('se2_pagamentos_uuid', JSON.stringify(pagUUID));
    localStorage.setItem('se2_monitored_uuid',  JSON.stringify(monUUID));
    localStorage.setItem('se2_titulos_manuais', JSON.stringify(titulosManuais));
  }catch(e){}
}

function _migrateOldPagKey(k, val){
  // Migra chave antiga (numérica) para formato composto id|dt
  if(String(k).includes('|')) return {key:k, val};
  const dt = val.dt || today();
  val._origId = +k;
  return {key: pagCompKey(+k, dt), val};
}
function _restorePagFromUUID(source){
  // Restaura pagamentos a partir de um mapa UUID (ou UUID|dt) → val
  if(!source || typeof source !== 'object') return;
  Object.entries(source).forEach(([uuidKey, val]) => {
    let uuid, dt;
    if(uuidKey.includes('|')){
      const parts = uuidKey.split('|');
      uuid = parts[0]; dt = parts[1] || val.dt || today();
    } else {
      uuid = uuidKey; dt = val.dt || today();
    }
    const r = DATA.find(x => x.uuid === uuid);
    if(!r) return;
    val._origId = r.id;
    const key = pagCompKey(r.id, dt);
    if(pagamentos[key] === undefined) pagamentos[key] = val;
  });
}
function _deduplicatePagamentos(){
  // Remove entradas cujo título não existe mais na base e deduplica por UUID+dt
  const seen = new Map();
  Object.keys(pagamentos).forEach(key => {
    const val = pagamentos[key];
    const origId = val._origId !== undefined ? val._origId : pagOrigId(key);
    const r = DATA.find(x => x.id === origId);
    if(!r){ delete pagamentos[key]; return; }
    const dedupeKey = (r.uuid || origId) + '|' + (val.dt || '');
    if(seen.has(dedupeKey)){
      delete pagamentos[key];
    } else {
      seen.set(dedupeKey, key);
    }
  });
}
function restaurarEstado(){
  try{
    // 1) Estado injetado pelo Python (baseado em ID atual, já convertido via UUID)
    //    Migra para chave composta id|dt
    if(PAGAMENTOS_INIT && Object.keys(PAGAMENTOS_INIT).length){
      Object.entries(PAGAMENTOS_INIT).forEach(([k, val])=>{
        const m = _migrateOldPagKey(k, val);
        pagamentos[m.key] = m.val;
      });
    }
    if(MONITORED_INIT && Object.keys(MONITORED_INIT).length){
      Object.keys(MONITORED_INIT).forEach(k=>{ monitored[+k]=MONITORED_INIT[k]; });
    }
    // 2) Backup por UUID (backup.js): aplica apenas chaves que ainda não existem
    _restorePagFromUUID(BACKUP.pagamentos_uuid);
    if(BACKUP.monitored_uuid){
      Object.entries(BACKUP.monitored_uuid).forEach(([uuid, val]) => {
        const r = DATA.find(x => x.uuid === uuid);
        if(r && monitored[r.id] === undefined) monitored[r.id] = val;
      });
    }
    // 3) Fallback final: localStorage (sessões anteriores do próprio navegador)
    try{
      const puuid = localStorage.getItem('se2_pagamentos_uuid');
      if(puuid) _restorePagFromUUID(JSON.parse(puuid));
      const muuid = localStorage.getItem('se2_monitored_uuid');
      if(muuid){
        const obj = JSON.parse(muuid);
        Object.entries(obj).forEach(([uuid, val]) => {
          const r = DATA.find(x => x.uuid === uuid);
          if(r && monitored[r.id] === undefined) monitored[r.id] = val;
        });
      }
    }catch(_){ /* localStorage pode estar bloqueado; ignore */ }
    // 3.5) Migrar chaves antigas do localStorage (formato numérico) se existirem
    try{
      const pOld = localStorage.getItem('se2_pagamentos');
      if(pOld){
        const obj = JSON.parse(pOld);
        Object.entries(obj).forEach(([k, val])=>{
          const m = _migrateOldPagKey(k, val);
          if(pagamentos[m.key] === undefined) pagamentos[m.key] = m.val;
        });
      }
    }catch(_){}
    // 4) Deduplicar: remove títulos que não existem mais e duplicatas por UUID+dt
    _deduplicatePagamentos();
    // 5) Restaurar títulos manuais
    try{
      const tm = localStorage.getItem('se2_titulos_manuais');
      if(tm){
        const arr = JSON.parse(tm);
        arr.forEach(m=>{ if(!titulosManuais.find(x=>x.id===m.id)) titulosManuais.push(m); });
        if(titulosManuais.length) _manualIdCounter = Math.min(_manualIdCounter, ...titulosManuais.map(m=>m.id)) - 1;
      }
    }catch(_){}
    document.getElementById('b-pag').textContent=Object.keys(pagamentos).length + titulosManuais.length;
    document.getElementById('b-mon').textContent=Object.keys(monitored).length;
  }catch(e){ console.error('Erro ao restaurar estado:', e); }
}

function exportarEstado(){
  salvarEstado();
  const {pagUUID, monUUID} = _buildUUIDState();
  const estado={
    pagamentos: pagamentos,
    monitored:  monitored,
    pagamentos_uuid: pagUUID,
    monitored_uuid:  monUUID,
    uuids_vistos: DATA.map(r=>r.uuid),
    exportadoEm: new Date().toISOString(),
    titulosManuais: titulosManuais,
    totalPag: Object.keys(pagamentos).length + titulosManuais.length,
    totalMon: Object.keys(monitored).length
  };
  const blob=new Blob([JSON.stringify(estado,null,2)],{type:'application/json'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download='se2_estado.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
  setTimeout(()=>{
    alert(
      '✅ Estado exportado com sucesso!\n\n' +
      '📌 Títulos em monitoramento: ' + estado.totalMon + '\n' +
      '💰 Títulos enviados p/ pagamento: ' + estado.totalPag + '\n\n' +
      '▶ Próximos passos:\n' +
      '1. Salve o arquivo se2_estado.json junto aos arquivos publicados\n' +
      '2. Rode a rotina de atualização da base\n' +
      '3. Publique novamente os arquivos estáticos no GitHub Pages ou no host que estiver usando'
    );
  },200);
}

function today(){ return new Date().toISOString().slice(0,10); }

// Modal genérico
function openModal(title,desc,onOk){
  document.getElementById('mdl-title').textContent=title;
  document.getElementById('mdl-desc').textContent=desc;
  document.getElementById('mdl-obs').value='';
  document.getElementById('mdl').classList.add('on');
  document.getElementById('mdl-ok').onclick=()=>{onOk(document.getElementById('mdl-obs').value); closeMdl();};
}
function closeMdl(){ document.getElementById('mdl').classList.remove('on'); }

// Envios
function sendPag(id){
  const r=DATA.find(x=>x.id===id); if(!r) return;
  const dt = getPagSendDate();
  const key = pagCompKey(id, dt);
  if(pagamentos[key]){
    showToast(`⚠️ "${r.num} — ${r.razao.slice(0,30)}" já foi enviado no dia ${fmtDt(dt)}!`, 'warn');
    return;
  }
  openModal('💰 Enviar para Pagamento',`${r.num} — ${r.razao} — ${fmtBR(r.valor)} · Data: ${fmtDt(dt)}`,obs=>{
    pagamentos[key]={obs,dt,_origId:id}; salvarEstado(); populateEmps('pag'); renderPAG(); document.getElementById('b-pag').textContent=Object.keys(pagamentos).length+titulosManuais.length;
    showToast(`✅ Título ${r.num} enviado para Pagamento (${fmtDt(dt)})`, 'ok');
    const cb=document.querySelector(`.rcb[data-id="${id}"]`); if(cb) cb.checked=false;
  });
}
function sendPagBulk(){
  const ids=[...document.querySelectorAll('#p-all .rcb:checked')].map(c=>+c.dataset.id);
  if(!ids.length){alert('Selecione pelo menos um título'); return;}
  const dt = getPagSendDate();
  const jaEnviados = ids.filter(id=>pagamentos[pagCompKey(id, dt)]);
  if(jaEnviados.length === ids.length){ showToast(`⚠️ Todos os ${ids.length} títulos já foram enviados no dia ${fmtDt(dt)}!`, 'warn'); return; }
  if(jaEnviados.length){ showToast(`ℹ️ ${jaEnviados.length} título(s) já enviados neste dia serão ignorados.`, 'warn', 4000); }
  const novos = ids.filter(id=>!pagamentos[pagCompKey(id, dt)]);
  openModal(`💰 Enviar ${novos.length} títulos · ${fmtDt(dt)}`,'Observação aplicada a todos',obs=>{
    novos.forEach(id=>pagamentos[pagCompKey(id, dt)]={obs,dt,_origId:id}); salvarEstado(); populateEmps('pag'); renderPAG(); document.getElementById('b-pag').textContent=Object.keys(pagamentos).length+titulosManuais.length;
    showToast(`✅ ${novos.length} título(s) enviados para Pagamento (${fmtDt(dt)})`, 'ok');
    document.querySelectorAll('#p-all .rcb:checked').forEach(cb=>cb.checked=false);
    document.querySelector('#p-all thead input[type=checkbox]').checked=false;
  });
}
function openMonitor(id){
  const r=DATA.find(x=>x.id===id); if(!r) return;
  if(monitored[id]){
    showToast(`⚠️ "${r.num} — ${r.razao.slice(0,30)}" já está em Monitoramento!`, 'warn');
    return;
  }
  openModal('📌 Monitorar',`${r.num} — ${r.razao}`,obs=>{
    const snap={status:DATA.find(x=>x.id===id)?.status,saldo:DATA.find(x=>x.id===id)?.saldo,atraso:DATA.find(x=>x.id===id)?.atraso,vencimento:DATA.find(x=>x.id===id)?.vencimento};
    monitored[id]={obs,ts:today(),snap}; salvarEstado(); populateEmps('mon'); renderMON(); document.getElementById('b-mon').textContent=Object.keys(monitored).length;
    showToast(`✅ Título ${r.num} adicionado ao Monitoramento`, 'ok');
    const cb=document.querySelector(`.rcb[data-id="${id}"]`); if(cb) cb.checked=false;
  });
}
function openMonitorBulk(){
  const ids=[...document.querySelectorAll('#p-all .rcb:checked')].map(c=>+c.dataset.id);
  if(!ids.length){alert('Selecione pelo menos um título'); return;}
  const jaMonitorados = ids.filter(id=>monitored[id]);
  if(jaMonitorados.length === ids.length){ showToast(`⚠️ Todos os ${ids.length} títulos selecionados já estão em Monitoramento!`, 'warn'); return; }
  if(jaMonitorados.length){ showToast(`ℹ️ ${jaMonitorados.length} título(s) já monitorados serão ignorados.`, 'warn', 4000); }
  const novos = ids.filter(id=>!monitored[id]);
  openModal(`📌 Monitorar ${novos.length} títulos`,'',obs=>{
    novos.forEach(id=>{const rx=DATA.find(x=>x.id===id); const snap={status:rx?.status,saldo:rx?.saldo,atraso:rx?.atraso,vencimento:rx?.vencimento}; monitored[id]={obs,ts:today(),snap};}); salvarEstado(); populateEmps('mon'); renderMON(); document.getElementById('b-mon').textContent=Object.keys(monitored).length;
    showToast(`✅ ${novos.length} título(s) adicionados ao Monitoramento`, 'ok');
    document.querySelectorAll('#p-all .rcb:checked').forEach(cb=>cb.checked=false);
    document.querySelector('#p-all thead input[type=checkbox]').checked=false;
  });
}
function removePag(key){delete pagamentos[String(key)]; salvarEstado(); renderPAG(); document.getElementById('b-pag').textContent=Object.keys(pagamentos).length+titulosManuais.length;}
function removeMon(id){delete monitored[id]; salvarEstado(); renderMON(); document.getElementById('b-mon').textContent=Object.keys(monitored).length;}
function editPagObs(key){
  key = String(key);
  const cur = pagamentos[key]; if(!cur) return;
  const origId = cur._origId !== undefined ? cur._origId : pagOrigId(key);
  const r = DATA.find(x=>x.id===origId); if(!r) return;
  document.getElementById('mdl-title').textContent='✏️ Editar Observação';
  document.getElementById('mdl-desc').textContent=`${r.num} — ${r.razao}`;
  document.getElementById('mdl-obs').value=cur.obs||'';
  document.getElementById('mdl').classList.add('on');
  document.getElementById('mdl-ok').onclick=()=>{ pagamentos[key]={...cur, obs:document.getElementById('mdl-obs').value}; salvarEstado(); closeMdl(); renderPAG(); };
}
function editMonObs(id){
  const r=DATA.find(x=>x.id===id); if(!r) return;
  const cur=monitored[id]||{};
  document.getElementById('mdl-title').textContent='✏️ Editar Observação';
  document.getElementById('mdl-desc').textContent=`${r.num} — ${r.razao}`;
  document.getElementById('mdl-obs').value=cur.obs||'';
  document.getElementById('mdl').classList.add('on');
  document.getElementById('mdl-ok').onclick=()=>{ monitored[id]={...cur, obs:document.getElementById('mdl-obs').value}; salvarEstado(); closeMdl(); renderMON(); };
}

// === TÍTULOS MANUAIS ===
function editManualObs(id){
  const m = getManualById(id); if(!m) return;
  document.getElementById('mdl-title').textContent='✏️ Editar Observação';
  document.getElementById('mdl-desc').textContent=`Manual: ${m.filial} - ${m.empresa} · ${m.tipo}`;
  document.getElementById('mdl-obs').value=m.obs||'';
  document.getElementById('mdl').classList.add('on');
  document.getElementById('mdl-ok').onclick=()=>{ m.obs=document.getElementById('mdl-obs').value; salvarEstado(); closeMdl(); renderPAG(); };
}
function removeManual(id){
  const idx = titulosManuais.findIndex(t=>t.id===id);
  if(idx>=0) titulosManuais.splice(idx,1);
  salvarEstado(); renderPAG();
}
function openInsertManual(){
  const mdl = document.getElementById('mdl-manual');
  if(mdl) mdl.classList.add('on');
  // Limpar campos
  ['man-tipo','man-fornecedor','man-saldo','man-acrescimo','man-decrescimo','man-vencimento'].forEach(id=>{
    const el=document.getElementById(id); if(el) el.value='';
  });
  const sel = document.getElementById('man-status'); if(sel) sel.value='Debitado';
  // Popular dropdown de Filial-Empresa
  const dd = document.getElementById('man-filial-empresa');
  if(dd){
    const empsMap = new Map();
    DATA.forEach(r=>{
      const filial = String(r.filial||'').trim();
      const empresa = String(r.empresa||'').trim();
      const key = filial+'|'+empresa;
      if(!empsMap.has(key)) empsMap.set(key, {filial, empresa, label: filial+' - '+empresa});
    });
    const opts = [...empsMap.values()].sort((a,b)=>a.label.localeCompare(b.label,'pt-BR'));
    dd.innerHTML = '<option value="">Selecione...</option>' + opts.map(o=>`<option value="${escHtml(o.filial)}|${escHtml(o.empresa)}">${escHtml(o.label)}</option>`).join('');
  }
  // Reset VTP
  const vtpEl = document.getElementById('man-vtp'); if(vtpEl) vtpEl.textContent = 'R$ 0,00';
}
function closeManualMdl(){ const mdl=document.getElementById('mdl-manual'); if(mdl) mdl.classList.remove('on'); }
function salvarManual(){
  const feVal = (document.getElementById('man-filial-empresa').value||'').trim();
  if(!feVal){ showToast('⚠️ Selecione uma Filial - Empresa','warn'); return; }
  const [filial, empresa] = feVal.split('|');
  const tipo = (document.getElementById('man-tipo').value||'').trim();
  const fornecedor = (document.getElementById('man-fornecedor').value||'').trim();
  const saldo = parseFloat(String(document.getElementById('man-saldo').value||'0').replace(',','.'))||0;
  const acrescimo = parseFloat(String(document.getElementById('man-acrescimo').value||'0').replace(',','.'))||0;
  const decrescimo = parseFloat(String(document.getElementById('man-decrescimo').value||'0').replace(',','.'))||0;
  const vencimento = document.getElementById('man-vencimento').value||'';
  const statusPag = document.getElementById('man-status').value||'Debitado';
  const id = _manualIdCounter--;
  titulosManuais.push({
    id, filial, empresa, tipo, num:'MANUAL', parcela:'', razao:empresa,
    fornecedor:fornecedor, emissao:today(), vencimento:vencimento||today(), vencReal:vencimento||today(),
    valor:saldo, saldo, status:'Manual', atraso:0, baixa:'', historico:'Inserido manualmente',
    valLiqBaix:0, numBordero:'', dtBordero:'', dtLiberacao:'', tipoPgto:'', cnpj:'', uuid:'',
    usrInc:'', usrAlt:'',
    acrescimo, decrescimo, statusPag,
    obs:'', dt:today()
  });
  salvarEstado(); closeManualMdl(); populateEmps('pag'); renderPAG();
  showToast('✅ Título manual inserido com sucesso','ok');
}

function calcManualVTP(){
  const s = parseFloat(String(document.getElementById('man-saldo').value||'0').replace(',','.'))||0;
  const a = parseFloat(String(document.getElementById('man-acrescimo').value||'0').replace(',','.'))||0;
  const d = parseFloat(String(document.getElementById('man-decrescimo').value||'0').replace(',','.'))||0;
  document.getElementById('man-vtp').textContent = fmtBR(calcValorTotalPago(s, a, d));
}

// Empresa pills populate
function populateEmps(kind){
  const src = kind==='pag'?pagamentos:monitored;
  const cont = document.getElementById(kind+'-emps');
  if(!cont) return;
  const empsMap = new Map();
  Object.entries(src).forEach(([pKey,val])=>{
    const id = kind==='pag' ? (val._origId!==undefined?val._origId:pagOrigId(pKey)) : +pKey;
    const r = DATA.find(x=>x.id===id);
    if(!r) return;
    const cpKey = companyPairFromRow(r);
    if(!cpKey || empsMap.has(cpKey)) return;
    const filial = String(r.filial||'').trim();
    const empresa = String(r.empresa||'').trim();
    empsMap.set(cpKey, { key:cpKey, filial, empresa, label: [empresa, filial].filter(Boolean).join(' - ') || cpKey });
  });
  // Incluir empresas de títulos manuais na aba pagamentos
  if(kind==='pag'){
    titulosManuais.forEach(m=>{
      const key = companyPairFromRow(m);
      if(!key || empsMap.has(key)) return;
      const filial = String(m.filial||'').trim();
      const empresa = String(m.empresa||'').trim();
      empsMap.set(key, { key, filial, empresa, label: [empresa, filial].filter(Boolean).join(' - ') || key });
    });
  }
  const emps=[...empsMap.values()].sort((a,b)=>{
    const ea = String(a.empresa).localeCompare(String(b.empresa), 'pt-BR');
    return ea || String(a.filial).localeCompare(String(b.filial), 'pt-BR');
  });
  cont.innerHTML = emps.map(e=>`<span class="pill" data-emp="${e.key}" onclick="togEmpX(this,'${kind}')">${escHtml(e.label)}</span>`).join('');
}
function togEmpX(el,kind){
  const s = kind==='pag'?selPag:selMon; const v=el.dataset.emp;
  if(s.emp.has(v)){s.emp.delete(v); el.classList.remove('on');} else {s.emp.add(v); el.classList.add('on');}
  kind==='pag'?renderPAG():renderMON();
}
function togStX(el,kind){
  const s = kind==='pag'?selPag:selMon; const v=el.dataset.st;
  if(s.st.has(v)){s.st.delete(v); el.classList.remove('on');} else {s.st.add(v); el.classList.add('on');}
  kind==='pag'?renderPAG():renderMON();
}

// Filtro compartilhado
function applyFilters(kind, entries){
  const gv=i=>{const el=document.getElementById(kind+'-'+i); return el?el.value:'';};
  const num=gv('num').toLowerCase(), rz=gv('razao').toLowerCase(), fn=gv('forn').toLowerCase(), tp=gv('tipo').toLowerCase();
  const vmin=parseFloat(gv('vmin'))||-Infinity, vmax=parseFloat(gv('vmax'))||Infinity;
  const d1=gv('d1'), d2=kind==='mon'?gv('d2'):'';
  const s = kind==='pag'?selPag:selMon;
  return entries.filter(e=>{
    const r=e.r;
    if(num && !r.num.toLowerCase().includes(num)) return false;
    if(rz && !r.razao.toLowerCase().includes(rz)) return false;
    if(fn && !r.fornecedor.toLowerCase().includes(fn)) return false;
    if(tp && !r.tipo.toLowerCase().includes(tp)) return false;
    if(r.valor<vmin||r.valor>vmax) return false;
    if(kind==='pag' && d1 && e.dt!==d1) return false;
    if(kind==='mon'){ if(d1 && r.vencimento<d1) return false; if(d2 && r.vencimento>d2) return false; }
    if(s.emp.size && !s.emp.has(companyPairFromRow(r))) return false;
    if(s.st.size && !s.st.has(r.status)) return false;
    if(!rowMatchesUserFilters(r, kind+'-')) return false;
    return true;
  });
}

function clearPAG(){ ['num','forn','vmin','vmax','d1','tipo','uuid','inc-name','inc1','inc2','alt-name','alt1','alt2'].forEach(i=>{const el=document.getElementById('pag-'+i);if(el)el.value='';}); const pr=document.getElementById('pag-razao');if(pr)pr.value=''; selPag.emp.clear(); selPag.st.clear(); document.querySelectorAll('#p-pag .pill.on').forEach(p=>p.classList.remove('on')); renderPAG(); }
function clearMON(){ ['num','forn','vmin','vmax','d1','d2','tipo','uuid','inc-name','inc1','inc2','alt-name','alt1','alt2'].forEach(i=>{const el=document.getElementById('mon-'+i);if(el)el.value='';}); const mr=document.getElementById('mon-razao');if(mr)mr.value=''; selMon.emp.clear(); selMon.st.clear(); document.querySelectorAll('#p-mon .pill.on').forEach(p=>p.classList.remove('on')); renderMON(); }
function clearNEW(){ ['uuid','inc-name','inc1','inc2','alt-name','alt1','alt2'].forEach(i=>{const el=document.getElementById('new-'+i);if(el)el.value='';}); renderNEW(); }

// Renderização
function renderPAG(){
  let entries = Object.entries(pagamentos).map(([key,p])=>{const oid=p._origId!==undefined?p._origId:pagOrigId(key);return{r:DATA.find(x=>x.id===oid),...p,_id:key,_origId:oid};}).filter(e=>e.r);
  // Incluir títulos manuais
  titulosManuais.forEach(m=>{ entries.push({r:m, ...m, _id:m.id}); });
  entries = applyFilters('pag', entries);
  // Stats
  const totSaldo = entries.reduce((s,e)=>s+(e.r.saldo||0),0);
  const totPago = entries.reduce((s,e)=>{
    const acr = e.acrescimo||e.r.acrescimo||0;
    const dec = e.decrescimo||e.r.decrescimo||0;
    return s + calcValorTotalPago(e.r.saldo||0, acr, dec);
  },0);
  const hj = entries.filter(e=>e.dt===today()).length;
  const dias = new Set(entries.map(e=>e.dt)).size;
  document.getElementById('pag-stats').innerHTML = `
    <div class="pag-stat"><div class="l">Títulos</div><div class="v">${entries.length}</div></div>
    <div class="pag-stat"><div class="l">Saldo Total</div><div class="v">${fmtBR(totSaldo)}</div></div>
    <div class="pag-stat"><div class="l">Total Pago</div><div class="v">${fmtBR(totPago)}</div></div>
    <div class="pag-stat"><div class="l">Dias com envios</div><div class="v">${dias}</div></div>
    <div class="pag-stat"><div class="l">Enviados hoje</div><div class="v">${hj}</div></div>`;
  const groups={}; entries.forEach(e=>{(groups[e.dt]=groups[e.dt]||[]).push(e);});
  const days = Object.keys(groups).sort().reverse();
  if(!days.length){ document.getElementById('pag-list').innerHTML='<div style="text-align:center;padding:40px;color:#64748b">Nenhum título enviado.</div>'; return; }
  document.getElementById('pag-list').innerHTML = days.map(dt=>{
    const arr=groups[dt];
    const tSaldo=arr.reduce((s,e)=>s+(e.r.saldo||0),0);
    const lbl = dt===today()?' · 📍 HOJE':'';
    return `<div class="pag-day"><h4><span>📅 ${fmtDt(dt)}${lbl}</span><span style="font-size:12px;color:#64748b;font-weight:500">${arr.length} título(s) · Saldo: ${fmtBR(tSaldo)}</span></h4>
      <div class="drag-scroll" style="overflow-x:auto;cursor:grab;user-select:none"><table><thead><tr>
        <th style="width:26px"><input type="checkbox" onchange="togAllPag(this,'${dt}')"></th>
        <th>FILIAL - EMPRESA</th><th>TIPO</th><th>Nº TÍTULO</th><th>PARCELA</th>
        <th>FORNECEDOR</th><th>NOME FORNECE</th>
        <th>VENCIMENTO</th><th>VENCTO REAL</th>
        <th class="num">VLR. TÍTULO</th><th class="num">SALDO</th>
        <th class="num" style="min-width:110px">ACRÉSCIMO</th><th class="num" style="min-width:110px">DECRÉSCIMO</th>
        <th class="num" style="background:#f0fdf4;color:#15803d;min-width:140px">VLR. TOTAL PAGO</th>
        <th style="min-width:100px">STATUS</th>
        <th>OBS</th><th></th></tr></thead>
      <tbody>${arr.map(e=>{
        const isManual = typeof e._id === 'number' && e._id < 0;
        const acr = e.acrescimo||e.r.acrescimo||0;
        const dec = e.decrescimo||e.r.decrescimo||0;
        const saldo = e.r.saldo||0;
        const vtp = calcValorTotalPago(saldo, acr, dec);
        const stPag = e.statusPag||e.r.statusPag||'';
        const stClass = stPag==='Debitado'?'background:#f0fdf4;color:#15803d':stPag==='Rejeitado'?'background:#fef2f2;color:#b91c1c':'';
        const safeId = escHtml(String(e._id));
        return `<tr${isManual?' style="background:#fffef0"':''}>
        <td><input type="checkbox" class="pag-cb" data-id="${safeId}"></td>
        <td class="filemp" style="white-space:nowrap;font-weight:600">${escHtml(e.r.filial)} - ${escHtml(e.r.empresa)}</td>
        <td>${escHtml(e.r.tipo)}</td><td>${escHtml(e.r.num||'—')}</td><td>${escHtml(e.r.parcela||'—')}</td>
        <td>${escHtml(e.r.fornecedor||'—')}</td>
        <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escHtml(e.r.razao)}">${escHtml(e.r.razao)}</td>
        <td>${fmtDt(e.r.vencimento)}</td><td>${fmtDt(e.r.vencReal)}</td>
        <td class="num" style="white-space:nowrap">${fmtBR(e.r.valor||saldo)}</td>
        <td class="num" style="white-space:nowrap;min-width:130px">${fmtBR(saldo)}</td>
        <td class="num"><input type="text" class="pag-acr-input" data-id="${safeId}" value="${acr?acr.toFixed(2).replace('.',','):''}" placeholder="0,00" oninput="updatePagAcrescimo('${safeId}',this.value)" style="width:90px;padding:4px 6px;border:1px solid #dde1ee;border-radius:5px;font-size:12px;text-align:right"></td>
        <td class="num"><input type="text" class="pag-dec-input" data-id="${safeId}" value="${dec?dec.toFixed(2).replace('.',','):''}" placeholder="0,00" oninput="updatePagDecrescimo('${safeId}',this.value)" style="width:90px;padding:4px 6px;border:1px solid #dde1ee;border-radius:5px;font-size:12px;text-align:right"></td>
        <td class="num pag-vtp" data-saldo="${saldo}" data-id="${safeId}" style="font-weight:700;white-space:nowrap;background:#f0fdf4;color:#15803d">${fmtBR(vtp)}</td>
        <td style="text-align:center">${stPag==='Debitado'?'<span class="status" style="background:#f0fdf4;color:#15803d;border:1px solid #86efac">✅ Debitado</span>':stPag==='Rejeitado'?'<span class="status" style="background:#fef2f2;color:#b91c1c;border:1px solid #fca5a5">❌ Rejeitado</span>':'<span style="color:#94a3b8;font-size:11px">—</span>'}</td>
        <td style="padding:6px 8px;min-width:200px"><div class="obs-box"><span class="obs-txt ${e.obs?'':'vazio'}">${e.obs||'Clique para adicionar...'}</span><button class="obs-edit-btn" onclick="${isManual?`editManualObs(${e._id})`:`editPagObs('${safeId}')`}" title="Editar observação">✏️</button></div></td>
        <td><button class="ab-mn" onclick="${isManual?`removeManual(${e._id})`:`removePag('${safeId}')`}">✕</button></td>
      </tr>`;
}).join('')}</tbody></table></div></div>`;
  }).join('');
  applyDrag('#p-pag');
  document.getElementById('b-pag').textContent = Object.keys(pagamentos).length + titulosManuais.length;
}

function buildDiff(snap,r){
  if(!snap) return '<span class="diff-badge diff-neutral">Sem snapshot</span>';
  const lines=[];
  if(snap.status!==r.status){const cls=r.status==='Baixado'?'diff-ok':r.status==='Vencido'?'diff-alert':'diff-warn'; lines.push(`<span class="diff-badge ${cls}">Status: ${snap.status} → ${r.status}</span>`);}
  else{lines.push(`<span class="diff-badge diff-neutral">Status: ${r.status}</span>`);}
  const sdiff=r.saldo-(snap.saldo||0);
  if(Math.abs(sdiff)>0.01){const cls=sdiff<0?'diff-ok':'diff-alert';const sign=sdiff>0?'+':''; lines.push(`<span class="diff-badge ${cls}">Saldo: ${sign}${fmtBR(sdiff)}</span>`);}
  const adiff=(r.atraso||0)-(snap.atraso||0);
  if(adiff!==0){const cls=adiff>0?'diff-alert':'diff-ok';const sign=adiff>0?'+':''; lines.push(`<span class="diff-badge ${cls}">Atraso: ${sign}${adiff}d</span>`);}
  if(snap.vencimento&&snap.vencimento!==r.vencimento){lines.push(`<span class="diff-badge diff-warn">Venc: ${fmtDt(snap.vencimento)} → ${fmtDt(r.vencimento)}</span>`);}
  if(lines.length<=1&&sdiff===0&&adiff===0){lines.push('<span class="diff-badge diff-ok">✓ Sem alterações</span>');}
  return lines.join(' &nbsp;');
}

function renderMON(){
  let entries=Object.entries(monitored).map(([id,m])=>({r:DATA.find(x=>x.id===+id),...m})).filter(e=>e.r);
  entries=applyFilters('mon',entries);
  const tot=entries.reduce((s,e)=>s+e.r.saldo,0);
  const venc=entries.filter(e=>e.r.status==='Vencido').length;
  const altered=entries.filter(e=>e.snap&&(e.snap.status!==e.r.status||Math.abs((e.r.saldo||0)-(e.snap.saldo||0))>0.01||(e.r.atraso||0)!==(e.snap.atraso||0))).length;
  document.getElementById('mon-stats').innerHTML=`
    <div class="pag-stat" style="border-left-color:#d97706"><div class="l">Títulos</div><div class="v" style="color:#d97706">${entries.length}</div></div>
    <div class="pag-stat" style="border-left-color:#d97706"><div class="l">Saldo Total</div><div class="v" style="color:#d97706">${fmtBR(tot)}</div></div>
    <div class="pag-stat" style="border-left-color:#b91c1c"><div class="l">Vencidos</div><div class="v" style="color:#b91c1c">${venc}</div></div>
    <div class="pag-stat" style="border-left-color:#7c3aed"><div class="l">Com alteração</div><div class="v" style="color:#7c3aed">${altered}</div></div>`;
  if(!entries.length){document.getElementById('mon-list').innerHTML='<div style="text-align:center;padding:40px;color:#64748b">Nenhum título monitorado.</div>'; return;}
  const head=`<tr>
    <th style="font-size:12px">FILIAL - EMPRESA</th>
    <th style="font-size:12px">TIPO</th>
    <th style="font-size:12px">Nº TÍTULO</th>
    <th style="font-size:12px">PARC.</th>
    <th style="font-size:12px">FORNECEDOR</th>
    <th style="font-size:12px">UUID</th>
    <th style="font-size:12px">EMISSÃO</th>
    <th style="font-size:12px">VENC. REAL</th>
    <th style="font-size:12px;padding:10px 4px" class="num">VALOR</th>
    <th style="font-size:12px;padding:10px 4px" class="num">SALDO</th>
    <th style="font-size:12px">STATUS</th>
    <th style="font-size:12px;background:#fef2f2;color:#991b1b">ATRASO</th>
    <th style="font-size:12px">DT. BAIXA</th>
    <th style="font-size:12px;background:#f3e8ff;color:#7c3aed;min-width:260px">📊 COMPARAÇÃO</th>
    <th style="font-size:12px">OBSERVAÇÃO</th>
    <th style="font-size:12px">DT. MONIT.</th>
    <th style="font-size:12px">NOME INC</th>
    <th style="font-size:12px">DATA INC</th>
    <th style="font-size:12px">NOME ALT</th>
    <th style="font-size:12px">DATA ALT</th>
    <th style="font-size:12px"></th></tr>`; 
  const body=entries.map(e=>{const r=e.r;
    const hasChange=e.snap&&(e.snap.status!==r.status||Math.abs((r.saldo||0)-(e.snap.saldo||0))>0.01||(r.atraso||0)!==(e.snap.atraso||0));
    const i=splitUserDate(r.usrInc), alt=splitUserDate(r.usrAlt);
    return `<tr style="${hasChange?'background:#fffef0':''}">
    <td style="white-space:nowrap;font-size:13px;font-weight:600;color:#1e2340">${r.filial} - ${r.empresa}</td>
    <td style="white-space:nowrap;font-size:13px">${r.tipo}</td>
    <td style="white-space:nowrap;font-size:13px">${r.num}</td>
    <td style="white-space:nowrap;font-size:13px">${r.parcela||'—'}</td>
    <td style="white-space:nowrap;font-size:13px;color:#475569" title="${r.razao} | ${r.fornecedor}">${r.fornecedor}</td>
    <td style="text-align:center;white-space:nowrap;font-size:13px">${r.uuid?`<button type="button" class="uuid-copy-btn" data-uuid="${escHtml(r.uuid)}" onclick="copyUUID(this)" title="Copiar UUID">📋</button>`:'—'}</td>
    <td style="white-space:nowrap;font-size:13px">${fmtDt(r.emissao)}</td>
    <td style="white-space:nowrap;font-size:13px">${fmtDt(r.vencReal)}</td>
    <td class="num" style="white-space:nowrap;font-size:13px;min-width:90px;padding:9px 4px">${fmtBR(r.valor)}</td>
    <td class="num" style="white-space:nowrap;font-size:13px;min-width:90px;padding:9px 4px">${fmtBR(r.saldo)}</td>
    <td style="white-space:nowrap;font-size:13px"><span class="status ${stCls(r.status)}">${r.status}</span></td>
    <td style="white-space:nowrap;font-size:13px;text-align:center"><span class="${atrCls(r.atraso)}">${r.atraso||'—'}</span></td>
    <td style="white-space:nowrap;font-size:13px">${fmtDt(r.baixa)}</td>
    <td style="background:#faf5ff;white-space:nowrap;vertical-align:middle;padding:6px 10px">${buildDiff(e.snap,r)}</td>
    <td style="padding:6px 8px;min-width:210px"><div class="obs-box"><span class="obs-txt ${e.obs?'':'vazio'}">${e.obs||'Clique para adicionar...'}</span><button class="obs-edit-btn" onclick="editMonObs(${r.id})" title="Editar observação">✏️</button></div></td>
    <td style="white-space:nowrap;font-size:13px">${fmtDt(e.ts)}</td>
    <td style="white-space:nowrap;font-size:13px">${escHtml(i.name)}</td>
    <td style="white-space:nowrap;font-size:13px">${i.date||'—'}</td>
    <td style="white-space:nowrap;font-size:13px">${escHtml(alt.name)}</td>
    <td style="white-space:nowrap;font-size:13px">${alt.date||'—'}</td>
    <td style="white-space:nowrap"><button class="ab-mn" onclick="removeMon(${r.id})">✕</button></td></tr>`;}).join('');
  document.getElementById('mon-list').innerHTML=`<div class="drag-scroll" style="overflow-x:auto;cursor:grab;user-select:none"><table style="font-size:13px"><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
  applyDrag('#p-mon');
}


function applyDrag(sel){
  document.querySelectorAll(sel+' .drag-scroll').forEach(el=>{
    if(el.dataset.drag) return; el.dataset.drag='1';
    let d=false,sx=0,sl=0;
    el.addEventListener('mousedown',ev=>{if(ev.target.tagName==='BUTTON'||ev.target.tagName==='INPUT'||ev.target.tagName==='SELECT'||ev.target.tagName==='OPTION')return; d=true;sx=ev.pageX-el.offsetLeft;sl=el.scrollLeft;el.style.cursor='grabbing';ev.preventDefault();});
    el.addEventListener('mouseleave',()=>{d=false;el.style.cursor='grab';});
    el.addEventListener('mouseup',()=>{d=false;el.style.cursor='grab';});
    el.addEventListener('mousemove',ev=>{if(!d)return;el.scrollLeft=sl-(ev.pageX-el.offsetLeft-sx);});
  });
}

function downloadPAG(){
  let entries = Object.entries(pagamentos).map(([key,p])=>{const oid=p._origId!==undefined?p._origId:pagOrigId(key);return{r:DATA.find(x=>x.id===oid),...p,_id:key,_origId:oid};}).filter(e=>e.r);
  titulosManuais.forEach(m=>{ entries.push({r:m, ...m, _id:m.id}); });
  entries = applyFilters('pag', entries);
  if(!entries.length){alert('Nada para baixar'); return;}
  const head='DataEnvio;Filial-Empresa;Tipo;Num;Parcela;Fornecedor;NomeFornece;Vencimento;VenctoReal;VlrTitulo;Saldo;Acrescimo;Decrescimo;ValorTotalPago;Status;Observacao';
  const body=entries.map(e=>{
    const acr=e.acrescimo||e.r.acrescimo||0;
    const dec=e.decrescimo||e.r.decrescimo||0;
    const saldo=e.r.saldo||0;
    const vtp=calcValorTotalPago(saldo,acr,dec);
    const st=e.statusPag||e.r.statusPag||'';
    return [e.dt,e.r.filial+' - '+e.r.empresa,e.r.tipo,e.r.num,e.r.parcela,e.r.fornecedor,e.r.razao,e.r.vencimento,e.r.vencReal,e.r.valor||saldo,saldo,acr,dec,vtp,st,(e.obs||'').replace(/;/g,',')].join(';');
  }).join('\n');
  const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob(['\ufeff'+head+'\n'+body],{type:'text/csv;charset=utf-8'})); a.download='pagamentos.csv'; a.click();
}
function downloadMON(){
  let entries = Object.entries(monitored).map(([id,m])=>({r:DATA.find(x=>x.id===+id),...m})).filter(e=>e.r);
  entries = applyFilters('mon', entries);
  if(!entries.length){alert('Nada para baixar'); return;}
  const head='Filial-Empresa;Tipo;Num;Razao;Fornecedor;Vencimento;Valor;Saldo;Status;Atraso;Observacao;DtMonit';
  const body=entries.map(e=>[e.r.filial+' - '+e.r.empresa,e.r.tipo,e.r.num,e.r.razao,e.r.fornecedor,e.r.vencimento,e.r.valor,e.r.saldo,e.r.status,e.r.atraso,(e.obs||'').replace(/;/g,','),e.ts].join(';')).join('\n');
  const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob(['\ufeff'+head+'\n'+body],{type:'text/csv;charset=utf-8'})); a.download='monitoramento.csv'; a.click();
}

// Ordenação por clique no cabeçalho
const SORT_MAP = ['','empresa','tipo','num','parcela','razao','fornecedor','emissao','vencimento','vencReal','valor','saldo','status','atraso','baixa','historico','valLiqBaix','numBordero','dtBordero','dtLiberacao','tipoPgto','cnpj','uuid','usrIncName','usrIncDate','usrAltName','usrAltDate',''];
let sortKey=null, sortAsc=true;
const PAGE_SIZE = 300;
let currentPage = 1;
function setupSort(){
  document.querySelectorAll('#p-all thead th').forEach((th,i)=>{
    const k = SORT_MAP[i]; if(!k) return;
    th.style.cursor='pointer'; th.title='Clique para ordenar';
    th.onclick=()=>{
      if(sortKey===k) sortAsc=!sortAsc; else { sortKey=k; sortAsc=true; }
      document.querySelectorAll('#p-all thead th .sort-ind').forEach(e=>e.remove());
      const ind=document.createElement('span'); ind.className='sort-ind'; ind.textContent=sortAsc?' ▲':' ▼'; ind.style.color='#2563eb'; th.appendChild(ind);
      render();
    };
  });
}

function sortData(rows){
  if(!sortKey) return rows;
  return [...rows].sort((a,b)=>{
    let va, vb;
    if(sortKey==='usrIncName'){ va=splitUserDate(a.usrInc).name; vb=splitUserDate(b.usrInc).name; }
    else if(sortKey==='usrIncDate'){ va=brDateToISO(splitUserDate(a.usrInc).date); vb=brDateToISO(splitUserDate(b.usrInc).date); }
    else if(sortKey==='usrAltName'){ va=splitUserDate(a.usrAlt).name; vb=splitUserDate(b.usrAlt).name; }
    else if(sortKey==='usrAltDate'){ va=brDateToISO(splitUserDate(a.usrAlt).date); vb=brDateToISO(splitUserDate(b.usrAlt).date); }
    else { va=a[sortKey]; vb=b[sortKey]; }
    if(va===undefined||va===null) va=''; if(vb===undefined||vb===null) vb='';
    if(typeof va==='number'&&typeof vb==='number') return sortAsc?va-vb:vb-va;
    return sortAsc?String(va).localeCompare(String(vb)):String(vb).localeCompare(String(va));
  });
}

// Inicialização
document.addEventListener('DOMContentLoaded', function(){
  applyBootMeta();
  restaurarEstado();
  populateFilialFilter();
  populateEmps('pag');
  populateEmps('mon');
  render();
  setupSort();
  renderNEW();
});

function render(resetPage=false){
  if(resetPage) currentPage = 1;
  const d=sortData(filtered());
  const totalPages = Math.max(1, Math.ceil(d.length / PAGE_SIZE));
  if(currentPage > totalPages) currentPage = totalPages;
  if(currentPage < 1) currentPage = 1;
  const start = (currentPage - 1) * PAGE_SIZE;
  const pageRows = d.slice(start, start + PAGE_SIZE);
  document.getElementById('tb').innerHTML = pageRows.map(r=>`
    <tr>
      <td><input type="checkbox" class="rcb" data-id="${r.id}"></td>
      <td class="filemp" style="white-space:nowrap">${r.filial} - ${r.empresa}</td>
      <td>${r.tipo}</td><td>${r.num}</td><td>${r.parcela||'—'}</td>
      <td title="${r.razao}" style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.razao}</td>
      <td title="${r.fornecedor}" style="max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#64748b;font-size:11px">${r.fornecedor}</td>
      <td>${fmtDt(r.emissao)}</td><td>${fmtDt(r.vencimento)}</td><td>${fmtDt(r.vencReal)}</td>
      <td class="num" style="white-space:nowrap">${fmtBR(r.valor)}</td><td class="num" style="white-space:nowrap;min-width:130px">${fmtBR(r.saldo)}</td>
      <td><span class="status ${stCls(r.status)}">${r.status}</span></td>
      <td class="atraso"><span class="${atrCls(r.atraso)}">${r.atraso||'—'}</span></td>
      <td>${fmtDt(r.baixa)}</td>
      <td style="max-width:220px;font-size:11px;color:#64748b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${r.historico}">${r.historico}</td>
      <td class="num">${fmtBR(r.valLiqBaix)}</td>
      <td>${r.numBordero||'—'}</td><td>${fmtDt(r.dtBordero)}</td>
      <td>${fmtDt(r.dtLiberacao)}</td><td>${r.tipoPgto||'—'}</td>
      <td style="font-family:monospace;font-size:11px">${r.cnpj||'—'}</td>
      <td style="text-align:center">${r.uuid?`<button type="button" class="uuid-copy-btn" data-uuid="${escHtml(r.uuid)}" onclick="copyUUID(this)" title="Copiar UUID">📋 Copiar</button>`:'—'}</td>
      <td style="font-size:11px;color:#334155" title="${escHtml(r.usrInc||'')}">${escHtml(splitUserDate(r.usrInc).name)}</td>
      <td style="font-size:11px;color:#64748b">${splitUserDate(r.usrInc).date||'—'}</td>
      <td style="font-size:11px;color:#334155" title="${escHtml(r.usrAlt||'')}">${escHtml(splitUserDate(r.usrAlt).name)}</td>
      <td style="font-size:11px;color:#64748b">${splitUserDate(r.usrAlt).date||'—'}</td>
      <td><div style="display:flex;gap:4px"><button class="ab-pg" onclick="sendPag(${r.id})" title="Enviar para pagamento">💰</button><button class="ab-mn" onclick="openMonitor(${r.id})" title="Monitorar">📌</button></div></td>
    </tr>`).join('');
  document.getElementById('cnt').textContent = `${d.length} de ${DATA.length} títulos`;
  document.getElementById('b-all').textContent = DATA.length;
  document.getElementById('pager').innerHTML = `
    <span class="pg-info">Página ${currentPage}/${totalPages} · exibindo ${pageRows.length} de ${d.length}</span>
    <button class="pg-btn" ${currentPage<=1?'disabled':''} onclick="setPage(1)">« Primeira</button>
    <button class="pg-btn" ${currentPage<=1?'disabled':''} onclick="setPage(${currentPage-1})">‹ Anterior</button>
    <button class="pg-btn" ${currentPage>=totalPages?'disabled':''} onclick="setPage(${currentPage+1})">Próxima ›</button>
    <button class="pg-btn" ${currentPage>=totalPages?'disabled':''} onclick="setPage(${totalPages})">Última »</button>
  `;
  renderAlertsTop();
}

function setPage(p){
  currentPage = p;
  render(false);
}

function renderStatusComparativo(monEntries){
  const wrap = document.getElementById('comparacao-status');
  const tbody = document.getElementById('status-comparativo-body');
  if(!wrap || !tbody) return;
  const statusList = ["Vencido", "A Vencer", "Baixado", "Baixa Parcial"];
  tbody.innerHTML = statusList.map(status=>{
    const qtdTodos = DATA.filter(t=>t.status===status).length;
    const qtdMonitoramento = monEntries.filter(e=>e.r && e.r.status===status).length;
    return `<tr><td>${status}</td><td class="num">${qtdTodos}</td><td class="num">${qtdMonitoramento}</td></tr>`;
  }).join('');
  wrap.style.display = '';
}




function getAberr(){ return DATA.filter(r=>{ if(!r.vencimento) return false; const y=+r.vencimento.slice(0,4); return y>2030; }); }
function getAberrCrit(){ return DATA.filter(r=>{ if(!r.vencimento) return false; const y=+r.vencimento.slice(0,4); return y>3000; }); }


function analisarAberracao(){
  filterAberracao = true;
  sel.emp.clear(); sel.st.clear();
  document.querySelectorAll('#p-all .pill.on').forEach(p=>p.classList.remove('on'));
  tab('all');
  render(true);
  showToast(`🔍 Filtrando títulos com aberração de data (vencimento após 2030)`, 'warn', 4000);
}

function renderAlertsTop(){
  const parc = DATA.filter(r=>r.status==='Baixa Parcial');
  const c180 = DATA.filter(r=>r.atraso>180);
  const fmtLst = a => a.slice(0,3).map(r=>`${r.razao.slice(0,35)}: ${fmtBR(r.saldo)} — ${r.atraso}d`).join(' | ');
  const sum = a => a.reduce((s,r)=>s+r.saldo,0);
  let html = '';
  if(c180.length) html += `<div class="alert"><div><div class="at">⚠ ${c180.length} título(s) SE2 vencidos há +180 dias</div><div class="ad">${fmtLst(c180)}<br><b>Total: ${fmtBR(sum(c180))}</b></div></div><div class="av" onclick="goStatus('Vencido')">→ ver títulos</div></div>`;
  const aberr = getAberr(); if(aberr.length) html += `<div class="alert" style="border-left-color:#7c3aed"><div><div class="at">🚨 ${aberr.length} título(s) com ABERRAÇÃO DE DATA (vencimento após 2030)</div><div class="ad">${aberr.slice(0,3).map(r=>`${r.razao.slice(0,35)}: venc. ${fmtDt(r.vencimento)} — ${fmtBR(r.saldo)}`).join(' | ')}</div></div><div class="av" onclick="analisarAberracao()">→ analisar títulos</div></div>`;
  if(parc.length) html += `<div class="alert info"><div><div class="at">ℹ ${parc.length} título(s) com Baixa Parcial</div><div class="ad">${parc.slice(0,3).map(r=>`${r.razao.slice(0,35)}: ${fmtBR(r.saldo)} — ${r.atraso}d`).join(' | ')}<br><b>Saldo em aberto: ${fmtBR(sum(parc))}</b></div></div><div class="av" onclick="goStatus('Baixa Parcial')">→ ver títulos</div></div>`;
  document.getElementById('alerts-top').innerHTML = html;
}

function goStatus(s){ tab('all'); sel.st.clear(); sel.st.add(s); document.querySelectorAll('[data-st]').forEach(p=>p.classList.toggle('on',p.dataset.st===s)); render(true); }
function tab(t){ if(t==='pag') setTimeout(renderPAG,0); if(t==='mon') setTimeout(renderMON,0); if(t==='new') setTimeout(renderNEW,0); document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x.dataset.tab===t)); document.querySelectorAll('.panel').forEach(x=>x.classList.remove('active')); document.getElementById('p-'+t).classList.add('active'); }
function togAll(cb){ document.querySelectorAll('.rcb').forEach(c=>c.checked=cb.checked); }

function download(){
  const checked=[...document.querySelectorAll('.rcb:checked')].map(c=>+c.dataset.id);
  const rows = checked.length?DATA.filter(r=>checked.includes(r.id)):filtered();
  if(!rows.length){ alert('Nada para baixar'); return; }
  const cols=['empresa','filial','tipo','num','parcela','razao','fornecedor','emissao','vencimento','vencReal','valor','saldo','status','atraso','baixa','historico','valLiqBaix','numBordero','dtBordero','dtLiberacao','tipoPgto','cnpj','uuid','usrInc','usrAlt'];
  const csv='\ufeff'+cols.join(';')+'\n'+rows.map(r=>cols.map(c=>{let v=r[c]??'';v=String(v).replace(/"/g,'""');return /[;"\n]/.test(v)?`"${v}"`:v;}).join(';')).join('\n');
  const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'})); a.download='SE2_parcial.csv'; a.click();
}


// ========= MONITORAMENTO & PAGAMENTO =========
// today() já definida acima

// Drag horizontal scroll
(function(){
  document.querySelectorAll('.drag-scroll').forEach(el=>{
    let down=false,sx=0,sl=0;
    el.addEventListener('mousedown',e=>{if(e.target.tagName==='INPUT'||e.target.tagName==='BUTTON'||e.target.tagName==='SELECT'||e.target.tagName==='OPTION')return; down=true; sx=e.pageX-el.offsetLeft; sl=el.scrollLeft; el.style.cursor='grabbing'; e.preventDefault();});
    el.addEventListener('mouseleave',()=>{down=false; el.style.cursor='grab';});
    el.addEventListener('mouseup',()=>{down=false; el.style.cursor='grab';});
    el.addEventListener('mousemove',e=>{if(!down)return; el.scrollLeft=sl-(e.pageX-el.offsetLeft-sx);});
  });
})();


// ========= NOVOS TÍTULOS =========
// Estratégia:
//   1) Se backup.js trouxer "uuids_vistos" (lista da última base publicada),
//      novos = qualquer título cujo UUID NÃO está nessa lista. Este é o caso
//      ideal — compara contra a base anterior, como pediu o usuário.
//   2) Fallback: usa localStorage (comportamento antigo).
//   3) Último recurso: marca como novos os títulos cuja data em usrInc é hoje.
function computeNewTitles(){
  const todayStr = today();
  // 1) Diff contra a base anterior via backup.js
  if(UUIDS_BASE_ANTERIOR && UUIDS_BASE_ANTERIOR.size){
    return DATA.filter(r => {
      const u = String(r.uuid||'').toUpperCase();
      return u && !UUIDS_BASE_ANTERIOR.has(u);
    });
  }
  // 2) Fallback histórico (localStorage) + atualização do registro
  const STORE_IDS = 'se2_seen_ids';
  const STORE_DATE = 'se2_seen_date';
  let newTitles = [];
  try {
    const seenDate = localStorage.getItem(STORE_DATE);
    const seenIdsStr = localStorage.getItem(STORE_IDS);
    const currentIds = DATA.map(r=>r.id);
    if(!seenIdsStr || !seenDate){
      newTitles = DATA.filter(r=>{
        const m = String(r.usrInc||'').match(/(\d{2})\/(\d{2})\/(\d{4})/);
        if(!m) return false;
        const d = `${m[3]}-${m[2]}-${m[1]}`;
        return d >= todayStr;
      });
    } else if(seenDate !== todayStr) {
      const seenIds = JSON.parse(seenIdsStr);
      newTitles = DATA.filter(r=>!seenIds.includes(r.id));
      if(!newTitles.length){
        newTitles = DATA.filter(r=>{
          const m = String(r.usrInc||'').match(/(\d{2})\/(\d{2})\/(\d{4})/);
          if(!m) return false;
          const d = `${m[3]}-${m[2]}-${m[1]}`;
          return d >= todayStr;
        });
      }
    } else {
      const seenIds = JSON.parse(seenIdsStr);
      newTitles = DATA.filter(r=>!seenIds.includes(r.id));
    }
    localStorage.setItem(STORE_IDS, JSON.stringify(currentIds));
    localStorage.setItem(STORE_DATE, todayStr);
  } catch(e){
    // 3) Último recurso
    newTitles = DATA.filter(r=>{
      const m = String(r.usrInc||'').match(/(\d{2})\/(\d{2})\/(\d{4})/);
      if(!m) return false;
      const d = `${m[3]}-${m[2]}-${m[1]}`;
      return d >= todayStr;
    });
  }
  return newTitles;
}

function resetNewSeen(){
  try{ localStorage.removeItem('se2_seen_ids'); localStorage.removeItem('se2_seen_date'); }catch(e){}
  renderNEW();
}

function renderNEW(){
  const raw = computeNewTitles();
  const rows = raw.filter(r=>rowMatchesUserFilters(r,'new-'));
  document.getElementById('b-new').textContent = raw.length;
  const tot = rows.reduce((s,r)=>s+r.saldo,0);
  // Indicador da base de referência (do backup.js)
  const refEl = document.getElementById('new-ref-info');
  if(refEl){
    const modoBackup = UUIDS_BASE_ANTERIOR && UUIDS_BASE_ANTERIOR.size;
    if(modoBackup){
      let dt = '';
      try{
        if(BACKUP.exportadoEm){
          const d = new Date(BACKUP.exportadoEm);
          dt = isNaN(d.getTime()) ? String(BACKUP.exportadoEm) : d.toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
        }
      }catch(_){ dt = String(BACKUP.exportadoEm||''); }
      refEl.textContent = `Base anterior (backup): ${UUIDS_BASE_ANTERIOR.size} UUIDs${dt?` · ${dt}`:''}`;
    } else {
      refEl.textContent = 'Sem backup.js · usando fallback local (localStorage)';
    }
  }
  document.getElementById('new-stats').innerHTML = rows.length
    ? `<div class="pag-stat" style="border-left-color:#7c3aed"><div class="l">Exibindo (filtros)</div><div class="v" style="color:#7c3aed">${rows.length} / ${raw.length}</div></div>
       <div class="pag-stat" style="border-left-color:#7c3aed"><div class="l">Saldo Total (filtrado)</div><div class="v" style="color:#7c3aed">${fmtBR(tot)}</div></div>`
    : (raw.length ? `<div class="pag-stat" style="border-left-color:#7c3aed"><div class="l">Novos (total)</div><div class="v" style="color:#7c3aed">${raw.length}</div></div><div class="pag-stat"><div class="l">Após filtros</div><div class="v">0</div></div>` : '');
  if(!raw.length){
    document.getElementById('new-list').innerHTML='<div style="text-align:center;padding:40px;color:#64748b">Nenhum titulo novo identificado em relacao a sessao anterior.</div>';
    return;
  }
  if(!rows.length){
    document.getElementById('new-list').innerHTML='<div style="text-align:center;padding:40px;color:#64748b">Nenhum titulo corresponde aos filtros atuais. Ajuste UUID / usuarios ou limpe os filtros.</div>';
    return;
  }
  const head='<tr><th>FILIAL - EMPRESA</th><th>TIPO</th><th>N TITULO</th><th>PARC.</th><th>RAZAO SOCIAL</th><th>FORNECEDOR</th><th>EMISSAO</th><th>VENCIMENTO</th><th>VENC. REAL</th><th class="num">VALOR</th><th class="num">SALDO</th><th>STATUS</th><th style="background:#fef2f2;color:#991b1b">ATRASO</th><th>HISTORICO</th><th>UUID</th><th>NOME INC</th><th>DATA INC</th><th>NOME ALT</th><th>DATA ALT</th><th>ACOES</th></tr>';
  const body=rows.map(r=>{
    const i=splitUserDate(r.usrInc), alt=splitUserDate(r.usrAlt);
    return '<tr style="background:#faf5ff"><td class="filemp" style="white-space:nowrap">'+escHtml(r.filial)+' - '+escHtml(r.empresa)+'</td><td>'+escHtml(r.tipo)+'</td><td>'+escHtml(r.num)+'</td><td>'+escHtml(r.parcela||'\u2014')+'</td><td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="'+escHtml(r.razao)+'">'+escHtml(r.razao)+'</td><td style="max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#64748b;font-size:11px">'+escHtml(r.fornecedor)+'</td><td>'+fmtDt(r.emissao)+'</td><td>'+fmtDt(r.vencimento)+'</td><td>'+fmtDt(r.vencReal)+'</td><td class="num" style="white-space:nowrap">'+fmtBR(r.valor)+'</td><td class="num" style="white-space:nowrap">'+fmtBR(r.saldo)+'</td><td><span class="status '+stCls(r.status)+'">'+r.status+'</span></td><td class="atraso"><span class="'+atrCls(r.atraso)+'">'+(r.atraso||'\u2014')+'</span></td><td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;color:#64748b" title="'+escHtml(r.historico)+'">'+escHtml(r.historico)+'</td><td style="text-align:center;white-space:nowrap;font-size:13px">'+(r.uuid?'<button type="button" class="uuid-copy-btn" data-uuid="'+escHtml(r.uuid)+'" onclick="copyUUID(this)" title="Copiar UUID">📋</button>':'\u2014')+'</td><td style="font-size:11px;color:#334155">'+escHtml(i.name)+'</td><td style="font-size:11px;color:#64748b;background:#ede9fe">'+(i.date||'\u2014')+'</td><td style="font-size:11px;color:#334155">'+escHtml(alt.name)+'</td><td style="font-size:11px;color:#64748b">'+(alt.date||'\u2014')+'</td><td><div style="display:flex;gap:4px"><button class="ab-pg" onclick="sendPag('+r.id+')" title="Enviar para pagamento">💰</button><button class="ab-mn" onclick="openMonitor('+r.id+')" title="Monitorar">📌</button></div></td></tr>';
  }).join('');
  document.getElementById('new-list').innerHTML='<div class="drag-scroll" style="overflow-x:auto;cursor:grab;user-select:none"><table><thead>'+head+'</thead><tbody>'+body+'</tbody></table></div>';
  applyDrag('#p-new');
}

