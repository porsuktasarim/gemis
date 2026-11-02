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
const { yerAyristir, saatNormal, sade } = require('./util');
const varsayilan = require('../seed/varsayilan');

const PORT = process.env.PORT || 1138;
const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017/gemis';
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'data', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const app = express();
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/vendor/bootstrap', express.static(path.join(__dirname, '..', 'node_modules', 'bootstrap', 'dist')));
app.use('/vendor/icons', express.static(path.join(__dirname, '..', 'node_modules', 'bootstrap-icons', 'font')));

const yukle = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${path.extname(file.originalname).toLowerCase() || '.jpg'}`)
  }),
  fileFilter: (req, file, cb) => cb(null, /image\/(jpeg|png)/.test(file.mimetype)),
  limits: { fileSize: 25 * 1024 * 1024 }
});

const hata = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch(e => { console.error(e); res.status(500).json({ hata: e.message }); });

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
  delete g._id; delete g.dosya; delete g.ocrMetin; delete g.createdAt; delete g.updatedAt;
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

// ---------- Görevler ----------
app.get('/api/gorevler', hata(async (req, res) => {
  const q = {};
  if (req.query.ay) q.tarih = { $regex: `^${req.query.ay}` };
  res.json(await Gorev.find(q, { ocrMetin: 0 }).sort({ tarih: 1 }).lean());
}));

app.get('/api/gorevler/:id', hata(async (req, res) => res.json(await Gorev.findById(req.params.id).lean())));

app.post('/api/gorevler', hata(async (req, res) => {
  const g = gorevTemizle(req.body);
  const kayit = await Gorev.create(g);
  await kisileriKaydet(kayit);
  res.json(kayit);
}));

app.put('/api/gorevler/:id', hata(async (req, res) => {
  const g = gorevTemizle(req.body);
  const kayit = await Gorev.findByIdAndUpdate(req.params.id, g, { new: true });
  await kisileriKaydet(kayit);
  res.json(kayit);
}));

app.delete('/api/gorevler/:id', hata(async (req, res) => {
  const g = await Gorev.findByIdAndDelete(req.params.id);
  if (g?.dosya) fs.unlink(path.join(UPLOAD_DIR, g.dosya), () => {});
  res.json({ ok: true });
}));

app.get('/api/gorevler/:id/gorsel', hata(async (req, res) => {
  const g = await Gorev.findById(req.params.id).lean();
  if (!g?.dosya) return res.status(404).end();
  res.sendFile(path.join(UPLOAD_DIR, g.dosya));
}));

// Toplu görüntü yükleme + OCR. Aynı tarihte görüntüsü olmayan kayıt varsa görüntü ona bağlanır.
app.post('/api/gorevler/yukle', yukle.array('dosyalar', 60), hata(async (req, res) => {
  const baglam = await ocrBaglami();
  const sonuc = [];
  for (const f of req.files || []) {
    const okunan = await gorevOku(f.path, f.originalname, baglam);
    const orijinalAd = Buffer.from(f.originalname, 'latin1').toString('utf8');
    let kayit = okunan.tarih ? await Gorev.findOne({ tarih: okunan.tarih, $or: [{ dosya: null }, { dosya: { $exists: false } }] }) : null;
    if (kayit) {
      kayit.dosya = f.filename; kayit.ocrMetin = okunan.ocrMetin;
      await kayit.save();
      sonuc.push({ id: kayit._id, dosya: orijinalAd, durum: 'mevcut kayda bağlandı', tarih: kayit.tarih });
    } else {
      kayit = await Gorev.create({ ...okunan, dosya: f.filename, onayli: false });
      sonuc.push({ id: kayit._id, dosya: orijinalAd, durum: 'yeni kayıt (kontrol bekliyor)', tarih: kayit.tarih });
    }
  }
  res.json(sonuc);
}));

app.post('/api/gorevler/:id/ocr', hata(async (req, res) => {
  const g = await Gorev.findById(req.params.id);
  if (!g?.dosya) return res.status(400).json({ hata: 'Görüntü yok' });
  const okunan = await gorevOku(path.join(UPLOAD_DIR, g.dosya), '', await ocrBaglami());
  res.json(okunan); // forma öneri olarak döner, kaydetmez
}));

app.get('/api/oneriler', hata(async (req, res) => {
  const [plakalar, suruculer, kisiler] = await Promise.all([Gorev.distinct('plaka'), Gorev.distinct('surucu'), Kisi.find().sort({ ad: 1 }).lean()]);
  res.json({ plakalar: plakalar.filter(Boolean).sort(), suruculer: suruculer.filter(Boolean).sort(), kisiler: kisiler.map(k => k.ad) });
}));

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
    gorevSayisi: icmal.gorevler.length, gorselSayisi: icmal.gorevler.filter(g => g.dosya).length
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
  const buf = await pdfUret(icmal.gorevler, UPLOAD_DIR);
  if (!buf) return res.status(404).json({ hata: 'Bu icmaldeki görevlerin yüklenmiş görüntüsü yok.' });
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
  app.listen(PORT, () => console.log(`GEMİS http://localhost:${PORT}`));
})();
