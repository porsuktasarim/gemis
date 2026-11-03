// Kişi adları: biçimlendirme, ünvanın addan ayrılması ve kayıtlı kişilerle eşleştirme.
// Amaç: aynı kişi "Uğur TÜRKELİ", "Uğur Türkeli", "Uğur TÜRKELİ İMÜHENDİS" gibi farklı yazımlarla
// ayrı ayrı kaydedilmesin; her zaman kayıtlı en benzeyen kişiye bağlansın.

const { sade, levenshtein, trTitle, trUpper } = require('./util');

// Görev / ünvan sözlüğü (uzundan kısaya: "Yüksek Mühendis" "Mühendis"ten önce denenir)
const UNVANLAR = [
  'Ziraat Yüksek Mühendisi', 'Ziraat Mühendisi', 'Gıda Yüksek Mühendisi', 'Gıda Mühendisi',
  'Yüksek Mühendis', 'Mühendis', 'Veteriner Hekim', 'Tekniker', 'Teknisyen', 'Biyolog', 'Kimyager',
  'Şube Müdürü', 'Grup Müdürü', 'Memur', 'Şoför', 'Sürekli İşçi', 'İşçi', 'Uzman', 'Mütercim'
];

const uzaklik = (a, b) => levenshtein(a, b) / Math.max(a.length, b.length, 1);

// Metindeki ünvanı sözlükteki karşılığına çevirir ("İMÜHENDİS" → "Mühendis"); bulunamazsa ''
function unvanBul(metin) {
  const s = sade(metin);
  if (s.length < 3) return '';
  for (const u of UNVANLAR) {
    const su = sade(u);
    if (s === su || (su.length >= 6 && s.includes(su))) return u;
  }
  let en = '', enU = 1;
  for (const u of UNVANLAR) { const d = uzaklik(s, sade(u)); if (d < enU) { enU = d; en = u; } }
  return enU <= 0.25 ? en : '';
}

// "Uğur TÜRKELİ İMÜHENDİS" → { ad: 'Uğur TÜRKELİ', unvan: 'Mühendis' }
function adUnvanAyir(ham) {
  const k = (ham || '').replace(/[|_]/g, ' ').split(/\s+/).filter(Boolean);
  // Sondan en fazla 3 kelimelik ünvan aranır; addan en az 2 kelime kalmalı
  for (let n = Math.min(3, k.length - 2); n >= 1; n--) {
    const u = unvanBul(k.slice(-n).join(' '));
    if (u) return { ad: k.slice(0, -n).join(' '), unvan: u };
  }
  return { ad: k.join(' '), unvan: '' };
}

// Ad SOYAD biçimi. Girdide büyük harfle yazılmış soyad(lar) varsa korunur ("Nurdan KOÇ TANJO"),
// yoksa son kelime soyad sayılır.
function adBicim(ad) {
  const k = (ad || '').replace(/[^A-Za-zÇĞİÖŞÜÂÎÛçğıöşüâîû.\s'-]/g, ' ').split(/\s+/).filter(Boolean);
  if (!k.length) return '';
  const buyuk = (w) => w.length >= 2 && w === trUpper(w) && w !== w.toLocaleLowerCase('tr-TR');
  const hepsiBuyuk = k.every(buyuk), hicBuyuk = !k.some(buyuk);
  let soyadBas = k.length - 1;
  if (!hepsiBuyuk && !hicBuyuk) { soyadBas = k.findIndex(buyuk); if (soyadBas <= 0) soyadBas = k.length - 1; }
  return k.map((w, i) => (i >= soyadBas ? trUpper(w) : trTitle(w))).join(' ');
}

// El yazısı/OCR için toleranslı eşleştirme: ad ve soyad ayrı ayrı karşılaştırılır;
// en iyi aday ikinciden belirgin biçimde iyi değilse eşleşme yapılmaz.
// ipucu: { unvan, tercih: Set<ad> } — yakın adaylar arasında, belgede okunan ünvanı (Mühendis/Şoför…)
// tutan ya da tercih kümesindeki (ör. sürücü için görevli listesindeki) kişi öne alınır.
function kisiEslestir(ham, kisiler, oran = 0.3, ipucu = {}) {
  const kelimeler = (ham || '').split(/[\s|,;:]+/).map(sade).filter(k => k.length >= 2);
  const h = kelimeler.join('');
  if (h.length < 4 || !kisiler.length) return '';
  const puanlar = kisiler.map(k => {
    const p = k.ad.split(/\s+/).map(sade).filter(Boolean);
    const tam = uzaklik(h, p.join(''));
    let parca = 1;
    if (kelimeler.length >= 2 && p.length >= 2) {
      parca = (uzaklik(kelimeler[0], p[0]) + uzaklik(kelimeler[kelimeler.length - 1], p[p.length - 1])) / 2;
    }
    const soyad = p[p.length - 1];
    const soyadUz = Math.min(...kelimeler.map(w => uzaklik(w, soyad)));
    // yalnızca soyad güvenle okunduysa (kısa soyadlarda yanılmamak için en az 5 harf)
    const soyadPuan = soyad.length >= 5 && soyadUz <= 0.3 ? soyadUz + 0.05 : 1;
    let puan = Math.min(tam, parca + 0.03, soyadPuan);
    if (ipucu.unvan && k.unvan) puan += sade(k.unvan) === sade(ipucu.unvan) ? -0.06 : 0.04;
    if (ipucu.tercih?.has(k.ad)) puan -= 0.06;
    return { ad: k.ad, puan: Math.max(0, puan) };
  }).sort((x, y) => x.puan - y.puan);
  const [en, ikinci] = puanlar;
  if (en.puan > Math.max(oran, 0.4)) return '';
  if (en.puan > oran && ikinci && ikinci.puan - en.puan < 0.12) return '';
  return en.ad;
}

// Elle ya da OCR ile gelen adı kayıtlı kişiye bağlar.
// Dönen: { ad, unvan, kayitli } — kayitli=false ise yeni kişi (biçimlendirilmiş ad)
function kanonikAd(ham, kisiler, oran = 0.2, ipucu = {}) {
  const { ad, unvan } = adUnvanAyir(ham);
  if (!ad) return { ad: '', unvan, kayitli: false };
  const s = sade(ad);
  const tam = kisiler.find(k => sade(k.ad) === s);
  if (tam) return { ad: tam.ad, unvan: unvan || tam.unvan || '', kayitli: true, kisi: tam };
  const yakin = kisiEslestir(ad, kisiler, oran, { unvan: unvan || ipucu.unvan, tercih: ipucu.tercih });
  if (yakin) { const k = kisiler.find(x => x.ad === yakin); return { ad: yakin, unvan: unvan || k?.unvan || '', kayitli: true, kisi: k }; }
  return { ad: adBicim(ad), unvan, kayitli: false };
}

// Plaka biçimi: "34 ABC 123"
function plakaBicim(p) {
  const t = trUpper(p || '').replace(/[^A-Z0-9ÇĞİÖŞÜ]/g, '');
  const m = /^(\d{2})([A-ZÇĞİÖŞÜ]{1,3})(\d{2,5})$/.exec(t);
  return m ? `${m[1]} ${m[2]} ${m[3]}` : trUpper(p || '').replace(/\s+/g, ' ').trim();
}

module.exports = { UNVANLAR, unvanBul, adUnvanAyir, adBicim, kisiEslestir, kanonikAd, plakaBicim };
