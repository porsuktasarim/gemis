// "Seçerek oku": kullanıcının görüntü üzerinde seçtiği bölgeyi, seçtiği alan için okur.
// Parça tarayıcıda kesilip gönderilir; yalnızca bellekte işlenir, saklanmaz.
const sharp = require('sharp');
const { tesseract, adTemizle } = require('./zon');
const elyazisi = require('./elyazisi');
const { plakaCoz, belgeNoCoz, yerOnIsle, sayiBul } = require('./ocr');
const { kisiEslestir, adBicim: adBicimle, adUnvanAyir } = require('./kisiler');
const { yerAyristir, yerYaz, tarihISO } = require('./util');

const RAKAM = ['-c', 'tessedit_char_whitelist=0123456789:.,'];
const PLAKA = ['-c', 'tessedit_char_whitelist=ABCDEFGHIJKLMNOPRSTUVYZ0123456789 '];

const EL_ALANLARI = ['plaka', 'surucu', 'cikis', 'donus', 'belgeNo'];

// Alan → Tesseract ayarı
const ALANLAR = {
  sayi: { psm: 7, ekler: ['-c', 'tessedit_char_whitelist=Ee0123456789-.: '] },
  tarih: { psm: 7, ekler: RAKAM },
  belgeNo: { psm: 7, ekler: RAKAM },
  plaka: { psm: 7, ekler: PLAKA },
  cikis: { psm: 7, ekler: RAKAM },
  donus: { psm: 7, ekler: RAKAM },
  surucu: { psm: 7, ekler: [] },
  yerHam: { psm: 6, ekler: [] },
  personel: { psm: 6, ekler: [] }
};

// Elle seçimde makullük süzgeci gevşek: kullanıcı neyi seçtiğini biliyor
function saatGevsek(t) {
  const r = (t || '').replace(/[^\d]/g, '');
  let h, m;
  if (r.length === 3) { h = +r[0]; m = +r.slice(1); }
  else if (r.length === 4) { h = +r.slice(0, 2); m = +r.slice(2); }
  else return '';
  if (h > 23 || m > 59) return '';
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function coz(alan, ham, baglam) {
  const { kisiler = [], bilinenPlakalar = [], sayiOnek = '' } = baglam || {};
  const t = (ham || '').trim();
  switch (alan) {
    case 'cikis': case 'donus': return saatGevsek(t);
    case 'belgeNo': { const m = /\d{6}/.exec(t.replace(/[\s.,:]/g, '')); return m ? m[0] : ''; }
    case 'plaka': {
      const p = plakaCoz(t, bilinenPlakalar);
      return /^\d{2} [A-Z]{1,3} \d{2,4}$/.test(p) ? p : '';
    }
    case 'tarih': return tarihISO(t.replace(/[,]/g, '.').replace(/\s+/g, ''));
    case 'sayi': return sayiBul(`Sayı ${t}`, sayiOnek) || (/(\d{8})\s*$/.exec(t.replace(/\s+/g, '')) && sayiOnek ? sayiOnek + /(\d{8})\s*$/.exec(t.replace(/\s+/g, ''))[1] : t.replace(/\s+/g, ''));
    // El yazısında yanlış ad yazmamak için yalnızca bilinen kişiyle eşleşirse doldurulur
    case 'surucu': return kisiEslestir(t.replace(/\s+/g, ' '), kisiler, 0.35);
    case 'yerHam': return yerYaz(yerAyristir(yerOnIsle(t.replace(/\n/g, ', '))));
    case 'personel':
      return t.split(/\n+/).map(s => adUnvanAyir(s.trim()).ad).filter(Boolean)
        // Bilinen kişi ya da düzgün okunmuş (her kelimesi en az 3 harf) ad
        .map(s => kisiEslestir(s, kisiler, 0.3) || (/^[A-Za-zÇĞİÖŞÜçğıöşü]{3,}(\s+[A-Za-zÇĞİÖŞÜçğıöşü]{3,})+$/.test(adTemizle(s)) ? adBicimle(adTemizle(s)) : ''))
        .filter(Boolean);
    default: return t;
  }
}

async function secimOku(buf, alan, baglam) {
  const ayar = ALANLAR[alan];
  if (!ayar) throw new Error('Bilinmeyen alan');
  const meta = await sharp(buf).metadata();
  // Küçük seçimleri büyüt: Tesseract yaklaşık 30-40 px harf yüksekliğinde en iyi okur
  const olcek = Math.max(1, Math.min(4, 160 / Math.max(1, meta.height || 160)));
  const temel = sharp(buf).grayscale().resize({ width: Math.round((meta.width || 400) * Math.max(olcek, 2)) }).normalise();
  const cesitler = [
    await temel.clone().threshold(170).png().toBuffer(),
    await temel.clone().png().toBuffer(),
    await temel.clone().threshold(120).png().toBuffer()
  ].map(p => sharp(p).extend({ top: 20, bottom: 20, left: 20, right: 20, background: '#ffffff' }).png().toBuffer());
  const pngler = await Promise.all(cesitler);
  let ilkHam = '';
  // El yazısı alanlarında önce PaddleOCR (varsa): aday okumalardan kurala uyan ilki
  if (EL_ALANLARI.includes(alan) && elyazisi.kullanilabilir()) {
    const parca = await sharp(buf).grayscale().normalise().png().toBuffer();
    const r = await elyazisi.oku(parca, 'satir');
    for (const ham of r?.adaylar || []) {
      if (!ilkHam) ilkHam = ham;
      const deger = coz(alan, ham, baglam);
      if (deger) return { ham, deger, motor: 'PaddleOCR' };
    }
  }
  const psmler = ayar.psm === 7 ? [7, 6] : [6, 4];
  for (const psm of psmler) {
    for (const png of pngler) {
      const ham = (await tesseract(png, psm, ayar.ekler)).trim();
      if (!ilkHam && ham) ilkHam = ham;
      const deger = coz(alan, ham, baglam);
      if (Array.isArray(deger) ? deger.length : deger) return { ham, deger };
    }
  }
  return { ham: ilkHam, deger: alan === 'personel' ? [] : '' };
}

module.exports = { secimOku, ALANLAR };
