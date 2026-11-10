// Ortak yardımcılar: Türkçe metin, tarih/saat, bulanık eşleştirme, yer ayrıştırma

const ILCELER = [
  'Adalar', 'Arnavutköy', 'Ataşehir', 'Avcılar', 'Bağcılar', 'Bahçelievler', 'Bakırköy',
  'Başakşehir', 'Bayrampaşa', 'Beşiktaş', 'Beykoz', 'Beylikdüzü', 'Beyoğlu', 'Büyükçekmece',
  'Çatalca', 'Çekmeköy', 'Esenler', 'Esenyurt', 'Eyüpsultan', 'Fatih', 'Gaziosmanpaşa',
  'Güngören', 'Kadıköy', 'Kağıthane', 'Kartal', 'Küçükçekmece', 'Maltepe', 'Pendik',
  'Sancaktepe', 'Sarıyer', 'Silivri', 'Sultanbeyli', 'Sultangazi', 'Şile', 'Şişli', 'Tuzla',
  'Ümraniye', 'Üsküdar', 'Zeytinburnu'
];
const ILCE_TAKMA = {
  'b.çekmece': 'Büyükçekmece', 'b. çekmece': 'Büyükçekmece', 'bçekmece': 'Büyükçekmece',
  'k.çekmece': 'Küçükçekmece', 'k. çekmece': 'Küçükçekmece', 'eyüp': 'Eyüpsultan',
  'g.o.paşa': 'Gaziosmanpaşa', 'gop': 'Gaziosmanpaşa', 'g.paşa': 'Gaziosmanpaşa'
};

const trUpper = (s) => (s || '').toLocaleUpperCase('tr-TR');
const trLower = (s) => (s || '').toLocaleLowerCase('tr-TR');
const trTitle = (s) => (s || '').split(/(\s+)/).map(w =>
  w.trim() ? trUpper(w[0]) + trLower(w.slice(1)) : w).join('');

// Karşılaştırma için sadeleştir: küçük harf, Türkçe karakterleri ASCII'ye indir, harf/rakam dışını at
function sade(s) {
  return trLower(s)
    .replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ı/g, 'i').replace(/ö/g, 'o')
    .replace(/ş/g, 's').replace(/ü/g, 'u').replace(/â/g, 'a').replace(/î/g, 'i').replace(/û/g, 'u')
    .replace(/[^a-z0-9]/g, '');
}

function levenshtein(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

// a ile b yeterince benzer mi (uzunluğa göre tolerans)
function benzer(a, b, oran = 0.2) {
  const x = sade(a), y = sade(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const tol = Math.max(1, Math.floor(Math.max(x.length, y.length) * oran));
  return levenshtein(x, y) <= tol;
}

function ilceBul(token) {
  const t = (token || '').trim();
  if (!t) return null;
  const k = trLower(t).replace(/\s+/g, ' ');
  if (ILCE_TAKMA[k]) return ILCE_TAKMA[k];
  for (const i of ILCELER) if (sade(i) === sade(t)) return i;
  if (sade(t).length >= 5) for (const i of ILCELER) if (benzer(i, t, 0.15)) return i;
  return null;
}

// "Büyükçekmece-Tepecik, Bağcılar" -> [{ilce:'Büyükçekmece', mahalleler:['Tepecik']}, {ilce:'Bağcılar', mahalleler:[]}]
function yerAyristir(metin) {
  const gruplar = [];
  let akt = null;
  const parcalar = (metin || '').replace(/[–—]/g, '-').split(/\s*[-,/;]\s*/).map(s => s.trim()).filter(Boolean);
  for (const p of parcalar) {
    const ilce = ilceBul(p);
    if (ilce) { akt = { ilce, mahalleler: [] }; gruplar.push(akt); continue; }
    // "Sarıyer Demirciköy": ilçe ile mahalle arasında tire yerine boşluk
    const bosluklu = /^(\S+)\s+(.+)$/.exec(p);
    const ilk = bosluklu && ilceBul(bosluklu[1]);
    if (ilk) { akt = { ilce: ilk, mahalleler: [trTitle(bosluklu[2])] }; gruplar.push(akt); continue; }
    if (!akt) { akt = { ilce: '', mahalleler: [] }; gruplar.push(akt); }
    akt.mahalleler.push(trTitle(p));
  }
  return gruplar;
}

// Yer yazım kuralı (tek satır): ilçe ile mahalleleri "-", aynı ilçenin mahalleleri "/",
// ilçeler ", " ile ayrılır; "Merkez" yazılmaz.
//   Sarıyer: Demirciköy, Bahçeköy, Merkez + Üsküdar: Merkez → "Sarıyer-Demirciköy/Bahçeköy, Üsküdar"
const merkezMi = (m) => /^merkez(mah(alles[iı])?)?$/.test(sade(m));
const mahalleYaz = (mahalleler) => [...new Set((mahalleler || []).filter(m => m && !merkezMi(m)))].join('/');
const yerYaz = (gruplar) => (gruplar || [])
  .map(g => [g.ilce, mahalleYaz(g.mahalleler)].filter(Boolean).join('-')).filter(Boolean).join(', ');

// Saat
function dk(saat) {
  const m = /^(\d{1,2})[:.](\d{2})$/.exec((saat || '').trim());
  return m ? (+m[1]) * 60 + (+m[2]) : null;
}
const saatYaz = (d) => `${String(Math.floor(d / 60)).padStart(2, '0')}:${String(d % 60).padStart(2, '0')}`;
function saatNormal(s) {
  const t = (s || '').trim().replace(/[.,\s]/g, ':').replace(/^(\d{1,2})(\d{2})$/, '$1:$2');
  const d = dk(t);
  return d == null ? '' : saatYaz(d);
}

// Tarih: iç biçim 'YYYY-MM-DD'
const tarihTR = (iso) => iso ? iso.split('-').reverse().join('.') : '';
function tarihISO(tr) {
  const m = /(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})/.exec(tr || '');
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : '';
}
const AYLAR = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];

// 'YYYY-MM' aralığındaki ayların listesi
function aylar(bas, bit) {
  const out = [];
  let [y, m] = bas.split('-').map(Number);
  const [by, bm] = (bit || bas).split('-').map(Number);
  while (y < by || (y === by && m <= bm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}
function ayAraligiMetni(bas, bit) {
  const l = aylar(bas, bit);
  const yil = l[l.length - 1].slice(0, 4);
  const adlar = l.map(a => AYLAR[+a.slice(5) - 1]);
  const ayniYil = l.every(a => a.startsWith(yil));
  return ayniYil ? `${adlar.join(', ')} ${yil}` : l.map(a => `${AYLAR[+a.slice(5) - 1]} ${a.slice(0, 4)}`).join(', ');
}
function ayGunleri(ay) {
  const [y, m] = ay.split('-').map(Number);
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1, i + 1));
    return { iso: d.toISOString().slice(0, 10), hg: d.getUTCDay() };
  });
}

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const plakaBosluksuz = (p) => (p || '').replace(/\s+/g, '').toUpperCase();

module.exports = {
  ILCELER, trUpper, trLower, trTitle, sade, levenshtein, benzer, ilceBul, yerAyristir, yerYaz, mahalleYaz, merkezMi,
  dk, saatYaz, saatNormal, tarihTR, tarihISO, AYLAR, aylar, ayAraligiMetni, ayGunleri, esc, plakaBosluksuz
};
