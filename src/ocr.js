// Görev emri görüntüsünden yapay zekâ kullanmadan (Tesseract OCR) alan çıkarma.
// Basılı alanlar (sayı, görev tarihi, personel, gideceği yer) çoğunlukla okunur;
// el yazısı alanlar (sürücü, plaka, saatler, belge no) yalnızca denenir, kullanıcı formda tamamlar.

const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { ILCELER, sade, benzer, yerAyristir, tarihISO, saatNormal, trTitle } = require('./util');

function tesseract(dosya, psm) {
  return new Promise((resolve) => {
    execFile('tesseract', [dosya, 'stdout', '-l', 'tur', '--psm', String(psm)],
      { maxBuffer: 10 * 1024 * 1024, timeout: 120000 },
      (err, stdout) => resolve(err ? '' : stdout));
  });
}

async function onIsle(girdi) {
  const meta = await sharp(girdi).metadata();
  const gecici = path.join(os.tmpdir(), `ocr-${Date.now()}-${Math.random().toString(36).slice(2)}.png`);
  await sharp(girdi).rotate().grayscale()
    .resize({ width: Math.min((meta.width || 1750) * 2, 4000) })
    .normalise().threshold(170).png().toFile(gecici);
  return gecici;
}

async function metinOku(girdi) {
  const gecici = await onIsle(girdi);
  try {
    const [blok, seyrek] = await Promise.all([tesseract(gecici, 4), tesseract(gecici, 11)]);
    return `${blok}\n-----\n${seyrek}`;
  } finally { fs.unlink(gecici, () => {}); }
}

const satirlar = (t) => t.split(/\r?\n/).map(s => s.trim()).filter(Boolean);

// Sayı: önce tam biçim (E-12345678-123.45.67-12345678), olmazsa ayarlardaki önek + son 8 hane
function sayiBul(metin, onek = '') {
  for (const s of satirlar(metin)) {
    if (!/say[ıi1l]/i.test(s)) continue;
    const t = s.replace(/\s+/g, '').replace(/[)(]/g, '');
    const tam = /E-?(\d{8})-(\d{3})\.(\d{2})\.(\d{2})-(\d{6,9})/.exec(t);
    if (tam) return `E-${tam[1]}-${tam[2]}.${tam[3]}.${tam[4]}-${tam[5]}`;
    if (!onek) continue;
    const kurum = (/\d{8}/.exec(onek) || [''])[0];
    const adaylar = (t.match(/\d{8,}/g) || []).map(x => x.slice(-8)).filter(x => !kurum || !kurum.endsWith(x.slice(-7)));
    if (adaylar.length) return onek + adaylar[adaylar.length - 1];
  }
  return '';
}

function gorevTarihiBul(metin) {
  const re = /(\d{1,2})\s*[.,]\s*(\d{1,2})\s*[.,]\s*(20\d{2})/;
  for (const s of satirlar(metin)) {
    if (!/g[öo]rev\s*tar/i.test(s)) continue;
    const parca = s.split(/d[üu]zenleme/i)[0];
    const m = re.exec(parca);
    if (m && +m[1] >= 1 && +m[1] <= 31 && +m[2] >= 1 && +m[2] <= 12) return tarihISO(`${m[1]}.${m[2]}.${m[3]}`);
  }
  return '';
}

// Dosya adında tarih varsa (2026_10_13_.jpg, 2026-10-13.jpg, 13.10.2026.jpg)
function dosyaAdiTarihi(ad) {
  let m = /(20\d{2})[_.-](\d{1,2})[_.-](\d{1,2})/.exec(ad || '');
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = /(\d{1,2})[_.-](\d{1,2})[_.-](20\d{2})/.exec(ad || '');
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : '';
}

// Bilinen kişileri OCR satırlarında kelime kelime bulanık olarak ara
function kisileriBul(metin, kisiler) {
  const sat = satirlar(metin).map(s => s.split(/[\s|,;:]+/).map(sade).filter(Boolean));
  const soyadSay = {};
  kisiler.forEach(k => { const so = sade(k.ad.split(/\s+/).pop()); soyadSay[so] = (soyadSay[so] || 0) + 1; });
  const bulunan = [];
  for (const k of kisiler) {
    const parca = k.ad.split(/\s+/).map(sade).filter(Boolean);
    const soyad = parca[parca.length - 1];
    const ok = sat.some(kel => {
      for (let i = 0; i + parca.length <= kel.length; i++) {
        if (parca.every((p, j) => benzer(kel[i + j], p, 0.25))) return true;
      }
      // Ad bozuk okunmuşsa: benzersiz ve uzun soyad birebir eşleşirse kabul et
      return soyad.length >= 5 && soyadSay[soyad] === 1 && kel.includes(soyad);
    });
    if (ok) bulunan.push(k.ad);
  }
  return bulunan;
}

// Mahalle adını bilinen listeye göre düzelt (OCR harf hataları için)
function mahalleDuzelt(ilce, mahalle, bilinen) {
  const liste = bilinen[ilce] || [];
  const tam = liste.find(m => sade(m) === sade(mahalle));
  if (tam) return tam;
  const yakin = liste.find(m => benzer(m, mahalle, 0.2));
  return yakin || mahalle;
}

function yerBul(metin, haricKelimeler, bilinenMahalleler) {
  const sat = satirlar(metin);
  const aday = [];
  sat.forEach((s, i) => {
    if (/gidece/i.test(s)) { aday.push(s.replace(/.*gidece[gğ]i\s*yer[iı]?\s*:?/i, '')); if (sat[i + 1]) aday.push(sat[i + 1]); }
  });
  aday.push(...sat.filter(s => /[-,/]/.test(s)));
  for (const s of aday) {
    const temiz = s.replace(/[|_“”"]/g, ' ').trim();
    if (!temiz || /valili|müdür|tar[ıi]m ve orman|kanunu|amir|personel|imza/i.test(temiz)) continue;
    const kel = temiz.split(/[\s\-,/]+/).map(sade);
    if (kel.some(k => haricKelimeler.has(k))) continue;
    const gruplar = yerAyristir(temiz).filter(g => g.ilce);
    if (gruplar.length) {
      return gruplar.map(g => ({
        ilce: g.ilce,
        mahalleler: g.mahalleler.filter(m => sade(m).length >= 3).map(m => mahalleDuzelt(g.ilce, trTitle(m), bilinenMahalleler))
      }));
    }
  }
  return [];
}

function plakaBul(metin) {
  const m = /\b(34|16|35|06)\s?([A-ZÇĞİÖŞÜ]{1,3})\s?(\d{2,4})\b/.exec(metin.replace(/plakas[ıi]/gi, ' '));
  return m ? `${m[1]} ${m[2]} ${m[3]}` : '';
}

function belgeNoBul(metin) {
  const m = /(?<![\d-])0?(5\d{4})(?![\d-])/.exec(metin.replace(/E-?\)?\s*1?1808227[\s\S]{0,40}/g, ''));
  return m ? `0${m[1]}` : '';
}

function saatleriBul(metin) {
  const sat = satirlar(metin);
  const i = sat.findIndex(s => /[çc][ıi]k[ıi]?ş\s*saati/i.test(s));
  if (i < 0) return { cikis: '', donus: '' };
  const pencere = sat.slice(i, i + 3).join(' ');
  const s = [...pencere.matchAll(/\b(\d{1,2})[.:,]?\s?(\d{2})\b/g)].map(m => saatNormal(`${m[1]}:${m[2]}`))
    .filter(x => x && x >= '06:00' && x <= '22:00');
  return { cikis: s[0] || '', donus: s[1] || '' };
}

// baglam: { kisiler:[{ad}], amirler:[ad], bilinenMahalleler:{ilce:[mahalle]}, sayiOnek }
async function gorevOku(dosyaYolu, orijinalAd, baglam) {
  const { kisiler = [], amirler = [], bilinenMahalleler = {}, sayiOnek = '' } = baglam || {};
  const metin = await metinOku(dosyaYolu);
  const haric = new Set([...kisiler.map(k => k.ad), ...amirler].flatMap(a => a.split(/\s+/).map(sade)).filter(k => k.length >= 3));
  const yer = yerBul(metin, haric, bilinenMahalleler);
  const saat = saatleriBul(metin);
  return {
    ocrMetin: metin,
    tarih: dosyaAdiTarihi(orijinalAd) || gorevTarihiBul(metin),
    sayi: sayiBul(metin, sayiOnek),
    personel: kisileriBul(metin, kisiler),
    yer,
    yerHam: yer.map(g => [g.ilce, ...g.mahalleler].join('-')).join(', '),
    plaka: plakaBul(metin),
    belgeNo: belgeNoBul(metin),
    cikis: saat.cikis,
    donus: saat.donus
  };
}

module.exports = { gorevOku, metinOku, ILCELER };
