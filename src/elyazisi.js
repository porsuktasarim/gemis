// El yazısı OCR servisine (PaddleOCR / RapidOCR, ayrı konteyner) bağlantı.
// Servis tanımlı değilse ya da yanıt vermezse null döner; çağıran Tesseract'a düşer.
const URL_TABANI = (process.env.OCR_EL_URL || '').replace(/\/+$/, '');

const durum = { tanimli: !!URL_TABANI, acik: false, motor: '', hata: '', secim: 'paddle' };

function ayarla(secim) { durum.secim = secim === 'tesseract' ? 'tesseract' : 'paddle'; }
const kullanilabilir = () => durum.tanimli && durum.acik && durum.secim === 'paddle';

async function denetle() {
  if (!URL_TABANI) { durum.acik = false; return durum; }
  try {
    const r = await fetch(`${URL_TABANI}/saglik`, { signal: AbortSignal.timeout(5000) });
    const j = await r.json();
    durum.acik = !!j.ok; durum.motor = j.motor || ''; durum.hata = '';
  } catch (e) { durum.acik = false; durum.hata = `El yazısı OCR servisine ulaşılamadı (${URL_TABANI}).`; }
  return durum;
}

// png: Buffer; mod: 'satir' (tek satır) | 'blok' (algılamalı)
async function oku(png, mod = 'satir') {
  if (!kullanilabilir()) return null;
  try {
    const r = await fetch(`${URL_TABANI}/oku?mod=${mod}`, {
      method: 'POST', body: png, headers: { 'Content-Type': 'application/octet-stream' }, signal: AbortSignal.timeout(30000)
    });
    if (!r.ok) return null;
    return await r.json(); // { metin, parcalar:[{metin, guven}] }
  } catch { return null; }
}

// Açılışta ve her dakika servis durumunu yenile (konteyner sonradan açılabilir)
denetle(); setInterval(denetle, 60000).unref();

module.exports = { oku, denetle, ayarla, kullanilabilir, durum };
