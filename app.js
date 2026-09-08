/* ═══════════════════════════════════════════
   Farmavisa — Panel de Gestión
   ═══════════════════════════════════════════ */

// ─── State ───────────────────────────────────
const DEFAULT_CATEGORIAS = ['Aseo', 'Mekatos', 'Otros'];
const STORAGE_VERSION = 4;
const STORAGE_KEY = 'farmavisa_state';
const EMPTY_MSG = 'No hay registros cargados. Empieza agregando un nuevo gasto o factura.';
const cloudClient = window.supabase?.createClient(
  window.FARMAVISA_SUPABASE_URL,
  window.FARMAVISA_SUPABASE_KEY
);
let cloudSaveTimer = null;

function getDefaultAppData() {
  return {
    banco: 0,
    cajaMayor: 0,
    cajaMenor: 0,
    ventas: 0,
    baseFija: 400000,
    excelImportVersion: 0,
    pagosInmediatosImportVersion: 0,
    fechasPagoExcelVersion: 0,
    invervisaCarteraVersion: 0,
    pagosInmediatos: [],
    pagosProgramados: [],
    proveedores: [],
    progFiltro: '30',
    pagoFiltro: '30',
    pagoFiltroConfigVersion: 0,
    bancoDisponible: 0,
    cajaDisponible: 0,
    cajaMayorDisponible: 0,
    cajaMenorDisponible: 0,
  };
}

function loadAppData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.version === STORAGE_VERSION && parsed.data) {
        return { ...getDefaultAppData(), ...parsed.data };
      }
    }
  } catch (_) { /* ignore */ }
  return getDefaultAppData();
}

function saveAppData() {
  const snapshot = {
    version: STORAGE_VERSION,
    data: {
      banco: state.banco,
      cajaMayor: state.cajaMayor,
      cajaMenor: state.cajaMenor,
      ventas: state.ventas,
      baseFija: state.baseFija,
      pagosInmediatos: state.pagosInmediatos,
      pagosProgramados: state.pagosProgramados,
      proveedores: state.proveedores,
      progFiltro: state.progFiltro,
      pagoFiltro: state.pagoFiltro,
      pagoFiltroConfigVersion: state.pagoFiltroConfigVersion,
      bancoDisponible: state.bancoDisponible,
      cajaDisponible: state.cajaDisponible,
      cajaMayorDisponible: state.cajaMayorDisponible,
      cajaMenorDisponible: state.cajaMenorDisponible,
      excelImportVersion: state.excelImportVersion,
      pagosInmediatosImportVersion: state.pagosInmediatosImportVersion,
      fechasPagoExcelVersion: state.fechasPagoExcelVersion,
      invervisaCarteraVersion: state.invervisaCarteraVersion,
    },
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  queueCloudSave(snapshot.data);
}

function queueCloudSave(data) {
  if (!cloudClient) return;
  clearTimeout(cloudSaveTimer);
  cloudSaveTimer = setTimeout(async () => {
    const { error } = await cloudClient
      .from('farmavisa_state')
      .upsert({ id: 'main', data, updated_at: new Date().toISOString() });
    if (error) console.warn('No se pudo sincronizar con Supabase:', error.message);
  }, 400);
}

async function syncCloudState() {
  if (!cloudClient) return;
  const { data: remote, error } = await cloudClient
    .from('farmavisa_state')
    .select('data')
    .eq('id', 'main')
    .maybeSingle();
  if (error) {
    console.warn('No se pudo cargar desde Supabase:', error.message);
    return;
  }
  if (remote?.data) {
    Object.assign(state, remote.data);
    ensureRecordIds(state.pagosInmediatos);
    ensureRecordIds(state.pagosProgramados);
    ensureRecordIds(state.proveedores);
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: STORAGE_VERSION, data: remote.data }));
    refreshGastosUI();
    updateInmediatosTable();
    updateDeudasTable();
    updateProgramacionPago();
    updateHistorialPagos();
  } else {
    saveAppData();
  }
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function ensureRecordIds(arr) {
  arr.forEach(item => {
    if (!item.id) item.id = generateId();
  });
}

const state = {
  categoriasInmediatas: loadCategorias(),
  ...loadAppData(),
};

if (state.pagoFiltroConfigVersion !== 1) {
  state.pagoFiltro = 'todo';
  state.pagoFiltroConfigVersion = 1;
}

if (Array.isArray(window.FARMAVISA_PAGOS_INMEDIATOS_IMPORT) && state.pagosInmediatosImportVersion !== 1) {
  const categorias = new Set(state.categoriasInmediatas.map(c => c.toLowerCase()));
  window.FARMAVISA_PAGOS_INMEDIATOS_IMPORT.forEach(item => {
    const categoria = (item.categoria || 'Otros').trim();
    if (!categorias.has(categoria.toLowerCase())) {
      state.categoriasInmediatas.push(categoria);
      categorias.add(categoria.toLowerCase());
    }
    state.pagosInmediatos.push({
      id: generateId(),
      categoria,
      factura: item.factura || '',
      concepto: item.concepto || '',
      monto: Number(item.monto) || 0,
      fecha: item.fecha,
    });
  });
  state.pagosInmediatosImportVersion = 1;
  saveCategorias();
  saveAppData();
}

if (Array.isArray(window.FARMAVISA_EXCEL_IMPORT) && state.excelImportVersion !== 3) {
  const proveedores = new Map();
  state.pagosProgramados = window.FARMAVISA_EXCEL_IMPORT.map(item => {
    const proveedorNombre = item.proveedor || 'Sin proveedor';
    if (!proveedores.has(proveedorNombre.toLowerCase())) {
      proveedores.set(proveedorNombre.toLowerCase(), {
        id: generateId(),
        nombre: proveedorNombre,
        nit: '',
        contacto: '',
      });
    }
    const proveedor = proveedores.get(proveedorNombre.toLowerCase());
    const pagada = Boolean(item.pagada);
    const monto = Number(item.monto) || 0;
    const esEfectivo = (item.pagadoCon || '').toLowerCase().includes('efectivo');
    return {
      id: generateId(),
      proveedorId: proveedor.id,
      proveedor: proveedorNombre,
      concepto: item.concepto || '',
      factura: item.factura || '',
      vencimiento: item.vencimiento || formatDateISO(new Date()),
      monto,
      pagada,
      fechaPago: pagada ? item.fechaPago : null,
      pagos: pagada ? [{
        id: generateId(),
        fecha: item.fechaPago,
        monto,
        banco: esEfectivo ? 0 : monto,
        cajaMayor: esEfectivo ? monto : 0,
        cajaMenor: 0,
      }] : [],
      pagadoCon: item.pagadoCon || '',
      observacion: item.observacion || '',
    };
  });
  state.proveedores = Array.from(proveedores.values());
  state.excelImportVersion = 3;
  saveAppData();
}

ensureRecordIds(state.pagosInmediatos);
ensureRecordIds(state.pagosProgramados);
if (!state.proveedores) state.proveedores = [];
ensureRecordIds(state.proveedores);
migratePagosProveedores();

const INVERVISA_CARTERA = [
  ['22952', '2026-06-01', '2026-07-01', 605200],
  ['23062', '2026-06-04', '2026-07-04', 1277850],
  ['23147', '2026-06-05', '2026-07-05', 645650],
  ['23173', '2026-06-06', '2026-07-06', 367500],
  ['23218', '2026-06-09', '2026-07-09', 796850],
  ['23221', '2026-06-09', '2026-07-09', 124200],
  ['23362', '2026-06-12', '2026-07-12', 1415800],
  ['23363', '2026-06-12', '2026-07-12', 380121],
  ['23474', '2026-06-16', '2026-07-16', 1616900],
  ['23624', '2026-06-20', '2026-07-20', 1455850],
  ['23698', '2026-06-23', '2026-07-23', 906900],
  ['23772', '2026-06-25', '2026-07-25', 1289838],
  ['23891', '2026-06-27', '2026-07-27', 958920],
  ['23932', '2026-06-30', '2026-07-30', 533600],
  ['24026', '2026-07-02', '2026-08-01', 292200],
  ['24015', '2026-07-02', '2026-08-01', 1081600],
  ['24078', '2026-07-03', '2026-08-02', 2016450],
  ['24109', '2026-07-04', '2026-08-03', 735300],
  ['24154', '2026-07-06', '2026-08-05', 549750],
  ['24303', '2026-07-09', '2026-08-08', 768026],
  ['24347', '2026-07-10', '2026-08-09', 838350],
  ['24386', '2026-07-11', '2026-08-10', 462700],
  ['24404', '2026-07-14', '2026-08-13', 909830],
  ['24495', '2026-07-17', '2026-08-16', 1685630],
  ['24565', '2026-07-18', '2026-08-17', 618160],
  ['24706', '2026-07-23', '2026-08-22', 828060],
  ['24762', '2026-07-25', '2026-08-24', 559500],
  ['24789', '2026-07-27', '2026-08-26', 998370],
  ['24820', '2026-07-28', '2026-08-27', 631000],
  ['24889', '2026-07-29', '2026-08-28', 331300],
  ['24876', '2026-07-29', '2026-08-28', 619650],
  ['25000', '2026-08-01', '2026-08-31', 1115990],
  ['25016', '2026-08-03', '2026-09-02', 578800],
  ['25065', '2026-08-04', '2026-09-03', 1170200],
  ['25199', '2026-08-08', '2026-09-07', 891300],
  ['25211', '2026-08-10', '2026-09-09', 1136490],
  ['25304', '2026-08-12', '2026-09-11', 1241580],
  ['25435', '2026-08-15', '2026-09-14', 912781],
  ['25469', '2026-08-18', '2026-09-17', 1501460],
  ['25601', '2026-08-21', '2026-09-20', 1009580],
];

if (state.invervisaCarteraVersion !== 1) {
  const invervisa = state.proveedores.find(p => p.nombre.toLowerCase() === 'invervisa');
  if (invervisa) {
    invervisa.nit = '901.563.246-9';
    const byNumber = new Map(INVERVISA_CARTERA.map(item => [item[0], item]));
    const existingNumbers = new Set();
    state.pagosProgramados
      .filter(p => p.proveedorId === invervisa.id)
      .forEach(p => {
        const number = (p.factura || '').replace(/\D/g, '');
        const cartera = byNumber.get(number);
        if (cartera) {
          existingNumbers.add(number);
          p.factura = `FV-1-${cartera[0]}`;
          p.concepto = 'Insumos';
          p.vencimiento = cartera[2];
          p.monto = cartera[3];
          p.pagada = false;
          p.fechaPago = null;
          p.pagos = [];
        } else if (!(p.concepto || '').toLowerCase().includes('licor')) {
          p.pagada = true;
          p.fechaPago = '2026-08-22';
          p.pagos = [{ id: generateId(), fecha: p.fechaPago, monto: p.monto, banco: p.monto, cajaMayor: 0, cajaMenor: 0 }];
          p.observacion = 'Conciliada con estado de cartera Invervisa del 22/08/2026';
        }
      });
    INVERVISA_CARTERA.forEach(([number, fecha, vencimiento, monto]) => {
      if (existingNumbers.has(number)) return;
      state.pagosProgramados.push({
        id: generateId(),
        proveedorId: invervisa.id,
        proveedor: 'Invervisa',
        concepto: 'Insumos',
        factura: `FV-1-${number}`,
        vencimiento,
        monto,
        pagada: false,
        fechaPago: null,
        pagos: [],
        pagadoCon: '',
        observacion: '',
      });
    });
  }
  state.invervisaCarteraVersion = 1;
  saveAppData();
}

if (Array.isArray(window.FARMAVISA_EXCEL_IMPORT) && state.fechasPagoExcelVersion !== 2) {
  const sourceByKey = new Map();
  window.FARMAVISA_EXCEL_IMPORT.forEach(item => {
    const key = [item.proveedor, item.concepto, item.factura, item.vencimiento, item.monto]
      .map(value => String(value || '').trim().toLowerCase()).join('|');
    if (!sourceByKey.has(key)) sourceByKey.set(key, []);
    sourceByKey.get(key).push(item);
  });

  state.pagosProgramados.forEach(record => {
    const key = [record.proveedor, record.concepto, record.factura, record.vencimiento, record.monto]
      .map(value => String(value || '').trim().toLowerCase()).join('|');
    const source = sourceByKey.get(key)?.shift();
    if (!source) return;
    if (!source.pagada || !source.fechaPago) {
      record.pagada = false;
      record.fechaPago = null;
      record.pagos = [];
      return;
    }
    record.pagada = true;
    record.fechaPago = source.fechaPago;
    record.pagos = [{
      id: record.pagos?.[0]?.id || generateId(),
      fecha: source.fechaPago,
      monto: record.monto,
      banco: (source.pagadoCon || '').toLowerCase().includes('efectivo') ? 0 : record.monto,
      cajaMayor: (source.pagadoCon || '').toLowerCase().includes('efectivo') ? record.monto : 0,
      cajaMenor: 0,
    }];
  });
  state.fechasPagoExcelVersion = 2;
  saveAppData();
}

let selectedProveedorId = null;
const selectedFacturaIds = new Set();

const DENOMINACIONES = [
  { label: '$100.000', value: 100000 },
  { label: '$50.000', value: 50000 },
  { label: '$20.000', value: 20000 },
  { label: '$10.000', value: 10000 },
  { label: '$5.000', value: 5000 },
  { label: '$2.000', value: 2000 },
  { label: '$1.000', value: 1000 },
  { label: '$500', value: 500 },
  { label: '$200', value: 200 },
  { label: '$100', value: 100 },
];

const PROG_FILTRO_LABELS = {
  '15': 'Próximos 15 días',
  '30': 'Próximos 30 días',
  mes: 'Mes actual',
  custom: 'Rango personalizado',
};

// ─── Utilities ───────────────────────────────
function loadCategorias() {
  try {
    const saved = localStorage.getItem('farmavisa_categorias');
    if (saved) return JSON.parse(saved);
  } catch (_) { /* ignore */ }
  return [...DEFAULT_CATEGORIAS];
}

function saveCategorias() {
  localStorage.setItem('farmavisa_categorias', JSON.stringify(state.categoriasInmediatas));
}

function formatMoney(n) {
  return '$' + Math.round(n).toLocaleString('es-CO');
}

function formatPaymentSources(payment) {
  const sources = [
    ['Banco', payment.banco],
    ['Caja', payment.caja ?? ((payment.cajaMayor || 0) + (payment.cajaMenor || 0))],
  ].filter(([, amount]) => amount > 0);
  return sources.length ? sources.map(([name, amount]) => `${name}: ${formatMoney(amount)}`).join(' · ') : '—';
}

function showToast(msg) {
  const toast = document.getElementById('toast');
  document.getElementById('toast-msg').textContent = msg;
  toast.classList.remove('translate-y-20', 'opacity-0');
  setTimeout(() => toast.classList.add('translate-y-20', 'opacity-0'), 2500);
}

function emptyTableRow(colspan, message = EMPTY_MSG) {
  return `<tr><td colspan="${colspan}" class="px-6 py-12 text-center">
    <div class="flex flex-col items-center gap-3 text-gray-400">
      <i class="fas fa-inbox text-4xl text-gray-300"></i>
      <p class="text-sm max-w-xs">${message}</p>
    </div>
  </td></tr>`;
}

function actionButtons(type, id) {
  return `<td class="px-4 py-3 text-center">
    <div class="flex items-center justify-center gap-1">
      <button type="button" class="btn-edit-gasto p-2 rounded-lg hover:bg-blue-50 text-corporate transition-colors" title="Editar" data-type="${type}" data-id="${id}">
        <i class="fas fa-pen text-sm"></i>
      </button>
      <button type="button" class="btn-delete-gasto p-2 rounded-lg hover:bg-red-50 text-red-500 transition-colors" title="Eliminar" data-type="${type}" data-id="${id}">
        <i class="fas fa-trash-alt text-sm"></i>
      </button>
    </div>
  </td>`;
}

function markPaidButton(id) {
  return `<button type="button" class="btn-marcar-pagada px-2.5 py-1.5 rounded-lg bg-green-100 text-green-700 hover:bg-green-600 hover:text-white text-xs font-medium transition-colors" data-id="${id}" title="Marcar factura como cancelada">
    <i class="fas fa-check mr-1"></i> Cancelar factura
  </button>`;
}

function reversePaidButton(id) {
  return `<button type="button" class="btn-revertir-pagada px-2.5 py-1.5 rounded-lg bg-amber-100 text-amber-700 hover:bg-amber-600 hover:text-white text-xs font-medium transition-colors" data-id="${id}" title="Revertir cancelación">
    <i class="fas fa-undo mr-1"></i> Revertir cancelación
  </button>`;
}

function removeScheduledPaymentButton(id) {
  return `<button type="button" class="btn-retirar-programacion px-2.5 py-1.5 rounded-lg bg-gray-100 text-gray-600 hover:bg-red-500 hover:text-white text-xs font-medium transition-colors" data-id="${id}" title="Retirar factura de la programación">
    <i class="fas fa-minus-circle mr-1"></i> Retirar
  </button>`;
}

function formatDisplayDate(dateStr) {
  if (!dateStr) return '—';
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    const [y, m, d] = dateStr.split('-');
    return `${d}/${m}/${y}`;
  }
  return dateStr;
}

function refreshGastosUI() {
  saveAppData();
  renderProveedoresDatalist();
  renderProveedorFilterSelects();
  renderEditProveedoresSelect();
  updateInmediatosTable();
  updateProgramadosTable();
  updateHistorialPagos();
  updateDeudasTable();
  if (selectedProveedorId) updateProveedorDetalle(selectedProveedorId);
  updateDashboard();
}

function todayStr() {
  return new Date().toLocaleDateString('es-CO', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

function daysUntil(dateStr) {
  const diff = new Date(dateStr + 'T00:00:00') - new Date();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function parseDate(dateStr) {
  return new Date(dateStr + 'T00:00:00');
}

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function formatDateISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getPresetProgRange(filtro) {
  const now = startOfDay(new Date());
  const year = now.getFullYear();

  if (filtro === '15') {
    const end = new Date(now);
    end.setDate(end.getDate() + 15);
    return { start: now, end, label: PROG_FILTRO_LABELS['15'] };
  }
  if (filtro === '30') {
    const end = new Date(now);
    end.setDate(end.getDate() + 30);
    return { start: now, end, label: PROG_FILTRO_LABELS['30'] };
  }
  if (filtro === 'mes') {
    const start = new Date(year, now.getMonth(), 1);
    const end = new Date(year, now.getMonth() + 1, 0);
    return { start, end, label: PROG_FILTRO_LABELS.mes };
  }
  return getPresetProgRange('30');
}

function syncProgDateInputs(start, end) {
  document.getElementById('prog-fecha-inicio').value = formatDateISO(start);
  document.getElementById('prog-fecha-fin').value = formatDateISO(end);
}

function clearProgQuickButtons() {
  document.querySelectorAll('.prog-filtro-btn').forEach(b => {
    b.classList.remove('active', 'bg-corporate', 'text-white', 'border-corporate');
    b.classList.add('border-gray-200', 'bg-white');
  });
}

function activateProgQuickButton(filtro) {
  clearProgQuickButtons();
  const btn = document.querySelector(`.prog-filtro-btn[data-filtro="${filtro}"]`);
  if (btn) {
    btn.classList.add('active', 'bg-corporate', 'text-white', 'border-corporate');
    btn.classList.remove('border-gray-200', 'bg-white');
  }
}

function getActiveProgRange() {
  if (state.progFiltro !== 'custom') {
    return getPresetProgRange(state.progFiltro);
  }

  const inicioVal = document.getElementById('prog-fecha-inicio').value;
  const finVal = document.getElementById('prog-fecha-fin').value;

  if (!inicioVal || !finVal) {
    return { start: null, end: null, label: 'Seleccione fecha inicio y fecha fin', invalid: true };
  }

  const start = parseDate(inicioVal);
  const end = parseDate(finVal);

  if (start > end) {
    return { start, end, label: 'La fecha inicio no puede ser posterior a la fecha fin', invalid: true };
  }

  return {
    start,
    end,
    label: `Del ${inicioVal} al ${finVal}`,
  };
}

function getPresetPagoRange(filtro) {
  const now = startOfDay(new Date());
  if (filtro === 'todo') {
    return { start: null, end: null, label: 'Todo el historial' };
  }
  if (filtro === 'mes') {
    return { start: new Date(now.getFullYear(), now.getMonth(), 1), end: now, label: 'Mes actual' };
  }
  if (filtro === 'anio') {
    return { start: new Date(now.getFullYear(), 0, 1), end: now, label: 'Año actual' };
  }
  const start = new Date(now);
  start.setDate(start.getDate() - 29);
  return { start, end: now, label: 'Últimos 30 días' };
}

function getActivePagoRange() {
  if (state.pagoFiltro !== 'custom') return getPresetPagoRange(state.pagoFiltro);
  const inicioVal = document.getElementById('pago-fecha-inicio').value;
  const finVal = document.getElementById('pago-fecha-fin').value;
  if (!inicioVal || !finVal) return { invalid: true, label: 'Seleccione fecha inicio y fecha fin' };
  const start = parseDate(inicioVal);
  const end = parseDate(finVal);
  if (start > end) return { invalid: true, label: 'La fecha inicio no puede ser posterior a la fecha fin' };
  return { start, end, label: `Del ${inicioVal} al ${finVal}` };
}

function getActiveDeudaRange() {
  const inicioVal = document.getElementById('deuda-fecha-inicio').value;
  const finVal = document.getElementById('deuda-fecha-fin').value;
  const start = inicioVal ? parseDate(inicioVal) : null;
  const end = finVal ? parseDate(finVal) : null;
  if (start && end && start > end) {
    return { start, end, label: 'La fecha inicio no puede ser posterior a la fecha fin', invalid: true };
  }
  return {
    start,
    end,
    label: inicioVal && finVal
      ? `Del ${inicioVal} al ${finVal}`
      : inicioVal
        ? `Desde ${inicioVal}`
        : finVal
          ? `Hasta ${finVal}`
          : 'Todas las fechas',
  };
}

function syncPagoDateInputs(start, end) {
  document.getElementById('pago-fecha-inicio').value = start ? formatDateISO(start) : '';
  document.getElementById('pago-fecha-fin').value = end ? formatDateISO(end) : '';
}

function clearPagoQuickButtons() {
  document.querySelectorAll('.pago-filtro-btn').forEach(b => {
    b.classList.remove('active', 'bg-corporate', 'text-white', 'border-corporate');
    b.classList.add('border-gray-200', 'bg-white');
  });
}

function activatePagoQuickButton(filtro) {
  clearPagoQuickButtons();
  const btn = document.querySelector(`.pago-filtro-btn[data-filtro="${filtro}"]`);
  if (btn) {
    btn.classList.add('active', 'bg-corporate', 'text-white', 'border-corporate');
    btn.classList.remove('border-gray-200', 'bg-white');
  }
}

// Alias usado por el dashboard (siempre próximos 30 días)
function getProgFilterRange(filtro) {
  return getPresetProgRange(filtro);
}

function getStatusBadge(vencimiento, pagada = false) {
  if (pagada) return { badge: 'Pagada', badgeClass: 'bg-green-100 text-green-600' };
  const days = daysUntil(vencimiento);
  if (days < 0) return { badge: 'Vencida', badgeClass: 'bg-red-100 text-red-600' };
  if (days <= 3) return { badge: 'Urgente', badgeClass: 'bg-red-100 text-red-600' };
  if (days <= 7) return { badge: 'Próximo', badgeClass: 'bg-amber-100 text-amber-600' };
  return { badge: 'Pendiente', badgeClass: 'bg-blue-100 text-blue-600' };
}

function getFacturaEstado(p) {
  if (p.pagada) {
    return { badge: 'Pagada', badgeClass: 'bg-green-100 text-green-600', label: 'Pagada' };
  }
  const days = daysUntil(p.vencimiento);
  if (days < 0) {
    return { badge: 'Vencida', badgeClass: 'bg-red-100 text-red-600', label: 'Vencida' };
  }
  return {
    badge: `Por Vencer (${days} días)`,
    badgeClass: 'bg-amber-100 text-amber-600',
    label: `Por Vencer (${days} días)`,
  };
}

// ─── Proveedores ─────────────────────────────
function getProveedorById(id) {
  return state.proveedores.find(p => p.id === id);
}

function findOrCreateProveedor(nombre, nit = '', contacto = '') {
  const n = nombre.trim();
  if (!n) return null;
  const existing = state.proveedores.find(
    p => p.nombre.toLowerCase() === n.toLowerCase()
  );
  if (existing) return existing.id;
  const id = generateId();
  state.proveedores.push({ id, nombre: n, nit: nit.trim(), contacto: contacto.trim() });
  saveAppData();
  return id;
}

function migratePagosProveedores() {
  state.pagosProgramados.forEach(p => {
    if (p.pagada === undefined) p.pagada = false;
    if (p.pagada && !p.fechaPago) p.fechaPago = p.vencimiento || formatDateISO(new Date());
    if (!Array.isArray(p.pagos)) {
      p.pagos = p.pagada ? [{ id: generateId(), fecha: p.fechaPago, banco: p.monto, cajaMayor: 0, cajaMenor: 0 }] : [];
    }
    if (!p.proveedorId && p.proveedor) {
      p.proveedorId = findOrCreateProveedor(p.proveedor);
    }
  });
}

function renderProveedoresDatalist() {
  const editDatalist = document.getElementById('edit-proveedores-datalist');
  const immediateDatalist = document.getElementById('inm-proveedores-datalist');
  const options = state.proveedores
    .map(p => `<option value="${p.nombre}">${p.nit ? 'NIT: ' + p.nit : ''}</option>`)
    .join('');
  if (editDatalist) editDatalist.innerHTML = options;
  if (immediateDatalist) immediateDatalist.innerHTML = options;
  renderProveedoresFormSelect();
}

function renderProveedorFilterSelects() {
  const proveedoresOrdenados = [...state.proveedores].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }));
  const pagoBusqueda = document.getElementById('pago-proveedor-busqueda');
  const pagoDatalist = document.getElementById('pago-proveedores-datalist');
  const immediateFilterDatalist = document.getElementById('inm-filtro-proveedores-datalist');
  const deudaDatalist = document.getElementById('deuda-proveedores-datalist');
  const options = proveedoresOrdenados.map(p => `<option value="${p.nombre}"></option>`).join('');
  if (pagoDatalist) {
    pagoDatalist.innerHTML = options
      + '<option value="Pagos inmediatos"></option>';
  }
  if (immediateFilterDatalist) {
    immediateFilterDatalist.innerHTML = options + '<option value="Pagos inmediatos"></option>';
  }
  if (deudaDatalist) deudaDatalist.innerHTML = options;
  if (pagoBusqueda) {
    pagoBusqueda.value = pagoBusqueda.value || '';
  }
  document.querySelectorAll('.proveedor-filtro').forEach(select => {
    const current = select.value;
    select.innerHTML = '<option value="">Todos los proveedores</option>' + proveedoresOrdenados
      .map(p => `<option value="${p.id}">${p.nombre}</option>`)
      .join('') + (select.id === 'pago-proveedor-filtro' ? '<option value="__inmediatos__">Pagos inmediatos</option>' : '');
    if (state.proveedores.some(p => p.id === current) || (select.id === 'pago-proveedor-filtro' && current === '__inmediatos__')) select.value = current;
  });
}

function getProviderFilterId(inputId, includeImmediate = false) {
  const value = document.getElementById(inputId)?.value.trim().toLowerCase();
  if (!value) return '';
  if (includeImmediate && value === 'pagos inmediatos') return '__inmediatos__';
  return state.proveedores.find(p => p.nombre.trim().toLowerCase() === value)?.id || '';
}

function renderProveedoresFormSelect() {
  const select = document.getElementById('prog-proveedor-select');
  if (!select) return;
  const current = select.value;
  select.innerHTML = '<option value="">Seleccionar proveedor...</option>' +
    state.proveedores.map(p => `<option value="${p.id}">${p.nombre}</option>`).join('') +
    '<option value="__new__">+ Nuevo proveedor</option>';
  if (current && [...select.options].some(o => o.value === current)) {
    select.value = current;
  }
  toggleProgProveedorNew();
}

function toggleProgProveedorNew() {
  const select = document.getElementById('prog-proveedor-select');
  const newInput = document.getElementById('prog-proveedor-new');
  if (!select || !newInput) return;
  const isNew = select.value === '__new__';
  newInput.classList.toggle('hidden', !isNew);
  if (isNew) newInput.focus();
}

function getProgProveedorNombre() {
  const select = document.getElementById('prog-proveedor-select');
  if (select.value === '__new__') {
    return document.getElementById('prog-proveedor-new').value.trim();
  }
  if (!select.value) return '';
  const prov = getProveedorById(select.value);
  return prov ? prov.nombre : '';
}

function resetProgProveedorForm() {
  const select = document.getElementById('prog-proveedor-select');
  if (select) select.value = '';
  const newInput = document.getElementById('prog-proveedor-new');
  if (newInput) {
    newInput.value = '';
    newInput.classList.add('hidden');
  }
}

function renderEditProveedoresSelect() {
  const select = document.getElementById('edit-prog-proveedor-select');
  if (!select) return;
  select.innerHTML = state.proveedores
    .map(p => `<option value="${p.id}">${p.nombre}</option>`)
    .join('');
}

function getPagosByProveedor(proveedorId) {
  return state.pagosProgramados.filter(p => p.proveedorId === proveedorId);
}

function getDeudasPorProveedor({ proveedorId = '', start = null, end = null, facturaSearch = '' } = {}) {
  const map = new Map();
  state.pagosProgramados.forEach(p => {
    if (p.pagada) return;
    if (proveedorId && p.proveedorId !== proveedorId) return;
    if (facturaSearch && !(p.factura || '').toLowerCase().includes(facturaSearch)) return;
    const vencimiento = parseDate(p.vencimiento);
    if (start && vencimiento < start) return;
    if (end && vencimiento > end) return;
    const provId = p.proveedorId;
    if (!provId) return;
    const prov = getProveedorById(provId);
    if (!map.has(provId)) {
      map.set(provId, {
        proveedorId: provId,
        nombre: prov?.nombre || p.proveedor || 'Sin nombre',
        count: 0,
        total: 0,
        hasVencida: false,
        hasPorVencer: false,
      });
    }
    const entry = map.get(provId);
    entry.count += 1;
    entry.total += p.monto;
    const days = daysUntil(p.vencimiento);
    if (days < 0) entry.hasVencida = true;
    else entry.hasPorVencer = true;
  });
  return Array.from(map.values()).sort((a, b) => b.total - a.total);
}

function getProveedorDebtBadge(entry) {
  if (entry.hasVencida) {
    return { badge: 'Con facturas vencidas', badgeClass: 'bg-red-100 text-red-600' };
  }
  if (entry.hasPorVencer) {
    return { badge: 'Por vencer', badgeClass: 'bg-amber-100 text-amber-600' };
  }
  return { badge: 'Pendiente', badgeClass: 'bg-blue-100 text-blue-600' };
}

function switchGastosTab(tab) {
  document.querySelectorAll('.gastos-tab-btn').forEach(btn => {
    const active = btn.dataset.gastosTab === tab;
    btn.classList.toggle('active', active);
    btn.classList.toggle('bg-corporate', active);
    btn.classList.toggle('text-white', active);
    btn.classList.toggle('border-corporate', active);
    btn.classList.toggle('border-gray-200', !active);
    btn.classList.toggle('text-gray-600', !active);
  });
  document.getElementById('panel-historial').classList.toggle('hidden', tab !== 'historial');
  document.getElementById('panel-deudas').classList.toggle('hidden', tab !== 'deudas');
  if (tab === 'deudas') updateDeudasTable();
  if (tab === 'historial') updateHistorialPagos();
}

// ─── Navigation ──────────────────────────────
const MODULE_TITLES = {
  dashboard: 'Dashboard General',
  cierre: 'Cierre de Turno',
  registro: 'Registro de Gastos',
  deudas: 'Control de Deudas',
  calculadora: 'Calculadora Precio & Comisiones',
};

function switchModule(name) {
  document.querySelectorAll('.module').forEach(m => m.classList.remove('active'));
  document.querySelectorAll('.sidebar-link').forEach(l => l.classList.remove('active'));
  document.getElementById('module-' + name).classList.add('active');
  document.querySelector(`[data-module="${name}"]`).classList.add('active');
  document.getElementById('pageTitle').textContent = MODULE_TITLES[name];
  if (window.innerWidth < 1024) closeSidebar();
}

document.querySelectorAll('.sidebar-link').forEach(link => {
  link.addEventListener('click', e => {
    e.preventDefault();
    switchModule(link.dataset.module);
  });
});

// Mobile sidebar
const sidebar = document.getElementById('sidebar');
const overlay = document.getElementById('overlay');
document.getElementById('menuBtn').addEventListener('click', () => {
  sidebar.classList.toggle('-translate-x-full');
  overlay.classList.toggle('hidden');
});
overlay.addEventListener('click', closeSidebar);
function closeSidebar() {
  sidebar.classList.add('-translate-x-full');
  overlay.classList.add('hidden');
}

// ─── Dashboard ───────────────────────────────
function updateDashboard() {
  const totalInmediatos = state.pagosInmediatos.reduce((s, p) => s + p.monto, 0);
  const totalProgramados = state.pagosProgramados
    .filter(p => !p.pagada)
    .reduce((s, p) => s + p.monto, 0);
  const totalEgresos = totalInmediatos + totalProgramados;
  const liquidez = state.banco + state.cajaMayor;

  document.getElementById('dash-liquidez').textContent = formatMoney(liquidez);
  document.getElementById('dash-banco').textContent = formatMoney(state.banco);
  document.getElementById('dash-caja').textContent = formatMoney(state.cajaMayor);
  document.getElementById('dash-ventas').textContent = formatMoney(state.ventas);
  document.getElementById('dash-egresos').textContent = formatMoney(totalEgresos);
  document.getElementById('dash-inmediatos').textContent = formatMoney(totalInmediatos);
  document.getElementById('dash-programados').textContent = formatMoney(totalProgramados);

  const { start, end } = getProgFilterRange('30');
  const aVencer = state.pagosProgramados.filter(p => {
    if (p.pagada) return false;
    const d = parseDate(p.vencimiento);
    return d >= start && d <= end;
  });
  const totalCxP = aVencer.reduce((s, p) => s + p.monto, 0);

  document.getElementById('dash-cxp').textContent = formatMoney(totalCxP);
  document.getElementById('dash-vencer-badge').textContent = aVencer.length + ' a vencer';

  const tbody = document.getElementById('cxp-table-body');
  tbody.innerHTML = '';
  if (aVencer.length === 0) {
    tbody.innerHTML = emptyTableRow(6);
    return;
  }
  aVencer.sort((a, b) => parseDate(a.vencimiento) - parseDate(b.vencimiento));
  aVencer.forEach(p => {
    const { badge, badgeClass } = getStatusBadge(p.vencimiento, p.pagada);
    tbody.innerHTML += `
      <tr class="hover:bg-gray-50">
        <td class="px-6 py-3 text-gray-500 font-mono text-xs">${p.factura || '—'}</td>
        <td class="px-6 py-3 font-medium text-gray-800">${p.proveedor}</td>
        <td class="px-6 py-3 text-gray-500">${p.concepto}</td>
        <td class="px-6 py-3 text-gray-500">${p.vencimiento}</td>
        <td class="px-6 py-3 text-right font-semibold">${formatMoney(p.monto)}</td>
        <td class="px-6 py-3 text-center"><span class="text-xs font-medium px-2 py-1 rounded-full ${badgeClass}">${badge}</span></td>
      </tr>`;
  });
}

// ─── Cierre de Turno ─────────────────────────
function buildDenominaciones() {
  const container = document.getElementById('denominaciones');
  DENOMINACIONES.forEach(d => {
    container.innerHTML += `
      <div class="denom-item">
        <label class="text-xs text-gray-500 block mb-1">${d.label}</label>
        <input type="number" data-value="${d.value}" value="0" min="0"
          class="denom-input w-full px-3 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-corporate/30 focus:border-corporate outline-none text-center font-semibold" />
        <p class="text-xs text-gray-400 mt-1 text-center denom-subtotal">$0</p>
      </div>`;
  });
  container.querySelectorAll('.denom-input').forEach(input => {
    input.addEventListener('input', calcCierre);
  });
}

function calcCierre() {
  let total = 0;
  document.querySelectorAll('.denom-input').forEach(input => {
    const qty = parseInt(input.value) || 0;
    const val = parseInt(input.dataset.value);
    const sub = qty * val;
    total += sub;
    input.parentElement.querySelector('.denom-subtotal').textContent = formatMoney(sub);
  });

  const baseFija = parseFloat(document.getElementById('cierre-base').value) || 0;
  const efectivo = total - baseFija;
  const mInv = parseFloat(document.getElementById('cierre-m-inv').value) || 0;
  const diferencia = efectivo - mInv;

  document.getElementById('cierre-total').textContent = formatMoney(total);
  document.getElementById('cierre-efectivo').textContent = formatMoney(efectivo);
  document.getElementById('cierre-diferencia').textContent = formatMoney(diferencia);

  const box = document.getElementById('cierre-diferencia-box');
  const label = document.getElementById('cierre-diferencia-label');
  const diffEl = document.getElementById('cierre-diferencia');

  if (diferencia > 0) {
    box.className = 'mt-6 p-4 rounded-xl text-center bg-green-50 border border-green-200';
    diffEl.className = 'text-3xl font-bold text-success';
    label.textContent = 'SOBRANTE';
    label.className = 'text-xs mt-1 text-success font-semibold';
  } else if (diferencia < 0) {
    box.className = 'mt-6 p-4 rounded-xl text-center bg-red-50 border border-red-200';
    diffEl.className = 'text-3xl font-bold text-red-500';
    label.textContent = 'FALTANTE';
    label.className = 'text-xs mt-1 text-red-500 font-semibold';
  } else {
    box.className = 'mt-6 p-4 rounded-xl text-center bg-gray-50 border border-gray-200';
    diffEl.className = 'text-3xl font-bold text-gray-600';
    label.textContent = 'CUADRADO';
    label.className = 'text-xs mt-1 text-gray-500 font-semibold';
  }
}

document.getElementById('cierre-m-inv').addEventListener('input', calcCierre);
document.getElementById('cierre-base').addEventListener('input', e => {
  state.baseFija = parseFloat(e.target.value) || 0;
  calcCierre();
  saveAppData();
});

// ─── Registro de Gastos ──────────────────────
function renderCategoriasSelect() {
  const select = document.getElementById('inm-categoria');
  const filter = document.getElementById('inm-filtro-categoria');
  const current = select.value;
  select.innerHTML = state.categoriasInmediatas
    .map(c => `<option value="${c}">${c}</option>`)
    .join('');
  if (state.categoriasInmediatas.includes(current)) {
    select.value = current;
  }
  if (filter) {
    const filterCurrent = filter.value;
    filter.innerHTML = '<option value="">Seleccione una categoría</option>' + state.categoriasInmediatas
      .map(c => `<option value="${c}">${c}</option>`)
      .join('');
    if (state.categoriasInmediatas.includes(filterCurrent)) filter.value = filterCurrent;
  }
}

function renderEditCategoriasSelect() {
  const select = document.getElementById('edit-inm-categoria');
  select.innerHTML = state.categoriasInmediatas
    .map(c => `<option value="${c}">${c}</option>`)
    .join('');
}

document.getElementById('btn-nueva-categoria').addEventListener('click', () => {
  const box = document.getElementById('nueva-categoria-box');
  box.classList.toggle('hidden');
  if (!box.classList.contains('hidden')) {
    document.getElementById('inm-nueva-categoria').focus();
  }
});

document.getElementById('btn-guardar-categoria').addEventListener('click', () => {
  const input = document.getElementById('inm-nueva-categoria');
  const nombre = input.value.trim();
  if (!nombre) {
    showToast('Ingrese un nombre para la categoría');
    return;
  }
  if (state.categoriasInmediatas.includes(nombre)) {
    showToast('La categoría ya existe');
    return;
  }
  state.categoriasInmediatas.push(nombre);
  saveCategorias();
  renderCategoriasSelect();
  document.getElementById('inm-categoria').value = nombre;
  input.value = '';
  document.getElementById('nueva-categoria-box').classList.add('hidden');
  showToast('Categoría "' + nombre + '" creada');
});

['inm-filtro-proveedor', 'inm-filtro-categoria', 'inm-filtro-fecha-inicio', 'inm-filtro-fecha-fin']
  .forEach(id => document.getElementById(id)?.addEventListener('input', updateInmediatosTable));
document.getElementById('inm-filtro-categoria')?.addEventListener('change', updateInmediatosTable);

function updateInmediatosTable() {
  const tbody = document.getElementById('inm-table-body');
  const proveedorInput = document.getElementById('inm-filtro-proveedor')?.value.trim();
  const proveedorId = proveedorInput ? getProviderFilterId('inm-filtro-proveedor', true) : '';
  const categoria = document.getElementById('inm-filtro-categoria')?.value || '';
  const inicio = document.getElementById('inm-filtro-fecha-inicio')?.value || '';
  const fin = document.getElementById('inm-filtro-fecha-fin')?.value || '';
  const hasFilter = Boolean(proveedorInput || categoria || inicio || fin);
  const filtered = hasFilter ? state.pagosInmediatos.filter(p => {
    if (proveedorInput && !proveedorId) return false;
    if (proveedorId === '__inmediatos__' && p.proveedorId) return false;
    if (proveedorId && proveedorId !== '__inmediatos__' && p.proveedorId !== proveedorId) return false;
    if (categoria && p.categoria !== categoria) return false;
    if (inicio && p.fecha < inicio) return false;
    if (fin && p.fecha > fin) return false;
    return true;
  }) : [];
  const total = filtered.reduce((s, p) => s + p.monto, 0);
  document.getElementById('inm-total').textContent = formatMoney(total);
  tbody.innerHTML = '';

  if (!hasFilter) {
    tbody.innerHTML = emptyTableRow(6, 'Aplique un filtro para consultar los pagos inmediatos');
    return;
  }

  if (filtered.length === 0) {
    tbody.innerHTML = emptyTableRow(6, 'No hay pagos inmediatos con estos filtros');
    return;
  }

  filtered.slice().reverse().forEach(p => {
    tbody.innerHTML += `
      <tr class="hover:bg-gray-50">
        <td class="px-6 py-3"><span class="text-xs font-medium px-2 py-1 rounded-full bg-amber-100 text-amber-600">${p.categoria}</span></td>
        <td class="px-6 py-3 text-gray-500 font-mono text-xs">${p.factura || '—'}</td>
        <td class="px-6 py-3 text-gray-700">${p.concepto || '—'}</td>
        <td class="px-6 py-3 text-gray-500">${formatDisplayDate(p.fecha)}</td>
        <td class="px-6 py-3 text-right font-semibold text-red-500">${formatMoney(p.monto)}</td>
        ${actionButtons('inmediato', p.id)}
      </tr>`;
  });
}

function updateProgramadosTable() {
  let range;

  if (state.progFiltro !== 'custom') {
    range = getPresetProgRange(state.progFiltro);
    syncProgDateInputs(range.start, range.end);
  } else {
    range = getActiveProgRange();
  }

  document.getElementById('prog-filtro-label').textContent = range.label;

  if (range.invalid) {
    document.getElementById('prog-count').textContent = '0';
    document.getElementById('prog-total').textContent = formatMoney(0);
    document.getElementById('prog-total-card').textContent = formatMoney(0);
    document.getElementById('prog-table-body').innerHTML = emptyTableRow(
      7,
      range.label.includes('inicio') || range.label.includes('posterior') ? range.label : 'Ajuste el rango de fechas'
    );
    return;
  }

  const filtered = state.pagosProgramados.filter(p => {
    if (p.pagada) return false;
    const proveedorId = document.getElementById('prog-proveedor-filtro').value;
    if (proveedorId && p.proveedorId !== proveedorId) return false;
    const d = parseDate(p.vencimiento);
    return (!range.start || d >= range.start) && (!range.end || d <= range.end);
  });
  filtered.sort((a, b) => parseDate(a.vencimiento) - parseDate(b.vencimiento));

  const total = filtered.reduce((s, p) => s + p.monto, 0);
  document.getElementById('prog-count').textContent = filtered.length;
  document.getElementById('prog-total').textContent = formatMoney(total);
  document.getElementById('prog-total-card').textContent = formatMoney(total);

  const tbody = document.getElementById('prog-table-body');
  tbody.innerHTML = '';

  if (state.pagosProgramados.filter(p => !p.pagada).length === 0) {
    tbody.innerHTML = emptyTableRow(7);
    return;
  }

  if (filtered.length === 0) {
    tbody.innerHTML = emptyTableRow(7, 'No hay pagos programados en el período seleccionado');
    return;
  }

  filtered.forEach(p => {
    const { badge, badgeClass } = getFacturaEstado(p);
    tbody.innerHTML += `
      <tr class="hover:bg-gray-50">
        <td class="px-6 py-3 text-gray-500 font-mono text-xs">${p.factura || '—'}</td>
        <td class="px-6 py-3 font-medium text-gray-800">${getProveedorById(p.proveedorId)?.nombre || p.proveedor}</td>
        <td class="px-6 py-3 text-gray-500">${p.concepto || '—'}</td>
        <td class="px-6 py-3 text-gray-500">${formatDisplayDate(p.vencimiento)}</td>
        <td class="px-6 py-3 text-right font-semibold">${formatMoney(p.monto)}</td>
        <td class="px-6 py-3 text-center"><span class="text-xs font-medium px-2 py-1 rounded-full ${badgeClass}">${badge}</span></td>
        ${actionButtons('programado', p.id)}
      </tr>`;
  });
}

function updateHistorialPagos() {
  const range = getActivePagoRange();
  document.getElementById('pago-filtro-label').textContent = range.label;
  const tbody = document.getElementById('pago-table-body');
  const proveedorId = getProviderFilterId('pago-proveedor-busqueda', true);
  if (!proveedorId) {
    document.getElementById('pago-count').textContent = '0';
    document.getElementById('pago-total').textContent = formatMoney(0);
    document.getElementById('pago-total-resumen').textContent = formatMoney(0);
    tbody.innerHTML = emptyTableRow(9, 'Seleccione un proveedor para consultar sus pagos');
    return;
  }
  if (range.invalid) {
    document.getElementById('pago-count').textContent = '0';
    document.getElementById('pago-total').textContent = formatMoney(0);
    document.getElementById('pago-total-resumen').textContent = formatMoney(0);
    tbody.innerHTML = emptyTableRow(9, range.label);
    return;
  }
  if (state.pagoFiltro !== 'custom') syncPagoDateInputs(range.start, range.end);
  const pagosProgramados = state.pagosProgramados
    .filter(p => p.pagada && p.fechaPago)
    .flatMap(p => (p.pagos?.length ? p.pagos : [{ fecha: p.fechaPago, monto: p.monto, banco: p.monto, cajaMayor: 0, cajaMenor: 0 }])
      .map(abono => ({ ...p, ...abono, facturaId: p.id, tipoPago: 'Factura', proveedorFiltroId: p.proveedorId, fechaRegistro: abono.fecha, monto: abono.monto || p.monto })));
  const pagosInmediatos = state.pagosInmediatos
    .filter(p => p.fecha)
    .map(p => ({
      ...p,
      tipoPago: 'Pago inmediato',
      proveedorFiltroId: p.proveedorId || '__inmediatos__',
      proveedor: p.proveedorId ? (getProveedorById(p.proveedorId)?.nombre || p.proveedor) : 'Pagos inmediatos',
      fechaRegistro: p.fecha,
    }));
  const filtered = [...pagosProgramados, ...pagosInmediatos].filter(p => {
    const facturaSearch = document.getElementById('pago-factura-search').value.trim().toLowerCase();
    if (proveedorId && p.proveedorFiltroId !== proveedorId) return false;
    if (facturaSearch && !(p.factura || '').toLowerCase().includes(facturaSearch)) return false;
    const d = parseDate(p.fechaRegistro);
    return (!range.start || d >= range.start) && (!range.end || d <= range.end);
  }).sort((a, b) => parseDate(b.fechaRegistro) - parseDate(a.fechaRegistro));
  const total = filtered.reduce((sum, p) => sum + p.monto, 0);
  document.getElementById('pago-count').textContent = filtered.length;
  document.getElementById('pago-total').textContent = formatMoney(total);
  document.getElementById('pago-total-resumen').textContent = formatMoney(total);
  tbody.innerHTML = filtered.length ? filtered.map(p => `
    <tr class="hover:bg-gray-50">
      <td class="px-6 py-3 text-gray-500">${formatDisplayDate(p.fechaRegistro)}</td>
      <td class="px-6 py-3 text-gray-600">${p.tipoPago}</td>
      <td class="px-6 py-3 font-mono text-xs text-gray-500">${p.factura || '—'}</td>
      <td class="px-6 py-3 font-medium text-gray-800">${getProveedorById(p.proveedorId)?.nombre || p.proveedor || p.categoria || '—'}</td>
      <td class="px-6 py-3 text-gray-500">${p.concepto || '—'}</td>
      <td class="px-6 py-3 text-gray-500">${p.vencimiento ? formatDisplayDate(p.vencimiento) : '—'}</td>
      <td class="px-6 py-3 text-gray-500 text-xs">${formatPaymentSources(p)}</td>
      <td class="px-6 py-3 text-right font-semibold text-success">${formatMoney(p.monto)}</td>
      <td class="px-6 py-3 text-center">
        <div class="flex items-center justify-center gap-1">
          ${p.tipoPago === 'Factura' ? reversePaidButton(p.facturaId || p.id) : ''}
          <button type="button" class="btn-edit-gasto p-2 rounded-lg hover:bg-blue-50 text-corporate transition-colors" title="Editar" data-type="${p.tipoPago === 'Pago inmediato' ? 'inmediato' : 'programado'}" data-id="${p.id}"><i class="fas fa-pen text-sm"></i></button>
          <button type="button" class="btn-delete-gasto p-2 rounded-lg hover:bg-red-50 text-red-500 transition-colors" title="Eliminar" data-type="${p.tipoPago === 'Pago inmediato' ? 'inmediato' : 'programado'}" data-id="${p.id}"><i class="fas fa-trash-alt text-sm"></i></button>
        </div>
      </td>
    </tr>`).join('') : emptyTableRow(9, 'No hay pagos realizados en el período seleccionado');
}

function updateDeudasTable() {
  const range = getActiveDeudaRange();
  const proveedorId = getProviderFilterId('deuda-proveedor-busqueda');
  const facturaSearch = document.getElementById('deuda-factura-search').value.trim().toLowerCase();
  const tbody = document.getElementById('deudas-table-body');
  if (!tbody) return;

  if (!proveedorId) {
    document.getElementById('deudas-total-global').textContent = formatMoney(
      state.pagosProgramados.filter(p => !p.pagada).reduce((s, p) => s + p.monto, 0)
    );
    tbody.innerHTML = emptyTableRow(5, 'Seleccione un proveedor para consultar sus deudas');
    return;
  }

  const label = document.getElementById('deudas-filtro-label');
  if (label) label.textContent = range.label;
  if (range.invalid) {
    document.getElementById('deudas-total-global').textContent = formatMoney(0);
    tbody.innerHTML = emptyTableRow(5, range.label);
    return;
  }

  const deudas = getDeudasPorProveedor({ proveedorId, start: range.start, end: range.end, facturaSearch });

  const totalDeuda = deudas.reduce((s, d) => s + d.total, 0);
  const totalEl = document.getElementById('deudas-total-global');
  if (totalEl) totalEl.textContent = formatMoney(totalDeuda);

  tbody.innerHTML = '';
  if (deudas.length === 0) {
    tbody.innerHTML = emptyTableRow(5, proveedorId || range.start || range.end || facturaSearch
      ? 'No hay deudas pendientes con estos filtros'
      : 'No hay deudas pendientes registradas');
    return;
  }

  deudas.forEach(d => {
    const { badge, badgeClass } = getProveedorDebtBadge(d);
    const isSelected = selectedProveedorId === d.proveedorId;
    tbody.innerHTML += `
      <tr class="hover:bg-gray-50 cursor-pointer transition-colors ${isSelected ? 'bg-blue-50' : ''}" data-proveedor-id="${d.proveedorId}">
        <td class="px-6 py-3 font-medium text-gray-800">${d.nombre}</td>
        <td class="px-6 py-3 text-center text-gray-600">${d.count}</td>
        <td class="px-6 py-3 text-right font-semibold text-corporate">${formatMoney(d.total)}</td>
        <td class="px-6 py-3 text-center"><span class="text-xs font-medium px-2 py-1 rounded-full ${badgeClass}">${badge}</span></td>
        <td class="px-6 py-3 text-center">
          <button type="button" class="btn-ver-proveedor px-3 py-1.5 text-xs font-medium rounded-lg bg-corporate/10 text-corporate hover:bg-corporate hover:text-white transition-colors" data-proveedor-id="${d.proveedorId}">
            <i class="fas fa-eye mr-1"></i> Ver cuenta
          </button>
        </td>
      </tr>`;
  });
}

function getSelectedFacturas() {
  return state.pagosProgramados.filter(p => selectedFacturaIds.has(p.id) && !p.pagada);
}

function updateProgramacionPago() {
  const seleccionadas = getSelectedFacturas();
  const total = seleccionadas.reduce((sum, p) => sum + p.monto, 0);
  const banco = parseFloat(document.getElementById('saldo-banco-disponible').value) || 0;
  const caja = parseFloat(document.getElementById('saldo-caja-disponible').value) || 0;
  const disponible = banco + caja;
  document.getElementById('pagos-seleccionados-count').textContent = seleccionadas.length;
  document.getElementById('pagos-seleccionados-total').textContent = formatMoney(total);
  document.getElementById('pagos-disponibles-total').textContent = formatMoney(disponible);
  const estado = document.getElementById('pagos-programacion-estado');
  estado.textContent = total === 0 ? 'Seleccione facturas para programar' : total <= disponible ? 'Disponible para pagar' : 'Fondos insuficientes';
  estado.className = total === 0 ? 'text-xs text-gray-500' : total <= disponible ? 'text-xs font-semibold text-success' : 'text-xs font-semibold text-red-500';
  const lista = document.getElementById('pagos-seleccionados-body');
  lista.innerHTML = seleccionadas.length ? seleccionadas.map(f => `
    <tr>
      <td class="px-4 py-2 font-mono text-xs text-gray-600">${f.factura || '—'}</td>
      <td class="px-4 py-2 text-gray-700">${getProveedorById(f.proveedorId)?.nombre || f.proveedor}</td>
      <td class="px-4 py-2 text-gray-500">${formatDisplayDate(f.vencimiento)}</td>
      <td class="px-4 py-2 text-right font-semibold">${formatMoney(f.monto)}</td>
      <td class="px-4 py-2 text-center">${removeScheduledPaymentButton(f.id)}</td>
    </tr>`).join('') : emptyTableRow(5, 'No hay facturas seleccionadas para pagar');
  document.querySelectorAll('.factura-seleccion').forEach(input => {
    input.checked = selectedFacturaIds.has(input.dataset.id);
  });
}

function updateProveedorDetalle(proveedorId) {
  const panel = document.getElementById('proveedor-detalle');
  if (!panel) return;

  const prov = getProveedorById(proveedorId);
  if (!prov) {
    panel.classList.add('hidden');
    return;
  }

  selectedProveedorId = proveedorId;
  panel.classList.remove('hidden');

  const range = getActiveDeudaRange();
  const facturas = range.invalid ? [] : getPagosByProveedor(proveedorId).filter(f => {
    if (f.pagada) return false;
    const vencimiento = parseDate(f.vencimiento);
    return (!range.start || vencimiento >= range.start) && (!range.end || vencimiento <= range.end);
  });
  const totalAdeudado = facturas.reduce((s, f) => s + f.monto, 0);

  document.getElementById('detalle-proveedor-nombre').textContent = prov.nombre;
  document.getElementById('detalle-proveedor-info').textContent = [
    prov.nit ? `NIT: ${prov.nit}` : '',
    prov.contacto ? `Contacto: ${prov.contacto}` : '',
  ].filter(Boolean).join(' · ') || 'Sin datos de contacto';

  document.getElementById('detalle-total-adeudado').textContent = formatMoney(totalAdeudado);
  document.getElementById('detalle-count-pendientes').textContent = facturas.length;

  const tbody = document.getElementById('detalle-facturas-body');
  tbody.innerHTML = '';

  if (facturas.length === 0) {
    tbody.innerHTML = emptyTableRow(6, 'Este proveedor no tiene facturas registradas');
    return;
  }

  facturas.sort((a, b) => parseDate(a.vencimiento) - parseDate(b.vencimiento));
  facturas.forEach(f => {
    const { badge, badgeClass } = getFacturaEstado(f);
    tbody.innerHTML += `
      <tr class="hover:bg-gray-50">
        <td class="px-4 py-3 font-mono text-xs text-gray-500">
          ${!f.pagada ? `<input type="checkbox" class="factura-seleccion mr-2 accent-corporate" data-id="${f.id}" ${selectedFacturaIds.has(f.id) ? 'checked' : ''} title="Seleccionar para programar pago" />` : ''}
          ${f.factura || '—'}
        </td>
        <td class="px-4 py-3 text-gray-700">${f.concepto || '—'}</td>
        <td class="px-4 py-3 text-gray-500">${formatDisplayDate(f.vencimiento)}</td>
        <td class="px-4 py-3 text-right font-semibold">${formatMoney(f.monto)}</td>
        <td class="px-4 py-3 text-center"><span class="text-xs font-medium px-2 py-1 rounded-full ${badgeClass}">${badge}</span></td>
        <td class="px-4 py-3 text-center">
          <div class="flex flex-wrap items-center justify-center gap-1">
            ${!f.pagada ? markPaidButton(f.id) : ''}
            <button type="button" class="btn-edit-gasto p-2 rounded-lg hover:bg-blue-50 text-corporate transition-colors" title="Editar" data-type="programado" data-id="${f.id}"><i class="fas fa-pen text-sm"></i></button>
            <button type="button" class="btn-delete-gasto p-2 rounded-lg hover:bg-red-50 text-red-500 transition-colors" title="Eliminar" data-type="programado" data-id="${f.id}"><i class="fas fa-trash-alt text-sm"></i></button>
          </div>
        </td>
      </tr>`;
  });

  updateDeudasTable();
  updateProgramacionPago();
}

function moveProgramacionToEnd() {
  const panel = document.getElementById('panel-deudas');
  const programacionContainer = document.getElementById('panel-programados');
  const programacion = document.getElementById('programacion-pagos');
  const deudaTotal = document.getElementById('deuda-total-resumen');
  if (panel && deudaTotal) panel.prepend(deudaTotal);
  if (panel && programacionContainer) panel.appendChild(programacionContainer);
  if (panel && programacion) panel.appendChild(programacion);
}

function setProgQuickFilter(filtro) {
  state.progFiltro = filtro;
  activateProgQuickButton(filtro);
  const range = getPresetProgRange(filtro);
  syncProgDateInputs(range.start, range.end);
  updateProgramadosTable();
  saveAppData();
}

document.querySelectorAll('.prog-filtro-btn').forEach(btn => {
  btn.addEventListener('click', () => setProgQuickFilter(btn.dataset.filtro));
});

document.getElementById('prog-fecha-inicio').addEventListener('change', () => {
  state.progFiltro = 'custom';
  clearProgQuickButtons();
  updateProgramadosTable();
  saveAppData();
});

document.getElementById('prog-fecha-fin').addEventListener('change', () => {
  state.progFiltro = 'custom';
  clearProgQuickButtons();
  updateProgramadosTable();
  saveAppData();
});

document.getElementById('prog-proveedor-filtro').addEventListener('change', updateProgramadosTable);

document.getElementById('pago-proveedor-busqueda')?.addEventListener('input', () => {
  updateHistorialPagos();
});
document.getElementById('pago-factura-search').addEventListener('input', updateHistorialPagos);
document.getElementById('deuda-factura-search').addEventListener('input', updateDeudasTable);

['deuda-fecha-inicio', 'deuda-fecha-fin'].forEach(id => {
  document.getElementById(id).addEventListener('change', () => {
    updateDeudasTable();
    if (selectedProveedorId) updateProveedorDetalle(selectedProveedorId);
  });
});

document.getElementById('deuda-proveedor-busqueda')?.addEventListener('input', () => {
  selectedProveedorId = null;
  document.getElementById('proveedor-detalle').classList.add('hidden');
  updateDeudasTable();
});

document.addEventListener('change', e => {
  if (e.target.matches('.factura-seleccion')) {
    if (e.target.checked) selectedFacturaIds.add(e.target.dataset.id);
    else selectedFacturaIds.delete(e.target.dataset.id);
    updateProgramacionPago();
  }
});

['saldo-banco-disponible', 'saldo-caja-disponible'].forEach(id => {
  document.getElementById(id).addEventListener('input', () => {
    state.bancoDisponible = parseFloat(document.getElementById('saldo-banco-disponible').value) || 0;
    state.cajaDisponible = parseFloat(document.getElementById('saldo-caja-disponible').value) || 0;
    updateProgramacionPago();
    saveAppData();
  });
});

document.querySelectorAll('.pago-filtro-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    state.pagoFiltro = btn.dataset.filtro;
    activatePagoQuickButton(state.pagoFiltro);
    updateHistorialPagos();
    saveAppData();
  });
});

['pago-fecha-inicio', 'pago-fecha-fin'].forEach(id => {
  document.getElementById(id).addEventListener('change', () => {
    state.pagoFiltro = 'custom';
    clearPagoQuickButtons();
    updateHistorialPagos();
    saveAppData();
  });
});

document.getElementById('form-inmediato').addEventListener('submit', e => {
  e.preventDefault();
  const proveedorNombre = document.getElementById('inm-proveedor').value.trim();
  const categoria = document.getElementById('inm-categoria').value;
  const factura = document.getElementById('inm-factura').value.trim();
  const concepto = document.getElementById('inm-concepto').value.trim();
  const monto = parseFloat(document.getElementById('inm-monto').value) || 0;
  if (monto <= 0) { showToast('Ingrese un monto válido'); return; }
  const proveedorId = proveedorNombre ? findOrCreateProveedor(proveedorNombre) : null;

  state.pagosInmediatos.push({
    id: generateId(),
    proveedorId,
    proveedor: proveedorNombre,
    categoria,
    factura,
    concepto,
    monto,
    fecha: formatDateISO(new Date()),
  });

  document.getElementById('inm-factura').value = '';
  document.getElementById('inm-proveedor').value = '';
  document.getElementById('inm-concepto').value = '';
  document.getElementById('inm-monto').value = '0';
  refreshGastosUI();
  showToast('Pago inmediato registrado');
});

document.getElementById('prog-proveedor-select')?.addEventListener('change', toggleProgProveedorNew);

document.getElementById('form-programado').addEventListener('submit', e => {
  e.preventDefault();
  const proveedorNombre = getProgProveedorNombre();
  const factura = document.getElementById('prog-factura').value.trim();
  const concepto = document.getElementById('prog-concepto').value.trim();
  const vencimiento = document.getElementById('prog-vencimiento').value;
  const monto = parseFloat(document.getElementById('prog-monto').value) || 0;

  if (!proveedorNombre || !vencimiento || monto <= 0) {
    showToast('Complete proveedor, vencimiento y monto');
    return;
  }

  const proveedorId = findOrCreateProveedor(proveedorNombre);

  state.pagosProgramados.push({
    id: generateId(),
    proveedorId,
    factura,
    proveedor: proveedorNombre,
    concepto,
    vencimiento,
    monto,
    pagada: false,
    fechaPago: null,
  });

  resetProgProveedorForm();
  document.getElementById('prog-factura').value = '';
  document.getElementById('prog-concepto').value = '';
  document.getElementById('prog-vencimiento').value = '';
  document.getElementById('prog-monto').value = '0';
  refreshGastosUI();
  showToast('Factura agregada a programación');
});

document.querySelectorAll('.gastos-tab-btn').forEach(btn => {
  btn.addEventListener('click', () => switchGastosTab(btn.dataset.gastosTab));
});

document.getElementById('proveedor-search')?.addEventListener('input', updateDeudasTable);

document.addEventListener('click', e => {
  const editBtn = e.target.closest('.btn-edit-gasto');
  const deleteBtn = e.target.closest('.btn-delete-gasto');
  const markPaidBtn = e.target.closest('.btn-marcar-pagada');
  const verBtn = e.target.closest('.btn-ver-proveedor');
  const removeScheduledBtn = e.target.closest('.btn-retirar-programacion');
  const row = e.target.closest('tr[data-proveedor-id]');

  if (removeScheduledBtn) {
    selectedFacturaIds.delete(removeScheduledBtn.dataset.id);
    updateProgramacionPago();
    updateProveedorDetalle(selectedProveedorId);
    showToast('Factura retirada de la programación');
    return;
  }

  if (markPaidBtn) {
    openEditModal('programado', markPaidBtn.dataset.id);
  }
  const reversePaidBtn = e.target.closest('.btn-revertir-pagada');
  if (reversePaidBtn) {
    const record = state.pagosProgramados.find(p => p.id === reversePaidBtn.dataset.id);
    if (!record) return;
    record.pagada = false;
    record.fechaPago = null;
    record.pagos = [];
    refreshGastosUI();
    showToast('Cancelación revertida');
  }
  if (editBtn) openEditModal(editBtn.dataset.type, editBtn.dataset.id);
  if (deleteBtn) openDeleteModal(deleteBtn.dataset.type, deleteBtn.dataset.id);

  if (verBtn) {
    switchModule('deudas');
    switchGastosTab('deudas');
    updateProveedorDetalle(verBtn.dataset.proveedorId);
    document.getElementById('proveedor-detalle')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } else if (row && !e.target.closest('button')) {
    switchModule('deudas');
    switchGastosTab('deudas');
    updateProveedorDetalle(row.dataset.proveedorId);
  }
});

document.getElementById('btn-gestionar-proveedores')?.addEventListener('click', () => {
  renderProveedoresManageList();
  document.getElementById('proveedores-modal').classList.remove('hidden');
});

document.getElementById('proveedores-modal-close')?.addEventListener('click', closeProveedoresModal);
document.getElementById('proveedores-modal-overlay')?.addEventListener('click', closeProveedoresModal);

function closeProveedoresModal() {
  document.getElementById('proveedores-modal').classList.add('hidden');
}

function renderProveedoresManageList() {
  const tbody = document.getElementById('proveedores-manage-body');
  tbody.innerHTML = '';
  if (state.proveedores.length === 0) {
    tbody.innerHTML = emptyTableRow(5, 'No hay proveedores en el catálogo');
    return;
  }
  state.proveedores.forEach(p => {
    const pendientes = getPagosByProveedor(p.id).filter(f => !f.pagada).length;
    tbody.innerHTML += `
      <tr class="hover:bg-gray-50">
        <td class="px-4 py-3 font-medium">${p.nombre}</td>
        <td class="px-4 py-3 text-gray-500 text-sm">${p.nit || '—'}</td>
        <td class="px-4 py-3 text-gray-500 text-sm">${p.contacto || '—'}</td>
        <td class="px-4 py-3 text-center text-sm">${pendientes}</td>
        <td class="px-4 py-3 text-center">
          <div class="flex items-center justify-center gap-1">
            <button type="button" class="btn-edit-proveedor p-2 rounded-lg hover:bg-blue-50 text-corporate" data-id="${p.id}" title="Editar">
              <i class="fas fa-pen text-sm"></i>
            </button>
            <button type="button" class="btn-delete-proveedor p-2 rounded-lg hover:bg-red-50 text-red-500" data-id="${p.id}" title="Eliminar">
              <i class="fas fa-trash-alt text-sm"></i>
            </button>
          </div>
        </td>
      </tr>`;
  });
}

function openEditProveedorModal(id) {
  const prov = getProveedorById(id);
  if (!prov) return;
  document.getElementById('edit-prov-id').value = id;
  document.getElementById('edit-prov-nombre').value = prov.nombre;
  document.getElementById('edit-prov-nit').value = prov.nit || '';
  document.getElementById('edit-prov-contacto').value = prov.contacto || '';
  document.getElementById('edit-proveedor-modal').classList.remove('hidden');
}

function closeEditProveedorModal() {
  document.getElementById('edit-proveedor-modal').classList.add('hidden');
}

document.getElementById('edit-proveedor-modal-close')?.addEventListener('click', closeEditProveedorModal);
document.getElementById('edit-proveedor-modal-overlay')?.addEventListener('click', closeEditProveedorModal);

document.getElementById('form-edit-proveedor')?.addEventListener('submit', e => {
  e.preventDefault();
  const id = document.getElementById('edit-prov-id').value;
  const prov = getProveedorById(id);
  if (!prov) return;
  const nombre = document.getElementById('edit-prov-nombre').value.trim();
  const nit = document.getElementById('edit-prov-nit').value.trim();
  const contacto = document.getElementById('edit-prov-contacto').value.trim();
  if (!nombre) { showToast('Ingrese el nombre del proveedor'); return; }
  const dup = state.proveedores.some(p => p.id !== id && p.nombre.toLowerCase() === nombre.toLowerCase());
  if (dup) { showToast('Ya existe otro proveedor con ese nombre'); return; }
  prov.nombre = nombre;
  prov.nit = nit;
  prov.contacto = contacto;
  state.pagosProgramados.forEach(p => {
    if (p.proveedorId === id) p.proveedor = nombre;
  });
  closeEditProveedorModal();
  refreshGastosUI();
  renderProveedoresManageList();
  showToast('Proveedor actualizado');
});

document.addEventListener('click', e => {
  const editProv = e.target.closest('.btn-edit-proveedor');
  const delProv = e.target.closest('.btn-delete-proveedor');
  if (editProv) openEditProveedorModal(editProv.dataset.id);
  if (delProv) {
    const id = delProv.dataset.id;
    const prov = getProveedorById(id);
    const pendientes = getPagosByProveedor(id).filter(f => !f.pagada).length;
    if (pendientes > 0) {
      showToast('No se puede eliminar: tiene facturas pendientes');
      return;
    }
    if (!confirm(`¿Eliminar el proveedor "${prov?.nombre}" del catálogo?`)) return;
    state.proveedores = state.proveedores.filter(p => p.id !== id);
    if (selectedProveedorId === id) {
      selectedProveedorId = null;
      document.getElementById('proveedor-detalle')?.classList.add('hidden');
    }
    refreshGastosUI();
    renderProveedoresManageList();
    showToast('Proveedor eliminado');
  }
});

document.getElementById('form-nuevo-proveedor')?.addEventListener('submit', e => {
  e.preventDefault();
  const nombre = document.getElementById('prov-nombre').value.trim();
  const nit = document.getElementById('prov-nit').value.trim();
  const contacto = document.getElementById('prov-contacto').value.trim();
  if (!nombre) { showToast('Ingrese el nombre del proveedor'); return; }
  const exists = state.proveedores.some(p => p.nombre.toLowerCase() === nombre.toLowerCase());
  if (exists) { showToast('El proveedor ya existe'); return; }
  state.proveedores.push({ id: generateId(), nombre, nit, contacto });
  document.getElementById('prov-nombre').value = '';
  document.getElementById('prov-nit').value = '';
  document.getElementById('prov-contacto').value = '';
  renderProveedoresManageList();
  refreshGastosUI();
  showToast('Proveedor registrado');
});

document.getElementById('btn-cerrar-detalle')?.addEventListener('click', () => {
  selectedProveedorId = null;
  document.getElementById('proveedor-detalle').classList.add('hidden');
  updateDeudasTable();
});

// ─── CRUD Modales ────────────────────────────
function openEditModal(type, id) {
  const isInm = type === 'inmediato';
  const record = isInm
    ? state.pagosInmediatos.find(p => p.id === id)
    : state.pagosProgramados.find(p => p.id === id);

  if (!record) return;

  document.getElementById('edit-type').value = type;
  document.getElementById('edit-id').value = id;
  document.getElementById('edit-modal-title').textContent = isInm ? 'Editar pago inmediato' : 'Editar pago programado';
  document.getElementById('edit-fields-inmediato').classList.toggle('hidden', !isInm);
  document.getElementById('edit-fields-programado').classList.toggle('hidden', isInm);

  if (isInm) {
    renderEditCategoriasSelect();
    document.getElementById('edit-inm-categoria').value = record.categoria;
    document.getElementById('edit-inm-proveedor').value = record.proveedor || '';
    document.getElementById('edit-inm-factura').value = record.factura || '';
    document.getElementById('edit-inm-concepto').value = record.concepto || '';
    document.getElementById('edit-inm-fecha').value = /^\d{4}-\d{2}-\d{2}$/.test(record.fecha)
      ? record.fecha
      : formatDateISO(new Date());
    document.getElementById('edit-inm-monto').value = record.monto;
  } else {
    renderEditProveedoresSelect();
    const select = document.getElementById('edit-prog-proveedor-select');
    if (record.proveedorId && select) select.value = record.proveedorId;
    document.getElementById('edit-prog-proveedor').value = record.proveedor || '';
    document.getElementById('edit-prog-factura').value = record.factura || '';
    document.getElementById('edit-prog-concepto').value = record.concepto || '';
    document.getElementById('edit-prog-vencimiento').value = record.vencimiento;
    document.getElementById('edit-prog-monto').value = record.monto;
    document.getElementById('edit-prog-pagada').checked = record.pagada || false;
    document.getElementById('edit-prog-fecha-pago').value = record.fechaPago || formatDateISO(new Date());
    const pago = record.pagos?.[0] || {};
    document.getElementById('edit-pago-banco').value = pago.banco || (record.pagada ? record.monto : 0);
    document.getElementById('edit-pago-caja').value = pago.caja ?? ((pago.cajaMayor || 0) + (pago.cajaMenor || 0));
    document.getElementById('edit-prog-fecha-pago-wrap').classList.toggle('hidden', !record.pagada);
  }

  document.getElementById('edit-modal').classList.remove('hidden');
}

function closeEditModal() {
  document.getElementById('edit-modal').classList.add('hidden');
}

function openDeleteModal(type, id) {
  document.getElementById('delete-type').value = type;
  document.getElementById('delete-id').value = id;
  document.getElementById('delete-modal').classList.remove('hidden');
}

function closeDeleteModal() {
  document.getElementById('delete-modal').classList.add('hidden');
}

document.getElementById('edit-modal-close').addEventListener('click', closeEditModal);
document.getElementById('edit-modal-overlay').addEventListener('click', closeEditModal);
document.getElementById('delete-cancel').addEventListener('click', closeDeleteModal);
document.getElementById('delete-modal-overlay').addEventListener('click', closeDeleteModal);

document.getElementById('edit-prog-pagada')?.addEventListener('change', e => {
  document.getElementById('edit-prog-fecha-pago-wrap').classList.toggle('hidden', !e.target.checked);
});

document.getElementById('form-edit-gasto').addEventListener('submit', e => {
  e.preventDefault();
  const type = document.getElementById('edit-type').value;
  const id = document.getElementById('edit-id').value;

  if (type === 'inmediato') {
    const record = state.pagosInmediatos.find(p => p.id === id);
    if (!record) return;
    const monto = parseFloat(document.getElementById('edit-inm-monto').value) || 0;
    if (monto <= 0) { showToast('Ingrese un monto válido'); return; }
    record.categoria = document.getElementById('edit-inm-categoria').value;
    const proveedorNombre = document.getElementById('edit-inm-proveedor').value.trim();
    record.proveedorId = proveedorNombre ? findOrCreateProveedor(proveedorNombre) : null;
    record.proveedor = proveedorNombre;
    record.factura = document.getElementById('edit-inm-factura').value.trim();
    record.concepto = document.getElementById('edit-inm-concepto').value.trim();
    record.fecha = document.getElementById('edit-inm-fecha').value;
    record.monto = monto;
  } else {
    const record = state.pagosProgramados.find(p => p.id === id);
    if (!record) return;
    const proveedorNombre = document.getElementById('edit-prog-proveedor').value.trim();
    const vencimiento = document.getElementById('edit-prog-vencimiento').value;
    const monto = parseFloat(document.getElementById('edit-prog-monto').value) || 0;
    const pagada = document.getElementById('edit-prog-pagada').checked;
    if (!proveedorNombre || !vencimiento || monto <= 0) {
      showToast('Complete proveedor, vencimiento y monto');
      return;
    }
    const banco = parseFloat(document.getElementById('edit-pago-banco').value) || 0;
    const caja = parseFloat(document.getElementById('edit-pago-caja').value) || 0;
    if (pagada && Math.round(banco + caja) !== Math.round(monto)) {
      showToast('La distribución de fuentes debe coincidir con el monto total');
      return;
    }
    const proveedorId = findOrCreateProveedor(proveedorNombre);
    record.proveedorId = proveedorId;
    record.proveedor = proveedorNombre;
    record.factura = document.getElementById('edit-prog-factura').value.trim();
    record.concepto = document.getElementById('edit-prog-concepto').value.trim();
    record.vencimiento = vencimiento;
    record.monto = monto;
    record.pagada = pagada;
    record.fechaPago = pagada
      ? document.getElementById('edit-prog-fecha-pago').value || formatDateISO(new Date())
      : null;
    record.pagos = pagada ? [{
      id: record.pagos?.[0]?.id || generateId(),
      fecha: record.fechaPago,
      monto,
      banco,
      caja,
      cajaMayor: 0,
      cajaMenor: 0,
    }] : [];
  }

  closeEditModal();
  refreshGastosUI();
  showToast('Registro actualizado');
});

document.getElementById('delete-confirm').addEventListener('click', () => {
  const type = document.getElementById('delete-type').value;
  const id = document.getElementById('delete-id').value;

  if (type === 'inmediato') {
    state.pagosInmediatos = state.pagosInmediatos.filter(p => p.id !== id);
  } else {
    state.pagosProgramados = state.pagosProgramados.filter(p => p.id !== id);
  }

  closeDeleteModal();
  refreshGastosUI();
  showToast('Registro eliminado');
});

let calcModo = 1;

function formatPct(n) {
  return (Math.round(n * 100) / 100).toLocaleString('es-CO', { maximumFractionDigits: 2 }) + '%';
}

function getComisionComercialPct(utilidadPct) {
  return utilidadPct <= 40 ? 0 : Math.max(1, Math.min((utilidadPct - 40) / 2, 20));
}

function switchCalcModo(modo) {
  calcModo = modo;
  document.querySelectorAll('.calc-mode-btn').forEach(btn => {
    const active = btn.dataset.calcMode === String(modo);
    btn.classList.toggle('active', active);
    btn.classList.toggle('bg-corporate', active);
    btn.classList.toggle('text-white', active);
    btn.classList.toggle('border-corporate', active);
    btn.classList.toggle('border-gray-200', !active);
  });

  document.getElementById('calc-modo-1-inputs').classList.toggle('hidden', modo !== 1);
  document.getElementById('calc-modo-2-inputs').classList.toggle('hidden', modo !== 2);
  document.getElementById('calc-reglas-modo-1').classList.add('hidden');
  document.getElementById('calc-reglas-modo-2').classList.add('hidden');
  document.getElementById('calc-modo-1-results').classList.toggle('hidden', modo !== 1);
  document.getElementById('calc-modo-2-results').classList.toggle('hidden', modo !== 2);

  if (modo === 1) calcPrecioComision();
  else calcModo2();
}

document.querySelectorAll('.calc-mode-btn').forEach(btn => {
  btn.addEventListener('click', () => switchCalcModo(parseInt(btn.dataset.calcMode, 10)));
});

function calcPrecioComision() {
  const costo = parseFloat(document.getElementById('calc-costo').value) || 0;
  const utilidadPct = parseFloat(document.getElementById('calc-utilidad').value) || 0;
  const margen = utilidadPct / 100;

  let precioVenta = 0;
  let utilidadBruta = 0;
  let comision = 0;
  let utilidadDrogueria = 0;
  let reglaText = '';
  let reglaClass = '';

  if (costo > 0 && margen > 0 && margen < 1) {
    precioVenta = costo / (1 - margen);
    utilidadBruta = precioVenta - costo;
  } else if (costo > 0 && margen === 0) {
    precioVenta = costo;
    utilidadBruta = 0;
  }

  utilidadDrogueria = utilidadBruta;

  if (utilidadPct >= 100) {
    comision = 0;
    utilidadDrogueria = 0;
    reglaText = 'Margen inválido — debe ser menor a 100%';
    reglaClass = 'border-red-200 bg-red-50 text-red-600';
  } else if (utilidadPct <= 40) {
    comision = 0;
    utilidadDrogueria = utilidadBruta;
    reglaText = 'Sin comisión — Utilidad ≤ 40%';
    reglaClass = 'border-gray-200 bg-gray-50 text-gray-600';
  } else {
    const comisionPct = getComisionComercialPct(utilidadPct);
    comision = precioVenta * (comisionPct / 100);
    utilidadDrogueria = utilidadBruta - comision;
    reglaText = comisionPct === 0
      ? 'Sin comisión — Utilidad ≤ 40%'
      : `Comisión comercial ${formatPct(comisionPct)} — mitad del porcentaje sobre 40% (entre 1% y 20% del precio de venta)`;
    reglaClass = comisionPct === 0 ? 'border-gray-200 bg-gray-50 text-gray-600' : 'border-amber-200 bg-amber-50 text-amber-700';
  }

  document.getElementById('calc-precio').textContent = formatMoney(precioVenta);
  document.getElementById('calc-utilidad-bruta').textContent = formatMoney(utilidadBruta);
  document.getElementById('calc-comision').textContent = formatMoney(comision);
  document.getElementById('calc-utilidad-drogueria').textContent = formatMoney(utilidadDrogueria);

  const reglaBox = document.getElementById('calc-regla-box');
  reglaBox.className = 'mt-4 p-4 rounded-xl text-center border-2 ' + reglaClass;
  document.getElementById('calc-regla-info').title = reglaText;
}

function calcModo2() {
  const costo = parseFloat(document.getElementById('calc-costo').value) || 0;
  const precioVenta = parseFloat(document.getElementById('calc-precio-input').value) || 0;

  let ganancia = 0;
  let utilidadPct = 0;
  let rayaPct = 0;
  let drogueriaPct = 0;
  let comisionPesos = 0;
  let utilidadDrogueria = 0;
  let analisisText = '—';
  let reglaText = '';
  let reglaClass = '';

  if (precioVenta <= 0) {
    reglaText = 'Ingrese un precio de venta válido';
    reglaClass = 'border-red-200 bg-red-50 text-red-600';
  } else if (precioVenta < costo) {
    ganancia = precioVenta - costo;
    utilidadPct = ((precioVenta - costo) / precioVenta) * 100;
    analisisText = 'Precio inferior al costo — sin comisión';
    reglaText = 'El precio de venta es menor que el costo';
    reglaClass = 'border-red-200 bg-red-50 text-red-600';
  } else {
    ganancia = precioVenta - costo;
    utilidadPct = ((precioVenta - costo) / precioVenta) * 100;

    rayaPct = getComisionComercialPct(utilidadPct);
    drogueriaPct = utilidadPct - rayaPct;
    comisionPesos = precioVenta * (rayaPct / 100);
    analisisText = rayaPct === 0
      ? 'Sin comisión / Raya (0%)'
      : `Comisión comercial = ${formatPct(rayaPct)} (mitad del porcentaje sobre 40%, entre 1% y 20% del precio de venta)`;
    reglaText = rayaPct === 0
      ? 'Sin comisión — Utilidad ≤ 40%'
      : `Comisión comercial ${formatPct(rayaPct)} — entre 1% y 20% del precio de venta`;
    reglaClass = rayaPct === 0 ? 'border-gray-200 bg-gray-50 text-gray-600' : 'border-amber-200 bg-amber-50 text-amber-700';

    utilidadDrogueria = ganancia - comisionPesos;
  }

  document.getElementById('calc-m2-ganancia').textContent = formatMoney(ganancia);
  document.getElementById('calc-m2-utilidad-pct').textContent = formatPct(utilidadPct);
  document.getElementById('calc-m2-comision-pesos').textContent = formatMoney(comisionPesos);
  document.getElementById('calc-m2-comision-pct').textContent = formatPct(rayaPct);
  document.getElementById('calc-m2-utilidad-drogueria').textContent = formatMoney(utilidadDrogueria);

  const reglaBox = document.getElementById('calc-m2-regla-box');
  reglaBox.className = 'mt-4 p-4 rounded-xl text-center border-2 ' + reglaClass;
  document.getElementById('calc-m2-regla-info').title = reglaText;
}

function runCalc() {
  if (calcModo === 1) calcPrecioComision();
  else calcModo2();
}

const calcCosto = document.getElementById('calc-costo');
const calcUtilidad = document.getElementById('calc-utilidad');
const calcRange = document.getElementById('calc-utilidad-range');
const calcPrecioInput = document.getElementById('calc-precio-input');

calcCosto.addEventListener('input', runCalc);
calcUtilidad.addEventListener('input', () => {
  calcRange.value = calcUtilidad.value;
  runCalc();
});
calcRange.addEventListener('input', () => {
  calcUtilidad.value = calcRange.value;
  runCalc();
});
calcPrecioInput.addEventListener('input', runCalc);

// ─── Init ────────────────────────────────────
document.getElementById('currentDate').textContent = todayStr();
document.getElementById('cierre-base').value = state.baseFija ?? 400000;
moveProgramacionToEnd();
renderCategoriasSelect();
renderProveedoresDatalist();
renderProveedorFilterSelects();
renderProveedoresFormSelect();
document.getElementById('saldo-banco-disponible').value = state.bancoDisponible || 0;
document.getElementById('saldo-caja-disponible').value = state.cajaDisponible ?? ((state.cajaMayorDisponible || 0) + (state.cajaMenorDisponible || 0));
buildDenominaciones();
calcCierre();
calcPrecioComision();
calcModo2();
updateDashboard();
updateInmediatosTable();
updateDeudasTable();
updateProgramacionPago();
activatePagoQuickButton(state.pagoFiltro || 'todo');
updateHistorialPagos();
if (state.progFiltro === 'custom') {
  updateProgramadosTable();
} else {
  setProgQuickFilter(state.progFiltro || '30');
}
syncCloudState();
