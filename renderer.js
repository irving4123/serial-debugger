// ============================================================
// 串口调试助手 - 渲染进程 (使用 Web Serial API)
// ============================================================

// ---------- 状态管理 ----------
const state = {
  ports: new Map(),         // key -> { port, info, config, log, reader, label }
  currentPort: null,
  isChartPaused: false,
  chartData: [],
  autoSendTimer: null,
};

// ---------- DOM 引用 ----------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const dom = {
  portSelect: $('#port-select'),
  baudrate: $('#baudrate'),
  databits: $('#databits'),
  stopbits: $('#stopbits'),
  parity: $('#parity'),
  btnOpen: $('#btn-open-port'),
  btnClose: $('#btn-close-port'),
  btnRefresh: $('#btn-refresh-ports'),
  portTabs: $('#port-tabs'),
  openPortsList: $('#open-ports-list'),
  receiveArea: $('#receive-area'),
  sendArea: $('#send-area'),
  btnSend: $('#btn-send'),
  btnClearReceive: $('#btn-clear-receive'),
  btnClearSend: $('#btn-clear-send'),
  btnSave: $('#btn-save-data'),
  chkHexReceive: $('#chk-hex-receive'),
  chkHexSend: $('#chk-hex-send'),
  chkAutoScroll: $('#chk-auto-scroll'),
  chkShowTime: $('#chk-show-time'),
  chkAppendCR: $('#chk-append-cr'),
  chkAppendLF: $('#chk-append-lf'),
  chkAutoSend: $('#chk-auto-send'),
  autoSendInterval: $('#auto-send-interval'),
  statusIndicator: $('#status-indicator'),
  statusText: $('#status-text'),
  chartPauseBtn: $('#btn-pause-chart'),
  chartClearBtn: $('#btn-clear-chart'),
  chartMaxPoints: $('#chart-max-points'),
  chartParseMode: $('#chart-parse-mode'),
  chartCanvas: $('#waveChart'),
  // USB
  btnRefreshUsb: $('#btn-refresh-usb'),
  btnRequestUsb: $('#btn-request-usb'),
  usbDeviceList: $('#usb-device-list'),
};

// ---------- 波形图 ----------
let waveChart;
function initChart() {
  waveChart = new Chart(dom.chartCanvas.getContext('2d'), {
    type: 'line',
    data: {
      labels: [],
      datasets: [{
        label: '串口数据', data: [],
        borderColor: '#4a8cff', backgroundColor: 'rgba(74,140,255,0.1)',
        borderWidth: 2, pointRadius: 0, tension: 0.3, fill: true,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: { duration: 200 },
      interaction: { mode: 'nearest', axis: 'x', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          mode: 'index', intersect: false,
          backgroundColor: 'rgba(15,20,25,0.9)',
          titleColor: '#e4e8f1', bodyColor: '#8892a8',
          borderColor: '#2d3548', borderWidth: 1,
        }
      },
      scales: {
        x: { display: true, grid: { color: 'rgba(45,53,72,0.3)', drawBorder: false }, ticks: { color: '#5c6479', maxTicksLimit: 10, font: { size: 10 } } },
        y: { display: true, grid: { color: 'rgba(45,53,72,0.3)', drawBorder: false }, ticks: { color: '#5c6479', font: { size: 10 } }, beginAtZero: true }
      }
    }
  });
}

function updateChart(value) {
  if (state.isChartPaused) return;
  const maxPoints = parseInt(dom.chartMaxPoints.value) || 100;
  state.chartData.push(value);
  if (state.chartData.length > maxPoints) state.chartData.shift();
  waveChart.data.labels = state.chartData.map((_, i) => i);
  waveChart.data.datasets[0].data = [...state.chartData];
  waveChart.update('none');
}

// ============================================================
// Web Serial API
// ============================================================

function portKey(info) {
  return `${info.usbProductId||0}_${info.usbVendorId||0}_${info.productName||''}_${info.serialNumber||Math.random()}`;
}

async function refreshPorts() {
  try {
    const grantedPorts = await navigator.serial.getPorts();
    dom.portSelect.innerHTML = '<option value="">-- 请选择串口 --</option>';
    // 添加「请求新串口」选项
    const reqOpt = document.createElement('option');
    reqOpt.value = '__request__';
    reqOpt.textContent = '🔄 搜索新串口...';
    dom.portSelect.appendChild(reqOpt);

    for (const port of grantedPorts) {
      const info = port.getInfo();
      const key = portKey(info);
      if (!state.ports.has(key)) {
        state.ports.set(key, { port, info, config: null, log: '', reader: null, label: info.productName || `USB Serial (${info.usbVendorId?.toString(16)||'?'}:${info.usbProductId?.toString(16)||'?'})` });
      }
      const entry = state.ports.get(key);
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = entry.label;
      // 标记已打开的
      if (entry.config) opt.textContent += ' ✅';
      dom.portSelect.appendChild(opt);
    }
    return grantedPorts;
  } catch (err) {
    console.error('扫描串口失败:', err);
    return [];
  }
}

async function requestNewPort() {
  try {
    const port = await navigator.serial.requestPort();
    const info = port.getInfo();
    const key = portKey(info);
    if (!state.ports.has(key)) {
      state.ports.set(key, { port, info, config: null, log: '', reader: null, label: info.productName || `USB Serial` });
    }
    await refreshPorts();
    // 选中新端口
    for (let i = 0; i < dom.portSelect.options.length; i++) {
      if (dom.portSelect.options[i].value === key) {
        dom.portSelect.selectedIndex = i; break;
      }
    }
  } catch (err) {
    if (err.name !== 'NotFoundError') showNotification('请求串口失败: ' + err.message, 'error');
  }
}

// 打开串口
async function openPort() {
  const val = dom.portSelect.value;
  if (!val) { showNotification('请选择一个串口', 'warning'); return; }
  if (val === '__request__') { await requestNewPort(); return; }

  const entry = state.ports.get(val);
  if (!entry) { showNotification('串口信息丢失，请重新扫描', 'warning'); return; }

  try {
    await entry.port.open({
      baudRate: parseInt(dom.baudrate.value),
      dataBits: parseInt(dom.databits.value),
      stopBits: parseFloat(dom.stopbits.value),
      parity: dom.parity.value,
      flowControl: 'none'
    });
    entry.config = {
      baudRate: parseInt(dom.baudrate.value),
      dataBits: parseInt(dom.databits.value),
      stopBits: parseFloat(dom.stopbits.value),
      parity: dom.parity.value,
    };
    entry.log = '';
    state.currentPort = val;

    showNotification(`✅ ${entry.label} 已打开`, 'success');
    dom.btnClose.disabled = false;
    dom.btnOpen.disabled = true;
    renderPortTabs();
    renderOpenPortsList();
    updateStatusBar(val);
    startReading(val);
  } catch (err) {
    showNotification(`❌ 打开失败: ${err.message}`, 'error');
  }
}

// 读取数据循环
async function startReading(key) {
  const entry = state.ports.get(key);
  if (!entry?.port?.readable) return;
  entry.reading = true;

  try {
    while (entry.reading && entry.port.readable) {
      const reader = entry.port.readable.getReader();
      entry.reader = reader;
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value) handleReceivedData(key, new Uint8Array(value));
        }
      } catch (err) {
        if (!['AbortError','NetworkError'].includes(err.name)) console.error('读取错误:', err);
      } finally { reader.releaseLock(); }
    }
  } finally { entry.reading = false; }
}

function handleReceivedData(key, bytes) {
  const entry = state.ports.get(key);
  if (!entry) return;

  const isHex = dom.chkHexReceive.checked;
  const timeStr = dom.chkShowTime.checked ? `[${getTimeStr()}] ` : '';
  const hexStr = Array.from(bytes).map(b => b.toString(16).padStart(2,'0').toUpperCase()).join(' ');
  const displayStr = isHex ? hexStr : (() => {
    try { return new TextDecoder('utf-8',{fatal:false}).decode(bytes).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g,'.'); }
    catch { return Array.from(bytes).map(b=>String.fromCharCode(b)).join(''); }
  })();

  const prefix = isHex ? 'RX(H): ' : 'RX: ';
  if (key === state.currentPort) {
    appendToReceiveArea(`<span class="${isHex?'hex-data':'rx-data'}">${timeStr}${prefix}${escapeHtml(displayStr)}</span>\n`);
  }
  entry.log += `${timeStr}${prefix}${displayStr}\n`;

  // 波形
  if (!state.isChartPaused) {
    const mode = dom.chartParseMode.value;
    let val = null;
    if (mode === 'ascii') { const n=displayStr.match(/-?\d+\.?\d*/g); val=n?parseFloat(n[0]):displayStr.charCodeAt(0); }
    else if (mode === 'hex') val = bytes[0];
    else if (mode === 'int16' && bytes.length>=2) { val=(bytes[0]<<8)|bytes[1]; if(val>32767)val-=65536; }
    else if (mode === 'float32' && bytes.length>=4) { const b=new ArrayBuffer(4),v=new DataView(b); bytes.slice(0,4).forEach((x,i)=>v.setUint8(i,x)); val=v.getFloat32(0,true); }
    if (val !== null && !isNaN(val)) updateChart(val);
  }
}

// 关闭串口
async function closePortByKey(key) {
  const entry = state.ports.get(key);
  if (!entry) return;
  entry.reading = false;
  if (entry.reader) { try { await entry.reader.cancel(); } catch {} entry.reader = null; }
  if (entry.port?.readable) { try { await entry.port.close(); } catch {} }
  entry.config = null;
  if (state.currentPort === key) state.currentPort = findNextOpen(key);
  renderPortTabs(); renderOpenPortsList(); updateStatusBar(state.currentPort);
  showNotification('🔌 串口已关闭', 'info');
  if (!state.currentPort) { dom.btnClose.disabled = true; dom.btnOpen.disabled = false; }
}

function findNextOpen(excludeKey) {
  for (const [k, e] of state.ports) if (k !== excludeKey && e.config) return k;
  return null;
}

// 发送数据
async function sendData() {
  if (!state.currentPort) { showNotification('请先打开串口','warning'); return; }
  const entry = state.ports.get(state.currentPort);
  if (!entry?.port?.writable) { showNotification('串口不可写入','error'); return; }

  let data = dom.sendArea.value;
  if (!data) { showNotification('请输入要发送的数据','warning'); return; }

  const isHex = dom.chkHexSend.checked;
  let buffer;
  if (isHex) {
    let hex = data.replace(/\s+/g,'');
    if (dom.chkAppendCR.checked) hex += '0D';
    if (dom.chkAppendLF.checked) hex += '0A';
    if (hex.length%2) hex='0'+hex;
    buffer = new Uint8Array(hex.match(/.{1,2}/g)?.map(b=>parseInt(b,16))||[]);
  } else {
    let str = data;
    if (dom.chkAppendCR.checked) str += '\r';
    if (dom.chkAppendLF.checked) str += '\n';
    buffer = new TextEncoder().encode(str);
  }

  try {
    const writer = entry.port.writable.getWriter();
    await writer.write(buffer);
    writer.releaseLock();

    const timeStr = dom.chkShowTime.checked ? `[${getTimeStr()}] ` : '';
    const prefix = isHex ? 'TX(H): ' : 'TX: ';
    const display = isHex ? Array.from(buffer).map(b=>b.toString(16).padStart(2,'0').toUpperCase()).join(' ') : data;
    appendToReceiveArea(`<span class="tx-data">${timeStr}${prefix}${escapeHtml(display)}</span>\n`);
    entry.log += `${timeStr}${prefix}${display}\n`;
  } catch (err) { showNotification(`发送失败: ${err.message}`,'error'); }
}

// ---------- UI ----------
function renderPortTabs() {
  dom.portTabs.innerHTML = '';
  let has = false;
  for (const [key, e] of state.ports) {
    if (!e.config) continue;
    has = true;
    const tab = document.createElement('span');
    tab.className = `port-tab${key===state.currentPort?' active':''}`;
    tab.innerHTML = `${e.label} <span class="close-tab" data-key="${key}">✕</span>`;
    tab.addEventListener('click', e => {
      if (e.target.classList.contains('close-tab')) { closePortByKey(e.target.dataset.key); return; }
      state.currentPort = key; renderPortTabs(); renderOpenPortsList(); updateStatusBar(key);
    });
    dom.portTabs.appendChild(tab);
  }
  if (!has) dom.portTabs.innerHTML = '<span style="color:var(--text-muted);font-size:12px;">暂无打开的串口</span>';
}

function renderOpenPortsList() {
  dom.openPortsList.innerHTML = '';
  let has = false;
  for (const [key, e] of state.ports) {
    if (!e.config) continue;
    has = true;
    const item = document.createElement('div');
    item.className = 'open-port-item';
    item.innerHTML = `<div class="port-info"><span class="port-name">${e.label}</span><span class="port-detail">${e.config.baudRate} ${e.config.dataBits}${e.config.stopBits} ${e.config.parity}</span></div><span class="port-close" data-key="${key}">✕</span>`;
    item.querySelector('.port-close').addEventListener('click',()=>closePortByKey(key));
    dom.openPortsList.appendChild(item);
  }
  if (!has) dom.openPortsList.innerHTML = '<div class="empty-hint">暂无已打开的串口</div>';
}

// ---------- 辅助函数 ----------
function appendToReceiveArea(html) { dom.receiveArea.innerHTML += html; if (dom.chkAutoScroll.checked) dom.receiveArea.scrollTop = dom.receiveArea.scrollHeight; }
function getTimeStr() { const d=new Date(); return d.toLocaleTimeString('zh-CN',{hour12:false})+'.'+String(d.getMilliseconds()).padStart(3,'0'); }
function getTimeStrForFile() { const d=new Date(); return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}_${String(d.getHours()).padStart(2,'0')}${String(d.getMinutes()).padStart(2,'0')}${String(d.getSeconds()).padStart(2,'0')}`; }
function escapeHtml(str) { const d=document.createElement('div'); d.textContent=str; return d.innerHTML; }

function showNotification(msg, type='info') {
  dom.statusText.textContent = msg;
  dom.statusIndicator.className = type==='error'?'status-dot error':type==='success'?'status-dot online':'status-dot offline';
  setTimeout(()=>updateStatusBar(state.currentPort),3000);
}

function updateStatusBar(key) {
  if (!key||!state.ports.has(key)||!state.ports.get(key).config) {
    dom.statusIndicator.className='status-dot offline'; dom.statusText.textContent='未连接'; return;
  }
  const e=state.ports.get(key);
  dom.statusIndicator.className='status-dot online';
  dom.statusText.textContent=`${e.label} | ${e.config.baudRate} ${e.config.dataBits}${e.config.stopBits} ${e.config.parity}`;
}

async function saveData() {
  if (!state.currentPort||!state.ports.get(state.currentPort)?.log) { showNotification('没有可保存的数据','warning'); return; }
  const r=await window.electronAPI.saveFile({content:state.ports.get(state.currentPort).log,defaultName:`串口数据_${getTimeStrForFile()}.txt`});
  if(r.success) showNotification('✅ 数据已保存','success');
}

function startAutoSend() { if(!state.autoSendTimer) state.autoSendTimer=setInterval(()=>sendData(),parseInt(dom.autoSendInterval.value)||1000); }
function stopAutoSend() { if(state.autoSendTimer){clearInterval(state.autoSendTimer);state.autoSendTimer=null;} }

// ============================================================
// WebUSB API - USB设备检测
// ============================================================

// USB 设备类别映射
const USB_CLASS_NAMES = {
  0x00: { icon: '📦', name: '未知' },
  0x01: { icon: '🔊', name: '音频设备' },
  0x02: { icon: '📡', name: '通信设备(CDC)' },
  0x03: { icon: '🖱', name: 'HID设备(键盘/鼠标)' },
  0x05: { icon: '📋', name: '物理设备' },
  0x06: { icon: '📷', name: '图像设备' },
  0x07: { icon: '🖨', name: '打印机' },
  0x08: { icon: '💾', name: '大容量存储' },
  0x09: { icon: '🔗', name: 'USB Hub' },
  0x0A: { icon: '📊', name: 'CDC数据' },
  0x0B: { icon: '💳', name: '智能卡' },
  0x0D: { icon: '🔒', name: '安全设备' },
  0x0E: { icon: '📹', name: '视频设备' },
  0x0F: { icon: '🩺', name: '个人医疗' },
  0x10: { icon: '📱', name: '音频/视频' },
  0x11: { icon: '📟', name: '广告牌' },
  0x12: { icon: '📶', name: 'USB-C桥接' },
  0xDC: { icon: '⚙️', name: '诊断设备' },
  0xE0: { icon: '📻', name: '无线控制器' },
  0xEF: { icon: '🔀', name: '多功能设备' },
  0xFE: { icon: '🔧', name: '特定应用' },
  0xFF: { icon: '🔲', name: '厂商自定义' },
};

function getUsbClassInfo(deviceClass) {
  return USB_CLASS_NAMES[deviceClass] || { icon: '📦', name: `Class 0x${deviceClass.toString(16).padStart(2,'0')}` };
}

// USB VID/PID 厂商映射（常见）
const USB_VENDORS = {
  0x0403: 'FTDI', 0x10C4: 'Silicon Labs', 0x1A86: 'WCH (沁恒)',
  0x2341: 'Arduino', 0x2A19: 'Raspberry Pi', 0x0483: 'STMicroelectronics',
  0x067B: 'Prolific', 0x1366: 'Segger', 0x16C0: 'Van Ooijen',
  0x303A: 'Espressif (乐鑫)', 0x1A86: 'WCH (沁恒)', 0x2E8A: 'Raspberry Pi',
  0x32A3: 'Espressif', 0x0BDA: 'Realtek', 0x8087: 'Intel',
  0x046D: 'Logitech', 0x04E8: 'Samsung', 0x05AC: 'Apple',
  0x06CB: 'Synaptics', 0x0CF3: 'Qualcomm/Atheros',
};

function getUsbVendorName(vid) { return USB_VENDORS[vid] || `0x${vid.toString(16).padStart(4,'0')}`; }

// 获取设备类型图标
function getDeviceIcon(device) {
  // 先查 class
  if (device.deviceClass !== 0x00) {
    return getUsbClassInfo(device.deviceClass).icon;
  }
  // 串口设备常见 VID
  const serialVids = [0x0403, 0x10C4, 0x1A86, 0x067B, 0x0483, 0x1366, 0x303A, 0x2E8A];
  if (serialVids.includes(device.vendorId)) return '🔌';
  // HID
  if (device.deviceClass === 0x00 && device.deviceSubclass === 0x00 && device.deviceProtocol === 0x00) {
    return '💻';
  }
  return '📦';
}

// USB 设备状态
const usbState = {
  devices: new Map(),  // uniqueKey -> { device, info }
  expandedDevice: null,
};

function usbDeviceKey(device) {
  return `${device.vendorId}_${device.productId}_${device.serialNumber||'no-sn'}`;
}

// 扫描已授权的 USB 设备
async function refreshUsbDevices() {
  try {
    const devices = await navigator.usb.getDevices();
    for (const device of devices) {
      const key = usbDeviceKey(device);
      usbState.devices.set(key, {
        device,
        info: {
          vendorId: device.vendorId,
          productId: device.productId,
          serialNumber: device.serialNumber,
          manufacturerName: device.manufacturerName,
          productName: device.productName,
          deviceClass: device.deviceClass,
          deviceSubclass: device.deviceSubclass,
          deviceProtocol: device.deviceProtocol,
          usbVersionMajor: device.usbVersionMajor,
          usbVersionMinor: device.usbVersionMinor,
          deviceVersionMajor: device.deviceVersionMajor,
          deviceVersionMinor: device.deviceVersionMinor,
          deviceVersionSubminor: device.deviceVersionSubminor,
        }
      });
    }
    renderUsbDevices();
    return devices;
  } catch (err) {
    console.error('扫描USB设备失败:', err);
    showNotification('⚠️ USB扫描失败: ' + err.message, 'error');
    return [];
  }
}

// 请求授权新 USB 设备
async function requestUsbDevice() {
  try {
    const device = await navigator.usb.requestDevice({ filters: [] });
    if (device) {
      await refreshUsbDevices();
      showNotification(`✅ 已授权: ${device.productName || 'USB设备'}`, 'success');
    }
  } catch (err) {
    if (err.name !== 'NotFoundError') {
      showNotification('⚠️ 授权失败: ' + err.message, 'error');
    }
  }
}

// 渲染 USB 设备列表
function renderUsbDevices() {
  const list = dom.usbDeviceList;
  if (usbState.devices.size === 0) {
    list.innerHTML = '<div class="empty-hint">未检测到已授权的USB设备<br><span style="font-size:11px;">点击「+ 授权」搜索设备</span></div>';
    return;
  }

  list.innerHTML = '';
  for (const [key, entry] of usbState.devices) {
    const dev = entry.device;
    const info = entry.info;
    const classInfo = getUsbClassInfo(info.deviceClass);
    const icon = getDeviceIcon(dev);
    const vendorName = getUsbVendorName(info.vendorId);
    const isExpanded = usbState.expandedDevice === key;

    const item = document.createElement('div');
    item.className = `usb-device-item${isExpanded ? ' expanded' : ''}`;
    item.innerHTML = `
      <div class="usb-top-row">
        <span class="usb-icon">${icon}</span>
        <span class="usb-name">${info.productName || '未知设备'}</span>
        <span class="usb-status connected">已连接</span>
      </div>
      <div class="usb-details">
        <div class="usb-detail-row">
          <span class="detail-label">厂商</span>
          <span class="detail-value">${info.manufacturerName || vendorName}</span>
        </div>
        <div class="usb-detail-row">
          <span class="detail-label">VID:PID</span>
          <span class="detail-value">${'0x' + info.vendorId.toString(16).padStart(4,'0').toUpperCase()}:${'0x' + info.productId.toString(16).padStart(4,'0').toUpperCase()}</span>
        </div>
        <div class="usb-detail-row">
          <span class="detail-label">序列号</span>
          <span class="detail-value">${info.serialNumber || '无'}</span>
        </div>
        <div class="usb-detail-row">
          <span class="detail-label">设备类型</span>
          <span class="detail-value"><span class="usb-class-badge">${classInfo.name}</span></span>
        </div>
        <div class="usb-detail-row">
          <span class="detail-label">USB版本</span>
          <span class="detail-value">${info.usbVersionMajor}.${info.usbVersionMinor}</span>
        </div>
        <div class="usb-detail-row">
          <span class="detail-label">设备版本</span>
          <span class="detail-value">${info.deviceVersionMajor}.${info.deviceVersionMinor}.${info.deviceVersionSubminor}</span>
        </div>
        <div class="usb-detail-row">
          <span class="detail-label">Class/Sub/Proto</span>
          <span class="detail-value">${'0x' + info.deviceClass.toString(16).padStart(2,'0')} / ${'0x' + info.deviceSubclass.toString(16).padStart(2,'0')} / ${'0x' + info.deviceProtocol.toString(16).padStart(2,'0')}</span>
        </div>
      </div>
    `;

    // 点击展开/收起详情
    item.addEventListener('click', (e) => {
      if (e.target.closest('.usb-status')) return;
      usbState.expandedDevice = usbState.expandedDevice === key ? null : key;
      renderUsbDevices();
    });

    list.appendChild(item);
  }

  // 显示总数
  const count = document.createElement('div');
  count.style.cssText = 'font-size:11px;color:var(--text-muted);text-align:right;padding-top:4px;';
  count.textContent = `共 ${usbState.devices.size} 个USB设备`;
  list.appendChild(count);
}

// ============================================================
// 事件绑定
// ============================================================

dom.btnRefresh.addEventListener('click', async () => { await refreshPorts(); });
dom.btnOpen.addEventListener('click', openPort);
dom.btnClose.addEventListener('click', () => { if(state.currentPort) closePortByKey(state.currentPort); });
dom.btnSend.addEventListener('click', sendData);
document.addEventListener('keydown', e => { if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();sendData();} });
dom.btnClearReceive.addEventListener('click', () => { dom.receiveArea.innerHTML=''; if(state.currentPort&&state.ports.has(state.currentPort)) state.ports.get(state.currentPort).log=''; });
dom.btnClearSend.addEventListener('click', () => { dom.sendArea.value=''; });
dom.btnSave.addEventListener('click', saveData);
dom.chkAutoSend.addEventListener('change', () => { dom.chkAutoSend.checked?startAutoSend():stopAutoSend(); });
dom.chartPauseBtn.addEventListener('click', () => { state.isChartPaused=!state.isChartPaused; dom.chartPauseBtn.textContent=state.isChartPaused?'▶ 继续':'⏸ 暂停'; });
dom.chartClearBtn.addEventListener('click', () => { state.chartData=[]; waveChart.data.labels=[]; waveChart.data.datasets[0].data=[]; waveChart.update(); });
dom.chartParseMode.addEventListener('change', () => { state.chartData=[]; waveChart.data.labels=[]; waveChart.data.datasets[0].data=[]; waveChart.update(); });

// 串口热插拔监听
navigator.serial.addEventListener('connect', () => { showNotification('🖥 检测到新串口设备','info'); refreshPorts(); });
navigator.serial.addEventListener('disconnect', async () => {
  for (const [key, e] of state.ports) {
    if (e.config && e.port?.readable === null) { showNotification(`🔌 ${e.label} 已断开`,'warning'); closePortByKey(key); }
  }
  await refreshPorts();
});

// 下拉列表选择「搜索新串口」时触发
dom.portSelect.addEventListener('change', () => {
  if (dom.portSelect.value === '__request__') requestNewPort();
});

// ============== USB 事件绑定 ==============

// 扫描USB设备
dom.btnRefreshUsb.addEventListener('click', async () => {
  await refreshUsbDevices();
  if (usbState.devices.size === 0) {
    showNotification('💡 未找到已授权的USB设备，点击「+ 授权」搜索', 'info');
  } else {
    showNotification(`✅ 检测到 ${usbState.devices.size} 个USB设备`, 'success');
  }
});

// 请求新USB设备
dom.btnRequestUsb.addEventListener('click', requestUsbDevice);

// USB 热插拔监听
navigator.usb.addEventListener('connect', async (e) => {
  const device = e.device;
  const classInfo = getUsbClassInfo(device.deviceClass);
  showNotification(`🖥 插入: ${device.productName || 'USB设备'} (${classInfo.name})`, 'info');
  await refreshUsbDevices();
});

navigator.usb.addEventListener('disconnect', async (e) => {
  const device = e.device;
  const key = usbDeviceKey(device);
  usbState.devices.delete(key);
  if (usbState.expandedDevice === key) usbState.expandedDevice = null;
  renderUsbDevices();
  showNotification(`🔌 拔出: ${device.productName || 'USB设备'}`, 'info');
});

// ============================================================
// 初始化
// ============================================================
initChart();
refreshPorts();
// 延迟扫描USB（等页面加载完成）
setTimeout(() => refreshUsbDevices(), 500);
console.log('🔌 串口调试助手已启动 (Web Serial API)');
console.log('💡 提示: Ctrl+Enter 快速发送数据');
