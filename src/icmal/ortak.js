const { esc, trUpper, trTitle, sade, benzer } = require('../util');

// EDYS imza şablonu: @IMZA_1 personel, @IMZA_2 şube müdürü, @IMZA_3 il müdür yardımcısı
const IMZA_HTML = `<table border="0" cellpadding="1" cellspacing="1" style="width:100%">
	<tbody>
		<tr>
			<td style="text-align:center; width:33%">
			<div class="sablon_imza_1-">(@IMZA_1)</div>
			</td>
			<td style="width:33%">&nbsp;</td>
			<td style="text-align:center; width:33%">
			<p><span style="font-size:10pt">KONTROL EDEN</span></p>

			<p>&nbsp;</p>

			<div class="sablon_imza_2-">(@IMZA_2)</div>

			<p>&nbsp;</p>
			</td>
		</tr>
		<tr>
			<td style="width:33%">&nbsp;</td>
			<td style="text-align:center; width:33%">
			<p><span style="font-size:10pt">ONAYLAYAN</span></p>

			<p><span style="font-size:10pt"><span class="sablon_evrak_tarih-"><span id="evrakTarihText">. . / . . /2026</span></span></span></p>

			<p>&nbsp;</p>

			<div class="sablon_imza_3-">(@IMZA_3)</div>

			<p>&nbsp;</p>
			</td>
			<td style="width:33%">&nbsp;</td>
		</tr>
	</tbody>
</table>`;

// Ek özel hizmet cetveli: kurum şablonundaki gibi iki imzacı — @IMZA_1 personel (solda),
// @IMZA_2 kontrol eden şube müdürü (sağda). Onaylayan yoktur.
const IMZA_IKILI_HTML = `<table border="0" cellpadding="1" cellspacing="1" style="width:1050px">
	<tbody>
		<tr>
			<td style="text-align:center; width:33%">&nbsp;</td>
			<td style="width:33%">&nbsp;</td>
			<td style="text-align:center; width:33%"><span style="font-size:11pt">Kontrol Eden</span></td>
		</tr>
		<tr>
			<td style="text-align:center; width:33%">
			<div class="sablon_imza_1-">(@IMZA_1)</div>
			</td>
			<td style="width:33%">&nbsp;</td>
			<td style="text-align:center; width:33%">
			<div class="sablon_imza_2-">(@IMZA_2)</div>
			</td>
		</tr>
	</tbody>
</table>`;

const ANTET = `<div class="sablon_ust_antet-">
<table style="text-align:center; width:100%">
	<tbody>
		<tr>
			<td>T.C.</td>
		</tr>
		<tr>
			<td>İSTANBUL VALİLİĞİ</td>
		</tr>
		<tr>
			<td>İl Tarım ve Orman Müdürlüğü</td>
		</tr>
	</tbody>
</table>
</div>`;

const imzaHtml = (yil) => IMZA_HTML.replace('/2026</span>', `/${yil}</span>`);

// Mahalle mahalli dışı listesinde mi?
function mahalliDisiMi(ayar, ilce, mahalle) {
  const k = (ayar.mahalliDisi || []).find(x => sade(x.ilce) === sade(ilce));
  if (!k) return false;
  return (k.mahalleler || []).some(m => sade(m) === sade(mahalle) || benzer(m, mahalle, 0.15));
}

// Yer biçimleri
const mah = (g) => (Array.isArray(g?.mahalleler) ? g.mahalleler : []);
const yerEkOzel = (yer) => ({
  ilce: (yer || []).map(g => trUpper(g.ilce)).join('-'),
  mahalle: (yer || []).map(g => mah(g).length ? mah(g).map(trUpper).join(',') : 'MERKEZ').join('-')
});
const yerVirgullu = (yer) => ({
  ilce: (yer || []).map(g => g.ilce).join(', '),
  mahalle: (yer || []).map(g => mah(g).length ? mah(g).join('-') : 'Merkez').join(', ')
});
function yerSeyyar(ayar, yer) {
  return (yer || []).map(g => ({ ilce: g.ilce, mahalleler: mah(g).filter(m => mahalliDisiMi(ayar, g.ilce, m)) }))
    .filter(g => g.mahalleler.length);
}

const td = (icerik, stil = '') => `<td${stil ? ` style="${stil}"` : ''}>${icerik}</td>`;

module.exports = { IMZA_HTML, IMZA_IKILI_HTML, ANTET, imzaHtml, mahalliDisiMi, yerEkOzel, yerVirgullu, yerSeyyar, esc, td, trTitle };
