# İnterteks Randıman Sistemi

Bu klasörde iki parça var:

- `esp32_fw/esp32_fw.ino`: ESP32 firmware (kule lamba okuma + HTTP gönderim)
- `server/`: ESP32 verisini alan basit Node.js sunucu

## ESP32 Kurulum

1. `esp32_fw/esp32_fw.ino` dosyasında:
   - `WIFI_SSID`, `WIFI_PASS` değerlerini gir
   - `API_URL` alanını sunucu adresine ayarla
   - `T-001` olan `tezgahId` değerini her tezgaha göre değiştir

2. Arduino IDE veya PlatformIO ile ESP32'ye yükle

## Sunucu Kurulum

```
cd server
npm install
npm start
```

**POST endpoint:** `http://<ip>:8080/ingest`  
**Status endpoint:** `http://<ip>:8080/status/T-001`  
**Dashboard:** `http://<ip>:8080/`  
**Health:** `http://<ip>:8080/health`

## Ücretsiz Sunucu (Render)

1. Bu klasörü GitHub'a push et
2. Render hesabı aç: https://render.com
3. "New +" → "Blueprint" seç → GitHub repo'yu bağla
4. Render `render.yaml` dosyasını okuyup servisi kurar
5. URL oluşur (ör. `https://interteks-randiman-server.onrender.com`)

**ESP32 API_URL** örneği:
`https://interteks-randiman-server.onrender.com/ingest`

**Dashboard**:
`https://interteks-randiman-server.onrender.com/`

**Aylik PDF**:
`https://interteks-randiman-server.onrender.com/api/monthly.pdf`

**Giris**:
`https://interteks-randiman-server.onrender.com/login`

## Giris Bilgileri

- Kullanici adi: `interteks`
- Sifre: `161616`

## Randıman

`randiman = mavi / (sari + kirmizi + yesil + beyaz + mavi)`

## Kalici Veri (Render PostgreSQL)

Render’da ücretsiz PostgreSQL açıp servis env ayarına `DATABASE_URL` ekle.
Uygulama bu değişkeni görürse verileri veritabanında kalıcı tutar.

## ESP32 Programlama (Windows)

`windows_app/InterteksConfigurator` klasorundeki WPF uygulamasi ile:
- Wi-Fi bilgileri, tezgah ID ve API URL girilir
- Arduino CLI ile derle + USB yukleme yapilir
