// ==================== DEPENDENCIES ====================
const express = require('express');
const cors = require('cors');
const path = require('path');
const os = require('os');

// ==================== APP SETUP ====================
const app = express();
const PORT = 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
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

// ==================== DETECTION DATA STORAGE ====================
const detectionHistory = {
  day1: [], // Hôm nay
  day2: [], // Hôm qua
  day3: []  // Hôm kia
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

    // Reset detection history (chuyển ngày)
    detectionHistory.day3 = detectionHistory.day2;
    detectionHistory.day2 = detectionHistory.day1;
    detectionHistory.day1 = [];

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

    console.log(`✅ Daily reset completed: ${today}`);
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

// ==================== API: TEST POPULATE DATA ====================
app.get('/test-populate-days', (req, res) => {
  console.log('🧪 Populating test detection data for 3 days...');
  
  // Clear existing data
  detectionHistory.day1 = [];
  detectionHistory.day2 = [];
  detectionHistory.day3 = [];
  
  // Ngày 1 (Hôm nay) - 10 frames
  for (let i = 1; i <= 10; i++) {
    detectionHistory.day1.push({
      id: Date.now() + i,
      imageUrl: `https://picsum.photos/200/300?random=${i}`,
      imageBase64: null,
      timestamp: new Date(Date.now() - i * 60000).toISOString(),
      description: `Hôm nay - Frame ${i}`,
      confidence: Math.random().toFixed(2),
      status: 'detected'
    });
  }
  
  // Ngày 2 (Hôm qua) - 10 frames
  for (let i = 1; i <= 10; i++) {
    detectionHistory.day2.push({
      id: Date.now() + i * 1000,
      imageUrl: `https://picsum.photos/200/300?random=${100 + i}`,
      imageBase64: null,
      timestamp: new Date(Date.now() - 86400000 - i * 60000).toISOString(),
      description: `Hôm qua - Frame ${i}`,
      confidence: Math.random().toFixed(2),
      status: 'detected'
    });
  }
  
  // Ngày 3 (Hôm kia) - 10 frames
  for (let i = 1; i <= 10; i++) {
    detectionHistory.day3.push({
      id: Date.now() + i * 2000,
      imageUrl: `https://picsum.photos/200/300?random=${200 + i}`,
      imageBase64: null,
      timestamp: new Date(Date.now() - 172800000 - i * 60000).toISOString(),
      description: `Hôm kia - Frame ${i}`,
      confidence: Math.random().toFixed(2),
      status: 'detected'
    });
  }
  
  console.log('✅ Test data populated successfully!');
  console.log(`  - Day 1: ${detectionHistory.day1.length} frames`);
  console.log(`  - Day 2: ${detectionHistory.day2.length} frames`);
  console.log(`  - Day 3: ${detectionHistory.day3.length} frames`);
  
  res.json({
    success: true,
    message: 'Test data populated for 3 days',
    data: {
      day1: detectionHistory.day1.length,
      day2: detectionHistory.day2.length,
      day3: detectionHistory.day3.length
    }
  });
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
app.post('/update', (req, res) => {
  try {
    const { floor1, floor2 } = req.body || {};

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

// ==================== API: STATS DETAIL (CHO MODAL THỐNG KÊ) ====================
app.get('/stats-detail', (req, res) => {
  checkAndResetDaily();

  const floor1Data = floorData.floor1.history.slice(-20).map(record => ({
    timestamp: record.timestamp,
    temperature: record.temperature,
    humidity: record.humidity,
    led: floorData.floor1.devices.led,
    fan: floorData.floor1.devices.fan,
    fog: floorData.floor1.devices.fog,
    heater: floorData.floor1.devices.heater
  }));

  const floor2Data = floorData.floor2.history.slice(-20).map(record => ({
    timestamp: record.timestamp,
    temperature: record.temperature,
    humidity: record.humidity,
    led: floorData.floor2.devices.led,
    fan: floorData.floor2.devices.fan,
    fog: floorData.floor2.devices.fog,
    heater: floorData.floor2.devices.heater
  }));

  // Tính toán trung bình
  const calcAvg = (data, key) => {
    if (data.length === 0) return 0;
    const sum = data.reduce((acc, item) => acc + parseFloat(item[key] || 0), 0);
    return (sum / data.length).toFixed(1);
  };

  const avgTemp1 = calcAvg(floorData.floor1.history, 'temperature');
  const avgTemp2 = calcAvg(floorData.floor2.history, 'temperature');
  const avgTemp = floorData.floor1.history.length > 0 && floorData.floor2.history.length > 0
    ? ((parseFloat(avgTemp1) + parseFloat(avgTemp2)) / 2).toFixed(1)
    : avgTemp1 || avgTemp2 || '0.0';

  const avgHum1 = calcAvg(floorData.floor1.history, 'humidity');
  const avgHum2 = calcAvg(floorData.floor2.history, 'humidity');
  const avgHum = floorData.floor1.history.length > 0 && floorData.floor2.history.length > 0
    ? ((parseFloat(avgHum1) + parseFloat(avgHum2)) / 2).toFixed(1)
    : avgHum1 || avgHum2 || '0.0';

  // Lấy thông tin điện năng
  const floor1Energy = calculateFloorEnergy('floor1');
  const floor2Energy = calculateFloorEnergy('floor2');
  const totalEnergy = (parseFloat(floor1Energy.totalEnergy) + parseFloat(floor2Energy.totalEnergy)).toFixed(2);
  const totalCost = formatCurrency(floor1Energy.totalCost + floor2Energy.totalCost);

  res.json({
    success: true,
    summary: {
      avgTemp: avgTemp,
      avgHum: avgHum,
      totalEnergy: totalEnergy,
      totalCost: totalCost
    },
    floor1: floor1Data,
    floor2: floor2Data
  });
});

// ==================== API: ZIGBEE COORDINATOR /commands ====================
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

// ==================== API: DETECTION HISTORY ====================
app.get('/detection-history', (req, res) => {
  checkAndResetDaily();

  const day = parseInt(req.query.day) || 1;
  
  let data = [];
  let dateLabel = '';

  switch(day) {
    case 1:
      data = detectionHistory.day1;
      dateLabel = 'Hôm nay';
      break;
    case 2:
      data = detectionHistory.day2;
      dateLabel = 'Hôm qua';
      break;
    case 3:
      data = detectionHistory.day3;
      dateLabel = 'Hôm kia';
      break;
    default:
      data = detectionHistory.day1;
      dateLabel = 'Hôm nay';
  }

  res.json({
    success: true,
    day,
    dateLabel,
    count: data.length,
    data: data
  });
});

// ==================== API: ADD DETECTION ====================
app.post('/detection-add', (req, res) => {
  checkAndResetDaily();

  try {
    const { imageUrl, imageBase64, description, confidence } = req.body;

    const detection = {
      id: Date.now(),
      imageUrl: imageUrl || null,
      imageBase64: imageBase64 || null,
      timestamp: new Date().toISOString(),
      description: description || 'Phát hiện sinh vật lạ',
      confidence: confidence || 0,
      status: 'detected'
    };

    detectionHistory.day1.push(detection);

    // Giới hạn 50 frame/ngày
    if (detectionHistory.day1.length > 50) {
      detectionHistory.day1.shift();
    }

    console.log(`✅ Detection added: ${detection.description} at ${detection.timestamp}`);

    res.json({
      success: true,
      message: 'Detection frame added successfully',
      detection: detection
    });

  } catch (error) {
    console.error('❌ Error adding detection:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to add detection frame'
    });
  }
});

// ==================== API: DELETE DETECTION ====================
app.delete('/detection-delete/:id', (req, res) => {
  const id = parseInt(req.params.id);

  let found = false;

  ['day1', 'day2', 'day3'].forEach(dayKey => {
    const index = detectionHistory[dayKey].findIndex(d => d.id === id);
    if (index !== -1) {
      detectionHistory[dayKey].splice(index, 1);
      found = true;
    }
  });

  if (found) {
    console.log(`✅ Detection deleted: ID ${id}`);
    res.json({ success: true, message: 'Detection deleted' });
  } else {
    res.status(404).json({ success: false, error: 'Detection not found' });
  }
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

// ==================== START SERVER ====================
app.listen(PORT, '0.0.0.0', () => {
  const localIP = getLocalIP();

  console.log('\n' + '='.repeat(60));
  console.log('🚀 SERVER STARTED SUCCESSFULLY');
  console.log('='.repeat(60));
  console.log(`📍 Local access: http://localhost:${PORT}`);
  console.log(`🌐 Network access: http://${localIP}:${PORT}`);
  console.log('\n📡 API Endpoints:');
  console.log('  - GET  /                           (Client HTML)');
  console.log('  - GET  /test-populate-days         (Tạo dữ liệu test 3 ngày)');
  console.log('  - GET  /data                       (Lấy dữ liệu realtime)');
  console.log('  - GET  /stats                      (Lấy thống kê thiết bị)');
  console.log('  - GET  /stats-detail               (Lấy thống kê chi tiết)');
  console.log('  - GET  /history/:floor             (Lấy lịch sử cảm biến)');
  console.log('  - GET  /energy-report              (Báo cáo điện năng)');
  console.log('  - GET  /detection-history?day=1    (Lịch sử phát hiện)');
  console.log('  - POST /detection-add              (Thêm frame phát hiện)');
  console.log('  - DELETE /detection-delete/:id     (Xóa frame phát hiện)');
  console.log('  - POST /floor1                     (ESP32 Floor 1 data)');
  console.log('  - POST /floor2                     (ESP32 Floor 2 data)');
  console.log('  - POST /update                     (Zigbee Coordinator data)');
  console.log('  - GET  /commands                   (Zigbee get commands)');
  console.log('  - POST /floor1/:device             (Control Floor 1 devices)');
  console.log('  - POST /floor2/:device             (Control Floor 2 devices)');
  console.log('  - POST /update-power               (Update device power)');
  console.log('  - POST /update-price               (Update electricity price)');
  console.log('\n⚡ Device Power Configuration:');
  console.log(`  - LED: ${CONFIG.devicePower.led}W`);
  console.log(`  - Fan: ${CONFIG.devicePower.fan}W`);
  console.log(`  - Fog: ${CONFIG.devicePower.fog}W`);
  console.log(`  - Heater: ${CONFIG.devicePower.heater}W`);
  console.log(`💰 Electricity Price: ${CONFIG.electricityPrice.toLocaleString('vi-VN')} VND/kWh`);
  console.log('='.repeat(60) + '\n');
  console.log('🧪 TIP: Visit http://localhost:3000/test-populate-days to create test data\n');
});