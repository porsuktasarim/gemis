// Bölgesel (zonal) okuma: taşıt görev emri formunun tablo çizgileri bulunur, etiketlerin
// ("Plakası", "Sürücünün Adı Soyadı", "Gideceği Yer", "Çıkış Saati" …) değer hücreleri ayrı ayrı
// kesilip Tesseract'a tek satır olarak okutulur. Rakam alanlarında yalnızca rakam kabul edilir.
// Görüntü yalnızca bellekte işlenir.

const { spawn } = require('child_process');
const sharp = require('sharp');
const { sade } = require('./util');

const KOYU = 128;

function tesseract(png, psm, ekler = []) {
  return new Promise((resolve) => {
    const p = spawn('tesseract', ['stdin', 'stdout', '-l', 'tur', '--psm', String(psm), ...ekler]);
    const parca = [];
    const zaman = setTimeout(() => p.kill('SIGKILL'), 60000);
    p.stdout.on('data', d => parca.push(d));
    p.on('error', () => { clearTimeout(zaman); resolve(''); });
    p.on('close', () => { clearTimeout(zaman); resolve(Buffer.concat(parca).toString('utf8')); });
    p.stdin.on('error', () => {});
    p.stdin.end(png);
  });
}

// Görüntüyü 2 kat büyüt, gri ton, eşikle; ham piksel ve PNG döndür
async function hazirla(girdi) {
  const meta = await sharp(girdi).metadata();
  const dondur = (meta.orientation || 1) >= 5;
  const genislik = Math.min(((dondur ? meta.height : meta.width) || 1750) * 2, 4200);
  const { data, info } = await sharp(girdi).rotate().grayscale().resize({ width: genislik })
    .normalise().threshold(170).raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height;
  const png = await sharp(data, { raw: { width: W, height: H, channels: 1 } }).png().toBuffer();
  return { data, W, H, png };
}

// Tablo çizgileri: uzun dikey ve yatay koyu piksel dizileri.
// Taramada kesik çıkan çizgiler için küçük boşluklar (BOSLUK) tolere edilir.
function cizgileriBul({ data, W, H }) {
  const olcek = W / 3516;
  const minD = Math.round(100 * olcek), minY = Math.round(150 * olcek), BOSLUK = Math.max(2, Math.round(4 * olcek));
  const dizi = (uz, oku, enaz) => {
    const r = []; let bas = -1, son = -1;
    for (let i = 0; i < uz; i++) {
      if (oku(i)) { if (bas < 0) bas = i; son = i; }
      else if (bas >= 0 && i - son > BOSLUK) { if (son - bas + 1 >= enaz) r.push([bas, son]); bas = -1; }
    }
    if (bas >= 0 && son - bas + 1 >= enaz) r.push([bas, son]);
    return r;
  };
  const dikey = new Array(W), yatay = new Array(H);
  for (let x = 0; x < W; x++) dikey[x] = dizi(H, y => data[y * W + x] < KOYU, minD);
  for (let y = 0; y < H; y++) { const o = y * W; yatay[y] = dizi(W, x => data[o + x] < KOYU, minY); }
  return { dikey, yatay };
}

const kapsar = (r, v) => r.some(([a, b]) => a <= v && v <= b);
// Çizgi birkaç piksel kaymış olabilir: komşu konumlara da bak
const kapsarYakin = (dizi, i, v) => kapsar(dizi[i] || [], v) || kapsar(dizi[i] || [], v - 3) || kapsar(dizi[i] || [], v + 3);

// (x, y) noktasını içeren tablo hücresi
function hucre(c, W, H, x, y) {
  x = Math.max(4, Math.min(W - 5, Math.round(x))); y = Math.max(4, Math.min(H - 5, Math.round(y)));
  let x0 = 0, x1 = W - 1, y0 = 0, y1 = H - 1;
  for (let i = x - 1; i >= 0; i--) if (kapsarYakin(c.dikey, i, y)) { x0 = i; break; }
  for (let i = x + 1; i < W; i++) if (kapsarYakin(c.dikey, i, y)) { x1 = i; break; }
  for (let i = y - 1; i >= 0; i--) if (kapsarYakin(c.yatay, i, x)) { y0 = i; break; }
  for (let i = y + 1; i < H; i++) if (kapsarYakin(c.yatay, i, x)) { y1 = i; break; }
  return { x0, x1, y0, y1 };
}

// Hücreyi kes; kenar çizgisi kalıntılarını ve noktalı satır çizgilerini beyaza boya, kenar boşluğu ekle
async function kes(png, W, H, k, ic = 8, temizle = false) {
  const left = Math.max(0, k.x0 + ic), top = Math.max(0, k.y0 + ic);
  const width = Math.min(W, k.x1 - ic) - left, height = Math.min(H, k.y1 - ic) - top;
  if (width < 10 || height < 10) return null;
  if (!temizle) {
    return sharp(png).extract({ left, top, width, height })
      .extend({ top: 20, bottom: 20, left: 20, right: 20, background: '#ffffff' }).png().toBuffer();
  }
  const { data, info } = await sharp(png).extract({ left, top, width, height }).raw().toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height, ch = info.channels;
  const koyu = (x, y) => data[(y * w + x) * ch] < KOYU;
  const boyaSatir = (y) => { for (let x = 0; x < w; x++) for (let c = 0; c < ch; c++) data[(y * w + x) * ch + c] = 255; };
  const boyaSutun = (x) => { for (let y = 0; y < h; y++) for (let c = 0; c < ch; c++) data[(y * w + x) * ch + c] = 255; };
  // Kenar bandında gevşek, iç kısımda sıkı eşik: yazıyı silmeden çizgi kalıntısını temizler
  const kenarY = Math.max(6, Math.round(h * 0.15)), kenarX = 15;
  for (let y = 0; y < h; y++) {
    let n = 0; for (let x = 0; x < w; x++) if (koyu(x, y)) n++;
    const esik = (y < kenarY || y >= h - kenarY) ? 0.3 : 0.7;
    if (n > w * esik) { boyaSatir(y); if (y > 0) boyaSatir(y - 1); if (y < h - 1) boyaSatir(y + 1); }
  }
  for (let x = 0; x < w; x++) {
    let n = 0; for (let y = 0; y < h; y++) if (koyu(x, y)) n++;
    const esik = (x < kenarX || x >= w - kenarX) ? 0.4 : 0.85;
    if (n > h * esik) boyaSutun(x);
  }
  return sharp(data, { raw: { width: w, height: h, channels: ch } })
    .extend({ top: 20, bottom: 20, left: 20, right: 20, background: '#ffffff' }).png().toBuffer();
}

let hataAyiklaSayac = 0;
// temizle: el yazısı alanlarında çizgi/noktalı satır kalıntılarını sil
async function hucreOku(g, k, psm = 7, ekler = [], temizle = false) {
  const parca = await kes(g.png, g.W, g.H, k, 8, temizle);
  if (!parca) return '';
  if (process.env.ZON_HATA_AYIKLA) require('fs').writeFileSync(`${process.env.ZON_HATA_AYIKLA}/${String(++hataAyiklaSayac).padStart(2, '0')}_${k.x0}_${k.y0}_${k.x1}_${k.y1}.png`, parca);
  return (await tesseract(parca, psm, ekler)).replace(/\s+/g, ' ').trim();
}

function tsvKelimeler(tsv) {
  const satir = tsv.split('\n').slice(1).map(l => l.split('\t')).filter(s => s.length >= 12 && s[11].trim());
  return satir.map(s => ({
    blok: +s[2], par: +s[3], satir: +s[4],
    x: +s[6], y: +s[7], w: +s[8], h: +s[9], guven: +s[10], metin: s[11].trim(), s: sade(s[11])
  }));
}

function metinYap(kelimeler) {
  const satirlar = new Map();
  for (const k of kelimeler) {
    const a = `${k.blok}.${k.par}.${k.satir}`;
    if (!satirlar.has(a)) satirlar.set(a, []);
    satirlar.get(a).push(k);
  }
  return [...satirlar.values()].map(l => l.sort((a, b) => a.x - b.x).map(k => k.metin).join(' ')).join('\n');
}

const RAKAM = ['-c', 'tessedit_char_whitelist=0123456789:.,'];
const PLAKA = ['-c', 'tessedit_char_whitelist=ABCDEFGHIJKLMNOPRSTUVYZ0123456789 '];

// OCR satırından ad soyad: harf dışı ve sondaki kısa parçaları at
function adTemizle(t) {
  if (!t || /soya|ünvan|unvan|g[öo]rev|personel|t[üu]r[üu]\b/i.test(t)) return '';
  let p = t.replace(/[^A-Za-zÇĞİÖŞÜçğıöşüÂâÎîÛû.\s]/g, ' ').split(/\s+/).filter(Boolean);
  while (p.length && p[p.length - 1].replace(/\./g, '').length <= 2) p.pop();
  while (p.length && p[0].replace(/\./g, '').length <= 1) p.shift();
  const harf = p.join('').length;
  if (p.length < 2 || harf < 6) return '';
  return p.join(' ');
}

function saatCoz(t) {
  const r = (t || '').replace(/[^\d]/g, '');
  let h, m;
  if (r.length === 3) { h = +r[0]; m = +r.slice(1); }
  else if (r.length === 4) { h = +r.slice(0, 2); m = +r.slice(2); }
  else return '';
  // Makul olmayan okumaları boş bırak (el yazısında yanlış tahmin, boştan zararlıdır)
  if (h < 7 || h > 20 || m % 15 !== 0) return '';
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// Ana okuma: alan adı -> okunan ham metin
async function bolgeselOku(girdi) {
  const g = await hazirla(girdi);
  const c = cizgileriBul(g);
  const [tsv, blokMetin] = await Promise.all([tesseract(g.png, 11, ['tsv']), tesseract(g.png, 4)]);
  const kelimeler = tsvKelimeler(tsv);
  const ust = g.H * 0.2;
  const bul = (re, kosul = () => true) => kelimeler.filter(k => re.test(k.s) && kosul(k));
  const merkez = (k) => [k.x + k.w / 2, k.y + k.h / 2];
  const sonuc = { metin: `${blokMetin}\n-----\n${metinYap(kelimeler)}` };

  // Tablonun alt sınırı: genişliğin yarısından uzun yatay çizgilerin en altı
  let tabloAlt = 0;
  for (let y = g.H - 1; y >= 0; y--) if (c.yatay[y].some(([a, b]) => b - a > g.W * 0.5)) { tabloAlt = y; break; }

  const sagHucre = (etiket) => {
    const [mx, my] = merkez(etiket);
    const e = hucre(c, g.W, g.H, mx, my);
    return hucre(c, g.W, g.H, e.x1 + 10, my);
  };

  const okumalar = [];

  // Sayı ve görev tarihi (üst satır)
  const say = bul(/^say/, k => k.y < ust).sort((a, b) => a.y - b.y)[0];
  if (say) okumalar.push(hucreOku(g, hucre(c, g.W, g.H, ...merkez(say))).then(t => { sonuc.sayi = t; }));
  const tarih = bul(/^tari/, k => k.y < ust).sort((a, b) => a.x - b.x)[0];
  if (tarih) okumalar.push(hucreOku(g, hucre(c, g.W, g.H, ...merkez(tarih))).then(t => { sonuc.tarih = t; }));

  // Sağ sütundaki değer hücreleri
  const plaka = bul(/^plaka/)[0];
  if (plaka) okumalar.push(hucreOku(g, sagHucre(plaka), 7, PLAKA, true).then(t => { sonuc.plaka = t; }));
  const surucu = bul(/^suruc/)[0];
  if (surucu) okumalar.push(hucreOku(g, sagHucre(surucu), 7, [], true).then(t => { sonuc.surucu = t; }));
  const gidecek = bul(/^gidece/)[0];
  if (gidecek) okumalar.push(hucreOku(g, sagHucre(gidecek)).then(t => { sonuc.yer = t; }));

  // Saatler: "Saati" etiketlerinin altındaki el yazısı; soldaki çıkış, sağdaki dönüş
  const saatler = bul(/^saat/).sort((a, b) => a.x - b.x);
  const saatOku = async (etiket) => {
    const k = hucre(c, g.W, g.H, ...merkez(etiket));
    const alt = { ...k, y0: etiket.y + etiket.h };
    const t = await hucreOku(g, alt, 7, RAKAM, true);
    return saatCoz(t) || saatCoz(await hucreOku(g, alt, 6, RAKAM, true));
  };
  if (saatler[0]) okumalar.push(saatOku(saatler[0]).then(t => { sonuc.cikis = t; }));
  if (saatler[1]) okumalar.push(saatOku(saatler[1]).then(t => { sonuc.donus = t; }));

  // Görevli personel: başlığın altındaki satırlar "Görevin Türü" satırına kadar
  const pBaslik = bul(/^personel/).sort((a, b) => a.y - b.y)[0];
  const gorevin = bul(/^gorevin/)[0];
  if (pBaslik) {
    okumalar.push((async () => {
      const ad = [];
      const bh = hucre(c, g.W, g.H, ...merkez(pBaslik));
      const x = bh.x0 + 40;
      let y = bh.y1 + 6;
      const sinir = gorevin ? gorevin.y : tabloAlt;
      let bos = 0;
      for (let i = 0; i < 10 && y < sinir; i++) {
        const k = hucre(c, g.W, g.H, x, y + 15);
        if (k.y1 <= y || k.y1 - k.y0 < 15) break;
        const t = await hucreOku(g, k);
        if (/gidece|g[öo]revin|onaylayan|t[üu]r[üu]\b|ara[çc]in/i.test(t)) break; // personel bölümü bitti
        const ad_ = adTemizle(t);
        if (ad_) { ad.push(ad_); bos = 0; } else if (++bos >= 2) break;
        y = k.y1 + 6;
      }
      sonuc.personel = ad;
    })());
  }

  // Belge no: tablonun altında, sağ tarafta el yazısı ya da kaşe
  if (tabloAlt) {
    const bolge = { x0: Math.round(g.W * 0.7), x1: g.W - 1, y0: tabloAlt, y1: Math.min(g.H - 1, tabloAlt + Math.round(g.H * 0.25)) };
    okumalar.push(Promise.all([hucreOku(g, bolge, 11, RAKAM, true), hucreOku(g, bolge, 6, RAKAM, true)]).then(([a, b]) => { sonuc.belgeNo = `${a} ${b}`; }));
  }

  await Promise.all(okumalar);
  return sonuc;
}

module.exports = { bolgeselOku, saatCoz, adTemizle };
