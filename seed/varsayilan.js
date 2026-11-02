// İlk açılışta yüklenen varsayılan veriler. Ayarlar ekranından değiştirilebilir.

const tatiller = [
  // 2026
  ['2026-01-01', 'Yılbaşı'],
  ['2026-03-19', 'Ramazan Bayramı Arifesi', true],
  ['2026-03-20', 'Ramazan Bayramı 1. gün'], ['2026-03-21', 'Ramazan Bayramı 2. gün'], ['2026-03-22', 'Ramazan Bayramı 3. gün'],
  ['2026-04-23', 'Ulusal Egemenlik ve Çocuk Bayramı'],
  ['2026-05-01', 'Emek ve Dayanışma Günü'],
  ['2026-05-19', 'Atatürk\'ü Anma, Gençlik ve Spor Bayramı'],
  ['2026-05-26', 'Kurban Bayramı Arifesi', true],
  ['2026-05-27', 'Kurban Bayramı 1. gün'], ['2026-05-28', 'Kurban Bayramı 2. gün'],
  ['2026-05-29', 'Kurban Bayramı 3. gün'], ['2026-05-30', 'Kurban Bayramı 4. gün'],
  ['2026-07-15', 'Demokrasi ve Milli Birlik Günü'],
  ['2026-08-30', 'Zafer Bayramı'],
  ['2026-10-28', 'Cumhuriyet Bayramı Arifesi', true],
  ['2026-10-29', 'Cumhuriyet Bayramı'],
  // 2027 (dini bayram tarihlerini Resmî Gazete'den kontrol ediniz)
  ['2027-01-01', 'Yılbaşı'],
  ['2027-03-08', 'Ramazan Bayramı Arifesi', true],
  ['2027-03-09', 'Ramazan Bayramı 1. gün'], ['2027-03-10', 'Ramazan Bayramı 2. gün'], ['2027-03-11', 'Ramazan Bayramı 3. gün'],
  ['2027-04-23', 'Ulusal Egemenlik ve Çocuk Bayramı'],
  ['2027-05-01', 'Emek ve Dayanışma Günü'],
  ['2027-05-15', 'Kurban Bayramı Arifesi', true],
  ['2027-05-16', 'Kurban Bayramı 1. gün'], ['2027-05-17', 'Kurban Bayramı 2. gün'],
  ['2027-05-18', 'Kurban Bayramı 3. gün'], ['2027-05-19', 'Kurban Bayramı 4. gün / 19 Mayıs'],
  ['2027-07-15', 'Demokrasi ve Milli Birlik Günü'],
  ['2027-08-30', 'Zafer Bayramı'],
  ['2027-10-28', 'Cumhuriyet Bayramı Arifesi', true],
  ['2027-10-29', 'Cumhuriyet Bayramı']
].map(([tarih, ad, yarim]) => ({ tarih, ad, yarim: !!yarim }));

// Seyyar görev tazminatı: ilçe belediye yazılarına göre mahalli dışı yerler
const mahalliDisi = [
  ['Arnavutköy', 'Balaban, Boyalık, Baklalı, Yeniköy, Yassıören, Dursunköy, Hacımaşlı'],
  ['Beykoz', 'Alibahadır, Anadolufeneri, Bozhane, Cumhuriyet, Göllü, Ishaklı, Kaynarca, Kılıçlı, Mahmutşevketpaşa, Öğümce, Paşamandıra, Polenezköy, Poyrazköy, Riva'],
  ['Büyükçekmece', 'Celaliye, Kamiloba, Eskice, Karaağaç, Çakmaklı, 19 Mayıs, Kumburgaz, Ahmediye, Tepecik',
    'Celaliye-Kamiloba TEM kuzeyi, Karaağaç/Çakmaklı/19 Mayıs bir kısmı, Kumburgaz kuzeyi, Tepecik kuzeyi'],
  ['Çatalca', 'Akalan, Aydınlar, Bahşayiş, Başakköy, Belgrat, Binkılıç, Celepköy, Çakıl, Çanakça, Çiftlikköy, Dağyenice, Elbasan, Gökçeali, Gümüşpınar, Halaçlı, Hisarbeyli, İhsaniye, İnceğiz, İzzettin, Kabakça, Kalfaköy, Karacaköy, Karamandere, Kestanelik, Kızılcaali, Muratbey, Nakkaş, Oklalı, Ormanlı, Ovayenice, Örcünlü, Örencik, Subaşı, Yalıköy, Yaylacık, Yazlık'],
  ['Çekmeköy', 'Hüseyinli, Koçullu, Ömerli, Reşadiye, Sırapınar'],
  ['Eyüpsultan', 'Akpınar, Ağaçlı, Çiftealan, İhsaniye, Işıklar, Odayeri, Pirinççi, Göktürk, Mithatpaşa, Mimarsinan'],
  ['Pendik', 'Ballıca, Emirli, Göçbeyli, Kurna, Kurtdoğmuş'],
  ['Sarıyer', 'Bahçeköy, Demirciköy, Garipçe, Gümüşdere, Kısırkaya, Kilyos, Rumelifeneri, Uskumruköy, Zekeriyaköy'],
  ['Silivri', 'Akören, Alipaşa, Balaban, Bekirli, Beyciler, Büyükçavuşlu, Büyükkılıçlı, Büyüksinekli, Çayırdere, Çeltik, Danamandıra, Fener, Fevzipaşa, Gazitepe, Gümüşyaka, Hürriyet, İsmetpaşa, Kadıköy, Kavaklı, Kurfallı, Küçükkılıçlı, Küçüksinekli, Ortaköy, Sancaktepe, Sayalar, Semizkumlar, Seymen, Yolçatı'],
  ['Şile', 'Ağaçdere, Akçakese, Avcıkoru, Bıçkıdere, Bozgoca, Çataklı, Çelebi, Çengilli, Darlık, Değirmençayırı, Erenler, Esenceli, Geredeli, Gökmaslı, Göksu, Hacılı, Hasanlı, İmrendere, İmrenli, İsaköy, Kabakoz, Kadıköy, Kalemköy, Karabeyli, Karacaköy, Karakiraz, Karamandere, Kervansaray, Kızılcaköy, Korucu, Kömürlük, Kurna, Oruçoğlu, Osmanköy, Ovacık, Satmazlı, Sofular, Soğullu, Sortullu, Şuayipli, Tekeköy, Ulupelit, Üvezli, Yaka, Yaylalı, Yazımanayır, Yeniköy, Yeşilvadi']
].map(([ilce, m, not]) => ({ ilce, mahalleler: m.split(',').map(s => s.trim()), not: not || '' }));

const ZM = ['Ziraat Mühendisi', 'Ziraat Mühendisi'], ZYM = ['Ziraat Mühendisi', 'Ziraat Yüksek Mühendisi'];
const kisiler = [
  ['Ali YILMAZ', 'Mühendis', ...ZYM], ['Ayşe KAYA', 'Mühendis', ...ZM], ['Mehmet DEMİR', 'Mühendis', ...ZM],
  ['Zeynep ŞAHİN', 'Mühendis', ...ZM], ['Can ÖZTÜRK', 'Mühendis', ...ZM], ['Elif AYDIN', 'Mühendis', ...ZM],
  ['Murat ÇELİK', 'Mühendis', ...ZM], ['Selin ARSLAN', 'İşçi', 'Sürekli İşçi', 'Sürekli İşçi'],
  ['Hakan KOÇ', 'Şoför', 'Şoför', 'Şoför'], ['Emre KURT', 'Şoför', 'Şoför', 'Şoför']
].map(([ad, unvan, unvanCetvel, unvanSeyyar]) => ({ ad, unvan, unvanCetvel, unvanSeyyar }));

// Uydurma örnek görev emirleri (gerçek kişi, plaka ve evrakla ilgisi yoktur).
// Ayarlar ekranındaki "Örnek veriyi içe aktar" düğmesiyle yüklenir.
const A = 'Ali YILMAZ', AY = 'Ayşe KAYA', M = 'Mehmet DEMİR', Z = 'Zeynep ŞAHİN', C = 'Can ÖZTÜRK', E = 'Elif AYDIN', MU = 'Murat ÇELİK';
const ornek = [
  ['2026-10-06', '101', 'Beykoz-Alibahadır, Sancaktepe-Paşaköy', '34 AAA 001', C, [A, E, C, Z], '08:30', '17:00'],
  ['2026-10-07', '102', 'Arnavutköy-Yassıören, Çatalca-Subaşı', '34 AAA 001', C, [A, MU, C, E], '09:30', '17:00'],
  ['2026-10-08', '103', 'Arnavutköy-Yassıören', '34 BBB 002', C, [AY, M, A, C], '09:30', '16:00'],
  ['2026-10-13', '104', 'Çatalca-Çiftlikköy', '34 CCC 003', A, [AY, M, A], '09:30', '16:00'],
  ['2026-10-16', '105', 'Üsküdar-Çekmeköy-Ömerli', '34 DDD 004', 'Hakan KOÇ', [M, A, 'Selin ARSLAN'], '10:00', '15:30'],
  ['2026-10-19', '106', 'Beykoz-Alibahadır', '34 EEE 005', A, [M, AY, A, Z], '09:30', '16:00'],
  ['2026-10-20', '107', 'Çatalca-Çiftlikköy', '34 FFF 006', A, [AY, Z, A, M], '09:00', '15:30'],
  ['2026-10-23', '108', 'Büyükçekmece-Tepecik, Bağcılar, Güngören', '34 FFF 006', MU, [AY, M, A, Z], '09:30', '17:00'],
  ['2026-10-26', '109', 'B.Çekmece-Ahmediye, Sarıyer-Demirciköy', '34 GGG 007', 'Emre KURT', [AY, Z, A, M], '09:30', '14:00'],
  ['2026-10-27', '110', 'Şile-Doğancılı', '34 HHH 008', A, [AY, M, Z, A], '10:00', '15:00']
].map(([tarih, no, yerHam, plaka, surucu, personel, cikis, donus]) => ({
  tarih, sayi: `E-00000000-000.00.00-00000${no}`, belgeNo: `000${no}`,
  yerHam, plaka, surucu, personel, cikis, donus, onayli: true
}));

module.exports = { tatiller, mahalliDisi, kisiler, ornek };
