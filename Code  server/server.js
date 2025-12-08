// ==================== DEPENDENCIES ====================
const express = require('express');
const cors = require('cors');
const path = require('path');
const ExcelJS = require('exceljs');
const os = require('os');

// ==================== APP SETUP ====================
const app = express();
const PORT = 3000;

app.use(express.json());
app.use(cors());

// ==================== CONFIGURATION ====================
const CONFIG = {
  devicePower: {
    led: 20,
    fan: 50,
    fog: 100,
    heater: 150
  },
  electricityPrice: 2500,
  maxHistory: 1000
};

// ==================== DATA STORAGE ====================
const floorData = {
  floor1: {
    temperature: 0,
    humidity: 0,
    devices: {
      led: 'OFF',
      fan: 'OFF',
      fog: 'OFF',
      heater: 'OFF'
    },
    history: [],
    stats: {
      led: { lastState: 'OFF', lastChange: Date.now(), totalMs: 0 },
      fan: { lastState: 'OFF', lastChange: Date.now(), totalMs: 0 },
      fog: { lastState: 'OFF', lastChange: Date.now(), totalMs: 0 },
      heater: { lastState: 'OFF', lastChange: Date.now(), totalMs: 0 }
    }
  },
  floor2: {
    temperature: 0,
    humidity: 0,
    devices: {
      led: 'OFF',
      fan: 'OFF',
      fog: 'OFF',
      heater: 'OFF'
    },
    history: [],
    stats: {
      led: { lastState: 'OFF', lastChange: Date.now(), totalMs: 0 },
      fan: { lastState: 'OFF', lastChange: Date.now(), totalMs: 0 },
      fog: { lastState: 'OFF', lastChange: Date.now(), totalMs: 0 },
      heater: { lastState: 'OFF', lastChange: Date.now(), totalMs: 0 }
    }
  }
};

let currentDate = getCurrentDate();

// ==================== UTILITY FUNCTIONS ====================
function getCurrentDate() {
  return new Date().toISOString().slice(0, 10);
}

function checkAndResetDaily() {
  const today = getCurrentDate();
  if (today !== currentDate) {
    currentDate = today;
    const now = Date.now();

    Object.keys(floorData).forEach(floor => {
      floorData[floor].history = [];
      Object.keys(floorData[floor].stats).forEach(device => {
        floorData[floor].stats[device] = {
          lastState: 'OFF',
          lastChange: now,
          totalMs: 0
        };
      });
    });

    console.log(`Daily reset completed: ${today}`);
  }
}

function addSensorData(floor, temperature, humidity) {
  const data = floorData[floor];
  data.history.push({
    timestamp: new Date(),
    temperature,
    humidity
  });

  if (data.history.length > CONFIG.maxHistory) {
    data.history.shift();
  }
}

function updateDeviceState(floor, device, state) {
  checkAndResetDaily();

  const stats = floorData[floor].stats[device];
  const now = Date.now();

  if (stats.lastState === 'ON') {
    stats.totalMs += now - stats.lastChange;
  }

  stats.lastState = state;
  stats.lastChange = now;
  floorData[floor].devices[device] = state;

  console.log(`${floor} - ${device.toUpperCase()}: ${state}`);
}

function getDeviceRuntime(floor, device) {
  checkAndResetDaily();

  const stats = floorData[floor].stats[device];
  let totalMs = stats.totalMs;
  const now = Date.now();

  if (stats.lastState === 'ON') {
    totalMs += now - stats.lastChange;
  }

  return Math.floor(totalMs / 1000);
}

function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;

  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatCurrency(amount) {
  return new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: 'VND'
  }).format(amount);
}

function calculateFloorEnergy(floor) {
  const devices = ['led', 'fan', 'fog', 'heater'];
  let totalEnergy = 0;
  let totalCost = 0;
  const deviceDetails = {};

  devices.forEach(device => {
    const runtimeSec = getDeviceRuntime(floor, device);
    const runtimeHours = runtimeSec / 3600;
    const powerW = CONFIG.devicePower[device];
    const energyKWh = (powerW * runtimeHours) / 1000;
    const cost = energyKWh * CONFIG.electricityPrice;

    totalEnergy += energyKWh;
    totalCost += cost;

    deviceDetails[device] = {
      runtimeSeconds: runtimeSec,
      runtimeHours: runtimeHours.toFixed(2),
      runtimeFormatted: formatDuration(runtimeSec),
      powerW,
      energyKWh: energyKWh.toFixed(3),
      costVND: Math.round(cost),
      costFormatted: formatCurrency(cost)
    };
  });

  return {
    devices: deviceDetails,
    totalEnergy: totalEnergy.toFixed(3),
    totalCost: Math.round(totalCost),
    totalCostFormatted: formatCurrency(totalCost)
  };
}

function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

// ==================== API: HOME ====================
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'client.html'));
});

// ==================== API: ESP32 DATA RECEIVER (HTTP CLIENT MODE) ====================
app.post('/floor1', (req, res) => {
  const { temp, hum } = req.body;

  floorData.floor1.temperature = temp;
  floorData.floor1.humidity = hum;
  addSensorData('floor1', temp, hum);

  console.log(`Floor 1 - Temp: ${temp}°C | Hum: ${hum}%`);

  const devices = floorData.floor1.devices;
  const response = `LED_${devices.led} FAN_${devices.fan} FOG_${devices.fog} HEATER_${devices.heater}`;
  res.send(response);
});

app.post('/floor2', (req, res) => {
  const { temp, hum } = req.body;

  floorData.floor2.temperature = temp;
  floorData.floor2.humidity = hum;
  addSensorData('floor2', temp, hum);

  console.log(`Floor 2 - Temp: ${temp}°C | Hum: ${hum}%`);

  const devices = floorData.floor2.devices;
  const response = `LED_${devices.led} FAN_${devices.fan} FOG_${devices.fog} HEATER_${devices.heater}`;
  res.send(response);
});

// ==================== API: ZIGBEE COORDINATOR /update ====================
// ESP32 Coordinator (Zigbee) sẽ POST kiểu:
// {
//   "floor1": { "temp": 28.5, "hum": 75.2, "led": "ON", "fan": "OFF", "heater": "OFF", "fog": "ON" },
//   "floor2": { "temp": 29.1, "hum": 72.3, "led": "OFF", "fan": "ON",  "heater": "OFF", "fog": "OFF" }
// }
app.post('/update', (req, res) => {
  try {
    const { floor1, floor2 } = req.body || {};

    // Floor 1
    if (floor1) {
      const t = Number(floor1.temp);
      const h = Number(floor1.hum);

      if (!Number.isNaN(t)) floorData.floor1.temperature = t;
      if (!Number.isNaN(h)) floorData.floor1.humidity = h;

      if (!Number.isNaN(t) && !Number.isNaN(h)) {
        addSensorData('floor1', t, h);
      }

      console.log(`ZIGBEE /update - Floor 1: Temp=${t}°C | Hum=${h}%`);
    }

    // Floor 2
    if (floor2) {
      const t = Number(floor2.temp);
      const h = Number(floor2.hum);

      if (!Number.isNaN(t)) floorData.floor2.temperature = t;
      if (!Number.isNaN(h)) floorData.floor2.humidity = h;

      if (!Number.isNaN(t) && !Number.isNaN(h)) {
        addSensorData('floor2', t, h);
      }

      console.log(`ZIGBEE /update - Floor 2: Temp=${t}°C | Hum=${h}%`);
    }

    res.json({ success: true });
  } catch (err) {
    console.error('❌ Error in /update:', err);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// ==================== API: GET ALL DATA ====================
app.get('/data', (req, res) => {
  const response = {
    floor1: {
      temp: floorData.floor1.temperature,
      hum: floorData.floor1.humidity,
      led: floorData.floor1.devices.led,
      fan: floorData.floor1.devices.fan,
      fog: floorData.floor1.devices.fog,
      heater: floorData.floor1.devices.heater,
      runtime: {
        ledSec: getDeviceRuntime('floor1', 'led'),
        fanSec: getDeviceRuntime('floor1', 'fan'),
        fogSec: getDeviceRuntime('floor1', 'fog'),
        heaterSec: getDeviceRuntime('floor1', 'heater')
      }
    },
    floor2: {
      temp: floorData.floor2.temperature,
      hum: floorData.floor2.humidity,
      led: floorData.floor2.devices.led,
      fan: floorData.floor2.devices.fan,
      fog: floorData.floor2.devices.fog,
      heater: floorData.floor2.devices.heater,
      runtime: {
        ledSec: getDeviceRuntime('floor2', 'led'),
        fanSec: getDeviceRuntime('floor2', 'fan'),
        fogSec: getDeviceRuntime('floor2', 'fog'),
        heaterSec: getDeviceRuntime('floor2', 'heater')
      }
    }
  };

  res.json(response);
});

// ==================== API: GET HISTORY ====================
app.get('/history/:floor', (req, res) => {
  checkAndResetDaily();

  const floor = req.params.floor;
  const history = floorData[floor]?.history || [];

  res.json({
    floor,
    date: currentDate,
    data: history,
    count: history.length
  });
});

// ==================== API: GET STATISTICS ====================
app.get('/stats', (req, res) => {
  checkAndResetDaily();

  const stats = {
    date: currentDate,
    floor1: {},
    floor2: {}
  };

  ['led', 'fan', 'fog', 'heater'].forEach(device => {
    stats.floor1[device] = {
      totalSeconds: getDeviceRuntime('floor1', device),
      formatted: formatDuration(getDeviceRuntime('floor1', device)),
      currentState: floorData.floor1.devices[device]
    };

    stats.floor2[device] = {
      totalSeconds: getDeviceRuntime('floor2', device),
      formatted: formatDuration(getDeviceRuntime('floor2', device)),
      currentState: floorData.floor2.devices[device]
    };
  });

  res.json(stats);
});

// ==================== API: ZIGBEE COORDINATOR /commands ====================
// Coordinator GET /commands để biết trạng thái thiết bị hiện tại
app.get('/commands', (req, res) => {
  checkAndResetDaily();

  res.json({
    floor1: {
      led:    floorData.floor1.devices.led,
      fan:    floorData.floor1.devices.fan,
      heater: floorData.floor1.devices.heater,
      fog:    floorData.floor1.devices.fog
    },
    floor2: {
      led:    floorData.floor2.devices.led,
      fan:    floorData.floor2.devices.fan,
      heater: floorData.floor2.devices.heater,
      fog:    floorData.floor2.devices.fog
    }
  });
});

// ==================== API: UPDATE DEVICE POWER ====================
app.post('/update-power', (req, res) => {
  const { device, power } = req.body;

  if (CONFIG.devicePower.hasOwnProperty(device)) {
    CONFIG.devicePower[device] = parseFloat(power);
    console.log(`Power updated - ${device}: ${power}W`);
    res.json({ success: true, message: 'Power updated', device, power });
  } else {
    res.status(400).json({ error: 'Invalid device' });
  }
});

// ==================== API: UPDATE ELECTRICITY PRICE ====================
app.post('/update-price', (req, res) => {
  const { price } = req.body;
  const newPrice = parseFloat(price);

  if (newPrice > 0) {
    CONFIG.electricityPrice = newPrice;
    console.log(`Electricity price updated: ${newPrice} VND/kWh`);
    res.json({ success: true, message: 'Price updated', price: newPrice });
  } else {
    res.status(400).json({ error: 'Invalid price' });
  }
});

// ==================== API: ENERGY REPORT ====================
app.get('/energy-report', (req, res) => {
  checkAndResetDaily();

  const floor1Energy = calculateFloorEnergy('floor1');
  const floor2Energy = calculateFloorEnergy('floor2');

  const totalDailyEnergy =
    parseFloat(floor1Energy.totalEnergy) + parseFloat(floor2Energy.totalEnergy);
  const totalDailyCost = floor1Energy.totalCost + floor2Energy.totalCost;
  const totalMonthlyEnergy = totalDailyEnergy * 30;
  const totalMonthlyCost = totalDailyCost * 30;

  res.json({
    date: currentDate,
    electricityPrice: CONFIG.electricityPrice,
    devicePower: CONFIG.devicePower,
    floor1: {
      daily: floor1Energy,
      monthly: {
        estimatedEnergyKWh: (parseFloat(floor1Energy.totalEnergy) * 30).toFixed(2),
        estimatedCostVND: Math.round(floor1Energy.totalCost * 30),
        estimatedCostFormatted: formatCurrency(floor1Energy.totalCost * 30)
      }
    },
    floor2: {
      daily: floor2Energy,
      monthly: {
        estimatedEnergyKWh: (parseFloat(floor2Energy.totalEnergy) * 30).toFixed(2),
        estimatedCostVND: Math.round(floor2Energy.totalCost * 30),
        estimatedCostFormatted: formatCurrency(floor2Energy.totalCost * 30)
      }
    },
    total: {
      daily: {
        totalEnergyKWh: totalDailyEnergy.toFixed(3),
        totalCostVND: totalDailyCost,
        totalCostFormatted: formatCurrency(totalDailyCost)
      },
      monthly: {
        estimatedEnergyKWh: totalMonthlyEnergy.toFixed(2),
        estimatedCostVND: Math.round(totalMonthlyCost),
        estimatedCostFormatted: formatCurrency(totalMonthlyCost)
      }
    }
  });
});

// ==================== API: DEVICE CONTROL - FLOOR 1 ====================
app.post('/floor1/led', (req, res) => {
  const state = (req.body.state || '').toUpperCase();
  if (state === 'ON' || state === 'OFF') {
    updateDeviceState('floor1', 'led', state);
    res.json({ led: state, success: true });
  } else {
    res.status(400).json({ error: "State must be 'ON' or 'OFF'" });
  }
});

app.post('/floor1/fan', (req, res) => {
  const state = (req.body.state || '').toUpperCase();
  if (state === 'ON' || state === 'OFF') {
    updateDeviceState('floor1', 'fan', state);
    res.json({ fan: state, success: true });
  } else {
    res.status(400).json({ error: "State must be 'ON' or 'OFF'" });
  }
});

app.post('/floor1/fog', (req, res) => {
  const state = (req.body.state || '').toUpperCase();
  if (state === 'ON' || state === 'OFF') {
    updateDeviceState('floor1', 'fog', state);
    res.json({ fog: state, success: true });
  } else {
    res.status(400).json({ error: "State must be 'ON' or 'OFF'" });
  }
});

app.post('/floor1/heater', (req, res) => {
  const state = (req.body.state || '').toUpperCase();
  if (state === 'ON' || state === 'OFF') {
    updateDeviceState('floor1', 'heater', state);
    res.json({ heater: state, success: true });
  } else {
    res.status(400).json({ error: "State must be 'ON' or 'OFF'" });
  }
});

// ==================== API: DEVICE CONTROL - FLOOR 2 ====================
app.post('/floor2/led', (req, res) => {
  const state = (req.body.state || '').toUpperCase();
  if (state === 'ON' || state === 'OFF') {
    updateDeviceState('floor2', 'led', state);
    res.json({ led: state, success: true });
  } else {
    res.status(400).json({ error: "State must be 'ON' or 'OFF'" });
  }
});

app.post('/floor2/fan', (req, res) => {
  const state = (req.body.state || '').toUpperCase();
  if (state === 'ON' || state === 'OFF') {
    updateDeviceState('floor2', 'fan', state);
    res.json({ fan: state, success: true });
  } else {
    res.status(400).json({ error: "State must be 'ON' or 'OFF'" });
  }
});

app.post('/floor2/fog', (req, res) => {
  const state = (req.body.state || '').toUpperCase();
  if (state === 'ON' || state === 'OFF') {
    updateDeviceState('floor2', 'fog', state);
    res.json({ fog: state, success: true });
  } else {
    res.status(400).json({ error: "State must be 'ON' or 'OFF'" });
  }
});

app.post('/floor2/heater', (req, res) => {
  const state = (req.body.state || '').toUpperCase();
  if (state === 'ON' || state === 'OFF') {
    updateDeviceState('floor2', 'heater', state);
    res.json({ heater: state, success: true });
  } else {
    res.status(400).json({ error: "State must be 'ON' or 'OFF'" });
  }
});

// ==================== API: EXPORT EXCEL ====================
app.get('/export-excel', async (req, res) => {
  try {
    checkAndResetDaily();

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Smart Swiftlet Farm System';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('Report');

    // Title
    sheet.mergeCells('A1:D1');
    sheet.getCell('A1').value = 'SWIFTLET FARM REPORT';
    sheet.getCell('A1').font = { size: 18, bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' };
    sheet.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0066CC' } };
    sheet.getRow(1).height = 35;

    // Date
    sheet.mergeCells('A2:D2');
    sheet.getCell('A2').value = `Date: ${new Date().toLocaleDateString('vi-VN')} | ${new Date().toLocaleTimeString('vi-VN')}`;
    sheet.getCell('A2').font = { size: 11, italic: true, bold: true };
    sheet.getCell('A2').alignment = { horizontal: 'center' };
    sheet.getCell('A2').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F4FF' } };
    sheet.getRow(2).height = 25;

    sheet.addRow([]);

    // Energy Report
    const floor1Energy = calculateFloorEnergy('floor1');
    const floor2Energy = calculateFloorEnergy('floor2');

    sheet.mergeCells('A4:D4');
    sheet.getCell('A4').value = 'ENERGY CONSUMPTION REPORT';
    sheet.getCell('A4').font = { size: 15, bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getCell('A4').alignment = { horizontal: 'center', vertical: 'middle' };
    sheet.getCell('A4').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF6B00' } };
    sheet.getRow(4).height = 28;

    sheet.mergeCells('A5:D5');
    sheet.getCell('A5').value = `Price: ${CONFIG.electricityPrice.toLocaleString('vi-VN')} VND/kWh | LED: ${CONFIG.devicePower.led}W | Fan: ${CONFIG.devicePower.fan}W | Fog: ${CONFIG.devicePower.fog}W | Heater: ${CONFIG.devicePower.heater}W`;
    sheet.getCell('A5').font = { size: 10, italic: true, bold: true };
    sheet.getCell('A5').alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    sheet.getCell('A5').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFEB9C' } };
    sheet.getRow(5).height = 35;

    sheet.addRow([]);

    // Total
    const totalDailyEnergy = parseFloat(floor1Energy.totalEnergy) + parseFloat(floor2Energy.totalEnergy);
    const totalDailyCost = floor1Energy.totalCost + floor2Energy.totalCost;
    const totalMonthlyEnergy = totalDailyEnergy * 30;
    const totalMonthlyCost = totalDailyCost * 30;

    sheet.mergeCells('A7:D7');
    sheet.getCell('A7').value = 'TOTAL (BOTH FLOORS)';
    sheet.getCell('A7').font = { size: 13, bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getCell('A7').alignment = { horizontal: 'center', vertical: 'middle' };
    sheet.getCell('A7').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDC143C' } };
    sheet.getRow(7).height = 25;

    let row = 8;

    sheet.getCell(`A${row}`).value = 'Today Energy:';
    sheet.getCell(`A${row}`).font = { bold: true, size: 11 };
    sheet.getCell(`A${row}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFEB9C' } };
    sheet.getCell(`B${row}`).value = `${totalDailyEnergy.toFixed(3)} kWh`;
    sheet.getCell(`B${row}`).font = { bold: true, size: 11, color: { argb: 'FF0066CC' } };
    sheet.getCell(`B${row}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFEB9C' } };

    sheet.getCell(`C${row}`).value = 'Today Cost:';
    sheet.getCell(`C${row}`).font = { bold: true, size: 11 };
    sheet.getCell(`C${row}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFEB9C' } };
    sheet.getCell(`D${row}`).value = `${totalDailyCost.toLocaleString('vi-VN')} VND`;
    sheet.getCell(`D${row}`).font = { bold: true, size: 11, color: { argb: 'FFDC143C' } };
    sheet.getCell(`D${row}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFEB9C' } };
    sheet.getRow(row).height = 22;
    row++;

    sheet.getCell(`A${row}`).value = 'Monthly Est. (30 days):';
    sheet.getCell(`A${row}`).font = { bold: true, size: 11 };
    sheet.getCell(`A${row}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFEB9C' } };
    sheet.getCell(`B${row}`).value = `${totalMonthlyEnergy.toFixed(2)} kWh`;
    sheet.getCell(`B${row}`).font = { bold: true, size: 11, color: { argb: 'FF0066CC' } };
    sheet.getCell(`B${row}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFEB9C' } };

    sheet.getCell(`C${row}`).value = 'Monthly Cost:';
    sheet.getCell(`C${row}`).font = { bold: true, size: 11 };
    sheet.getCell(`C${row}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFEB9C' } };
    sheet.getCell(`D${row}`).value = `${Math.round(totalMonthlyCost).toLocaleString('vi-VN')} VND`;
    sheet.getCell(`D${row}`).font = { bold: true, size: 11, color: { argb: 'FFDC143C' } };
    sheet.getCell(`D${row}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFEB9C' } };
    sheet.getRow(row).height = 22;
    row += 2;

    // Floor 1 Details
    sheet.mergeCells(`A${row}:D${row}`);
    sheet.getCell(`A${row}`).value = 'FLOOR 1 ENERGY DETAILS';
    sheet.getCell(`A${row}`).font = { size: 12, bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getCell(`A${row}`).alignment = { horizontal: 'center' };
    sheet.getCell(`A${row}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };
    sheet.getRow(row).height = 22;
    row++;

    const headerRow1 = sheet.getRow(row);
    headerRow1.values = ['Device', 'Runtime (h)', 'Energy (kWh)', 'Cost (VND)'];
    headerRow1.font = { bold: true, size: 10 };
    headerRow1.alignment = { horizontal: 'center', vertical: 'middle' };
    headerRow1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCE6F1' } };
    headerRow1.eachCell(cell => {
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' }
      };
    });
    headerRow1.height = 20;
    row++;

    const devices = [
      { name: 'LED', key: 'led' },
      { name: 'Fan', key: 'fan' },
      { name: 'Fog', key: 'fog' },
      { name: 'Heater', key: 'heater' }
    ];

    devices.forEach(device => {
      const data = floor1Energy.devices[device.key];
      const r = sheet.getRow(row);
      r.values = [device.name, data.runtimeHours, data.energyKWh, data.costVND.toLocaleString('vi-VN')];
      r.alignment = { horizontal: 'center', vertical: 'middle' };
      r.eachCell(cell => {
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };
      });
      row++;
    });

    const totalRow1 = sheet.getRow(row);
    totalRow1.values = ['TOTAL FLOOR 1', '', floor1Energy.totalEnergy, floor1Energy.totalCost.toLocaleString('vi-VN')];
    totalRow1.font = { bold: true, size: 11 };
    totalRow1.alignment = { horizontal: 'center', vertical: 'middle' };
    totalRow1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFD966' } };
    totalRow1.eachCell(cell => {
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' }
      };
    });
    totalRow1.height = 22;
    row += 2;

    // Floor 2 Details
    sheet.mergeCells(`A${row}:D${row}`);
    sheet.getCell(`A${row}`).value = 'FLOOR 2 ENERGY DETAILS';
    sheet.getCell(`A${row}`).font = { size: 12, bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getCell(`A${row}`).alignment = { horizontal: 'center' };
    sheet.getCell(`A${row}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF70AD47' } };
    sheet.getRow(row).height = 22;
    row++;

    const headerRow2 = sheet.getRow(row);
    headerRow2.values = ['Device', 'Runtime (h)', 'Energy (kWh)', 'Cost (VND)'];
    headerRow2.font = { bold: true, size: 10 };
    headerRow2.alignment = { horizontal: 'center', vertical: 'middle' };
    headerRow2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2EFDA' } };
    headerRow2.eachCell(cell => {
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' }
      };
    });
    headerRow2.height = 20;
    row++;

    devices.forEach(device => {
      const data = floor2Energy.devices[device.key];
      const r = sheet.getRow(row);
      r.values = [device.name, data.runtimeHours, data.energyKWh, data.costVND.toLocaleString('vi-VN')];
      r.alignment = { horizontal: 'center', vertical: 'middle' };
      r.eachCell(cell => {
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };
      });
      row++;
    });

    const totalRow2 = sheet.getRow(row);
    totalRow2.values = ['TOTAL FLOOR 2', '', floor2Energy.totalEnergy, floor2Energy.totalCost.toLocaleString('vi-VN')];
    totalRow2.font = { bold: true, size: 11 };
    totalRow2.alignment = { horizontal: 'center', vertical: 'middle' };
    totalRow2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFD966' } };
    totalRow2.eachCell(cell => {
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' }
      };
    });
    totalRow2.height = 22;

    // Sensor Data - Floor 1
    sheet.addRow([]);
    sheet.addRow([]);
    sheet.mergeCells(`A${sheet.lastRow.number}:D${sheet.lastRow.number}`);
    sheet.getCell(`A${sheet.lastRow.number}`).value = 'FLOOR 1 SENSOR DATA';
    sheet.getCell(`A${sheet.lastRow.number}`).font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
    sheet.getCell(`A${sheet.lastRow.number}`).alignment = { horizontal: 'center' };
    sheet.getCell(`A${sheet.lastRow.number}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };
    sheet.getRow(sheet.lastRow.number).height = 25;

    const temps1 = floorData.floor1.history.map(d => d.temperature).filter(t => t > 0);
    const avgTemp1 = temps1.length > 0
      ? (temps1.reduce((a, b) => a + b, 0) / temps1.length).toFixed(1)
      : floorData.floor1.temperature;
    const minTemp1 = temps1.length > 0
      ? Math.min(...temps1).toFixed(1)
      : floorData.floor1.temperature;
    const maxTemp1 = temps1.length > 0
      ? Math.max(...temps1).toFixed(1)
      : floorData.floor1.temperature;

    const hums1 = floorData.floor1.history.map(d => d.humidity).filter(h => h > 0);
    const avgHum1 = hums1.length > 0
      ? (hums1.reduce((a, b) => a + b, 0) / hums1.length).toFixed(1)
      : floorData.floor1.humidity;
    const minHum1 = hums1.length > 0
      ? Math.min(...hums1).toFixed(1)
      : floorData.floor1.humidity;
    const maxHum1 = hums1.length > 0
      ? Math.max(...hums1).toFixed(1)
      : floorData.floor1.humidity;

    sheet.addRow([]);
    sheet.mergeCells(`A${sheet.lastRow.number}:D${sheet.lastRow.number}`);
    sheet.getCell(`A${sheet.lastRow.number}`).value = 'TEMPERATURE';
    sheet.getCell(`A${sheet.lastRow.number}`).font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
    sheet.getCell(`A${sheet.lastRow.number}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF5B9BD5' } };

    sheet.addRow(['Metric', 'Value', 'Unit']);
    sheet.getRow(sheet.lastRow.number).font = { bold: true };
    sheet.getRow(sheet.lastRow.number).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCE6F1' } };

    sheet.addRow(['Average', avgTemp1, '°C']);
    sheet.addRow(['Minimum', minTemp1, '°C']);
    sheet.addRow(['Maximum', maxTemp1, '°C']);
    sheet.addRow(['Current', floorData.floor1.temperature, '°C']);

    sheet.addRow([]);
    sheet.mergeCells(`A${sheet.lastRow.number}:D${sheet.lastRow.number}`);
    sheet.getCell(`A${sheet.lastRow.number}`).value = 'HUMIDITY';
    sheet.getCell(`A${sheet.lastRow.number}`).font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
    sheet.getCell(`A${sheet.lastRow.number}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF5B9BD5' } };

    sheet.addRow(['Metric', 'Value', 'Unit']);
    sheet.getRow(sheet.lastRow.number).font = { bold: true };
    sheet.getRow(sheet.lastRow.number).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCE6F1' } };

    sheet.addRow(['Average', avgHum1, '%']);
    sheet.addRow(['Minimum', minHum1, '%']);
    sheet.addRow(['Maximum', maxHum1, '%']);
    sheet.addRow(['Current', floorData.floor1.humidity, '%']);

    sheet.addRow([]);
    sheet.mergeCells(`A${sheet.lastRow.number}:D${sheet.lastRow.number}`);
    sheet.getCell(`A${sheet.lastRow.number}`).value = 'DEVICE RUNTIME';
    sheet.getCell(`A${sheet.lastRow.number}`).font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
    sheet.getCell(`A${sheet.lastRow.number}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF5B9BD5' } };

    sheet.addRow(['Device', 'Runtime', 'Status']);
    sheet.getRow(sheet.lastRow.number).font = { bold: true };
    sheet.getRow(sheet.lastRow.number).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCE6F1' } };

    sheet.addRow(['LED', formatDuration(getDeviceRuntime('floor1', 'led')), floorData.floor1.devices.led === 'ON' ? 'ON' : 'OFF']);
    sheet.addRow(['Fan', formatDuration(getDeviceRuntime('floor1', 'fan')), floorData.floor1.devices.fan === 'ON' ? 'ON' : 'OFF']);
    sheet.addRow(['Fog', formatDuration(getDeviceRuntime('floor1', 'fog')), floorData.floor1.devices.fog === 'ON' ? 'ON' : 'OFF']);
    sheet.addRow(['Heater', formatDuration(getDeviceRuntime('floor1', 'heater')), floorData.floor1.devices.heater === 'ON' ? 'ON' : 'OFF']);

    // Sensor Data - Floor 2
    sheet.addRow([]);
    sheet.addRow([]);
    sheet.mergeCells(`A${sheet.lastRow.number}:D${sheet.lastRow.number}`);
    sheet.getCell(`A${sheet.lastRow.number}`).value = 'FLOOR 2 SENSOR DATA';
    sheet.getCell(`A${sheet.lastRow.number}`).font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
    sheet.getCell(`A${sheet.lastRow.number}`).alignment = { horizontal: 'center' };
    sheet.getCell(`A${sheet.lastRow.number}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF70AD47' } };
    sheet.getRow(sheet.lastRow.number).height = 25;

    const temps2 = floorData.floor2.history.map(d => d.temperature).filter(t => t > 0);
    const avgTemp2 = temps2.length > 0
      ? (temps2.reduce((a, b) => a + b, 0) / temps2.length).toFixed(1)
      : floorData.floor2.temperature;
    const minTemp2 = temps2.length > 0
      ? Math.min(...temps2).toFixed(1)
      : floorData.floor2.temperature;
    const maxTemp2 = temps2.length > 0
      ? Math.max(...temps2).toFixed(1)
      : floorData.floor2.temperature;

    const hums2 = floorData.floor2.history.map(d => d.humidity).filter(h => h > 0);
    const avgHum2 = hums2.length > 0
      ? (hums2.reduce((a, b) => a + b, 0) / hums2.length).toFixed(1)
      : floorData.floor2.humidity;
    const minHum2 = hums2.length > 0
      ? Math.min(...hums2).toFixed(1)
      : floorData.floor2.humidity;
    const maxHum2 = hums2.length > 0
      ? Math.max(...hums2).toFixed(1)
      : floorData.floor2.humidity;

    sheet.addRow([]);
    sheet.mergeCells(`A${sheet.lastRow.number}:D${sheet.lastRow.number}`);
    sheet.getCell(`A${sheet.lastRow.number}`).value = 'TEMPERATURE';
    sheet.getCell(`A${sheet.lastRow.number}`).font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
    sheet.getCell(`A${sheet.lastRow.number}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF92D050' } };

    sheet.addRow(['Metric', 'Value', 'Unit']);
    sheet.getRow(sheet.lastRow.number).font = { bold: true };
    sheet.getRow(sheet.lastRow.number).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2EFDA' } };

    sheet.addRow(['Average', avgTemp2, '°C']);
    sheet.addRow(['Minimum', minTemp2, '°C']);
    sheet.addRow(['Maximum', maxTemp2, '°C']);
    sheet.addRow(['Current', floorData.floor2.temperature, '°C']);

    sheet.addRow([]);
    sheet.mergeCells(`A${sheet.lastRow.number}:D${sheet.lastRow.number}`);
    sheet.getCell(`A${sheet.lastRow.number}`).value = 'HUMIDITY';
    sheet.getCell(`A${sheet.lastRow.number}`).font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
    sheet.getCell(`A${sheet.lastRow.number}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF92D050' } };

    sheet.addRow(['Metric', 'Value', 'Unit']);
    sheet.getRow(sheet.lastRow.number).font = { bold: true };
    sheet.getRow(sheet.lastRow.number).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2EFDA' } };

    sheet.addRow(['Average', avgHum2, '%']);
    sheet.addRow(['Minimum', minHum2, '%']);
    sheet.addRow(['Maximum', maxHum2, '%']);
    sheet.addRow(['Current', floorData.floor2.humidity, '%']);

    sheet.addRow([]);
    sheet.mergeCells(`A${sheet.lastRow.number}:D${sheet.lastRow.number}`);
    sheet.getCell(`A${sheet.lastRow.number}`).value = 'DEVICE RUNTIME';
    sheet.getCell(`A${sheet.lastRow.number}`).font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
    sheet.getCell(`A${sheet.lastRow.number}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF92D050' } };

    sheet.addRow(['Device', 'Runtime', 'Status']);
    sheet.getRow(sheet.lastRow.number).font = { bold: true };
    sheet.getRow(sheet.lastRow.number).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2EFDA' } };

    sheet.addRow(['LED', formatDuration(getDeviceRuntime('floor2', 'led')), floorData.floor2.devices.led === 'ON' ? 'ON' : 'OFF']);
    sheet.addRow(['Fan', formatDuration(getDeviceRuntime('floor2', 'fan')), floorData.floor2.devices.fan === 'ON' ? 'ON' : 'OFF']);
    sheet.addRow(['Fog', formatDuration(getDeviceRuntime('floor2', 'fog')), floorData.floor2.devices.fog === 'ON' ? 'ON' : 'OFF']);
    sheet.addRow(['Heater', formatDuration(getDeviceRuntime('floor2', 'heater')), floorData.floor2.devices.heater === 'ON' ? 'ON' : 'OFF']);

    // Column widths
    sheet.getColumn(1).width = 28;
    sheet.getColumn(2).width = 22;
    sheet.getColumn(3).width = 22;
    sheet.getColumn(4).width = 22;

    // History sheets
    if (floorData.floor1.history.length > 0) {
      const historySheet1 = workbook.addWorksheet('Floor 1 History');

      historySheet1.mergeCells('A1:C1');
      historySheet1.getCell('A1').value = 'FLOOR 1 TEMPERATURE & HUMIDITY HISTORY';
      historySheet1.getCell('A1').font = { size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
      historySheet1.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };
      historySheet1.getCell('A1').alignment = { horizontal: 'center' };
      historySheet1.getRow(1).height = 25;

      historySheet1.addRow([]);
      historySheet1.addRow(['Timestamp', 'Temperature (°C)', 'Humidity (%)']);
      historySheet1.getRow(3).font = { bold: true };
      historySheet1.getRow(3).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCE6F1' } };
      historySheet1.getRow(3).alignment = { horizontal: 'center' };

      floorData.floor1.history.forEach(record => {
        historySheet1.addRow([
          record.timestamp.toLocaleString('vi-VN'),
          record.temperature,
          record.humidity
        ]);
      });

      historySheet1.getColumn(1).width = 25;
      historySheet1.getColumn(2).width = 20;
      historySheet1.getColumn(3).width = 20;
    }

    if (floorData.floor2.history.length > 0) {
      const historySheet2 = workbook.addWorksheet('Floor 2 History');

      historySheet2.mergeCells('A1:C1');
      historySheet2.getCell('A1').value = 'FLOOR 2 TEMPERATURE & HUMIDITY HISTORY';
      historySheet2.getCell('A1').font = { size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
      historySheet2.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF70AD47' } };
      historySheet2.getCell('A1').alignment = { horizontal: 'center' };
      historySheet2.getRow(1).height = 25;

      historySheet2.addRow([]);
      historySheet2.addRow(['Timestamp', 'Temperature (°C)', 'Humidity (%)']);
      historySheet2.getRow(3).font = { bold: true };
      historySheet2.getRow(3).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2EFDA' } };
      historySheet2.getRow(3).alignment = { horizontal: 'center' };

      floorData.floor2.history.forEach(record => {
        historySheet2.addRow([
          record.timestamp.toLocaleString('vi-VN'),
          record.temperature,
          record.humidity
        ]);
      });

      historySheet2.getColumn(1).width = 25;
      historySheet2.getColumn(2).width = 20;
      historySheet2.getColumn(3).width = 20;
    }

    const fileName = `SwiftletFarm_Report_${getCurrentDate()}.xlsx`;
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${fileName}"`
    );

    await workbook.xlsx.write(res);
    res.end();

    console.log(`Excel exported: ${fileName}`);
  } catch (error) {
    console.error('Excel export error:', error);
    res.status(500).json({ error: 'Cannot export Excel file' });
  }
});

// ==================== START SERVER ====================
app.listen(PORT, '0.0.0.0', () => {
  const localIP = getLocalIP();

  console.log('\n' + '='.repeat(60));
  console.log('SERVER STARTED SUCCESSFULLY');
  console.log('='.repeat(60));
  console.log(`Local access: http://localhost:${PORT}`);
  console.log(`Network access: http://${localIP}:${PORT}`);
  console.log('Device Power:');
  console.log(`  - LED: ${CONFIG.devicePower.led}W`);
  console.log(`  - Fan: ${CONFIG.devicePower.fan}W`);
  console.log(`  - Fog: ${CONFIG.devicePower.fog}W`);
  console.log(`  - Heater: ${CONFIG.devicePower.heater}W`);
  console.log(
    `Electricity Price: ${CONFIG.electricityPrice.toLocaleString(
      'vi-VN'
    )} VND/kWh`
  );
  console.log('='.repeat(60) + '\n');
});