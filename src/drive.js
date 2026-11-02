// Google Drive erişimi (hizmet hesabı). Görüntüler diske yazılmaz; yalnızca bellekte işlenir.
//
// Kimlik bilgisi iki yoldan biriyle verilir:
//   GOOGLE_SERVICE_ACCOUNT_JSON  : hizmet hesabı JSON anahtarının içeriği (Coolify'da gizli değişken)
//   GOOGLE_APPLICATION_CREDENTIALS : JSON anahtar dosyasının yolu
// Klasör, hizmet hesabının e-posta adresine "Görüntüleyen" olarak paylaşılmalıdır.

const fs = require('fs');
const { JWT } = require('google-auth-library');

const API = 'https://www.googleapis.com/drive/v3';
const KLASOR = 'application/vnd.google-apps.folder';
const GORSEL_TURLERI = ['image/jpeg', 'image/png'];

let istemci = null;
let anahtar = null;

function anahtarOku() {
  if (anahtar !== null) return anahtar;
  try {
    if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) anahtar = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) anahtar = JSON.parse(fs.readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8'));
    else anahtar = false;
  } catch (e) {
    console.error('Google hizmet hesabı anahtarı okunamadı:', e.message);
    anahtar = false;
  }
  return anahtar;
}

const tanimli = () => !!anahtarOku();
const hesapEposta = () => (anahtarOku() || {}).client_email || '';

function jwt() {
  if (istemci) return istemci;
  const k = anahtarOku();
  if (!k) throw new Error('Google hizmet hesabı tanımlı değil (GOOGLE_SERVICE_ACCOUNT_JSON).');
  istemci = new JWT({ email: k.client_email, key: k.private_key, scopes: ['https://www.googleapis.com/auth/drive.readonly'] });
  return istemci;
}

async function istek(yol, params = {}, ham = false) {
  const url = new URL(API + yol);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const yanit = await jwt().request({ url: url.toString(), responseType: ham ? 'arraybuffer' : 'json' });
  return ham ? Buffer.from(yanit.data) : yanit.data;
}

// "https://drive.google.com/drive/folders/XXXX?usp=sharing" ya da doğrudan kimlik
function klasorKimligi(girdi) {
  const s = (girdi || '').trim();
  const m = /folders\/([\w-]{10,})/.exec(s) || /[?&]id=([\w-]{10,})/.exec(s);
  return m ? m[1] : s;
}

async function klasorBilgisi(id) {
  return istek(`/files/${encodeURIComponent(id)}`, { fields: 'id,name,mimeType', supportsAllDrives: 'true' });
}

async function listele(klasorId) {
  const q = `'${klasorId.replace(/'/g, "\\'")}' in parents and trashed = false`;
  const sonuc = [];
  let sayfa = '';
  do {
    const p = {
      q, pageSize: '1000', fields: 'nextPageToken, files(id,name,mimeType,modifiedTime)',
      supportsAllDrives: 'true', includeItemsFromAllDrives: 'true'
    };
    if (sayfa) p.pageToken = sayfa;
    const d = await istek('/files', p);
    sonuc.push(...(d.files || []));
    sayfa = d.nextPageToken || '';
  } while (sayfa);
  return sonuc;
}

// Klasör ve alt klasörlerdeki görüntüleri döndürür: [{id, name, mimeType, yol}]
async function gorselleriBul(kokId, derinlik = 3) {
  const bulunan = [];
  async function gez(id, yol, d) {
    for (const f of await listele(id)) {
      if (f.mimeType === KLASOR && d < derinlik) await gez(f.id, yol ? `${yol}/${f.name}` : f.name, d + 1);
      else if (GORSEL_TURLERI.includes(f.mimeType)) bulunan.push({ ...f, yol });
    }
  }
  await gez(kokId, '', 0);
  return bulunan;
}

const indir = (id) => istek(`/files/${encodeURIComponent(id)}`, { alt: 'media', supportsAllDrives: 'true' }, true);

module.exports = { tanimli, hesapEposta, klasorKimligi, klasorBilgisi, gorselleriBul, indir };
