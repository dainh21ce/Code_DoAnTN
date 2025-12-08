#include "esp_camera.h"
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include "board_config.h"   // file cấu hình chân camera gốc

// Khai báo từ camera web server gốc
void startCameraServer();
void setupLedFlash();

// ============ CẤU HÌNH WIFI ============
const char* ssid      = "Bigone";
const char* password  = "88888888";
const char* serverURL = "http://172.20.10.3:3000"; // IP máy chạy Node.js

// ============ CẤU HÌNH UART ZIGBEE ============
// ESP32-CAM dùng UART0 (U0RXD/U0TXD): GPIO3, GPIO1
#define ZIGBEE_RX 3
#define ZIGBEE_TX 1

// Dùng luôn Serial cho Zigbee
#define ZigbeeSerial Serial

// ============ CẤU TRÚC DỮ LIỆU TẦNG ============
struct FloorData {
  float  temp;
  float  hum;
  String led;
  String fan;
  String heater;
  String fog;
  unsigned long lastUpdate;
  bool   online;
};

FloorData floor1 = {0, 0, "OFF", "OFF", "OFF", "OFF", 0, false};
FloorData floor2 = {0, 0, "OFF", "OFF", "OFF", "OFF", 0, false};

// ============ BUFFER NHẬN DỮ LIỆU ZIGBEE ============
String receivedZigbeeData = "";

// ============ BIẾN THỜI GIAN ============
unsigned long lastServerUpdate  = 0;
unsigned long lastCommandCheck  = 0;
unsigned long lastStatusCheck   = 0;
unsigned long wifiReconnectTime = 0;

// ============ ĐẾM LỖI WIFI ============
int wifiErrorCount = 0;
const int MAX_WIFI_ERRORS = 10;

// Nếu board không define LED_BUILTIN
#ifndef LED_BUILTIN
#define LED_BUILTIN 33
#endif

// ============ HÀM TÁCH CHUỖI ============
String getValue(String data, char separator, int index) {
  int found = 0;
  int strIndex[] = {0, -1};
  int maxIndex = data.length() - 1;

  for (int i = 0; i <= maxIndex && found <= index; i++) {
    if (data.charAt(i) == separator || i == maxIndex) {
      found++;
      strIndex[0] = strIndex[1] + 1;
      strIndex[1] = (i == maxIndex) ? i + 1 : i;
    }
  }
  return (found > index) ? data.substring(strIndex[0], strIndex[1]) : "";
}

// ============ KHỞI ĐỘNG CAMERA ============
bool initCamera() {
  camera_config_t config;
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer   = LEDC_TIMER_0;
  config.pin_d0       = Y2_GPIO_NUM;
  config.pin_d1       = Y3_GPIO_NUM;
  config.pin_d2       = Y4_GPIO_NUM;
  config.pin_d3       = Y5_GPIO_NUM;
  config.pin_d4       = Y6_GPIO_NUM;
  config.pin_d5       = Y7_GPIO_NUM;
  config.pin_d6       = Y8_GPIO_NUM;
  config.pin_d7       = Y9_GPIO_NUM;
  config.pin_xclk     = XCLK_GPIO_NUM;
  config.pin_pclk     = PCLK_GPIO_NUM;
  config.pin_vsync    = VSYNC_GPIO_NUM;
  config.pin_href     = HREF_GPIO_NUM;
  config.pin_sccb_sda = SIOD_GPIO_NUM;
  config.pin_sccb_scl = SIOC_GPIO_NUM;
  config.pin_pwdn     = PWDN_GPIO_NUM;
  config.pin_reset    = RESET_GPIO_NUM;
  config.xclk_freq_hz = 20000000;
  config.frame_size   = FRAMESIZE_UXGA;
  config.pixel_format = PIXFORMAT_JPEG;
  config.grab_mode    = CAMERA_GRAB_WHEN_EMPTY;
  config.fb_location  = CAMERA_FB_IN_PSRAM;
  config.jpeg_quality = 12;
  config.fb_count     = 1;

  if (config.pixel_format == PIXFORMAT_JPEG) {
    if (psramFound()) {
      config.jpeg_quality = 10;
      config.fb_count     = 2;
      config.grab_mode    = CAMERA_GRAB_LATEST;
    } else {
      config.frame_size   = FRAMESIZE_SVGA;
      config.fb_location  = CAMERA_FB_IN_DRAM;
    }
  } else {
    config.frame_size = FRAMESIZE_240X240;
  }

#if defined(CAMERA_MODEL_ESP_EYE)
  pinMode(13, INPUT_PULLUP);
  pinMode(14, INPUT_PULLUP);
#endif

  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    return false;
  }

  sensor_t *s = esp_camera_sensor_get();
  if (s->id.PID == OV3660_PID) {
    s->set_vflip(s, 1);
    s->set_brightness(s, 1);
    s->set_saturation(s, -2);
  }
  if (config.pixel_format == PIXFORMAT_JPEG) {
    s->set_framesize(s, FRAMESIZE_QVGA);
  }

#if defined(CAMERA_MODEL_M5STACK_WIDE) || defined(CAMERA_MODEL_M5STACK_ESP32CAM)
  s->set_vflip(s, 1);
  s->set_hmirror(s, 1);
#endif

#if defined(CAMERA_MODEL_ESP32S3_EYE)
  s->set_vflip(s, 1);
#endif

#if defined(LED_GPIO_NUM)
  setupLedFlash();
#endif

  return true;
}

// ============ KẾT NỐI WIFI ============
void connectWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, password);
  WiFi.setSleep(false);

  Serial.print("Dang ket noi WiFi");
  int timeout = 0;
  while (WiFi.status() != WL_CONNECTED && timeout < 30) {
    delay(500);
    Serial.print(".");
    timeout++;
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    wifiErrorCount = 0;
    Serial.print("Da ket noi WiFi, IP: ");
    Serial.println(WiFi.localIP());
  } else {
    wifiErrorCount++;
    Serial.println("Ket noi WiFi that bai");
  }
}

// ============ NHẬN DỮ LIỆU TỪ ZIGBEE ============
void parseZigbeeData(String data);

void receiveZigbeeData() {
  while (ZigbeeSerial.available()) {
    char c = ZigbeeSerial.read();

    if (c == '\n' || c == '\r') {
      if (receivedZigbeeData.length() > 5) {
        parseZigbeeData(receivedZigbeeData);
        receivedZigbeeData = "";
      }
    } else if (c >= 32 && c <= 126) {
      receivedZigbeeData += c;
      if (receivedZigbeeData.length() > 200) {
        receivedZigbeeData = "";
      }
    }
  }
}

void parseZigbeeData(String data) {
  // F1:28.5:75.2:0:1:0:0 hoặc F2:...
  Serial.print("Nhan Zigbee: ");
  Serial.println(data);

  if (data.startsWith("F1:")) {
    int idx = 0;
    getValue(data, ':', idx++);  // Skip "F1"

    floor1.temp   = getValue(data, ':', idx++).toFloat();
    floor1.hum    = getValue(data, ':', idx++).toFloat();
    floor1.led    = (getValue(data, ':', idx++) == "1") ? "ON" : "OFF";
    floor1.fan    = (getValue(data, ':', idx++) == "1") ? "ON" : "OFF";
    floor1.heater = (getValue(data, ':', idx++) == "1") ? "ON" : "OFF";
    floor1.fog    = (getValue(data, ':', idx++) == "1") ? "ON" : "OFF";
    floor1.lastUpdate = millis();
    floor1.online     = true;
  }
  else if (data.startsWith("F2:")) {
    int idx = 0;
    getValue(data, ':', idx++);  // Skip "F2"

    floor2.temp   = getValue(data, ':', idx++).toFloat();
    floor2.hum    = getValue(data, ':', idx++).toFloat();
    floor2.led    = (getValue(data, ':', idx++) == "1") ? "ON" : "OFF";
    floor2.fan    = (getValue(data, ':', idx++) == "1") ? "ON" : "OFF";
    floor2.heater = (getValue(data, ':', idx++) == "1") ? "ON" : "OFF";
    floor2.fog    = (getValue(data, ':', idx++) == "1") ? "ON" : "OFF";
    floor2.lastUpdate = millis();
    floor2.online     = true;
  }
}

// ============ GỬI DỮ LIỆU LÊN SERVER ============
void sendDataToServer() {
  if (WiFi.status() != WL_CONNECTED) return;

  HTTPClient http;
  http.begin(String(serverURL) + "/update");
  http.addHeader("Content-Type", "application/json");
  http.setTimeout(10000);

  StaticJsonDocument<512> doc;

  JsonObject f1 = doc.createNestedObject("floor1");
  f1["temp"]   = floor1.temp;
  f1["hum"]    = floor1.hum;
  f1["led"]    = floor1.led;
  f1["fan"]    = floor1.fan;
  f1["heater"] = floor1.heater;
  f1["fog"]    = floor1.fog;

  JsonObject f2 = doc.createNestedObject("floor2");
  f2["temp"]   = floor2.temp;
  f2["hum"]    = floor2.hum;
  f2["led"]    = floor2.led;
  f2["fan"]    = floor2.fan;
  f2["heater"] = floor2.heater;
  f2["fog"]    = floor2.fog;

  String jsonString;
  serializeJson(doc, jsonString);

  int httpCode = http.POST(jsonString);
  Serial.print("POST /update httpCode=");
  Serial.println(httpCode);

  if (httpCode == 200) {
    wifiErrorCount = 0;
  } else if (httpCode <= 0) {
    wifiErrorCount++;
  }

  http.end();
}

// ============ GỬI LỆNH ĐIỀU KHIỂN QUA ZIGBEE ============
void sendControlCommandViaZigbee(int floor, FloorData& data) {
  String cmd = "C" + String(floor) + ":";
  cmd += (data.led    == "ON") ? "1:" : "0:";
  cmd += (data.fan    == "ON") ? "1:" : "0:";
  cmd += (data.heater == "ON") ? "1:" : "0:";
  cmd += (data.fog    == "ON") ? "1"  : "0";
  cmd += "\n";

  Serial.print("Send Zigbee cmd: ");
  Serial.println(cmd);

  ZigbeeSerial.print(cmd);
}

// ============ NHẬN LỆNH TỪ SERVER ============
void checkCommandsFromServer() {
  if (WiFi.status() != WL_CONNECTED) return;

  HTTPClient http;
  http.begin(String(serverURL) + "/commands");
  http.setTimeout(5000);

  int httpCode = http.GET();
  Serial.print("GET /commands httpCode=");
  Serial.println(httpCode);

  if (httpCode == 200) {
    String payload = http.getString();
    Serial.println("Payload /commands:");
    Serial.println(payload);

    StaticJsonDocument<512> doc;
    DeserializationError error = deserializeJson(doc, payload);

    if (!error) {
      bool hasCommand = false;

      // Floor 1
      if (doc.containsKey("floor1")) {
        String led    = doc["floor1"]["led"]    | "OFF";
        String fan    = doc["floor1"]["fan"]    | "OFF";
        String heater = doc["floor1"]["heater"] | "OFF";
        String fog    = doc["floor1"]["fog"]    | "OFF";

        if (led != floor1.led || fan != floor1.fan ||
            heater != floor1.heater || fog != floor1.fog) {

          floor1.led    = led;
          floor1.fan    = fan;
          floor1.heater = heater;
          floor1.fog    = fog;

          Serial.println("Command change Floor1 -> send Zigbee");
          sendControlCommandViaZigbee(1, floor1);
          hasCommand = true;
        }
      }

      // Floor 2
      if (doc.containsKey("floor2")) {
        String led    = doc["floor2"]["led"]    | "OFF";
        String fan    = doc["floor2"]["fan"]    | "OFF";
        String heater = doc["floor2"]["heater"] | "OFF";
        String fog    = doc["floor2"]["fog"]    | "OFF";

        if (led != floor2.led || fan != floor2.fan ||
            heater != floor2.heater || fog != floor2.fog) {

          floor2.led    = led;
          floor2.fan    = fan;
          floor2.heater = heater;
          floor2.fog    = fog;

          Serial.println("Command change Floor2 -> send Zigbee");
          sendControlCommandViaZigbee(2, floor2);
          hasCommand = true;
        }
      }

      (void)hasCommand;
    }
  }

  http.end();
}

// ============ KIỂM TRA TRẠNG THÁI ONLINE ============
void checkDeviceStatus() {
  unsigned long now = millis();

  if (now - floor1.lastUpdate > 15000) {
    floor1.online = false;
  }

  if (now - floor2.lastUpdate > 15000) {
    floor2.online = false;
  }
}

// ============ KIỂM TRA VÀ RECONNECT WIFI ============
void checkWiFiConnection() {
  if (WiFi.status() != WL_CONNECTED) {
    unsigned long now = millis();

    if (now - wifiReconnectTime > 30000) {
      Serial.println("Mat WiFi, dang reconnect...");
      WiFi.reconnect();
      wifiReconnectTime = now;

      delay(5000);

      if (WiFi.status() == WL_CONNECTED) {
        wifiErrorCount = 0;
        Serial.print("Da reconnect WiFi, IP: ");
        Serial.println(WiFi.localIP());
      } else {
        wifiErrorCount++;
        if (wifiErrorCount >= MAX_WIFI_ERRORS) {
          Serial.println("Qua nhieu loi WiFi, reboot ESP32-CAM");
          delay(2000);
          ESP.restart();
        }
      }
    }
  }
}

// ============ SETUP ============
void setup() {
  ZigbeeSerial.begin(115200);   // Serial cho Zigbee + debug
  ZigbeeSerial.setDebugOutput(false);
  delay(1000);

  pinMode(LED_BUILTIN, OUTPUT);
  digitalWrite(LED_BUILTIN, LOW);

  Serial.println();
  Serial.println("ESP32-CAM COORDINATOR START");

  // Khởi động camera
  if (!initCamera()) {
    Serial.println("Init camera FAILED, blink forever");
    while (true) {
      digitalWrite(LED_BUILTIN, !digitalRead(LED_BUILTIN));
      delay(500);
    }
  }

  // Kết nối WiFi
  connectWiFi();

  // Khởi động camera web server
  startCameraServer();
  Serial.println("Camera web server started");
}

// ============ LOOP ============
void loop() {
  // 1. Nhận dữ liệu từ Zigbee
  receiveZigbeeData();

  unsigned long now = millis();

  // 2. Gửi dữ liệu lên Server mỗi 3 giây
  if (now - lastServerUpdate >= 3000) {
    sendDataToServer();
    lastServerUpdate = now;
  }

  // 3. Kiểm tra lệnh từ Server mỗi 2 giây
  if (now - lastCommandCheck >= 2000) {
    checkCommandsFromServer();
    lastCommandCheck = now;
  }

  // 4. Kiểm tra Online/Offline mỗi 5 giây
  if (now - lastStatusCheck >= 5000) {
    checkDeviceStatus();
    lastStatusCheck = now;
  }

  // 5. Kiểm tra WiFi
  checkWiFiConnection();

  // 6. LED nhấp nháy nhẹ
  static unsigned long lastBlink = 0;
  static bool blinkState = false;
  if (now - lastBlink >= 500) {
    blinkState = !blinkState;
    digitalWrite(LED_BUILTIN, blinkState ? HIGH : LOW);
    lastBlink = now;
  }

  delay(50);
}