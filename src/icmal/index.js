// İcmal üreticileri. Her biri { baslik, html, excel, gorevler, uyarilar } döndürür.
// excel: { baslik, bilgi:[[etiket, değer]], basliklar:[...], satirlar:[[...]], genislik:[...], dipnot }
const { ANTET, imzaHtml, IMZA_IKILI_HTML, yerEkOzel, yerVirgullu, yerSeyyar, esc } = require('./ortak');
const { tarihTR, dk, saatYaz, ayGunleri, aylar, ayAraligiMetni, plakaBosluksuz, yerYaz, trUpper, sade } = require('../util');

const TURLER = {
  puantaj: 'Kontrol Hizmetleri Puantaj Tablosu (EK-1)',
  ekozel: 'Ek Özel Hizmet Tazminatı Arazi Gerçekleşme Cetveli',
  arac: 'Araç Kullanarak Görev İlave Ücret Gerçekleşme Cetveli',
  seyyar: 'Seyyar Görev Tazminatı Arazi Çıkış Cetveli',
  liste: 'Görev Emirleri Listesi (kişi bazında)'
};

function genelUyarilar(gorevler) {
  const u = [];
  for (const g of gorevler) {
    const eksik = [];
    if (!g.onayli) eksik.push('kontrol edilmedi');
    if (!g.yer?.length) eksik.push('gideceği yer');
    if (!g.plaka) eksik.push('plaka');
    if (!g.surucu) eksik.push('sürücü');
    if (!g.cikis || !g.donus) eksik.push('saat');
    if (eksik.length) u.push(`${tarihTR(g.tarih)}: ${eksik.join(', ')}`);
  }
  return u;
}

// ---------------- PUANTAJ ----------------
function puantaj(ayar, gorevler, { bas, haric = [] }) {
  const ay = bas;
  const [yil, ayNo] = ay.split('-');
  const AY = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'][+ayNo - 1];
  const tatil = new Map((ayar.tatiller || []).map(t => [t.tarih, t]));
  const gunGorev = new Map(gorevler.map(g => [g.tarih, g]));
  const mb = dk(ayar.mesaiBas) ?? 510, ms = dk(ayar.mesaiBit) ?? 1020;
  const satirlar = [];
  const uyarilar = [];
  for (const { iso, hg } of ayGunleri(ay)) {
    const g = gunGorev.get(iso);
    const t = tatil.get(iso);
    const isGunu = hg !== 0 && hg !== 6 && !t;
    if (haric.includes(iso)) continue;
    if (!isGunu && !g) continue;
    if (t && t.yarim && !g) continue; // yarım gün: 5 saatin altında kalır
    if (!g) { satirlar.push([iso, 'Büro çalışması', `${ayar.mesaiBas}-${ayar.mesaiBit}`]); continue; }
    const c = dk(g.cikis), d = dk(g.donus);
    if (c == null || d == null) {
      uyarilar.push(`${tarihTR(iso)} görevinde saat eksik; mesai saati yazıldı.`);
      satirlar.push([iso, 'Arazi* ve Büro çalışması', `${ayar.mesaiBas}-${ayar.mesaiBit}`]); continue;
    }
    if (!isGunu) { satirlar.push([iso, 'Arazi* çalışması', `${saatYaz(c)}-${saatYaz(d)}`]); continue; }
    const p = [saatYaz(mb)];
    if (c > mb) p.push(saatYaz(c));
    if (d < ms) { p.push(saatYaz(d)); p.push(saatYaz(ms)); } else p.push(saatYaz(d));
    satirlar.push([iso, c <= mb && d >= ms ? 'Arazi* çalışması' : 'Arazi* ve Büro çalışması', p.join('-')]);
  }

  const kt = esc(ayar.puantajKontrolTuru), mv = esc(ayar.puantajMevzuat);
  const satirHtml = satirlar.map(([iso, acik, saat], i) => {
    const acikHtml = acik === 'Arazi* ve Büro çalışması'
      ? '<span style="font-size:9pt">Arazi* ve </span><span style="font-family:Times New Roman"><span style="font-size:9pt">Büro çalışması</span></span>'
      : `<span style="font-size:9pt">${acik}</span>`;
    return `		<tr>
			<td style="text-align:center; width:23px"><span style="font-size:13.3333px">${i + 1}</span></td>
			<td style="text-align:center; width:67px"><span style="font-size:9pt">${tarihTR(iso)}</span></td>
			<td style="width:109px"><span style="font-size:9pt">${kt}</span></td>
			<td style="width:138px"><span style="font-size:9pt">${mv}</span></td>
			<td style="width:138px">${acikHtml}</td>
			<td style="text-align:center; width:137px"><span style="font-size:9pt">${saat}</span></td>
		</tr>`;
  }).join('\n');

  const html = `<p style="text-align:center">&nbsp;</p>

${ANTET}

<p>&nbsp;</p>

<p style="text-align:center"><strong>Kontrol Hizmetlerine İlişkin Puantaj Tablosu (EK-1)&nbsp;</strong></p>

<p style="text-align:center"><strong>Ait Olduğu Yıl: </strong>${yil}<strong>&nbsp;Ay: </strong>${AY}</p>

<table border="1" cellpadding="4" cellspacing="0" class="MsoTableGrid">
	<tbody>
		<tr>
			<td style="width:23px">&nbsp;</td>
			<td style="text-align:center; width:67px"><strong><span style="font-size:9pt">Tarih</span></strong></td>
			<td style="text-align:center; width:109px"><strong><span style="font-size:9pt">Kontrol Türü (1)</span></strong></td>
			<td style="width:138px">
			<p style="text-align:center"><span style="font-size:9pt"><strong>Kontrol Türünün</strong></span></p>

			<p style="text-align:center"><span style="font-size:9pt"><strong>Dayandığı</strong></span></p>

			<p style="text-align:center"><span style="font-size:9pt"><strong>Mevzuat</strong></span></p>

			<p style="text-align:center"><span style="font-size:9pt"><strong>(2)</strong></span></p>
			</td>
			<td style="width:138px">
			<p style="text-align:center"><span style="font-size:9pt"><strong>Açıklama </strong></span></p>

			<p style="text-align:center"><span style="font-size:9pt"><strong>(3)</strong></span></p>
			</td>
			<td style="width:137px">
			<p style="text-align:center"><span style="font-size:9pt"><strong>Saat Aralığı</strong></span></p>

			<p style="text-align:center"><span style="font-size:9pt"><strong>(4)</strong></span></p>
			</td>
		</tr>
${satirHtml}
	</tbody>
</table>

<p><span style="font-size:9pt">*Ek Özel Hizmet Tazminatına eklendi.&nbsp;</span></p>

${imzaHtml(yil)}

<p>&nbsp;</p>

${PUANTAJ_DIPNOT}

<p>&nbsp;</p>
`;
  return {
    baslik: `Puantaj ${AY} ${yil} - ${ayar.personelAd}`,
    html,
    excel: {
      baslik: 'Kontrol Hizmetlerine İlişkin Puantaj Tablosu (EK-1)',
      bilgi: [['Ait Olduğu Yıl / Ay', `${yil} / ${AY}`]],
      basliklar: ['Sıra', 'Tarih', 'Kontrol Türü (1)', 'Kontrol Türünün Dayandığı Mevzuat (2)', 'Açıklama (3)', 'Saat Aralığı (4)'],
      satirlar: satirlar.map(([iso, a, s], i) => [i + 1, tarihTR(iso), ayar.puantajKontrolTuru, ayar.puantajMevzuat, a, s]),
      genislik: [6, 12, 18, 24, 24, 24],
      dipnot: '*Ek Özel Hizmet Tazminatına eklendi.'
    },
    gorevler,
    uyarilar
  };
}

// ---------------- EK ÖZEL HİZMET ----------------
function ekozel(ayar, gorevler, { bas, bit }) {
  const donem = trUpper(ayAraligiMetni(bas, bit)).replace(/ (\d{4})$/, ' - $1');
  const satirlar = gorevler.map(g => { const y = yerEkOzel(g.yer); return [tarihTR(g.tarih), plakaBosluksuz(g.plaka), y.ilce, y.mahalle, (g.gorevTuru || '').replace(/^\d+\s+sayılı\s+/i, '')]; });
  const satirHtml = satirlar.map(([t, p, i, m, k], n) => `		<tr>
			<td style="text-align:center">${n + 1}</td>
			<td style="text-align:center; width:81px">${t}</td>
			<td style="text-align:center; width:88px">${esc(p)}</td>
			<td style="width:253px">${esc(i)}</td>
			<td style="width:306px">${esc(m)}</td>
			<td>${esc(k)}</td>
			<td>&nbsp;</td>
		</tr>`).join('\n');
  const html = `${ANTET}

<p>&nbsp;</p>

<p style="text-align:center"><span style="font-size:11pt">EK ÖZEL HİZMET TAZMİNATINA ESAS AYLIK ARAZİ GERÇEKLEŞME CETVELİ&nbsp;</span></p>

<table border="0" cellspacing="0" style="width:100%">
	<tbody>
		<tr>
			<td colspan="9" style="height:10pt; vertical-align:bottom; white-space:nowrap; width:93px">
			${ayar.sayiEkOzel || ''}

			<p><span style="font-size:11pt"><strong>AYI - YIL:</strong>&nbsp;${esc(donem)}</span></p>
			</td>
		</tr>
		<tr>
			<td colspan="9" style="height:10pt; vertical-align:bottom; white-space:nowrap; width:93px"><span style="font-size:11pt"><strong>ŞUBESİ:</strong> ${esc(ayar.sube)}</span></td>
		</tr>
		<tr>
			<td colspan="9" style="height:10pt; vertical-align:bottom; white-space:nowrap; width:206px"><span style="font-size:11pt"><strong>PERSONELİN ADI SOYADI:</strong> ${esc(ayar.personelAd)}</span></td>
		</tr>
		<tr>
			<td colspan="9" style="height:10pt; vertical-align:bottom; white-space:nowrap; width:93px"><span style="font-size:11pt"><strong>ÜNVANI:</strong> ${esc(ayar.personelUnvanCetvel)}</span></td>
		</tr>
		<tr>
			<td colspan="9" style="height:10pt; vertical-align:bottom; white-space:nowrap; width:79px">&nbsp;</td>
		</tr>
	</tbody>
</table>

<table border="1" cellspacing="0" style="font-size:12px; vertical-align:middle; width:1050px">
	<tbody>
		<tr>
			<th rowspan="2" style="text-align:center; width:40px">SIRA NO</th>
			<th rowspan="2" style="text-align:center; width:81px">TARİHİ</th>
			<th rowspan="2" style="text-align:center; width:88px">GÖREVE GİDİLEN ARACIN PLAKA NO'SU</th>
			<th colspan="2" style="text-align:center; width:569px">GÖREVE GİDİLEN</th>
			<th rowspan="2" style="text-align:center; width:160px">GÖREVİN KONUSU</th>
			<th rowspan="2" style="text-align:center; width:80px">AÇIKLAMALAR</th>
		</tr>
		<tr>
			<th style="text-align:center; width:253px">İLÇE</th>
			<th style="text-align:center; width:306px">KÖY/MAHALLE</th>
		</tr>
${satirHtml}
	</tbody>
</table>

<p>&nbsp;</p>

${IMZA_IKILI_HTML}
`;
  return {
    baslik: `Ek Özel Hizmet ${ayAraligiMetni(bas, bit)} - ${ayar.personelAd}`,
    html,
    excel: {
      baslik: 'EK ÖZEL HİZMET TAZMİNATINA ESAS AYLIK ARAZİ GERÇEKLEŞME CETVELİ',
      bilgi: [['AYI - YIL', donem], ['ŞUBESİ', ayar.sube], ['PERSONELİN ADI SOYADI', ayar.personelAd], ['ÜNVANI', ayar.personelUnvanCetvel]],
      basliklar: ['SIRA NO', 'TARİHİ', "GÖREVE GİDİLEN ARACIN PLAKA NO'SU", 'İLÇE', 'KÖY/MAHALLE', 'GÖREVİN KONUSU', 'AÇIKLAMALAR'],
      satirlar: satirlar.map((s, i) => [i + 1, ...s, '']),
      genislik: [8, 12, 16, 30, 34, 28, 14],
      ikiImza: true
    },
    gorevler,
    uyarilar: genelUyarilar(gorevler)
  };
}

// ---------------- ARAÇ KULLANMA / SEYYAR (aynı şablon) ----------------
function aracSablonu(ayar, { baslikMetni, donem, sayiHtml, unvan, satirlar, yil }) {
  const satirHtml = satirlar.map(([t, p, i, m, k], n) => `		<tr>
			<td style="width:45px"><span style="font-size:10pt">${n + 1}</span></td>
			<td style="text-align:center; width:77px"><span style="font-size:10pt">${t}</span></td>
			<td style="text-align:center; width:86px"><span style="font-size:10pt">${esc(p)}</span></td>
			<td style="width:87px">&nbsp;</td>
			<td style="width:139px"><span style="font-size:10pt">${esc(i)}</span></td>
			<td style="width:173px"><span style="font-size:10pt">${esc(m)}</span></td>
			<td colspan="2" style="width:154px"><span style="font-size:10pt">${esc(k)}</span></td>
			<td style="width:219px">&nbsp;</td>
		</tr>`).join('\n');
  return `<p style="text-align:center">&nbsp;</p>

${ANTET}

<p style="text-align:center"><span style="font-size:10pt">${baslikMetni}</span></p>

<table border="0" cellspacing="0" style="width:100%">
	<tbody>
		<tr>
			<td colspan="9" style="height:15pt; vertical-align:bottom; white-space:nowrap; width:93px">
			${sayiHtml || ''}

			<p><span style="font-size:10pt">AYI - YIL: ${donem}</span></p>
			</td>
		</tr>
		<tr>
			<td colspan="9" style="height:15pt; vertical-align:bottom; white-space:nowrap; width:93px"><span style="font-size:10pt">ŞUBESİ: ${esc(ayar.sube)}</span></td>
		</tr>
		<tr>
			<td colspan="9" style="height:15pt; vertical-align:bottom; white-space:nowrap; width:206px"><span style="font-size:10pt">PERSONELİN ADI SOYADI: ${esc(ayar.personelAd)}</span></td>
		</tr>
		<tr>
			<td colspan="9" style="height:15pt; vertical-align:bottom; white-space:nowrap; width:93px"><span style="font-size:10pt">ÜNVANI: ${esc(unvan)}</span></td>
		</tr>
		<tr>
			<td colspan="9" style="height:15pt; vertical-align:bottom; white-space:nowrap; width:79px">&nbsp;</td>
		</tr>
	</tbody>
</table>

<table border="1" cellpadding="0" cellspacing="0" style="width:1000px">
	<tbody>
		<tr>
			<td rowspan="3" style="text-align:center; width:45px"><span style="font-size:10pt">SIRA NO</span></td>
			<td rowspan="3" style="text-align:center; width:77px"><span style="font-size:10pt">TARİHİ</span></td>
			<td colspan="2" rowspan="2" style="text-align:center; width:177px"><span style="font-size:10pt">GÖREVE GİDİLEN ARACIN PLAKA NO'SU</span></td>
			<td colspan="2" rowspan="2" style="text-align:center; width:314px"><span style="font-size:10pt">GÖREVE GİDİLEN</span></td>
			<td colspan="2" rowspan="3" style="text-align:center; width:154px"><span style="font-size:10pt">GÖREVİN KONUSU</span></td>
			<td rowspan="3" style="text-align:center; width:219px"><span style="font-size:10pt">AÇIKLAMALAR</span></td>
		</tr>
		<tr>
		</tr>
		<tr>
			<td style="text-align:center; width:86px"><span style="font-size:10pt">RESMİ</span></td>
			<td style="text-align:center; width:87px"><span style="font-size:10pt">ÖZEL</span></td>
			<td style="text-align:center; width:139px"><span style="font-size:10pt">İLÇE</span></td>
			<td style="text-align:center; width:173px"><span style="font-size:10pt">MAHALLE / KÖY</span></td>
		</tr>
${satirHtml}
	</tbody>
</table>

${imzaHtml(yil)}

<p>&nbsp;</p>
`;
}

function aracExcel(ayar, baslik, donem, unvan, satirlar) {
  return {
    baslik,
    bilgi: [['AYI - YIL', donem], ['ŞUBESİ', ayar.sube], ['PERSONELİN ADI SOYADI', ayar.personelAd], ['ÜNVANI', unvan]],
    basliklar: ['SIRA NO', 'TARİHİ', 'PLAKA (RESMİ)', 'PLAKA (ÖZEL)', 'İLÇE', 'MAHALLE / KÖY', 'GÖREVİN KONUSU', 'AÇIKLAMALAR'],
    satirlar: satirlar.map((s, i) => [i + 1, s[0], s[1], '', s[2], s[3], s[4], '']),
    genislik: [8, 12, 14, 10, 26, 30, 28, 16]
  };
}

function arac(ayar, gorevler, { bas, bit }) {
  const kendi = gorevler.filter(g => sade(g.surucu) === sade(ayar.personelAd));
  const satirlar = kendi.map(g => { const y = yerVirgullu(g.yer); return [tarihTR(g.tarih), plakaBosluksuz(g.plaka), y.ilce, y.mahalle, g.gorevTuru]; });
  const donem = ayAraligiMetni(bas, bit);
  const baslik = 'GÖREVLERİNİ ARAÇ KULLANARAK YERİNE GETİREN KAMU GÖREVLİLERİNE İLAVE ÜCRET GERÇEKLEŞME CETVELİ';
  return {
    baslik: `Araç Kullanma ${donem} - ${ayar.personelAd}`,
    html: aracSablonu(ayar, {
      baslikMetni: 'GÖREVLERİNİ ARAÇ KULLANARAK YERİNE GETİREN KAMU GÖREVLİLERİNE İLAVE ÜCRET&nbsp;GERÇEKLEŞME CETVELİ&nbsp;',
      donem: esc(donem).replace(/ (\d{4})$/, '&nbsp;$1'), sayiHtml: ayar.sayiArac, unvan: ayar.personelUnvanCetvel, satirlar, yil: bit.slice(0, 4)
    }),
    excel: aracExcel(ayar, baslik, donem, ayar.personelUnvanCetvel, satirlar),
    gorevler: kendi,
    uyarilar: genelUyarilar(kendi)
  };
}

function seyyar(ayar, gorevler, { bas, bit, donemMetni }) {
  const uygun = [], disarida = [];
  const satirlar = [];
  for (const g of gorevler) {
    const y = yerSeyyar(ayar, g.yer || []);
    if (!y.length) { disarida.push(`${tarihTR(g.tarih)} ${yerYaz(g.yer)}: mahalli dışı listesinde değil, cetvele alınmadı.`); continue; }
    const atilan = (g.yer || []).flatMap(x => x.mahalleler.length ? x.mahalleler.filter(m => !y.some(k => k.ilce === x.ilce && k.mahalleler.includes(m))).map(m => `${x.ilce}-${m}`) : [x.ilce]);
    if (atilan.length) disarida.push(`${tarihTR(g.tarih)}: ${atilan.join(', ')} listede olmadığı için satıra yazılmadı.`);
    uygun.push(g);
    const v = yerVirgullu(y);
    satirlar.push([tarihTR(g.tarih), plakaBosluksuz(g.plaka), v.ilce, v.mahalle, g.gorevTuru]);
  }
  const donem = donemMetni || ayAraligiMetni(bas, bit);
  return {
    baslik: `Seyyar Görev ${donem} - ${ayar.personelAd}`,
    html: aracSablonu(ayar, {
      baslikMetni: 'SEYYAR GÖREV TAZMİNATINA ESAS AYLIK ARAZİ ÇIKIŞ CETVELİ&nbsp;',
      donem: esc(donem), sayiHtml: ayar.sayiSeyyar, unvan: ayar.personelUnvanSeyyar, satirlar, yil: bit.slice(0, 4)
    }),
    excel: aracExcel(ayar, 'Seyyar Görev Tazminatına Esas Aylık Arazi Çıkış Cetveli', donem, ayar.personelUnvanSeyyar, satirlar),
    gorevler: uygun,
    uyarilar: [...disarida, ...genelUyarilar(uygun)]
  };
}

// ---------------- KİŞİ BAZINDA LİSTE ----------------
function liste(ayar, gorevler, { bas, bit, tumKisiler }) {
  const sat = [];
  const kisiMi = (a) => tumKisiler || sade(a) === sade(ayar.personelAd);
  for (const g of gorevler) {
    const ortak = [tarihTR(g.tarih), yerYaz(g.yer) || g.yerHam || '', plakaBosluksuz(g.plaka), g.cikis || '', g.donus || '', g.belgeNo || ''];
    if (g.surucu && kisiMi(g.surucu)) sat.push([g.surucu, 'Sürücü', g.tarih, ...ortak]);
    for (const p of g.personel || []) if (kisiMi(p)) sat.push([p, 'Görevli Personel', g.tarih, ...ortak]);
  }
  sat.sort((a, b) => a[0].localeCompare(b[0], 'tr') || a[2].localeCompare(b[2]) || (a[1] === 'Sürücü' ? -1 : 1));
  const satirlar = sat.map(s => [s[0], s[1], ...s.slice(3)]);
  const basliklar = ['Adı Soyadı', 'Görevi', 'Görev Tarihi', 'Gideceği Yer (İlçe-Mahalle)', 'Plaka', 'Çıkış Saati', 'Dönüş Saati', 'Belge No'];
  const html = `<table border="1" cellpadding="4" cellspacing="0" style="border-collapse:collapse; font-family:Arial; font-size:10pt">
	<thead><tr>${basliklar.map(b => `<th>${b}</th>`).join('')}</tr></thead>
	<tbody>
${satirlar.map(r => `		<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('\n')}
	</tbody>
</table>
`;
  return {
    baslik: `Görev Listesi ${ayAraligiMetni(bas, bit)}${tumKisiler ? '' : ` - ${ayar.personelAd}`}`,
    html,
    excel: { baslik: `Görev Emirleri – ${ayAraligiMetni(bas, bit)}`, bilgi: [], basliklar, satirlar, genislik: [24, 18, 13, 44, 13, 11, 11, 11], imzasiz: true },
    gorevler,
    uyarilar: genelUyarilar(gorevler)
  };
}

const PUANTAJ_DIPNOT = `<table>
	<tbody>
		<tr>
			<td>
			<p style="text-align:justify"><span style="font-size:8pt">1) Kontrol Türü: Personelin yürüttüğü iş ve/veya işlemlerin, 11/6/2010 tarihli ve 5996 sayılı Kanun, 22/3/1971 tarihli ve 1380 sayılı Kanun, 25/2/1998 tarihli ve 4342 sayılı Kanun, 3/1/2002 tarihli ve 4733 sayılı Kanun, 1/7/2033 tarihli ve 4915 sayılı Kanun, 3/7/2005 tarihli ve 5403 sayılı Kanun, 1/12/2004 tarihli ve 5262 sayılı Kanun, 18/4/2006 tarihli ve 5488 sayılı Kanun, 31/10/2006 tarihli ve 5553 sayılı Kanun ile söz konusu mevzuat kapsamında yayımlanan yönetmelikler ve Tarımda Kullanılan Gübrelerin Piyasa Gözetimi ve Denetimi Yönetmeliği’nde geçen kontrol, izleme, gözetim, denetim, muayene, karantina, numune alma, analiz, doğrulama, tetkik, belge kontrolü, fiziksel kontrol, kimlik kontrolü, kordon, gözetim bölgesi işlemleri, sahada yapılan test veya testler, kimliklendirme, aşılama, tohumluk kontrolü, avlakların ve avcıların kontrolü, entegre idare ve kontrol sistemi kapsamında yapılan kontroller ve benzeri kontroller kapsamında olduğu belirtilecek (Belge Kontrolü, İzleme vb. gibi) aynı gün içerisinde kontrol tanımına girecek birden fazla iş veya işlem yürütülmüşse birlikte yazılacak (Denetim + Numune Alma vb. gibi).</span></p>

			<p style="text-align:justify"><span style="font-size:8pt">2) Kontrol Türünün Dayandığı Mevzuat: Kontrol türünün aşağıda belirtilen mevzuattan hangisi kapsamında yapıldığı Kanun numarası yazılarak belirtilecek (Örneğin, yürütülen kontrol görevi; 5996 sayılı Veteriner Hizmetleri, Bitki Sağlığı, Gıda ve Yem Kanunu kapsamında ise 5996 s. K. Yazılacak, Tarımda Kullanılan Gübrelerin Piyasa Gözetimi ve Denetimi Yönetmeliği kapsamında ise GGDY yazılacak.) Aynı gün içerisinde birden fazla yapılan kontrol görevinde her bir kontrol türünün dayanağı olan mevzuat ayrı ayrı yazılacak (Örneğin, 5996 s. K. + 1380 s. K.)</span></p>

			<p style="text-align:justify">&nbsp;</p>

			<p style="margin-left:0cm; text-align:justify"><span style="font-size:8pt">5996 s. K.: 5996 sayılı Veteriner Hizmetleri, Bitki Sağlığı, Gıda ve Yem Kanunu</span></p>

			<p style="margin-left:0cm; text-align:justify"><span style="font-size:8pt">1380 s. K.: 1380 sayılı Su Ürünleri Kanunu</span></p>

			<p style="margin-left:0cm; text-align:justify"><span style="font-size:8pt">4342 s. K.: 4342 sayılı Mera Kanunu</span></p>

			<p style="margin-left:0cm; text-align:justify"><span style="font-size:8pt">4733 s. K.: 4733 sayılı Tütün, Tütün Mamulleri ve Alkol Piyasasının Düzenlenmesine Dair Kanun</span></p>

			<p style="margin-left:0cm; text-align:justify"><span style="font-size:8pt">4915 s. K.: 4915 sayılı Kara Avcılığı Kanunu</span></p>

			<p style="margin-left:0cm; text-align:justify"><span style="font-size:8pt">5403 s. K.: 5403 sayılı Toprak Koruma ve Arazi Kullanımı Kanunu</span></p>

			<p style="margin-left:0cm; text-align:justify"><span style="font-size:8pt">5262 s. K.: 5262 sayılı Organik Tarım Kanunu</span></p>

			<p style="margin-left:0cm; text-align:justify"><span style="font-size:8pt">5488 s. K.: 5488 sayılı Tarım Kanunu</span></p>

			<p style="margin-left:0cm; text-align:justify"><span style="font-size:8pt">5553 s. K.: 5553 sayılı Tohumculuk Kanunu</span></p>

			<p style="margin-left:0cm; text-align:justify"><span style="font-size:8pt">GGDY&nbsp;&nbsp;&nbsp;&nbsp; : Tarımda Kullanılan Gübrelerin Piyasa Gözetimi ve Denetimi Yönetmeliği</span></p>

			<p style="margin-left:0cm; text-align:justify">&nbsp;</p>

			<p style="text-align:justify"><span style="font-size:8pt">3) Açıklama: Yapılan iş veya işlemle ilgili kısa bilgi (Kayıt Belgesi, Onay Belgesi, Avcılık Belgesi, Balıkçılık Belgesi, İhracat, İthalat, ÇKS, Destekleme vb. başvurusuna ait belge kontrolü yapıldı. Lezzet İşletmesi Denetimi yapıldı. Denetim sonrası veri girişi, cezai işlem vb. yazışmalar tamamlandı. Tosunlar hayvancılık işletmesi hayvan aşılaması yapıldı. vb. gibi).</span></p>

			<p style="text-align:justify"><span style="font-size:8pt">4) Saat Aralığı: Yapılan iş ve/veya işlemlerin başlangıç ve bitiş saati yazılacak.</span></p>
			</td>
		</tr>
	</tbody>
</table>`;

const URETICI = { puantaj, ekozel, arac, seyyar, liste };

function icmalUret(tur, ayar, gorevler, secenek) {
  const f = URETICI[tur];
  if (!f) throw new Error('Bilinmeyen icmal türü');
  if (tur === 'puantaj') secenek.bit = secenek.bas;
  const ayList = aylar(secenek.bas, secenek.bit);
  // Hariç günler (izin, rapor…) bütün icmallerde düşülür
  const haric = new Set(secenek.haric || []);
  const ayaGore = gorevler.filter(g => ayList.includes((g.tarih || '').slice(0, 7)) && !haric.has(g.tarih));
  // Seçilen kişinin (görevli personel ya da sürücü olarak) bulunduğu görevler; liste "tüm kişiler" ile hepsini alır
  const tumu = tur === 'liste' && secenek.tumKisiler;
  const ad = sade(ayar.personelAd);
  const kapsam = (tumu ? ayaGore : ayaGore.filter(g => sade(g.surucu) === ad || (g.personel || []).some(p => sade(p) === ad)))
    .sort((a, b) => a.tarih.localeCompare(b.tarih));
  return f(ayar, kapsam, secenek);
}

module.exports = { TURLER, icmalUret };
