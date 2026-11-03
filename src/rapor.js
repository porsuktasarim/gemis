// Görevlendirme ve Görev Sonu Raporu: her görev emri için A4 tek sayfa, yazdırmaya hazır HTML.
// Rapor imzalatılıp taranınca yeniden yüklenir; OCR raporu tanır ve sıra numarasından göreve bağlar
// (raporTani). Sayfanın altındaki küçük "GEMİS-R" satırı bu eşleştirmeyi kolaylaştırır.
const { esc, tarihTR, trUpper, sade } = require('./util');

const VARSAYILAN = {
  raporIsletme: 'Mera Kanunu kapsamındaki taşınmazlar',
  raporSonuc: '4342 Sayılı Mera Kanunu kapsamında gerekli kontrol ve incelemeler yapıldı.',
  raporGorulduAd: '',
  raporGorulduUnvan: 'Şube Müdürü'
};
const ayarDegeri = (ayar, k) => (typeof ayar?.[k] === 'string' && ayar[k].trim() ? ayar[k] : VARSAYILAN[k]);

// Belge no: kayıtta 6 hane (051934), raporda kâğıttaki gibi baştaki sıfırsız (51934)
const siraNo = (b) => String(b || '').replace(/^0+(?=\d)/, '');
// Görevin konusu: kanun numarası yazılmaz ("4342 sayılı Mera Kanunu Uygulamaları" → "Mera Kanunu Uygulamaları")
const konu = (g) => (g.gorevTuru || '').replace(/^\d+\s+sayılı\s+/i, '');
// Tarih: "6.10.2026" (rapordaki gibi gün başında sıfır yok)
const kisaTarih = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? `${Number(m[3])}.${m[2]}.${m[1]}` : ''; };

function yerSatirlari(yer) {
  const y = (yer || []).filter(x => x && (x.ilce || x.mahalleler?.length));
  return {
    ilce: y.map(x => trUpper(x.ilce || '')).filter(Boolean).join('- '),
    mahalle: y.map(x => (x.mahalleler || []).join(', ')).filter(Boolean).join('-')
  };
}

function plakaTuru(plaka, plakalar) {
  const p = (plakalar || []).find(x => sade(x.plaka) === sade(plaka));
  return /özel|ozel|kiral/i.test(p?.aciklama || '') ? 'ozel' : 'resmi';
}

function birRapor(g, ayar, { kisiler, plakalar, raporTarihi }) {
  const unvan = (ad) => (kisiler || []).find(k => k.ad === ad)?.unvan || '';
  const personel = (g.personel || []).filter(Boolean);
  const yer = yerSatirlari(g.yer);
  const tur = g.plaka ? plakaTuru(g.plaka, plakalar) : '';
  const yil = (g.tarih || '').slice(0, 4) || new Date().getFullYear();
  const imzalar = personel.map((ad, i) => `
      <div class="imza">
        <div class="imza-baslik">${i === 0 ? 'Ekip Başkanının' : 'Görevli Personelin'}<br>İmzası</div>
        <div class="imza-alan"></div>
        <div>${esc(ad)}</div>
        <div>${esc(unvan(ad))}</div>
      </div>`).join('');
  return `
<section class="sayfa">
  <header class="antet">
    ${ayar.raporLogo ? `<img class="logo" src="${esc(ayar.raporLogo)}" alt="">` : '<div class="logo"></div>'}
    <div class="antet-metin">
      <div>T.C.</div>
      <div>İSTANBUL VALİLİĞİ</div>
      <div>İL TARIM VE ORMAN MÜDÜRLÜĞÜ</div>
      <div>${esc(trUpper(ayar.sube || ''))}</div>
      <div>GÖREVLENDİRME VE GÖREV SONU RAPORU</div>
    </div>
    <div class="logo"></div>
  </header>

  <table class="form">
    <colgroup><col style="width:27%"><col style="width:13%"><col style="width:17%"><col style="width:9%"><col style="width:21%"><col style="width:13%"></colgroup>
    <tr>
      <td>Taşıt Görev Emri Sıra No:</td>
      <td class="orta kalin buyuk">${esc(siraNo(g.belgeNo))}</td>
      <td colspan="3" class="bos-hucre"></td>
      <td class="orta">${esc(raporTarihi ? tarihTR(raporTarihi) : '')}</td>
    </tr>
    <tr class="ara"><td colspan="6"></td></tr>
    <tr class="yuksek">
      <td>Ekip Başkanının Adı/Soyadı, Ünvanı</td>
      <td colspan="5" class="buyuk">${esc(personel[0] || '')}${personel[0] && unvan(personel[0]) ? ` <span class="ince">– ${esc(unvan(personel[0]))}</span>` : ''}</td>
    </tr>
    <tr><td>Görev Konusu</td><td colspan="5">${esc(konu(g))}</td></tr>
    <tr><td rowspan="3" class="orta">Göreve Gidilen</td><td>İlçe</td><td colspan="4">${esc(yer.ilce)}</td></tr>
    <tr><td>Mahalle</td><td colspan="4">${esc(yer.mahalle)}</td></tr>
    <tr><td>İşletme/Yer</td><td colspan="4">${esc(g.raporIsletme || ayarDegeri(ayar, 'raporIsletme'))}</td></tr>
    <tr>
      <td>Göreve Çıkış Tarihi:</td><td class="orta">${esc(kisaTarih(g.tarih))}</td>
      <td class="orta">Göreve Çıkış Saati</td><td class="orta">${esc(g.cikis || '')}</td>
      <td class="orta">Görevden Dönüş Saati</td><td class="orta">${esc(g.donus || '')}</td>
    </tr>
    <tr>
      <td>Görevli Araç Plaka No:</td><td class="orta">${esc(g.plaka || '')}</td>
      <td class="orta">Resmi</td><td class="orta">${tur === 'resmi' ? 'X' : ''}</td>
      <td class="orta">Özel</td><td class="orta">${tur === 'ozel' ? 'X' : ''}</td>
    </tr>
  </table>

  <div class="sonuc">${esc(g.raporMetni || ayarDegeri(ayar, 'raporSonuc')).replace(/\n/g, '<br>')}</div>

  <div class="imzalar">${imzalar}</div>

  <div class="goruldu">
    <div>GÖRÜLDÜ</div>
    <div>. . / . . /${yil}</div>
    <div>${esc(ayar.raporGorulduAd || '')}</div>
    <div>${esc(ayarDegeri(ayar, 'raporGorulduUnvan'))}</div>
  </div>

  <footer class="iz">GEMİS-R ${esc(g.belgeNo || '------')} · ${esc(g.tarih || '')}</footer>
</section>`;
}

function raporSayfasi(gorevler, ayar, secenek = {}) {
  const govde = gorevler.length
    ? gorevler.map(g => birRapor(g, ayar, secenek)).join('\n')
    : '<p class="bilgi">Seçilen kapsamda görev emri yok.</p>';
  return `<!doctype html>
<html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Görev Sonu Raporu${gorevler.length === 1 ? ' ' + esc(siraNo(gorevler[0].belgeNo)) : 'ları'}</title>
<style>
  @page { size: A4 portrait; margin: 14mm 14mm 12mm; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #e9ecef; color: #000; font-family: Calibri, Carlito, "Segoe UI", Arial, sans-serif; font-size: 11pt; }
  .arac { position: sticky; top: 0; z-index: 2; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding: 10px 16px; background: #343a40; color: #fff; font-size: 10pt; }
  .arac button, .arac input { font: inherit; padding: 4px 10px; border-radius: 4px; border: 1px solid #adb5bd; }
  .arac button { background: #0d6efd; color: #fff; border-color: #0d6efd; cursor: pointer; }
  .arac .not { opacity: .8; }
  .sayfa { width: 210mm; min-height: 297mm; margin: 16px auto; padding: 14mm 14mm 12mm; background: #fff; box-shadow: 0 1px 6px rgba(0,0,0,.2); position: relative; display: flex; flex-direction: column; }
  .antet { display: grid; grid-template-columns: 30mm 1fr 30mm; align-items: center; margin-bottom: 9mm; }
  .logo { width: 30mm; height: 30mm; object-fit: contain; }
  .antet-metin { text-align: center; font-weight: bold; font-size: 12pt; line-height: 1.45; }
  table.form { width: 100%; border-collapse: collapse; table-layout: fixed; border: 1.5px solid #000; }
  table.form td { border: 1px solid #000; padding: 1.6mm 2mm; vertical-align: middle; line-height: 1.25; word-wrap: break-word; }
  table.form tr.ara td { height: 6mm; padding: 0; }
  table.form tr.yuksek td { height: 14mm; }
  table.form td.bos-hucre { border-top-color: transparent; border-bottom-color: #000; }
  .orta { text-align: center; } .kalin { font-weight: bold; } .buyuk { font-size: 12pt; } .ince { font-size: 10pt; }
  .sonuc { margin: 12mm 0 0; min-height: 22mm; line-height: 1.4; }
  .imzalar { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8mm 4mm; margin-top: 6mm; text-align: center; line-height: 1.35; }
  .imza-baslik { margin-bottom: 1mm; }
  .imza-alan { height: 16mm; }
  .goruldu { margin: 16mm auto 0; text-align: center; line-height: 1.5; }
  .iz { margin-top: auto; padding-top: 6mm; text-align: right; font-family: "Courier New", monospace; font-size: 8pt; color: #555; letter-spacing: .5px; }
  .bilgi { text-align: center; padding: 40px; }
  @media print {
    body { background: #fff; }
    .arac { display: none; }
    .sayfa { margin: 0; padding: 0; width: auto; min-height: calc(297mm - 26mm); box-shadow: none; break-after: page; page-break-after: always; }
    .sayfa:last-of-type { break-after: auto; page-break-after: auto; }
  }
</style></head>
<body>
<div class="arac">
  <button type="button" onclick="window.print()">Yazdır</button>
  <label>Rapor tarihi <input type="date" id="raporTarihi" value="${esc(secenek.raporTarihi || '')}"></label>
  <span class="not">${gorevler.length} rapor · Yazdırma penceresinde kâğıt A4, kenar boşlukları "Varsayılan", "Üstbilgi ve altbilgi" kapalı olmalıdır.</span>
</div>
${govde}
<script>
  document.getElementById('raporTarihi').addEventListener('change', function () {
    var u = new URL(location.href); u.searchParams.set('raporTarihi', this.value); location.href = u.toString();
  });
</script>
</body></html>`;
}

// OCR metninde görev sonu raporunu tanır; tanırsa { belgeNo, tarih } döner, değilse null
function raporTani(metin) {
  const t = metin || '';
  if (!/G[ÖO0]REV\s*SONU\s*RAPOR/i.test(t) && !/GEM[İI]S-?R/i.test(t)) return null;
  let belgeNo = '';
  const iz = /GEM[İI]S-?R\s*(\d{5,6})/i.exec(t);
  const sira = /S[ıi1l]ra\s*No\s*[:.]?\s*(\d{5,6})/i.exec(t);
  const b = (iz || sira || [])[1] || '';
  if (b) belgeNo = b.padStart(6, '0');
  let tarih = '';
  const it = /GEM[İI]S-?R\s*\d{5,6}\s*[·.,-]?\s*(\d{4}-\d{2}-\d{2})/i.exec(t);
  const ct = /[ÇC][ıi]k[ıi][şs]\s*Tarihi\s*[:.]?\s*(\d{1,2})[./](\d{1,2})[./](\d{4})/i.exec(t);
  if (it) tarih = it[1];
  else if (ct) tarih = `${ct[3]}-${ct[2].padStart(2, '0')}-${ct[1].padStart(2, '0')}`;
  return { belgeNo, tarih };
}

module.exports = { raporSayfasi, raporTani, VARSAYILAN: VARSAYILAN, siraNo };
