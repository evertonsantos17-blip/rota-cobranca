// ============================================
// app.js — Rota Cobrança (versão 100% gratuita)
// Mapa: Leaflet + OpenStreetMap
// Endereços: Nominatim (OpenStreetMap)
// Rotas: OSRM (gratuito)
// Feriados: BrasilAPI (gratuito)
// Banco: Firebase Firestore
// ============================================

import { auth, db } from './firebase-config.js';
import {
  signInWithEmailAndPassword, signOut, onAuthStateChanged, createUserWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
  collection, doc, setDoc, getDoc, getDocs, addDoc,
  updateDoc, query, where, orderBy, onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// ============================================
// APIs GRATUITAS
// ============================================
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org';
const OSRM_URL = 'https://router.project-osrm.org/route/v1/driving';
const OSRM_URL2 = 'https://routing.openstreetmap.de/routed-car/route/v1/driving';
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

// ============================================
// ESTADO GLOBAL
// ============================================
let currentUser = null;
let currentUserData = null;
let currentRoute = null;
let currentStop = null;
let currentStopIndex = null;
let pendingStops = [];
let holidayAnalysis = null;
let allRoutes = [];
let allUsers = [];

// Leaflet maps
let mapRota = null;
let mapGerencial = null;
let mapMini = null;
let routeLayer = null;
let routeMarkers = [];
let gerencialMarkers = {};

// Nominatim throttle
let nominatimTimeout = null;
let lastNominatimCall = 0;

const screenStack = [];
const screenTitles = {
  'screen-dashboard': 'Minhas Rotas',
  'screen-criar-rota': 'Nova Rota',
  'screen-detalhe-rota': 'Detalhe da Rota',
  'screen-detalhe-stop': 'Endereço',
  'screen-gerencial': 'Dashboard Gerencial',
  'screen-usuarios': 'Usuários',
};

// ============================================
// INIT
// ============================================
onAuthStateChanged(auth, async (user) => {
  hideSplash();
  if (user) {
    currentUser = user;
    await loadUserData(user.uid);
    startApp();
  } else {
    showLoginScreen();
  }
});

function formatDateBR(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('pt-BR');
}

function hideSplash() {
  setTimeout(() => {
    const s = document.getElementById('splash-screen');
    if (!s) return;
    s.style.opacity = '0';
    s.style.transition = 'opacity 0.4s';
    setTimeout(() => s.classList.add('hidden'), 400);
  }, 1800);
}

// ============================================
// AUTH
// ============================================
window.handleLogin = async function () {
  const email = document.getElementById('login-email').value.trim();
  const pass  = document.getElementById('login-password').value;
  const errEl = document.getElementById('login-error');
  errEl.classList.add('hidden');
  if (!email || !pass) { showErr(errEl, 'Preencha e-mail e senha.'); return; }
  try {
    await signInWithEmailAndPassword(auth, email, pass);
  } catch (e) {
    const msgs = {
      'auth/invalid-credential': 'E-mail ou senha incorretos.',
      'auth/user-not-found': 'Usuário não encontrado.',
      'auth/wrong-password': 'Senha incorreta.',
      'auth/too-many-requests': 'Muitas tentativas. Aguarde.',
    };
    showErr(errEl, msgs[e.code] || 'Erro ao entrar.');
  }
};

window.handleLogout = async function () {
  await signOut(auth);
  currentUser = null; currentUserData = null;
  pendingStops = []; allRoutes = [];
  destroyMaps();
  document.getElementById('app').classList.add('hidden');
  showLoginScreen();
};

window.togglePassword = function () {
  const i = document.getElementById('login-password');
  i.type = i.type === 'password' ? 'text' : 'password';
};

window.handleFaceID = function () {
  showToast('Face ID disponível em dispositivos compatíveis.', 'info');
};

function showErr(el, msg) { el.textContent = msg; el.classList.remove('hidden'); }

function showLoginScreen() {
  document.getElementById('screen-login').classList.remove('hidden');
  document.getElementById('app').classList.add('hidden');
}

// ============================================
// USER DATA
// ============================================
async function loadUserData(uid) {
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    if (snap.exists()) {
      currentUserData = { id: uid, ...snap.data() };
    } else {
      currentUserData = {
        id: uid, nome: currentUser.email.split('@')[0],
        email: currentUser.email, tipoUsuario: 'cobrador',
        ativo: true, criadoEm: serverTimestamp()
      };
      await setDoc(doc(db, 'users', uid), currentUserData);
    }
  } catch (e) { console.error(e); }
}

// ============================================
// START APP
// ============================================
function startApp() {
  document.getElementById('screen-login').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  const av = document.getElementById('topbar-avatar');
  av.textContent = (currentUserData?.nome || 'U')[0].toUpperCase();
  const isGer = currentUserData?.tipoUsuario === 'gerencial';
  document.getElementById('bottomnav-cobrador').classList.toggle('hidden', isGer);
  document.getElementById('bottomnav-gerencial').classList.toggle('hidden', !isGer);
  if (isGer) { showScreen('screen-gerencial'); loadGerencialDashboard(); }
  else        { showScreen('screen-dashboard'); loadDashboard(); }
}

// ============================================
// NAVIGATION
// ============================================
window.showScreen = function (id) {
  document.querySelectorAll('.screen-inner').forEach(s => s.classList.add('hidden'));
  const t = document.getElementById(id);
  if (t) t.classList.remove('hidden');
  document.getElementById('topbar-title').textContent = screenTitles[id] || '';
  const main = ['screen-dashboard','screen-gerencial'];
  document.getElementById('btn-back').classList.toggle('hidden', main.includes(id));
  if (!screenStack.length || screenStack[screenStack.length-1] !== id) screenStack.push(id);
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.screen === id));
  // Inicializa mapas quando a tela aparecer
  if (id === 'screen-detalhe-rota') setTimeout(initMapRota, 100);
  if (id === 'screen-gerencial')    setTimeout(initMapGerencial, 100);
};

window.goBack = function () {
  if (screenStack.length > 1) {
    screenStack.pop();
    const prev = screenStack.pop();
    showScreen(prev);
  }
};

window.navTo = function (id, btn) {
  if (id === 'screen-criar-rota') resetCriarRota();
  if (id === 'screen-dashboard')  loadDashboard();
  if (id === 'screen-gerencial')  loadGerencialDashboard();
  showScreen(id);
};

// ============================================
// DASHBOARD COBRADOR
// ============================================
async function loadDashboard() {
  const h = new Date().getHours();
  const g = h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';

  document.getElementById('hero-greeting').textContent =
    `${g}, ${(currentUserData?.nome || '').split(' ')[0]}!`;

  document.getElementById('hero-date').textContent =
    new Date().toLocaleDateString('pt-BR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long'
    });

  const q = query(
    collection(db, 'routes'),
    where('cobradorId', '==', currentUser.uid)
  );

  onSnapshot(q, snap => {
    allRoutes = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => {
        const da = a.criadoEm?.toDate ? a.criadoEm.toDate() : new Date(0);
        const dbb = b.criadoEm?.toDate ? b.criadoEm.toDate() : new Date(0);
        return dbb - da;
      });

    renderDashboardRoutes(allRoutes);
  }, err => {
    console.error('Erro ao carregar rotas:', err);
    showToast('Erro ao carregar rotas do Firebase.', 'error');
  });
}

function renderDashboardRoutes(routes) {
  routes = routes.filter(r => r.status !== 'cancelada');
  
  const today = new Date().toISOString().split('T')[0];
  const em    = routes.filter(r => r.status === 'em_andamento');
  const fut   = routes.filter(r => r.status === 'planejada');
  const conc  = routes.filter(r => r.status === 'concluida');
  document.getElementById('stat-em-rota').textContent    = em.length;
  document.getElementById('stat-futuras').textContent    = fut.length;
  document.getElementById('stat-concluidas').textContent = conc.length;
  renderRouteList('list-em-andamento', em, 'Nenhuma rota em andamento');
  renderRouteList('list-futuras', fut, 'Nenhuma rota planejada');
  renderRouteList('list-concluidas', conc, 'Nenhuma rota concluida');
  // Auto-switch para aba Futuras se nao tiver em andamento
  if (em.length === 0 && fut.length > 0) {
    setTimeout(() => {
      const tabs = document.querySelectorAll('.tab-btn');
      const tcs  = document.querySelectorAll('.tab-content');
      tabs.forEach(t => t.classList.remove('active'));
      tcs.forEach(t => t.classList.add('hidden'));
      if (tabs[1]) tabs[1].classList.add('active');
      const futTab = document.getElementById('tab-futuras');
      if (futTab) futTab.classList.remove('hidden');
    }, 100);
  }
}

function renderRouteList(id, routes, emptyMsg) {
  const el = document.getElementById(id);
  if (!el) return;

  if (!routes || routes.length === 0) {
    el.innerHTML = `<div class="routes-empty"><p>${emptyMsg}</p></div>`;
    return;
  }

  el.innerHTML = routes.map(r => routeCardHTML(r)).join('');
}

function routeCardHTML(r) {
  const ini = r.dataInicio ? formatDateBR(r.dataInicio) : '';
  const fim = r.dataFim ? formatDateBR(r.dataFim) : '';

  const periodo = fim && fim !== ini ? `${ini} → ${fim}` : ini || 'Sem data';

  const status = r.status || 'planejada';

  const lbl = {
    planejada: 'Planejada',
    em_andamento: 'Em andamento',
    concluida: 'Concluída'
  };

  const cls = {
    planejada: 'badge-planejada',
    em_andamento: 'badge-em_andamento',
    concluida: 'badge-concluida'
  };

  return `
    <div class="route-card status-${status}" onclick="openRoute('${r.id}')">
      <div class="route-card-top">
        <span class="route-card-name">${r.nome || 'Sem nome'}</span>
        <span class="route-status-badge ${cls[status] || ''}">
          ${lbl[status] || status}
        </span>
      </div>

      <div class="route-card-meta">
        <span>${periodo}</span>
        <span>${r.totalStops || 0} parada(s)</span>
        ${r.distanciaTotal ? `<span>${r.distanciaTotal}</span>` : ''}
        ${r.tempoTotal ? `<span>${r.tempoTotal}</span>` : ''}
      </div>
    </div>
  `;
};

// ============================================
// CRIAR ROTA
// ============================================
window.resetCriarRota = function () {
  document.getElementById('rota-nome').value = '';
  document.getElementById('rota-data-inicio').value = '';
  document.getElementById('rota-data-fim').value = '';
  document.getElementById('address-search').value = '';
  document.getElementById('date-alerts').innerHTML = '';
  pendingStops = []; holidayAnalysis = null;
  renderPendingStops();
  document.getElementById('address-suggestions').classList.add('hidden');
};

// ===== DATAS =====
window.onDateChange = async function () {
  const s = document.getElementById('rota-data-inicio').value;
  const e = document.getElementById('rota-data-fim').value;
  const el = document.getElementById('date-alerts');

  el.innerHTML = '';

  if (!s || !e) return;

  if (e < s) {
    el.innerHTML = `<div class="date-alert date-alert-info">⚠️ Data de fim deve ser igual ou posterior ao início.</div>`;
    return;
  }

  try {
    const est = pendingStops[0]?.estado || '';
    const cid = pendingStops[0]?.cidade || '';

    holidayAnalysis = await Holidays.analisarPeriodo(s, e, est, cid);
    renderDateAlerts(holidayAnalysis.alertas || []);
  } catch (err) {
    console.error('Erro ao verificar feriados:', err);
    el.innerHTML = '';
    holidayAnalysis = null;
  }
};

function renderDateAlerts(alertas) {
  const el = document.getElementById('date-alerts');
  el.innerHTML = (alertas||[]).map(a => {
    const cls = a.type==='fds' ? 'date-alert-fds' : a.type==='feriado' ? 'date-alert-feriado' : 'date-alert-info';
    return `<div class="date-alert ${cls}"><span>${a.message}</span></div>`;
  }).join('');
}

// ===== BUSCA DE ENDEREÇOS (Nominatim — gratuito) =====
document.addEventListener('DOMContentLoaded', () => {
  const inp = document.getElementById('address-search');
  if (!inp) return;
  inp.addEventListener('input', () => {
    clearTimeout(nominatimTimeout);
    nominatimTimeout = setTimeout(() => searchAddressNominatim(inp.value), 500);
  });
  inp.addEventListener('blur', () => {
    setTimeout(() => document.getElementById('address-suggestions').classList.add('hidden'), 200);
  });
});

async function searchAddressNominatim(query) {
  if (!query || query.length < 3) {
    document.getElementById('address-suggestions').classList.add('hidden');
    return;
  }
  // Respeita limite de 1 req/s do Nominatim
  const now = Date.now();
  if (now - lastNominatimCall < 1000) {
    nominatimTimeout = setTimeout(() => searchAddressNominatim(query), 1000 - (now - lastNominatimCall));
    return;
  }
  lastNominatimCall = Date.now();
  try {
    const res = await fetch(
      `${NOMINATIM_URL}/search?format=json&q=${encodeURIComponent(query)}&countrycodes=br&limit=5&addressdetails=1`,
      { headers: { 'Accept-Language': 'pt-BR', 'User-Agent': 'RotaCobranca/1.0' } }
    );
    const data = await res.json();
    renderSuggestions(data);
  } catch (e) {
    console.error('Nominatim error', e);
    showToast('Erro na busca de endereços.', 'error');
  }
}

function renderSuggestions(results) {
  const el = document.getElementById('address-suggestions');
  if (!results.length) { el.classList.add('hidden'); return; }
  el.innerHTML = results.map((r, i) => {
    const main = r.name || r.display_name.split(',')[0];
    const sec  = r.display_name;
    return `
      <div class="suggestion-item" onmousedown="selectAddressNominatim(${i})" data-idx="${i}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
        <div>
          <div class="suggestion-main">${main}</div>
          <div class="suggestion-secondary">${sec}</div>
        </div>
      </div>`;
  }).join('');
  // Armazena resultados para seleção
  el._results = results;
  el.classList.remove('hidden');
}

window.selectAddressNominatim = function (idx) {
  const el = document.getElementById('address-suggestions');
  const r  = el._results?.[idx];
  if (!r) return;
  if (!r.lat || !r.lon) {
  showToast('Endereço inválido. Selecione uma sugestão real.', 'error');
  return;
}

const latitude = parseFloat(r.lat);
const longitude = parseFloat(r.lon);

if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
  showToast('Endereço sem coordenadas válidas.', 'error');
  return;
}

const jaExiste = pendingStops.some(s =>
  Math.abs(Number(s.latitude) - latitude) < 0.00001 &&
  Math.abs(Number(s.longitude) - longitude) < 0.00001
);

if (jaExiste) {
  showToast('Este endereço já foi adicionado.', 'warning');
  return;
}

  const addr = r.address || {};
  const cidade = addr.city || addr.town || addr.village || addr.municipality || addr.county || '';
  const estado  = addr.state || '';
  const estadoUF = estadoParaUF(estado);

  const stop = {
    nomeLocal: r.name || r.display_name.split(',')[0],
    enderecoCompleto: r.display_name,
    cidade,
    estado: estadoUF,
    latitude,
    longitude,
    statusVisita: 'pendente',
    observacoes: '',
    ordem: pendingStops.length + 1,
  };

  pendingStops.push(stop);
  // Limpa campo de busca imediatamente
  const searchInput = document.getElementById('address-search');
  if (searchInput) searchInput.value = '';
  el.classList.add('hidden');
  el._results = [];
  // Renderiza lista atualizada
  renderPendingStops();
  // Scroll para mostrar o novo endereço
  const stopsList = document.getElementById('stops-list');
  if (stopsList) stopsList.scrollIntoView({behavior:'smooth', block:'nearest'});
  showToast('✅ Endereço adicionado!', 'success');

  const s = document.getElementById('rota-data-inicio').value;
  const e = document.getElementById('rota-data-fim').value;
  if (s && e) onDateChange();
};

function estadoParaUF(nomeEstado) {
  const mapa = {
    'Acre':'AC','Alagoas':'AL','Amapá':'AP','Amazonas':'AM','Bahia':'BA','Ceará':'CE',
    'Distrito Federal':'DF','Espírito Santo':'ES','Goiás':'GO','Maranhão':'MA',
    'Mato Grosso':'MT','Mato Grosso do Sul':'MS','Minas Gerais':'MG','Pará':'PA',
    'Paraíba':'PB','Paraná':'PR','Pernambuco':'PE','Piauí':'PI','Rio de Janeiro':'RJ',
    'Rio Grande do Norte':'RN','Rio Grande do Sul':'RS','Rondônia':'RO','Roraima':'RR',
    'Santa Catarina':'SC','São Paulo':'SP','Sergipe':'SE','Tocantins':'TO'
  };
  return mapa[nomeEstado] || nomeEstado;
}

// ===== RENDER STOPS =====
function renderPendingStops() {
  const list = document.getElementById('stops-list');
  if (!list) return;

  const countEl = document.getElementById('stops-count');
  if (countEl) countEl.textContent = pendingStops.length;

  if (!pendingStops.length) {
    list.innerHTML = `
      <div class="stops-empty">
        <p>Nenhum endereço ainda</p>
      </div>`;
    return;
  }

  list.innerHTML = pendingStops.map((s, i) => {
    const cidade = s.cidade || '';
    const estado = s.estado || '';
    const localizacao = cidade && estado ? `${cidade}/${estado}` : cidade || estado || '';

    const nomeComCidade = localizacao
      ? `${s.nomeLocal || 'Endereço ' + (i + 1)} — ${localizacao}`
      : `${s.nomeLocal || 'Endereço ' + (i + 1)}`;

    const date = getDateForStopIdx(i);

    const badges = holidayAnalysis
      ? Holidays.getBadgesParaData(date, holidayAnalysis.feriadoMap, holidayAnalysis.finsDeSemana)
      : [];

    const temFeriado = badges.some(b => b.type === 'feriado');
    const temFds = badges.some(b => b.type === 'fds');

    const alertaClasse = temFeriado ? 'stop-feriado' : temFds ? 'stop-fds' : '';

    const bdg = badges.map(b =>
      `<span class="badge badge-${b.type === 'feriado' ? 'feriado' : 'fds'}">${b.label}</span>`
    ).join('');

    return `
      <div class="stop-item ${alertaClasse}" draggable="true" data-idx="${i}">
        <div class="stop-drag-handle">☰</div>
        <div class="stop-order-num">${i + 1}</div>

        <div class="stop-info-mini">
          <div class="stop-name-mini">${nomeComCidade}</div>
          <div class="stop-addr-mini">${s.enderecoCompleto || ''}</div>
          ${bdg ? `<div class="stop-badges-mini">${bdg}</div>` : ''}
        </div>

        <button class="stop-delete" onclick="removeStop(${i})" title="Remover">✕</button>
      </div>`;
  }).join('');

  initDragAndDrop();
}

window.removeStop = function (idx) {
  pendingStops.splice(idx, 1);
  pendingStops.forEach((s,i) => s.ordem = i+1);
  renderPendingStops();
};

function getDateForStopIdx(idx) {
  const s = document.getElementById('rota-data-inicio').value;
  const e = document.getElementById('rota-data-fim').value;
  if (!s) return null;
  const dates = Holidays.getDateRange(s, e||s);
  return dates[Math.min(idx, dates.length-1)];
}

// ===== DRAG & DROP =====
function initDragAndDrop() {
  const items = document.querySelectorAll('.stop-item');
  let dragIdx = null;
  items.forEach(item => {
    item.addEventListener('dragstart', () => { dragIdx = parseInt(item.dataset.idx); item.classList.add('dragging'); });
    item.addEventListener('dragend',   () => { item.classList.remove('dragging'); dragIdx = null; });
    item.addEventListener('dragover',  e => {
      e.preventDefault();
      const over = parseInt(item.dataset.idx);
      if (dragIdx === null || dragIdx === over) return;
      const moved = pendingStops.splice(dragIdx, 1)[0];
      pendingStops.splice(over, 0, moved);
      pendingStops.forEach((s,i) => s.ordem = i+1);
      dragIdx = over;
      renderPendingStops();
    });
  });
}

// ===== CALCULAR ROTA (OSRM) =====
window.calcularRota = async function () {
  if (pendingStops.length < 2) {
    showToast('Adicione pelo menos 2 endereços.', 'warning');
    return null;
  }

  showToast('Calculando rota...', 'info');

  try {
    const validStops = pendingStops.filter(s =>
      Number.isFinite(Number(s.longitude)) &&
      Number.isFinite(Number(s.latitude))
    );

    const coords = validStops
      .map(s => `${s.longitude},${s.latitude}`)
      .join(';');

    const tripUrl =
      `https://router.project-osrm.org/trip/v1/driving/${coords}?source=first&destination=last&roundtrip=false&overview=false&steps=false`;

    const tripRes = await fetch(tripUrl);
    const tripData = await tripRes.json();

    if (tripData.code === 'Ok' && tripData.trips?.length) {
      const originalStops = [...validStops];

      const ordered = tripData.waypoints
        .map((w, originalIndex) => ({ ...w, originalIndex }))
        .sort((a, b) => a.waypoint_index - b.waypoint_index);

      pendingStops = ordered.map((w, i) => ({
        ...originalStops[w.originalIndex],
        ordem: i + 1
      }));

      const trip = tripData.trips[0];
      const dist = (trip.distance / 1000).toFixed(1) + ' km';
      const secs = trip.duration;
      const hrs = Math.floor(secs / 3600);
      const mins = Math.floor((secs % 3600) / 60);
      const tempo = hrs > 0 ? `${hrs}h ${mins}min` : `${mins} min`;

      renderPendingStops();
      showToast(`Rota otimizada: ${dist} · ${tempo}`, 'success');

      return { dist, tempo };
    }

    const routeUrl =
      `https://router.project-osrm.org/route/v1/driving/${coords}?overview=false&steps=false`;

    const routeRes = await fetch(routeUrl);
    const routeData = await routeRes.json();

    if (routeData.code !== 'Ok' || !routeData.routes?.length) {
      console.error('OSRM erro:', tripData, routeData);
      showToast('Não foi possível calcular a rota.', 'error');
      return null;
    }

    const route = routeData.routes[0];
    const dist = (route.distance / 1000).toFixed(1) + ' km';
    const secs = route.duration;
    const hrs = Math.floor(secs / 3600);
    const mins = Math.floor((secs % 3600) / 60);
    const tempo = hrs > 0 ? `${hrs}h ${mins}min` : `${mins} min`;

    renderPendingStops();
    showToast(`Rota calculada: ${dist} · ${tempo}`, 'success');

    return { dist, tempo };

  } catch (e) {
    console.error('Erro ao calcular rota:', e);
    showToast('Não foi possível calcular a rota.', 'error');
    return null;
  }
};

// ===== SALVAR ROTA =====
window.salvarRota = async function () {
  const nome = document.getElementById('rota-nome').value.trim();
  const inicio = document.getElementById('rota-data-inicio').value;
  const fim = document.getElementById('rota-data-fim').value;

  if (!nome) {
    showToast('Digite um nome para a rota.', 'warning');
    return;
  }

  if (!inicio) {
    showToast('Selecione a data inicial.', 'warning');
    return;
  }

  if (!pendingStops.length) {
    showToast('Adicione pelo menos um endereço.', 'warning');
    return;
  }

  await doSalvarRota(nome, inicio, fim || inicio);
};

async function doSalvarRota(nome, inicio, fim) {
  showToast('Salvando...','info');
  // Calcula métricas via OSRM antes de salvar
  let distanciaTotal = '', tempoTotal = '';
  if (pendingStops.length >= 2) {
    try {
      const coords = pendingStops.map(s => `${s.longitude},${s.latitude}`).join(';');
      const res = await fetch(`${OSRM_URL}/${coords}?overview=false`);
      const data = await res.json();
      if (data.code === 'Ok') {
        distanciaTotal = (data.routes[0].distance/1000).toFixed(1)+' km';
        const secs = data.routes[0].duration;
        const h = Math.floor(secs/3600), m = Math.floor((secs%3600)/60);
        tempoTotal = h > 0 ? `${h}h ${m}min` : `${m} min`;
      }
    } catch(_) {}
  }
  try {
    const ref = await addDoc(collection(db,'routes'), {
      nome, cobradorId: currentUser.uid, cobradorNome: currentUserData?.nome||'',
      dataInicio: inicio, dataFim: fim||inicio,
      status: 'planejada', totalStops: pendingStops.length,
      distanciaTotal, tempoTotal,
      criadoEm: serverTimestamp(), atualizadoEm: serverTimestamp(),
    });
    for (let i=0; i<pendingStops.length; i++) {
      await addDoc(collection(db,'routeStops'), {
        ...pendingStops[i], routeId: ref.id,
        criadoEm: serverTimestamp(), atualizadoEm: serverTimestamp()
      });
    }
    showToast('Rota salva!','success');
    resetCriarRota();
    showScreen('screen-dashboard');
    loadDashboard();
  } catch(e) {
    console.error('Erro ao salvar rota:', e);
    if (e.code === 'permission-denied' || e.code === 'PERMISSION_DENIED') {
      showToast('Sem permissão. Atualize as regras do Firestore.', 'error');
    } else {
      showToast('Erro ao salvar: ' + (e.message||e.code||'desconhecido'), 'error');
    }
  }
}

// ============================================
// ABRIR ROTA
// ============================================
window.openRoute = async function (routeId) {
  try {
    const snap = await getDoc(doc(db,'routes',routeId));
    if (!snap.exists()) { showToast('Rota não encontrada.','error'); return; }
    currentRoute = {id:routeId,...snap.data()};
    try {
      const sq = query(collection(db,'routeStops'), where('routeId','==',routeId));
      const ss = await getDocs(sq);
      currentRoute.stops = ss.docs
        .map(d=>({id:d.id,...d.data()}))
        .sort((a,b)=>(a.ordem||0)-(b.ordem||0));
    } catch(e2) { currentRoute.stops = []; }

    document.getElementById('topbar-title').textContent = currentRoute.nome||'Rota';
    showScreen('screen-detalhe-rota');
    await renderDetalheRota();
  } catch(e) { console.error(e); showToast('Erro ao abrir rota.','error'); }
};

async function renderDetalheRota() {
  if (!currentRoute) return;
  document.getElementById('meta-tempo').textContent     = currentRoute.tempoTotal||'—';
  document.getElementById('meta-distancia').textContent = currentRoute.distanciaTotal||'—';
  const ini = formatDateBR(currentRoute.dataInicio);
  const fim = formatDateBR(currentRoute.dataFim);
  document.getElementById('meta-periodo').textContent   = (fim && fim!==ini) ? `${ini} → ${fim}` : ini;

  const isConcluida = currentRoute.status === 'concluida';
  const isEmAndamento = currentRoute.status === 'em_andamento';
  document.getElementById('btn-iniciar-rota').classList.toggle('hidden', isEmAndamento || isConcluida);
  document.getElementById('btn-finalizar-rota').classList.toggle('hidden', !isEmAndamento);

  holidayAnalysis = await Holidays.analisarPeriodo(
    currentRoute.dataInicio, currentRoute.dataFim,
    currentRoute.stops?.[0]?.estado||'', currentRoute.stops?.[0]?.cidade||''
  );

  setTimeout(() => initMapRota(), 150);
  renderDetalheStops(currentRoute.stops||[]);
}

function renderDetalheStops(stops) {
  const ct = document.getElementById('rota-stops-detalhe');
  if (!stops.length) { ct.innerHTML='<div class="routes-empty"><p>Nenhum endereço.</p></div>'; return; }

  const start = currentRoute?.dataInicio;
  const end   = currentRoute?.dataFim;
  const dates = (start&&end) ? Holidays.getDateRange(start,end) : [start];

  const byDay = {};
  stops.forEach((s,i) => {
    const date = dates[Math.min(i,dates.length-1)] || start;
    if (!byDay[date]) byDay[date]=[];
    byDay[date].push({...s, globalIdx:i});
  });

  let html='';
  Object.entries(byDay).forEach(([date, dayStops]) => {
    const dia     = Holidays.getDiaSemana(date);
    const dataBR  = formatDateBR(date);
    const isFds   = Holidays.isWeekend(date);
    const feriado = holidayAnalysis?.feriadoMap?.[date];
    const hClass  = feriado ? 'day-header-feriado' : isFds ? 'day-header-fds' : '';
    const hBadge  = feriado
      ? `<span class="day-badge day-badge-feriado">Feriado: ${feriado}</span>`
      : isFds ? `<span class="day-badge day-badge-fds">Final de semana</span>` : '';

    html += `<div class="day-section"><div class="day-header ${hClass}">
      <span class="day-header-label">${dia}</span>
      <span class="day-header-date">${dataBR}</span>${hBadge}</div>`;

    dayStops.forEach(s => {
      const bgs = Holidays.getBadgesParaData(date, holidayAnalysis?.feriadoMap, holidayAnalysis?.finsDeSemana);
      const bdg = bgs.map(b=>`<span class="badge badge-${b.type==='feriado'?'feriado':'fds'}">${b.label}</span>`).join('');
      const scls= s.statusVisita==='visitado'?'badge-visitado':s.statusVisita==='nao_visitado'?'badge-nao_visitado':'badge-pendente';
      const slbl= s.statusVisita==='visitado'?'Visitado':s.statusVisita==='nao_visitado'?'Não visitado':'Pendente';
      html += `
        <div class="stop-detalhe-item status-${s.statusVisita||'pendente'}" onclick="openStop('${s.id}',${s.globalIdx})">
          <div class="stop-detalhe-inner">
            <div class="stop-detalhe-num">${s.ordem||s.globalIdx+1}</div>
            <div class="stop-detalhe-info">
              <div class="stop-detalhe-name">${s.nomeLocal||'—'}</div>
              <div class="stop-detalhe-addr">${s.enderecoCompleto||'—'}</div>
            </div>
            <span class="stop-detalhe-status ${scls}">${slbl}</span>
          </div>
          ${bdg?`<div class="stop-detalhe-badges">${bdg}</div>`:''}
        </div>`;
    });
    html += '</div>';
  });
  ct.innerHTML = html;
}

// ============================================
// ABRIR STOP
// ============================================
window.openStop = function (stopId, idx) {
  currentStop = currentRoute?.stops?.find(s=>s.id===stopId);
  if (!currentStop) return;
  currentStopIndex = idx;

  document.getElementById('stop-num').textContent = currentStop.ordem||idx+1;
  document.getElementById('stop-nome-local').textContent     = currentStop.nomeLocal||'—';
  document.getElementById('stop-endereco-completo').textContent = currentStop.enderecoCompleto||'—';
  document.getElementById('stop-obs').value = currentStop.observacoes||'';
  document.getElementById('btn-visitado').classList.toggle('active', currentStop.statusVisita==='visitado');
  document.getElementById('btn-nao-visitado').classList.toggle('active', currentStop.statusVisita==='nao_visitado');

  const date = getDateForStopFromRoute(idx);
  const bgs  = Holidays.getBadgesParaData(date, holidayAnalysis?.feriadoMap, holidayAnalysis?.finsDeSemana);
  document.getElementById('stop-badges').innerHTML =
    bgs.map(b=>`<span class="badge badge-${b.type==='feriado'?'feriado':'fds'}">${b.label}</span>`).join('');

  let ts = '';
  if (currentStop.visitadoEm) ts += `<p>✅ Visitado: ${fmtTs(currentStop.visitadoEm)}</p>`;
  if (currentStop.atualizadoEm) ts += `<p>🕒 Atualizado: ${fmtTs(currentStop.atualizadoEm)}</p>`;
  document.getElementById('stop-timestamps').innerHTML = ts;

  showScreen('screen-detalhe-stop');
  document.getElementById('topbar-title').textContent = currentStop.nomeLocal||'Endereço';
  setTimeout(() => initMapMini(currentStop.latitude, currentStop.longitude, currentStop.nomeLocal), 200);
};

function getDateForStopFromRoute(idx) {
  if (!currentRoute) return null;
  const dates = Holidays.getDateRange(currentRoute.dataInicio, currentRoute.dataFim);
  return dates[Math.min(idx, dates.length-1)] || currentRoute.dataInicio;
}
function fmtTs(ts) {
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleString('pt-BR');
}

window.marcarStatus = function (s) {
  if (!currentStop) return;
  currentStop.statusVisita = s;
  document.getElementById('btn-visitado').classList.toggle('active', s==='visitado');
  document.getElementById('btn-nao-visitado').classList.toggle('active', s==='nao_visitado');
};

window.salvarStop = async function () {
  if (!currentStop) return;
  const obs = document.getElementById('stop-obs').value;
  try {
    const upd = { statusVisita: currentStop.statusVisita, observacoes: obs, atualizadoEm: serverTimestamp() };
    if (currentStop.statusVisita==='visitado' && !currentStop.visitadoEm) upd.visitadoEm = serverTimestamp();
    await updateDoc(doc(db,'routeStops',currentStop.id), upd);
    // Salva localização
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(pos => {
        addDoc(collection(db,'locations'), {
          userId: currentUser.uid, routeId: currentRoute.id, stopId: currentStop.id,
          latitude: pos.coords.latitude, longitude: pos.coords.longitude,
          atualizadoEm: serverTimestamp()
        }).catch(()=>{});
      });
    }
    showToast('Salvo!','success');
    await openRoute(currentRoute.id);
    goBack();
  } catch(e) { console.error(e); showToast('Erro ao salvar.','error'); }
};

// ============================================
// INICIAR / FINALIZAR
// ============================================
window.iniciarRota = async function () {
  if (!currentRoute) return;
  await updateDoc(doc(db,'routes',currentRoute.id), { status:'em_andamento', iniciadoEm:serverTimestamp(), atualizadoEm:serverTimestamp() });
  currentRoute.status = 'em_andamento';
  renderDetalheRota();
  showToast('Rota iniciada!','success');
};

window.finalizarRota = async function () {
  if (!currentRoute) return;
  await updateDoc(doc(db,'routes',currentRoute.id), { status:'concluida', finalizadoEm:serverTimestamp(), atualizadoEm:serverTimestamp() });
  currentRoute.status = 'concluida';
  renderDetalheRota();
  showToast('Rota finalizada!','success');
};

// ============================================
// AEROPORTO (Overpass API — gratuita)
// ============================================
window.mostrarAeroporto = async function () {
  showModal('modal-aeroporto');
  const body = document.getElementById('modal-aeroporto-body');
  body.innerHTML = '<div class="loading-spin"></div>';
  if (!currentRoute?.stops?.length) {
    body.innerHTML = '<p>Nenhum endereço na rota.</p>'; return;
  }
  const last = currentRoute.stops[currentRoute.stops.length-1];
  const lat = last.latitude, lon = last.longitude;
  const raio = 100000; // 100km
  try {
    // Busca aeroportos via Overpass API
    const query = `[out:json][timeout:20];node["aeroway"="aerodrome"](around:${raio},${lat},${lon});out body 5;`;
    const res = await fetch(OVERPASS_URL, {
      method: 'POST', body: `data=${encodeURIComponent(query)}`,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
    const data = await res.json();
    const airports = (data.elements||[]).filter(e=>e.tags?.name).slice(0,1);
    if (!airports.length) { body.innerHTML='<p>Nenhum aeroporto encontrado num raio de 100km.</p>'; return; }

    const ap = airports[0];
    const nome = ap.tags.name;
    const apLat = ap.lat, apLon = ap.lon;

    // Calcula rota até aeroporto via OSRM
    let distStr='—', tempoStr='—';
    try {
      const rr = await fetch(`${OSRM_URL}/${lon},${lat};${apLon},${apLat}?overview=false`);
      const rd = await rr.json();
      if (rd.code==='Ok') {
        distStr = (rd.routes[0].distance/1000).toFixed(1)+' km';
        const secs = rd.routes[0].duration;
        const h=Math.floor(secs/3600), m=Math.floor((secs%3600)/60);
        tempoStr = h>0 ? `${h}h ${m}min` : `${m} min`;
      }
    } catch(_) {}

    const mapsUrl = `https://www.google.com/maps/dir/?api=1&origin=${lat},${lon}&destination=${apLat},${apLon}`;
    body.innerHTML = `
      <div class="aeroporto-info">
        <div class="aeroporto-name">${nome}</div>
        <div class="aeroporto-meta">
          <div class="aeroporto-meta-row">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="12" x2="21" y2="12"/></svg>
            <span>Distância: <strong>${distStr}</strong></span>
          </div>
          <div class="aeroporto-meta-row">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            <span>Tempo: <strong>${tempoStr}</strong></span>
          </div>
          <div class="aeroporto-meta-row">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/></svg>
            <span>Partindo de: <strong>${last.nomeLocal||last.cidade}</strong></span>
          </div>
        </div>
        <a href="${mapsUrl}" target="_blank" class="btn-maps-link">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
          Abrir no Google Maps
        </a>
      </div>`;
  } catch(e) {
    console.error(e);
    body.innerHTML='<p>Erro ao buscar aeroporto. Verifique sua conexão.</p>';
  }
};

// ============================================
// MAPAS — LEAFLET
// ============================================
function destroyMaps() {
  if (mapRota)     { mapRota.remove(); mapRota=null; }
  if (mapGerencial){ mapGerencial.remove(); mapGerencial=null; }
  if (mapMini)     { mapMini.remove(); mapMini=null; }
}

const tileUrl = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const tileAttr = '© <a href="https://openstreetmap.org">OpenStreetMap</a>';

function initMapRota() {
  const el = document.getElementById('map');
  if (!el) return;
  if (mapRota) {
    mapRota.invalidateSize();
    updateMapRotaStops();
    return;
  }
  mapRota = L.map('map', { zoomControl: true, attributionControl: true });
  L.tileLayer(tileUrl, { attribution: tileAttr, maxZoom: 19 }).addTo(mapRota);
  mapRota.setView([-14.235, -51.925], 5);
  if (currentRoute?.stops?.length) updateMapRotaStops();
}

function updateMapRotaStops() {
  if (!mapRota) return;
  routeMarkers.forEach(m => mapRota.removeLayer(m));
  routeMarkers = [];
  if (routeLayer) { mapRota.removeLayer(routeLayer); routeLayer=null; }

  const stops = currentRoute?.stops||[];
  if (!stops.length) return;

  const coords = [];
  stops.forEach((s,i) => {
    if (!s.latitude||!s.longitude) return;
    const color = s.statusVisita==='visitado'?'#10B981':s.statusVisita==='nao_visitado'?'#EF4444':'#1A56E8';
    const icon = L.divIcon({
      className:'',
      html:`<div style="width:28px;height:28px;border-radius:50%;background:${color};border:2px solid white;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:11px;color:white;box-shadow:0 2px 6px rgba(0,0,0,0.3)">${s.ordem||i+1}</div>`,
      iconSize:[28,28], iconAnchor:[14,14]
    });
    const marker = L.marker([s.latitude,s.longitude], {icon}).addTo(mapRota);
    marker.bindPopup(`<b>${s.nomeLocal}</b><br>${s.enderecoCompleto}`);
    routeMarkers.push(marker);
    coords.push([s.latitude,s.longitude]);
  });

  if (coords.length>1) {
    const osrmCoords = stops.map(s => s.longitude+','+s.latitude).join(';');
    const desenharRota = (url) => {
      return fetch(url+'/'+osrmCoords+'?overview=full&geometries=geojson')
        .then(r=>r.json())
        .then(data => {
          if (data.code==='Ok') {
            if (routeLayer) mapRota.removeLayer(routeLayer);
            routeLayer = L.geoJSON(data.routes[0].geometry, {
              style:{color:'#1A56E8',weight:5,opacity:0.85}
            }).addTo(mapRota);
            return true;
          }
          return false;
        }).catch(()=>false);
    };
    desenharRota(OSRM_URL).then(ok => {
      if (!ok) return desenharRota(OSRM_URL2);
      return true;
    }).then(ok => {
      if (!ok) {
        if (routeLayer) mapRota.removeLayer(routeLayer);
        routeLayer = L.polyline(coords, {color:'#1A56E8',weight:4,opacity:0.7,dashArray:'10,6'}).addTo(mapRota);
      }
    });
  }

  const bounds = L.latLngBounds(coords);
  mapRota.fitBounds(bounds, {padding:[30,30]});
}

function initMapGerencial() {
  const el = document.getElementById('map-gerencial');
  if (!el) return;
  if (mapGerencial) { mapGerencial.invalidateSize(); return; }
  mapGerencial = L.map('map-gerencial', {zoomControl:true});
  L.tileLayer(tileUrl, {attribution:tileAttr, maxZoom:19}).addTo(mapGerencial);
  mapGerencial.setView([-14.235,-51.925],5);
  // Escuta localizações
  onSnapshot(collection(db,'locations'), snap => {
    const latest={};
    snap.docs.forEach(d=>{
      const loc=d.data();
      if (!latest[loc.userId]||loc.atualizadoEm>latest[loc.userId].atualizadoEm) latest[loc.userId]=loc;
    });
    Object.entries(latest).forEach(([uid,loc])=>{
      const pos=[loc.latitude,loc.longitude];
      if (gerencialMarkers[uid]) {
        gerencialMarkers[uid].setLatLng(pos);
      } else {
        const icon = L.divIcon({
          className:'',
          html:`<div style="background:#1A56E8;border:2px solid white;border-radius:50%;width:20px;height:20px;box-shadow:0 2px 6px rgba(0,0,0,0.3)"></div>`,
          iconSize:[20,20],iconAnchor:[10,10]
        });
        gerencialMarkers[uid]=L.marker(pos,{icon}).addTo(mapGerencial).bindPopup('Cobrador');
      }
    });
  });
}

function initMapMini(lat, lng, title) {
  const el = document.getElementById('stop-map-mini');
  if (!el) return;
  if (mapMini) { mapMini.remove(); mapMini=null; }
  mapMini = L.map('stop-map-mini', {zoomControl:false,attributionControl:false});
  L.tileLayer(tileUrl, {maxZoom:19}).addTo(mapMini);
  mapMini.setView([lat,lng],15);
  L.marker([lat,lng]).addTo(mapMini).bindPopup(title||'').openPopup();
}

// ============================================
// GERENCIAL
// ============================================
async function loadGerencialDashboard() {
  const uSnap = await getDocs(query(collection(db,'users'),where('tipoUsuario','==','cobrador')));
  document.getElementById('kpi-total-cobradores').textContent = uSnap.size;

  // Filtro cobradores
  const sel = document.getElementById('filter-cobrador');
  sel.innerHTML='<option value="">Todos cobradores</option>';
  uSnap.docs.forEach(d=>{
    const u=d.data();
    const o=document.createElement('option');
    o.value=d.id; o.textContent=u.nome||u.email;
    sel.appendChild(o);
  });

  onSnapshot(query(collection(db,'routes'),orderBy('criadoEm','desc')), snap=>{
    allRoutes=snap.docs.map(d=>({id:d.id,...d.data()}));
    const today=new Date().toISOString().split('T')[0];
    document.getElementById('kpi-em-rota').textContent     = allRoutes.filter(r=>r.status==='em_andamento').length;
    document.getElementById('kpi-rotas-hoje').textContent  = allRoutes.filter(r=>r.dataInicio===today||r.dataFim===today).length;
    document.getElementById('kpi-concluidas-g').textContent= allRoutes.filter(r=>r.status==='concluida').length;
    renderListaRotasGerencial(allRoutes);
  });

  initMapGerencial();
}

window.filtrarRotasGerencial = function () {
  const cob = document.getElementById('filter-cobrador').value;
  const sts = document.getElementById('filter-status').value;
  let f=allRoutes;
  if (cob) f=f.filter(r=>r.cobradorId===cob);
  if (sts) f=f.filter(r=>r.status===sts);
  renderListaRotasGerencial(f);
};

function renderListaRotasGerencial(routes) {
  const el=document.getElementById('list-rotas-gerencial');
  el.innerHTML=routes.length
    ? routes.map(r=>routeCardHTML(r).replace(`onclick="openRoute('${r.id}')"`,`onclick="openRoute('${r.id}')"`) ).join('')
    :'<div class="routes-empty"><p>Nenhuma rota.</p></div>';
}

// ============================================
// USUÁRIOS
// ============================================
window.loadUsuarios = async function () {
  const snap=await getDocs(query(collection(db,'users'),orderBy('criadoEm','desc')));
  allUsers=snap.docs.map(d=>({id:d.id,...d.data()}));
  const el=document.getElementById('list-usuarios');
  el.innerHTML=allUsers.length ? allUsers.map(u=>`
    <div class="user-card">
      <div class="user-card-avatar">${(u.nome||'U')[0].toUpperCase()}</div>
      <div class="user-card-info">
        <div class="user-card-name">${u.nome||'—'}</div>
        <div class="user-card-email">${u.email||'—'}</div>
        <div class="user-card-badges">
          <span class="badge badge-${u.tipoUsuario}">${u.tipoUsuario==='gerencial'?'Gerencial':'Cobrador'}</span>
          <span class="badge badge-${u.ativo?'ativo':'inativo'}">${u.ativo?'Ativo':'Inativo'}</span>
        </div>
      </div>
      <div class="user-card-actions">
        <button class="btn-icon" onclick="editarUsuario('${u.id}')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
      </div>
    </div>`).join('')
    :'<div class="routes-empty"><p>Nenhum usuário.</p></div>';
};

window.abrirModalNovoUsuario = function () {
  document.getElementById('modal-user-id').value='';
  document.getElementById('modal-user-nome').value='';
  document.getElementById('modal-user-email').value='';
  document.getElementById('modal-user-senha').value='';
  document.getElementById('modal-user-tipo').value='cobrador';
  document.getElementById('modal-user-ativo').checked=true;
  document.getElementById('modal-usuario-title').textContent='Novo Usuário';
  document.getElementById('modal-senha-group').classList.remove('hidden');
  showModal('modal-usuario');
};

window.editarUsuario = function (uid) {
  const u=allUsers.find(u=>u.id===uid);
  if (!u) return;
  document.getElementById('modal-user-id').value=uid;
  document.getElementById('modal-user-nome').value=u.nome||'';
  document.getElementById('modal-user-email').value=u.email||'';
  document.getElementById('modal-user-tipo').value=u.tipoUsuario||'cobrador';
  document.getElementById('modal-user-ativo').checked=u.ativo!==false;
  document.getElementById('modal-usuario-title').textContent='Editar Usuário';
  document.getElementById('modal-senha-group').classList.add('hidden');
  showModal('modal-usuario');
};

window.salvarUsuario = async function () {
  const uid   = document.getElementById('modal-user-id').value;
  const nome  = document.getElementById('modal-user-nome').value.trim();
  const email = document.getElementById('modal-user-email').value.trim();
  const tipo  = document.getElementById('modal-user-tipo').value;
  const ativo = document.getElementById('modal-user-ativo').checked;
  const senha = document.getElementById('modal-user-senha').value;
  if (!nome||!email) { showToast('Preencha nome e e-mail.','warning'); return; }
  try {
    if (uid) {
      await updateDoc(doc(db,'users',uid), {nome,tipoUsuario:tipo,ativo,atualizadoEm:serverTimestamp()});
      showToast('Usuário atualizado!','success');
    } else {
      if (!senha) { showToast('Informe uma senha.','warning'); return; }
      // Cria usuário no Firebase Auth
      const cred = await createUserWithEmailAndPassword(auth, email, senha);
      await setDoc(doc(db,'users',cred.user.uid), {
        nome, email, tipoUsuario:tipo, ativo, criadoEm:serverTimestamp()
      });
      showToast('Usuário criado!','success');
    }
    closeModal('modal-usuario');
    loadUsuarios();
  } catch(e) {
    console.error(e);
    const msgs={'auth/email-already-in-use':'E-mail já cadastrado.','auth/weak-password':'Senha deve ter ao menos 6 caracteres.'};
    showToast(msgs[e.code]||'Erro ao salvar.','error');
  }
};

    window.switchTab = function (btn, tab) {
  // ativa botão
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');

  // esconde todos conteúdos
  document.querySelectorAll('.tab-content').forEach(tc => tc.classList.add('hidden'));

  // mostra o selecionado
  const el = document.getElementById(`tab-${tab}`);
  if (el) el.classList.remove('hidden');
};

window.cancelarRota = async function () {
  if (!currentRoute?.id) {
    showToast('Nenhuma rota aberta.', 'warning');
    return;
  }

  const ok = confirm(`Cancelar a rota "${currentRoute.nome || 'sem nome'}"?`);
  if (!ok) return;

  try {
    await updateDoc(doc(db, 'routes', currentRoute.id), {
      status: 'cancelada',
      canceladaEm: serverTimestamp(),
      atualizadoEm: serverTimestamp()
    });

    showToast('Rota cancelada.', 'success');
    currentRoute = null;
    showScreen('screen-dashboard');
    loadDashboard();

  } catch (e) {
    console.error('Erro ao cancelar rota:', e);
    showToast('Erro ao cancelar rota.', 'error');
  }
};

// ============================================
// HELPERS
// ============================================
function showAlertModal(alertas, cb) {
  window._alertCb = cb;
  document.getElementById('modal-alerta-body').innerHTML =
    alertas.map(a=>`<div class="alerta-item alerta-item-${a.type}">${a.message}</div>`).join('');
  showModal('modal-alerta');
}

window.showModal  = id => document.getElementById(id)?.classList.remove('hidden');
window.closeModal = id => document.getElementById(id)?.classList.add('hidden');

let _toastTimer=null;
function showToast(msg,type='info') {
  const el=document.getElementById('toast');
  clearTimeout(_toastTimer);
  el.textContent=msg;
  el.className=`toast toast-${type}`;
  el.classList.remove('hidden');
  _toastTimer=setTimeout(()=>el.classList.add('hidden'),3000);
  
}
