// ============================================
// holidays.js
// Módulo de Feriados - Rota Cobrança
// ============================================
// Usa a API BrasilAPI (gratuita, sem chave)
// https://brasilapi.com.br/docs#tag/Feriados-Nacionais
// Feriados nacionais: disponíveis via API
// Feriados estaduais/municipais: parcialmente
// ============================================

const BRAZIL_API = 'https://brasilapi.com.br/api/feriados/v1';

// Cache para evitar múltiplas chamadas
const holidayCache = {};

// Nomes dos dias da semana
const DIAS_SEMANA = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];

/**
 * Busca feriados nacionais de um determinado ano
 * @param {number} year
 * @returns {Promise<Array>}
 */
async function fetchNationalHolidays(year) {
  if (holidayCache[year]) return holidayCache[year];
  try {
    const res = await fetch(`${BRAZIL_API}/${year}`);
    if (!res.ok) throw new Error('API indisponível');
    const data = await res.json();
    holidayCache[year] = data;
    return data;
  } catch (e) {
    console.warn('Feriados: falha na API BrasilAPI', e);
    // Feriados nacionais fixos como fallback
    return getFallbackHolidays(year);
  }
}

/**
 * Fallback com feriados nacionais fixos (caso API falhe)
 */
function getFallbackHolidays(year) {
  return [
    { date: `${year}-01-01`, name: 'Ano Novo', type: 'national' },
    { date: `${year}-04-21`, name: 'Tiradentes', type: 'national' },
    { date: `${year}-05-01`, name: 'Dia do Trabalho', type: 'national' },
    { date: `${year}-09-07`, name: 'Independência do Brasil', type: 'national' },
    { date: `${year}-10-12`, name: 'Nossa Senhora Aparecida', type: 'national' },
    { date: `${year}-11-02`, name: 'Finados', type: 'national' },
    { date: `${year}-11-15`, name: 'Proclamação da República', type: 'national' },
    { date: `${year}-12-25`, name: 'Natal', type: 'national' },
  ];
}

/**
 * Verifica se uma data (string YYYY-MM-DD) é fim de semana
 */
function isWeekend(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  const day = d.getDay();
  return day === 0 || day === 6; // 0=Domingo, 6=Sábado
}

/**
 * Retorna o nome do dia da semana
 */
function getDiaSemana(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  return DIAS_SEMANA[d.getDay()];
}

/**
 * Formata data YYYY-MM-DD para DD/MM/YYYY
 */
function formatDateBR(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

/**
 * Gera array de todas as datas entre duas datas (inclusive)
 */
function getDateRange(startStr, endStr) {
  const dates = [];
  const start = new Date(startStr + 'T12:00:00');
  const end = new Date(endStr + 'T12:00:00');
  const current = new Date(start);
  while (current <= end) {
    dates.push(current.toISOString().split('T')[0]);
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

/**
 * Analisa um range de datas e retorna:
 * - fins de semana
 * - feriados nacionais
 * - avisos de feriados municipais
 *
 * @param {string} startStr - YYYY-MM-DD
 * @param {string} endStr   - YYYY-MM-DD
 * @param {string} estado   - UF (ex: 'SP')
 * @param {string} cidade   - Nome da cidade
 * @returns {Promise<Object>}
 */
async function analisarPeriodo(startStr, endStr, estado = '', cidade = '') {
  if (!startStr || !endStr) return { feriados: [], finsDeSemana: [], alertas: [] };

  const dates = getDateRange(startStr, endStr);
  const years = [...new Set(dates.map(d => d.split('-')[0]))];

  // Busca feriados de todos os anos envolvidos
  let allHolidays = [];
  for (const year of years) {
    const h = await fetchNationalHolidays(year);
    allHolidays = allHolidays.concat(h);
  }

  const feriadoMap = {};
  allHolidays.forEach(h => {
    feriadoMap[h.date] = h.name;
  });

  const feriados = [];
  const finsDeSemana = [];
  const alertas = [];

  for (const date of dates) {
    if (isWeekend(date)) {
      const dia = getDiaSemana(date);
      finsDeSemana.push({ date, dia });
    }
    if (feriadoMap[date]) {
      feriados.push({ date, name: feriadoMap[date], type: 'national' });
    }
  }

  // Gerar alertas
  if (finsDeSemana.length > 0) {
    const dias = finsDeSemana.map(f => `${f.dia} (${formatDateBR(f.date)})`).join(', ');
    alertas.push({
      type: 'fds',
      message: `A rota inclui ${finsDeSemana.length} dia(s) de final de semana: ${dias}.`
    });
  }

  for (const f of feriados) {
    let msg = `Feriado nacional em ${formatDateBR(f.date)}: ${f.name}.`;
    if (cidade) msg = `Atenção: existe feriado em ${cidade} no dia ${formatDateBR(f.date)} — ${f.name}.`;
    alertas.push({ type: 'feriado', date: f.date, name: f.name, message: msg });
  }

  if (estado || cidade) {
    alertas.push({
      type: 'info',
      message: `Feriados municipais de ${cidade || estado} podem precisar de confirmação manual.`
    });
  }

  return { feriados, finsDeSemana, alertas, feriadoMap };
}

/**
 * Verifica se uma data específica tem feriado ou é FDS
 * Retorna badges a exibir
 */
function getBadgesParaData(dateStr, feriadoMap, finsDeSemana) {
  const badges = [];
  if (!dateStr) return badges;
  const isFds = isWeekend(dateStr);
  if (isFds) badges.push({ type: 'fds', label: 'Final de semana' });
  if (feriadoMap && feriadoMap[dateStr]) {
    badges.push({ type: 'feriado', label: `Feriado: ${feriadoMap[dateStr]}` });
  }
  return badges;
}

// Exporta para uso global no app
window.Holidays = {
  analisarPeriodo,
  isWeekend,
  getDiaSemana,
  formatDateBR,
  getDateRange,
  getBadgesParaData,
};
