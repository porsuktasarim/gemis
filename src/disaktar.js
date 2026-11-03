// Excel ve PDF dışa aktarımı
const ExcelJS = require('exceljs');
const { PDFDocument } = require('pdf-lib');
const sharp = require('sharp');

const ince = { style: 'thin', color: { argb: 'FF808080' } };
const kenar = { top: ince, left: ince, bottom: ince, right: ince };

async function excelUret(ayar, x) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('İcmal', { pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  const n = x.basliklar.length;
  const font = { name: 'Times New Roman', size: 10 };
  let r = 1;

  if (!x.imzasiz) {
    for (const s of ['T.C.', 'İSTANBUL VALİLİĞİ', 'İl Tarım ve Orman Müdürlüğü']) {
      ws.mergeCells(r, 1, r, n); const c = ws.getCell(r, 1);
      c.value = s; c.font = { ...font, bold: true }; c.alignment = { horizontal: 'center' }; r++;
    }
    r++;
  }
  ws.mergeCells(r, 1, r, n);
  Object.assign(ws.getCell(r, 1), { value: x.baslik, font: { ...font, bold: true, size: 11 }, alignment: { horizontal: 'center', wrapText: true } });
  r += 2;
  for (const [k, v] of x.bilgi || []) {
    ws.mergeCells(r, 1, r, 2); ws.mergeCells(r, 3, r, n);
    Object.assign(ws.getCell(r, 1), { value: k, font: { ...font, bold: true } });
    Object.assign(ws.getCell(r, 3), { value: v, font });
    r++;
  }
  if (x.bilgi?.length) r++;

  const bas = ws.getRow(r);
  x.basliklar.forEach((b, i) => {
    const c = bas.getCell(i + 1);
    c.value = b; c.font = { ...font, bold: true }; c.border = kenar;
    c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDEDED' } };
  });
  bas.height = 32; r++;
  if (x.imzasiz) ws.views = [{ state: 'frozen', ySplit: r - 1 }];
  const ilkVeri = r;
  for (const satir of x.satirlar) {
    const row = ws.getRow(r);
    satir.forEach((v, i) => {
      const c = row.getCell(i + 1);
      c.value = v; c.font = font; c.border = kenar;
      c.alignment = { vertical: 'middle', wrapText: true, horizontal: typeof v === 'number' ? 'center' : 'left' };
      c.numFmt = '@';
    });
    r++;
  }
  if (x.imzasiz && x.satirlar.length) ws.autoFilter = { from: { row: ilkVeri - 1, column: 1 }, to: { row: r - 1, column: n } };
  (x.genislik || []).forEach((w, i) => { ws.getColumn(i + 1).width = w; });

  if (x.dipnot) { r++; Object.assign(ws.getCell(r, 1), { value: x.dipnot, font: { ...font, size: 9 } }); r++; }

  if (!x.imzasiz) {
    r += 2;
    const sol = 1, orta = Math.max(2, Math.ceil(n / 2)), sag = n;
    const yaz = (row, col, v, bold) => Object.assign(ws.getCell(row, col), { value: v, font: { ...font, bold: !!bold }, alignment: { horizontal: 'center' } });
    yaz(r, sag, 'KONTROL EDEN', true);
    yaz(r + 2, sol, ayar.personelAd); yaz(r + 3, sol, ayar.personelUnvan);
    yaz(r + 2, sag, ayar.subeMuduruAd); yaz(r + 3, sag, ayar.subeMuduruUnvan);
    if (!x.ikiImza) {   // ek özel hizmet cetvelinde onaylayan yoktur
    yaz(r + 6, orta, 'ONAYLAYAN', true); yaz(r + 7, orta, '. . / . . /' + new Date().getFullYear());
    yaz(r + 9, orta, ayar.ilMudYrdAd); yaz(r + 10, orta, ayar.ilMudYrdUnvan);
    }
  }
  return wb.xlsx.writeBuffer();
}

// Görev emri görüntülerini A4 sayfalara yerleştirip tek PDF yap.
// gorselGetir(g) => Buffer|null : yerel kopyadan ya da Drive'dan bellekte getirir.
async function pdfUret(gorevler, gorselGetir) {
  const pdf = await PDFDocument.create();
  const A4 = [841.89, 595.28]; // yatay
  let eklenen = 0;
  for (const g of gorevler) {
    let veri;
    try { veri = await gorselGetir(g); } catch (e) { console.error(`PDF: ${g.tarih} görüntüsü alınamadı: ${e.message}`); continue; }
    if (!veri) continue;
    const jpg = await sharp(veri).rotate().jpeg({ quality: 85 }).toBuffer();
    const img = await pdf.embedJpg(jpg);
    const dikey = img.height > img.width;
    const [pw, ph] = dikey ? [A4[1], A4[0]] : A4;
    const sayfa = pdf.addPage([pw, ph]);
    const kenarBosluk = 18;
    const olcek = Math.min((pw - 2 * kenarBosluk) / img.width, (ph - 2 * kenarBosluk) / img.height);
    const w = img.width * olcek, h = img.height * olcek;
    sayfa.drawImage(img, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
    eklenen++;
  }
  if (!eklenen) return null;
  return Buffer.from(await pdf.save());
}

module.exports = { excelUret, pdfUret };
