const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const { Gorev, Kisi, Ayar, Plaka } = require('./models');
const { gorevOku } = require('./ocr');
const { secimOku } = require('./secimOku');
const { icmalUret, TURLER } = require('./icmal');
const { excelUret, pdfUret } = require('./disaktar');
const { yerAyristir, saatNormal } = require('./util');
const drive = require('./drive');
const elyazisi = require('./elyazisi');
const { kanonikAd, adUnvanAyir, adBicim, unvanBul, plakaBicim } = require('./kisiler');
const { sade } = require('./util');
const { gorevDuzelt, gorevleriOnar } = require('./duzelt');
const varsayilan = require('../seed/varsayilan');

const PORT = process.env.PORT || 1138;
const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017/gemis';
// Yalnızca "Görüntüleri sunucuda sakla" seçeneği açıkken kullanılır.
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'data', 'uploads');

const SURUM = require('../package.json').version;
const app = express();
app.use(express.json({ limit: '5mb' }));
// Sayfa her açılışta yeniden istenir ve script/stil adresleri sürüm taşır: güncellemeden sonra
// tarayıcıda eski dosya kalmaz
const PUBLIC = path.join(__dirname, '..', 'public');
const sayfa = () => fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8')
  .replace(/(src|href)="\/(app\.js|style\.css)"/g, `$1="/$2?v=${SURUM}"`).replace(/__SURUM__/g, SURUM);
app.get(['/', '/index.html'], (req, res) => { res.setHeader('Cache-Control', 'no-cache'); res.type('html').send(sayfa()); });
app.use(express.static(PUBLIC, { index: false, setHeaders: (res, p) => { if (/\.(js|css|html)$/.test(p)) res.setHeader('Cache-Control', 'no-cache'); } }));
app.use('/vendor/bootstrap', express.static(path.join(__dirname, '..', 'node_modules', 'bootstrap', 'dist')));
app.use('/vendor/adminlte', express.static(path.join(__dirname, '..', 'node_modules', 'admin-lte', 'dist')));
app.use('/vendor/overlayscrollbars', express.static(path.join(__dirname, '..', 'node_modules', 'overlayscrollbars')));
app.use('/vendor/icons', express.static(path.join(__dirname, '..', 'node_modules', 'bootstrap-icons', 'font')));

// Yüklenen dosyalar bellekte tutulur; diske yalnızca saklama seçeneği açıksa yazılır.
const yukle = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => cb(null, /image\/(jpeg|png)/.test(file.mimetype)),
  limits: { fileSize: 25 * 1024 * 1024 }
});

const hata = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch(e => {
  console.error(e);
  const mesaj = e.response?.data?.error?.message || e.message;
  res.status(500).json({ hata: mesaj });
});

async function ayarGetir() {
  let a = await Ayar.findById('ayar').lean();
  if (!a) {
    await Ayar.create({ _id: 'ayar', tatiller: varsayilan.tatiller, mahalliDisi: varsayilan.mahalliDisi });
    a = await Ayar.findById('ayar').lean();
  }
  elyazisi.ayarla(a.elYazisiMotoru || 'paddle');
  return a;
}

async function ilkKurulum() {
  await ayarGetir();
  if (!(await Kisi.countDocuments())) await Kisi.insertMany(varsayilan.kisiler);
  await gorevleriOnar(Gorev);
  await kisilerToparla();
  // Plaka listesi ilk kez kuruluyorsa onaylanmış görevlerdeki plakalarla başlar
  if (!(await Plaka.countDocuments())) {
    const onayli = (await Gorev.distinct('plaka', { onayli: true })).map(plakaBicim).filter(p => /^\d{2} [A-ZÇĞİÖŞÜ]{1,3} \d{2,5}$/.test(p));
    if (onayli.length) await Plaka.insertMany([...new Set(onayli)].map(plaka => ({ plaka })), { ordered: false }).catch(() => {});
  }
}

// Aynı kişinin farklı yazımlarını birleştirir, ada karışmış ünvanları ayırır ("Uğur TÜRKELİ İMÜHENDİS"),
// görev kayıtlarındaki adları kayıtlı yazıma çevirir. Her açılışta çalışır; değişiklik yoksa bir şey yapmaz.
async function kisilerToparla() {
  const tum = await Kisi.find().lean();
  const gruplar = new Map();
  for (const k of tum) {
    const { ad, unvan } = adUnvanAyir(k.ad);
    const temiz = adBicim(ad) || k.ad;
    const anahtar = sade(temiz);
    if (!gruplar.has(anahtar)) gruplar.set(anahtar, []);
    gruplar.get(anahtar).push({ ...k, temiz, ayrilanUnvan: unvan });
  }
  const donusum = new Map(); // eski ad -> yeni ad
  for (const grup of gruplar.values()) {
    // Ünvanı dolu ve adı düzgün yazılmış olan kalır
    grup.sort((a, b) => (!!b.unvan - !!a.unvan) || ((b.ad === b.temiz) - (a.ad === a.temiz)));
    const asil = grup[0];
    const ad = grup.find(x => x.ad === x.temiz)?.ad || asil.temiz;
    const unvan = grup.map(x => x.unvan).find(Boolean) || grup.map(x => x.ayrilanUnvan).find(Boolean) || '';
    const unvanCetvel = grup.map(x => x.unvanCetvel || x.unvanSeyyar).find(Boolean) || '';
    const degisti = grup.length > 1 || asil.ad !== ad || (asil.unvan || '') !== unvan || (asil.unvanCetvel || '') !== unvanCetvel;
    if (!degisti) continue;
    for (const x of grup) if (x.ad !== ad) donusum.set(x.ad, ad);
    await Kisi.deleteMany({ _id: { $in: grup.map(x => x._id) } });
    await Kisi.create({ ad, unvan, unvanCetvel });
  }
  // Görev kayıtlarındaki adlar: kayıtlı kişiye bağlanabilenler kayıtlı yazıma çevrilir ("Uğur TÜRKELİ İMÜHENDİS" → "Uğur TÜRKELİ")
  const kisiler = await Kisi.find().lean();
  const cevir = (a) => {
    if (typeof a !== 'string' || !a.trim()) return a;
    if (donusum.has(a)) return donusum.get(a);
    const r = kanonikAd(a, kisiler);
    return r.kayitli ? r.ad : a;
  };
  let duzelen = 0;
  for (const g of await Gorev.find({}, { personel: 1, surucu: 1 }).lean()) {
    const personel = Array.isArray(g.personel) ? [...new Set(g.personel.map(cevir).filter(Boolean))] : g.personel;
    const surucu = cevir(g.surucu);
    if (JSON.stringify(personel) !== JSON.stringify(g.personel) || surucu !== g.surucu) {
      await Gorev.updateOne({ _id: g._id }, { $set: { personel, surucu } });
      duzelen++;
    }
  }
  if (donusum.size || duzelen) console.log(`Kişiler toparlandı: ${donusum.size} farklı yazım birleştirildi, ${duzelen} görev kaydındaki adlar düzeltildi.`);
}

// Görev verisini temizle (formdan ya da OCR'dan gelen)
function gorevTemizle(b) {
  const g = { ...b };
  ['tarih', 'sayi', 'belgeNo', 'gorevTuru', 'yerHam', 'plaka', 'surucu'].forEach(k => { if (typeof g[k] === 'string') g[k] = g[k].trim(); });
  if (g.plaka) g.plaka = plakaBicim(g.plaka);
  if (typeof g.yerHam === 'string') g.yer = yerAyristir(g.yerHam);
  if (g.cikis !== undefined) g.cikis = saatNormal(g.cikis);
  if (g.donus !== undefined) g.donus = saatNormal(g.donus);
  if (Array.isArray(g.personel)) g.personel = [...new Set(g.personel.map(s => s.trim()).filter(Boolean))];
  for (const k of ['_id', 'dosya', 'driveId', 'driveAd', 'ocrMetin', 'okunanUnvanlar', 'createdAt', 'updatedAt']) delete g[k];
  return g;
}

// Görevdeki adları kayıtlı kişilere bağla (aynı kişinin farklı yazımları tek ada iner).
// ekle=true yalnızca kayıt onaylandığında ("Kontrol ettim") verilir: o zaman listede olmayan kişiler
// (ünvanıyla) ve plaka listeye eklenir. Onaylanmamış OCR okumaları listeyi değiştirmez.
// unvanlar: OCR'ın ünvan sütunundan okuduğu { ad: ünvan } eşlemesi
async function adlariDuzenle(g, unvanlar = {}, ekle = false) {
  const kisiler = await Kisi.find().lean();
  const isle = async (ham, ipucu = {}) => {
    if (!ham || !String(ham).trim()) return '';
    const r = kanonikAd(String(ham), kisiler, 0.2, ipucu);
    if (!r.ad) return '';
    const unvan = r.unvan || unvanlar[ham] || unvanlar[r.ad] || '';
    if (ekle && !r.kayitli) {
      await Kisi.updateOne({ ad: r.ad }, { $setOnInsert: { ad: r.ad, unvan } }, { upsert: true });
      kisiler.push({ ad: r.ad, unvan });
    } else if (ekle && unvan && !r.kisi?.unvan) {
      await Kisi.updateOne({ ad: r.ad, $or: [{ unvan: null }, { unvan: '' }] }, { $set: { unvan } });
    }
    return r.ad;
  };
  if (Array.isArray(g.personel)) {
    const l = [];
    for (const p of g.personel) { const a = await isle(p); if (a && !l.includes(a)) l.push(a); }
    g.personel = l;
  }
  // Sürücü görevlilerden biriyse aynı kişi olarak bağlanır
  if (typeof g.surucu === 'string') g.surucu = await isle(g.surucu, { tercih: new Set(g.personel || []) });
  if (typeof g.plaka === 'string' && g.plaka) {
    g.plaka = plakaBicim(g.plaka);
    if (ekle && /^\d{2} [A-ZÇĞİÖŞÜ]{1,3} \d{2,5}$/.test(g.plaka)) await Plaka.updateOne({ plaka: g.plaka }, { $setOnInsert: { plaka: g.plaka } }, { upsert: true });
  }
  return g;
}

async function ocrBaglami() {
  const ayar = await ayarGetir();
  const kisiler = await Kisi.find().lean();
  const bilinenMahalleler = {};
  for (const m of ayar.mahalliDisi || []) bilinenMahalleler[m.ilce] = [...m.mahalleler];
  for (const g0 of await Gorev.find({}, { yer: 1 }).lean()) {
    const g = gorevDuzelt(g0);
    for (const y of g.yer) {
      bilinenMahalleler[y.ilce] = bilinenMahalleler[y.ilce] || [];
      for (const m of y.mahalleler) if (!bilinenMahalleler[y.ilce].includes(m)) bilinenMahalleler[y.ilce].push(m);
    }
  }
  const bilinenPlakalar = (await Plaka.find().lean()).map(p => p.plaka);
  return {
    kisiler, bilinenMahalleler, bilinenPlakalar,
    amirler: (ayar.ocrHaricAdlar || []).filter(Boolean)
  };
}

// ---------- Görüntü erişimi ----------
const gorselVar = (g) => !!(g?.dosya || g?.driveId);

function yerelKaydet(buf, ad) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const dosya = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${path.extname(ad || '').toLowerCase() || '.jpg'}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, dosya), buf);
  return dosya;
}

// Önce yerel kopya (varsa), yoksa Drive'dan anlık indirme. Drive'dan gelen veri diske yazılmaz.
async function gorselGetir(g) {
  if (g.dosya) {
    try { return await fs.promises.readFile(path.join(UPLOAD_DIR, g.dosya)); } catch { /* Drive'a düş */ }
  }
  if (g.driveId) return drive.indir(g.driveId);
  return null;
}

// OCR sonucunu kayda işle.
// Eşleşme sırası: belge no (+ tarih), görev emri sayısı (OCR'ın arka planda okuduğu), aynı tarihli ve görüntüsü olmayan kayıt.
// Örnek kayıtlar eşleşmez. Kontrol edilmemiş kayıtta yeni OCR sonucu öncekinin üzerine yazılır;
// kontrol edilmiş kayıtta yalnızca boş alanlar doldurulur.
const OCR_ALANLARI = ['tarih', 'sayi', 'belgeNo', 'yerHam', 'yer', 'plaka', 'surucu', 'personel', 'cikis', 'donus'];
const dolu = (v) => Array.isArray(v) ? v.length > 0 : !!v;

async function kaydaIsle(okunan, gorselAlanlari) {
  await adlariDuzenle(okunan, okunan.kisiUnvanlari || {}, false); // OCR listeye ekleme yapmaz
  okunan.okunanUnvanlar = okunan.kisiUnvanlari || {};
  delete okunan.kisiUnvanlari;
  // Not: koşullar $and ile birleştirilir; aynı alanı iki kez yazmak birini ezer.
  const gercek = [{ ornek: { $ne: true } }, { sayi: { $not: /^E-00000000-/ } }];
  const belgeNo = /^\d{6}$/.test(okunan.belgeNo || '') ? okunan.belgeNo : '';
  let kayit = null;
  if (belgeNo) kayit = await Gorev.findOne({ $and: [{ belgeNo }, ...(okunan.tarih ? [{ tarih: okunan.tarih }] : []), ...gercek] });
  if (!kayit && okunan.sayi) kayit = await Gorev.findOne({ $and: [{ sayi: okunan.sayi }, ...gercek] });
  if (!kayit && okunan.tarih) {
    kayit = await Gorev.findOne({ $and: [
      { tarih: okunan.tarih }, { dosya: { $in: [null, ''] } }, { driveId: { $in: [null, ''] } },
      // Başka bir görev emrinin belge no'sunu ya da sayısını taşıyan kayıt aynı tarihte olsa da eşleşmez
      ...(belgeNo ? [{ belgeNo: { $in: [null, '', belgeNo] } }] : []),
      ...(okunan.sayi ? [{ sayi: { $in: [null, '', okunan.sayi] } }] : []),
      ...gercek
    ] });
  }
  if (kayit) {
    for (const k of OCR_ALANLARI) {
      if (!dolu(okunan[k])) continue;
      if (!kayit.onayli || !dolu(kayit[k])) kayit[k] = okunan[k];
    }
    Object.assign(kayit, gorselAlanlari, { ocrMetin: okunan.ocrMetin, okunanUnvanlar: { ...(kayit.okunanUnvanlar || {}), ...okunan.okunanUnvanlar } });
    await kayit.save();
    return { kayit, durum: kayit.onayli ? 'mevcut kayda bağlandı (boş alanlar dolduruldu)' : 'mevcut kayıt OCR ile güncellendi' };
  }
  kayit = await Gorev.create({ ...okunan, ...gorselAlanlari, onayli: false });
  return { kayit, durum: 'yeni kayıt (kontrol bekliyor)' };
}

// ---------- Görevler ----------
// ay=YYYY-MM: o ayın kayıtları + tarihi okunamamış kayıtlar (hiçbir ayda kaybolmasınlar); ay=tum: hepsi
app.get('/api/gorevler', hata(async (req, res) => {
  const ay = String(req.query.ay || '');
  let q = {};
  if (/^\d{4}-\d{2}$/.test(ay)) q = { $or: [{ tarih: { $regex: `^${ay}` } }, { tarih: { $in: [null, ''] } }, { tarih: { $exists: false } }] };
  const liste = (await Gorev.find(q, { ocrMetin: 0 }).lean()).map(gorevDuzelt);
  // Tarihsizler en üstte, sonra tarihe göre
  liste.sort((a, b) => (a.tarih ? 1 : 0) - (b.tarih ? 1 : 0) || String(a.tarih).localeCompare(String(b.tarih)));
  res.json(liste);
}));

// Kayıt bulunan aylar ve sayıları (en yeniden eskiye); tarihsiz kayıt sayısı ayrıca
app.get('/api/gorevler-aylar', hata(async (req, res) => {
  const r = await Gorev.aggregate([{ $group: { _id: { $substrCP: [{ $ifNull: ['$tarih', ''] }, 0, 7] }, sayi: { $sum: 1 } } }]);
  const aylar = r.filter(x => /^\d{4}-\d{2}$/.test(x._id)).map(x => ({ ay: x._id, sayi: x.sayi })).sort((a, b) => b.ay.localeCompare(a.ay));
  res.json({ aylar, tarihsiz: r.filter(x => !/^\d{4}-\d{2}$/.test(x._id)).reduce((t, x) => t + x.sayi, 0) });
}));

app.get('/api/surum', (req, res) => res.json({ surum: SURUM }));

app.get('/api/gorevler/:id', hata(async (req, res) => {
  const g = await Gorev.findById(req.params.id).lean();
  if (!g) return res.status(404).json({ hata: 'Kayıt bulunamadı' });
  res.json({ ...gorevDuzelt(g), ocrMetin: g.ocrMetin || '' });
}));

app.post('/api/gorevler', hata(async (req, res) => {
  const g = gorevTemizle(req.body);
  const kayit = await Gorev.create(await adlariDuzenle(g, {}, !!g.onayli));
  res.json(kayit);
}));

app.put('/api/gorevler/:id', hata(async (req, res) => {
  const g = gorevTemizle(req.body);
  const onceki = await Gorev.findById(req.params.id, { okunanUnvanlar: 1 }).lean();
  const kayit = await Gorev.findByIdAndUpdate(req.params.id, await adlariDuzenle(g, onceki?.okunanUnvanlar || {}, !!g.onayli), { new: true });
  res.json(kayit);
}));

// Kaydı siler. Yerel kopya varsa o da silinir; Drive'daki dosyaya dokunulmaz.
app.delete('/api/gorevler/:id', hata(async (req, res) => {
  const g = await Gorev.findByIdAndDelete(req.params.id);
  if (g?.dosya) fs.unlink(path.join(UPLOAD_DIR, g.dosya), () => {});
  res.json({ ok: true });
}));

app.get('/api/gorevler/:id/gorsel', hata(async (req, res) => {
  const g = await Gorev.findById(req.params.id).lean();
  const buf = g && await gorselGetir(g);
  if (!buf) return res.status(404).end();
  res.setHeader('Content-Type', buf[0] === 0x89 ? 'image/png' : 'image/jpeg');
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(buf);
}));

// Elle yükleme + OCR. Görüntü bellekte işlenir; yalnızca saklama seçeneği açıksa diske yazılır.
app.post('/api/gorevler/yukle', yukle.array('dosyalar', 60), hata(async (req, res) => {
  if (!req.files?.length) return res.status(400).json({ hata: 'Dosya alınamadı. Yalnızca JPEG ve PNG görüntüler okunabilir.' });
  const ayar = await ayarGetir();
  const baglam = await ocrBaglami();
  const sonuc = [];
  for (const f of req.files) {
    const ad = Buffer.from(f.originalname, 'latin1').toString('utf8');
    const okunan = await gorevOku(f.buffer, ad, baglam);
    const alanlar = ayar.gorselSakla ? { dosya: yerelKaydet(f.buffer, ad) } : {};
    const { kayit, durum } = await kaydaIsle(okunan, alanlar);
    sonuc.push({ id: kayit._id, dosya: ad, durum: ayar.gorselSakla ? durum : `${durum}, görüntü saklanmadı`, tarih: kayit.tarih });
  }
  res.json(sonuc);
}));

app.post('/api/gorevler/:id/ocr', hata(async (req, res) => {
  const g = await Gorev.findById(req.params.id).lean();
  const buf = g && await gorselGetir(g);
  if (!buf) return res.status(400).json({ hata: 'Bu kaydın görüntüsü yok.' });
  res.json(await gorevOku(buf, g.driveAd || '', await ocrBaglami())); // forma öneri olarak döner, kaydetmez
}));

// Seçerek oku: tarayıcıda kesilen parça yalnızca bellekte okunur, saklanmaz
app.post('/api/ocr/secim', yukle.single('parca'), hata(async (req, res) => {
  if (!req.file) return res.status(400).json({ hata: 'Seçilen parça alınamadı.' });
  res.json(await secimOku(req.file.buffer, String(req.body?.alan || ''), await ocrBaglami()));
}));

// Bilgisayardan açılan görüntüyle OCR'ı yeniden çalıştır (kayda yazmaz, forma öneri döner)
app.post('/api/ocr/tam', yukle.single('dosya'), hata(async (req, res) => {
  if (!req.file) return res.status(400).json({ hata: 'Dosya alınamadı. Yalnızca JPEG ve PNG görüntüler okunabilir.' });
  const ad = Buffer.from(req.file.originalname || '', 'latin1').toString('utf8');
  res.json(await gorevOku(req.file.buffer, ad, await ocrBaglami()));
}));

app.get('/api/oneriler', hata(async (req, res) => {
  const [plakalar, kisiler] = await Promise.all([Plaka.find().sort({ plaka: 1 }).lean(), Kisi.find().sort({ ad: 1 }).lean()]);
  res.json({
    plakalar: plakalar.map(p => ({ plaka: p.plaka, aciklama: p.aciklama || '' })),
    kisiler: kisiler.map(k => ({ ad: k.ad, unvan: k.unvan || '' }))
  });
}));

// ---------- Google Drive ----------
const taramaDurumu = { calisiyor: false, son: null, sonuc: null, toplam: 0, islenen: 0 };

async function driveTara() {
  if (taramaDurumu.calisiyor) throw new Error('Tarama zaten sürüyor.');
  const ayar = await ayarGetir();
  const kok = drive.klasorKimligi(ayar.driveKlasor);
  if (!kok) throw new Error('Ayarlar\'da Drive klasörü girilmemiş.');
  taramaDurumu.calisiyor = true;
  taramaDurumu.toplam = 0; taramaDurumu.islenen = 0;
  const ozet = { bulunan: 0, yeni: 0, baglanan: 0, hata: [], kayitlar: [] };
  try {
    const dosyalar = await drive.gorselleriBul(kok);
    ozet.bulunan = dosyalar.length;
    const islenmis = new Set((await Gorev.distinct('driveId')).filter(Boolean));
    const baglam = await ocrBaglami();
    const yeniler = dosyalar.filter(x => !islenmis.has(x.id));
    taramaDurumu.toplam = yeniler.length;
    for (const f of yeniler) {
      taramaDurumu.islenen++;
      try {
        const buf = await drive.indir(f.id);
        const ad = f.yol ? `${f.yol}/${f.name}` : f.name;
        const okunan = await gorevOku(buf, f.name, baglam);
        const alanlar = { driveId: f.id, driveAd: ad, ...(ayar.gorselSakla ? { dosya: yerelKaydet(buf, f.name) } : {}) };
        const { kayit, durum } = await kaydaIsle(okunan, alanlar);
        if (durum.startsWith('mevcut')) ozet.baglanan++; else ozet.yeni++;
        ozet.kayitlar.push({ id: kayit._id, dosya: ad, durum, tarih: kayit.tarih });
      } catch (e) { ozet.hata.push(`${f.name}: ${e.message}`); }
    }
  } catch (e) {
    ozet.hata.push(e.response?.data?.error?.message || e.message);
  } finally {
    taramaDurumu.calisiyor = false;
    taramaDurumu.son = new Date();
    taramaDurumu.sonuc = ozet;
  }
  return ozet;
}

app.get('/api/drive/durum', hata(async (req, res) => {
  const ayar = await ayarGetir();
  res.json({
    tanimli: drive.tanimli(), eposta: drive.hesapEposta(), klasor: ayar.driveKlasor || '',
    calisiyor: taramaDurumu.calisiyor, son: taramaDurumu.son, sonuc: taramaDurumu.sonuc,
    toplam: taramaDurumu.toplam, islenen: taramaDurumu.islenen
  });
}));

app.post('/api/drive/test', hata(async (req, res) => {
  const id = drive.klasorKimligi(req.body?.klasor || (await ayarGetir()).driveKlasor);
  if (!id) return res.status(400).json({ hata: 'Klasör bağlantısı ya da kimliği giriniz.' });
  const bilgi = await drive.klasorBilgisi(id);
  const gorseller = await drive.gorselleriBul(id);
  res.json({ ad: bilgi.name, gorselSayisi: gorseller.length });
}));

// Tarama arka planda yürür (Cloudflare gibi vekillerin 100 sn istek sınırına takılmaması için);
// arayüz ilerlemeyi /api/drive/durum ile izler.
app.post('/api/drive/tara', hata(async (req, res) => {
  if (taramaDurumu.calisiyor) return res.json({ basladi: false, calisiyor: true });
  const ayar = await ayarGetir();
  if (!drive.klasorKimligi(ayar.driveKlasor)) return res.status(400).json({ hata: 'Ayarlar\'da Drive klasörü girilmemiş.' });
  driveTara().catch(e => console.error('Drive taraması:', e.message));
  res.json({ basladi: true });
}));

// Otomatik tarama: her dakika ayarı kontrol eder
setInterval(async () => {
  try {
    if (mongoose.connection.readyState !== 1 || !drive.tanimli() || taramaDurumu.calisiyor) return;
    const ayar = await ayarGetir();
    const dk = Number(ayar.driveOtoTaraDk) || 0;
    if (!dk || !ayar.driveKlasor) return;
    if (taramaDurumu.son && Date.now() - taramaDurumu.son.getTime() < dk * 60000) return;
    const o = await driveTara();
    if (o.yeni || o.baglanan || o.hata.length) console.log(`Drive taraması: ${o.yeni} yeni, ${o.baglanan} bağlandı, ${o.hata.length} hata`);
  } catch (e) { console.error('Otomatik Drive taraması:', e.message); }
}, 60000);

// ---------- Ayarlar / Kişiler ----------
app.get('/api/ayarlar', hata(async (req, res) => res.json(await ayarGetir())));
app.put('/api/ayarlar', hata(async (req, res) => {
  const b = { ...req.body }; delete b._id; delete b.__v;
  res.json(await Ayar.findByIdAndUpdate('ayar', b, { new: true, upsert: true }));
}));
app.get('/api/kisiler', hata(async (req, res) => res.json(await Kisi.find().sort({ ad: 1 }).lean())));
app.put('/api/kisiler', hata(async (req, res) => {
  // Aynı kişinin farklı yazımları tek kayda iner; ada yazılmış ünvan ayrılır
  const harita = new Map();
  for (const k of req.body || []) {
    if (!k.ad?.trim()) continue;
    const { ad, unvan } = adUnvanAyir(k.ad.trim());
    const temiz = adBicim(ad);
    if (!temiz) continue;
    const anahtar = sade(temiz);
    const onceki = harita.get(anahtar) || {};
    harita.set(anahtar, {
      ad: onceki.ad || temiz,
      unvan: onceki.unvan || (k.unvan || '').trim() || unvan,
      unvanCetvel: onceki.unvanCetvel || (k.unvanCetvel || '').trim()
    });
  }
  await Kisi.deleteMany({});
  await Kisi.insertMany([...harita.values()], { ordered: false }).catch(() => {});
  res.json(await Kisi.find().sort({ ad: 1 }).lean());
}));

app.get('/api/plakalar', hata(async (req, res) => res.json(await Plaka.find().sort({ plaka: 1 }).lean())));
app.put('/api/plakalar', hata(async (req, res) => {
  const harita = new Map();
  for (const p of req.body || []) {
    const plaka = plakaBicim(p.plaka || '');
    if (!plaka) continue;
    if (!harita.has(plaka)) harita.set(plaka, { plaka, aciklama: (p.aciklama || '').trim() });
  }
  await Plaka.deleteMany({});
  await Plaka.insertMany([...harita.values()], { ordered: false }).catch(() => {});
  res.json(await Plaka.find().sort({ plaka: 1 }).lean());
}));

app.post('/api/ornek-veri', hata(async (req, res) => {
  let eklenen = 0;
  for (const g of varsayilan.ornek) {
    if (await Gorev.exists({ tarih: g.tarih, sayi: g.sayi, ornek: true })) continue;
    await Gorev.create({ ...g, yer: yerAyristir(g.yerHam), ornek: true });
    eklenen++;
  }
  res.json({ eklenen });
}));

app.delete('/api/ornek-veri', hata(async (req, res) => {
  const r = await Gorev.deleteMany({ $or: [{ ornek: true }, { sayi: /^E-00000000-/ }] });
  res.json({ silinen: r.deletedCount });
}));

// ---------- İcmaller ----------
function secenekler(q) {
  const bas = q.bas, bit = q.bit || q.bas;
  if (!/^\d{4}-\d{2}$/.test(bas || '') || !/^\d{4}-\d{2}$/.test(bit)) throw new Error('Ay seçiniz');
  return {
    bas, bit, haric: (q.haric || '').split(',').map(s => s.trim()).filter(Boolean), donemMetni: q.donem || '',
    kisi: (q.kisi || '').trim(), tumKisiler: q.kisi === '*'
  };
}

// Seçilen kişinin adı ve ünvanlarıyla ayarları birleştir. "*" yalnızca görev listesi için (tüm kişiler).
async function kisiAyari(ayar, ad) {
  const temel = { ...ayar, subeMuduruAd: '', ilMudYrdAd: '' }; // imzalar EDYS'de atanır; Excel'de ad satırı boş kalır
  if (ad === '*') return { ...temel, personelAd: '', personelUnvan: '', personelUnvanCetvel: '', personelUnvanSeyyar: '' };
  if (!ad) throw new Error('Personel seçiniz.');
  const k = await Kisi.findOne({ ad }).lean();
  if (!k) throw new Error(`Kişi bulunamadı: ${ad}`);
  const gorev = k.unvan || '';
  const unvan = k.unvanCetvel || k.unvanSeyyar || gorev;
  return { ...temel, personelAd: k.ad, personelUnvan: gorev, personelUnvanCetvel: unvan, personelUnvanSeyyar: unvan };
}

async function icmalHazirla(req) {
  const sec = secenekler(req.query);
  const ayar = await kisiAyari(await ayarGetir(), sec.kisi);
  const gorevler = (await Gorev.find({}, { ocrMetin: 0 }).lean()).map(gorevDuzelt);
  return { ayar, icmal: icmalUret(req.params.tur, ayar, gorevler, sec) };
}
const dosyaAdi = (s) => s.replace(/[^\wçğıöşüÇĞİÖŞÜ -]/g, '').replace(/\s+/g, '_');

app.get('/api/turler', (req, res) => res.json(TURLER));

app.get('/api/icmal/:tur', hata(async (req, res) => {
  const { icmal } = await icmalHazirla(req);
  res.json({
    baslik: icmal.baslik, html: icmal.html, uyarilar: icmal.uyarilar,
    excel: { basliklar: icmal.excel.basliklar, satirlar: icmal.excel.satirlar },
    gorevSayisi: icmal.gorevler.length, gorselSayisi: icmal.gorevler.filter(gorselVar).length
  });
}));

app.get('/api/icmal/:tur/xlsx', hata(async (req, res) => {
  const { ayar, icmal } = await icmalHazirla(req);
  const buf = await excelUret(ayar, icmal.excel);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(dosyaAdi(icmal.baslik))}.xlsx`);
  res.send(Buffer.from(buf));
}));

app.get('/api/icmal/:tur/html', hata(async (req, res) => {
  const { icmal } = await icmalHazirla(req);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(dosyaAdi(icmal.baslik))}.html`);
  res.send(icmal.html);
}));

app.get('/api/icmal/:tur/pdf', hata(async (req, res) => {
  const { icmal } = await icmalHazirla(req);
  const buf = await pdfUret(icmal.gorevler.filter(gorselVar), gorselGetir);
  if (!buf) return res.status(404).json({ hata: 'Bu icmaldeki görevlerin görüntüsü yok.' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(dosyaAdi(icmal.baslik) + '_gorev_emirleri')}.pdf`);
  res.send(buf);
}));

// ---------- Sistem denetimi: Tesseract ve Türkçe dil dosyası ----------
const sistem = { tesseract: '', diller: [], tur: false, hata: '' };
function sistemDenetle() {
  const { execFile } = require('child_process');
  execFile('tesseract', ['--version'], (e1, o1, h1) => {
    if (e1) { sistem.hata = 'Tesseract bulunamadı; OCR çalışmaz.'; console.error(sistem.hata); return; }
    sistem.tesseract = `${o1 || h1}`.split('\n')[0].trim();
    execFile('tesseract', ['--list-langs'], (e2, o2, h2) => {
      sistem.diller = `${o2}\n${h2}`.split('\n').map(x => x.trim()).filter(x => /^[a-z_]{3,}$/.test(x));
      sistem.tur = sistem.diller.includes('tur');
      if (!sistem.tur) { sistem.hata = 'Tesseract Türkçe dil dosyası (tur) yüklü değil; OCR düzgün çalışmaz.'; console.error(sistem.hata); }
      else console.log(`OCR: ${sistem.tesseract}, diller: ${sistem.diller.join(' ')}`);
    });
  });
}
app.get('/api/sistem', async (req, res) => {
  await elyazisi.denetle();
  const e = elyazisi.durum;
  res.json({ ...sistem, elyazisi: { tanimli: e.tanimli, acik: e.acik, motor: e.motor, secim: e.secim, hata: e.tanimli && !e.acik ? e.hata : '' } });
});

(async () => {
  sistemDenetle();
  for (let i = 1; ; i++) {
    try { await mongoose.connect(MONGO_URL); break; } catch (e) {
      if (i >= 30) throw e;
      console.log(`MongoDB bekleniyor (${i})...`); await new Promise(r => setTimeout(r, 2000));
    }
  }
  await ilkKurulum();
  await ayarGetir(); // el yazısı motoru seçimini uygula
  app.listen(PORT, () => console.log(`GEMİS http://localhost:${PORT}${drive.tanimli() ? ` · Drive: ${drive.hesapEposta()}` : ''}`));
})();
