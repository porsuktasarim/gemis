/* Görev İcmal – arayüz */
const $ = (s) => document.querySelector(s);
const api = async (url, opt = {}) => {
  const r = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opt });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.hata || r.statusText); }
  return r.json();
};
const tarihTR = (iso) => iso ? iso.split('-').reverse().join('.') : '';
const tarihISO = (tr) => { const m = /(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(tr || ''); return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : ''; };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const yerYaz = (yer) => (yer || []).map(g => [g.ilce, ...(g.mahalleler || [])].filter(Boolean).join('-')).join(', ');
const bildirim = new bootstrap.Toast($('#bildirim'), { delay: 3000 });
const bildir = (m) => { $('#bildirim .toast-body').textContent = m; bildirim.show(); };

const buAy = new Date().toISOString().slice(0, 7);
const gecenAy = (() => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 7); })();

// ---------- Sekmeler (sol menü) ----------
const SEKME_ADI = { gorevler: 'Görev Emirleri', icmaller: 'İcmaller', ayarlar: 'Ayarlar' };
function sekmeAc(ad) {
  document.querySelectorAll('.sidebar-menu [data-sekme]').forEach(x => x.classList.toggle('active', x.dataset.sekme === ad));
  document.querySelectorAll('section.sekme').forEach(s => { s.hidden = s.id !== `sekme-${ad}`; });
  $('#sayfaBaslik').textContent = SEKME_ADI[ad]; $('#sayfaYol').textContent = SEKME_ADI[ad];
  document.body.classList.remove('sidebar-open'); // mobilde menüyü kapat
  if (ad === 'ayarlar') ayarlariYukle();
}
document.querySelectorAll('[data-sekme]').forEach(b => b.addEventListener('click', (e) => { e.preventDefault(); sekmeAc(b.dataset.sekme); }));

// ---------- Tema ----------
$('#temaDegistir').addEventListener('click', (e) => {
  e.preventDefault();
  const yeni = document.documentElement.getAttribute('data-bs-theme') === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-bs-theme', yeni);
  try { localStorage.setItem('gemis-tema', yeni); } catch (err) { /* tarayıcı depolaması kapalı */ }
});

// Personel adı (özet kutuları ve üst çubuk için)
let personelAd = '';
async function personelYukle() {
  try { personelAd = (await api('/api/ayarlar')).personelAd || ''; } catch { personelAd = ''; }
  $('#ustPersonel').innerHTML = personelAd ? `<i class="bi bi-person-circle me-1"></i>${esc(personelAd)}` : '';
}

// ---------- Öneriler ----------
async function onerileriYukle() {
  const o = await api('/api/oneriler');
  $('#plakaListe').innerHTML = o.plakalar.map(p => `<option value="${esc(p)}">`).join('');
  const kisiler = [...new Set([...o.kisiler, ...o.suruculer])].sort((a, b) => a.localeCompare(b, 'tr'));
  $('#kisiListe').innerHTML = kisiler.map(p => `<option value="${esc(p)}">`).join('');
}

// ---------- Görev listesi ----------
$('#gorevAy').value = gecenAy;
$('#gorevAy').addEventListener('change', gorevleriYukle);

async function gorevleriYukle() {
  const liste = await api(`/api/gorevler?ay=${$('#gorevAy').value}`);
  const eksikMi = (g) => !g.yer?.length || !g.plaka || !g.surucu || !g.cikis || !g.donus;
  $('#ozToplam').textContent = liste.length;
  $('#ozBekleyen').textContent = liste.filter(g => !g.onayli).length;
  $('#ozSurucu').textContent = liste.filter(g => personelAd && (g.surucu || '').toLocaleLowerCase('tr') === personelAd.toLocaleLowerCase('tr')).length;
  $('#ozEksik').textContent = liste.filter(eksikMi).length;
  const bos = '<span class="eksik">—</span>';
  $('#gorevTablo').innerHTML = liste.length ? liste.map(g => `
    <tr data-id="${g._id}">
      <td class="text-nowrap ps-3">${tarihTR(g.tarih) || bos}</td>
      <td>${esc(yerYaz(g.yer)) || bos}</td>
      <td>${esc(g.surucu) || bos}</td>
      <td class="text-nowrap">${esc(g.plaka) || bos}</td>
      <td>${g.cikis || bos}</td><td>${g.donus || bos}</td>
      <td>${esc(g.belgeNo) || bos}</td>
      <td class="small">${esc((g.personel || []).join(', '))}</td>
      <td>${g.onayli ? '<span class="badge text-bg-success">Kontrol edildi</span>' : '<span class="badge text-bg-warning">Kontrol bekliyor</span>'}
          ${g.driveId ? '<i class="bi bi-google text-muted" title="Görüntü Drive\'da"></i>' : g.dosya ? '<i class="bi bi-image text-muted" title="Görüntü sunucuda"></i>' : '<i class="bi bi-image text-danger" title="Görüntü yok"></i>'}</td>
      <td><button class="btn btn-sm btn-link p-0"><i class="bi bi-pencil"></i></button></td>
    </tr>`).join('') : '<tr><td colspan="10" class="text-muted text-center py-4">Bu ay için görev emri yok. JPEG yükleyebilir ya da elle ekleyebilirsiniz.</td></tr>';
}
$('#gorevTablo').addEventListener('click', (e) => { const tr = e.target.closest('tr[data-id]'); if (tr) gorevAc(tr.dataset.id); });

// ---------- Yükleme ----------
$('#dosyaSec').addEventListener('change', async (e) => {
  const dosyalar = [...e.target.files];
  if (!dosyalar.length) return;
  const sonuc = [];
  for (let i = 0; i < dosyalar.length; i++) {
    $('#yukleDurum').innerHTML = `<span class="spinner-border spinner-border-sm"></span> OCR: ${i + 1}/${dosyalar.length} – ${esc(dosyalar[i].name)}`;
    const fd = new FormData(); fd.append('dosyalar', dosyalar[i]);
    try {
      const r = await fetch('/api/gorevler/yukle', { method: 'POST', body: fd });
      const j = await r.json(); if (!r.ok) throw new Error(j.hata);
      sonuc.push(...j);
    } catch (err) { sonuc.push({ dosya: dosyalar[i].name, durum: 'HATA: ' + err.message }); }
  }
  e.target.value = '';
  $('#yukleDurum').innerHTML = sonuc.map(s => `${esc(s.dosya)}: ${esc(s.durum)}${s.tarih ? ` (${tarihTR(s.tarih)})` : ''}`).join('<br>');
  const ilk = sonuc.find(s => s.tarih); if (ilk) $('#gorevAy').value = ilk.tarih.slice(0, 7);
  await gorevleriYukle(); onerileriYukle();
});

// ---------- Düzenleme ----------
const modal = new bootstrap.Modal($('#gorevModal'));
const form = $('#gorevForm');
let aktifGorev = null;

function formDoldur(g) {
  form._id.value = g._id || '';
  form.tarih.value = g.tarih || '';
  form.belgeNo.value = g.belgeNo || '';
  form.sayi.value = g.sayi || '';
  form.gorevTuru.value = g.gorevTuru || '4342 sayılı Mera Kanunu Uygulamaları';
  form.yerHam.value = g.yer?.length ? yerYaz(g.yer) : (g.yerHam || '');
  form.plaka.value = g.plaka || '';
  form.surucu.value = g.surucu || '';
  form.cikis.value = g.cikis || '';
  form.donus.value = g.donus || '';
  form.personel.value = (g.personel || []).join('\n');
  form.onayli.checked = !!g.onayli;
  $('#ocrMetin').textContent = g.ocrMetin || '';
  yerOnizle();
}

async function gorevAc(id) {
  aktifGorev = id ? await api(`/api/gorevler/${id}`) : { personel: [] };
  formDoldur(aktifGorev);
  const var_ = !!(aktifGorev.dosya || aktifGorev.driveId);
  $('#gorselKutu').hidden = !var_;
  if (var_) { const u = `/api/gorevler/${id}/gorsel?t=${Date.now()}`; $('#gorsel').src = u; $('#gorselAc').href = u; }
  $('#gorevSil').hidden = !id;
  modal.show();
}
$('#yeniGorev').addEventListener('click', () => gorevAc(null));
$('.gorsel-cerceve').addEventListener('click', (e) => e.currentTarget.classList.toggle('buyuk'));

function yerOnizle() {
  // Sunucudaki ayrıştırmanın basit önizlemesi
  $('#yerOnizleme').textContent = form.yerHam.value ? 'Kaydedilince ilçe/mahalle olarak ayrıştırılır.' : '';
}
form.yerHam.addEventListener('input', yerOnizle);

$('#kisiEkleBtn').addEventListener('click', () => {
  const ad = $('#kisiEkle').value.trim(); if (!ad) return;
  const l = form.personel.value.split('\n').map(s => s.trim()).filter(Boolean);
  if (!l.includes(ad)) l.push(ad);
  form.personel.value = l.join('\n'); $('#kisiEkle').value = '';
});

$('#ocrTekrar').addEventListener('click', async () => {
  if (!aktifGorev?._id) return;
  bildir('OCR çalışıyor…');
  const o = await api(`/api/gorevler/${aktifGorev._id}/ocr`, { method: 'POST' });
  // Yalnızca boş alanları doldur
  if (!form.tarih.value && o.tarih) form.tarih.value = o.tarih;
  if (!form.sayi.value && o.sayi) form.sayi.value = o.sayi;
  if (!form.yerHam.value && o.yerHam) form.yerHam.value = o.yerHam;
  if (!form.plaka.value && o.plaka) form.plaka.value = o.plaka;
  if (!form.belgeNo.value && o.belgeNo) form.belgeNo.value = o.belgeNo;
  if (!form.cikis.value && o.cikis) form.cikis.value = o.cikis;
  if (!form.donus.value && o.donus) form.donus.value = o.donus;
  if (!form.personel.value.trim() && o.personel?.length) form.personel.value = o.personel.join('\n');
  $('#ocrMetin').textContent = o.ocrMetin || '';
  bildir('Boş alanlar OCR sonucuyla dolduruldu.');
});

$('#gorevKaydet').addEventListener('click', async () => {
  if (!form.reportValidity()) return;
  const veri = {
    tarih: form.tarih.value, belgeNo: form.belgeNo.value, sayi: form.sayi.value, gorevTuru: form.gorevTuru.value,
    yerHam: form.yerHam.value, plaka: form.plaka.value, surucu: form.surucu.value,
    cikis: form.cikis.value, donus: form.donus.value,
    personel: form.personel.value.split('\n').map(s => s.trim()).filter(Boolean), onayli: form.onayli.checked
  };
  const id = form._id.value;
  await api(id ? `/api/gorevler/${id}` : '/api/gorevler', { method: id ? 'PUT' : 'POST', body: JSON.stringify(veri) });
  modal.hide(); bildir('Kaydedildi.');
  if (veri.tarih) $('#gorevAy').value = veri.tarih.slice(0, 7);
  gorevleriYukle(); onerileriYukle();
});

$('#gorevSil').addEventListener('click', async () => {
  if (!aktifGorev?._id || !confirm('Bu görev emri ve görüntüsü silinsin mi?')) return;
  await api(`/api/gorevler/${aktifGorev._id}`, { method: 'DELETE' });
  modal.hide(); gorevleriYukle();
});

// ---------- İcmaller ----------
let sonIcmal = null;
(async () => {
  const turler = await api('/api/turler');
  $('#icmalTur').innerHTML = Object.entries(turler).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('');
  turDegisti();
})();
$('#icmalBas').value = gecenAy; $('#icmalBit').value = gecenAy;
$('#icmalBas').addEventListener('change', () => { if ($('#icmalBit').value < $('#icmalBas').value) $('#icmalBit').value = $('#icmalBas').value; });
// Personel seçimi: "Ad SOYAD - Görevi"; görev listesinde "tüm kişiler" de seçilebilir
async function kisiSecimiYukle() {
  const kisiler = await api('/api/kisiler');
  const onceki = $('#icmalKisi').value;
  $('#icmalKisi').innerHTML = '<option value="*" data-tum>— Tüm kişiler —</option>' +
    kisiler.map(k => `<option value="${esc(k.ad)}">${esc(k.ad)} - ${esc(k.unvan || 'görevi girilmemiş')}</option>`).join('');
  $('#icmalKisi').value = [...$('#icmalKisi').options].some(o => o.value === onceki) ? onceki : (personelAd || kisiler[0]?.ad || '');
  turDegisti();
}

function turDegisti() {
  const t = $('#icmalTur').value;
  const tum = $('#icmalKisi option[data-tum]');
  if (tum) {
    tum.hidden = t !== 'liste';
    if (t !== 'liste' && $('#icmalKisi').value === '*') $('#icmalKisi').value = personelAd || $('#icmalKisi').options[1]?.value || '';
  }
  $('#bitKutu').hidden = t === 'puantaj';
  $('#haricKutu').hidden = t !== 'puantaj';
  $('#donemKutu').hidden = t !== 'seyyar';
}
$('#icmalTur').addEventListener('change', turDegisti);

function sorgu() {
  const t = $('#icmalTur').value;
  const p = new URLSearchParams({ bas: $('#icmalBas').value, bit: t === 'puantaj' ? $('#icmalBas').value : $('#icmalBit').value, kisi: $('#icmalKisi').value || '' });
  const haric = $('#icmalHaric').value.split(/[,;\s]+/).map(tarihISO).filter(Boolean);
  if (t === 'puantaj' && haric.length) p.set('haric', haric.join(','));
  if (t === 'seyyar' && $('#icmalDonem').value.trim()) p.set('donem', $('#icmalDonem').value.trim());
  return `${t}?${p}`;
}

$('#icmalOlustur').addEventListener('click', async () => {
  try {
    const q = sorgu();
    sonIcmal = await api(`/api/icmal/${q}`);
    const [tur, params] = q.split('?');
    $('#indirXlsx').href = `/api/icmal/${tur}/xlsx?${params}`;
    $('#indirHtml').href = `/api/icmal/${tur}/html?${params}`;
    $('#indirPdf').href = `/api/icmal/${tur}/pdf?${params}`;
    $('#indirPdf').classList.toggle('disabled', !sonIcmal.gorselSayisi);
    $('#icmalBilgi').textContent = `${sonIcmal.excel.satirlar.length} satır · ${sonIcmal.gorevSayisi} görev · ${sonIcmal.gorselSayisi} görüntü`;
    $('#icmalIslem').hidden = false;
    $('#icmalUyari').innerHTML = sonIcmal.uyarilar.length
      ? `<div class="alert alert-warning py-2 small"><strong>Kontrol edilecekler:</strong><ul class="mb-0">${sonIcmal.uyarilar.map(u => `<li>${esc(u)}</li>`).join('')}</ul></div>` : '';
    $('#onizleme').srcdoc = `<!doctype html><meta charset="utf-8"><body style="font-family:'Times New Roman';margin:16px">${sonIcmal.html}</body>`;
  } catch (e) { bildir(e.message); }
});

// Panoya kopyalama: güvenli bağlam (localhost/https) yoksa eski yöntem
async function panoyaYaz(metin, html) {
  if (navigator.clipboard && window.isSecureContext) {
    if (html && window.ClipboardItem) {
      await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([metin], { type: 'text/plain' }) })]);
    } else await navigator.clipboard.writeText(metin);
    return;
  }
  if (html) {
    const div = document.createElement('div'); div.innerHTML = html; div.style.position = 'fixed'; div.style.left = '-9999px';
    document.body.appendChild(div);
    const r = document.createRange(); r.selectNodeContents(div);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    document.execCommand('copy'); s.removeAllRanges(); div.remove(); return;
  }
  const ta = document.createElement('textarea'); ta.value = metin; ta.style.position = 'fixed'; ta.style.left = '-9999px';
  document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
}

$('#kopyalaHtml').addEventListener('click', async () => { await panoyaYaz(sonIcmal.html); bildir('HTML kaynağı panoya kopyalandı.'); });
$('#kopyalaTablo').addEventListener('click', async () => {
  const { basliklar, satirlar } = sonIcmal.excel;
  const tsv = [basliklar, ...satirlar].map(r => r.map(c => String(c ?? '').replace(/\t|\n/g, ' ')).join('\t')).join('\n');
  const html = `<table>${[basliklar, ...satirlar].map((r, i) => `<tr>${r.map(c => i ? `<td style="mso-number-format:'\\@'">${esc(c)}</td>` : `<th>${esc(c)}</th>`).join('')}</tr>`).join('')}</table>`;
  await panoyaYaz(tsv, html);
  bildir('Tablo kopyalandı; Excel\'de bir hücreye yapıştırabilirsiniz.');
});

// ---------- Ayarlar ----------
const af = $('#ayarForm');
async function ayarlariYukle() {
  const [a, kisiler] = await Promise.all([api('/api/ayarlar'), api('/api/kisiler')]);
  for (const el of af.elements) {
    if (!el.name || el.name === 'tatiller' || el.name === 'mahalliDisi') continue;
    if (el.type === 'checkbox') { el.checked = !!a[el.name]; continue; }
    el.value = Array.isArray(a[el.name]) ? a[el.name].join(', ') : (a[el.name] ?? '');
  }
  af.tatiller.value = (a.tatiller || []).sort((x, y) => x.tarih.localeCompare(y.tarih))
    .map(t => [tarihTR(t.tarih), t.ad, t.yarim ? 'yarım' : ''].filter(Boolean).join('; ')).join('\n');
  af.mahalliDisi.value = (a.mahalliDisi || []).map(m => `${m.ilce}: ${m.mahalleler.join(', ')}`).join('\n');
  $('#kisilerAlan').value = kisiler.map(k => {
    const p = [k.ad, k.unvan || '', k.unvanCetvel || '', k.unvanSeyyar || ''];
    while (p.length > 1 && !p[p.length - 1]) p.pop();
    return p.join('; ');
  }).join('\n');
  driveDurumYukle();
}
af.addEventListener('submit', async (e) => {
  e.preventDefault();
  const veri = {};
  for (const el of af.elements) if (el.name && el.name !== 'tatiller' && el.name !== 'mahalliDisi') veri[el.name] = el.type === 'checkbox' ? el.checked : el.value;
  veri.driveOtoTaraDk = Number(veri.driveOtoTaraDk) || 0;
  veri.ocrHaricAdlar = af.ocrHaricAdlar.value.split(',').map(s => s.trim()).filter(Boolean);
  veri.tatiller = af.tatiller.value.split('\n').map(s => s.split(';').map(x => x.trim())).filter(p => tarihISO(p[0]))
    .map(p => ({ tarih: tarihISO(p[0]), ad: p[1] || '', yarim: /yar[ıi]m/i.test(p[2] || '') }));
  veri.mahalliDisi = af.mahalliDisi.value.split('\n').map(s => s.split(':')).filter(p => p[0].trim() && p[1])
    .map(p => ({ ilce: p[0].trim(), mahalleler: p.slice(1).join(':').split(',').map(x => x.trim()).filter(Boolean) }));
  const kisiler = $('#kisilerAlan').value.split('\n').map(s => s.split(';').map(x => x.trim())).filter(p => p[0])
    .map(p => ({ ad: p[0], unvan: p[1] || '', unvanCetvel: p[2] || '', unvanSeyyar: p[3] || '' }));
  await api('/api/ayarlar', { method: 'PUT', body: JSON.stringify(veri) });
  await api('/api/kisiler', { method: 'PUT', body: JSON.stringify(kisiler) });
  await personelYukle(); gorevleriYukle(); kisiSecimiYukle();
  $('#ayarDurum').textContent = 'Kaydedildi.'; setTimeout(() => { $('#ayarDurum').textContent = ''; }, 2500);
  onerileriYukle();
});
$('#ornekVeri').addEventListener('click', async () => {
  const r = await api('/api/ornek-veri', { method: 'POST' });
  bildir(`${r.eklenen} görev eklendi. Görüntüleri yüklediğinizde aynı tarihli kayda bağlanır.`);
  $('#gorevAy').value = '2026-10'; gorevleriYukle(); onerileriYukle();
});

// ---------- Google Drive ----------
async function driveDurumYukle() {
  const d = await api('/api/drive/durum');
  $('#driveTara').hidden = !(d.tanimli && d.klasor);
  $('#driveHesap').innerHTML = d.tanimli
    ? `Hizmet hesabı: <code>${esc(d.eposta)}</code><br><span class="text-muted">Drive klasörünü bu adrese "Görüntüleyen" olarak paylaşınız.</span>`
    : '<span class="text-danger">Google hizmet hesabı tanımlı değil.</span> <span class="text-muted">Sunucuda GOOGLE_SERVICE_ACCOUNT_JSON ortam değişkeni verilmelidir (README).</span>';
  return d;
}

$('#driveTest').addEventListener('click', async () => {
  $('#driveTestSonuc').textContent = 'Deneniyor…';
  try {
    const r = await api('/api/drive/test', { method: 'POST', body: JSON.stringify({ klasor: af.driveKlasor.value }) });
    $('#driveTestSonuc').innerHTML = `<span class="text-success">Bağlantı tamam:</span> "${esc(r.ad)}" klasöründe ${r.gorselSayisi} görüntü var.`;
  } catch (e) { $('#driveTestSonuc').innerHTML = `<span class="text-danger">${esc(e.message)}</span>`; }
});

$('#driveTara').addEventListener('click', async () => {
  const btn = $('#driveTara'); btn.disabled = true;
  $('#yukleDurum').innerHTML = '<span class="spinner-border spinner-border-sm"></span> Drive taranıyor, yeni görüntüler OCR\'dan geçiriliyor…';
  try {
    const o = await api('/api/drive/tara', { method: 'POST' });
    const satir = [`Drive: ${o.bulunan} görüntü bulundu, ${o.yeni} yeni kayıt, ${o.baglanan} mevcut kayda bağlandı.`];
    o.kayitlar.forEach(k => satir.push(`${esc(k.dosya)}: ${esc(k.durum)}${k.tarih ? ` (${tarihTR(k.tarih)})` : ''}`));
    o.hata.forEach(h => satir.push(`<span class="text-danger">${esc(h)}</span>`));
    $('#yukleDurum').innerHTML = satir.join('<br>');
    const ilk = o.kayitlar.find(k => k.tarih); if (ilk) $('#gorevAy').value = ilk.tarih.slice(0, 7);
    await gorevleriYukle(); onerileriYukle();
  } catch (e) { $('#yukleDurum').innerHTML = `<span class="text-danger">${esc(e.message)}</span>`; }
  btn.disabled = false;
});

personelYukle().then(() => { gorevleriYukle(); kisiSecimiYukle(); }); onerileriYukle(); driveDurumYukle();
