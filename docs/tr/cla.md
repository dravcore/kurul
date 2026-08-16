# Katkıda Bulunan Lisans Sözleşmesi (CLA)

> 🌐 [English (canonical)](../cla.md) | Türkçe — Bu çeviri güncel olmayabilir; kanonik kaynak İngilizce'dir.

---

> # ⚠️ TASLAK — HUKUKÇU ONAYI BEKLİYOR, YÜRÜRLÜKTE DEĞİL
>
> **Bu belge, incelenmemiş bir taslaktır.** Bir hukukçu tarafından incelenmemiş veya onaylanmamıştır, şu anda **yürürlükte değildir** ve içeriğinin hiçbir kısmı hukuki tavsiye değildir. Buna güvenmeyin. `[FILL: …]` ve `[HUKUKÇUYA SOR: …]` ile işaretlenmiş yer tutucular henüz çözülmemiştir ve bu metin herhangi biri için bağlayıcı hâle gelmeden önce karara bağlanmalıdır. Bu uyarı, incelenmiş ve merge edilmiş bir pull request ile kaldırılana kadar **hiçbir katkıda bulunandan bir şey imzalaması istenmemektedir.**
>
> **Bu belge şu anda kullanılmıyor.** Kurul dış katkı kabul etmiyor ve CLA kontrolü devre dışı; dolayısıyla bunu kimse imzalamıyor ve hiçbir imza toplanmıyor. Hukuki inceleme bir gün gerçekleşirse diye hazır tutuluyor — bkz. [ADR 0015](decisions/0015-no-external-contributions.md).
>
> # ⚠️ DRAFT — PENDING LEGAL REVIEW, NOT IN FORCE
>
> **This document is an unreviewed draft.** It has **not** been reviewed or approved by a lawyer, it is **not** currently in effect, and nothing in it is legal advice. Do not rely on it. The placeholders marked `[FILL: …]` and `[HUKUKÇUYA SOR: …]` are unresolved and must be settled before this text becomes binding on anyone. Until this banner is removed in a merged, reviewed pull request, **no contributor is being asked to sign anything.**
>
> **This document is currently unused.** Kurul does not accept external contributions and the CLA check is disabled, so nobody signs this and no signature is collected. It is kept ready in case legal review ever happens — see [ADR 0015](decisions/0015-no-external-contributions.md).

---

> **Çeviri uyarısı:** Bu, İngilizce kanonik metnin bilgilendirme amaçlı çevirisidir. Hukuki inceleme İngilizce metin üzerinden yürütülecek; hangi dilin bağlayıcı olduğu henüz karara bağlanmamış bir sorudur ([Hukukçuya sorulacaklar](#hukukçuya-sorulacaklar), madde 11).

## Kurul neden CLA istiyor

Kurul [AGPL-3.0](../../LICENSE) ile yayımlanıyor. Plan, projeyi **çift lisanslama** ile finanse etmek: tek ve aynı kod tabanı herkes için tamamen AGPL-3.0 kalıyor, AGPL'in yükümlülüklerini kaldıramayan kurumlar ise aynı kod için proje sahibinden ayrı bir ticari lisans satın alabiliyor.

Bu iş modeli, yalnızca sahibin kodun **tamamını** — senin katkın dahil — AGPL-3.0 dışında bir lisansla dağıtma hakkına sahip olması durumunda çalışır. Varsayılan olarak yazdığın kodun telifi sende kalır ve bunu başka kimse yeniden lisanslayamaz. CLA, bu izni bilerek ve yazılı olarak verdiğin mekanizmadır — kendi işinin mülkiyetini korumaya devam ederken.

Bunu süslemektense açıkça söylemeyi tercih ediyoruz: **senden, proje sahibine katkını ticari bir lisansla da satma hakkı vermen isteniyor.** Karşılığında sözleşme, katkının AGPL-3.0 altında da yayımlanmaya devam edeceğini (Madde 2.3) ve imzalamadan önce kendi koduna sahip olduğun her hakkı koruduğunu (Madde 2.1(a)) garanti eder — hiç imzalamamış gibi, kodunu yeniden kullanabilir, yeniden lisanslayabilir veya başka bir yerde yayımlayabilirsin.

Modelin ardındaki gerekçe — ve dürüst dezavantajları — [ADR 0014](decisions/0014-dual-licensing-cla.md)'te kayıtlı.

## Nasıl imzalanır

İmzalama pull request'in içinde gerçekleşir. E-posta yok, PDF yok, tarayıcı yok.

1. Her zamanki gibi bir pull request aç.
2. **CLA** kontrolü çalışır ve henüz imzalamadıysan bir bot, PR'ına bu belgeye bağlantı veren bir yorum yazar.
3. Bu belgeyi oku. Kabul ediyorsan, pull request'e tam olarak şunu içeren **yeni bir yorum** yaz:

   ```text
   I have read the Kurul CLA v0.1 and I hereby sign it
   ```

4. Kontrol yeniden çalışır ve yeşile döner. İmzan, deponun `cla-signatures` dalındaki `signatures/v0.1/cla.json` dosyasına kaydedilir — bu hakları kimin verdiğine dair herkese açık, yalnızca eklemeli bir kayıt.

CLA sürümü başına **bir kez** imzalarsın. Aynı GitHub hesabından gelen sonraki her pull request otomatik olarak kapsanır. Bir kontrol eskirse, yeniden çalıştırmak için `recheck` yorumu yaz.

> İmza cümlesi İngilizce'dir ve bilerek çevrilmemiştir: otomasyon tam eşleşme arar, dolayısıyla yalnızca bu cümle geçerli bir imza sayılır.

### Bu metnin sürümlenmesi

Sürüm numarası, hem imza cümlesinin hem de saklama yolunun bilinçli olarak bir parçası. İncelenmiş metin geldiğinde sürüm **v1.0** olur, cümle `I have read the Kurul CLA v1.0 and I hereby sign it` hâline gelir ve imzalar `signatures/v1.0/cla.json` altına taşınır. Böylece bir sürüme verilen imza asla başka bir sürümün imzası sayılamaz — metin değişirse, her katkıda bulunanın tam olarak hangi ifadeyi kabul ettiği ve kimin yeniden imzalaması gerektiği her zaman açıktır.

### Kayıtta ne tutuluyor

Her imza için hedeflenen asgari bilgi şu: **GitHub kullanıcı adı, e-posta adresi, tarih, imzalanan CLA sürümü ve imzanın verildiği pull request.**

Otomasyonun bugün fiilen sakladığı bilgi bundan dar — GitHub kullanıcı adı, sayısal kullanıcı id'si, imza yorumunun id'si, bir zaman damgası, depo id'si ve pull request numarası. CLA sürümü, yukarıda anlatıldığı gibi dosya yolundan ve imza cümlesinden geliyor. **E-posta adresi yakalanmıyor**: imza botu yorumu yazan hesabı kaydediyor, bir adresi değil, ve yorum metni saklanmadan önce siliniyor. Katkıda bulunanın commit yazar e-postası, kaydın PR numarasıyla işaret ettiği pull request'in kendi git geçmişinde bulunuyor, ama deftere kopyalanmıyor.

> `[HUKUKÇUYA SOR: Kimin imzaladığını kanıtlamak için yalnızca tanımlayıcıya dayanan bir kayıt (GitHub hesabı + PR referansı) yeterli mi, yoksa defterin kendisi ad ve e-posta adresi taşımak zorunda mı? Zorundaysa, bu bilgi akış dışında toplanmalı ve defter özel bir depoya taşınmalı — çünkü araç bunu yakalayamıyor. Bkz. ADR 0014.]`

## Sözleşmeyi imzalamazsan ne olur

**CLA** kontrolü kırmızı kalır ve pull request merge edilemez. Sonucun tamamı bu — hiçbir issue kapatılmaz, hiçbir şey silinmez ve issue açmaya, inceleme yapmaya ve tartışmaya devam edebilirsin. İmzalamamayı tercih ediyorsan bunu issue'da söyle: bir maintainer küçük bir düzeltmeyi çoğu zaman bağımsız olarak yeniden yazabilir ve net bir yeniden üretim adımı içeren hata raporları, hiç kod eklenmeden de değerlidir.

Projenin maintainer'ları bir allowlist'te; kendi pull request'lerinde imza istenmez.

## Şirket ve kurumsal katkılar

Bu belge **bireysel** sözleşmedir. Şahsen, senin tarafından imzalanır.

**İşinin bir parçası olarak** katkı veriyorsan, işvereniniz varsayılan olarak çalışmanın telifine sahip olabilir; bu durumda Madde 2'deki hakları tek başına veremezsin. Madde 3(c), imzalamadan önce işvereninin onayını almanı gerektirir.

Bunun normal çözümü ayrı bir **Kurumsal CLA**'dır (şirketi bağlamaya yetkili biri tarafından imzalanan, kapsanan çalışanları listeleyen kurumsal bir sözleşme). Kurul'un henüz böyle bir belgesi **yok**.

> `[HUKUKÇUYA SOR: Şimdiden ayrı bir Kurumsal CLA (Harmony HA-CLA-E) gerekiyor mu, yoksa gerçekten kurumsal bir katkıda bulunan ortaya çıkana kadar bireysel sözleşmenin Madde 3(c)'sindeki işveren-onayı beyanı yeterli mi? Gerekiyorsa imza ve doğrulama süreci ne olacak — ve PR yorumuyla imzalama akışı, PR'ı açan geliştirici yerine yetkili bir imza sahibinin imzalaması gereken bir belgeye nasıl uyarlanacak?]`

Bu karara bağlanana kadar: şirket mesaisinde veya şirket ekipmanıyla katkı veriyorsan, imzalamadan önce **bunu pull request'te belirt**, ki bir maintainer sonradan keşfetmek yerine işaretleyebilsin.

---

# Kurul Bireysel Katkıda Bulunan Lisans Sözleşmesi

**Taslak sürümü:** 0.1 (incelenmemiş) · **Durum:** Yürürlükte değil

**Harmony Bireysel Katkıda Bulunan Lisans Sözleşmesi (HA-CLA-I-ANY) Sürüm 1.0** temel alınarak, <https://www.harmonyagreements.org>, "any license" (herhangi bir lisans) outbound seçeneğiyle türetilmiştir. Harmony şablonları tam olarak bu durum için — katkıları birden fazla lisansla dağıtmayı amaçlayan bir proje sahibi için — tasarlanmıştır; temel olarak Apache Bireysel CLA'sı yerine bunun seçilmesinin nedeni budur. Apache'nin outbound hak devri tek ve permissive bir çıkış lisansı varsayar ve çift lisanslamanın dayandığı yeniden lisanslama hakkını taşımaz.

Kurul'a katkıda bulunmaya gösterdiğin ilgi için teşekkürler. Kurul, gerçek kişi **Doğan Can Yıldız** tarafından yönetilen bir yazılım projesidir; adres: `[FILL: "Biz" olarak tanımlanan gerçek kişinin tam adresi]` ("Biz" veya "Bize").

Bu Sözleşme kapsamındaki haklar bir **gerçek kişiye** verilmektedir, bir şirkete değil. "Dravcore", projenin yayımlandığı isimdir; tüzel kişilik değildir ve bu hakları tutacak hâlihazırda kurulmuş bir şirket yoktur.

Bu katkıda bulunan sözleşmesi ("Sözleşme"), katkıda bulunanların Bize verdiği hakları belgeler. Bu belgeyi yürürlüğe koymak için lütfen yukarıdaki [Nasıl imzalanır](#nasıl-imzalanır) bölümündeki talimatları izleyerek imzala. Bu hukuken bağlayıcı bir belgedir, bu yüzden kabul etmeden önce lütfen dikkatle oku. Sözleşme, Bizim yönettiğimiz birden fazla yazılım projesini kapsayabilir.

### Devir değil lisans — ve bu bilinçli bir tercih

Bu Sözleşme bir **lisans verme** işlemidir, mülkiyet devri değil. Telifini Bize devretmezsin. Telif sende kalır (Madde 2.1(a)) ve Bize; münhasır olmayan, dünya çapında, süresiz, geri alınamaz, bedelsiz ve **alt lisans verilebilir** bir lisans verirsin; bu lisans Katkını **herhangi bir lisans şartıyla** dağıtma hakkını içerir (Madde 2.3).

Bu, Harmony Katkıda Bulunan **Devir** Sözleşmesi (CAA) yerine Harmony Katkıda Bulunan **Lisans** Sözleşmesini (CLA) izler ve bu tercih bilinçlidir. Çift lisanslama telif mülkiyetini gerektirmez — ödeme yapan bir müşteriye tüm kod tabanı için ticari lisans vermeye geniş ve alt lisans verilebilir bir lisans yeter. Lisans biçimini seçmek ayrıca, birçok yargı düzeninin özellikle mali hakların **devrine** bağladığı daha katı şekil şartlarından da kaçınmayı hedefler. Türk hukuku (FSEK) buradaki asıl örnektir: devredilen her mali hakkın ayrı ayrı gösterildiği yazılı bir belge arar ve bir pull request'e yazılan yorum güvenli elektronik imza değildir.

> `[HUKUKÇUYA SOR: Bunu devir yerine lisans verme olarak kurgulamak FSEK'in yazılı şekil şartından gerçekten muaf tutuyor mu, yoksa FSEK aynı yazılı şekil ve hakların ayrı ayrı gösterilmesi şartını lisanslar için de mi arıyor? Şart her hâlükârda geçerliyse, Türkiye mukimi katkıda bulunanlar için ek olarak hangi adım gerekiyor — ve Türkiye mukimi olan, sonrasında alt lisans verecek olan sahip için cevap değişiyor mu?]`

### Sonradan şirket kurulursa

Kurul bir gün tüzel kişilik tarafından yayımlanabilir. Bu olduğunda burada verilen haklar şirkete **kendiliğinden geçmez**: haklar bir gerçek kişiye verilmiştir ve bunları taşımak, o gerçek kişi ile yeni şirket arasında **ayrı bir devir işlemi** gerektirir. Madde 6.3, böyle bir devrin her katkıda bulunandan yeniden imza istemeden mümkün olmasını sağlamayı amaçlayan maddedir.

> `[HUKUKÇUYA SOR: Madde 6.3'teki devredilebilirlik (assignability) ifadesi, gerçek kişi olan sahibin katkıda bulunan lisanslarının tamamını — alt lisans verme hakkı dahil — sonradan kuracağı bir şirkete, her katkıda bulunandan yeniden imza almadan devretmesi için yeterli mi? Yeterli değilse; halefleri, iştirakleri ve devralanları açıkça sayan bir devredilebilirlik maddesi ekleyin ve katkıda bulunana bildirim veya onay gerekip gerekmediğini belirtin. Ayrıca gerçek kişiden şirkete yapılacak devrin FSEK kapsamında hangi şekilde yapılması gerektiğini teyit edin.]`

## 1. Tanımlar

**"Sen"**, Bize bir Katkı Sunan gerçek kişiyi ifade eder.

**"Katkı"**, Senin Bize Sunduğun ve Telifin sahibi olduğun ya da sahipliğini ileri sürdüğün her türlü eser anlamına gelir. Eserin tamamının Telifine sahip değilsen, lütfen yukarıdaki [Şirket ve kurumsal katkılar](#şirket-ve-kurumsal-katkılar) bölümündeki talimatları izle.

**"Telif"**, Senin sahibi olduğun veya kontrol ettiğin eserleri koruyan tüm hakları ifade eder; duruma göre telif hakkı, manevi haklar ve bağlantılı haklar dahil, varlıklarının tüm süresi ve Senin yaptığın uzatmalar boyunca.

**"Materyal"**, Bizim üçüncü taraflara sunduğumuz eseri ifade eder. Bu Sözleşme birden fazla yazılım projesini kapsadığında Materyal, Katkının Sunulduğu eseri ifade eder. Katkıyı Sunduktan sonra, Katkı Materyale dahil edilebilir.

**"Sunmak"**, Materyali tartışmak ve iyileştirmek amacıyla Bizim tarafımızdan veya Bizim adımıza yönetilen elektronik posta listeleri, kaynak kodu kontrol sistemleri ve issue takip sistemleri dahil ancak bunlarla sınırlı olmamak üzere, Bize veya temsilcilerimize gönderilen her türlü elektronik, sözlü veya yazılı iletişimi ifade eder; ancak Senin tarafından açıkça "Katkı Değildir" şeklinde işaretlenmiş veya yazılı olarak öyle belirtilmiş iletişimler bunun dışındadır.

**"Sunum Tarihi"**, Bize bir Katkı Sunduğun tarihi ifade eder.

**"Yürürlük Tarihi"**, bu Sözleşmeyi imzaladığın tarih ile Bize ilk Katkını Sunduğun tarihten hangisi önceyse onu ifade eder.

> `[HUKUKÇUYA SOR: Harmony şablonu ayrıca, dokümantasyon ve tasarım varlıklarını farklı şartlarla lisanslayan opsiyonel bir maddeyle birlikte kullanılmak üzere "Media" (Katkının yazılım olmayan kısmı) tanımını da içeriyor. Bu tanım ve madde burada çıkarıldı. Kurul fiilen dokümantasyon, Türkçe çeviri ve tasarım varlığı katkısı alıyor, yani bu varsayımsal bir durum değil — Media maddesine ihtiyacımız var mı, varsa hangi outbound şartlarla?]`

## 2. Hakların Verilmesi

### 2.1 Telif Lisansı

(a) **Katkındaki Telifin mülkiyeti Sende kalır ve Katkıyı kullanma veya lisanslama konusunda, bu Sözleşmeye girmemiş olsaydın sahip olacağın haklara aynen sahip olursun.**

(b) İlgili hukukun izin verdiği azami ölçüde, Bize; Katkıyı kapsayan Telif altında süresiz, dünya çapında, münhasır olmayan, devredilebilir, bedelsiz ve geri alınamaz bir lisans verirsin. Bu lisans, bu hakları çok kademeli alt lisans sahiplerine alt lisanslama hakkını içerir ve Katkıyı Materyalin parçası olarak çoğaltma, değiştirme, gösterme, temsil etme ve dağıtma hakkını kapsar; bu lisansın Madde 2.3'e uyum şartına bağlı olması kaydıyla.

### 2.2 Patent Lisansı

Sahibi olduğun, kontrol ettiğin veya şimdi ya da gelecekte verme hakkına sahip olduğun; usul, süreç ve cihaz istemleri dahil ancak bunlarla sınırlı olmamak üzere patent istemleri için Bize; süresiz, dünya çapında, münhasır olmayan, devredilebilir, bedelsiz ve geri alınamaz bir patent lisansı verirsin. Bu lisans, bu hakları çok kademeli alt lisans sahiplerine alt lisanslama hakkıyla birlikte; Katkıyı ve Katkının Materyalle birleşimini (ve bu birleşimin kısımlarını) yapma, yaptırma, kullanma, satma, satışa sunma, ithal etme ve başka şekilde devretme hakkını kapsar. Bu lisans yalnızca, lisanslanan hakların kullanılmasının söz konusu patent istemlerini ihlal ettiği ölçüde verilir; ve bu lisansın Madde 2.3'e uyum şartına bağlı olması kaydıyla.

### 2.3 Outbound (Çıkış) Lisansı

Madde 2.1 ve 2.2'de verilen haklara dayanarak, Katkını bir Materyale dahil edersek, **Katkıyı copyleft, permissive, ticari veya proprietary lisanslar dahil olmak üzere herhangi bir lisansla lisanslayabiliriz.** Bu hakkı kullanmanın şartı olarak, Katkıyı ayrıca Sunum Tarihinde Materyal için kullandığımız lisans veya lisansların şartlarıyla da lisanslamayı kabul ederiz.

Şüpheye yer bırakmamak için: Sunum Tarihinde Materyal için kullandığımız lisans, [LICENSE](../../LICENSE) dosyasında kayıtlı olan **GNU Affero General Public License sürüm 3.0 (AGPL-3.0)**'dır. Bu nedenle Katkın, verdiğimiz başka herhangi bir lisanstan bağımsız olarak kamuya AGPL-3.0 ile açık kalır.

### 2.4 Manevi Haklar

Katkı için manevi haklar geçerliyse, hukukun izin verdiği azami ölçüde, bu manevi hakları Bize, haleflerimize veya doğrudan ya da dolaylı lisans sahiplerimize karşı ileri sürmekten feragat eder ve ileri sürmemeyi kabul edersin.

> `[HUKUKÇUYA SOR: Manevi haklardan feragat her yargı düzeninde mümkün değil. Türk hukukunda (FSEK) manevi haklar esere değil eser sahibinin şahsına bağlı kabul ediliyor; bu feragatin Türk hukukuna tabi bir katkıda bulunan veya sahip için geçerli olup olmadığı ve hangi biçimde geçerli olabileceği teyit edilmeli, düz bir feragat geçerli değilse madde yeniden yazılmalı. Harmony ifadesinin olduğu gibi taşındığını varsaymayın.]`

### 2.5 Bizim Haklarımız

Katkını Materyalin parçası olarak kullanmakla yükümlü olmadığımızı ve uygun gördüğümüz herhangi bir Katkıyı dahil etmeye karar verebileceğimizi kabul edersin.

### 2.6 Hakların Saklı Tutulması

Bu madde kapsamında açıkça lisanslanmayan tüm haklar Senin tarafından açıkça saklı tutulur.

## 3. Beyanlar

Şunları teyit edersin:

(a) Bu Sözleşmeye girmek için hukuki yetkin var.

(b) Madde 2 kapsamındaki hakları vermek için gereken, Katkıyı kapsayan Telif ve patent istemlerinin sahibisin.

(c) Madde 2 kapsamındaki hakların verilmesi, işverenin dahil olmak üzere üçüncü taraflara verdiğin hiçbir hakkı ihlal etmiyor. Çalışansan, bu Sözleşmeyi işverenine onaylattın veya işverenin bu belgenin Kurumsal sürümünü imzaladı. On sekiz yaşından küçüksen, lütfen Sözleşmeyi ebeveynine veya vasine imzalat.

(d) Sunulan eserin tamamının Telifine sahip değilsen, [Şirket ve kurumsal katkılar](#şirket-ve-kurumsal-katkılar) bölümündeki talimatları izledin.

> `[HUKUKÇUYA SOR: (c) bendi küçüğün ebeveyni veya vasisinin imzalamasını gerektiriyor, ancak PR yorumuyla imzalama akışı yaşı, kimliği veya velayeti doğrulayamıyor — yalnızca bir GitHub kullanıcı adı kaydediyor. Doğrulanmamış bir hesabın tıkla-kabul et tarzı imzası hiç uygulanabilir mi, ve küçükler için ayrı bir akış dışı süreç mi yoksa katkıya doğrudan bir yaş sınırı mı gerekiyor?]`

## 4. Sorumsuzluk Beyanı

MADDE 3'TEKİ AÇIK GARANTİLER DIŞINDA, KATKI "OLDUĞU GİBİ" SUNULMAKTADIR. DAHA AÇIK OLARAK; SATILABİLİRLİK, BELİRLİ BİR AMACA UYGUNLUK VE İHLAL ETMEME KONULARINDAKİ ZIMNİ GARANTİLER DAHİL ANCAK BUNLARLA SINIRLI OLMAMAK ÜZERE, TÜM AÇIK VEYA ZIMNİ GARANTİLER SENİN TARAFINDAN BİZE KARŞI AÇIKÇA REDDEDİLMEKTEDİR. BU TÜR GARANTİLERİN REDDEDİLEMEDİĞİ ÖLÇÜDE, SÖZ KONUSU GARANTİ SÜRE BAKIMINDAN HUKUKUN İZİN VERDİĞİ ASGARİ SÜREYLE SINIRLIDIR.

## 5. Dolaylı Zarar Feragati

UYGULANACAK HUKUKUN İZİN VERDİĞİ AZAMİ ÖLÇÜDE, TALEBİN DAYANDIĞI HUKUKİ VEYA HAKKANİYETE DAYALI TEORİ (SÖZLEŞME, HAKSIZ FİİL VEYA BAŞKA BİR ŞEKİLDE) NE OLURSA OLSUN, BU SÖZLEŞMEDEN DOĞAN KÂR KAYBI, BEKLENEN TASARRUF KAYBI, VERİ KAYBI, DOLAYLI, ÖZEL, ARIZİ, SONUÇSAL VE CEZAİ ZARARLARDAN HİÇBİR DURUMDA SORUMLU OLMAYACAKSIN.

## 6. Çeşitli Hükümler

6.1 Bu Sözleşme, kanunlar ihtilafı hükümleri hariç olmak üzere `[FILL: uygulanacak hukuk / yargı düzeni]` hukukuna tabi olacak ve buna göre yorumlanacaktır. Belirli koşullarda bu maddedeki uygulanacak hukukun yerini Birleşmiş Milletler Milletlerarası Mal Satımına İlişkin Sözleşmeler Hakkında Antlaşma ("BM Antlaşması") alabilir; taraflar BM Antlaşmasının bu Sözleşmeye uygulanmasından kaçınmayı amaçlamakta ve dolayısıyla BM Antlaşmasının bu Sözleşmeye uygulanmasını tümüyle dışlamaktadır.

> `[HUKUKÇUYA SOR: Hangi hukuk uygulanacak ve hangi mahkemeler yetkili olacak? "Biz" Türkiye mukimi, ancak katkıda bulunanların çoğunun Türkiye dışından olması bekleniyor; bu seçim hem geçerliliği hem uygulanabilirliği etkiliyor. Türk hukuku + Türk mahkemeleri sahip için en basiti ama yabancı bir katkıda bulunanın kabul etmesi en zor ve yurt dışında ona karşı uygulanması en zor şart; tarafsız veya katkıda bulunan lehine bir seçim ikisini de tersine çevirir. Uygulanacak hukuk maddesinin yanında ayrı bir yetkili mahkeme maddesi gerekiyor mu, ve katkıda bulunanın kendi ülkesindeki tüketici veya işçi koruma kuralları biz ne yazarsak yazalım bunları geçersiz kılar mı? Ayrıca BM Antlaşması istisnasının burada anlamlı olup olmadığını, yoksa şablondan taşınmış bir kalıp mı olduğunu teyit edin.]`

6.2 Bu Sözleşme, Senin Bize Katkıların bakımından Seninle Bizim aramızdaki sözleşmenin tamamını ortaya koyar ve diğer tüm anlaşma veya mutabakatların yerine geçer.

6.3 Sen veya Biz, bu Sözleşme ile elde edilen hakları veya yükümlülükleri üçüncü bir tarafa devredersek, devrin şartı olarak o üçüncü taraf Sözleşmedeki tüm hak ve yükümlülüklere uymayı yazılı olarak kabul etmelidir.

6.4 Taraflardan birinin, bu Sözleşmenin herhangi bir hükmünün diğer tarafça yerine getirilmesini bir durumda talep etmemesi, o tarafın gelecekte herhangi bir zamanda bunu talep etme hakkını etkilemez. Bir hüküm kapsamındaki ifadan bir durumda feragat edilmesi, o hükmün gelecekte ifasından feragat edildiği veya hükmün tümünden feragat edildiği anlamına gelmez.

6.5 Bu Sözleşmenin herhangi bir hükmü geçersiz ve uygulanamaz bulunursa, o hüküm mümkün olduğu ölçüde, orijinal hükmün anlamına en yakın olan ve uygulanabilir bir hükümle değiştirilecektir. Bu Sözleşmede yer alan şart ve koşullar, bu Sözleşmenin veya sınırlı bir telafinin esaslı amacının gerçekleşmemesine bakılmaksızın, hukukun izin verdiği azami ölçüde uygulanacaktır.

## İmza

**Sen** — [Nasıl imzalanır](#nasıl-imzalanır) bölümünde anlatılan imza yorumunu yazan GitHub hesabı olarak, yorumun yazıldığı zaman damgası ve pull request ile birlikte kaydedilir.

**Biz** — Doğan Can Yıldız, `[FILL: tam adres]`

---

## Hukukçuya sorulacaklar

Bu taslak yürürlüğe girmeden önce proje sahibinin cevaplaması gereken, belgeye özgü somut maddeler. Yukarıdaki satır içi `[HUKUKÇUYA SOR: …]` işaretleri, listenin bir bütün olarak devredilebilmesi için burada tekrarlanmıştır.

### "Biz" kim, ve bu değişince ne olur

1. **Gerçek kişinin adresi.** Giriş bölümü ve imza bloğu Doğan Can Yıldız'ın tam adresini gerektiriyor. İkametgâh adresi zorunlu mu, yoksa belge herkese açık bir depoda yayımlandığı için iş/tebligat adresi kabul edilebilir mi?
2. **İleride kurulacak şirkete devir** — [Sonradan şirket kurulursa](#sonradan-şirket-kurulursa) bölümündeki satır içi işarete bakın. Madde 6.3, sahibin katkıda bulunan lisanslarının tamamını sonradan kuracağı bir şirkete yeniden imza almadan taşımasına izin veriyor mu, ve bu gerçek kişi–şirket devri hangi şekilde yapılmalı?
3. **Gerçek kişinin ölümü veya ehliyet kaybı.** "Biz" tüzel kişi değil gerçek kişi olduğu için lisanslara ne olur — mirasçılara geçer mi, ve Sözleşme bunu açıkça söylemeli mi?

### İmza mekanizmasının uygulanabilirliği

4. **Pull request yorumu geçerli bir imza mı?** Akışın tamamı, doğrulanmamış bir GitHub hesabının sabit bir cümle yazmasına dayanıyor. Uygulanacak hukuk kapsamında bu bağlayıcı bir sözleşme kuruyor mu — ve `signatures/v0.1/cla.json` defteri bunun yeterli delili mi? Değilse, asgari olarak ne gerekir (kayıtta ad ve e-posta, açık kabul ekranı olan bir tıkla-onayla akışı, güvenli elektronik imza)?
5. **Kayıtta neler bulunmalı** — [Kayıtta ne tutuluyor](#kayıtta-ne-tutuluyor) bölümündeki satır içi işarete bakın. Hedeflenen asgari bilgi kullanıcı adı, e-posta, tarih, CLA sürümü ve PR referansı; araç e-postayı yakalayamıyor.
6. **Karşılıklılık / ivaz.** Katkıda bulunan geniş haklar veriyor ve karşılığında yalnızca Madde 2.3'teki AGPL-3.0 ile yayımlamaya devam etme taahhüdünü alıyor. Uygulanacak hukukta bu yeterli mi, yoksa Sözleşmenin katkıda bulunanın ne aldığını açıkça sayan bir madde içermesi mi gerekiyor?
7. **Küçükler** (Madde 3(c)) — satır içi işarete bakın. Akış yaşı veya velayeti doğrulayamıyor. Ayrı bir süreç mi, yoksa katkıya yaş sınırı mı?

### Türk hukukuna özgü noktalar

8. **FSEK şekil şartı, lisans mı devir mi** — [Devir değil lisans](#devir-değil-lisans--ve-bu-bilinçli-bir-tercih) bölümündeki satır içi işarete bakın. Belgedeki en kritik soru budur: taslağın tamamı, FSEK'in mali hakların devrine ilişkin yazılı şekil ve hakların ayrı ayrı gösterilmesi kurallarından uzak durmayı denemek için bilinçli olarak devir yerine lisans şeklinde kurgulanmıştır. Bu taslak, denemenin başarılı olduğuna dair **hiçbir iddiada bulunmaz**.
9. **Gelecekteki eserler.** Sözleşme, imza anında henüz yazılmamış katkıları da kapsıyor. Bazı yargı düzenleri gelecekteki eserler üzerindeki lisansları sınırlıyor; bunun uygulanacak hukukta ve Türkiye mukimi katkıda bulunanlar için FSEK kapsamında geçerli olduğunu teyit edin.
10. **Manevi haklar** (Madde 2.4) — satır içi işarete bakın. FSEK manevi hakları eser sahibinin şahsına bağlı sayıyor; feragatin geçerli olup olmadığını teyit edin ve geçerli değilse maddeyi yeniden yazın.
11. **Dil.** Burada kanonik metin İngilizce, Türkçe ise çeviridir. Yetkili mahkeme Türk mahkemesiyse Türkçe sürümün bağlayıcı olması gerekir mi, ve belge bir uyuşmazlık hâlinde hangi dilin geçerli olduğunu belirtmeli mi? Taslak şu anda belirtmiyor.

### Verilen hakların kapsamı

12. **"Herhangi bir lisans" outbound maddesi** (Madde 2.3). Bunun, katkı gelen kısımlar dahil tüm kod tabanı için AGPL yükümlülüğünden muaf ticari bir lisans satmayı destekleyecek kadar geniş olduğunu teyit edin — modelin tüm amacı budur ve madde yetersiz kalırsa model çalışmaz. Özellikle **alt lisans verme** hakkının yalnızca sahibe değil, sahibin müşterisine kadar ulaştığını teyit edin.
13. **Patent lisansı** (Madde 2.2) — "yaptırma … satma … ithal etme" kapsamı, patenti olmayan bir proje için uygun mu, yoksa projenin ihtiyaç duymadığı ve katkıda bulunanların çekineceği bir genişlik mi?
14. **Uygulanacak hukuk ve yetkili mahkeme** (Madde 6.1) — satır içi işarete bakın.
15. **Kurumsal CLA** — [Şirket ve kurumsal katkılar](#şirket-ve-kurumsal-katkılar) bölümündeki satır içi işarete bakın.
16. **Media / yazılım olmayan katkılar** — [Tanımlar](#1-tanımlar) bölümündeki satır içi işarete bakın. Dokümantasyon ve Türkçe çeviriler burada gerçek katkılardır.

### Operasyonel

17. **Geriye etki.** Bu CLA yürürlüğe girmeden önce merge edilmiş katkılar kapsam dışıdır. Geçmiş katkıda bulunanlardan geriye dönük imza istenmeli mi, ve o zamana kadar kod tabanının durumu nedir? (Bu yazının yazıldığı anda hiç dış katkı yok — kurulumun şimdi yapılmasının sebebi tam olarak bu.)
18. **Sürümleme.** CLA metni sonradan değiştirilirse mevcut imzalar geçerliliğini korur mu, yoksa katkıda bulunanların yeni sürüme karşı yeniden imzalaması mı gerekir? İmza cümlesi ve imza dosyası yolu, her imzanın tek bir ifadeye sabitlenmesi için sürümü taşıyor, ancak yeniden imza kampanyasının gerekip gerekmediğini hukuki cevap belirler.
19. **Kişisel verilerin korunması.** Herkese açık imza defteri bir GitHub kullanıcı adı ve id'si kaydediyor — pull request'te zaten herkese açık olan veriler. Bir hukukçu defterde bunun yerine gerçek ad veya e-posta adresi gerektirirse, saklama özel bir depoya taşınmak zorunda; bkz. [ADR 0014](decisions/0014-dual-licensing-cla.md). Kimin imzaladığını gösteren herkese açık bir defter, kendi başına bir KVKK/GDPR hukuki sebebi ve saklama süresi beyanı gerektirir mi?
