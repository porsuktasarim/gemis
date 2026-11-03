// Görev emri görüntüsünden yapay zekâ kullanmadan (Tesseract OCR) alan çıkarma.
// Basılı alanlar (sayı, görev tarihi, personel, gideceği yer) çoğunlukla okunur;
// el yazısı alanlar (sürücü, plaka, saatler, belge no) yalnızca denenir, kullanıcı formda tamamlar.

// Görüntü hiçbir aşamada diske yazılmaz: sharp bellekte işler, Tesseract'a stdin üzerinden verilir.
const { spawn } = require('child_process');
const sharp = require('sharp');
const { ILCELER, sade, benzer, levenshtein, yerAyristir, tarihISO, saatNormal, trTitle } = require('./util');
const { bolgeselOku } = require('./zon');

function tesseract(png, psm) {
  return new Promise((resolve) => {
    const p = spawn('tesseract', ['stdin', 'stdout', '-l', 'tur', '--psm', String(psm)]);
    const parca = [];
    const zaman = setTimeout(() => p.kill('SIGKILL'), 120000);
    p.stdout.on('data', d => parca.push(d));
    p.on('error', () => { clearTimeout(zaman); resolve(''); });
    p.on('close', () => { clearTimeout(zaman); resolve(Buffer.concat(parca).toString('utf8')); });
    p.stdin.on('error', () => {});
    p.stdin.end(png);
  });
}

// girdi: dosya yolu ya da Buffer
async function onIsle(girdi) {
  const meta = await sharp(girdi).metadata();
  return sharp(girdi).rotate().grayscale()
    .resize({ width: Math.min((meta.width || 1750) * 2, 4000) })
    .normalise().threshold(170).png().toBuffer();
}

async function metinOku(girdi) {
  const png = await onIsle(girdi);
  const [blok, seyrek] = await Promise.all([tesseract(png, 4), tesseract(png, 11)]);
  return `${blok}\n-----\n${seyrek}`;
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

// Kişi adı eşleştirme (el yazısı için daha toleranslı)
function kisiEslestir(ham, kisiler, oran = 0.3) {
  const h = sade(ham);
  if (h.length < 4) return '';
  let en = null, enMesafe = Infinity;
  for (const k of kisiler) {
    const a = sade(k.ad);
    const m = levenshtein(h, a) / Math.max(h.length, a.length);
    if (m < enMesafe) { enMesafe = m; en = k.ad; }
    // yalnızca soyadı okunduysa
    const soyad = sade(k.ad.split(/\s+/).pop());
    if (soyad.length >= 4 && h.includes(soyad) && 0.1 < enMesafe) { enMesafe = 0.1; en = k.ad; }
  }
  return enMesafe <= oran ? en : '';
}

function plakaCoz(ham, bilinen = []) {
  const t = (ham || '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const m = /(\d{2})\s*([A-Z]{1,3})\s*(\d{2,4})/.exec(t);
  const aday = m ? `${m[1]} ${m[2]} ${m[3]}` : '';
  // Daha önce girilen plakalarla karşılaştır (el yazısı hatalarını düzeltir)
  const sik = sade(aday || t);
  if (sik.length >= 5) {
    let en = '', enM = Infinity;
    for (const p of bilinen) { const d = levenshtein(sik, sade(p)); if (d < enM) { enM = d; en = p; } }
    if (en && enM <= 2) return en;
  }
  return aday;
}

function belgeNoCoz(ham) {
  const adaylar = (ham || '').replace(/[.,:]/g, ' ').match(/\d{5,6}/g) || [];
  const sayac = {};
  for (const a of adaylar) { const n = a.length === 5 ? `0${a}` : a; sayac[n] = (sayac[n] || 0) + 1; }
  const en = Object.entries(sayac).sort((x, y) => y[1] - x[1])[0];
  return en ? en[0] : '';
}

// "Çatalca Çiftlikköy" gibi ayraçsız yazımlarda ilçeden sonra ayraç ekle
function yerOnIsle(t) {
  let s = (t || '').replace(/[|_“”"]/g, ' ');
  for (const i of ILCELER) s = s.replace(new RegExp(`(${i})\\s+(?=[^\\s,/\\-])`, 'giu'), '$1-');
  return s.replace(/B\.\s*Çekmece/giu, 'Büyükçekmece').replace(/K\.\s*Çekmece/giu, 'Küçükçekmece');
}

// Ad soyad biçimi: soyad büyük harf, ad baş harfi büyük
function adBicimle(ad) {
  const p = ad.split(/\s+/);
  return p.map((w, i) => i === p.length - 1 ? w.toLocaleUpperCase('tr-TR') : trTitle(w)).join(' ');
}

// baglam: { kisiler:[{ad}], amirler:[ad], bilinenMahalleler:{ilce:[mahalle]}, sayiOnek, bilinenPlakalar:[...] }
async function gorevOku(girdi, orijinalAd, baglam) {
  const { kisiler = [], amirler = [], bilinenMahalleler = {}, sayiOnek = '', bilinenPlakalar = [] } = baglam || {};
  const z = await bolgeselOku(girdi);
  const metin = z.metin;
  const haric = new Set([...kisiler.map(k => k.ad), ...amirler].flatMap(a => a.split(/\s+/).map(sade)).filter(k => k.length >= 3));

  // Gideceği yer: önce kendi hücresi, olmazsa tam metin
  let yer = z.yer ? yerBul(`Gideceği Yer: ${yerOnIsle(z.yer)}`, new Set(), bilinenMahalleler) : [];
  if (!yer.length) yer = yerBul(metin, haric, bilinenMahalleler);

  // Personel: hücrelerden okunan adlar (bilinen kişiyle eşleşirse o ad), artı tam metinde bulunan bilinen kişiler
  const personel = [];
  for (const ham of z.personel || []) {
    const ad = kisiEslestir(ham, kisiler, 0.25) || adBicimle(ham);
    if (!personel.includes(ad)) personel.push(ad);
  }
  for (const ad of kisileriBul(metin, kisiler)) if (!personel.includes(ad)) personel.push(ad);

  const saat = saatleriBul(metin);
  return {
    ocrMetin: metin,
    tarih: dosyaAdiTarihi(orijinalAd) || gorevTarihiBul(`Görev Tarihi ${(z.tarih || '').split(/d[üu]zenleme/i)[0]}`) || gorevTarihiBul(metin),
    sayi: sayiBul(`Sayı ${z.sayi || ''}`, sayiOnek) || sayiBul(metin, sayiOnek),
    personel,
    yer,
    yerHam: yer.map(g => [g.ilce, ...g.mahalleler].join('-')).join(', '),
    surucu: kisiEslestir(z.surucu, kisiler, 0.35),
    plaka: plakaCoz(z.plaka, bilinenPlakalar) || plakaBul(metin),
    belgeNo: belgeNoCoz(z.belgeNo),
    cikis: z.cikis || saat.cikis,
    donus: z.donus || saat.donus
  };
}

module.exports = { gorevOku, metinOku, kisiEslestir, plakaCoz, belgeNoCoz, yerOnIsle, adBicimle, sayiBul, ILCELER };
