// Görev kaydını beklenen biçime getirir. Eski sürümlerden ya da elle düzenlenmiş verilerden
// gelen eksik/yanlış tipli alanlar (mahallesiz yer, metin olarak personel, sayı olarak saat…)
// uygulamanın herhangi bir yerinde hataya yol açmasın diye her okumada ve açılışta düzeltilir.
const { saatNormal } = require('./util');
const { plakaBicim } = require('./kisiler');

const metin = (v) => (v === null || v === undefined ? '' : String(v)).trim();

function gorevDuzelt(g) {
  if (!g || typeof g !== 'object') return g;
  const d = { ...g };
  d.tarih = /^\d{4}-\d{2}-\d{2}$/.test(metin(d.tarih)) ? metin(d.tarih) : '';
  d.yer = (Array.isArray(d.yer) ? d.yer : [])
    .filter(y => y && typeof y === 'object')
    .map(y => ({ ilce: metin(y.ilce), mahalleler: (Array.isArray(y.mahalleler) ? y.mahalleler : y.mahalleler ? [y.mahalleler] : []).map(metin).filter(Boolean) }))
    .filter(y => y.ilce || y.mahalleler.length);
  d.personel = (Array.isArray(d.personel) ? d.personel : d.personel ? [d.personel] : []).map(metin).filter(Boolean);
  for (const k of ['sayi', 'yerHam', 'plaka', 'surucu', 'gorevTuru']) d[k] = metin(d[k]);
  d.plaka = plakaBicim(d.plaka);   // plakalar boşluksuz: 34ABC2159
  // 5 haneli sayıya dönüşmüş belge no (052290 → 52290) baştaki sıfırını geri alır
  const b = metin(d.belgeNo).replace(/\D/g, '');
  d.belgeNo = b.length === 5 ? `0${b}` : b;
  for (const k of ['cikis', 'donus']) d[k] = saatNormal(metin(d[k]).replace(/^(\d{3})$/, '0$1'));
  d.onayli = !!d.onayli;
  return d;
}

// Veritabanındaki bütün görev kayıtlarını onarır; yalnızca değişenler yazılır
async function gorevleriOnar(Gorev) {
  const koleksiyon = Gorev.collection;
  const alanlar = ['tarih', 'yer', 'personel', 'sayi', 'yerHam', 'plaka', 'surucu', 'gorevTuru', 'belgeNo', 'cikis', 'donus', 'onayli'];
  let n = 0;
  for await (const g of koleksiyon.find({})) {
    const d = gorevDuzelt(g);
    const set = {};
    for (const k of alanlar) if (JSON.stringify(d[k]) !== JSON.stringify(g[k] ?? (Array.isArray(d[k]) ? [] : k === 'onayli' ? false : ''))) set[k] = d[k];
    if (Object.keys(set).length) { await koleksiyon.updateOne({ _id: g._id }, { $set: set }); n++; }
  }
  if (n) console.log(`Veri onarımı: ${n} görev kaydı düzeltildi.`);
}

module.exports = { gorevDuzelt, gorevleriOnar };
