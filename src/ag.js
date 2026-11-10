// Ağ paylaşımı: kurum ağındaki bir klasörden görev emri / görev sonu raporu görüntülerini okur.
// İki yol vardır:
//   smb    : Windows (SMB) paylaşımına doğrudan bağlanır — \\sunucu\paylasim\alt\klasor.
//            Konteynerde "smbclient" kullanılır; ayrıcalıklı konteyner ya da sunucuda bağlama gerekmez.
//   klasor : Sunucuya (Docker birimi olarak) bağlanmış bir klasör — /ag gibi.
// Görüntüler diske yazılmaz; yalnızca bellekte işlenir (Drive'daki gibi). Kayıtta kaynak kimliği
// "ag:<tam yol>" biçiminde tutulur ve görüntü gerektiğinde paylaşımdan yeniden okunur.
// Parola veritabanında tutulur, arayüze hiç gönderilmez; istenirse AG_PAROLA ortam değişkeniyle verilir.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const UZANTI = /\.(jpe?g|png)$/i;
const DERINLIK = 3;           // alt klasörler (Drive'daki gibi 3 seviye)
const ONEK = 'ag:';

const agKimligi = (id) => typeof id === 'string' && id.startsWith(ONEK);

// "\\sunucu\paylasim\alt\klasor" ya da "//sunucu/paylasim/alt" → { servis: '//sunucu/paylasim', dizin: 'alt/klasor' }
function adresCoz(adres) {
  const p = String(adres || '').trim().replace(/\\/g, '/').replace(/^smb:/i, '').replace(/^\/+/, '').split('/').filter(Boolean);
  if (p.length < 2) return null;
  return { servis: `//${p[0]}/${p[1]}`, dizin: p.slice(2).join('/') };
}

function ayarlar(ayar) {
  const a = ayar || {};
  return {
    tur: a.agTur === 'klasor' ? 'klasor' : 'smb',
    adres: (a.agAdres || '').trim(),
    klasor: (a.agKlasor || '').trim(),
    kullanici: (a.agKullanici || process.env.AG_KULLANICI || '').trim(),
    alan: (a.agAlan || process.env.AG_ALAN || '').trim(),
    parola: a.agParola || process.env.AG_PAROLA || ''
  };
}

function tanimli(ayar) {
  const k = ayarlar(ayar);
  return k.tur === 'klasor' ? !!k.klasor : !!adresCoz(k.adres);
}

// ---- SMB (smbclient) ----
// Kimlik bilgisi komut satırında görünmesin diye geçici, yalnızca sahibinin okuyabildiği dosyayla verilir.
function kimlikDosyasi(k) {
  if (!k.kullanici) return null;
  const dosya = path.join(os.tmpdir(), `gemis-smb-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.writeFileSync(dosya, `username=${k.kullanici}\npassword=${k.parola}\n${k.alan ? `domain=${k.alan}\n` : ''}`, { mode: 0o600 });
  return dosya;
}

function smbclient(k, servis, komut, ikili = false) {
  return new Promise((resolve, reject) => {
    const kimlik = kimlikDosyasi(k);
    const arg = [servis, ...(kimlik ? ['-A', kimlik] : ['-N']), '-m', 'SMB3', '-c', komut];
    execFile('smbclient', arg, { encoding: ikili ? 'buffer' : 'utf8', maxBuffer: 80 * 1024 * 1024, timeout: 120000 }, (e, out, err) => {
      if (kimlik) fs.unlink(kimlik, () => {});
      if (e) {
        const metin = String(err || out || e.message);
        if (e.code === 'ENOENT') return reject(new Error('smbclient kurulu değil (Docker görüntüsünü yeniden oluşturunuz).'));
        if (/LOGON_FAILURE|ACCESS_DENIED/i.test(metin)) return reject(new Error('Paylaşıma giriş reddedildi: kullanıcı adı, parola ya da etki alanı hatalı veya bu hesabın klasöre okuma izni yok.'));
        if (/BAD_NETWORK_NAME/i.test(metin)) return reject(new Error('Paylaşım adı bulunamadı (\\\\sunucu\\paylaşım kısmını denetleyiniz).'));
        if (/OBJECT_NAME_NOT_FOUND|OBJECT_PATH_NOT_FOUND|NO_SUCH_FILE/i.test(metin)) return reject(new Error('Klasör ya da dosya bulunamadı.'));
        if (/Connection to .* failed|HOST_UNREACHABLE|timed out|NT_STATUS_IO_TIMEOUT|resolve/i.test(metin)) return reject(new Error('Sunucuya ulaşılamadı: adres yanlış olabilir ya da uygulamanın çalıştığı sunucu bu bilgisayarı ağda göremiyor.'));
        return reject(new Error('Ağ paylaşımı: ' + metin.split('\n').filter(Boolean).slice(-1)[0]));
      }
      resolve(out);
    });
  });
}

// "recurse ON; ls" çıktısını çözümler. Dizin başlıkları "\alt\klasor" biçimindedir; dosya satırları
// "  ad.jpg      A   123456  Mon Oct  6 08:30:00 2026".
function lsCoz(cikti, kokDizin) {
  const dosyalar = [];
  let dizin = '';
  for (const satir of String(cikti).split('\n')) {
    if (/^\\/.test(satir.trim()) && !/^\s{2}/.test(satir)) { dizin = satir.trim().replace(/^\\/, '').replace(/\\/g, '/'); continue; }
    const m = /^\s{2}(.+?)\s+([A-Z]*)\s+(\d+)\s+(\w{3}\s+\w{3}\s+\d+\s+[\d:]{8}\s+\d{4})\s*$/.exec(satir);
    if (!m || m[2].includes('D') || !UZANTI.test(m[1])) continue;
    const goreli = [dizin, m[1]].filter(Boolean).join('/');
    const derinlik = dizin ? dizin.split('/').length - (kokDizin ? kokDizin.split('/').length : 0) : 0;
    if (derinlik > DERINLIK) continue;
    dosyalar.push({ goreli, ad: m[1], boyut: Number(m[3]), tarih: new Date(m[4]) });
  }
  return dosyalar;
}

async function smbListele(k) {
  const a = adresCoz(k.adres);
  if (!a) throw new Error('Paylaşım adresi \\\\sunucu\\paylaşım\\klasör biçiminde olmalıdır.');
  const cd = a.dizin ? `cd "${a.dizin.replace(/\//g, '\\')}"; ` : '';
  const out = await smbclient(k, a.servis, `${cd}recurse ON; ls`);
  // smbclient, "cd" başarısız olsa da sıfırla çıkar ve paylaşım kökünü listeler; bu durum hata sayılır
  const cdHata = /^cd .*?(NT_STATUS_\w+)/m.exec(out);
  if (cdHata) throw new Error(/ACCESS_DENIED/.test(cdHata[1]) ? `"${a.dizin}" klasörüne erişim izni yok.` : `"${a.dizin}" klasörü paylaşımda bulunamadı.`);
  const lsHata = /(NT_STATUS_\w+) listing/.exec(out);
  if (lsHata) throw new Error(`Klasör listelenemedi (${lsHata[1]}).`);
  // "ls" çıktısındaki dizinler paylaşım köküne göredir
  return lsCoz(out, a.dizin)
    .filter(f => !a.dizin || f.goreli.toLowerCase().startsWith(a.dizin.toLowerCase() + '/') || !f.goreli.includes('/'))
    .map(f => {
      const tam = f.goreli.includes('/') || !a.dizin ? f.goreli : `${a.dizin}/${f.goreli}`;
      return { id: `${ONEK}${a.servis}/${tam}`, name: f.ad, yol: path.posix.dirname(tam) === '.' ? '' : path.posix.dirname(tam), tarih: f.tarih };
    });
}

async function smbIndir(k, id) {
  const p = id.slice(ONEK.length).replace(/^\/+/, '').split('/');
  const servis = `//${p[0]}/${p[1]}`;
  const dosya = p.slice(2).join('\\');
  // geçici dosyaya indirilir, okunur ve hemen silinir (görüntü diskte kalmaz)
  const gecici = path.join(os.tmpdir(), `gemis-ag-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  try {
    await smbclient(k, servis, `get "${dosya}" "${gecici}"`);
    return await fs.promises.readFile(gecici);
  } finally { fs.unlink(gecici, () => {}); }
}

// ---- Sunucuya bağlanmış klasör ----
async function klasorListele(k) {
  const kok = path.resolve(k.klasor);
  try { if (!(await fs.promises.stat(kok)).isDirectory()) throw new Error(); }
  catch { throw new Error(`Klasör bulunamadı ya da okunamıyor: ${kok}`); }
  const sonuc = [];
  async function gez(dizin, derinlik) {
    for (const e of await fs.promises.readdir(dizin, { withFileTypes: true })) {
      const tam = path.join(dizin, e.name);
      if (e.isDirectory() && derinlik < DERINLIK) await gez(tam, derinlik + 1);
      else if (e.isFile() && UZANTI.test(e.name)) {
        const st = await fs.promises.stat(tam);
        sonuc.push({ id: ONEK + tam, name: e.name, yol: path.relative(kok, dizin).split(path.sep).join('/'), tarih: st.mtime });
      }
    }
  }
  await gez(kok, 0);
  return sonuc;
}

// ---- Ortak arayüz ----
async function gorselleriBul(ayar) {
  const k = ayarlar(ayar);
  if (!tanimli(ayar)) throw new Error('Ayarlar\'da ağ paylaşımı tanımlanmamış.');
  const liste = k.tur === 'klasor' ? await klasorListele(k) : await smbListele(k);
  return liste.sort((a, b) => a.id.localeCompare(b.id, 'tr'));
}

async function indir(id, ayar) {
  if (!agKimligi(id)) throw new Error('Geçersiz ağ dosyası kimliği.');
  const tam = id.slice(ONEK.length);
  if (tam.startsWith('//')) return smbIndir(ayarlar(ayar), id);
  return fs.promises.readFile(tam);
}

module.exports = { agKimligi, adresCoz, lsCoz, tanimli, gorselleriBul, indir, ayarlar };
