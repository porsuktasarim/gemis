/* Görev İcmal – arayüz */
const $ = (s) => document.querySelector(s);
const api = async (url, opt = {}) => {
  const r = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opt });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.hata || r.statusText); }
  return r.json();
};
// Beklenmeyen arayüz hatalarını sayfanın üstünde göster (sessizce boş ekran kalmasın)
function arayuzHatasi(mesaj) {
  const el = document.getElementById('sistemUyari');
  if (!el) return;
  el.innerHTML = `<i class="bi bi-bug me-1"></i> Arayüz hatası: ${String(mesaj).replace(/[<>&]/g, '')}. Sayfayı yenileyiniz (Ctrl+F5); sürerse bu mesajı bildiriniz.`;
  el.hidden = false;
}
window.addEventListener('error', (e) => arayuzHatasi(e.message));
window.addEventListener('unhandledrejection', (e) => arayuzHatasi(e.reason?.message || e.reason));
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

// Son seçilen personel (icmaller) tarayıcıda hatırlanır
const sonKisiOku = () => { try { return localStorage.getItem('gemis-kisi') || ''; } catch { return ''; } };
const sonKisiYaz = (v) => { try { localStorage.setItem('gemis-kisi', v); } catch { /* depolama kapalı */ } };

// ---------- Öneriler ----------
// Kişi ve plaka listeleri (öneriler, formdaki görev/aynı kişi bilgisi)
let kisiListesi = [], plakaListesi = [];
const sadeAd = (s) => (s || '').toLocaleLowerCase('tr-TR').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ı/g, 'i').replace(/[^a-z0-9]/g, '');
const kisiBul = (ad) => kisiListesi.find(k => sadeAd(k.ad) === sadeAd(ad));

async function onerileriYukle() {
  const o = await api('/api/oneriler');
  kisiListesi = o.kisiler; plakaListesi = o.plakalar;
  $('#plakaListe').innerHTML = o.plakalar.map(p => `<option value="${esc(p.plaka)}"${p.aciklama ? ` label="${esc(p.aciklama)}"` : ''}>`).join('');
  // Kişi önerisi tek kayıttan: değer "Ad SOYAD", yanında görevi
  $('#kisiListe').innerHTML = o.kisiler.slice().sort((a, b) => a.ad.localeCompare(b.ad, 'tr'))
    .map(k => `<option value="${esc(k.ad)}"${k.unvan ? ` label="${esc(k.unvan)}"` : ''}>`).join('');
  // Sürücü önerisi: herkes "Şoför" olarak görünür; kadrosu şoför olanlar önce
  const soforMu = (k) => /şoför|sofor/i.test(k.unvan || '');
  $('#surucuListe').innerHTML = o.kisiler.slice()
    .sort((a, b) => (soforMu(b) - soforMu(a)) || a.ad.localeCompare(b.ad, 'tr'))
    .map(k => `<option value="${esc(k.ad)}" label="Şoför">`).join('');
}

// ---------- Görev listesi ----------
$('#gorevAy').value = gecenAy;
$('#gorevAy').addEventListener('change', gorevleriYukle);

// Element bulunamasa bile hata vermeyen yazım (sayfa ile script sürümü uyuşmasa da liste çizilsin)
const yaz = (sel, v) => { const el = $(sel); if (el) el.textContent = v; };

async function gorevleriYukle() {
  const tumu = $('#gorevTumu')?.checked;
  let liste;
  try { liste = await api(`/api/gorevler?ay=${tumu ? 'tum' : $('#gorevAy').value}`); }
  catch (e) {
    $('#gorevTablo').innerHTML = `<tr><td colspan="10" class="text-danger text-center py-4">Görev emirleri alınamadı: ${esc(e.message)}</td></tr>`;
    return;
  }
  const bos = '<span class="eksik">—</span>';
  const satir = (g) => {
    try {
      return `
    <tr data-id="${g._id}">
      <td class="text-nowrap ps-3">${g.tarih ? tarihTR(String(g.tarih)) : '<span class="badge text-bg-danger">Tarih yok</span>'}</td>
      <td>${esc(yerYaz(g.yer)) || esc(g.yerHam) || bos}</td>
      <td>${esc(g.surucu) || bos}</td>
      <td class="text-nowrap">${esc(g.plaka) || bos}</td>
      <td>${esc(g.cikis) || bos}</td><td>${esc(g.donus) || bos}</td>
      <td>${esc(g.belgeNo) || bos}</td>
      <td class="small">${esc((Array.isArray(g.personel) ? g.personel : []).join(', '))}</td>
      <td>${g.ornek ? '<span class="badge text-bg-secondary">Örnek</span> ' : ''}${g.onayli ? '<span class="badge text-bg-success">Kontrol edildi</span>' : '<span class="badge text-bg-warning">Kontrol bekliyor</span>'}
          ${g.driveId ? '<i class="bi bi-google text-muted" title="Görüntü Drive\'da"></i>' : g.dosya ? '<i class="bi bi-image text-muted" title="Görüntü sunucuda"></i>' : '<i class="bi bi-image text-danger" title="Görüntü yok"></i>'}</td>
      <td><button class="btn btn-sm btn-link p-0"><i class="bi bi-pencil"></i></button></td>
    </tr>`;
    } catch (e) {
      return `<tr data-id="${g._id}"><td colspan="10" class="text-danger">Bu kayıt gösterilemedi (${esc(e.message)}); açıp düzeltebilirsiniz.</td></tr>`;
    }
  };
  // Önce tablo, sonra özet kutuları
  $('#gorevTablo').innerHTML = liste.length ? liste.map(satir).join('')
    : `<tr><td colspan="10" class="text-muted text-center py-4">${tumu ? 'Hiç görev emri yok.' : 'Bu ay için görev emri yok. JPEG yükleyebilir, elle ekleyebilir ya da "Tüm aylar"ı açabilirsiniz.'}</td></tr>`;
  const eksikMi = (g) => !g.yer?.length || !g.plaka || !g.surucu || !g.cikis || !g.donus;
  yaz('#ozToplam', liste.length);
  yaz('#ozBekleyen', liste.filter(g => !g.onayli).length);
  yaz('#ozBelgeNo', liste.filter(g => !/^\d{6}$/.test(g.belgeNo || '')).length);
  yaz('#ozEksik', liste.filter(eksikMi).length);
}
$('#gorevTumu')?.addEventListener('change', gorevleriYukle);
$('#gorevTablo').addEventListener('click', (e) => { const tr = e.target.closest('tr[data-id]'); if (tr) gorevAc(tr.dataset.id); });

// ---------- Yükleme ----------
// Bu oturumda yüklenen dosyalar (kayıt kimliği → dosya). Sunucu görüntüyü saklamasa da
// düzenleme penceresinde gösterilip seçerek okunabilsin diye yalnızca tarayıcı belleğinde tutulur.
const oturumDosyalari = new Map();
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
      j.forEach(k => { if (k.id) oturumDosyalari.set(String(k.id), dosyalar[i]); });
      sonuc.push(...j);
    } catch (err) { sonuc.push({ dosya: dosyalar[i].name, durum: 'HATA: ' + err.message }); }
  }
  e.target.value = '';
  $('#yukleDurum').innerHTML = sonuc.map(s => `${esc(s.dosya)}: ${esc(s.durum)}${s.tarih ? ` (${tarihTR(s.tarih)})` : ''}`).join('<br>');
  const ilk = sonuc.find(s => s.tarih); if (ilk) $('#gorevAy').value = ilk.tarih.slice(0, 7);
  // Farklı aylara düşen kayıt varsa hepsini göster
  const aylar_ = new Set(sonuc.filter(s => s.tarih).map(s => s.tarih.slice(0, 7)));
  if (aylar_.size > 1 && $('#gorevTumu')) $('#gorevTumu').checked = true;
  await gorevleriYukle(); onerileriYukle();
});

// ---------- Düzenleme ----------
const modal = new bootstrap.Modal($('#gorevModal'));
const form = $('#gorevForm');
let aktifGorev = null;

// Formda her kişinin listedeki görevi; sürücü görevlilerden biriyse "aynı kişi"
function kisiBilgisiGoster() {
  const adlar = form.personel.value.split('\n').map(s => s.trim()).filter(Boolean);
  const etiket = (ad) => {
    const k = kisiBul(ad);
    if (!k) return '<span class="badge text-bg-warning">listede yok</span>';
    return k.unvan ? `<span class="badge text-bg-light border">${esc(k.unvan)}</span>` : '<span class="badge text-bg-light border">görevi girilmemiş</span>';
  };
  const sur = form.surucu.value.trim();
  $('#personelBilgi').innerHTML = adlar.map(ad => {
    const k = kisiBul(ad);
    const yazim = k && k.ad !== ad ? ` <span class="text-body-secondary">→ ${esc(k.ad)}</span>` : '';
    const ayni = sur && sadeAd(sur) === sadeAd(ad) ? ' <span class="badge text-bg-info">aynı zamanda sürücü</span>' : '';
    return `<li><i class="bi bi-person"></i> ${esc(ad)}${yazim} ${etiket(ad)}${ayni}</li>`;
  }).join('');
  if (!sur) { $('#surucuBilgi').innerHTML = ''; }
  else {
    const k = kisiBul(sur);
    const gorevli = adlar.some(a => sadeAd(a) === sadeAd(sur));
    // Sürücü alanında kadro görevi değil, bu görevdeki rolü yazılır: Şoför
    $('#surucuBilgi').innerHTML = `<span class="badge text-bg-light border">Şoför</span>${k ? '' : ' <span class="badge text-bg-warning">listede yok</span>'}${gorevli ? ' <span class="badge text-bg-info">aynı zamanda görevli</span>' : ''}${k && k.ad !== sur ? ` <span class="text-body-secondary">→ ${esc(k.ad)}</span>` : ''}`;
  }
  const p = form.plaka.value.trim();
  const pk = p && plakaListesi.find(x => sadeAd(x.plaka) === sadeAd(p));
  $('#plakaBilgi').innerHTML = !p ? '' : pk ? `<span class="badge text-bg-light border">listede${pk.aciklama ? ': ' + esc(pk.aciklama) : ''}</span>` : '<span class="badge text-bg-warning">listede yok</span>';
}
['personel', 'surucu', 'plaka'].forEach(n => form[n].addEventListener('input', kisiBilgisiGoster));
// Plaka boşluksuz ve büyük harfle yazılır (34ABC2159)
form.plaka.addEventListener('change', () => { form.plaka.value = form.plaka.value.toLocaleUpperCase('tr-TR').replace(/[^0-9A-ZÇĞİÖŞÜ]/g, ''); kisiBilgisiGoster(); });

function formDoldur(g) {
  form._id.value = g._id || '';
  form.tarih.value = g.tarih || '';
  form.belgeNo.value = g.belgeNo || '';
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
  kisiBilgisiGoster();
}

async function gorevAc(id) {
  aktifGorev = id ? await api(`/api/gorevler/${id}`) : { personel: [] };
  formDoldur(aktifGorev);
  aktifYerelDosya = id ? oturumDosyalari.get(String(id)) || null : null;
  if (aktifGorev.dosya || aktifGorev.driveId) gorselGoster(`/api/gorevler/${id}/gorsel?t=${Date.now()}`, true);
  else if (aktifYerelDosya) gorselGoster(URL.createObjectURL(aktifYerelDosya), false);
  else gorselGoster(null);
  secimAlaniSec(null);
  $('#gorevSil').hidden = !id;
  modal.show();
}
$('#yeniGorev').addEventListener('click', () => gorevAc(null));

// ---------- Görüntü ve seçerek okuma ----------
let aktifYerelDosya = null;   // sunucuda görüntüsü olmayan kayıt için bilgisayardan açılan dosya
let sunucuGorseli = false;
let yerelUrl = null;

function gorselGoster(url, sunucudan) {
  if (yerelUrl && yerelUrl !== url) { URL.revokeObjectURL(yerelUrl); yerelUrl = null; }
  const var_ = !!url;
  sunucuGorseli = var_ && sunucudan;
  if (var_ && !sunucudan) yerelUrl = url;
  $('#gorselCerceve').hidden = !var_;
  $('#secimAraclari').hidden = !var_;
  $('#gorselBos').hidden = var_;
  $('#gorselAc').hidden = !var_;
  $('#ocrTekrar').hidden = !var_;
  $('#gorselCerceve').classList.remove('buyuk');
  if (var_) { $('#gorsel').src = url; $('#gorselAc').href = url; } else $('#gorsel').removeAttribute('src');
}

$('#yerelGorsel').addEventListener('change', (e) => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  aktifYerelDosya = f;
  if (aktifGorev?._id) oturumDosyalari.set(String(aktifGorev._id), f);
  gorselGoster(URL.createObjectURL(f), false);
});

$('#gorselBuyut').addEventListener('click', () => {
  const c = $('#gorselCerceve'); c.classList.toggle('buyuk');
  $('#gorselBuyut i').className = c.classList.contains('buyuk') ? 'bi bi-zoom-out' : 'bi bi-zoom-in';
});

const ALAN_ADI = { belgeNo: 'Belge no', yerHam: 'Gideceği yer', personel: 'Personel', surucu: 'Sürücü', plaka: 'Plaka', cikis: 'Çıkış saati', donus: 'Dönüş saati' };
let secimAlani = null;
function secimAlaniSec(alan) {
  secimAlani = alan;
  document.querySelectorAll('#secimAraclari [data-alan]').forEach(b => b.classList.toggle('active', b.dataset.alan === alan));
  $('#gorselCerceve').classList.toggle('secim', !!alan);
  $('#secimIpucu').textContent = alan
    ? `${ALAN_ADI[alan]}: görüntüde bu alanın yazılı olduğu bölgeyi çerçeveleyiniz.`
    : 'Bir alan seçip görüntüde o alanın yazılı olduğu bölgeyi fareyle (dokunmatik ekranda parmakla) çerçeveleyiniz.';
}
document.querySelectorAll('#secimAraclari [data-alan]').forEach(b => b.addEventListener('click', () => {
  secimAlaniSec(secimAlani === b.dataset.alan ? null : b.dataset.alan);
}));

// Çerçeveleme: koordinatlar görüntünün ekrandaki boyutuna göre alınır, gerçek piksele çevrilir
(() => {
  const ic = $('.gorsel-ic'), img = $('#gorsel'), kutu = $('#secimKutu');
  let bas = null;
  const konum = (e) => { const r = img.getBoundingClientRect(); return { x: Math.max(0, Math.min(r.width, e.clientX - r.left)), y: Math.max(0, Math.min(r.height, e.clientY - r.top)) }; };
  const ciz = (a, b) => {
    Object.assign(kutu.style, { left: `${Math.min(a.x, b.x)}px`, top: `${Math.min(a.y, b.y)}px`, width: `${Math.abs(a.x - b.x)}px`, height: `${Math.abs(a.y - b.y)}px` });
  };
  ic.addEventListener('pointerdown', (e) => {
    if (!secimAlani || !img.naturalWidth) return;
    e.preventDefault(); ic.setPointerCapture(e.pointerId);
    bas = konum(e); kutu.hidden = false; ciz(bas, bas);
  });
  ic.addEventListener('pointermove', (e) => { if (bas) ciz(bas, konum(e)); });
  const bitir = async (e) => {
    if (!bas) return;
    const son = konum(e), a = bas; bas = null;
    const w = Math.abs(a.x - son.x), h = Math.abs(a.y - son.y);
    if (w < 8 || h < 6) { kutu.hidden = true; return; }
    const olcek = img.naturalWidth / img.getBoundingClientRect().width;
    await secimOku(secimAlani, Math.min(a.x, son.x) * olcek, Math.min(a.y, son.y) * olcek, w * olcek, h * olcek);
    kutu.hidden = true;
  };
  ic.addEventListener('pointerup', bitir);
  ic.addEventListener('pointercancel', () => { bas = null; kutu.hidden = true; });
})();

async function secimOku(alan, x, y, w, h) {
  const img = $('#gorsel');
  const tuval = document.createElement('canvas');
  tuval.width = Math.round(w); tuval.height = Math.round(h);
  tuval.getContext('2d').drawImage(img, Math.round(x), Math.round(y), Math.round(w), Math.round(h), 0, 0, tuval.width, tuval.height);
  const parca = await new Promise(r => tuval.toBlob(r, 'image/png'));
  const fd = new FormData(); fd.append('alan', alan); fd.append('parca', parca, 'parca.png');
  $('#secimIpucu').innerHTML = `<span class="spinner-border spinner-border-sm"></span> ${ALAN_ADI[alan]} okunuyor…`;
  try {
    const r = await fetch('/api/ocr/secim', { method: 'POST', body: fd });
    const j = await r.json(); if (!r.ok) throw new Error(j.hata);
    const alanEl = form[alan];
    const dolu = Array.isArray(j.deger) ? j.deger.length : j.deger;
    if (dolu) {
      if (alan === 'personel') {
        const l = form.personel.value.split('\n').map(s => s.trim()).filter(Boolean);
        j.deger.forEach(ad => { if (!l.includes(ad)) l.push(ad); });
        form.personel.value = l.join('\n');
      } else alanEl.value = j.deger;
      if (alan === 'yerHam') yerOnizle();
      kisiBilgisiGoster();
      alanEl.classList.add('is-valid'); setTimeout(() => alanEl.classList.remove('is-valid'), 2500);
      $('#secimIpucu').innerHTML = `<span class="text-success"><i class="bi bi-check-circle"></i> ${ALAN_ADI[alan]}: ${esc(Array.isArray(j.deger) ? j.deger.join(', ') : j.deger)}</span>`;
    } else {
      alanEl.focus();
      $('#secimIpucu').innerHTML = `<span class="text-warning-emphasis"><i class="bi bi-exclamation-triangle"></i> ${ALAN_ADI[alan]} güvenilir okunamadı${j.ham ? ` (okunan: "${esc(j.ham.replace(/\s+/g, ' ').slice(0, 40))}")` : ''}; alanı elle yazınız.</span>`;
    }
  } catch (err) { $('#secimIpucu').innerHTML = `<span class="text-danger">${esc(err.message)}</span>`; }
}

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
  kisiBilgisiGoster();
});

$('#ocrTekrar').addEventListener('click', async () => {
  bildir('OCR çalışıyor…');
  let o;
  if (sunucuGorseli && aktifGorev?._id) o = await api(`/api/gorevler/${aktifGorev._id}/ocr`, { method: 'POST' });
  else if (aktifYerelDosya) {
    const fd = new FormData(); fd.append('dosya', aktifYerelDosya);
    const r = await fetch('/api/ocr/tam', { method: 'POST', body: fd });
    o = await r.json(); if (!r.ok) { bildir(o.hata || 'OCR başarısız'); return; }
  } else { bildir('Görüntü yok.'); return; }
  // Yalnızca boş alanları doldur
  if (!form.tarih.value && o.tarih) form.tarih.value = o.tarih;
  if (!form.yerHam.value && o.yerHam) form.yerHam.value = o.yerHam;
  if (!form.plaka.value && o.plaka) form.plaka.value = o.plaka;
  if (!form.belgeNo.value && o.belgeNo) form.belgeNo.value = o.belgeNo;
  if (!form.cikis.value && o.cikis) form.cikis.value = o.cikis;
  if (!form.donus.value && o.donus) form.donus.value = o.donus;
  if (!form.personel.value.trim() && o.personel?.length) form.personel.value = o.personel.join('\n');
  $('#ocrMetin').textContent = o.ocrMetin || '';
  kisiBilgisiGoster();
  bildir('Boş alanlar OCR sonucuyla dolduruldu.');
});

$('#gorevKaydet').addEventListener('click', async () => {
  if (!form.reportValidity()) return;
  const veri = {
    tarih: form.tarih.value, belgeNo: form.belgeNo.value, gorevTuru: form.gorevTuru.value,
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
  const tercih = onceki || sonKisiOku();
  $('#icmalKisi').value = [...$('#icmalKisi').options].some(o => o.value === tercih) ? tercih : (kisiler[0]?.ad || '');
  turDegisti();
}

function turDegisti() {
  const t = $('#icmalTur').value;
  const tum = $('#icmalKisi option[data-tum]');
  if (tum) {
    tum.hidden = t !== 'liste';
    if (t !== 'liste' && $('#icmalKisi').value === '*') $('#icmalKisi').value = $('#icmalKisi').options[1]?.value || '';
  }
  // Bitiş ayı yalnızca çok aylık hazırlanan cetvellerde
  $('#bitKutu').hidden = !['arac', 'seyyar', 'liste'].includes(t);
  $('#donemKutu').hidden = t !== 'seyyar';
}
$('#icmalTur').addEventListener('change', turDegisti);
$('#icmalKisi').addEventListener('change', () => sonKisiYaz($('#icmalKisi').value));

function sorgu() {
  const t = $('#icmalTur').value;
  const cokAylik = ['arac', 'seyyar', 'liste'].includes(t);
  const bas = $('#icmalBas').value, bit = cokAylik && $('#icmalBit').value >= bas ? $('#icmalBit').value : bas;
  const p = new URLSearchParams({ bas, bit, kisi: $('#icmalKisi').value || '' });
  const haric = $('#icmalHaric').value.split(/[,;\s]+/).map(tarihISO).filter(Boolean);
  if (haric.length) p.set('haric', haric.join(','));
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
  const [a, kisiler, plakalar] = await Promise.all([api('/api/ayarlar'), api('/api/kisiler'), api('/api/plakalar')]);
  $('#plakalarAlan').value = plakalar.map(p => [p.plaka, p.aciklama].filter(Boolean).join('; ')).join('\n');
  for (const el of af.elements) {
    if (!el.name || el.name === 'tatiller' || el.name === 'mahalliDisi') continue;
    if (el.type === 'checkbox') { el.checked = !!a[el.name]; continue; }
    el.value = Array.isArray(a[el.name]) ? a[el.name].join(', ') : (a[el.name] ?? '');
  }
  af.tatiller.value = (a.tatiller || []).sort((x, y) => x.tarih.localeCompare(y.tarih))
    .map(t => [tarihTR(t.tarih), t.ad, t.yarim ? 'yarım' : ''].filter(Boolean).join('; ')).join('\n');
  af.mahalliDisi.value = (a.mahalliDisi || []).map(m => `${m.ilce}: ${m.mahalleler.join(', ')}`).join('\n');
  $('#kisilerAlan').value = kisiler.map(k => {
    const p = [k.ad, k.unvan || '', k.unvanCetvel || k.unvanSeyyar || ''];
    while (p.length > 1 && !p[p.length - 1]) p.pop();
    return p.join('; ');
  }).join('\n');
  driveDurumYukle();
  api('/api/sistem').then(d => {
    const e = d.elyazisi || {};
    $('#elyazisiDurum').innerHTML = e.acik
      ? `<span class="text-success"><i class="bi bi-check-circle"></i> Servis çalışıyor: ${esc(e.motor)}</span>`
      : `<span class="text-danger"><i class="bi bi-x-circle"></i> PaddleOCR servisi ${e.tanimli ? 'yanıt vermiyor' : 'tanımlı değil'}; Tesseract kullanılır.</span>`;
  }).catch(() => {});
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
    .map(p => ({ ad: p[0], unvan: p[1] || '', unvanCetvel: p[2] || '' }));
  await api('/api/ayarlar', { method: 'PUT', body: JSON.stringify(veri) });
  await api('/api/kisiler', { method: 'PUT', body: JSON.stringify(kisiler) });
  const plakalar = $('#plakalarAlan').value.split('\n').map(s => s.split(';').map(x => x.trim())).filter(p => p[0])
    .map(p => ({ plaka: p[0], aciklama: p[1] || '' }));
  await api('/api/plakalar', { method: 'PUT', body: JSON.stringify(plakalar) });
  await ayarlariYukle(); gorevleriYukle(); kisiSecimiYukle();
  $('#ayarDurum').textContent = 'Kaydedildi.'; setTimeout(() => { $('#ayarDurum').textContent = ''; }, 2500);
  onerileriYukle();
});
$('#ornekSil').addEventListener('click', async () => {
  if (!confirm('Örnek (uydurma) görev kayıtları silinsin mi? Gerçek kayıtlarınıza dokunulmaz.')) return;
  const r = await api('/api/ornek-veri', { method: 'DELETE' });
  bildir(`${r.silinen} örnek kayıt silindi.`);
  gorevleriYukle(); onerileriYukle();
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

// Drive taraması sunucuda arka planda yürür; ilerleme birkaç saniyede bir sorulur
const bekle = (ms) => new Promise(r => setTimeout(r, ms));
$('#driveTara').addEventListener('click', async () => {
  const btn = $('#driveTara'); btn.disabled = true;
  try {
    const bas = await api('/api/drive/tara', { method: 'POST' });
    if (!bas.basladi && !bas.calisiyor) throw new Error('Tarama başlatılamadı.');
    let d;
    do {
      await bekle(2000);
      d = await api('/api/drive/durum');
      const ilerleme = d.toplam ? `${d.islenen}/${d.toplam} görüntü OCR'dan geçiriliyor…` : 'Drive klasörü taranıyor…';
      $('#yukleDurum').innerHTML = `<span class="spinner-border spinner-border-sm"></span> ${ilerleme}`;
    } while (d.calisiyor);
    const o = d.sonuc || { bulunan: 0, yeni: 0, baglanan: 0, hata: [], kayitlar: [] };
    const satir = [`Drive: ${o.bulunan} görüntü bulundu, ${o.yeni} yeni kayıt, ${o.baglanan} mevcut kayıt güncellendi.`];
    if (o.bulunan && !o.yeni && !o.baglanan && !o.hata.length) satir.push('Yeni görüntü yok; daha önce işlenenler atlandı.');
    o.kayitlar.forEach(k => satir.push(`${esc(k.dosya)}: ${esc(k.durum)}${k.tarih ? ` (${tarihTR(k.tarih)})` : ''}`));
    o.hata.forEach(h => satir.push(`<span class="text-danger">${esc(h)}</span>`));
    $('#yukleDurum').innerHTML = satir.join('<br>');
    const ilk = o.kayitlar.find(k => k.tarih); if (ilk) $('#gorevAy').value = ilk.tarih.slice(0, 7);
    await gorevleriYukle(); onerileriYukle();
  } catch (e) { $('#yukleDurum').innerHTML = `<span class="text-danger">${esc(e.message)}</span>`; }
  btn.disabled = false;
});

api('/api/sistem').then(d => {
  if (d.hata) { $('#sistemUyari').innerHTML = `<i class="bi bi-exclamation-octagon me-1"></i> ${esc(d.hata)} Docker imajını yeniden derleyiniz: <code>docker compose up -d --build</code>`; $('#sistemUyari').hidden = false; }
}).catch(() => {});
// Açılış: seçili ayda kayıt yoksa kayıt bulunan en son aya geç
api('/api/gorevler-aylar').then(({ aylar }) => {
  if (aylar.length && !aylar.some(a => a.ay === $('#gorevAy').value)) $('#gorevAy').value = aylar[0].ay;
}).catch(() => {}).finally(gorevleriYukle);
kisiSecimiYukle(); onerileriYukle(); driveDurumYukle();
