# Yapılacaklar

- [ ] Seyyar görev tazminatı için mahalli dışı yerler (memuriyet mahalli dışı bölgeler) şu listeden alınacak:
  https://istanbul.gib.gov.tr/defterdarlik/255_memuriyet_mahallerinin_tespitine_iliskin_liste
  Şu anki varsayılan liste `seed/varsayilan.js` içindeki `mahalliDisi` dizisidir.

- [ ] Kurum ağındaki ayrı sunucuya kurulum (dışarıdan erişim yok):
  - kullanıcı girişi (şu an uygulamada oturum açma yok; ağdaki herkes erişebilir)
  - internetsiz kurulum: Docker görüntülerinin `docker save` / `docker load` ile taşınması
  - Google Drive kurum ağında büyük olasılıkla kapalı; içe aktarma ağ paylaşımından yapılacak
  - netleşecekler: sunucunun işletim sistemi, internet/vekil sunucu durumu, paylaşım adresi ve
    okuma hesabı, kullanıcılar

- [ ] Ayrı ilçe/mahalle sütunlu cetvellerde (ek özel hizmet, araç kullanma, seyyar görev) yer yazım
  kuralının ("/" ve "Merkez" yazılmaması) uygulanıp uygulanmayacağı kararlaştırılacak.
