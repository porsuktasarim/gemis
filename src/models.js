const mongoose = require('mongoose');

const YerSchema = new mongoose.Schema({ ilce: String, mahalleler: [String] }, { _id: false });

const GorevSchema = new mongoose.Schema({
  tarih: { type: String, index: true },        // YYYY-MM-DD
  sayi: String,                                 // E-00000000-000.00.00-00000000
  belgeNo: String,                              // 6 haneli el yazısı/kaşe numara
  gorevTuru: { type: String, default: '4342 sayılı Mera Kanunu Uygulamaları' },
  yerHam: String,                               // belgede yazan hali
  yer: [YerSchema],                             // ayrıştırılmış ilçe/mahalle
  plaka: String,
  surucu: String,
  personel: [String],
  cikis: String,                                // HH:MM
  donus: String,
  dosya: String,                                // elle yüklenen görüntünün dosya adı (yerel)
  driveId: { type: String, index: true },       // Drive'dan alınan görüntünün dosya kimliği (görüntü sunucuda tutulmaz)
  driveAd: String,                              // Drive'daki dosya adı / alt klasör yolu
  ocrMetin: String,
  onayli: { type: Boolean, default: false },
  ornek: { type: Boolean, default: false }          // uydurma örnek veri (gerçek belgelerle eşleştirilmez)
}, { timestamps: true });

// Kişi: Ad SOYAD; görevi (Mühendis, Şoför… — seçim listesinde "Ad SOYAD - Görevi", imza ve puantajda);
// ünvanı (Ziraat Yüksek Mühendisi… — cetvellerdeki ÜNVANI satırı; boşsa görevi yazılır)
const KisiSchema = new mongoose.Schema({
  ad: { type: String, unique: true },
  unvan: String,         // görevi
  unvanCetvel: String,   // ünvanı
  unvanSeyyar: String    // eski sürümden kalan alan; açılışta ünvanı'na taşınır
});

const TatilSchema = new mongoose.Schema({ tarih: String, ad: String, yarim: Boolean }, { _id: false });
const MdSchema = new mongoose.Schema({ ilce: String, mahalleler: [String], not: String }, { _id: false });

// EDYS sayı parçası; gerçek şablondaki parça (kendi sablon_sayi-… kimliğiyle) Ayarlar'dan yapıştırılır.
const SAYI_VARSAYILAN = '<p>SAYI:<span id="sablon_sayi-00000000-0000-0000-0000-000000000000"> &nbsp;</span></p>';

const AyarSchema = new mongoose.Schema({
  _id: { type: String, default: 'ayar' },
  personelAd: { type: String, default: 'Ali YILMAZ' },
  personelUnvan: { type: String, default: 'Mühendis' },              // imza/puantaj
  personelUnvanCetvel: { type: String, default: 'Ziraat Mühendisi' }, // ek özel / araç cetveli
  personelUnvanSeyyar: { type: String, default: 'Ziraat Yüksek Mühendisi' },
  sube: { type: String, default: 'Çayır, Mera ve Yem Bitkileri Şube Müdürlüğü' },
  subeMuduruAd: { type: String, default: 'Ad SOYAD' },
  subeMuduruUnvan: { type: String, default: 'Şube Müdürü V.' },
  ilMudYrdAd: { type: String, default: 'Ad SOYAD' },
  ilMudYrdUnvan: { type: String, default: 'İl Müdür Yardımcısı' },
  sayiOnek: { type: String, default: '' },                         // örn. E-12345678-123.45.67- (OCR sayı tamamlama)
  ocrHaricAdlar: { type: [String], default: [] },                 // gideceği yer aranırken atlanacak adlar (amirler vb.)
  driveKlasor: { type: String, default: '' },                      // Drive klasör bağlantısı ya da kimliği
  gorselSakla: { type: Boolean, default: false },                  // görüntülerin kopyası sunucuda tutulsun mu
  elYazisiMotoru: { type: String, default: 'paddle' },             // 'paddle' (servis varsa) | 'tesseract'
  driveOtoTaraDk: { type: Number, default: 0 },                    // otomatik tarama aralığı (dakika, 0 = kapalı)
  mesaiBas: { type: String, default: '08:30' },
  mesaiBit: { type: String, default: '17:00' },
  puantajKontrolTuru: { type: String, default: 'Mera Kanunu Uyg.' },
  puantajMevzuat: { type: String, default: '4342 sayılı Mera Kanunu' },
  sayiEkOzel: { type: String, default: SAYI_VARSAYILAN },
  sayiArac: { type: String, default: SAYI_VARSAYILAN },
  sayiSeyyar: { type: String, default: SAYI_VARSAYILAN },
  tatiller: [TatilSchema],
  mahalliDisi: [MdSchema]
});

module.exports = {
  Gorev: mongoose.model('Gorev', GorevSchema),
  Kisi: mongoose.model('Kisi', KisiSchema),
  Ayar: mongoose.model('Ayar', AyarSchema)
};
