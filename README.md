# GEMİS – Görev Emri İcmal Sistemi

Taşıt görev emri görüntülerinden (JPEG) aylık arazi icmallerini hazırlayan web
uygulaması. Yapay zekâ kullanmaz. Görüntüler sunucuda Tesseract OCR (Türkçe)
ile okunur, eksik alanlar görüntünün yanındaki formdan tamamlanır.

İcmaller EDYS şablonlarına uygun HTML olarak ve Excel olarak alınabilir.
İcmale giren görev emirlerinin görüntüleri tek PDF olarak indirilebilir.

## Özellikler

- **Görev emri yükleme**
  - JPEG/PNG görüntüler toplu olarak yüklenebilir.
  - OCR basılı alanları doldurur: sayı, görev tarihi, görevli personel ve
    gideceği yer.
  - El yazısı alanlar (sürücü, plaka, saatler, belge no) çoğunlukla okunamaz.
    Bu alanlar formdan girilir; daha önce girilen plaka ve kişiler öneri olarak
    gelir.
  - Dosya adında tarih varsa (`2026_10_13.jpg`, `13.10.2026.jpg`) görev tarihi
    oradan alınır.
- **Google Drive'dan içe aktarma**
  - Drive'daki görev emirleri klasörü ve alt klasörleri taranır. Yeni JPEG/PNG'ler OCR'dan geçirilip kayıt olarak eklenir.
  - Tarama düğmeyle ya da belirli aralıklarla otomatik yapılır.
  - Daha önce işlenen dosyalar Drive dosya kimliğinden tanınır, tekrar eklenmez.
- **Görüntü saklama seçeneği**
  - Varsayılan olarak görüntüler sunucuya kaydedilmez. OCR bellekte yapılır, Tesseract'a stdin üzerinden verilir.
  - Drive'dan gelen görüntüler, görüntüleme ve PDF için her seferinde Drive'dan anlık alınır.
  - Elle yüklenen görüntüler yalnızca OCR'dan geçer.
  - İstenirse Ayarlar'dan "Görüntüleri sunucuda sakla" açılarak kopya tutulabilir.
- **Gideceği yer ayrıştırma**
  - "Büyükçekmece-Tepecik, Bağcılar" gibi metinler İstanbul ilçe listesine göre
    ilçe/mahalle olarak ayrıştırılır.
  - Kısaltmalar (B.Çekmece vb.) tanınır.
- **İcmaller**

  | İcmal | Kapsam |
  |---|---|
  | Kontrol Hizmetleri Puantaj Tablosu (EK-1) | Ayın iş günleri. Resmî tatiller, yarım günler (arife) ve elle hariç tutulan izin/rapor günleri düşülür. Görev günlerinde saat aralığı görev emrindeki çıkış/dönüş saatine göre büro + arazi olarak yazılır. |
  | Ek Özel Hizmet Tazminatı Arazi Gerçekleşme Cetveli | Bütün görev günleri |
  | Araç Kullanarak Görev İlave Ücret Gerçekleşme Cetveli | Yalnızca personelin sürücü olduğu günler |
  | Seyyar Görev Tazminatı Arazi Çıkış Cetveli | Yalnızca mahalli dışı yer listesindeki ilçe/mahalleler; alınmayanlar uyarı olarak gösterilir |
  | Görev emirleri listesi | Kişi bazında; sürücü ve görevli personel ayrı satırlarda |

- **Çıktılar**
  - HTML kaynağını kopyalama
  - Excel'e yapıştırılabilir tablo kopyalama
  - .xlsx ve .html indirme
  - Görev emri görüntülerinin PDF'i
- **EDYS uyumu**
  - İmza alanları `(@IMZA_1)` personel, `(@IMZA_2)` şube müdürü ve
    `(@IMZA_3)` il müdür yardımcısı olarak kalır.
  - Sayı alanı için her şablonun kendi `sablon_sayi-…` parçası Ayarlar'a
    yapıştırılır.

## Arayüz

Arayüz [AdminLTE 4](https://adminlte.io/themes/v4/) temasıyla hazırlanmıştır:
- Sol menü, üst çubuk ve kart düzeni
- Görev Emirleri sayfasında seçili ayın özet kutuları
- Açık/koyu tema seçimi

AdminLTE, Bootstrap Icons ve OverlayScrollbars npm paketlerinden sunulur. İnternet (CDN) bağlantısı gerekmez.

## Kurulum

Windows'ta Docker Desktop (WSL 2), Linux'ta Docker Engine ve Compose eklentisi
yeterlidir.

```bash
git clone https://github.com/porsuktasarim/gemis.git
cd gemis
docker compose up -d --build
```

Tarayıcıdan `http://localhost:1138` adresi açılır.

| İşlem | Komut |
|---|---|
| Durdurma | `docker compose down` |
| Güncelleme | `git pull && docker compose up -d --build` |
| Kayıtlar | Docker birimi `mongo-data` |
| Görüntüler | Docker birimi `uploads` |

`docker compose down` birimleri silmez; `down -v` kullanılırsa bütün veriler
silinir.

### Google Drive bağlantısı (isteğe bağlı)

Uygulama Drive'a bir **hizmet hesabı** ile, yalnızca okuma izniyle erişir. Klasör herkese açılmaz; yalnızca hizmet hesabına paylaşılır.

1. https://console.cloud.google.com adresinde yeni bir proje oluşturulur (ör. `gemis`).
2. **APIs & Services → Library** bölümünde **Google Drive API** aranır ve **Enable** ile etkinleştirilir.
3. **APIs & Services → Credentials → Create credentials → Service account** seçilir. Ad olarak `gemis` yazılır; rol verilmesine gerek yoktur.
4. Oluşan hizmet hesabı açılır. **Keys → Add key → Create new key → JSON** ile anahtar dosyası indirilir. Bu dosya gizli tutulmalı, depoya eklenmemelidir.
5. Drive'da görev emirleri klasörüne sağ tıklanıp **Paylaş** seçilir. Hizmet hesabının e-postası (`gemis@PROJE.iam.gserviceaccount.com`) **Görüntüleyen** olarak eklenir.
6. Anahtar uygulamaya ortam değişkeni olarak verilir:
   - **Coolify:** Uygulamanın **Environment Variables** bölümünde `GOOGLE_SERVICE_ACCOUNT_JSON` değişkenine JSON dosyasının bütün içeriği yapıştırılır. Değişken gizli (secret) işaretlenir ve yeniden deploy edilir.
   - **Yerel Docker:** Proje klasöründe `.env` dosyası oluşturulup içine `GOOGLE_SERVICE_ACCOUNT_JSON='{...tek satır JSON...}'` yazılır.
7. Uygulamada **Ayarlar → Google Drive ve görüntüler** bölümünde klasör bağlantısı girilir ve **Bağlantıyı dene** ile kontrol edilir. Aynı bölümden otomatik tarama aralığı da ayarlanabilir.
8. **Görev Emirleri** sekmesinde **Drive'dan içe aktar** düğmesi görünür.

### Eski işlemciler

MongoDB 5 ve üstü AVX destekli işlemci ister. `docker compose logs mongo`
çıktısında AVX hatası görülürse `docker-compose.yml` içindeki `mongo:7` yerine
`mongo:4.4` yazılmalıdır.

### Ağdaki başka bilgisayardan erişim

`http://SUNUCU-IP:1138` ile açılabilir. Tarayıcılar http adreslerinde pano
erişimini kısıtladığı için kopyalama eski yönteme geçer. Gerekirse .xlsx/.html
indirme seçenekleri kullanılmalıdır.

### Coolify ile yayınlama

Uygulama 1138 portunda çalışır ("Görev Emri İcmal Sistemi" ebced değeri).

1. Coolify'da **Projects → + Add** ile bir proje oluşturulur, `production` ortamı açılır.
2. **+ New → Public Repository** seçilir. Depo gizliyse **Private Repository (with GitHub App)** seçilir; bunun için önce Coolify'ın **Sources** bölümünde GitHub App kurulmuş olmalıdır.
3. Kaynak bilgileri girilir:
   - Repository URL: `https://github.com/porsuktasarim/gemis`
   - Branch: `main`
   - Build Pack: **Docker Compose**
   - Base Directory: `/`
   - Docker Compose Location: `/docker-compose.coolify.yml`

   Bu compose dosyası host portu bağlamaz; böylece sunucudaki diğer uygulamalarla port çakışması olmaz.
4. Servis listesinde `app` için domain alanına `https://ALAN-ADI:1138` girilir. Buradaki `:1138` konteynerin iç portudur, adrese eklenmez. `mongo` servisine domain verilmez.
5. **Save** ve ardından **Deploy** yapılır. `app` logunun sonunda `GEMİS http://localhost:1138` görülmeli, servis durumu `Running (healthy)` olmalıdır.
6. Cloudflare kullanılıyorsa iki ayar gerekir:
   - DNS'te alan adı için A kaydı sunucu IP'sine yönlendirilir (turuncu bulut).
   - SSL/TLS modu **Full** olmalıdır.

   İki seviyeli alt alan adları (ör. `www.gemis.alan.uk`) Cloudflare'in ücretsiz sertifikası kapsamında değildir.

### Docker olmadan (geliştirme)

Node.js 20+, MongoDB ve `tesseract-ocr` + `tesseract-ocr-tur` paketleri
kurulu olmalıdır.

```bash
npm install
MONGO_URL=mongodb://localhost:27017/gemis npm start
```

## İlk kullanım

1. **Ayarlar** ekranında şunlar girilmelidir:
   - Personel adı ve ünvanlar
   - İmzacılar
   - Görev emri sayı öneki
   - EDYS sayı parçaları
   - Resmî tatiller (dini bayram tarihleri her yıl Resmî Gazete'den
     doğrulanmalıdır)
   - Mahalli dışı yerler
   - Kişi listesi
2. Denemek için **"Örnek (uydurma) veriyi içe aktar"** ile Ekim 2026'ya ait 10
   uydurma görev yüklenebilir.
3. **Görev Emirleri** sekmesinde JPEG'ler yüklenir. Her kayıt açılıp kontrol
   edilir, eksikler tamamlanır ve "Kontrol ettim" işaretlenir.
4. **İcmaller** sekmesinde tür ve ay seçilip "Oluştur"a basılır. Uyarı
   kutusunda eksik alanlar ve cetvele alınmayan yerler listelenir.

## Varsayılan veriler

`seed/varsayilan.js` şunları içerir:
- 2026–2027 resmî tatilleri
- İlçe belediye yazılarına göre mahalli dışı yerler
- Uydurma bir kişi listesi
- Uydurma örnek görev emirleri

Örnek verideki adlar, plakalar ve evrak numaraları gerçek değildir. Gerçek
görev emirleri ve kişisel bilgiler bu depoya eklenmemelidir; uygulama verileri
yalnızca kurulduğu bilgisayardaki Docker birimlerinde tutar.

## Klasör yapısı

```
src/server.js        API ve statik dosyalar
src/ocr.js           Tesseract ile okuma ve alan çıkarma
src/util.js          Türkçe metin, tarih, ilçe/mahalle ayrıştırma
src/icmal/           İcmal HTML/Excel üreticileri
src/disaktar.js      .xlsx ve PDF üretimi
src/models.js        MongoDB şemaları ve varsayılan ayarlar
public/              Arayüz (AdminLTE 4 / Bootstrap 5)
seed/varsayilan.js   Tatiller, mahalli dışı yerler, uydurma örnek veriler
```
