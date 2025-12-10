#include <Arduino.h>
#include <DHT.h>

// ============ CẤU HÌNH CHÂN ============
#define DHTPIN 4
#define DHTTYPE DHT22

#define UART_TX 17
#define UART_RX 16

#define FOG_PIN 12
#define FAN_PIN 13
#define HEATER_PIN 14
#define LED_PIN 2 // D4 = GPIO2 trên ESP32

// ============ NGƯỠNG ============
#define TEMP_MIN 27
#define TEMP_MAX 31
#define HUMIDITY_MIN 75
#define HUMIDITY_MAX 85

// ============ THÔNG SỐ PHÒNG ============
const float ROOM_VOLUME = 12.0;
const float MIST_FLOW_RATE = 36.0;
const float EVAPORATION_FACTOR = 0.07;

// ============ ĐỊNH DANH TẦNG ============
const String FLOOR_ID = "ESP002";
const String FLOOR_NAME = "Tang 2";

// ============ KHỞI TẠO ============
DHT dht22(DHTPIN, DHTTYPE);

// ============ BIẾN TOÀN CỤC ============
float nhietdo = 0.0;
float doam = 0.0;
String incomingData = "";

bool led_state = false; // ← THÊM LED STATE
bool fog_state = false;
bool fan_state = false;
bool heater_state = false;

bool isMistOn = false;
unsigned long mistStartTime = 0;
float currentSprayTime = 0;
unsigned long lastCheckTime = 0;
const unsigned long CHECK_INTERVAL = 5000;

int dhtErrorCount = 0;
const int MAX_DHT_ERRORS = 5;

bool autoMode = true;

// ============ SETUP ============
void DHT22_Setup()
{
  dht22.begin();
  pinMode(LED_PIN, OUTPUT); // ← THÊM LED
  pinMode(FOG_PIN, OUTPUT);
  pinMode(FAN_PIN, OUTPUT);
  pinMode(HEATER_PIN, OUTPUT);

  digitalWrite(LED_PIN, LOW); // ← LED TẮT BAN ĐẦU
  digitalWrite(FOG_PIN, LOW);
  digitalWrite(FAN_PIN, LOW);
  digitalWrite(HEATER_PIN, LOW);
}

// ============ ĐỌC CẢM BIẾN ============
void DHT22_ReadData()
{
  nhietdo = dht22.readTemperature();
  doam = dht22.readHumidity();
}

int DHT22_Operation()
{
  if (isnan(nhietdo) || isnan(doam))
  {
    dhtErrorCount++;
    if (dhtErrorCount >= MAX_DHT_ERRORS)
    {
      Serial.println("DHT22 error limit, rebooting...");
      delay(2000);
      ESP.restart();
    }
    return 1;
  }
  dhtErrorCount = 0;
  return 0;
}

// ============ HIỂN THỊ ============
void Display_OnSerial()
{
  Serial.println();
  Serial.println("===== TANG 2 (ESP002) =====");
  Serial.printf("Temp: %.1f°C | Hum: %.1f%%\n", nhietdo, doam);
  Serial.printf("Mode: %s\n", autoMode ? "AUTO" : "MANUAL");
  Serial.printf("LED:%s FOG:%s FAN:%s HEAT:%s\n", // ← THÊM LED VÀO DISPLAY
                led_state ? "ON" : "OFF",
                fog_state ? "ON" : "OFF",
                fan_state ? "ON" : "OFF",
                heater_state ? "ON" : "OFF");
  Serial.println("===========================");
}

// ============ GỬI DỮ LIỆU QUA UART ============
// Format: ESP002#Tang 2#26.8#100.0#1#1#0#1\n (thêm LED ở cuối)
void SendData_UART2()
{
  String data = FLOOR_ID + "#" +
                FLOOR_NAME + "#" +
                String(nhietdo, 1) + "#" +
                String(doam, 1) + "#" +
                String(fog_state ? 1 : 0) + "#" +
                String(fan_state ? 1 : 0) + "#" +
                String(heater_state ? 1 : 0) + "#" +
                String(led_state ? 1 : 0) + "\n"; // ← THÊM LED

  Serial2.print(data);
  Serial.print("[TX] ");
  Serial.print(data);
}

// ============ PHUN SƯƠNG ============
void sprayMist(float currentHumidity, float currentTemp)
{
  if (!autoMode)
    return;

  float deficit = HUMIDITY_MIN - currentHumidity;
  float waterNeeded = ROOM_VOLUME * deficit * EVAPORATION_FACTOR;
  float sprayTime = (waterNeeded / MIST_FLOW_RATE) * 60;
  sprayTime *= (1.0 - 0.01 * max(0.0, currentTemp - 28.0));
  sprayTime = constrain(sprayTime, 5, 30);

  digitalWrite(FOG_PIN, HIGH);
  fog_state = true;
  isMistOn = true;
  mistStartTime = millis();
  currentSprayTime = sprayTime;

  Serial.printf("[AUTO] Spray: %.1fs\n", sprayTime);
}

void stopMist()
{
  if (isMistOn)
  {
    digitalWrite(FOG_PIN, LOW);
    fog_state = false;
    isMistOn = false;
    Serial.println("[AUTO] Stop mist");
  }
}

// ============ ĐIỀU KHIỂN TỰ ĐỘNG ============
void autoControl()
{
  if (!autoMode)
    return;

  if (nhietdo > TEMP_MAX)
  {
    digitalWrite(FAN_PIN, HIGH);
    fan_state = true;
    digitalWrite(HEATER_PIN, LOW);
    heater_state = false;

    if (doam < HUMIDITY_MIN && !isMistOn)
      sprayMist(doam, nhietdo);
  }
  else if (nhietdo < TEMP_MIN)
  {
    digitalWrite(HEATER_PIN, HIGH);
    heater_state = true;
    digitalWrite(FAN_PIN, LOW);
    fan_state = false;

    if (doam < HUMIDITY_MIN && !isMistOn)
      sprayMist(doam, nhietdo);
  }
  else
  {
    digitalWrite(HEATER_PIN, LOW);
    heater_state = false;

    if (doam > HUMIDITY_MAX)
    {
      digitalWrite(FAN_PIN, HIGH);
      fan_state = true;
      stopMist();
    }
    else if (doam < HUMIDITY_MIN && !isMistOn)
    {
      sprayMist(doam, nhietdo);
      digitalWrite(FAN_PIN, LOW);
      fan_state = false;
    }
    else
    {
      digitalWrite(FAN_PIN, LOW);
      fan_state = false;
      stopMist();
    }
  }
}

// ============ XỬ LÝ LỆNH UART ============
// Format: fog2#1\n, fan2#0\n, heater2#1\n, led2#1\n ← THÊM LED COMMAND
void HandleUARTCommand(String command)
{
  command.trim();

  // BỘ LỌC: Bỏ qua dữ liệu sensor echo
  if (command.startsWith("ESP001") || command.startsWith("ESP002") || command.length() > 50)
  {
    return;
  }

  int idx = command.indexOf('#');
  if (idx == -1 || idx == 0)
  {
    return;
  }

  String device = command.substring(0, idx);
  String stateStr = command.substring(idx + 1);
  int state = stateStr.toInt();

  // Chỉ xử lý lệnh cho tầng 2 ← THÊM LED2
  if (device != "led2" && device != "fog2" && device != "fan2" && device != "heater2")
  {
    return;
  }

  Serial.printf("[RX-CMD] %s = %d\n", device.c_str(), state);

  // Chuyển sang MANUAL khi nhận lệnh
  if (autoMode)
  {
    autoMode = false;
    Serial.println("[MODE] AUTO -> MANUAL");
  }

  bool changed = false;

  // ← THÊM XỬ LÝ LED
  if (device == "led2")
  {
    bool newState = (state != 0);
    if (newState != led_state)
    {
      led_state = newState;
      digitalWrite(LED_PIN, led_state ? HIGH : LOW);
      Serial.printf("[CONTROL] LED: %s\n", led_state ? "ON" : "OFF");
      changed = true;
    }
  }
  else if (device == "fog2")
  {
    bool newState = (state != 0);
    if (newState != fog_state)
    {
      fog_state = newState;
      digitalWrite(FOG_PIN, fog_state ? HIGH : LOW);
      isMistOn = fog_state;

      if (fog_state)
      {
        mistStartTime = millis();
        currentSprayTime = 30;
      }

      Serial.printf("[CONTROL] FOG: %s\n", fog_state ? "ON" : "OFF");
      changed = true;
    }
  }
  else if (device == "fan2")
  {
    bool newState = (state != 0);
    if (newState != fan_state)
    {
      fan_state = newState;
      digitalWrite(FAN_PIN, fan_state ? HIGH : LOW);
      Serial.printf("[CONTROL] FAN: %s\n", fan_state ? "ON" : "OFF");
      changed = true;
    }
  }
  else if (device == "heater2")
  {
    bool newState = (state != 0);
    if (newState != heater_state)
    {
      heater_state = newState;
      digitalWrite(HEATER_PIN, heater_state ? HIGH : LOW);
      Serial.printf("[CONTROL] HEATER: %s\n", heater_state ? "ON" : "OFF");
      changed = true;
    }
  }

  if (changed)
  {
    delay(100);
    SendData_UART2();
  }
}

// ============ SETUP ============
void setup()
{
  Serial.begin(115200);
  Serial2.begin(115200, SERIAL_8N1, UART_RX, UART_TX);

  delay(1000);

  Serial.println();
  Serial.println("========================================");
  Serial.println("  ESP002 - TANG 2");
  Serial.println("  LED Test: GPIO2 (D4)"); // ← THÊM INFO
  Serial.println("========================================");

  DHT22_Setup();

  // ← TEST LED NHẤP NHÁY LÚC KHỞI ĐỘNG
  Serial.println("Testing LED...");
  for (int i = 0; i < 3; i++)
  {
    digitalWrite(LED_PIN, HIGH);
    delay(200);
    digitalWrite(LED_PIN, LOW);
    delay(200);
  }
  Serial.println("LED test complete!");

  Serial.println("System ready!");
}

// ============ LOOP ============
void loop()
{
  unsigned long currentTime = millis();

  // 1. ĐỌC CẢM BIẾN
  if (currentTime - lastCheckTime >= CHECK_INTERVAL)
  {
    DHT22_ReadData();

    if (DHT22_Operation() == 0)
    {
      Display_OnSerial();

      if (autoMode)
      {
        autoControl();
      }

      SendData_UART2();
    }
    else
    {
      Serial.println("DHT22 read error!");
      stopMist();
    }

    lastCheckTime = currentTime;
  }

  // 2. KIỂM TRA THỜI GIAN PHUN
  if (isMistOn && (currentTime - mistStartTime > currentSprayTime * 1000))
  {
    stopMist();
    SendData_UART2();
  }

  // 3. XỬ LÝ LỆNH UART
  while (Serial2.available())
  {
    char c = Serial2.read();

    if (c == '\n' || c == '\r')
    {
      if (incomingData.length() > 0)
      {
        HandleUARTCommand(incomingData);
        incomingData = "";
      }
    }
    else if (c >= 32 && c <= 126)
    {
      if (incomingData.length() < 100)
      {
        incomingData += c;
      }
      else
      {
        incomingData = "";
      }
    }
  }

  delay(50);
}