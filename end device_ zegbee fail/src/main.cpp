#include <Arduino.h>
#include <Adafruit_Sensor.h>
#include <DHT.h>
#include <DHT_U.h>

// ============ CẤU HÌNH CHÂN ============
#define DHTPIN 27
#define DHTTYPE DHT22

#define LEDPIN 2
#define FOG_PIN 12
#define FAN_PIN 13
#define HEATER_PIN 14

// ============ CẤU HÌNH ZIGBEE CC2530 ============
// UART2: GPIO16 (RX2) - GPIO17 (TX2)
#define ZIGBEE_RX 16
#define ZIGBEE_TX 17
HardwareSerial ZigbeeSerial(2);

// ⚠️ ĐỔI SỐ NÀY CHO MỖI TẦNG
#define FLOOR_NUMBER 1 // Tầng 1 = 1, Tầng 2 = 2

DHT dht(DHTPIN, DHTTYPE);

// ============ TRẠNG THÁI THIẾT BỊ ============
bool ledState = false;
bool fogState = false;
bool fanState = false;
bool heaterState = false;

// ============ BIẾN NHẬN LỆNH ZIGBEE ============
String receivedCommand = "";

// ============ ĐẾM LỖI DHT ============
int dhtErrorCount = 0;
const int MAX_DHT_ERRORS = 5;

// ============ HÀM TÁCH CHUỖI ============
String getValue(String data, char separator, int index)
{
  int found = 0;
  int strIndex[] = {0, -1};
  int maxIndex = data.length() - 1;

  for (int i = 0; i <= maxIndex && found <= index; i++)
  {
    if (data.charAt(i) == separator || i == maxIndex)
    {
      found++;
      strIndex[0] = strIndex[1] + 1;
      strIndex[1] = (i == maxIndex) ? i + 1 : i;
    }
  }
  return (found > index) ? data.substring(strIndex[0], strIndex[1]) : "";
}

// ============ GỬI DỮ LIỆU QUA ZIGBEE ============
// Format: F1:28.5:75.2:0:1:0:0
// F = Floor, Temp, Hum, LED, FAN, HEATER, FOG
void sendSensorDataViaZigbee(float temp, float hum)
{
  String data = "F" + String(FLOOR_NUMBER) + ":";
  data += String(temp, 1) + ":";
  data += String(hum, 1) + ":";
  data += (ledState ? "1:" : "0:");
  data += (fanState ? "1:" : "0:");
  data += (heaterState ? "1:" : "0:");
  data += (fogState ? "1" : "0");
  data += "\n";

  ZigbeeSerial.print(data);

  Serial.println();
  Serial.println("GUI ZIGBEE -> COORDINATOR:");
  Serial.printf("  Tang:       %d\n", FLOOR_NUMBER);
  Serial.printf("  Nhiet do:   %.1f C\n", temp);
  Serial.printf("  Do am:      %.1f %%\n", hum);
  Serial.printf("  LED:        %s\n", ledState ? "ON" : "OFF");
  Serial.printf("  QUAT:       %s\n", fanState ? "ON" : "OFF");
  Serial.printf("  SUOI:       %s\n", heaterState ? "ON" : "OFF");
  Serial.printf("  PHUN SUONG: %s\n", fogState ? "ON" : "OFF");
}

// ============ PHÂN TÍCH LỆNH ZIGBEE ============
// Lệnh từ Coordinator: C1:LED:FAN:HEATER:FOG
void parseZigbeeCommand(String cmd)
{
  Serial.println();
  Serial.println("NHAN LENH TU COORDINATOR:");
  Serial.println("  Raw: " + cmd);

  String prefix = "C" + String(FLOOR_NUMBER) + ":"; // "C1:" hoặc "C2:"

  if (cmd.startsWith(prefix))
  {
    int idx = 0;
    getValue(cmd, ':', idx++); // skip C1/C2

    String led = getValue(cmd, ':', idx++);
    String fan = getValue(cmd, ':', idx++);
    String heater = getValue(cmd, ':', idx++);
    String fog = getValue(cmd, ':', idx++);

    // LED
    if (led == "1")
    {
      digitalWrite(LEDPIN, HIGH);
      ledState = true;
      Serial.println("  LED: ON");
    }
    else if (led == "0")
    {
      digitalWrite(LEDPIN, LOW);
      ledState = false;
      Serial.println("  LED: OFF");
    }

    // QUẠT
    if (fan == "1")
    {
      digitalWrite(FAN_PIN, HIGH);
      fanState = true;
      Serial.println("  QUAT: ON");
    }
    else if (fan == "0")
    {
      digitalWrite(FAN_PIN, LOW);
      fanState = false;
      Serial.println("  QUAT: OFF");
    }

    // SƯỞI
    if (heater == "1")
    {
      digitalWrite(HEATER_PIN, HIGH);
      heaterState = true;
      Serial.println("  SUOI: ON");
    }
    else if (heater == "0")
    {
      digitalWrite(HEATER_PIN, LOW);
      heaterState = false;
      Serial.println("  SUOI: OFF");
    }

    // PHUN SƯƠNG
    if (fog == "1")
    {
      digitalWrite(FOG_PIN, HIGH);
      fogState = true;
      Serial.println("  PHUN SUONG: ON");
    }
    else if (fog == "0")
    {
      digitalWrite(FOG_PIN, LOW);
      fogState = false;
      Serial.println("  PHUN SUONG: OFF");
    }
  }
  else
  {
    Serial.println("  Lenh khong dung tang nay, bo qua");
  }
}

// ============ NHẬN LỆNH TỪ ZIGBEE ============
void receiveZigbeeCommand()
{
  while (ZigbeeSerial.available())
  {
    char c = ZigbeeSerial.read();

    if (c == '\n' || c == '\r')
    {
      if (receivedCommand.length() > 3)
      {
        parseZigbeeCommand(receivedCommand);
        receivedCommand = "";
      }
    }
    else if (c >= 32 && c <= 126)
    {
      receivedCommand += c;
      if (receivedCommand.length() > 100)
      {
        receivedCommand = "";
      }
    }
  }
}

// ============ HIỂN THỊ TRẠNG THÁI ============
void displayStatus()
{
  Serial.println();
  Serial.println("TRANG THAI THIET BI:");
  Serial.printf("  LED:        %s\n", ledState ? "ON" : "OFF");
  Serial.printf("  QUAT:       %s\n", fanState ? "ON" : "OFF");
  Serial.printf("  PHUN SUONG: %s\n", fogState ? "ON" : "OFF");
  Serial.printf("  SUOI:       %s\n", heaterState ? "ON" : "OFF");
  Serial.println("==========================");
}

// ============ SETUP ============
void setup()
{
  Serial.begin(115200);
  delay(1000);

  Serial.println();
  Serial.println("========================================");
  Serial.printf(" ESP32 END DEVICE - TANG %d\n", FLOOR_NUMBER);
  Serial.println(" GIAO TIEP ZIGBEE CC2530");
  Serial.println("========================================");

  pinMode(LEDPIN, OUTPUT);
  pinMode(FOG_PIN, OUTPUT);
  pinMode(FAN_PIN, OUTPUT);
  pinMode(HEATER_PIN, OUTPUT);

  digitalWrite(LEDPIN, LOW);
  digitalWrite(FOG_PIN, LOW);
  digitalWrite(FAN_PIN, LOW);
  digitalWrite(HEATER_PIN, LOW);

  dht.begin();
  Serial.println("DHT22 khoi dong...");
  delay(2000);

  // Zigbee CC2530 (UART2)
  ZigbeeSerial.begin(115200, SERIAL_8N1, ZIGBEE_RX, ZIGBEE_TX);
  Serial.println("Zigbee CC2530 khoi dong (UART2 115200)");
  delay(1000);

  Serial.println("He thong san sang.");
}

// ============ LOOP ============
unsigned long lastSensorRead = 0;

void loop()
{
  // 1. Nhận lệnh từ Coordinator qua Zigbee
  receiveZigbeeCommand();

  unsigned long now = millis();

  // 2. Đọc cảm biến & gửi dữ liệu mỗi 3 giây
  if (now - lastSensorRead >= 3000)
  {
    Serial.println();
    Serial.printf("===== TANG %d =====\n", FLOOR_NUMBER);

    float temp = dht.readTemperature();
    float hum = dht.readHumidity();

    if (isnan(temp) || isnan(hum))
    {
      Serial.println("Loi doc DHT22!");
      dhtErrorCount++;

      if (dhtErrorCount >= MAX_DHT_ERRORS)
      {
        Serial.println("Qua nhieu loi DHT22, reboot ESP...");
        delay(2000);
        ESP.restart();
      }

      lastSensorRead = now;
      return;
    }

    dhtErrorCount = 0;

    Serial.printf("Nhiet do: %.1f C\n", temp);
    Serial.printf("Do am:    %.1f %%\n", hum);

    // Gửi lên Coordinator qua Zigbee
    sendSensorDataViaZigbee(temp, hum);

    // In trạng thái thiết bị
    displayStatus();

    lastSensorRead = now;
  }

  delay(50);
}