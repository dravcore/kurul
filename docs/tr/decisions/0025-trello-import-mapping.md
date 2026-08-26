# 0025. Trello Import Eşlemesi: Hiçbir Şey Tahmin Edilmez, Gelmeyen Her Şey Sayılır

**Durum:** Kabul edildi
**Tarih:** 2026-08-15

> 🌐 [English (kanonik)](../../decisions/0025-trello-import-mapping.md) | Türkçe — Bu çeviri güncel olmayabilir; kanonik kaynak İngilizce'dir.

## Bağlam

Bu kaydın hizmet ettiği ROADMAP kalemi tek yönlü bir Trello JSON import'u: board, liste, kart,
label ve checklist; dosya ekleri URL olarak taşınıyor. Kapsam bilerek dar; dar olmayan şey,
Trello'nun modeliyle Kurul'un modelinin örtüşmediği yerlerin sayısı — yani bir import'un ya
tahmin etmek ya da tahmin edemeyeceğini kabul etmek zorunda kaldığı yerler.

Girdinin üç özelliği aşağıdaki her kararı şekillendiriyor.

**Trello'nun export şemasında sürüm alanı da yok, değişiklik kaydı da.** Bugün alınan bir export
ile gelecek yıl alınan bir export alan adlarında, iç içe geçme yapısında ve isteğe bağlı
dizilerin hangilerinin hiç bulunduğunda farklılaşabilir. Dolayısıyla "Trello import çalışıyor"
bir tarih hakkında ve o tarihte elde olan dosyalar hakkında bir iddiadır; Trello hakkında değil.

**Bu kaydın yazıldığı tarihte elde tek bir gerçek export yoktu.** `apps/api/test/fixtures/trello/`
altındaki fikstürlerin hepsi elle yazıldı ve README'leri bunu ilk paragrafında söylüyor. Bu bir
dipnot değil, sonucu olan bir sınırlama: import'un okuduğu her alan adı hafızadan yazıldı ve
hiçbir şeye karşı doğrulanmadı. "Üç gerçek export'la doğrulandı" diyen ROADMAP metriği tam da bu
yüzden **partial** kapanıyor ve ilk gerçek export elimize geçtiğinde yeniden açılıyor.

**Trello'nun sözlüğü kimi yerde Kurul'unkinden geniş, kimi yerde ise karşılığı hiç yok.**
Trello'nun on label rengi var; bu deponun sekiz tasarım-token slotu. Trello'da arşivlenmiş liste
ve kart var; Kurul'da arşiv kavramı yok. Trello'da kartın üyeleri var; Kurul'un üyeleri
başka bir tenant'ın kullanıcı tablosundaki satırlar. Trello'da yorum var; bu import onları
taşımıyor.

Bu üç koşul altında bir eşleme iki çok farklı biçimde başarısız olabilir. **Yanlış** olabilir —
"Bitti" adlı bir sütunun tamamlanmış sütun olduğuna karar edip, yazarı import'un dilinde
düşünmeyen her board için yanılabilir. Ya da **eksik** olabilir — arşivlenmiş bir kartı düşürebilir
ve bunda haklı olabilir. Birincisi olmamalı. İkincisi **sesli** olmalı.

## Karar

**Bir board'un anlamına dair hiçbir şey çıkarsanmaz. Gelmeyen her şey sayılır ve cevabın gövdesinde
kullanıcıya gösterilir.**

Somut olarak:

### Yapı

| Trello              | Kurul                             | Not                                                      |
| ------------------- | --------------------------------- | -------------------------------------------------------- |
| board               | `Board`                           | `name`, `desc` → `description`                           |
| liste               | `Column`                          | her zaman `category: UNSTARTED` — aşağıya bakın          |
| kart                | `Task`                            | `name` → `title`, `desc` → `description`                 |
| label               | `Label`                           | renk bir slota eşlenir, isim boşsa üretilir              |
| kart ↔ label        | `TaskLabel`                       | `idLabels` üzerinden                                     |
| checklist           | `Checklist`                       | Trello checklist'i başına bir satır, asla düzleştirilmez |
| `checkItem`         | `ChecklistItem`                   | `state === 'complete'` → `isDone: true`                  |
| kart eki            | `kind: LINK` taşıyan `Attachment` | yalnız URL; sunucu o URL'e hiç istek atmaz               |
| kartın `due` alanı  | `Task.dueDate`                    | `estimatedMinutes` `null` kalır, ikisi aynı alan değil   |
| üye                 | —                                 | düşürülür, sayılır                                       |
| yorum (`actions[]`) | —                                 | düşürülür, sayılır                                       |
| `closed: true`      | —                                 | düşürülür, sayılır                                       |

### Sütun kategorisi asla tahmin edilmez

İçe aktarılan her sütun şema varsayılanını — `UNSTARTED` — istisnasız alır, ve rapor kaç sütunun
bu durumda olduğunu söyleyen tek bir `(column, defaulted)` satırı taşır.

### Pozisyon sıralama için okunur, sonra atılır

Trello'nun `pos` değeri kardeşlerin sırasını belirler; `Column.position` ve `Task.position`'a
yazılan değerler `rebalancePositions`'tan gelir. Eşitlikler, eksik değerler ve sayısal olmayan
değerler (Trello bazen `"bottom"` string'ini yazıyor) Trello id'sine düşer; o id'nin baştaki sekiz
hex hanesi bir oluşturulma zaman damgasıdır — yani geri düşüş "yapıldıkları sıra"dır, yazı tura
değil.

### Label renkleri sekiz slota katlanır

| Trello rengi | Slot     | O slotun açık tema hex'i |
| ------------ | -------- | ------------------------ |
| `blue`       | `slot-1` | `#2a78d6`                |
| `orange`     | `slot-2` | `#eb6834`                |
| `green`      | `slot-3` | `#1baf7a`                |
| `yellow`     | `slot-4` | `#eda100`                |
| `pink`       | `slot-5` | `#e87ba4`                |
| `lime`       | `slot-6` | `#008300`                |
| `purple`     | `slot-7` | `#4a3aa7`                |
| `red`        | `slot-8` | `#e34948`                |
| `sky`        | `slot-1` | `blue` ile paylaşır      |
| `black`      | `slot-7` | `purple` ile paylaşır    |

Yeni export'ların yazdığı `_dark` / `_light` sonekleri (`purple_dark`, `sky_light`) aramadan önce
kırpılır — bunlar tek bir rengin ton türevleridir ve bu depoda renk başına bir slot vardır, ton
başına değil.

Bilinmeyen bir renk adı da `null` bir renk de `slot-1`'e düşer ve ikisi de rapora bir
`(label, defaulted)` satırı ekler. İsmi boş olan bir label'a Trello renk adı isim olarak verilir
(`"green"`), rengi de yoksa `"Label"` — çünkü `Label.name` nullable değil ve bir şey yazmak
zorunlu.

Yukarıdaki hex sütunu, slot numaralarının **nereden geldiğinin** belgesidir
(`apps/web/app/globals.css:40-47`), saklanan bir değer değil. `Label.color` slot adını saklar.
Aynı dosyanın `:95-102`'deki koyu tema bloğu aynı sekiz slot adını farklı hex'lerle tanımlıyor —
kolonun neden renk değil slot sakladığının kanıtı tam olarak budur.

### Yazma atomik, kapsam kısmi

Board, sütunlar, label'lar, kartlar, checklist'ler, maddeler ve link'ler tek bir transaction'da
yazılır. Yarım import edilmiş board yoktur. O transaction'a **neyin gireceği** öncesinde, hiç
veritabanına dokunmayan saf kodda kararlaştırılır: transaction'a ulaşan bir satır yazılabilir
olduğu bilinen satırdır ve içeride "bu olmadı, devam et" yoktur.

### Rapor cevabın kendisidir

`201 Created` bir `TrelloImportReportDto` döndürür: yaratılan board'un id'si ve adı, yazılan satır
türü başına bir sayı, ve bir atlama grupları listesi. Bir grup, gerçek bir sayı ve en fazla yirmi
örnek isim taşıyan bir `(scope, reason)` çiftidir. Sayı asla kırpılmaz; kırpılan yalnız
örneklerdir. Rapor hiçbir yerde saklanmaz.

Atlama sözlüğü kapalıdır: `outOfScope`, `archived`, `unmappable`, `unsupportedScheme`,
`malformed`, `defaulted`. `defaulted` bir kayıp değil bir **ikame** tarif etmesine rağmen bu
listede, çünkü kullanıcının import'tan sonra sorduğu soru "neyi kaybettim" değil, "board'um neden
farklı görünüyor" — ve varsayılana düşmüş bir renk o cevabın parçası.

### Okuyucu anlamadığı şeyi çökmek yerine raporlar

Bu import'taki hiçbir alan adı gerçek bir export'a karşı doğrulanmadığı için okuyucunun sözleşmesi
"Trello şemasını biliyorum" değil, **"bilmediğimi bildiririm"**. Eksik bir alan, beklenmedik tipte
bir alan, ya da okuyucunun temsil edemeyeceği bir kayıt aynı `(scope, reason)` raporuna düşer ve
okuma devam eder. Yalnız iki şey hatadır: gövdenin hiç JSON olmaması, ve kök nesnenin bir board
export'una benzememesi.

### Aynı export'u iki kez import etmek iki board üretir

Tekilleştirme de yok, yerinde güncelleme de. Davranış bir testle çivileniyor ve kullanıcıya dosya
seçmeden **önce** import diyaloğunda söyleniyor.

### Import başına tek bir activity satırı

`board.imported`, bir kez, sayıları payload'ında taşıyarak — kart başına bir `task.created` değil.
`board.created`'ın yanında denetim alt kümesine girer.

## Gerekçe

### Sütun kategorisi neden hiç çıkarsanmıyor

[ADR 0019](0019-column-category.md) var, çünkü Kurul eskiden tamamlanmışlığı sütunun adından
çıkarsıyordu; ve o ADR çıkarsamanın üç yolunu adıyla anıp üçünü de reddediyor:

- **İsimle eşleme yumuşatılmadı, kaldırıldı** (`0019-column-category.md:51-52`). "Done"u
  "Shipped" yapan bir kullanıcı tamamlanma metriklerini sessizce sıfırlar ve hiçbir şey hata
  vermez.
- **Konumdan türetme adıyla reddedildi** — "son sütun done" (`:113`) — çünkü board'lar meşru
  biçimde "Blocked", "Archive" ya da "Won't Do" ile bitebilir.
- **Yerelleştirilmiş isim zaten sinyal değil** (`:25-30`): ADR 0018 varsayılan sütun adlarını
  yaratıcının diliyle seed ediyor, yani Türkçe bir board `Bitti` ile başlıyor ve `'done'` ile hiç
  eşleşmiyor.

Bir Trello export'unda kategori yok. Elde yalnız iki sinyal var — isim ve konum — ve ikisi de o
listede. Yani çıkarsanacak bir şey kalmıyor; yine de çıkarsamak, ADR 0019'un kaldırdığı defekti
**daha çok** ıskalayacağı bir yerde geri koymak olurdu: bir Trello board'unun sütun adları herhangi
bir dilde herhangi bir şey olabilir, oysa ADR 0019'un kendi migration'ı yalnız Kurul'un kendi
seed ettiği İngilizce `Done`'ı tanıyordu. O migration (`:55-56`) isimle eşlemeye emsal gibi
görünüyor ama değil — bilinen bir yazıcının bilinen çıktısını tanıyordu.

Çıkarsamamanın bedeli gerçek ve bedeli kullanıcı ödüyor: import'tan sonra her sütun `UNSTARTED`
olduğu için, kullanıcı sütun ayarlarını açana kadar dashboard'lar hiç tamamlanmış iş göstermez. O
yüzey zaten var — ADR 0019 onu şart koşmuştu (`:95-96`, `column-settings-dialog.tsx`) — ve rapor
kullanıcıya orada kaç sütunun beklediğini söylüyor. Raporlanan bir kapsam daralması, raporlanmayan
bir kapsam daralmasından başka bir şeydir.

### İdempotans neden yok

Tekilleştirme saklanan bir dış tanımlayıcı ister, ve o tanımlayıcının unique kapsamı burada
gerçekten kararlaştırılamaz. Aynı Trello board'unu iki farklı workspace'e import etmek meşru. Aynı
workspace'e iki kez import etmek de meşru — bir kopya çıkarmanın yolu bu. Bir `Board.externalId`
kolonu bunlardan birini yasaklamak zorunda kalırdı ve ikisi de yanlış değil.

"Var olan board'u güncelle" daha katı bir import değil, **senkronizasyondur**. Çakışma politikası,
silme yayılımı ve bir yön ister; ROADMAP satırı ise tek yönlü import istiyor.

Hafif görünen alternatif — board adı zaten varsa import'u reddet — hiçbir şey yapmamaktan kötü,
çünkü iki board'un aynı adı taşıması bugün meşru ve bu kural alakasız bir board'un import'u
engellemesine yol açardı.

Yani davranış şu: iki import, iki board, ayrık id'ler, iki kat kart. Kazayla değişmesin diye bir
testle çivileniyor, sürpriz olmasın diye diyalogda yazıyor.

### Arşivlenmiş liste ve kart neden düşürülüyor

`closed: true` Trello'nun arşividir. Kurul'da arşiv yok, yani arşivlenmiş bir kart ancak normal
bir kart olarak gelebilir — yani kullanıcının bilerek görüş alanından kaldırdığı şey, önüne geri
konur. Uzun ömürlü 500 kartlık bir board'un arkasında çoğu zaman bunun birkaç katı arşivlenmiş kart
durur, yani bu bir yuvarlama hatası da değil.

### Yorumlar neden sessizce yok sayılmıyor da sayılıyor

Yorumlar `actions[]` içinde durur ve genellikle bir export'un en büyük parçasıdır. ROADMAP
satırının kapsamı dışındalar. Board'unu import edip hiç yorum bulamayan bir kullanıcı, aksi hâlde
import'un başarısız mı olduğunu yoksa hiç denemediğini mi tahmin etmek zorunda kalırdı; gerçek
sayıyı taşıyan bir `(comment, outOfScope)` satırı bunu cevabın içinde yanıtlıyor.

### Üyeler neden düşürülüyor

Bir Trello üyesi bir Kurul kullanıcısı değildir. Export güvenilir biçimde e-posta taşımıyor,
taşıdığı durumda bile onunla eşleşmek, işi bugün o adrese sahip olan kişiye atamak demek olurdu.
Bu import'un yazdığı her satır, import'u koşturan kişiyi `createdById` / `uploadedById` alanına
yazar. Bu bir eşleme değil — bir sorumluluk kaydı, ve dürüst olanı bu.

### Ekler neden link oluyor ve sunucu neden istek atmıyor

Trello'nun export'u bir dosya değil, çoğu zaman Trello kimlik doğrulaması gerektiren bir URL
veriyor. Onunla dürüstçe yapılabilecek şeyin tamamı bir `AttachmentKind.LINK` satırı yazmaktır —
[ADR 0024](0024-attachment-kinds-and-serving-policy.md) o tipi tam da bu import için ekledi.

Sunucu o URL'lere istek atmıyor, ve bu bir performans kararı değil bir güvenlik kararı: "önizleme
getir" adımı, sunucuya kullanıcının seçtiği herhangi bir adrese istek attırma **yeteneğidir** ve
böyle bir yetenek bir kere var olduğunda tek bir import'la sınırlı kalmaz. Ek URL'leri API'nin geri
kalanının kullandığı kurala tabidir — yalnız `http:` ve `https:` — ve başka her şey
`(attachment, unsupportedScheme)` olarak sayılır.

### Checklist'ler neden düzleştirilmiyor

[ADR 0023](0023-checklist-data-model.md) kart başına çoklu liste modelini seçti ve
`0023-checklist-data-model.md:122-127` gerekçe olarak tam da bu import'u anıyor. Trello kartları
rutin olarak birkaç checklist taşır; tek listeli bir model bu import'u onları birleştirmeye ve
kullanıcının kurduğu gruplamayı kaybetmeye zorlardı. Bir Trello checklist'i bir `Checklist`
satırıdır.

## Sonuçlar

- **Import'tan sonra sütun kategorileri, bir insan düzeltene kadar yanlıştır.** Her sütun
  `UNSTARTED` olduğu için tamamlanma metrikleri sıfır okur. Rapor kaç sütun olduğunu söyler,
  sütun ayarları diyaloğu da düzeltildikleri yerdir. Bu, tahmin etmemenin bilinçli bedeli.
- **Kullanıcı aynı dosyayı iki kez import edip iki board elde edebilir.** Toparlamanın yolu birini
  silmek.
- **Rapor saklanmaz.** Paneli okumadan kapatan kullanıcı neyin gelmediğinin listesini kaybeder;
  board etkilenmez. Web bunu tıklanıp geçilebilen bir diyalog olarak değil, kapatılana kadar duran
  bir panel olarak gösteriyor.
- **İki Trello rengi başka iki renkle slot paylaşıyor.** Trello'da görsel olarak ayrışan iki label
  aynı renkle gelebilir. Alternatif, tek bir import için paleti büyütmek ya da temanın
  çözemeyeceği bir hex saklamaktı.
- **"Trello import çalışıyor" bir tarih hakkında bir iddiadır.** Fikstürler ne zaman yazıldıklarını
  kaydediyor, ve bu tarihte hiçbiri gerçek bir export değil. İlk gerçek export'un bu deponun
  yanlış bildiği alan adlarını bulması muhtemel; okuyucu bunu başarısız bir import yerine rapor
  satırı üretecek biçimde kuruldu, ama yine de eksikleri olan bir import üretecek.

## Değerlendirilen alternatifler

| Alternatif                                                 | Neden olmadı                                                                                                                                                                                     |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| "done" adlı sütundan `COMPLETED` çıkarsamak                | ADR 0019'un kaldırdığı defektin ta kendisi (`:51-52`); bir Trello sütunu her dilde herhangi bir şey olabilir, yani ADR 0019'un yazıldığı durumdan daha kötü                                      |
| Kategoriyi konumdan türetmek ("son sütun done")            | ADR 0019 bunu adıyla reddediyor (`:113`); board'lar meşru biçimde "Blocked" ya da "Won't Do" ile biter                                                                                           |
| İdempotans için bir `Board.externalId` kolonu              | Unique kapsamı kararlaştırılamaz — aynı board'un iki workspace'e girmesi de, bir workspace'e iki kez girmesi de meşru; isimle tekilleştirme ise alakasız bir board'un import'u engellemesi demek |
| Kuyruk + bir `ImportRun` tablosu                           | Raporu saklamak bir durum ucu, bir polling döngüsü ve bir retention kuralı demek — cevabı zaten bekleyen bir okuyucu için tek atımlık bir eyleme dört yeni yüzey                                 |
| Trello `pos` değerlerini `position`'a olduğu gibi yazmak   | Yepyeni bir board'u eski board'un kaydığı boşluk deseniyle, `MIN_GAP`'e doğru daralmış boşluklar dahil, tohumlar; yeniden üretmek bedava                                                         |
| Arşivlenmiş liste ve kartları normal olarak import etmek   | Kullanıcının bilerek kaldırdığını, canlı board'un birkaç katı hacimle geri koyar                                                                                                                 |
| Trello üyelerini e-postayla kullanıcılara eşlemek          | Export güvenilir biçimde e-posta taşımıyor, ve eşleşmek işi bugün o adrese sahip olan kişiye atardı                                                                                              |
| Ek URL'lerini getirip baytları saklamak                    | Sunucuya kullanıcının seçtiği herhangi bir adrese istek atma yeteneği verir — import'la sınırlı kalmayan bir SSRF yeteneği (ADR 0024)                                                            |
| Bir kartın checklist'lerini tek listeye düzleştirmek       | Kullanıcının kurduğu gruplamayı atar, ve ADR 0023'ün çoklu-liste modelini seçme gerekçesiyle çelişir (`:122-127`)                                                                                |
| Eşlenemeyen bir Trello rengi için ham hex saklamak         | `Label.color` tema tarafından çözülen bir slot saklar; bir hex'i aynı slotları farklı değerlerle tanımlayan koyu tema çözemez                                                                    |
| Bir alan eksik ya da tuhaf tipteyken tüm dosyayı reddetmek | Buradaki hiçbir alan adı gerçek bir export'a karşı doğrulanmadı; bu, her şema kaymasını bir rapor satırı yerine tam bir başarısızlığa çevirirdi                                                  |

## Değişiklik (2026-08-26): alan uzunluğu tavanları ve satır sayısı tavanı (SEC-04)

Bir denetim bulgusu (SEC-04), bu importer'ın diğer her yazma yolunun uyguladığı uzunluk
kontrollerini atladığını gösterdi. `Task.title`, `Task.description`, `Board.name`,
`Board.description`, `Checklist.title`, `Column.name`, `Label.name`, `ChecklistItem.content` ve
`Attachment.url`, diğer her rotada `CreateTaskDto`, `CreateBoardDto`, `CreateChecklistDto`,
`CreateColumnDto`, `CreateLabelDto`, `CreateChecklistItemDto` ve `CreateAttachmentDto` üzerinden
veritabanına ulaşıyor, ve bunların her biri kendi alanını `@MaxLength` ile işaretliyor. Planner
ise `card.name`, `card.desc`, export'un kendi board adı ve açıklaması, `checklist.name`,
`list.name`, `label.name`, bir check item'ın `name` alanı ve bir ekin `url` alanını böyle bir
tavan olmadan doğrudan yazıyordu, yani bir Trello export'u bu dekoratörlerin korumadığı tek
kapıydı. Export'taki hiçbir şey bu şekilde yazılmakla kötü niyetli hale gelmiyordu; risk,
kimsenin kaydıramayacağı bir board ve ürünün bir kolonun tutmasını hiç istemediği kadar veri
tutan bir veritabanı sütunuydu.

`trello-import-planner.ts` artık bu alanların her birini DTO'nun kullandığı aynı sabite kısıtlıyor.
Her DTO çifti (create ve update), tavanını yanındaki tek dosyadan import ediyor, toplam altı dosya
(`task/dto/task-limits.ts`, `board/dto/board-limits.ts`, `board/dto/column-limits.ts`,
`label/dto/label-limits.ts`, `task/dto/checklist-item-limits.ts` ve
`attachment/dto/attachment-limits.ts`), ve planner da aynı altı dosyayı import ediyor, yani her
sayı bir kez var oluyor. Kesilen bir görev başlığı ya da açıklaması, bu raporda başka bir yerde
zaten kullanılan aynı gerekçeyle tek bir `(card, defaulted)` satırı olarak raporlanır (bilinmeyen
bir etiket rengi, varsayılan bir sütun kategorisi gibi): kart yine de import edilir, ve raporun
cevapladığı soru "board'um neden farklı görünüyor" sorusudur, bunu bir kısıtlama da bir renk
değişimi kadar iyi cevaplar. Kesilen bir checklist başlığı ya da bir checklist item'ın içeriği de
aynı şekilde, sırasıyla `(checklist, defaulted)` ve `(checklistItem, defaulted)` altında
raporlanır. Kesilen bir label adı, bilinmeyen bir rengin zaten ürettiği `(label, defaulted)`
satırına katılır; Karar tablosunun bunları birleştirme gerekçesiyle aynı gerekçeyle: kullanıcının
tanımadığı bir label tek bir sorundur, kaç alanı değişmiş olursa olsun. Kesilen bir ek URL'si
`(attachment, defaulted)` altında raporlanır. Bir sütunun adı, her import edilen sütunun zaten
aldığı kategori varsayımıyla aynı rapor satırını paylaşır (`(column, defaulted)`, sayı sütun
sayısına eşit): aynı sütun için ayrı, ikinci bir satır onu iki kez saymış olurdu, bu yüzden
kısıtlama ayrı bir satır eklemek yerine o satırın örnek metninin ne söyleyebileceğini değiştirir.
Board'un kendi adı ve açıklaması sessizce kısıtlanır: yukarıdaki kapalı kelime dağarcığında bir
`board` kapsamı yok, bir board bir satır sınıfı değil tek bir satır, ve yalnızca "1" diyebilecek
bir `(board, defaulted)` satırı kullanıcının davranabileceği hiçbir şey söylemez, bu da
`trello-export.ts`'in board'un kendi açıklaması kullanılamaz olduğunda zaten uyguladığı
gerekçenin aynısı.

Aynı tavan, yalnızca yazmayı değil _raporu_ da sınırlıyor. Planner'ın yazmak yerine düşürdüğü bir
satır (arşivlenmiş bir liste ya da kart, export'ta bulunmayan bir label id'sine işaret eden bir
kart, reddedilen bir ek, kartı düşürüldüğü için düşen bir checklist) yine de bir adı yanıt
gövdesinde örnek olarak alıntılıyor, ve o ad export'tan geliyor, kısıtlanmamış olarak, tıpkı
yukarıdaki alanlar gibi. Bu örnek noktalarının her biri artık metnini, tanımladığı satır yazılmış
olsaydı nasıl kısıtlanacak ya da temizlenecek idiyse öyle kısıtlıyor ya da temizliyor (label-id
durumunda kabul edilen kartın kendi zaten kısıtlanmış başlığı; reddedilen bir ek için
`safeDisplayName`; düşen bir liste ya da checklist için sütun/checklist tavanları), yani oversized
bir alan hakkındaki bir rapor, hiçbir yolda kendisi sınırsız bir string taşıyamaz.

Aynı bulgunun adlandırdığı ikinci bir boşluk: bir export'un bu API'den planlamasını isteyebileceği
satır sayısını hiçbir şey sınırlamıyordu. `TRELLO_IMPORT_MAX_BYTES` ayrıştırılmış nesne grafiğinin
boyutunu sınırlar, satır sayısını değil, ve küçük bir kart birkaç düzine bayt olabilir, yani 20
MiB'lik bir export yine de birkaç yüz bin küçük kart olabilir. `TrelloImportService` artık
export'un ham `lists.length` ve `cards.length` değerlerini, planner çalışmadan ve transaction
açılmadan önce `TRELLO_IMPORT_MAX_CARDS` (varsayılan 50000) ve `TRELLO_IMPORT_MAX_LISTS`
(varsayılan 5000) değerlerine karşı denetler; bu tavanlardan birini aşan bir export `400` döner ve
hiçbir şey yazmaz. Sayılar, arşivlenmiş ya da bozuk girdiler ayıklanmadan önce alınır, çünkü bu
tavanların var olma sebebi olan maliyet (ayrıştırılmış grafiğin tuttuğu heap, ve writer'ın
`createMany` dizisinin uzunluğu), Trello'nun yazdığı her satır için ödenir, yalnızca import
edilebilir olanlar için değil.

`readTrelloImportMaxCards` ve `readTrelloImportMaxLists`, hatalı yapılandırılmış bir değerde düz
bir `Error` fırlatıyor, `readTrelloImportMaxBytes`'ın zaten kullandığı aynı gelenekle: hatalı bir
değer bir sonraki import'ta bir `500`'dür, boot'u reddetmek değil. Bu, ADR 0032'nin plan
tavanlarından bilinçli bir sapmadır; onlar boot'ta reddediyor, çünkü onlar
`readInstancePlanLimits()` tarafından boot'ta bir kez okunuyor ve bir daha hiç okunmuyor, oysa
buradaki her import tavanı `import-config.ts`'de verilen gerekçeyle (bir test ya da bir operatör
restart'ı, gerçekten ayarlanmış değeri görmeli) zaten her istekte okunuyor. Bu ikisi için boot-time
doğrulama eklenmedi, yani hatalı yapılandırılmış bir `TRELLO_IMPORT_MAX_CARDS`, kendi yeni bir
başarısızlık modu kazanmak yerine bayt-tavanı kardeşinin zaten yaptığı şekilde başarısız oluyor.

İki değişiklik de yukarıdaki Karar bölümüne dokunmuyor: kapalı kelime dağarcığı değişmedi, yapı
tablosu değişmedi, ve yazma hâlâ veritabanına hiç erişmeden kurulan bir plan üzerinden tek bir
atomik transaction.
