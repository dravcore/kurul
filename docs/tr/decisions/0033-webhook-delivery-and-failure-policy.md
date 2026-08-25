# 0033. Webhook Teslimi ve Hata Politikası: Workspace'e Ait Endpoint'ler, Bir Outbox Satırı ve İmzalı Bir Zarf

**Durum:** Önerildi
**Tarih:** 2026-08-26

> 🌐 [English (kanonik)](../../decisions/0033-webhook-delivery-and-failure-policy.md) | Türkçe (bu çeviri güncel olmayabilir; kanonik kaynak İngilizce'dir)

## Bağlam

[ADR 0031](0031-api-versioning.md), webhook'ları 1.0 sıralamasının sonuna koydu, çünkü "imzalı
teslim ve bir hata politikası kendi ADR'lerini ve işaret edecekleri bir kontratı hak ediyor". Bu, o
ADR. Henüz hiçbir şema, route ve queue yokken yazıldı; böylece aşağıdaki sorular bir kez, burada
karara bağlanıyor, onları hayata geçiren pull request'te yeniden tartışılmıyor.

[ROADMAP.md](../../../ROADMAP.md)'nin "API 1.0" bölümü bugünkü şartnamenin tamamı: tam olarak üç
event (`task.created`, `task.moved`, `task.completed`), "workspace başına, operatörün yapılandırdığı
bir URL'e teslim", imzalı ve en-az-bir-kere, ve "bir implementasyon değil bir ADR isteyen" bir hata
politikası. Bu cümle, depodaki tek endpoint sahipliği ifadesi. Bir karar olarak değil, bir
dokümantasyon pull request'inde düzyazı olarak geldi ve bu kaydın onaylaması ya da değiştirmesi
gereken ilk şey o, çünkü aşağıdaki her şey ona bağlı: imzalama sırrının nerede yaşadığı, dışa giden
bir URL'in saldırgan kontrolünde olup olmadığı, hiç yönetim route'u olup olmayacağı ve işin bir M mi
yoksa L mi olduğu.

Genel tartışma [#254](https://github.com/dravcore/kurul/discussions/254)'te. Bir upvote'u ve hiç
yorumu yok. Proje dışından kimse bir kullanım senaryosu anlatmadı, dolayısıyla aşağıdakilerin hiçbiri
gerekçe olarak talebi gösteremez. Yapabileceği şey, ödeme yapan kitleye yapısal olarak hizmet
edemeyen varyantı seçmemek.

**Ağacın hâlihazırda sahip olduğu ve olmadığı şeyler.**

- Her task mutasyonu `Activity` satırını kendi transaction'ı içinde yazıyor:
  `ActivityService.record(tx, …)` transaction client'ını alıyor ve `TaskService` onu, yazma işlemini
  yapan `$transaction`'ın içinde çağırıyor. Bir outbox satırının ilk günden yazılacak bir yeri var.
- `task.moved` payload'ında `toColumnCategory`'yi snapshot'lıyor, `fromColumnCategory`'yi değil;
  dolayısıyla `COMPLETED`'dan `COMPLETED`'a bir taşıma ile `STARTED`'dan `COMPLETED`'a bir taşıma
  yalnızca satıra bakarak ayırt edilemiyor.
- `ActivityType` içinde `task.completed` ve `task.reopened` yok. Tamamlanma türetiliyor ve kod
  tabanındaki tek tanım dashboard'unki: hedef kolonu `COMPLETED` kategorisinde olan bir `task.moved`
  satırı ([ADR 0019](0019-column-category.md)).
- Bir kolonun kategorisi `PATCH` ile değiştirilebiliyor; bu, içinde duran her task'ın tamamlanma
  durumunu çeviriyor ama tek bir `column.updated` satırı yazıyor ve task başına hiçbir event
  üretmiyor.
- `task.moved` bir kart kendi kolonu **içinde** sürüklendiğinde de yazılıyor: aynı kolon içindeki bir
  yeniden sıralama, gerçek bir taşımayla aynı kod yolundan geçiyor.
- Bugün commit sonrası her yan etki, request process'i içinde ateşle-ve-unut:
  `realtime.emitToBoard` `$transaction` çözüldükten sonra çalışıyor ve `NotificationMailer` asla
  reject etmemesiyle belgeleniyor. İkisi de tasarım gereği en-fazla-bir-kere ve hiçbiri
  en-az-bir-kere teslimin kopyalanabileceği bir desen değil.
- BullMQ tam olarak iki dosyada import ediliyor, `notification/due-soon.worker.ts` ve
  `retention/cleanup.worker.ts`, ve ikisi de onu tekrarlayan bir zamanlayıcı olarak kullanıyor. Bir
  request yolundan hiçbir şey job kuyruğa atmıyor ve bir outbox tablosu yok.
- Personal access token'lar kimlik bilgisi emsalini kuruyor: diskte `sha256`, düz metin bir kez
  gösteriliyor ve [api-conventions.md](../api-conventions.md#kimlik-doğrulama) "bir veritabanı
  dump'ı kullanılabilir bir kimlik bilgisi vermez" ifadesini bir özellik olarak ilan ediyor.
- `TELEMETRY_ENDPOINT` API'deki tek dışa giden HTTP çağrı noktası ve üç yer bunu düzyazıyla
  söylüyor: `telemetry.service.ts`'teki sınıf yorumu, `telemetry.module.ts`'teki modül yorumu ve
  [development.md](../development.md).
- `apps/api/src/common` içinde dışa giden bir URL'i sınıflandıran hiçbir şey yok ve yayımlanan
  Compose yığını `postgres:5432`, `redis:6379` ve `web:3000`'i API container'ıyla aynı ağa koyuyor.
- `Activity` satırları zaten satır başına event olmadan toplu yazılabiliyor: bir Trello import'u
  kart başına bir `task.created` yerine bütün bir board için tek bir `board.imported` satırı yazıyor
  ([ADR 0025](0025-trello-import-mapping.md)).

## Karar

Birbirlerine bağlı oldukları sırayla on bir karar. İlki diğer onunun şeklini belirliyor.

### 0. Endpoint'lere operatör değil workspace sahip

Masada üç model vardı.

| Model                              | Ne anlama geliyor                                                                                                                                                                                                                               |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (a) Operatör, instance geneli      | `TELEMETRY_ENDPOINT` gibi ortamdan okunan `WEBHOOK_URL` ve `WEBHOOK_SECRET`, `docker-compose.yml`'de forward edilir, tüm deployment için tek bir hedef, her payload'da `workspaceId`. Tablo yok, yönetim route'u yok, tenant'ın verdiği URL yok |
| (b) Workspace                      | Bir `WebhookEndpoint` tablosu, workspace yönetim route'larıyla yönetilir, tenant'ın verdiği bir URL, endpoint başına bir sır, tenant'ın görebildiği hata durumu                                                                                 |
| (c) Önce operatör, sonra workspace | Önce (a) gönderilir, payload ve imza (b) sonradan eklenirken teslim formatı değişmeyecek şekilde tasarlanır                                                                                                                                     |

**Karar (b): endpoint'lerini workspace yapılandırır.**

Gerekçe, [ADR 0028](0028-open-contributions-hosted-service.md)'in şimdiye kadar depoda hiçbir yerde
yazılmamış bir sonucu. Tek takımla çalışan kendi kendine barındırılan bir instance'ta operatör ile
takım aynı insanlar, dolayısıyla (a) onlara kusursuz hizmet eder. Barındırılan instance'ta operatör
Dravcore'dur; yani (a) altında ödeme yapan her workspace bize ait tek bir URL ve tek bir sırrı
paylaşır ve müşteri kullanılabilir hiçbir webhook alamaz. Bariz kaçış yolu aynı ADR'de kapalı:
ücretli farklar "operasyonel nicelikler (koltuk, board, depolama ve benzeri), özellik değil", yani
webhook'lar bir katman olarak satılamaz. O hâlde (a) altında webhook'lar **yalnızca kendi kendine
barındıranlara ait bir özelliktir** ve daha azına sahip olan, barındırılan üründür. Bu, barındırılan
servisin ne için var olduğunu tersine çevirir: müşterinin satın aldığı şey sunucu işletmek zorunda
olmamaktır, bunun karşılığında daha küçük bir ürün almak değil.

(c) cazip uzlaşma ve ilkeden değil maliyetten reddediliyor. Kazandırdığı şey zarf ve imza, yani işin
en ucuz kısmı ve zaten bu kayıtla sabitleniyor. Kazandırmadığı şey pahalı kısmın tamamı:
endpoint'ler tenant verisi olduğu anda egress doğrulayıcısı, diskteki sır, yönetim route'ları, demo
reddi ve teslim günlüğü sıfırdan yazılmak zorunda. Ayrıca aynı anda iki yapılandırma yolunu hayatta
tutuyor, bir ortam değişkeni çifti ve bir tablo; ya ikisi de sonsuza kadar çalışmaya devam etmeli ya
da biri, kendi kendine barındıran birinin `.env`'ini kıran bir değişiklikle kaldırılmalı.

(b)'nin dürüst maliyeti bir dipnotta değil burada yazılı: daha büyük yapım işi, #254'te henüz talep
etmemiş bir kitle için seçiliyor ve SSRF sorusunu gerçek hâle getiren model bu. Karşı ağırlık
sıralama. Webhook'lar 1.0'da, [ADR 0034](0034-hosted-billing-and-plan-assignment.md)'ün
faturalandırma diliminden sonra iniyor; o noktada barındırılan instance ya vardır ya da vazgeçilmiştir
ve instance geneli sürümü önce yapmak, dispatcher'ı iki kez yazmak demek: ikinci sürüm, ilkinin
kaçındığı her kararı yine de vermek zorunda.

### 1. Üç event ne demek

`task.created`, `task.created` activity satırıdır. Oluşturulan task başına bir teslim.

`task.moved`, **`fromColumnId`'si `toColumnId`'sinden farklı olan** `task.moved` activity
satırıdır. Aynı kolon içindeki bir yeniden sıralama aynı activity satırını yazar ve bir teslim
**değildir**: bir durumu yansıtmak için "moved"'a bağlanan bir entegratör aksi hâlde kolon
içindeki her sürüklemede bir teslim alırdı, hepsi de position gürültüsü taşıyan no-op'lar. `position`
yine payload'da yolculuk eder; o veridir, tetikleyici değil. Saklanan satıra bu kural dokunmaz,
çünkü iki okuyucu zaten `task.moved` satırlarını sayıyor (`ActivationService` ve
`DashboardService.countCompletedMovesByDay`) ve satırın anlamını değiştirmek onların sayılarını
değiştirirdi. Filtre event tanımında yaşar.

`task.completed`'ın **activity satırı yoktur, türetilir**, tam bir kez, `fromColumnCategory !=
COMPLETED` ve `toColumnCategory == COMPLETED` olan bir `task.moved` geçişinden. Dördü de bilinçli
olan dört doğal sonuç:

- **`CANCELED` tamamlanmış değildir.** [ADR 0019](0019-column-category.md) iki kategoriyi ayrı
  tutuyor ve "Yapmayacağız"a bırakılmış bir kart bitirilmiş değildir.
- **Bitti'den bitti'ye ateşlenmez.** İki `COMPLETED` kolonu olan bir board ("Bitti" ve "Yayında")
  birinciye girişte `task.completed` yayar, ikinciye giderken `task.moved` yayar ve başka bir şey
  yaymaz.
- **Bir kolonu yeniden kategorilendirmek dağıtım yapmaz.** Bir kolonu `STARTED`'dan `COMPLETED`'a
  `PATCH`'lemek, içindeki her kart için tamamlanmanın anlamını değiştirir ve hiçbiri için hiçbir şey
  yaymaz. Alternatifi, tek bir yazmanın sınırsız bir teslim patlaması üretmesidir ve dashboard aynı
  asimetriyi zaten bilinçli bir seçim olarak belgeliyor.
- **`task.reopened` yoktur.** Bir `COMPLETED` kolonundan çıkmak `task.moved` yayar ve o da her iki
  kategoriyi taşır (aşağıdaki ön koşula bakın), dolayısıyla tamamlanmayı geri alma kenarını isteyen
  bir tüketici bunu zaten aldığı payload'dan hesaplayabilir.

**Import'lar ve cascade'ler hiçbir şey yaymaz.** Bir Trello import'u kartları `createMany` ile ve tek
bir `board.imported` satırıyla yazar, yani 500 kartlık bir import 500 `task.created` teslimi değildir;
ileride bir `board.imported` webhook'u ayrı bir karardır, bu değil. Bir board'u veya workspace'i
silmek Postgres içinde, hiç uygulama kodu çalışmadan cascade eder, dolayısıyla teslim mümkün değildir
ve `task.deleted` kapsam dışıdır. İkisi de eksiklik değil, bilinçli kapsam dışıdır ve hata olarak
raporlanmasınlar diye yazılıdır.

**Ön koşul, eklemeli ve ucuz.** `task.moved`'ın activity payload'ı, zaten snapshot'ladığı
`toColumnCategory`'nin yanına `fromColumnCategory`'yi kazanır. Kaynak kolon taşıma anında zaten
bellekte, alan tamamlanma geçişini yalnızca satırdan hesaplanabilir kılıyor ve dashboard etkilenmiyor
çünkü yalnızca `toColumn*` alanlarını okuyor. Bu kaydın implementasyondan önce istediği tek kod
değişikliği budur.

### 2. Zarf

```jsonc
{
  "id": "0192f4c1-…", // teslim id'si, UUIDv7, endpoint ve event başına tekil
  "type": "task.completed",
  "occurredAt": "2026-08-26T09:12:44.301Z", // commit anı, gönderim anı değil
  "workspaceId": "0192e0aa-…",
  "actorId": "0192d113-…", // ürünün kullanıcısız yaptığı her şey için null
  "data": {/* TaskDto, commit anında snapshot'lanmış */},
}
```

`data`, `packages/shared-types`'ın tanımladığı hâliyle bir `TaskDto`'dur, transaction'ın içinde
snapshot'lanır, gönderim anında yeniden okunmaz: yirmi dakika geç inen bir teslim, task'ı event
gerçekleştiğindeki hâliyle anlatmalıdır, şimdiki hâliyle değil. Bir endpoint tam olarak bir
workspace'e ait olsa bile `workspaceId` her payload'dadır, böylece birkaç Kurul workspace'ini tek bir
alıcıya toplayan bir tüketici asla kaydettiği URL'e göre anahtarlamak zorunda kalmaz.

Şekiller `/v1` şekilleridir. ADR 0031 bunu gerektiriyor: teslim formatı kendi başına bir kontrattır
ve onu `/v1` öncesi DTO'lara göre yazmak, önek indiği gün onu kırmak demektir. Bu kaydın şimdi kabul
edilip yalnızca 1.0'da hayata geçirilebilmesinin nedeni de budur.

### 3. İmza

Tam olarak `${timestamp}.${rawBody}` baytları üzerinde HMAC-SHA256, hex kodlanmış, üç header'da:

| Header              | Değer                                                                                     |
| ------------------- | ----------------------------------------------------------------------------------------- |
| `X-Kurul-Signature` | Virgülle ayrılmış bir ya da daha fazla `v1=<hex>` değeri; aşağıdaki rotasyon notuna bakın |
| `X-Kurul-Timestamp` | Unix saniyesi, imzalanan değerin aynısı                                                   |
| `X-Kurul-Delivery`  | Teslim id'si, gövdedeki `id` ile aynı, alıcının kendi idempotency'si için                 |

Zaman damgasını gövdeyle birlikte imzalamak, gövdeyi tek başına imzalamak yerine, yakalanmış bir
isteği tekrar oynatılamaz kılan şeydir: alıcı MAC'i yeniden hesaplar, sonra kendi saatinden **beş
dakikadan** fazla uzaktaki bir zaman damgasını reddeder. Yalnızca gövdeyi imzalamak, geçerli bir
isteği bir kez gözlemleyen herkesin onu sonsuza kadar tekrarlamasına izin verirdi. Alıcı tarafındaki
karşılaştırma sabit zamanlıdır ve dokümantasyon bunu açıkça söyler, çünkü bunu doğru yapıp yine de
açık kalmanın en yaygın yolu iki string üzerinde `==`'dir.

**Header bir listedir, çünkü gönderen tarafındaki rotasyon onu liste yapar.** Rotasyon dışında tek
bir değer taşır. 6. bölümdeki örtüşme penceresi boyunca gönderen aynı baytları hem yeni sırla hem de
öncekiyle imzalar ve `v1=<hex>,v1=<hex>` gönderir; alıcı, listedeki değerlerden **herhangi biri**
elindeki sırla eşleşiyorsa teslimi kabul eder. Bu, alıcıların başka sağlayıcılardan zaten bildiği
biçimdir ve bu rotasyonun kayıpsız olabilmesinin tek yoludur: Kurul MAC'i doğrulamaz, **üretir**,
dolayısıyla "önceki sır geçerli kalır" ancak "önceki sır hâlâ imzaladıklarımızdan biridir" anlamına
gelebilir. Örtüşme sırasında tek bir imza göndermek, hâlâ diğer sırrı tutan her alıcıda başarısız
olurdu; örtüşmenin önlemek için var olduğu kaçırılmış teslim tam olarak budur. `v1=` öneki ikinci
genişlemeyi, yani algoritma değişikliğini de taşır ve iki tür girdi de aynı listeye sığar.

### 4. Teslim önce bir outbox satırı, sonra bir job

Endpoint ve event başına bir `WebhookDelivery` satırı, **`Activity` satırıyla aynı transaction
içinde**, `ActivityService.record`'un zaten kabul ettiği transaction client üzerinden yazılır.
Transaction commit olduktan sonra, `webhooks` queue'suna teslim başına bir BullMQ job'ı atılır ve
`jobId` teslim id'sine ayarlanır; bu, kuyruğa atmayı idempotent kılar.

Commit ile kuyruğa atma arasındaki pencere gerçektir: o aralıkta ölen bir process'in commit olmuş bir
satırı ve hiç job'ı olmaz. Aynı queue üzerinde tekrarlayan bir süpürme, retry ufkundan daha eski
`pending` teslimleri yeniden kuyruğa atar; bu, pencereyi dağıtık bir transaction olmadan kapatır ve
`due-soon.worker.ts` ile `cleanup.worker.ts`'in zaten çalıştırdığı deseni birebir kullanır. Mevcut kod
tabanının kopyalayarak sağlayamayacağı kısım budur: posta ve realtime commit sonrasında
ateşle-ve-unut'tur ve webhook'ları o desen üzerine kurmak, roadmap'in kendi "en-az-bir-kere" iddiasını
ilk pod yeniden başlatmasında yanlış hâle getirirdi.

**Yalnızca `2xx` başarıdır.** `3xx` bir hatadır ve **takip edilmez**: bir yönlendirme, doğrulanmış
genel bir hostname'in `169.254.169.254`'e bir isteğe dönüşme yoludur. `4xx` ve `5xx` ikisi de hatadır
ve ikisi de yeniden denenir, çünkü "payload'ın yanlış" ile "ben ayaktayım değilim" ayrımı, alıcının
bir kesinti sırasında güvenilir biçimde yapabildiği bir ayrım değildir.

**Redis yoksa webhook da yok.** `REDIS_URL` API process'i için opsiyoneldir ve mevcut iki worker
onsuz zaten başlamayı reddediyor. Redis yokken endpoint oluşturma, sessizce hiç teslim etmeyecek bir
endpoint'i kabul etmek yerine, net bir hatayla reddedilir.

### 5. Yeniden denemeler ve ölü bir endpoint'e ne olur

BullMQ'nun kendi `attempts` ve `backoff` seçenekleriyle, yaklaşık bir saate yayılan üstel geri
çekilmeli altı deneme; yapılandırılan sayı, `due-soon.worker.ts`'in yaptığı gibi job'dan geri
okunur. Hepsinin tükenmesi teslimi `failed` işaretler ve tek başına bir alarm değildir: bir saat
boyunca ayakta olmayan bir alıcı normaldir.

**Arka arkaya 20 teslimde başarısız olan ya da 24 saattir hiç başarılı olmamış bir endpoint devre dışı
bırakılır.** `disabledAt` ve `lastError` endpoint üzerinde saklanır ve workspace admin'leri
tarafından okunabilir; yeniden etkinleştirmek, aynı zamanda bir test teslimi de gönderen açık bir
admin eylemidir. Otomatik yeniden etkinleştirme bilinçli olarak yoktur: kendini geri açıp yine
başarısız olan bir endpoint, fazladan adımları olan bir retry döngüsüdür ve alıcıyı düzeltebilecek
kişi, onu kaydeden kişidir.

Bu, yalnızca (b) modelinin verebileceği karardır. Operatör modelinde uygulamada bir şeyi yeniden
etkinleştirebilecek kimse yoktur, dolayısıyla politika "logla ve sonsuza kadar denemeye devam et"
olurdu ve roadmap'in "ölü bir endpoint'i devre dışı bırakma" ifadesinin karşılığı olmazdı.

### 6. Sır diskte nasıl durur

**Sunucu üretir, oluşturmada bir kez gösterilir ve `BETTER_AUTH_SECRET`'tan HKDF ile türetilen bir
anahtarla AES-256-GCM ile şifrelenmiş saklanır.** Rotasyon yeni bir sır verir ve öncekini 24 saat
geçerli tutar; gönderen tarafında bu, o penceredeki her teslimin ikisiyle birden imzalanması ve
`X-Kurul-Signature`'da iki değeri birden taşıması demektir (3. bölüm), böylece bir alıcı pencerenin
herhangi bir anında teslim kaçırmadan güncellenebilir. Yeniden gösterme yoktur:
kaybedilen bir sır, kaybedilen bir personal access token'ın yeniden üretilmesi gibi rotasyona uğrar.

PAT emsali burada izlenemez ve bu ayrışmanın söylenmesi gerekir. Bir token **doğrulanır**, dolayısıyla
diskte `sha256` yeterlidir ve düz metin gerçekten geri getirilemez. Bir HMAC ise **üretilir**,
dolayısıyla gönderen sırrı gönderim anında kullanılabilir biçimde tutmak zorundadır. Düz metin bir
kolon olarak saklamak, [api-conventions.md](../api-conventions.md#kimlik-doğrulama)'nin tam da o
sözcüklerle ilan ettiği bir özelliği sessizce emekliye ayırırdı. Instance'tan türetilen bir anahtarla
şifreleme onun çoğunu geri kazandırır: tek başına bir veritabanı dump'ı hiçbir şey vermez ve
saldırganın ortama da ihtiyacı olur.

Maliyet, bir operatörün okuyacağı yerde yazılıdır: `BETTER_AUTH_SECRET`'ı değiştirmek instance'taki her
webhook sırrını geçersiz kılar ve o endpoint'lerin rotasyona uğraması gerekir. Bu, yalnızca buraya
değil, değişkenin yanına `docs/self-hosting.md`'ye aittir.

### 7. Egress politikası

Tenant'ın verdiği bir URL, saldırganın verdiği bir URL'dir ve API container'ı `postgres`, `redis` ve
`web`'e adlarıyla ulaşabilir. Yeni bir `common/outbound-url.ts` hedefi sınıflandırır ve **iki kez**
uygulanır, endpoint oluşturma/güncellemede ve her gönderimden hemen önce:

- `https` zorunludur. `http` yalnızca `WEBHOOK_ALLOW_INSECURE_URLS=true` iken, kendi kendine
  barındırılan bir LAN alıcısı için, ve varsayılan olarak kapalıdır.
- Loopback, özel, link-local, unique-local, multicast ve belirtilmemiş adresler reddedilir; `.local`
  ve `.internal` hostname'leri de.
- DNS çözülür ve bağlanmadan önce **çözülen adres** yeniden kontrol edilir, çünkü bir saat önce
  doğrulanan bir hostname şimdi `127.0.0.1`'e çözülebilir.
- Yönlendirmeler takip edilmez (`redirect: 'manual'`), ki bu zaten "yalnızca `2xx` başarıdır"ın
  gereğidir.
- Yanıt gövdesi birkaç kilobayta kadar okunup atılır; bağlantı `TELEMETRY_TIMEOUT_MS`'i yansıtan bir
  `WEBHOOK_TIMEOUT_MS` zaman aşımı taşır.

(a) modelinde bunların hiçbiri gerekmezdi, çünkü `TELEMETRY_ENDPOINT` sağlam bir gerekçeyle
güvenilirdir: onu operatör yazmıştır. Bu, barındırılan müşterilere hizmet eden modelin bedelidir ve
ertelenmek yerine tam olarak ödenir.

### 8. Teslim günlüğü, penceresi ve indeksleri

`WebhookDelivery` yanıt durumunu ve yanıt gövdesinin en fazla 1 KB'lık kırpılmış hâlini tutar.
Webhook'ların eklediği en yüksek hacimli tablodur, endpoint ve event başına bir satır, dolayısıyla
saklama penceresini ilk şikâyetten sonra değil oluşturulduğu anda alır: **30 gün**,
`WEBHOOK_DELIVERY_RETENTION_DAYS`, `0` sonsuza kadar sakla demek,
[ADR 0020](0020-data-retention.md)'nin tablosuna ve `cleanup.worker.ts`'in her pencereyi adıyla okuyan
ve söylenmemiş hiçbir şeyi süpürmeyen `retentionSettings()`'ine eklenir.

İki indeks, şimdi kararlaştırılıyor çünkü sonradan eklemek şemadaki en büyük tabloya karşı bir
migration demek: cursor'lu liste için `(endpointId, id)`
([api-conventions.md](../api-conventions.md#pagination) cursor'ları her zaman `id` üzerinden
anahtarlar, asla bir sıralama kolonu üzerinden değil) ve bekleyen süpürme için `(status,
nextAttemptAt)` üzerinde kısmi bir indeks. Bu, [ADR 0020](0020-data-retention.md)'nin saklama
indekslerindeki önce-ölç duruşuna bilinçli bir istisnadır ve ölçüm
[#187](https://github.com/dravcore/kurul/issues/187)'dir: mevcut indekssiz süpürmeler çok daha küçük
tablolarda bilinen bir maliyettir.

### 9. Demo instance endpoint oluşturmayı reddeder

`DEMO_MODE=true`, endpoint route'larındaki `POST`'u reddeder. Herhangi bir ziyaretçinin dışa giden bir
URL kaydedebildiği genel bir demo, üzerine imza iliştirilmiş açık bir HTTP rölesidir; bu,
`DemoRestrictedGuard`'ın bugün koruduğu iki route'tan farklı bir sınıf problemdir ve guard'ın kendi
yazılı kuralına göre üçüncü bir girişi hak eder.

### 10. Yönetim route'ları ve yeteneğin nerede yayımlandığı

```
GET    /workspaces/:workspaceId/webhooks                        # endpoint'ler, yalnızca admin
POST   /workspaces/:workspaceId/webhooks                        # oluştur; sırrı taşıyan tek yanıt
PATCH  /workspaces/:workspaceId/webhooks/:endpointId            # url, enabled, yeniden etkinleştir
DELETE /workspaces/:workspaceId/webhooks/:endpointId
POST   /workspaces/:workspaceId/webhooks/:endpointId/test       # tek imzalı test teslimi, adlandırılmış rate limit
GET    /workspaces/:workspaceId/webhooks/:endpointId/deliveries # id üzerinden cursor'lu sayfalama
```

Hepsi `ADMIN_ROLES` **ve** `@SessionOnly`, token route'larının olduğu gerekçenin aynısıyla: sürekli
duran bir kimlik bilgisi, workspace'ten dışarı ikinci bir kanalı yapılandırabilmemelidir. Bir personal
access token `403` alır ve OpenAPI belgesi bu operasyonların her birinde `security: [session]` der. Bu,
[api-conventions.md](../api-conventions.md#kimlik-doğrulama)'nin zaten adlandırdığı sınırı yeni bir
kural icat etmek yerine genişletir.

Yetenek `GET /config`'te **yayımlanmaz**. `InstanceConfigDto` deployment yeteneğidir ve kendi yorumları
"asla tenant durumu değil" der; bir workspace'in endpoint'i olup olmadığı tenant durumudur ve yukarıdaki
endpoint listesi route'u okuma yüzeyidir. Bu, (a) modelinin ihtiyaç duyacağı şeyin ayna görüntüsüdür:
orada `mailEnabled`'ın yanında bir `webhooksEnabled` boolean'ı olurdu.

### 11. Kapsam dışı olanlar

Teslimler arasında sıra garantisi yok, batch yok, üç event tipinin ötesinde filtreleme yok, genel bir
event akışı yok (`Activity`'nin sözlüğü çok daha büyüktür ve onu yayımlamak dahili bir günlüğü genel bir
kontrat olarak dondururdu), `board.imported` yok, `task.deleted` yok, OAuth uygulama modeli yok.
Mutabakat kurması gereken bir tüketici `GET /workspaces/{workspaceId}/tasks`'ı okur.

## Gerekçe

**Sahiplik neden sıfırıncı karar olmak zorundaydı.** Yukarıdaki on kararın altısının (a) modelinde
farklı bir cevabı var: diskte sır yok, egress doğrulayıcı yok, yönetim route'u yok, session-only
sorusu yok, teslim günlüğü yok ve otomatik devre dışı bırakma yok, çünkü onu kimin için devre dışı
bırakacağınız yok. Sahip seçilmeden hata politikasını yazmak, seçilen modelin sormadığı soruları
cevaplayan bir belge üretirdi; ADR 0031'in versiyonlama için kendini yazma nedeni tam olarak bu hata
biçimiydi.

**Neden bir outbox, sadece queue değil.** Durable bir satır olmadan job kuyruğa atmak, "bu teslim
edilmeli" bilgisinin kayıt sistemini Redis yapar ve bu yığında Redis, yedeklenen bir veritabanı değil,
parolası olan bir cache'tir. `Activity` satırıyla aynı transaction'da yazılan bir satır, event'i doğru
kılan commit'in kendisiyle durable olur ve süpürme, "kuyruğa atmayı kaçırmış olabiliriz"i kayıp bir
teslim yerine sınırlı bir gecikmeye çevirir. Bedeli endpoint ve event başına fazladan bir yazma ile
süpürülmesi gereken bir tablodur; ikisi de yukarıda hesaba katılıyor.

**`task.completed` neden türetilir, saklanmaz.** Alternatifi yeni bir `ActivityType`'dır ve bu, bir
satır bir kez taşıdıktan sonra adları asla değiştirilemeyen bir sözlüğe kalıcı bir eklemedir; üstelik
günlüğün zaten kaydettiği bir taşımanın saf fonksiyonu olan bir event için. Ayrıca yeniden
kategorilendirme sorusuna cevabı teslim politikasında değil depolamada vermeye zorlardı: ya `PATCH`
etkilenen her task için bir satır yazar ya da feed, bazı task'lar için sessizce yanlış olan bir
tamamlanma event'i kazanır. Türetmek, asimetriyi tek bir yerde, bu belgede tutar; orada
maddileştirilmek yerine belgelenebilir.

**Yeniden sıralama filtresi neden event tanımında yaşar.** `task.moved` iki mevcut okuyucusu olan bir
depolama formatıdır. Onu kaynakta daraltmak, henüz var olmayan bir webhook'u düzeltmek için aktivasyon
hunisinin ve dashboard'un sayılarını değiştirirdi. Dispatcher'da filtrelemek bir predicate'e mal olur
ve günlüğe dokunmaz.

**Neden şifreleme, dürüst bir düz metin kolonu yerine.** Düz metin bir kolon tek başına savunulabilir:
operatör zaten `DATABASE_URL`'i okuyabiliyor, dolayısıyla yalnızca dump ile ele geçirmede saldırganın
kazandığı ek erişim dardır. Reddedildi, çünkü proje diskteki kimlik bilgileri hakkında belirli,
yayımlanmış bir iddiada bulunuyor ve hash'lenmiş token'ların yanında açıkta duran tenant başına bir
sır, o iddiayı tam da onu ifade eden belgede yıldız işaretine muhtaç bırakır. Bedel gerçektir ve
yukarıda adı konur: `BETTER_AUTH_SECRET`'ı rotasyona sokmak webhook'ları kıran bir olaya dönüşür, ki
bugün üründe böyle bir şey yok.

**Neden 30 gün, 90 değil.** Teslim günlüğü tek bir soruyu cevaplar, "alıcım bunu neden almadı", ve o
soru saatler içinde sorulur. `Activity`'nin 365 günü, feed'in kullanıcıya verilmiş bir geçmiş sözü
olması nedeniyle vardır; bir teslim denemesi hakkında hiçbir şey geçmiş sözü vermiyor. En yüksek
hacimli tabloda daha kısa bir pencere, gecelik süpürmenin maliyetini de orantılı tutan şeydir.

## Sonuçlar

- **Üç düzyazı iddiası doğru olmaktan çıkıyor ve dispatcher ile aynı pull request'te yeniden
  yazılmalı.** `telemetry.service.ts`'in "Kurul'da üçüncü bir tarafa bir şey gönderen tek kod yolu",
  `telemetry.module.ts`'in "kod tabanında başka hiçbir şey üçüncü bir tarafa dışa bağlantı açmaz" ve
  [development.md](../development.md)'nin "hiçbir dışa istek yapılmaz" ifadeleri, Türkçe aynasıyla
  birlikte. Yerine gelen söz daha dar ve hâlâ kontrol edilebilir: telemetri, **kodun** adını verdiği
  tek hedef olmaya devam eder ve diğer her dışa giden istek, bir workspace admin'inin kaydettiği ve
  görebildiği bir adrese gider. [ADR 0021](0021-activation-funnel-and-opt-in-telemetry.md)'in ilkesi bu
  indirgenmiş biçimde hayatta kalır ve değişikliğin dürüst kısmı şudur: bir denetçi artık "bu instance
  nereye veri gönderebilir" sorusunu yalnızca ortamdan cevaplayamaz, bir tablo okumak zorundadır.
- **Kabul edilirse [ROADMAP.md](../../../ROADMAP.md) satırları buna göre yeniden yazılır.** API 1.0
  bölümündeki "Minimal webhooks" satırı "operatörün yapılandırdığı URL"i kaybeder ve "bir admin
  tarafından workspace başına yapılandırılır"ı kazanır, "API 1.0 remainder" satırı bu kaydı linkler ve
  ertelenmiş `PM-09` satırı hız belirleyici olarak lansman geri bildirimini korur. Bu ADR o düzenlemeleri
  yapmaz; roadmap bir durum belgesidir, bu ise gerekçedir.
- **Efor L kalır, artık gerekçesi yazılı olarak.** (a) modelinde bu bir M olurdu. Fark: endpoint tablosu
  ve migration'ı, egress doğrulayıcısı, diskteki sır, OpenAPI girdileriyle birlikte altı route, süpürmesi
  ve indeksleriyle teslim günlüğü ve web'in sahiplendiği bir ayarlar ekranı. "API 1.0 remainder"
  satırındaki mevcut `L` zaten bu model için boyutlandırılmıştı.
- **[api-conventions.md](../api-conventions.md)'ye ve Türkçe aynasına bir webhook bölümü eklenir**;
  zarf, header'lar, doğrulama tarifi ve retry tablosu orada olur. OpenAPI 3.0'da üst düzey bir `webhooks`
  nesnesi yoktur (o 3.1'dedir) ve commit edilmiş belge 3.0.0'dır, dolayısıyla dışa giden kontrat düzyazıyla
  belgelenir ve payload bir component şeması olarak tanımlanır, üretilmiş bir operasyon olarak değil.
  Yönetim route'ları sıradan üretilmiş operasyonlardır.
- **`.env.example`, `docs/self-hosting.md`, `docker-compose.yml` ve Türkçe aynaları
  `WEBHOOK_TIMEOUT_MS`, `WEBHOOK_ALLOW_INSECURE_URLS` ve `WEBHOOK_DELIVERY_RETENTION_DAYS`'i kazanır.**
  Compose'un `api` environment bloğunda forward edilmeyen bir değişken, yayımlanan yığını çalıştıran hiç
  kimse için var değildir.
- **`task.moved` payload'ındaki `fromColumnCategory` eklemelidir ve gerisinden önce inebilir.** Bu kaydın
  özellikten önce gönderilmeye değer tek parçasıdır ve güvenlidir: payload okuyucuları bilmedikleri
  anahtarları yok sayar.
- **`WebhookEndpoint.createdById` nullable ve `onDelete: SetNull`'dır.** Bir endpoint onu ekleyen kişiye
  değil workspace'e aittir ve hesap silme, workspace'in entegrasyonlarını da beraberinde götürmek yerine
  kullanıcı satırını anonimleştirir ([ADR 0026](0026-account-deletion-anonymisation.md)).
- **Teslim en-az-bir-keredir ve alıcılar idempotent olmalıdır.** `X-Kurul-Delivery` bunu yapmanın
  anahtarıdır ve dokümantasyon, atlayarak tam-bir-kere ima etmek yerine bunu açıkça söyler.

## Değerlendirilen Alternatifler

| Alternatif                                                                      | Neden değil                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| (a) Instance için operatörün yapılandırdığı `WEBHOOK_URL`                       | M'e karşı L kadar ucuz, ama barındırılan her workspace Dravcore'un URL'ini paylaşırdı ve ADR 0028 çözümü bir özellik olarak satmayı yasaklıyor. Webhook'ları yalnızca kendi kendine barındıranlara ait kılar |
| (c) Önce operatör, sonra workspace endpoint'leri                                | Yalnızca zarf ve imzayı kurtarır, ki bu kayıt onları zaten sabitliyor; iki yapılandırma yolunu ya sonsuza kadar yaşatır ya da bir self-host `.env`'ini kırar                                                 |
| Operatör yapılandırmasında workspace başına hedefler                            | Bir `InstanceSetting` tablosu ve instance-admin yazma route'ları gerektirir; kaçınmaya çalıştığı workspace tablosundan daha büyük bir yeni yüzeydir                                                          |
| Mailer gibi commit sonrası ateşle-ve-unut                                       | Tasarım gereği en-fazla-bir-kere; roadmap'in "en-az-bir-kere" iddiası ilk yeniden başlatmada yanlış olurdu ve commit ile gönderim arasındaki bir çökme event'i kayıtsız kaybeder                             |
| Outbox satırı olmadan BullMQ job'ı                                              | Postgres commit'inin yarattığı bir yükümlülüğün kayıt sistemini Redis yapar; onu hiçbir şey yedeklemez ve bir flush teslimleri sessizce kaybeder                                                             |
| Saklanan bir `task.completed` activity tipi                                     | Günlüğün zaten kaydettiği bir taşımanın saf fonksiyonu için sözlüğe kalıcı, adı değiştirilemez bir ekleme; kolon yeniden kategorilendirme sorusunu depolamaya zorlar                                         |
| Bir kolon yeniden kategorilendirildiğinde her task için `task.completed` yaymak | Tek bir `PATCH` sınırsız bir teslim patlamasına dönüşür ve dashboard'un zaten belgelediği asimetri bir cümle yerine bir teslim fırtınası olur                                                                |
| Aynı kolon içindeki yeniden sıralamaları `task.moved` olarak teslim etmek       | Kolon içindeki her sürükleme bir teslim olur, hepsi de durum yansıtan her tüketici için no-op                                                                                                                |
| Bunun yerine `task.moved` activity satırını daraltmak                           | İki mevcut okuyucu o satırları sayıyor; bir webhook'u şekillendirmek için depolama formatını değiştirmek aktivasyon hunisinin ve dashboard'un sayılarını oynatır                                             |
| Düz metin sır kolonu                                                            | Token dokümantasyonunun ilan ettiği "bir veritabanı dump'ı kullanılabilir bir kimlik bilgisi vermez" özelliğini, veritabanının tutacağı ilk tenant başına sır için emekliye ayırır                           |
| Zaman damgası olmadan yalnızca ham gövdeyi imzalamak                            | Yakalanan bir istek sonsuza kadar tekrar oynatılabilir kalır; imzalanan string'deki zaman damgası ve beş dakikalık pencere onu sınırlayan şeydir                                                             |
| Teslimde yönlendirmeleri takip etmek                                            | Doğrulanmış genel bir hostname Compose ağına ya da bir metadata adresine yönlendirebilir, ki egress doğrulayıcısı tam olarak bunu önlemek için var                                                           |
| Endpoint'i devre dışı bırakmak yerine sonsuza kadar denemek                     | Kalıcı olarak ölü bir alıcı sınırsız bir kuyruğa ve instance'tan sürekli dışa giden bir taramaya dönüşür; onu düzeltebilecek kişi, kaydeden admin'dir                                                        |
| Devre dışı bir endpoint'i soğuma süresi sonrası otomatik açmak                  | Fazladan adımları olan bir retry döngüsü; endpoint hakkında hiçbir şey değişmedi ve hata tanımı gereği alıcı tarafında                                                                                       |
| `GET /config`'te `webhooksEnabled` yayımlamak                                   | `InstanceConfigDto` deployment yeteneğidir ve bunu kendisi söyler; bir workspace'in endpoint'i olup olmadığı tenant durumudur ve workspace okumasına aittir                                                  |
| Endpoint yönetiminin token ile yapılabilmesi                                    | Bir egress hedefi ekleyebilen sürekli bir kimlik bilgisi ikinci bir sızdırma kanalıdır; token route'ları da aynı nedenle session-only                                                                        |
| Teslim günlüğünde saklama penceresi olmaması                                    | Webhook'ların eklediği en yüksek hacimli tablo sonsuza kadar büyürdü ve pencereyi indeksleriyle sonradan eklemek şemadaki en büyük tabloya karşı bir migration demek                                         |
