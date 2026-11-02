const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const { Gorev, Kisi, Ayar } = require('./models');
const { gorevOku } = require('./ocr');
const { icmalUret, TURLER } = require('./icmal');
const { excelUret, pdfUret } = require('./disaktar');
const { yerAyristir, saatNormal } = require('./util');
const drive = require('./drive');
const varsayilan = require('../seed/varsayilan');

const PORT = process.env.PORT || 1138;
const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017/gemis';
// Yalnızca "Görüntüleri sunucuda sakla" seçeneği açıkken kullanılır.
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'data', 'uploads');

const app = express();
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/vendor/bootstrap', express.static(path.join(__dirname, '..', 'node_modules', 'bootstrap', 'dist')));
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
  return a;
}

async function ilkKurulum() {
  await ayarGetir();
  if (!(await Kisi.countDocuments())) await Kisi.insertMany(varsayilan.kisiler);
}

// Görev verisini temizle (formdan ya da OCR'dan gelen)
function gorevTemizle(b) {
  const g = { ...b };
  ['tarih', 'sayi', 'belgeNo', 'gorevTuru', 'yerHam', 'plaka', 'surucu'].forEach(k => { if (typeof g[k] === 'string') g[k] = g[k].trim(); });
  if (g.plaka) g.plaka = g.plaka.toLocaleUpperCase('tr-TR').replace(/\s+/g, ' ');
  if (typeof g.yerHam === 'string') g.yer = yerAyristir(g.yerHam);
  if (g.cikis !== undefined) g.cikis = saatNormal(g.cikis);
  if (g.donus !== undefined) g.donus = saatNormal(g.donus);
  if (Array.isArray(g.personel)) g.personel = [...new Set(g.personel.map(s => s.trim()).filter(Boolean))];
  for (const k of ['_id', 'dosya', 'driveId', 'driveAd', 'ocrMetin', 'createdAt', 'updatedAt']) delete g[k];
  return g;
}

// Kişi listesine yeni adları ekle (öneri ve OCR eşleştirmesi için)
async function kisileriKaydet(g) {
  const adlar = [...(g.personel || []), g.surucu].filter(Boolean);
  for (const ad of adlar) await Kisi.updateOne({ ad }, { $setOnInsert: { ad, unvan: '' } }, { upsert: true });
}

async function ocrBaglami() {
  const ayar = await ayarGetir();
  const kisiler = await Kisi.find().lean();
  const bilinenMahalleler = {};
  for (const m of ayar.mahalliDisi || []) bilinenMahalleler[m.ilce] = [...m.mahalleler];
  for (const g of await Gorev.find({}, { yer: 1 }).lean()) {
    for (const y of g.yer || []) {
      bilinenMahalleler[y.ilce] = bilinenMahalleler[y.ilce] || [];
      for (const m of y.mahalleler) if (!bilinenMahalleler[y.ilce].includes(m)) bilinenMahalleler[y.ilce].push(m);
    }
  }
  return {
    kisiler, bilinenMahalleler, sayiOnek: ayar.sayiOnek || '',
    amirler: [ayar.subeMuduruAd, ayar.ilMudYrdAd, ...(ayar.ocrHaricAdlar || [])].filter(a => a && a !== 'Ad SOYAD')
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

// OCR sonucunu, aynı tarihte görüntüsü olmayan bir kayda bağla ya da yeni kayıt aç
async function kaydaIsle(okunan, gorselAlanlari) {
  const bos = { dosya: { $in: [null, ''] }, driveId: { $in: [null, ''] } };
  let kayit = okunan.tarih ? await Gorev.findOne({ tarih: okunan.tarih, ...bos }) : null;
  if (kayit) {
    Object.assign(kayit, gorselAlanlari, { ocrMetin: okunan.ocrMetin });
    await kayit.save();
    return { kayit, durum: 'mevcut kayda bağlandı' };
  }
  kayit = await Gorev.create({ ...okunan, ...gorselAlanlari, onayli: false });
  return { kayit, durum: 'yeni kayıt (kontrol bekliyor)' };
}

// ---------- Görevler ----------
app.get('/api/gorevler', hata(async (req, res) => {
  const q = {};
  if (req.query.ay) q.tarih = { $regex: `^${req.query.ay}` };
  res.json(await Gorev.find(q, { ocrMetin: 0 }).sort({ tarih: 1 }).lean());
}));

app.get('/api/gorevler/:id', hata(async (req, res) => res.json(await Gorev.findById(req.params.id).lean())));

app.post('/api/gorevler', hata(async (req, res) => {
  const kayit = await Gorev.create(gorevTemizle(req.body));
  await kisileriKaydet(kayit);
  res.json(kayit);
}));

app.put('/api/gorevler/:id', hata(async (req, res) => {
  const kayit = await Gorev.findByIdAndUpdate(req.params.id, gorevTemizle(req.body), { new: true });
  await kisileriKaydet(kayit);
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
  const ayar = await ayarGetir();
  const baglam = await ocrBaglami();
  const sonuc = [];
  for (const f of req.files || []) {
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

app.get('/api/oneriler', hata(async (req, res) => {
  const [plakalar, suruculer, kisiler] = await Promise.all([Gorev.distinct('plaka'), Gorev.distinct('surucu'), Kisi.find().sort({ ad: 1 }).lean()]);
  res.json({ plakalar: plakalar.filter(Boolean).sort(), suruculer: suruculer.filter(Boolean).sort(), kisiler: kisiler.map(k => k.ad) });
}));

// ---------- Google Drive ----------
const taramaDurumu = { calisiyor: false, son: null, sonuc: null };

async function driveTara() {
  if (taramaDurumu.calisiyor) throw new Error('Tarama zaten sürüyor.');
  const ayar = await ayarGetir();
  const kok = drive.klasorKimligi(ayar.driveKlasor);
  if (!kok) throw new Error('Ayarlar\'da Drive klasörü girilmemiş.');
  taramaDurumu.calisiyor = true;
  const ozet = { bulunan: 0, yeni: 0, baglanan: 0, hata: [] , kayitlar: [] };
  try {
    const dosyalar = await drive.gorselleriBul(kok);
    ozet.bulunan = dosyalar.length;
    const islenmis = new Set((await Gorev.distinct('driveId')).filter(Boolean));
    const baglam = await ocrBaglami();
    for (const f of dosyalar.filter(x => !islenmis.has(x.id))) {
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
    calisiyor: taramaDurumu.calisiyor, son: taramaDurumu.son, sonuc: taramaDurumu.sonuc
  });
}));

app.post('/api/drive/test', hata(async (req, res) => {
  const id = drive.klasorKimligi(req.body?.klasor || (await ayarGetir()).driveKlasor);
  if (!id) return res.status(400).json({ hata: 'Klasör bağlantısı ya da kimliği giriniz.' });
  const bilgi = await drive.klasorBilgisi(id);
  const gorseller = await drive.gorselleriBul(id);
  res.json({ ad: bilgi.name, gorselSayisi: gorseller.length });
}));

app.post('/api/drive/tara', hata(async (req, res) => res.json(await driveTara())));

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
  const liste = (req.body || []).filter(k => k.ad?.trim()).map(k => ({ ad: k.ad.trim(), unvan: (k.unvan || '').trim() }));
  await Kisi.deleteMany({});
  await Kisi.insertMany(liste, { ordered: false }).catch(() => {});
  res.json(await Kisi.find().sort({ ad: 1 }).lean());
}));

app.post('/api/ornek-veri', hata(async (req, res) => {
  let eklenen = 0;
  for (const g of varsayilan.ornek) {
    if (await Gorev.exists({ tarih: g.tarih, sayi: g.sayi })) continue;
    await Gorev.create({ ...g, yer: yerAyristir(g.yerHam) });
    eklenen++;
  }
  res.json({ eklenen });
}));

// ---------- İcmaller ----------
function secenekler(q) {
  const bas = q.bas, bit = q.bit || q.bas;
  if (!/^\d{4}-\d{2}$/.test(bas || '') || !/^\d{4}-\d{2}$/.test(bit)) throw new Error('Ay seçiniz');
  return { bas, bit, haric: (q.haric || '').split(',').map(s => s.trim()).filter(Boolean), donemMetni: q.donem || '' };
}
async function icmalHazirla(req) {
  const ayar = await ayarGetir();
  const gorevler = await Gorev.find({}, { ocrMetin: 0 }).lean();
  return { ayar, icmal: icmalUret(req.params.tur, ayar, gorevler, secenekler(req.query)) };
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

(async () => {
  for (let i = 1; ; i++) {
    try { await mongoose.connect(MONGO_URL); break; } catch (e) {
      if (i >= 30) throw e;
      console.log(`MongoDB bekleniyor (${i})...`); await new Promise(r => setTimeout(r, 2000));
    }
  }
  await ilkKurulum();
  app.listen(PORT, () => console.log(`GEMİS http://localhost:${PORT}${drive.tanimli() ? ` · Drive: ${drive.hesapEposta()}` : ''}`));
})();
