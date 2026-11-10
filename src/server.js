const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const { Gorev, Kisi, Ayar, Plaka, Islenen } = require('./models');
const { VARSAYILAN: SABLON_VARSAYILAN, ESKI_SAYI, imzaCoz } = require('./icmal/sablon');
const { gorevOku } = require('./ocr');
const { raporSayfasi, raporTani, siraNo, gorulduBilgisi, VARSAYILAN: RAPOR_VARSAYILAN } = require('./rapor');
const { secimOku } = require('./secimOku');
const { icmalUret, TURLER } = require('./icmal');
const { excelUret, pdfUret } = require('./disaktar');
const { yerAyristir, saatNormal } = require('./util');
const drive = require('./drive');
const ag = require('./ag');
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
  // Eski sürümlerde ayrı alanlarda tutulan sayı parçaları belge şablonlarına taşınır.
  // Eski genel parça (kimliği sıfırlardan oluşan) taşınmaz; yerine türün varsayılanı kullanılır.
  const eski = { ekozel: 'sayiEkOzel', arac: 'sayiArac', seyyar: 'sayiSeyyar' };
  if (Object.values(eski).some(k => k in a)) {
    const sablonlar = { ...(a.sablonlar || {}) };
    for (const [tur, k] of Object.entries(eski)) {
      const v = a[k];
      if (typeof v === 'string' && v.trim() && !ESKI_SAYI.test(v) && typeof sablonlar[tur]?.sayi !== 'string') sablonlar[tur] = { ...(sablonlar[tur] || {}), sayi: v };
    }
    await Ayar.updateOne({ _id: 'ayar' }, { $set: { sablonlar }, $unset: { sayiEkOzel: 1, sayiArac: 1, sayiSeyyar: 1 } });
    a.sablonlar = sablonlar; delete a.sayiEkOzel; delete a.sayiArac; delete a.sayiSeyyar;
  }
  // Görev sonu raporunun varsayılan metinleri bir kez ayarlara yazılır; sonra Ayarlar'dan değiştirilir
  const raporEksik = {};
  for (const k of ['raporIsletme', 'raporSonuc', 'raporGorulduUnvan']) if (typeof a[k] !== 'string') raporEksik[k] = RAPOR_VARSAYILAN[k];
  if (Object.keys(raporEksik).length) { await Ayar.updateOne({ _id: 'ayar' }, { $set: raporEksik }); Object.assign(a, raporEksik); }
  elyazisi.ayarla(a.elYazisiMotoru || 'paddle');
  return a;
}

async function ilkKurulum() {
  await ayarGetir();
  if (!(await Kisi.countDocuments())) await Kisi.insertMany(varsayilan.kisiler);
  await gorevleriOnar(Gorev);
  await kisilerToparla();
  await plakalarToparla();
  // Plaka listesi ilk kez kuruluyorsa onaylanmış görevlerdeki plakalarla başlar
  if (!(await Plaka.countDocuments())) {
    const onayli = (await Gorev.distinct('plaka', { onayli: true })).map(plakaBicim).filter(p => /^\d{2}[A-ZÇĞİÖŞÜ]{1,3}\d{2,5}$/.test(p));
    if (onayli.length) await Plaka.insertMany([...new Set(onayli)].map(plaka => ({ plaka })), { ordered: false }).catch(() => {});
  }
}

// Plaka listesindeki eski "34 ABC 123" yazımlarını boşluksuz biçime çevirir, tekrarları birleştirir
async function plakalarToparla() {
  const gruplar = new Map();
  for (const p of await Plaka.find().lean()) {
    const yeni = plakaBicim(p.plaka);
    if (!gruplar.has(yeni)) gruplar.set(yeni, []);
    gruplar.get(yeni).push(p);
  }
  for (const [yeni, liste] of gruplar) {
    // doğru yazılmış kayıt varsa o tutulur; açıklama boşsa diğerlerinden alınır
    const tut = liste.find(p => p.plaka === yeni) || liste[0];
    const aciklama = tut.aciklama || liste.map(p => p.aciklama).find(Boolean) || '';
    const sil = liste.filter(p => p !== tut).map(p => p._id);
    if (sil.length) await Plaka.deleteMany({ _id: { $in: sil } });
    if (tut.plaka !== yeni || (tut.aciklama || '') !== aciklama) await Plaka.updateOne({ _id: tut._id }, { $set: { plaka: yeni, aciklama } });
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
  for (const k of ['_id', 'dosya', 'driveId', 'driveAd', 'ocrMetin', 'okunanUnvanlar', 'createdAt', 'updatedAt', 'raporDosya', 'raporDriveId', 'raporDriveAd', 'raporYuklendi']) delete g[k];
  for (const k of ['raporMetni', 'raporIsletme', 'raporGoruldu']) if (typeof g[k] === 'string') g[k] = g[k].trim();
  return g;
}

// Görevdeki adları kayıtlı kişilere bağla (aynı kişinin farklı yazımları tek ada iner).
// ekle=true yalnızca kayıt onaylandığında ("Kontrol ettim") verilir: o zaman listede olmayan kişiler
// (ünvanıyla) ve plaka listeye eklenir. Onaylanmamış OCR okumaları listeyi değiştirmez.
// unvanlar: OCR'ın ünvan sütunundan okuduğu { ad: ünvan } eşlemesi
async function adlariDuzenle(g, unvanlar = {}, ekle = false) {
  const kisiler = await Kisi.find().lean();
  const isle = async (ham, ipucu = {}, varsayilanUnvan = '') => {
    if (!ham || !String(ham).trim()) return '';
    const r = kanonikAd(String(ham), kisiler, 0.2, ipucu);
    if (!r.ad) return '';
    const unvan = r.unvan || unvanlar[ham] || unvanlar[r.ad] || varsayilanUnvan;
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
  // Yalnızca sürücü olarak geçen yeni kişi listeye "Şoför" göreviyle eklenir
  if (typeof g.surucu === 'string') {
    const gorevliler = new Set(g.personel || []);
    const ad = await isle(g.surucu, { tercih: gorevliler }, '');
    g.surucu = ad;
    if (ekle && ad && !gorevliler.has(ad)) await Kisi.updateOne({ ad, $or: [{ unvan: null }, { unvan: '' }] }, { $set: { unvan: 'Şoför' } });
  }
  if (typeof g.plaka === 'string' && g.plaka) {
    g.plaka = plakaBicim(g.plaka);
    if (ekle && /^\d{2}[A-ZÇĞİÖŞÜ]{1,3}\d{2,5}$/.test(g.plaka)) await Plaka.updateOne({ plaka: g.plaka }, { $setOnInsert: { plaka: g.plaka } }, { upsert: true });
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

// Kaynak kimliği: Google Drive dosya kimliği ya da "ag:<yol>" (ağ paylaşımı). İkisi de driveId alanında tutulur.
async function kaynakIndir(id) {
  if (ag.agKimligi(id)) return ag.indir(id, await ayarGetir());
  return drive.indir(id);
}

// Önce yerel kopya (varsa), yoksa Drive'dan / ağ paylaşımından anlık okuma. Bu veri diske yazılmaz.
async function gorselGetir(g) {
  if (g.dosya) {
    try { return await fs.promises.readFile(path.join(UPLOAD_DIR, g.dosya)); } catch { /* kaynağa düş */ }
  }
  if (g.driveId) return kaynakIndir(g.driveId);
  return null;
}

const raporVar = (g) => !!(g?.raporDosya || g?.raporDriveId);
async function raporGorseliGetir(g) {
  if (g.raporDosya) {
    try { return await fs.promises.readFile(path.join(UPLOAD_DIR, g.raporDosya)); } catch { /* Drive'a düş */ }
  }
  if (g.raporDriveId) return kaynakIndir(g.raporDriveId);
  return null;
}

// Taranmış görev sonu raporunu göreve bağlar: önce belge no + çıkış tarihi, sonra yalnızca belge no.
// Eşleşen görev yoksa yeni görev açılmaz (rapor görev emri değildir).
// kaydet(): görüntü saklama açıksa yerel kopyayı yazar; yalnızca eşleşme olursa çağrılır.
async function raporBagla(r, { driveId, driveAd, kaydet }) {
  const gercek = [{ ornek: { $ne: true } }];
  let kayit = null;
  if (r.belgeNo && r.tarih) kayit = await Gorev.findOne({ $and: [{ belgeNo: r.belgeNo }, { tarih: r.tarih }, ...gercek] });
  if (!kayit && r.belgeNo) kayit = await Gorev.findOne({ $and: [{ belgeNo: r.belgeNo }, ...gercek] });
  if (!kayit) return { kayit: null, durum: `görev sonu raporu: ${r.belgeNo ? `${siraNo(r.belgeNo)} sıra numaralı görev bulunamadı` : 'sıra numarası okunamadı'}, bağlanmadı` };
  const yeniden = !!kayit.raporYuklendi;
  if (kayit.raporDosya) fs.unlink(path.join(UPLOAD_DIR, kayit.raporDosya), () => {});
  kayit.raporDosya = kaydet ? kaydet() : undefined;
  kayit.raporDriveId = driveId || undefined;
  kayit.raporDriveAd = driveAd || undefined;
  if (!kayit.raporYuklendi) kayit.raporYuklendi = new Date();
  await kayit.save();
  return { kayit, durum: `görev sonu raporu ${siraNo(kayit.belgeNo)} sıra numaralı göreve ${yeniden ? 'yeniden ' : ''}bağlandı` };
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
  if (g?.raporDosya) fs.unlink(path.join(UPLOAD_DIR, g.raporDosya), () => {});
  // görevin kaynak dosyaları yeniden içe aktarılabilsin
  if (g) await Islenen.deleteMany({ $or: [{ gorev: String(g._id) }, { _id: { $in: [g.driveId, g.raporDriveId].filter(Boolean) } }] });
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

app.get('/api/gorevler/:id/rapor-gorsel', hata(async (req, res) => {
  const g = await Gorev.findById(req.params.id).lean();
  const buf = g && await raporGorseliGetir(g);
  if (!buf) return res.status(404).end();
  res.setHeader('Content-Type', buf[0] === 0x89 ? 'image/png' : 'image/jpeg');
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(buf);
}));

// Görev sonu raporunun açıklama metni (yazdırma sayfasından). Ayarlar'daki varsayılanla aynıysa ya da
// boş bırakılırsa göreve ayrıca yazılmaz; böylece Ayarlar'daki metin değişince bu görev de güncel kalır.
app.put('/api/gorevler/:id/rapor-metni', hata(async (req, res) => {
  const g = await Gorev.findById(req.params.id);
  if (!g) return res.status(404).json({ hata: 'Kayıt bulunamadı' });
  const ayar = await ayarGetir();
  const varsayilan = (ayar.raporSonuc || RAPOR_VARSAYILAN.raporSonuc || '').trim();
  const metin = String(req.body?.raporMetni ?? '').trim();
  g.raporMetni = metin && metin !== varsayilan ? metin : undefined;
  await g.save();
  res.json({ ok: true, metin: g.raporMetni || varsayilan });
}));

// "Görüldü" imzacısı (yazdırma sayfasından ya da toplu). Boş ya da varsayılan şube müdürüyle aynıysa
// göreve yazılmaz (Ayarlar'daki varsayılan geçerli olur); farklıysa ünvan "Şube Müdürü V." olur.
function gorulduYaz(g, ad, ayar) {
  const a = String(ad ?? '').replace(/\s+/g, ' ').trim();
  g.raporGoruldu = a && sade(a) !== sade(ayar.raporGorulduAd || '') ? a : undefined;
}
app.put('/api/gorevler/:id/rapor-goruldu', hata(async (req, res) => {
  const g = await Gorev.findById(req.params.id);
  if (!g) return res.status(404).json({ hata: 'Kayıt bulunamadı' });
  const ayar = await ayarGetir();
  gorulduYaz(g, req.body?.ad, ayar);
  await g.save();
  res.json({ ok: true, ...gorulduBilgisi(g, ayar) });
}));
app.post('/api/raporlar/goruldu', hata(async (req, res) => {
  const idler = (Array.isArray(req.body?.idler) ? req.body.idler : []).filter(x => /^[a-f0-9]{24}$/i.test(x));
  const ayar = await ayarGetir();
  let n = 0;
  for (const g of await Gorev.find({ _id: { $in: idler } })) { gorulduYaz(g, req.body?.ad, ayar); await g.save(); n++; }
  res.json({ ok: true, guncellenen: n, ...gorulduBilgisi({ raporGoruldu: req.body?.ad }, ayar) });
}));

// Taranmış raporun bağlantısını kaldırır (Drive'daki dosyaya dokunulmaz; tekrar taramada yeniden bağlanabilir)
app.delete('/api/gorevler/:id/rapor', hata(async (req, res) => {
  const g = await Gorev.findById(req.params.id);
  if (!g) return res.status(404).json({ hata: 'Kayıt bulunamadı' });
  if (g.raporDosya) fs.unlink(path.join(UPLOAD_DIR, g.raporDosya), () => {});
  if (g.raporDriveId) await Islenen.deleteMany({ $or: [{ _id: g.raporDriveId }, { gorev: String(g._id), sonuc: /rapor/ }] });   // tekrar taramada yeniden bağlanabilsin
  g.raporDosya = undefined; g.raporDriveId = undefined; g.raporDriveAd = undefined; g.raporYuklendi = undefined;
  await g.save();
  res.json({ ok: true });
}));

// Görevlendirme ve görev sonu raporu (yazdırma sayfası).
// ?id=…&id=… seçilen görevler; ?ay=YYYY-MM[&kisi=Ad SOYAD] o ayın görevleri; ?raporTarihi=YYYY-MM-DD (boşsa bugün)
app.get('/rapor', hata(async (req, res) => {
  const ayar = await ayarGetir();
  const idler = [].concat(req.query.id || []).flatMap(x => String(x).split(',')).filter(x => /^[a-f0-9]{24}$/i.test(x));
  let gorevler = [];
  if (idler.length) {
    const hepsi = (await Gorev.find({ _id: { $in: idler } }, { ocrMetin: 0 }).lean()).map(gorevDuzelt);
    gorevler = idler.map(id => hepsi.find(g => String(g._id) === id)).filter(Boolean);
  } else if (/^\d{4}-\d{2}$/.test(String(req.query.ay || ''))) {
    gorevler = (await Gorev.find({ tarih: { $regex: `^${req.query.ay}` } }, { ocrMetin: 0 }).lean()).map(gorevDuzelt);
    const kisi = sade(String(req.query.kisi || ''));
    if (kisi) gorevler = gorevler.filter(g => (g.personel || []).some(p => sade(p) === kisi));
    gorevler.sort((a, b) => a.tarih.localeCompare(b.tarih) || String(a.belgeNo).localeCompare(String(b.belgeNo)));
  }
  const bugun = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const raporTarihi = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.raporTarihi || '')) ? req.query.raporTarihi : bugun;
  const [kisiler, plakalar] = await Promise.all([Kisi.find().lean(), Plaka.find().lean()]);
  res.setHeader('Cache-Control', 'no-cache');
  res.type('html').send(raporSayfasi(gorevler, ayar, { kisiler, plakalar, raporTarihi }));
}));

// Elle yükleme + OCR. Görüntü bellekte işlenir; yalnızca saklama seçeneği açıksa diske yazılır.
// Görev Sonu Raporları modülü: yalnızca imzalı rapor yükleme. Görüntü rapor olarak tanınmazsa
// görev açılmaz; listedeki satırdan ilgili göreve elle bağlanabilir.
app.post('/api/raporlar/yukle', yukle.array('dosyalar', 60), hata(async (req, res) => {
  if (!req.files?.length) return res.status(400).json({ hata: 'Dosya alınamadı. Yalnızca JPEG ve PNG görüntüler okunabilir.' });
  const ayar = await ayarGetir();
  const baglam = await ocrBaglami();
  const sonuc = [];
  for (const f of req.files) {
    const ad = Buffer.from(f.originalname, 'latin1').toString('utf8');
    try {
      const okunan = await gorevOku(f.buffer, ad, baglam);
      const r = raporTani(okunan.ocrMetin);
      if (!r) { sonuc.push({ dosya: ad, durum: 'görev sonu raporu olarak tanınamadı; listedeki satırdan ilgili göreve bağlayınız', hata: true }); continue; }
      const { kayit, durum } = await raporBagla(r, { kaydet: ayar.gorselSakla ? () => yerelKaydet(f.buffer, ad) : null });
      sonuc.push({ id: kayit?._id, dosya: ad, durum, tarih: kayit?.tarih, hata: !kayit });
    } catch (e) {
      sonuc.push({ dosya: ad, durum: 'okunamadı: ' + e.message, hata: true });
    }
  }
  res.json(sonuc);
}));

// Taranmış raporu OCR'sız, doğrudan seçilen göreve bağlar
app.post('/api/gorevler/:id/rapor', yukle.single('dosya'), hata(async (req, res) => {
  if (!req.file) return res.status(400).json({ hata: 'Dosya alınamadı. Yalnızca JPEG ve PNG görüntüler okunabilir.' });
  const g = await Gorev.findById(req.params.id);
  if (!g) return res.status(404).json({ hata: 'Kayıt bulunamadı' });
  const ayar = await ayarGetir();
  const ad = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
  if (g.raporDosya) fs.unlink(path.join(UPLOAD_DIR, g.raporDosya), () => {});
  g.raporDosya = ayar.gorselSakla ? yerelKaydet(req.file.buffer, ad) : undefined;
  g.raporDriveId = undefined; g.raporDriveAd = undefined;
  g.raporYuklendi = new Date();
  await g.save();
  res.json({ ok: true, saklandi: !!g.raporDosya });
}));

app.post('/api/gorevler/yukle', yukle.array('dosyalar', 60), hata(async (req, res) => {
  if (!req.files?.length) return res.status(400).json({ hata: 'Dosya alınamadı. Yalnızca JPEG ve PNG görüntüler okunabilir.' });
  const ayar = await ayarGetir();
  const baglam = await ocrBaglami();
  const sonuc = [];
  for (const f of req.files) {
    const ad = Buffer.from(f.originalname, 'latin1').toString('utf8');
    const okunan = await gorevOku(f.buffer, ad, baglam);
    const r = raporTani(okunan.ocrMetin);
    if (r) {
      const { kayit, durum } = await raporBagla(r, { kaydet: ayar.gorselSakla ? () => yerelKaydet(f.buffer, ad) : null });
      sonuc.push({ id: kayit?._id, dosya: ad, durum, tarih: kayit?.tarih, rapor: true });
      continue;
    }
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

// ---------- İçe aktarma: Google Drive ve ağ paylaşımı ----------
// İki kaynak da aynı yoldan geçer: görüntüler listelenir, daha önce işlenmemiş olanlar bellekte okunur,
// OCR'dan geçirilir; görev sonu raporu ise ilgili göreve bağlanır, değilse görev emri olarak kaydedilir.
// Aynı anda tek tarama yürür; ilerleme /api/<kaynak>/durum ile izlenir.
const KAYNAKLAR = {
  drive: {
    ad: 'Drive',
    hazir: (ayar) => drive.tanimli() && !!drive.klasorKimligi(ayar.driveKlasor),
    eksik: 'Ayarlar\'da Drive klasörü girilmemiş.',
    bul: (ayar) => drive.gorselleriBul(drive.klasorKimligi(ayar.driveKlasor)),
    otoDk: (ayar) => Number(ayar.driveOtoTaraDk) || 0
  },
  ag: {
    ad: 'Ağ paylaşımı',
    hazir: (ayar) => ag.tanimli(ayar),
    eksik: 'Ayarlar\'da ağ paylaşımı tanımlanmamış.',
    bul: (ayar) => ag.gorselleriBul(ayar),
    otoDk: (ayar) => Number(ayar.agOtoTaraDk) || 0
  }
};
const taramaDurumu = { calisiyor: false, kaynak: null, son: null, sonuc: null, toplam: 0, islenen: 0, sonTarama: {}, sonSonuc: {} };

async function kaynakTara(tur) {
  const k = KAYNAKLAR[tur];
  if (taramaDurumu.calisiyor) throw new Error('Başka bir tarama sürüyor.');
  const ayar = await ayarGetir();
  if (!k.hazir(ayar)) throw new Error(k.eksik);
  Object.assign(taramaDurumu, { calisiyor: true, kaynak: tur, toplam: 0, islenen: 0 });
  const ozet = { kaynak: tur, bulunan: 0, yeni: 0, baglanan: 0, rapor: 0, hata: [], kayitlar: [] };
  try {
    const dosyalar = await k.bul(ayar);
    ozet.bulunan = dosyalar.length;
    const islenmis = await islenmisKaynaklar();
    const baglam = await ocrBaglami();
    const isaretle = (f, ad, kayit, sonuc) => Islenen.updateOne({ _id: f.id }, { $set: { ad, gorev: kayit ? String(kayit._id) : '', sonuc } }, { upsert: true });
    const yeniler = dosyalar.filter(x => !islenmis.has(x.id));
    taramaDurumu.toplam = yeniler.length;
    for (const f of yeniler) {
      taramaDurumu.islenen++;
      try {
        const buf = await kaynakIndir(f.id);
        const ad = f.yol ? `${f.yol}/${f.name}` : f.name;
        const okunan = await gorevOku(buf, f.name, baglam);
        const r = raporTani(okunan.ocrMetin);
        if (r) {
          const { kayit, durum } = await raporBagla(r, { driveId: f.id, driveAd: ad, kaydet: ayar.gorselSakla ? () => yerelKaydet(buf, f.name) : null });
          if (kayit) { ozet.rapor++; await isaretle(f, ad, kayit, durum); } else ozet.hata.push(`${ad}: ${durum}`);   // bağlanamayan rapor sonraki taramada yeniden denenir
          ozet.kayitlar.push({ id: kayit?._id, dosya: ad, durum, tarih: kayit?.tarih, rapor: true });
          continue;
        }
        const alanlar = { driveId: f.id, driveAd: ad, ...(ayar.gorselSakla ? { dosya: yerelKaydet(buf, f.name) } : {}) };
        const { kayit, durum } = await kaydaIsle(okunan, alanlar);
        if (durum.startsWith('mevcut')) ozet.baglanan++; else ozet.yeni++;
        await isaretle(f, ad, kayit, durum);
        ozet.kayitlar.push({ id: kayit._id, dosya: ad, durum, tarih: kayit.tarih });
      } catch (e) { ozet.hata.push(`${f.name}: ${e.message}`); }
    }
  } catch (e) {
    ozet.hata.push(e.response?.data?.error?.message || e.message);
  } finally {
    taramaDurumu.calisiyor = false;
    taramaDurumu.son = new Date();
    taramaDurumu.sonuc = ozet;
    taramaDurumu.sonTarama[tur] = taramaDurumu.son;
    taramaDurumu.sonSonuc[tur] = ozet;
  }
  return ozet;
}

// Bir kaynağın durumu: o kaynağın son tarama sonucu; başka kaynak tararken "calisiyor" yine görünür
async function islenmisKaynaklar() {
  const [a, b, c] = await Promise.all([Gorev.distinct('driveId'), Gorev.distinct('raporDriveId'), Islenen.distinct('_id')]);
  return new Set([...a, ...b, ...c].filter(Boolean));
}

function durumYaz(tur, ek) {
  const buKaynak = taramaDurumu.kaynak === tur;
  return {
    ...ek,
    calisiyor: taramaDurumu.calisiyor, digerKaynak: taramaDurumu.calisiyor && !buKaynak ? KAYNAKLAR[taramaDurumu.kaynak].ad : null,
    son: taramaDurumu.sonTarama[tur] || null, sonuc: taramaDurumu.sonSonuc[tur] || null,
    toplam: buKaynak ? taramaDurumu.toplam : 0, islenen: buKaynak ? taramaDurumu.islenen : 0
  };
}
function taramaBaslat(tur) {
  return hata(async (req, res) => {
    if (taramaDurumu.calisiyor) return res.json({ basladi: false, calisiyor: true });
    const ayar = await ayarGetir();
    if (!KAYNAKLAR[tur].hazir(ayar)) return res.status(400).json({ hata: KAYNAKLAR[tur].eksik });
    kaynakTara(tur).catch(e => console.error(`${KAYNAKLAR[tur].ad} taraması:`, e.message));
    res.json({ basladi: true });
  });
}

app.get('/api/drive/durum', hata(async (req, res) => {
  const ayar = await ayarGetir();
  res.json(durumYaz('drive', { tanimli: drive.tanimli(), eposta: drive.hesapEposta(), klasor: ayar.driveKlasor || '' }));
}));
app.post('/api/drive/test', hata(async (req, res) => {
  const id = drive.klasorKimligi(req.body?.klasor || (await ayarGetir()).driveKlasor);
  if (!id) return res.status(400).json({ hata: 'Klasör bağlantısı ya da kimliği giriniz.' });
  const bilgi = await drive.klasorBilgisi(id);
  const gorseller = await drive.gorselleriBul(id);
  res.json({ ad: bilgi.name, gorselSayisi: gorseller.length });
}));
// Tarama arka planda yürür (Cloudflare gibi vekillerin 100 sn istek sınırına takılmaması için)
app.post('/api/drive/tara', taramaBaslat('drive'));

app.get('/api/ag/durum', hata(async (req, res) => {
  const ayar = await ayarGetir();
  res.json(durumYaz('ag', { tanimli: ag.tanimli(ayar) }));
}));
// Bağlantı denemesi: formdaki (henüz kaydedilmemiş) değerlerle; parola girilmemişse kayıtlı parola kullanılır
app.post('/api/ag/test', hata(async (req, res) => {
  const kayitli = await ayarGetir();
  const b = req.body || {};
  const deneme = { ...kayitli, ...b, agParola: b.agParola || kayitli.agParola };
  if (!ag.tanimli(deneme)) return res.status(400).json({ hata: deneme.agTur === 'klasor' ? 'Klasör yolunu giriniz.' : 'Paylaşım adresini \\\\sunucu\\paylaşım\\klasör biçiminde giriniz.' });
  const gorseller = await ag.gorselleriBul(deneme);
  const islenmis = await islenmisKaynaklar();
  res.json({ gorselSayisi: gorseller.length, yeni: gorseller.filter(g => !islenmis.has(g.id)).length, ornek: gorseller.slice(0, 3).map(g => g.yol ? `${g.yol}/${g.name}` : g.name) });
}));
app.post('/api/ag/tara', taramaBaslat('ag'));

// Otomatik tarama: her dakika iki kaynağın ayarını kontrol eder
setInterval(async () => {
  if (mongoose.connection.readyState !== 1 || taramaDurumu.calisiyor) return;
  let ayar;
  try { ayar = await ayarGetir(); } catch { return; }
  for (const [tur, k] of Object.entries(KAYNAKLAR)) {
    try {
      const dk = k.otoDk(ayar);
      if (!dk || !k.hazir(ayar) || taramaDurumu.calisiyor) continue;
      const son = taramaDurumu.sonTarama[tur];
      if (son && Date.now() - son.getTime() < dk * 60000) continue;
      const o = await kaynakTara(tur);
      if (o.yeni || o.baglanan || o.rapor || o.hata.length) console.log(`${k.ad} taraması: ${o.yeni} yeni, ${o.baglanan} bağlandı, ${o.rapor} rapor, ${o.hata.length} hata`);
    } catch (e) { console.error(`Otomatik ${k.ad} taraması:`, e.message); }
  }
}, 60000);

// ---------- Ayarlar / Kişiler ----------
// Ağ paylaşımı parolası arayüze gönderilmez; yalnızca kayıtlı olup olmadığı bildirilir
const ayarDis = (a) => { const { agParola, ...kalan } = a || {}; return { ...kalan, agParolaVar: !!agParola || !!process.env.AG_PAROLA }; };
app.get('/api/ayarlar', hata(async (req, res) => res.json(ayarDis(await ayarGetir()))));
// Belge şablonlarının varsayılanları ve imza bloğundan algılanan imzacılar (Ayarlar ekranı için)
app.get('/api/sablon-varsayilan', (req, res) => res.json(SABLON_VARSAYILAN));
app.post('/api/imza-coz', (req, res) => res.json(imzaCoz(String(req.body?.html || ''))));
app.put('/api/ayarlar', hata(async (req, res) => {
  const b = { ...req.body }; delete b._id; delete b.__v; delete b.agParolaVar;
  // Parola alanı boş gönderilirse kayıtlı parola korunur; "agParolaSil" ile silinir
  if (b.agParolaSil) b.agParola = ''; else if (!b.agParola) delete b.agParola;
  delete b.agParolaSil;
  res.json(ayarDis((await Ayar.findByIdAndUpdate('ayar', b, { new: true, upsert: true })).toObject()));
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
    gorevSayisi: icmal.gorevler.length, gorselSayisi: icmal.gorevler.filter(gorselVar).length, raporSayisi: icmal.gorevler.filter(raporVar).length
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
  // ?rapor=1: her görev emrinin ardından taranmış görev sonu raporu da eklenir
  const raporlu = req.query.rapor === '1';
  const sayfalar = icmal.gorevler.flatMap(g => [...(gorselVar(g) ? [{ g, tur: 'emir' }] : []), ...(raporlu && raporVar(g) ? [{ g, tur: 'rapor' }] : [])]);
  const buf = await pdfUret(sayfalar, (x) => x.tur === 'rapor' ? raporGorseliGetir(x.g) : gorselGetir(x.g));
  if (!buf) return res.status(404).json({ hata: 'Bu icmaldeki görevlerin görüntüsü yok.' });
  // (rapor=1 ise taranmış görev sonu raporları da eklenmiştir)
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
