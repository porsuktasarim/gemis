// Belge şablonları: her icmal türünün EDYS sayı satırı ve imza bloğu Ayarlar'dan ayrı ayrı tanımlanır.
// Her evrakta imzacı sayısı, sırası ve sayı satırının biçimi farklı olabileceği için uygulama bunları
// sabit kodlamaz; kurum şablonundaki parça olduğu gibi yapıştırılır. Excel çıktısındaki imza kısmı da
// yapıştırılan imza bloğundan çıkarılır (kaç imzacı, hangi sütunda, başlıkları ne).
const { IMZA_HTML, IMZA_IKILI_HTML } = require('./ortak');

const SAYI_P = '<p>SAYI:<span class="sablon_sayi-"><span id="editorEvrakSayiAlani">&nbsp;</span></span></p>';
const SAYI_EKOZEL = '<p><span style="font-size:11pt"><strong>SAYI:</strong><span class="sablon_sayi-"><span id="editorEvrakSayiAlani">&nbsp;</span></span></span></p>';
const SAYI_ARAC = '<p><span style="font-size:10pt">SAYI:<span class="sablon_sayi-"><span id="editorEvrakSayiAlani">&nbsp;</span></span></span></p>';

// Şablonu olan icmal türleri (liste imzasızdır)
const SABLON_TURLERI = ['puantaj', 'ekozel', 'arac', 'seyyar'];

const VARSAYILAN = {
  puantaj: { sayi: '', imza: IMZA_HTML },
  ekozel: { sayi: SAYI_EKOZEL, imza: IMZA_IKILI_HTML },
  arac: { sayi: SAYI_ARAC, imza: IMZA_HTML },
  seyyar: { sayi: SAYI_ARAC, imza: IMZA_HTML }
};

// Eski sürümlerin genel sayı parçası (kimliği sıfırlardan oluşan) — yerine türün varsayılanı konur
const ESKI_SAYI = /sablon_sayi-0{8}-/;

// Ayar kaydından türün şablonunu verir; eksik parça varsayılanla tamamlanır.
// Kullanıcı bir alanı bilerek boşaltmışsa ('' kaydedilmişse) boş kalır.
function sablonGetir(ayar, tur) {
  const v = VARSAYILAN[tur] || { sayi: '', imza: '' };
  const k = (ayar && ayar.sablonlar && ayar.sablonlar[tur]) || {};
  return {
    sayi: typeof k.sayi === 'string' ? k.sayi : v.sayi,
    imza: typeof k.imza === 'string' ? k.imza : v.imza
  };
}

// İmza bloğundaki evrak tarihinin yılı icmalin yılına çevrilir (". . / . . /2026")
const yilKoy = (html, yil) => (html || '').replace(/(\.\s*\/\s*\.\s*\.\s*\/\s*)20\d\d/g, `$1${yil}`);

const metin = (h) => (h || '')
  .replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
  .replace(/\(@IMZA_\d+\)/gi, ' ')
  .replace(/[.\s]*\.\s*\/\s*\.\s*\.\s*\/\s*\d{2,4}/g, ' ')   // ". . / . . /2026"
  .replace(/\s+/g, ' ').trim();

// İmza bloğunu çözümler: [{ no, etiket, tarihli, sutun, sutunSayisi, satir }]
// - imzacı numarası "sablon_imza_1-", "sablon_imza_ad1-…", "(@IMZA_1)" gibi yazımlardan alınır
// - başlık (KONTROL EDEN, ONAYLAYAN…) aynı hücrede ya da aynı sütunun üst satırlarında aranır
function imzaCoz(html) {
  const sonuc = new Map();
  const satirlar = (html || '').match(/<tr[\s\S]*?<\/tr>/gi) || [];
  const sutunEtiket = [];
  satirlar.forEach((tr, satir) => {
    const hucreler = tr.match(/<t[dh][\s\S]*?<\/t[dh]>/gi) || [];
    hucreler.forEach((h, sutun) => {
      const nolar = [...h.matchAll(/sablon_imza_(?:ad|unvan|kurdele)?(\d+)|@IMZA_(\d+)/gi)].map(m => Number(m[1] || m[2]));
      // EDYS'nin doldurduğu hâli (sablon_imza_ad1…) yapıştırılmışsa hücredeki ad başlık sayılmaz
      const yazi = /sablon_imza_(?:ad|unvan|kurdele)\d/i.test(h) ? '' : metin(h);
      if (!nolar.length) { if (yazi) sutunEtiket[sutun] = yazi; return; }
      for (const no of nolar) {
        if (sonuc.has(no)) continue;   // aynı imzacının ad/ünvan/kurdele satırları: ilki yeter
        sonuc.set(no, {
          no, etiket: yazi || sutunEtiket[sutun] || '', tarihli: /evrakTarih|sablon_evrak_tarih/i.test(h),
          sutun, sutunSayisi: hucreler.length, satir
        });
      }
      sutunEtiket[sutun] = '';
    });
  });
  // Tablo dışında yalnızca "(@IMZA_n)" yazılmış imzalar alt alta
  let ek = satirlar.length;
  for (const m of (html || '').matchAll(/@IMZA_(\d+)/gi)) {
    const no = Number(m[1]);
    if (!sonuc.has(no)) sonuc.set(no, { no, etiket: '', tarihli: false, sutun: 0, sutunSayisi: 1, satir: ek++ });
  }
  return [...sonuc.values()].sort((a, b) => a.satir - b.satir || a.sutun - b.sutun);
}

// İmzacı numarasına göre Excel'e yazılacak ad/ünvan (EDYS'deki sırayla: 1 personel, 2 şube müdürü, 3 il müdür yardımcısı)
function imzaciBilgisi(ayar, no) {
  if (no === 1) return [ayar.personelAd, ayar.personelUnvan];
  if (no === 2) return [ayar.subeMuduruAd, ayar.subeMuduruUnvan];
  if (no === 3) return [ayar.ilMudYrdAd, ayar.ilMudYrdUnvan];
  return ['', ''];
}

module.exports = { SABLON_TURLERI, VARSAYILAN, ESKI_SAYI, sablonGetir, yilKoy, imzaCoz, imzaciBilgisi };
