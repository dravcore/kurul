# 0024. Dosya Eki Tipleri ve Servis Politikası: FILE ya da LINK, İki Katmanda Tek Boyut Sayısı, Yalnız Görsellerde Inline

**Durum:** Kabul edildi
**Tarih:** 2026-08-15

> 🌐 [English (kanonik)](../../decisions/0024-attachment-kinds-and-serving-policy.md) | Türkçe — Bu çeviri güncel olmayabilir; kanonik kaynak İngilizce'dir.

## Bağlam

[ADR 0022](0022-attachment-storage.md) dosya eki baytlarının nerede yaşadığını, onları kimin
okuyabileceğini, yedeğin onlardan nasıl haberdar olacağını ve sahipsiz dosyaların nasıl
süpürüleceğini karara bağladı. Bir depolama kararıdır ve o hâliyle eksiksizdir. Özelliğin tam bir
tanımı değildir ve bu fark varsayılmadı, ölçüldü: 0022'nin P3-1'in gerçekte yapması gereken işe
karşı denetimi, belgenin ya hiç sormadığı ya da sorup cevaplamadığı dört soru buldu.

**Birincisi, kayıtta dosya olmayan bir ekin karşılığı yok.** `noopener`, `noreferrer`, "external
link", SSRF ve `type` kelimelerinin hiçbiri 0022'de geçmiyor — her biri için sıfır eşleşme. Bu
sessizlik nötr değil, çünkü aynı hafta alınmış bir kapsam kararı tersini söylüyor.
`audit/phase-3-plan.md` §7 karar 4 (satır 910), Trello import'unun (P3-3) bayt değil attachment
**URL'leri** taşıdığını kayda geçiriyor: "Dosya taşınmıyor (Trello export vermiyor); URL tipi
attachment kaydı oluşuyor". Plan sonra yarattığı borcu kendi cümleleriyle adlandırıyor, satır
917-920: karar "P3-1'in ADR'ına **altıncı bir karar noktası** ekliyor: attachment kaydının bir
_dosya_ mı yoksa bir _URL_ mi olduğu modelde temsil edilmeli (tip ayrımı), çünkü URL tipinde
depolama yok, boyut yok, MIME yok. Bu ayrım P3-1 tasarlanırken bilinmezse P3-3 modeli zorlayarak
taşır." ADR 0022 bu yükü taşımadı. Burada ödeniyor.

**İkincisi, boyut limitinin mekanizması var, sayısı yok.** 0022'nin kararı "The size limit is set
in two layers" diyor ve iki katmanı da adlandırıyor: API'de multer'ın `limits.fileSize`'ı ve
yayınlanmış proxy sözleşmesine eklenen bir gövde-boyutu satırı. İki katmanın hiçbirine değer
verilmiyor. Gerekçe bölümü proxy sözleşmesinin o satıra neden ihtiyaç duyduğunu uzun uzun
anlatıyor — nginx `client_max_body_size`'ı 1 MB varsayarken Caddy hiç limit koymuyor, dolayısıyla
dokümantasyonu en dikkatli izleyen operatör izi sürülemeyen bir `413` alıyor. Bu akıl yürütme
doğru ve yarım: iki farklı sayı taşıyan iki katman, paragrafın önlemek için var olduğu izi
sürülemeyen 413'ü aynen geri getirir — üstelik bu kez sözleşmeye uymuş bir kurulumun içinde.

**Üçüncüsü, MIME allowlist'inin mekanizması var, içeriği yok.** 0022 doğrulamanın "bir allowlist
artı içerik koklama" olduğuna, `file-type`'ın magic byte'ları okuyacağına ve reddin 415 olacağına
karar veriyor. Listede ne olduğunu hiç söylemiyor. Üyeliği olmayan bir allowlist, karar kılığına
girmiş bir uygulayıcı tahminidir.

**Dördüncüsü, `Content-Disposition` hiç karara bağlanmamış.** İfade tüm belgede bir kez geçiyor,
stream sıralamasıyla ilgili paragrafın içinde — "If a handler has already written
`Content-Disposition` and started streaming when a disk or database error arrives" — orada da bir
politika değil, bir handler'ın yazmış olabileceği bir şeyin örneği. Saklanan bir PDF'in tarayıcıda
mı açılacağı yoksa indirilenler klasörüne mi ineceği cevapsız; ve dördü içinde güvenlik yüzeyi en
geniş olan soru bu.

Bu dördünün ötesinde 0022 birkaç şeyi, öyle yaptığını söylemeden uygulamaya bırakıyor; bu daha
küçük ama aynı biçimli bir sorun: okuyucu bilinçli bir erteleme ile bir gözden kaçırmayı
ayıramıyor. Tenant scope'un mekanizması (şema kolonu mu ilişki yolu mu), realtime event, activity
izi ve `Attachment` modelinin alan listesi hepsi bu kategoride. Bu ADR her birini adlandırıyor ve
ya karara bağlıyor ya da açıkça uygulama planına bırakıldığını söylüyor.

`docs/decisions/README.md`, merge edilmiş bir ADR'ın "tarihsel olarak ele alındığını (sonraki
kararları tarihi yeniden yazarak değil, geçersiz kılarak düzenle)" söylüyor. Dolayısıyla bunların
hiçbiri 0022'ye yama değil. **Bu ADR 0022'yi genişletir; geçersiz kılmaz.** 0022'nin depolama,
yetkilendirme, yedek ve süpürme kararlarının tamamı olduğu gibi durur; indeksteki 0022 satırı
yeniden yazılmaz, yalnızca not düşülür.

## Karar

**Bir dosya eki ya `FILE`'dır ya `LINK`, ve bunu şema söyler.** `AttachmentKind`, tam olarak bu iki
değeri taşıyan bir Prisma enum'ı. `FILE` bir depolama anahtarı, koklanmış bir MIME tipi ve bir bayt
boyutu taşır. `LINK` bir URL taşır ve bu üçünden hiçbirini taşımaz — depolama anahtarı yok, boyut
yok, MIME yok, depolama arka ucunda satır yok. Tip, başka bir kolonun tesadüfen null olmasından
türetilmez; modelin geri kalanının null'lanabilirliği ondan türetilir.

**`LINK` birinci sınıf, kullanıcıya açık bir tiptir; import artefaktı değil.** P3-1, dosya yükleme
arayüzünün yanında karta link ekleme arayüzünü de gönderir. P3-3'ün importer'ı `LINK` satırlarını
özel bir yoldan değil, kullanıcının kullandığı yolun aynısından oluşturur.

**Tek bir boyut sayısı: `ATTACHMENT_MAX_BYTES`, varsayılan 25 MiB (`26214400`), iki katmana da
yazılır.** API multer'ın `limits.fileSize`'ını bundan kurar ve yayınlanmış proxy sözleşmesi aynı
değeri taşıyan bir gövde-boyutu satırı kazanır — `docker/Caddyfile`'da
`request_body { max_size 25MiB }` ve [self-hosting.md](../self-hosting.md)'nin nginx bloğunda
`client_max_body_size 25m;` karşılığı. İki katman bağımsız ayarlanabilir değildir ve öyleymiş gibi
belgelenmez: birini diğeri olmadan yükselten bir kurulum hatalı yapılandırılmıştır ve sayının
geçtiği yerde dokümantasyon bunu söyler. Bu bir değerdir, bayrak değil; dolayısıyla 0022'nin
`_ENABLED` kuralına dokunulmaz — dosya eklerinin var olup olmadığına hâlâ `STORAGE_PATH` karar
verir.

**MIME allowlist'i geniştir; `text/html` ve `image/svg+xml` onun dışındadır.** İzinli: `image/png`,
`image/jpeg`, `image/gif`, `image/webp`; `application/pdf`; ofis belgeleri (`.docx`, `.xlsx`,
`.pptx` ve OpenDocument karşılıkları); `application/zip`; `text/plain` ve `text/csv`. Bilinçli ve
adıyla dışarıda: `text/html`, `image/svg+xml` ve her türlü yürütülebilir ya da script kabı. Karar
listenin kendisidir; ofis formatlarının tam medya-tipi dizeleri kopyalama işidir ve uygulama planı
onları açık açık yazar.

**Varsayılan `Content-Disposition: attachment`'tır; `inline` yalnız dört görsel tipine uygulanır.**
`image/png`, `image/jpeg`, `image/gif` ve `image/webp` `inline` servis edilir, çünkü 0022 zaten
"inline preview covers images only" demişti ve görev panelindeki önizleme bunu gerektiriyor. Geri
kalan her şey — PDF'ler dahil — `attachment` olarak servis edilir. Tipten ve disposition'dan
bağımsız olarak **her** dosya eki cevabında üç başlık yolculuk eder: `X-Content-Type-Options:
nosniff`, `Cross-Origin-Resource-Policy: same-origin` (API'nin `apps/api/src/common/configure-app.ts:46`
satırında global olarak kurduğu `cross-origin` politikasını override ederek) ve istemcinin beyan
ettiğinden değil **koklanmış** tipten alınan bir `Content-Type`.

**Yeni socket event yok. ADR 0023'ün kararı yeniden verilmez, miras alınır.** Bir dosya eki
mutasyonu `TaskEventsService.emitUpdated`'ı çağırır (`apps/api/src/task/task-events.service.ts:29-38`),
o da `{ workspaceId, boardId, actorId, taskId }` ile `SocketEvents.TASK_UPDATED` yayar ve istemci
görevi REST üzerinden yeniden okur. `audit/phase-3-plan.md` §4.2 karar 3 (satır 411-412) bu seçimi
P3-1 ile P3-2'den hangisi önce teslim ederse ona vermiş ve "Attachments ve import aynı kararı miras
alır" demişti; P3-2 onu [ADR 0023](0023-checklist-data-model.md) olarak teslim etti. Bu paragraf,
0022'nin hiç kurmadığı bağdır.

**Dosya eki eklemek ve silmek birer `Activity` satırı yazar ve iki tip de `AUDIT_ACTIVITY_TYPES`'a
girer.** `packages/shared-types/src/activity.ts`'teki `ActivityType`'a iki yeni sabit katılır ve
ikisi de `activity.ts:65-83`'teki denetim alt kümesine eklenir. O dosyanın kendi başlığı bunu tek
seferlik bir karar yapan kısıtı söylüyor: isimler "veritabanına yazılır, dolayısıyla bir depolama
formatıdır, görüntülenen metin değil: birini yeniden adlandırmak eski dizeyi taşıyan her satırı
öksüz bırakır. Ekle, asla yeniden adlandırma" (`activity.ts:11-13`). İsimler bu yüzden yerleşik
`<özne>.<geçmiş zaman fiil>` biçiminde bir kez seçilir ve bir daha gözden geçirilmez.

**Sunucu bir `LINK`'in URL'sine hiç istek atmaz. Hiçbir gerekçeyle, bir kez bile.** Önizleme yok,
favicon yok, `<title>` kazıma yok, metadata yok, unfurl yok, link sağlık kontrolü yok. URL
saklanır, döndürülür ve istemci tarafından render edilir; sunucu onu opak metin olarak görür.
Saklanan URL'ler `http:` ve `https:` şemalarıyla sınırlıdır — `javascript:`, `data:` ve `file:`
yazma anında reddedilir — ve web istemcisi onları `target="_blank" rel="noopener noreferrer"` ile
açar. Bu bir uygulama detayı değil, bir karardır; ve bir kod yorumuna değil buraya yazılmıştır,
çünkü `audit/phase-3-plan.md` §5 (satır 797) bu biçimdeki her kısıt için şunu soruyor: "Bu kısıtı
ihlal edecek kişi onu nerede okuyacak?" İleride link önizlemesi ekleyecek olan, bu paragrafı okumak
ve bilerek bozmak zorunda kalır.

**Tenant scope ilişki yolu üzerinden gider. Denormalize bir `Attachment.workspaceId` yoktur.**
Scope, `ChecklistService`'in ifade ettiği gibi ifade edilir —
`where: { id, taskId, task: { board: { workspaceId } } }`,
`apps/api/src/task/checklist.service.ts:82-84` — ve `Task`'ın kendisi kopyalanacak bir
`workspaceId` kolonu taşımıyor. 404-not-403 kuralı zaten bulunduğu yerde, guard katmanında kalır:
`apps/api/src/common/guards/workspace.guard.ts:34-37`.

**Depolama anahtarı sunucuda, ekin kendi id'sinden türetilir.** `storageKey` satırın UUIDv7'sinden
ve başka hiçbir şeyden hesaplanır. Kullanıcının dosya adı yalnızca görüntülenen bir alan olarak
saklanır ve hiçbir zaman bir yol parçasına dönüşmez; böylece path traversal, her kod yolunda doğru
çözülmesi gereken bir doğrulama sorunu olmaktan çıkar — yapısal olarak ifade edilemez hâle gelir.

**`uploadedById`, `onDelete: Restrict` ile `User`'a giden gerçek bir yabancı anahtardır.** Emsal,
`apps/api/prisma/schema.prisma:311`'de `Restrict` olan `Comment.user`. Maliyet sonradan
keşfedilmek yerine burada yazılır: bu, P3-4'ün (hesap silme ve anonimleştirme, bulgu DB-05) üzerinde
düşünmesi gereken yüzeyi büyütür ve `audit/ROADMAP.md:372` bugünkü durumu zaten "Bugün `Restrict`
FK'ler yüzünden bir GDPR/KVKK silme talebi psql'de bile yerine getirilemiyor" diye tarif ediyor.
ADR 0023 checklist maddelerinde `User` FK'sinden tam da bu nedenle kaçınmıştı. Bu ADR maliyeti yine
de ödüyor ve Gerekçe bölümü iki durumun neden farklı olduğunu söylüyor.

**Dosya ekleri kendi modülünü alır: `apps/api/src/attachment/`.** Controller `CommentController`
emsalini izler — `apps/api/src/comment/comment.controller.ts:16`'da
`@Controller('workspaces/:workspaceId')` — ve 0022'nin zaten yayınladığı rota yollarını kullanır.
Bu, `apps/api/src/task/task.module.ts:17-32`'ye yazılmış, "New sub-resources should follow the
checklist shape" diye biten yönlendirmeden bir sapmadır; sapma bir sapma olarak adlandırılır ve
aşağıda gerekçelendirilir, bir gözden geçirenin fark etmesine bırakılmaz.

**Uygulama planına bırakılanlar — açıkça, gözden kaçırılarak değil:** `Attachment` modelinin tam
alan listesi; indeks seti; DTO şekilleri ve liste ile detay okumalarının farklı şekiller taşıyıp
taşımayacağı; 0022'nin inşasına zaten karar verdiği sahipsiz dosya süpürmesinin sorgu şekli; ve web
yüzeyinin bileşenlere nasıl bölüneceği. Her biri kesişen bir sonucu olmayan bir şekil sorusudur ve
hiçbiri, başka bir ADR'ın geri almak zorunda kalacağı biçimde yanlış yapılamaz.

## Gerekçe

**`kind` neden bir kolon, bir çıkarım değil.** Alternatif bir enum kadar ucuz: `storageKey`,
`mimeType` ve `size` null'lanabilir olur, `url` null'lanabilir olur ve "bu bir link mi" sorusu
`mimeType === null` ile cevaplanır. Reddedildi, çünkü veritabanının zorlayabileceği bir değişmezi
yalnızca uygulamanın hatırladığı bir değişmeze çevirir. Hem URL'i hem depolama anahtarı olan ya da
ikisi de olmayan bir satırı hiçbir şey engellemez ve böyle bir satırı ilk oluşturan, gecenin
üçünde toplu insert koşan bir importer olur. Faz planı tam bu başarısızlığı 917-920 satırlarında
öngörmüştü — tip olmadan "P3-3 modeli zorlayarak taşır", yani her içe aktarılan satırda 0 boyut,
boş MIME ve sahte bir depolama yolu. Bu üç yalan sonra yayılır: süpürme, arkasında dosya olmayan
bir depolama yolu görür ve onu özel duruma almak zorunda kalır; kota, boyut olmayan bir 0'ı
toplar; indirme ucu hiç çözülmeyecek bir anahtar için bir dal taşır. Bir enum bir migration'a mal
olur ve bunların hepsini siler.

**`LINK` neden yalnız import'a değil kullanıcıya açık.** Yalnızca bir importer'ın
oluşturabildiği bir kayıt tipi, kimsenin ürünü kullanarak test etmediği bir kayıt tipidir. Tüm P3-1
penceresinin hiç çalıştırmadığı bir API şekli, bir DTO alanı ve bir render yoluyla teslim edilir; ve
onu ilk koşan şey P3-3 olur — toplu hâlde, gerçek veriyle ve ürettiğini inceleyecek bir arayüz
olmadan. Aynı yolu kullanıcılara da açmak, import hedefini zaten kullanılmış bir yüzey yapar.
Ayrıca ürünün aksi hâlde iki kez cevaplaması gereken bir talebi cevaplar: ekipler karta tasarım
dosyalarının ve dokümanların kopyalarını yüklemekten çok daha sık onların linklerini yapıştırıyor.

**Sayı neden iki katmanda da aynı olmak zorunda.** 0022, sessiz bir proxy limitinin operatörün
yazılı hiçbir şeye bağlayamadığı bir `413` ürettiğini ortaya koymuştu. Farklı değerler taşıyan iki
belgelenmiş limit, aynı başarısızlığın bir adım fazlasıdır. Proxy 25 MiB'a, multer 10'a izin
veriyorsa 20 MiB'lık bir yükleme API'nin içinde, proxy'nin başarılı bir vekil isteği olarak
loglayacağı bir hatayla ölür; proxy 10'a, multer 25'e izin veriyorsa aynı yükleme kenarda ölür ve
API hiç görmez, dolayısıyla ne uygulama logları ne Sentry bir şey olduğunu kaydeder. İki yön de
"büyük yüklemeler bazen başarısız oluyor" biçiminde, her bileşeninin yapılandırıldığı gibi
davrandığı bir sisteme karşı açılmış bir hata kaydı üretir. Tek sayı, bir kez adlandırılmış, iki
yerde alıntılanmış — bunun hata ayıklanabilir kalan tek versiyonu budur.

**Neden özellikle 25 MiB.** `audit/ROADMAP.md:364`, P3-1'in başarı metriğini "10 MB dosya ekleme
≤3 sn" olarak belirtiyor. 25 MiB'lık bir tavan, bu ölçümü sınırın üstünde oturtmak yerine izinli
aralığın rahatça içinde bırakır; sınırda otursaydı ölçüm, yükleme yolunu değil limiti ölçüyor
olurdu. Ayrıca bu özelliğin taşımak için var olduğu belgeler için (bir sunum destesi, taranmış bir
sözleşme, bir hatanın ekran kaydı) yeterince büyük ve tek bir yüklemenin küçük bir VPS'in disk
payını tek istekte tüketemeyeceği kadar küçüktür — bu önemli, çünkü hedef kurulum tek makine.

**Allowlist neden geniş ama SVG dışarıda.** Dar bir allowlist özelliği başarısız kılar: "güvenli
tipler"in katı bir okuması dışarıda bıraktığı için `.xlsx`'i reddeden bir araç, insanların bir şey
eklemeyi denemekten vazgeçtiği bir araçtır ve denetim, dosya eklerini bir değerlendirmeyi bitiren
eksikler arasında birinci sıraya koydu. Bu yüzden varsayılan genişliktir. SVG, dışarıda tutulan tek
görsel tipidir ve tam da bir üstündeki karar yüzünden dışarıdadır: SVG işaretlemedir, `<script>`
taşıyabilir ve görseller bu ADR'ın `inline` servis ettiği tek ailedir. `image/svg+xml`'e izin
vermek bir dosya tipi daha eklemek olmazdı — inline önizleme kararını, 0022'nin `default-src
'none'` gücü için seçtiği API origin'inde saklanan bir cross-site scripting vektörüne çevirirdi.
`text/html` aynı nedenle ve daha kısa bir mesafeden dışarıdadır; `security-headers.ts` onu zaten
adlandırıyor ve 0022'nin Gerekçe'si o yorumu alıntılıyor. İçerik koklama iki durumu da kurtarmaz,
çünkü iki dosya da gerçekten iddia ettikleri şeydir.

**`inline` iki başlığı neden tavsiye etmiyor, zorunlu kılıyor.** Bir şeyi `inline` servis etmek,
tarayıcıya onu bir doküman bağlamında render etmesi talimatıdır. `nosniff`, o render'ı sunucunun
hesapladığı tiple sınırlı tutan şeydir: o olmadan, beyan edilen tipe katılmayan bir tarayıcı bir
`.png` yüklemesini HTML olarak render edebilir ve tüm allowlist tavsiye niteliğine düşer.
`Cross-Origin-Resource-Policy: same-origin`, inline render edilebilir bir kaynağın başka herhangi
bir site tarafından gömülmesini engelleyen şeydir — API `configure-app.ts:46`'da global olarak
`cross-origin` kuruyor çünkü web uygulaması meşru biçimde ayrı bir origin, ve bu akıl yürütme
kullanıcının yüklediği baytlara uzanmıyor. 0022 CORP override'ını zaten şart koşmuştu; söylemediği
şey, o override'ı düzenlilik değil taşıyıcı yapan şeyin `inline` kararı olduğuydu. Beyan edileni
değil koklanan `Content-Type`'ı servis etmek son boşluğu kapatır: koklanan tipi doğrulayıp sonra
istemcinin dizesini yankılayan bir allowlist, bir değeri doğrulamış ve başka birini göndermiştir.

**Sunucu bir `LINK`'in URL'sine neden hiç dokunmaz.** Kullanıcının verdiği bir URL'e sunucu
tarafında yapılan her istek bir SSRF primitifidir ve bu kurulum, böyle bir şeyin bulunabileceği en
kötü yerdir: `postgres`, `redis` ve `api`'nin tarayıcının erişemediği bir iç ağda isimle çözüldüğü
bir Compose yığını. Bir link önizleme özelliği, herhangi bir workspace üyesinin API'den
`http://postgres:5432/`'yi ya da bir bulut metadata ucunu getirmesini ve bulduğunu raporlamasını
sağlardı. Talep edilen özellik — bir URL'in yanında başlık ve favicon göstermek — kozmetiktir;
gerektirdiği yetenek değil. Saklanan şemaları `http:` ve `https:` ile sınırlamak aynı sorunun
istemci tarafındaki yarısını kapatır: bir `href`'e render edilen `javascript:` URL'i, bir tıkla
saklanan XSS'tir; `rel="noopener noreferrer"` ise açılan sayfanın `window.opener` üzerinden geri
uzanmasını ya da board URL'ini `Referer`'da sızdırmasını engeller.

**Checklist activity yazmazken dosya ekleri neden yazıyor.** `ChecklistService` hiçbir
`ActivityService` import etmiyor — dosyanın import'ları Prisma, pozisyon yardımcıları, kendi
DTO'ları, `TaskReadService` ve `TaskEventsService`, başka bir şey yok — ve bu checklist için
doğruydu. Fark geri getirilebilirlikte. Yanlışlıkla silinen bir checklist maddesi birinin yeniden
yazdığı bir cümledir; silinmesinin kaydı, kalıcı sonucu olmayan bir olay hakkında bir satır olurdu.
Yanlışlıkla silinen bir dosya eki gitmiştir ve onu gitmiş yapan şey 0022'nin kendi sahipsiz dosya
süpürmesidir — satır Postgres'ten kaybolur ve gecelik süpürme, mühlet dolduğunda baytları diskten
alır. Ondan sonra dosyanın var olduğuna dair geriye kalan tek kanıt activity satırıdır. Bu,
`activity.ts:51-64`'ün `task.deleted`'ı denetim alt kümesine almak için zaten kurduğu argümanın
aynısıdır: o, "düzenlemek yerine yok eden tek içerik olayı"dır. Dosya eki silme ikincisidir. Yalnız
silme değil iki tip de `AUDIT_ACTIVITY_TYPES`'a girer, çünkü "ele geçirilmiş bu hesap burada ne
yaptı" diye soran bir olay müdahalecisinin yüklemeye de ihtiyacı vardır — dosya yerleştiren bir
saldırganın karşısında yalnızca kaldırmaları kaydeden bir liste işe yaramaz.

**`User` yabancı anahtarı, ADR 0023'ün ödemeyi reddettiği bir maliyeti neden hak ediyor.** 0023
checklist maddesinde `completedById`'yi reddetti, çünkü bir kutuyu işaretlemek atfedilen bir eylem
değil ve alan yalnızca kimsenin sormadığı bir soruyu cevaplamak için var olurdu. Dosya yüklemek
diğer türden bir olaydır: bir yorumun yazarlı olduğu anlamda yazarlıdır ve `Comment.userId` en
baştan beri `Restrict` bir FK. Bir önceki karardaki activity satırı bir aktör id'si tutuyor,
dolayısıyla ilkesel olarak görüntüleme oradan join edebilirdi — ama bu, "bunu kim yükledi"yi nesnenin
bir özelliği olmaktan çıkarıp denetim izine karşı bir sorguya çevirir; hem daha yavaş hem
anlamsal olarak yanlış. İz bir yüklemenin olduğunu kaydeder; dosya eki kaydı ise o yüklemenin
ürettiği şeydir. Takasın dürüst ifadesi şudur: P3-4'ün etrafından dolaşması gereken bir `Restrict`
FK daha var ve bu ADR, kendisinden sonra gelen ADR için daha ucuz bir migration yerine doğru bir
modeli seçti.

**`task.module.ts`'teki yönlendirmeye karşı neden ayrı bir modül.** O yorumun gerekçesi sağlam ve
yereldir: checklist'ler doğrudan `TaskController`'a bağlandı çünkü alternatif, issue #40'ın zaten
bölünmesini istediği 15,8 KB'lık `task.service.ts`'e sekiz pass-through metot daha eklemekti. Dosya
ekleri o şeklin iki varsayımını birden bozuyor. Birincisi, 0022'nin yayınladığı beş uçtan üçü bir
görev üzerinden adreslenmiyor — `GET`, `DELETE` ve içerik stream'i
`/workspaces/:workspaceId/attachments/:attachmentId`'de yaşıyor ki bu, `TaskController`'ın sahip
olması gereken bir rota değil. İkincisi, modül görev modülünün büyütmek için hiçbir sebebi olmayan
bağımlılıklar taşıyor: depolama portu, bir multer interceptor'ı, `file-type`'ın ESM dinamik
import'u ve API'de JSON yerine cevaba bayt yazan tek handler. Bunu `task/`'ın içine koymak, mevcut
yorumun küçültmeye çalıştığı dosyayı tam olarak büyütür; yani yönlendirmenin harfini izlemek,
gerekçesini ihlal eder. `CommentController`, kendi modülünü hak etmiş bir görev alt kaynağının
emsalidir ve aynı `workspaces/:workspaceId` kökünde mount edilmiştir.

**`FileTypeValidator` kullanılamaz; bu şüphe değil ölçüm.** Nest'in `ParseFilePipe`'ı, 0022'nin
istediği şeyi tam olarak yapan bir `FileTypeValidator` ile geliyor: `file-type` üzerinden magic
number incelemesi. Okumak onu diskalifiye ediyor.
`node_modules/@nestjs/common/pipes/file/file-type.validator.js:80`'de ESM modülünü `loadEsm(...)`
ile yüklüyor ve 96-111 satırlarındaki `try/catch`, o yükleme hata attığında çıplak bir
`return false` ile bitiyor. Catch bloğu başarısızlığı hakkında log basacak kadar tanıyor — 99-105
satırları `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING`, `Cannot find module` ve `ERR_MODULE_NOT_FOUND`
ile eşleşiyor ve "If you are using Jest, run it with `NODE_OPTIONS=\"--experimental-vm-modules\"`"
diye uyarıyor — ve sonra yine de `false` dönüyor. API'nin Jest yapılandırması altında bu, gerçek
bir PNG'in doğrulamayı geçemediği ve çağıranın, kullanıcının yanlış dosya eklemesinden ayırt
edilemeyen bir `415` aldığı anlamına gelir. Başarısızlık biçimi, kullanıcı hatasının cevap kodunu
giymiş bir yapılandırma hatasıdır; bu, 0022'nin `transformException` paragrafıyla aynı tehlike
sınıfıdır ve onun yanında durur. Karar: `await import('file-type')` etrafında kendi ince
sarmalayıcımız — başarısız bir import'un, uydurduğumuz bir doğrulama sonucu değil, fırlattığımız
bir hata olduğu yer.

**`file-type` neden doğrudan bağımlılık oluyor.** 0022 ne `multer`'ın ne `file-type`'ın yeni bir
kurulum olmadığını doğru saptamıştı ve bu hâlâ doğru: `pnpm why`, `multer@2.2.0`'ı
`@nestjs/platform-express@11.1.28` üzerinden, `file-type@21.3.4`'ü ise `@nestjs/common@11.1.28`
üzerinden çözüyor; orada tam sürümle sabitlenmiş (`"file-type": "21.3.4"`, aralık değil). Tam
sabitleme, transitive bağımlılığı bugün güvenli, yarın kırılgan yapan şeydir: sürüm tamamen
`@nestjs/common`'ın seçimidir, dolayısıyla rutin bir Nest yaması, kendi doğrulama yolumuzun isimle
import ettiği bir paketi, kendi `package.json`'ımızda onu karşılaştıracak hiçbir kayıt olmadan
oynatabilir. `file-type` aynı sürümle `apps/api/package.json`'a ekleniyor; böylece ona gelen bir
değişiklik, kimsenin okumadığı bir lockfile parçasının içinde değil bizim diff'imizde görünüyor.
`multer` transitive kalır — onu hiç import etmiyoruz, `FileInterceptor` üzerinden yapılandırıyoruz.

## Sonuçlar

**P3-1'in yüzeyi 0022'nin tarif ettiğinden büyük.** Link yolu ikinci bir oluşturma formu, ikinci bir
DTO dalı, görev panelinde ikinci bir render ve kendi doğrulaması demek. Bu iş zaten geliyordu — §7
karar 4 ona söz vermişti — ama bir ADR'da değil bir plan belgesinde söz verildi, dolayısıyla
0022'ye iliştirilmiş tahmin onu içermiyor. Burada adlandırılması meselenin kendisi; alternatifi onu
P3-3 sırasında keşfetmekti.

**İki `ActivityType` sabiti artık kalıcı.** `activity.ts:11-13`, bir satır var olduktan sonra
isimleri yeniden adlandırılamaz kılıyor; dolayısıyla bu ADR'ın gözden geçirilmesi, onlar hakkında
tartışmanın ucuz olduğu son an. Onları `AUDIT_ACTIVITY_TYPES`'a eklemek ayrıca, dosya ekleri
teslim edildiği gün her mevcut workspace için denetim sorgusunun ne döndürdüğünü değiştiriyor —
önce erişim ve yok etme olaylarından ibaret olan bir akış sıradan içerik olayları kazanıyor ve o
listeyi "yalnızca güvenlikle ilgili" diye okuyan biri, karşılığında bir olay olmadan bir hacim
değişimi görüyor.

**P3-4, bu ADR'ın seçtiği bir biçimde zorlaşıyor.** `User`'a giden bir `Restrict` FK daha, bir
anonimleştirme tasarımının etrafından dolaşması gereken bir ilişki daha demek ve
`audit/ROADMAP.md:372` `Restrict` FK'leri zaten bugün bir silme talebinin yerine getirilememesinin
sebebi olarak sayıyor. Hafifletici gerçek şu: `Attachment.uploadedById`, `Comment.userId` ile
birebir aynı davranıyor, dolayısıyla o tasarıma yeni bir vaka değil hacim ekliyor.

**Proxy sözleşmesi artık salt yönlendirmeyle ilgili değil.** Bugüne kadar üç `handle` kuralı ve
operatörün yerine nginx ya da Traefik koyabileceği sözüydü. Artık ayrıca, API'nin içindeki bir
değerle uyuşmak zorunda olan sayısal bir limit taşıyor — hem de tarif ettiği dosyayı değiştirecek
insanlar için açıkça yazılmış bir belgede. `docker/Caddyfile` ve `self-hosting.md`'nin nginx bloğu
satırı birlikte kazanıyor, ikisi de sayıyı yazıyor ve ikisi de birini tek başına değiştirmenin
hatalı yapılandırma olduğunu söylüyor — artı `self-hosting.md`'nin Türkçe kopyası, aynı PR'da.

**İnsanların isteyeceği bir şey artık reddedilmiş olarak yazılı.** Link önizlemeleri, kullanıcıların
yokluğunu fark ettiği bir özellik; D7 onu açık bırakmak yerine bariz uygulamasını kapatıyor. Onları
isteyen bir gelecek katkıcı ya bir SSRF yüzeyini bilinçli olarak, yeni bir ADR'da tartışılmış bir
allowlist ve resolver kontrolüyle kabul etmek ya da isteği API'nin atmadığı istemci tarafına itmek
zorunda. Paragraf, o seçimin açıkta yapılması için var.

**Ofis formatı girdileri allowlist'in bakım maliyeti.** OpenXML ve OpenDocument medya tipleri uzun,
yanlış yazması kolay ve magic byte'larının hepsi bir ZIP kabı — `file-type`, daha derine bakmadığı
sürece bir `.docx` için `application/zip` raporlar. Bu etkileşim, D3'ün yanlış uygulanma şansı
gerçek olan tek parçası ve `application/zip`'in listede olmasının tesadüf değil kolaylık olmasının
sebebi: düz bir arşiv gibi koklanan bir ofis belgesinin geri düşüşü hâlâ kabul edilen bir tip
oluyor, kullanıcıya çıkan bir 415 değil.

**Artık üçüncü bir modül görev modülünün okuma yoluna bağımlı.** `attachment/`,
`ChecklistService`'in `TaskReadService`'ten aldığı tenant çözümlemesinin aynısına ihtiyaç duyuyor
ve `task.module.ts` onu bilinçli olarak export etmiyor. Ya `TaskService` bunun için dar bir metot
kazanır ya da attachment modülü görevi aynı ilişki-yolu `where`'i ile kendisi Prisma üzerinden
çözer. Uygulama planı birini seçer; bu ADR, D11'deki sapmanın bedelinin bu olduğunu not eder.

## Değerlendirilen alternatifler

| Alternatif                                                                             | Neden olmaz                                                                                                                                                                                                               |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kind` eklemek yerine linki `mimeType`'ın null olmasıyla ayırt etmek                   | Veritabanının zorlayabileceği bir değişmezi yalnızca uygulamanın hatırladığı bir değişmeze çevirir; hem URL'i hem depolama anahtarı olan ya da ikisi de olmayan satırı hiçbir şey engellemez ve ilkini bir importer yazar |
| `Attachment`'ın yanında ayrı bir `TaskLink` modeli                                     | İki model, iki uç ailesi, iki activity sözlüğü ve panelin birleştirip sıralaması gereken iki liste sorgusu — kullanıcıların zaten "bu karta iliştirilmiş şeyler" dediği tek bir şeyi temsil etmek için                    |
| `image/svg+xml`'e allowlist'te izin vermek                                             | SVG, `<script>` taşıyabilen bir işaretlemedir ve `inline` servis edilen tek aile görsellerdir — onu içeri almak inline önizleme kararını API origin'inde saklanan XSS'e çevirir                                           |
| Her şeyi `Content-Disposition: attachment` ile servis etmek, hiç inline olmasın        | 0022'nin desteklemeye zaten karar verdiği görsel önizlemesini görev panelinden kaldırır; güvenlik kazancı `nosniff`, CORP ve koklanan `Content-Type` ile çok daha ucuza elde edilebiliyor                                 |
| Sunucu tarafı link önizlemesi ya da unfurl (başlık, favicon, metadata)                 | `postgres` ve `redis`'in isimle çözüldüğü bir Compose ağının içinde, kullanıcının verdiği bir URL'e sunucu tarafı istek bir SSRF primitifidir; özellik kozmetik, yetenek değil                                            |
| Nest'in `FileTypeValidator`'ını `NODE_OPTIONS=--experimental-vm-modules` ile kullanmak | Kendi uyarı metni bunu öneriyor, ama bayrağın her koşucuda, her CI işinde ve her IDE'de doğru olması gerekirdi; olmadığında validator sessizce `false` döner ve geçerli bir PNG kullanıcının hatasıymış gibi reddedilir   |
| Boyut limitini yalnız proxy'de tutmak                                                  | Multer'ın `limits.fileSize`'ı varsayılan olarak sınırsız, dolayısıyla API değiştirilmiş ya da hatalı yapılandırılmış bir proxy'nin geçirdiği her şeyi kabul eder ve Caddy'yi değiştiren için limit tamamen kaybolur       |
| API ve proxy limitlerinin bağımsız ayarlanabilmesi                                     | Farklı sayılar, 0022'nin proxy satırını eklemesine yol açan izi sürülemeyen `413`'ü aynen üretir: bir yön başarısız bir yükleme için başarılı bir vekil isteği loglar, diğeri hiçbir şey loglamaz                         |
| Denormalize bir `Attachment.workspaceId` kolonu                                        | `Task` da taşımıyor; ilişki yolu her görev alt kaynağının zaten kullandığı şekildir ve kopyalanmış bir tenant id'si, ilkiyle çelişebilen ikinci bir doğruluk kaynağıdır                                                   |
| Depolama yolunu yüklenen dosya adından kurmak                                          | Path traversal'ı, anahtarın satırın kendi UUIDv7'sinden geldiği için ifade bile edilemeyen bir sorun olmaktan çıkarıp sonsuza dek her yazma yolunda doğru çözülmesi gereken bir doğrulama sorunu yapar                    |
| `uploadedById` olmasın; yükleyen activity izinden okunsun                              | "Bunu kim yükledi"yi nesnenin bir özelliği olmaktan çıkarıp denetim loguna karşı bir sorguya çevirir — iz bir olayın olduğunu kaydeder, satır ise o olayın ürettiği şeydir                                                |
| Checklist emsalini izleyip dosya ekleri için activity satırı yazmamak                  | Silinen bir checklist maddesi yeniden yazılabilir; silinen bir dosya sahipsiz dosya süpürmesiyle diskten de alınır ve activity satırı onun var olduğuna dair tek kanıt hâline gelir                                       |
| Yeni bir `attachment:added` / `attachment:removed` socket event'i                      | ADR 0023 bunu iki özellik için de karara bağladı ve faz planı kararı önce teslim edene vermişti; yeniden karar vermek, yeni bir gereksinim olmadan realtime sözleşmesini çatallardı                                       |
| Uçları checklist şekline uyup `TaskController`'a bağlamak                              | Yayınlanan beş uçtan üçü bir görev üzerinden adreslenmiyor ve modül bir depolama portu, bir multer interceptor'ı ve API'nin bayt akıtan tek handler'ını taşıyor                                                           |
| `file-type`'ı `@nestjs/common`'ın transitive bağımlılığı olarak bırakmak               | Orada tam sürümle sabitlenmiş, dolayısıyla sürümü değiştirmek Nest'in elinde; rutin bir yama, doğrulama yolumuzun isimle import ettiği paketi kendi `package.json`'ımızda karşılaştıracak bir kayıt olmadan oynatabilir   |
