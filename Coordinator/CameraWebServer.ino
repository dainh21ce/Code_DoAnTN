#include "esp_camera.h"
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include "esp_http_server.h"

// ============ CẤU HÌNH CAMERA (BOARD CONFIG) ============
// AI Thinker ESP32-CAM
#define PWDN_GPIO_NUM 32
#define RESET_GPIO_NUM -1
#define XCLK_GPIO_NUM 0
#define SIOD_GPIO_NUM 26
#define SIOC_GPIO_NUM 27

#define Y9_GPIO_NUM 35
#define Y8_GPIO_NUM 34
#define Y7_GPIO_NUM 39
#define Y6_GPIO_NUM 36
#define Y5_GPIO_NUM 21
#define Y4_GPIO_NUM 19
#define Y3_GPIO_NUM 18
#define Y2_GPIO_NUM 5
#define VSYNC_GPIO_NUM 25
#define HREF_GPIO_NUM 23
#define PCLK_GPIO_NUM 22

// ============ CẤU HÌNH WIFI ============
const char *ssid = "Bigone";
const char *password = "88888888";
const char *serverURL = "http://172.20.10.3:3000";

// ============ CẤU HÌNH UART ============
#define ZIGBEE_RX 3
#define ZIGBEE_TX 1
#define ZigbeeSerial Serial

// ============ CẤU TRÚC DỮ LIỆU TẦNG ============
struct FloorData
{
  String id;
  String name;
  float temp;
  float hum;
  bool led;
  bool fog;
  bool fan;
  bool heater;
  unsigned long lastUpdate;
  bool online;
};

FloorData floor1 = {"ESP001", "Tang 1", 0, 0, false, false, false, false, 0, false};
FloorData floor2 = {"ESP002", "Tang 2", 0, 0, false, false, false, false, 0, false};

// ============ BUFFER NHẬN DỮ LIỆU ============
String receivedData = "";

// ============ BIẾN THỜI GIAN ============
unsigned long lastServerUpdate = 0;
unsigned long lastCommandCheck = 0;
unsigned long lastStatusCheck = 0;
unsigned long wifiReconnectTime = 0;

// ============ ĐẾM LỖI WIFI ============
int wifiErrorCount = 0;
const int MAX_WIFI_ERRORS = 10;

#ifndef LED_BUILTIN
#define LED_BUILTIN 33
#endif

// ============ HTTP SERVER ============
httpd_handle_t camera_httpd = NULL;

// ============ KHỞI ĐỘNG CAMERA ============
bool initCamera()
{
  camera_config_t config;
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer = LEDC_TIMER_0;
  config.pin_d0 = Y2_GPIO_NUM;
  config.pin_d1 = Y3_GPIO_NUM;
  config.pin_d2 = Y4_GPIO_NUM;
  config.pin_d3 = Y5_GPIO_NUM;
  config.pin_d4 = Y6_GPIO_NUM;
  config.pin_d5 = Y7_GPIO_NUM;
  config.pin_d6 = Y8_GPIO_NUM;
  config.pin_d7 = Y9_GPIO_NUM;
  config.pin_xclk = XCLK_GPIO_NUM;
  config.pin_pclk = PCLK_GPIO_NUM;
  config.pin_vsync = VSYNC_GPIO_NUM;
  config.pin_href = HREF_GPIO_NUM;
  config.pin_sccb_sda = SIOD_GPIO_NUM;
  config.pin_sccb_scl = SIOC_GPIO_NUM;
  config.pin_pwdn = PWDN_GPIO_NUM;
  config.pin_reset = RESET_GPIO_NUM;
  config.xclk_freq_hz = 20000000;
  config.frame_size = FRAMESIZE_SVGA; // ← ĐỔI SANG SVGA
  config.pixel_format = PIXFORMAT_JPEG;
  config.grab_mode = CAMERA_GRAB_WHEN_EMPTY;
  config.fb_location = CAMERA_FB_IN_PSRAM;
  config.jpeg_quality = 12;
  config.fb_count = 1;

  if (config.pixel_format == PIXFORMAT_JPEG)
  {
    if (psramFound())
    {
      config.jpeg_quality = 10;
      config.fb_count = 2;
      config.grab_mode = CAMERA_GRAB_LATEST;
    }
    else
    {
      config.frame_size = FRAMESIZE_SVGA;
      config.fb_location = CAMERA_FB_IN_DRAM;
    }
  }
  else
  {
    config.frame_size = FRAMESIZE_240X240;
  }

  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK)
  {
    Serial.printf("Camera init failed with error 0x%x\n", err);
    return false;
  }

  sensor_t *s = esp_camera_sensor_get();
  if (s->id.PID == OV3660_PID)
  {
    s->set_vflip(s, 1);
    s->set_brightness(s, 1);
    s->set_saturation(s, -2);
  }

  return true;
}

// ============ CAMERA WEB SERVER ============
static esp_err_t index_handler(httpd_req_t *req)
{
  const char *html = R"rawliteral(
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ESP32-CAM Stream</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    html, body { 
      width: 100%;
      height: 100%;
      overflow: hidden;
    }
    body { 
      background: #000;
      display: flex;
      flex-direction: column;
    }
    .header {
      background: rgba(0, 0, 0, 0.8);
      padding: 10px 20px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      color: white;
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      z-index: 10;
    }
    .status {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 16px;
    }
    .status-dot {
      width: 10px;
      height: 10px;
      background: #4ade80;
      border-radius: 50%;
      animation: pulse 2s infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.5; transform: scale(0.9); }
    }
    .stream-container {
      width: 100%;
      height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #000;
    }
    img { 
      width: 100%;
      height: 100%;
      object-fit: contain;
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="status">
      <span class="status-dot"></span>
      <span>Camera Online</span>
    </div>
    <div style="font-size: 14px; opacity: 0.8;">ESP32-CAM</div>
  </div>
  
  <div class="stream-container">
    <img id="stream" src="/stream" alt="Camera Stream">
  </div>
  
  <script>
    const streamImg = document.getElementById('stream');
    
    streamImg.onerror = function() {
      console.log('Stream error, reloading...');
      setTimeout(() => {
        this.src = '/stream?t=' + Date.now();
      }, 1000);
    };
    
    // Click để toggle fullscreen
    streamImg.addEventListener('click', function() {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen();
      } else {
        document.exitFullscreen();
      }
    });
  </script>
</body>
</html>
)rawliteral";

  httpd_resp_set_type(req, "text/html");
  return httpd_resp_send(req, html, HTTPD_RESP_USE_STRLEN);
}
// Handler cho stream
static esp_err_t stream_handler(httpd_req_t *req)
{
  camera_fb_t *fb = NULL;
  esp_err_t res = ESP_OK;
  size_t _jpg_buf_len = 0;
  uint8_t *_jpg_buf = NULL;
  char *part_buf[64];

  static const char *_STREAM_CONTENT_TYPE = "multipart/x-mixed-replace;boundary=frame";
  static const char *_STREAM_BOUNDARY = "\r\n--frame\r\n";
  static const char *_STREAM_PART = "Content-Type: image/jpeg\r\nContent-Length: %u\r\n\r\n";

  res = httpd_resp_set_type(req, _STREAM_CONTENT_TYPE);
  if (res != ESP_OK)
  {
    return res;
  }

  while (true)
  {
    fb = esp_camera_fb_get();
    if (!fb)
    {
      Serial.println("Camera capture failed");
      res = ESP_FAIL;
    }
    else
    {
      if (fb->format != PIXFORMAT_JPEG)
      {
        bool jpeg_converted = frame2jpg(fb, 80, &_jpg_buf, &_jpg_buf_len);
        esp_camera_fb_return(fb);
        fb = NULL;
        if (!jpeg_converted)
        {
          Serial.println("JPEG compression failed");
          res = ESP_FAIL;
        }
      }
      else
      {
        _jpg_buf_len = fb->len;
        _jpg_buf = fb->buf;
      }
    }
    if (res == ESP_OK)
    {
      size_t hlen = snprintf((char *)part_buf, 64, _STREAM_PART, _jpg_buf_len);
      res = httpd_resp_send_chunk(req, (const char *)part_buf, hlen);
    }
    if (res == ESP_OK)
    {
      res = httpd_resp_send_chunk(req, (const char *)_jpg_buf, _jpg_buf_len);
    }
    if (res == ESP_OK)
    {
      res = httpd_resp_send_chunk(req, _STREAM_BOUNDARY, strlen(_STREAM_BOUNDARY));
    }
    if (fb)
    {
      esp_camera_fb_return(fb);
      fb = NULL;
      _jpg_buf = NULL;
    }
    else if (_jpg_buf)
    {
      free(_jpg_buf);
      _jpg_buf = NULL;
    }
    if (res != ESP_OK)
    {
      break;
    }
  }
  return res;
}

// Khởi động camera web server
void startCameraServer()
{
  httpd_config_t config = HTTPD_DEFAULT_CONFIG();
  config.server_port = 80;

  httpd_uri_t index_uri = {
      .uri = "/",
      .method = HTTP_GET,
      .handler = index_handler,
      .user_ctx = NULL};

  httpd_uri_t stream_uri = {
      .uri = "/stream",
      .method = HTTP_GET,
      .handler = stream_handler,
      .user_ctx = NULL};

  if (httpd_start(&camera_httpd, &config) == ESP_OK)
  {
    httpd_register_uri_handler(camera_httpd, &index_uri);
    httpd_register_uri_handler(camera_httpd, &stream_uri);
    Serial.println("✅ Camera web server started");
    Serial.print("   Camera URL: http://");
    Serial.println(WiFi.localIP());
  }
  else
  {
    Serial.println("❌ Camera web server failed to start");
  }
}

// ============ KẾT NỐI WIFI ============
void connectWiFi()
{
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, password);
  WiFi.setSleep(false);

  Serial.println("========================================");
  Serial.print("Connecting to WiFi: ");
  Serial.println(ssid);

  int timeout = 0;
  while (WiFi.status() != WL_CONNECTED && timeout < 30)
  {
    delay(500);
    Serial.print(".");
    timeout++;
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED)
  {
    wifiErrorCount = 0;
    Serial.println("✅ WiFi CONNECTED!");
    Serial.print("   IP Address: ");
    Serial.println(WiFi.localIP());
    Serial.print("   Camera: http://");
    Serial.println(WiFi.localIP());
  }
  else
  {
    wifiErrorCount++;
    Serial.println("❌ WiFi CONNECTION FAILED!");
  }
  Serial.println("========================================");
}

// ============ XỬ LÝ GÓI TIN UART ============
void parseUartPacket(const String &packet)
{
  Serial.print("[UART-RX] ");
  Serial.println(packet);

  int p1 = packet.indexOf('#');
  if (p1 < 0)
    return;

  int p2 = packet.indexOf('#', p1 + 1);
  if (p2 < 0)
    return;

  int p3 = packet.indexOf('#', p2 + 1);
  if (p3 < 0)
    return;

  int p4 = packet.indexOf('#', p3 + 1);
  int p5 = packet.indexOf('#', p4 + 1);
  int p6 = packet.indexOf('#', p5 + 1);
  int p7 = packet.indexOf('#', p6 + 1);

  String id = packet.substring(0, p1);
  String floor = packet.substring(p1 + 1, p2);
  String tstr = packet.substring(p2 + 1, p3);
  String hstr = (p4 > 0) ? packet.substring(p3 + 1, p4) : "0";
  String fogS = (p5 > 0) ? packet.substring(p4 + 1, p5) : "0";
  String fanS = (p6 > 0) ? packet.substring(p5 + 1, p6) : "0";
  String heaS = (p7 > 0) ? packet.substring(p6 + 1, p7) : "0";
  String ledS = (p7 > 0) ? packet.substring(p7 + 1) : "0";

  float t = tstr.toFloat();
  float h = hstr.toFloat();

  FloorData *floorPtr = nullptr;
  if (id == "ESP001")
  {
    floorPtr = &floor1;
  }
  else if (id == "ESP002")
  {
    floorPtr = &floor2;
  }
  else
  {
    Serial.println("[UART] Unknown ID");
    return;
  }

  floorPtr->id = id;
  floorPtr->name = floor.length() ? floor : (id == "ESP001" ? "Tang 1" : "Tang 2");
  floorPtr->temp = t;
  floorPtr->hum = h;
  floorPtr->fog = (fogS.toInt() != 0);
  floorPtr->fan = (fanS.toInt() != 0);
  floorPtr->heater = (heaS.toInt() != 0);
  floorPtr->led = (ledS.toInt() != 0);
  floorPtr->lastUpdate = millis();
  floorPtr->online = true;

  Serial.printf("[DATA] %s: T=%.1f H=%.1f | LED=%d FOG=%d FAN=%d HEAT=%d\n",
                floorPtr->id.c_str(), t, h,
                floorPtr->led, floorPtr->fog, floorPtr->fan, floorPtr->heater);
}

// ============ NHẬN DỮ LIỆU TỪ UART ============
void receiveUartData()
{
  while (ZigbeeSerial.available())
  {
    char c = ZigbeeSerial.read();

    if (c == '\n' || c == '\r')
    {
      if (receivedData.length() > 10)
      {
        receivedData.trim();
        parseUartPacket(receivedData);
        receivedData = "";
      }
    }
    else if (c >= 32 && c <= 126)
    {
      if (receivedData.length() < 150)
      {
        receivedData += c;
      }
      else
      {
        receivedData = "";
      }
    }
  }
}

// ============ GỬI DỮ LIỆU LÊN SERVER ============
void sendDataToServer()
{
  if (WiFi.status() != WL_CONNECTED)
    return;

  HTTPClient http;
  http.begin(String(serverURL) + "/update");
  http.addHeader("Content-Type", "application/json");
  http.setTimeout(10000);

  StaticJsonDocument<512> doc;

  JsonObject f1 = doc.createNestedObject("floor1");
  f1["id"] = floor1.id;
  f1["name"] = floor1.name;
  f1["temp"] = floor1.temp;
  f1["hum"] = floor1.hum;
  f1["led"] = floor1.led ? "ON" : "OFF";
  f1["fog"] = floor1.fog ? "ON" : "OFF";
  f1["fan"] = floor1.fan ? "ON" : "OFF";
  f1["heater"] = floor1.heater ? "ON" : "OFF";
  f1["online"] = floor1.online;

  JsonObject f2 = doc.createNestedObject("floor2");
  f2["id"] = floor2.id;
  f2["name"] = floor2.name;
  f2["temp"] = floor2.temp;
  f2["hum"] = floor2.hum;
  f2["led"] = floor2.led ? "ON" : "OFF";
  f2["fog"] = floor2.fog ? "ON" : "OFF";
  f2["fan"] = floor2.fan ? "ON" : "OFF";
  f2["heater"] = floor2.heater ? "ON" : "OFF";
  f2["online"] = floor2.online;

  String jsonString;
  serializeJson(doc, jsonString);

  int httpCode = http.POST(jsonString);

  if (httpCode == 200)
  {
    wifiErrorCount = 0;
  }
  else
  {
    wifiErrorCount++;
  }

  http.end();
}

// ============ GỬI LỆNH ĐIỀU KHIỂN QUA UART ============
void sendControlCommand(const String &device, bool state)
{
  String cmd = device + "#" + String(state ? 1 : 0) + "\n";

  Serial.print("[UART-TX] ");
  Serial.print(cmd);

  ZigbeeSerial.print(cmd);
}

// ============ NHẬN LỆNH TỪ SERVER ============
void checkCommandsFromServer()
{
  if (WiFi.status() != WL_CONNECTED)
    return;

  HTTPClient http;
  http.begin(String(serverURL) + "/commands");
  http.setTimeout(5000);

  int httpCode = http.GET();

  if (httpCode == 200)
  {
    String payload = http.getString();

    StaticJsonDocument<512> doc;
    DeserializationError error = deserializeJson(doc, payload);

    if (!error)
    {
      // Floor 1
      if (doc.containsKey("floor1"))
      {
        String led = doc["floor1"]["led"] | "OFF";
        String fog = doc["floor1"]["fog"] | "OFF";
        String fan = doc["floor1"]["fan"] | "OFF";
        String heater = doc["floor1"]["heater"] | "OFF";

        bool newLed = (led == "ON");
        bool newFog = (fog == "ON");
        bool newFan = (fan == "ON");
        bool newHeater = (heater == "ON");

        if (newLed != floor1.led)
        {
          floor1.led = newLed;
          sendControlCommand("led1", newLed);
        }
        if (newFog != floor1.fog)
        {
          floor1.fog = newFog;
          sendControlCommand("fog1", newFog);
        }
        if (newFan != floor1.fan)
        {
          floor1.fan = newFan;
          sendControlCommand("fan1", newFan);
        }
        if (newHeater != floor1.heater)
        {
          floor1.heater = newHeater;
          sendControlCommand("heater1", newHeater);
        }
      }

      // Floor 2
      if (doc.containsKey("floor2"))
      {
        String led = doc["floor2"]["led"] | "OFF";
        String fog = doc["floor2"]["fog"] | "OFF";
        String fan = doc["floor2"]["fan"] | "OFF";
        String heater = doc["floor2"]["heater"] | "OFF";

        bool newLed = (led == "ON");
        bool newFog = (fog == "ON");
        bool newFan = (fan == "ON");
        bool newHeater = (heater == "ON");

        if (newLed != floor2.led)
        {
          floor2.led = newLed;
          sendControlCommand("led2", newLed);
        }
        if (newFog != floor2.fog)
        {
          floor2.fog = newFog;
          sendControlCommand("fog2", newFog);
        }
        if (newFan != floor2.fan)
        {
          floor2.fan = newFan;
          sendControlCommand("fan2", newFan);
        }
        if (newHeater != floor2.heater)
        {
          floor2.heater = newHeater;
          sendControlCommand("heater2", newHeater);
        }
      }
    }
  }

  http.end();
}

// ============ KIỂM TRA TRẠNG THÁI ONLINE ============
void checkDeviceStatus()
{
  unsigned long now = millis();

  if (now - floor1.lastUpdate > 15000)
  {
    floor1.online = false;
  }

  if (now - floor2.lastUpdate > 15000)
  {
    floor2.online = false;
  }
}

// ============ KIỂM TRA VÀ RECONNECT WIFI ============
void checkWiFiConnection()
{
  if (WiFi.status() != WL_CONNECTED)
  {
    unsigned long now = millis();

    if (now - wifiReconnectTime > 30000)
    {
      Serial.println("WiFi lost, reconnecting...");
      WiFi.reconnect();
      wifiReconnectTime = now;
      delay(5000);

      if (WiFi.status() == WL_CONNECTED)
      {
        wifiErrorCount = 0;
        Serial.print("Reconnected, IP: ");
        Serial.println(WiFi.localIP());
      }
      else
      {
        wifiErrorCount++;
        if (wifiErrorCount >= MAX_WIFI_ERRORS)
        {
          Serial.println("Too many WiFi errors, rebooting...");
          delay(2000);
          ESP.restart();
        }
      }
    }
  }
}

// ============ SETUP ============
void setup()
{
  ZigbeeSerial.begin(115200);
  ZigbeeSerial.setDebugOutput(false);
  delay(1000);

  pinMode(LED_BUILTIN, OUTPUT);
  digitalWrite(LED_BUILTIN, LOW);

  Serial.println();
  Serial.println("========================================");
  Serial.println("  ESP32-CAM COORDINATOR + CAMERA");
  Serial.println("========================================");

  if (!initCamera())
  {
    Serial.println("❌ Camera init FAILED!");
    while (true)
    {
      digitalWrite(LED_BUILTIN, !digitalRead(LED_BUILTIN));
      delay(500);
    }
  }

  Serial.println("✅ Camera initialized");

  connectWiFi();

  if (WiFi.status() == WL_CONNECTED)
  {
    startCameraServer();
  }

  Serial.println("✅ System ready!");
}

// ============ LOOP ============
void loop()
{
  receiveUartData();

  unsigned long now = millis();

  if (now - lastServerUpdate >= 3000)
  {
    sendDataToServer();
    lastServerUpdate = now;
  }

  if (now - lastCommandCheck >= 2000)
  {
    checkCommandsFromServer();
    lastCommandCheck = now;
  }

  if (now - lastStatusCheck >= 5000)
  {
    checkDeviceStatus();
    lastStatusCheck = now;
  }

  checkWiFiConnection();

  static unsigned long lastBlink = 0;
  static bool blinkState = false;
  if (now - lastBlink >= 1000)
  {
    blinkState = !blinkState;
    digitalWrite(LED_BUILTIN, blinkState ? HIGH : LOW);
    lastBlink = now;
  }

  delay(50);
}