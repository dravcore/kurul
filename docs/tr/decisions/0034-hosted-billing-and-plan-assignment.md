# 0034. Barındırılan Faturalandırma ve Plan Ataması: Bir Merchant of Record, Tek Bir Subscription Satırı ve Yapılandırılmadığında Hiçbir Şey

**Durum:** Önerildi
**Tarih:** 2026-08-26

> 🌐 [English (kanonik)](../../decisions/0034-hosted-billing-and-plan-assignment.md) | Türkçe (bu çeviri güncel olmayabilir; kanonik kaynak İngilizce'dir)

## Bağlam

[ADR 0028](0028-open-contributions-hosted-service.md) paranın nereden geleceğine karar verdi:
"Dravcore'un işlettiği barındırılan bir servis. Sunucularımızda bir hesap, yayımlanmış bir limit
kümesi içinde ücretsiz, üzerinde ücretli", burada limitler "operasyonel nicelikler (koltuk, board,
depolama ve benzeri), özellik değil" ve "barındırılan servis, ihtiyaç duyduğu plan limiti ve
faturalandırma kodu dahil, bu depodaki aynı AGPL kodunu çalıştırır".

[ADR 0032](0032-plan-limits.md) bunun ilk yarısını inşa etti. Tek bir çözümleyici her tavan sorusunu
cevaplıyor ve nullable bir JSON kolonu olan `Workspace.planLimits`, bir workspace'in migration
olmadan kendi tavanlarını taşımasına izin veriyor. O ADR neyi açık bıraktığını tam da bu sözcüklerle
adlandırmıştı: "Faturalandırmanın tavanların ötesinde ihtiyaç duyduğu şey (plan adı, sağlayıcı
id'leri, dönem sonu) 0028'in kendi gerekçeleriyle ekleyeceği bir tablodur."

Bu ek yeri tamamlanmış ve kullanılmamış durumda. `Workspace.planLimits`'in `PlanLimitsService`,
`BoardService`, `AttachmentService`, `InstanceConfigController` ve `mount-better-auth.ts`'teki kayıt
reddinde okuyucuları var ve **`apps/api/src` içinde hiçbir yerde yazıcısı yok**;
[self-hosting.md](../self-hosting.md) açıkça "uygulama onu kendisi hiç yazmaz" diyor. `Subscription`
modeli yok, sağlayıcı entegrasyonu yok (`stripe`, `paddle` ve `billing` plan limiti dosyalarının
dışında hiçbir şeyle eşleşmiyor), alıcı route'u yok ve plan kataloğu yok. `ROADMAP.md`'nin
faturalandırma satırında tek bir kabul kriteri var, sağlayıcı entegrasyonunun yapılandırmanın
arkasında durması ve varsayılan olarak kapalı olması, ve Faz 3 onu tetiğe bağlıyor, sahibinin öne
çekme özgürlüğüyle.

Mevcut kodun iki özelliği, bir yazıcının ne yapmasına izin verileceğini şekillendiriyor.

- **Bozuk bir yazma "sınırsız" demektir, "reddedildi" değil.** `parseWorkspacePlanOverride`
  anlamadığı anahtarları ve negatif olmayan tam sayı olmayan değerleri bilinçli olarak düşürüyor,
  çünkü kolon veridir ve tek bir bozuk JSON değeri yüzünden bir tenant'a hizmeti reddetmek, kötü bir
  yazmayı bir kesintiye çevirirdi. Bu, bir okuyucu için doğru davranış ve bir yazıcı için tuzak:
  `{"seats": "10"}` yazan bir plan ataması, gürültülü biçimde başarısız olmak yerine sessizce
  sınırsız koltuk verir.
- **Ham gövdeli bir alıcının mount edileceği tam olarak tek bir yer var.** `configure-app.ts` önce
  origin kontrolünü, sonra `mountBetterAuth`'u, en son da body parser'ları kaydediyor. İmzası ham
  baytları kapsayan bir sağlayıcı webhook'u, Better Auth mount'uyla aynı nedenle o ortadaki yuvaya,
  `useBodyParser`'dan önce kaydedilmek zorunda: önündeki bir parser ona zaten tüketilmiş bir stream
  verir. Önündeki origin kontrolü sorun değil, çünkü yalnızca allowlist dışında bir origin _ilan
  eden_ istekleri reddediyor ve bir sağlayıcının sunucusu ne `Origin` ne `Referer` gönderir.

Bunun ötesinde: `ThrottlerGuard` ve `SessionAuthGuard` global, dolayısıyla Nest içindeki bir alıcı
`@Public` ve bir throttle muafiyeti isterdi; `organization-options.ts` içinde `organizationHooks`
zaten var ve genişletilebilir; ve `DEMO_MODE`, çağrı anında okunan ve `GET /config`'te yayımlanan bir
özellik bayrağının yerleşik biçimi.

## Karar

### 1. Bir merchant of record, ilk adaptör Paddle

Üç sağlayıcı modeli tartıldı.

| Model                                      | Dravcore ne olurdu                                                                                                                         |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Merchant of record (Paddle, Lemon Squeezy) | Satıcı değil. Sağlayıcı müşteriye satar, faturayı keser, her yerde KDV ve satış vergisini toplar ve öder, ve bir takvime göre ödeme yapar  |
| Ödeme işlemcisi (doğrudan Stripe)          | Satıcı. Dravcore faturaları keser ve sattığı her yargı alanında tüketim vergisini kaydettirmek, toplamak ve ödemekle sorumludur            |
| Better Auth'un Stripe eklentisi            | Yukarıdaki gibi satıcı, ek olarak abonelik durumu auth kütüphanesinde ve organization `referenceId`'si üzerinden anahtarlanmış hâlde durur |

**Karar bir merchant of record ve ilk adaptör Paddle.**

Gerekçe teknik değil. Kurul'u Türkiye'de yaşayan tek bir kişi sürdürüyor ve aboneliği çoğunlukla
başka yerlerdeki müşterilere satacak. Doğrudan Stripe altında, sınır ötesi dijital hizmet KDV'si
eşiği olan her yargı alanında sürdürücünün problemi olur: AB OSS kaydı, Birleşik Krallık KDV'si ve
her birinin kendi beyan takvimi olan büyüyen bir liste. Bu iş solo bir projeye ölçeklenmez,
ertelenemez (ilk satıştan itibaren tahakkuk eder) ve yanlış yapılması bir hata değil bir yükümlülük
doğurur. Bir merchant of record her işlemde kayıtlı satıcıdır, bu da daha yüksek bir yüzde
karşılığında bütün bunları sağlayıcıya taşır. İşlem başına birkaç puan daha ödemek, buradaki tek
maliyeti, yani sürdürücünün kod yazarak düzeltemeyeceği maliyeti, geri satın almanın mümkün olan en
ucuz yoludur.

Lemon Squeezy aynı braketteki aynı modeldir ve adlandırılmış alternatif olarak kalır; 2024'ten beri
Stripe'ın parçasıdır, ki bu onun bağımsız yönünü bir cevap değil bir soru hâline getirir, ve ikisinin
de güncel ücret tarifeleri ve koşulları bu kaydın üzerindeki tarihe güvenilerek değil, kayıt hayata
geçirilirken yeniden kontrol edilir.

**Better Auth'un Stripe eklentisi yazılı olarak reddediliyor**, yüzeysel olarak en iyi uyum olmasına
rağmen: `Workspace` zaten Better Auth organization'ıdır ([ADR 0004](0004-auth-better-auth.md)) ve
eklenti abonelikleri bir organization `referenceId`'si üzerinden anahtarlıyor, yani bu ADR'nin bir
tabloya harcadığı eşleme bedava gelirdi. Dört nedenle reddediliyor. Bir Stripe eklentisidir,
dolayısıyla onu benimsemek sağlayıcı sorusunu liyakate göre değil araca göre karara bağlar ve liyakat
diğer yönü işaret ediyor. Durumu auth kütüphanesinin kendi tablolarında yaşar, dolayısıyla hak yazımı
bütün bu işin asıl amacı olan `Workspace.planLimits` güncellemesiyle aynı transaction'ı paylaşamazdı.
`/auth/*` altına mount olur, ki orası Nest router'ın altındaki ham Express'tir ve dinleyen bir
exception filter yoktur, zaten oradaki organization firewall'ın kendi hata zarfını elle yazmasının
nedeni de budur. Ve faturalandırma yüzeyini bir Better Auth major versiyonuna bağlardı. Sağlayıcı
modeli bir gün yeniden ele alınır ve doğrudan Stripe kazanırsa, bu ret de onunla birlikte yeniden ele
alınır.

Kodun biçimi, tek bir implementasyonu olan tek bir `BillingProvider` port'udur;
[ADR 0022](0022-attachment-storage.md)'nin `StorageBackend` için kullandığı biçim: ikinci bir adaptör
gerçekten ikinci bir sağlayıcı gerektiğinde yazılır ve port, o ihtiyacın bir yeniden yazım olmaması
için vardır.

### 2. Workspace başına tek bir `Subscription` satırı

```prisma
model Subscription {
  id               String    @id @default(uuid(7))
  workspaceId      String    @unique
  provider         String
  customerId       String
  subscriptionId   String
  planCode         String
  status           String
  currentPeriodEnd DateTime?
  graceUntil       DateTime?
  createdAt        DateTime  @default(now())
  updatedAt        DateTime  @updatedAt

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  @@unique([provider, subscriptionId])
}
```

`workspaceId` tekildir: bir workspace'in tek bir planı vardır ve satır, "bu workspace ne için ödüyor"
sorusunun cevabıdır. `onDelete: Cascade`, workspace'e ait diğer her tabloyla eşleşir; silinmiş bir
workspace'in faturalandırma geçmişi, para konusunda kayıt sistemi olan sağlayıcıda yaşar, bu
veritabanında değil. `status` ve `planCode` enum değil string'dir, çünkü sözlükleri sırasıyla
sağlayıcıya ve kataloğa aittir ve bir Prisma enum'ı her yeni değeri bir migration yapar.

Satır yalnızca checkout'tan geçmiş bir workspace için vardır. Satır yoksa ücretsiz plan demektir ve
kendi kendine barındırılan her workspace de böyle görünür, dolayısıyla iki durum bir
`afterCreateOrganization` hook'unun oluşturduğu yapay bir ücretsiz plan satırına ihtiyaç duymadan tek
bir kod yolunu paylaşır.

İkinci bir tablo, `BillingEvent`, 4. bölümün idempotency defteridir: bu şemadaki her satır gibi
`id String @id @default(uuid(7))`, ardından `provider`, `eventId` ve `receivedAt`, `(provider,
eventId)` üzerinde tekil bir indeksle. Tablonun var olma nedeni ve **okunduğu** anahtar o tekil
çifttir; id ise isteğe bağlı bir süs değildir, çünkü [CLAUDE.md](../../../CLAUDE.md) her satırın
id'sini UUIDv7 yapıyor ve bu tablonun aşağıda girdiği saklama süpürmesi, API'deki her cursor gibi `id`
üzerinden sayfalıyor.

### 3. Plan kataloğu satır değil kod

```ts
const PLAN_CATALOG = {
  free: { name: 'Free', limits: { seats: 3, boards: 3, storageBytes: 1_073_741_824 } },
  // …
} as const satisfies Record<string, PlanDefinition>;
```

`planCode` bu sabit üzerinden, [ADR 0032](0032-plan-limits.md)'nin zaten anladığı tam
`Workspace.planLimits` anahtarlarına (`seats`, `boards`, `storageBytes`) ve bir görünen ada çözülür.
Bir `Plan` tablosu yoktur; board şablon kataloğunun da kod olmasının nedeniyle: satırları bir
deploy'dan başka kimse düzenlemez, bir tablo kataloğu her testin ve her ortamın seed etmesi gereken
bir fixture yapar ve tipli bir sabit, bir plan bir tavan kazandığında sessiz bir `undefined` yerine
bir derleme hatası verir. Yukarıdaki sayılar yer tutucudur; yayımlanan katmanlar bir fiyatlandırma
kararıdır, bir mimari kararı değil, ve implementasyonla birlikte gelir.

Katalog barındırılana özel değil, instance genelidir. `BILLING_PROVIDER`'ı hiç ayarlamayan biri hiçbir
zaman bir `planCode` çözmez, dolayısıyla sabit ona bayt büyüklüğünden başka bir maliyet çıkarmaz.

### 4. Hak yazımı tek bir transaction'dır ve yazmadan önce doğrulanır

Plan atayan tek şey bir sağlayıcı webhook event'idir: abonelik oluşturuldu, güncellendi, iptal edildi
ve ödeme başarısız. Birini işlemek şudur:

1. İmzayı ham gövde üzerinde doğrula. Doğrulanmamış bir istek `401`'dir ve başka hiçbir şey olmaz.
2. `planCode`'u `PLAN_CATALOG` üzerinden çöz ve **ortaya çıkan limit nesnesini yazmadan önce
   doğrula**, `parseWorkspacePlanOverride`'ın okurken uyguladığı predicate'in aynısıyla. Bilinmeyen
   bir `planCode` ya da negatif olmayan tam sayı olmayan bir limit reddedilir: logla, sağlayıcı
   yeniden denesin diye `5xx` cevapla ve hiçbir şey yazma; bu noktada bu ifade harfiyen doğrudur,
   çünkü henüz hiçbir şey yazılmamıştır. Bu adım, okuyucunun kullanamadığını düşürmesi yüzünden
   vardır: kötü bir şeklin doğrulanmamış yazımı başarısız olmaz, sınırsız verir.
3. **Tek bir `$transaction` içinde:** `BillingEvent`'e ekle, `Subscription`'ı upsert et ve
   `Workspace.planLimits`'i yaz. `(provider, eventId)` üzerindeki bir tekillik ihlali o
   transaction'ın tamamını geri alır ve doğru sonuç tam olarak budur: event zaten uygulanmıştır,
   hiçbir şey iki kez yazılmaz, handler `200` cevaplar ve durur. Sağlayıcılar yeniden dener ve
   en-az-bir-kere teslim, alıcı tarafından tam olarak böyle görünmelidir.

**Ledger satırı transaction'ın önünde değil içindedir ve asıl karar bu sıralamadır.** Koruduğu
yazmadan önce commit edilen bir idempotency ledger'ı, yazma gerçekleşmeden önce verilmiş "gerçekleşti"
sözüdür. Öyle yazıldığında 2. adımdaki bir ret ya da iki commit arasındaki bir çökme, uygulanmış
işaretli bir event ile planını hiç almamış bir workspace bırakır; üstelik sağlayıcıdan istenen
yeniden deneme de o ledger satırı yüzünden `200` cevaplanıp düşürülür. Transaction'ın dışında hiçbir
şey ilerleme kaydetmez, dolayısıyla yalnızca iki sonuç vardır: "event kaydedildi ve hak yazıldı" ya
da "hiçbiri". `Subscription` satırı "team" derken tavanları "free" diyen bir workspace, tek
transaction'ın önlediği diğer hata biçimidir ve destek yazışması üreten de odur.

**Günlük bir mutabakat job'ı** her aktif aboneliği sağlayıcıdan yeniden okur ve aynı yazımı yeniden
uygular, `cleanup.worker.ts` biçiminde: BullMQ, tek bir tekrarlayan job, `REDIS_URL` yokken hiç
başlamaz. Webhook'lar kimsenin kontrol etmediği biçimlerde kayıplıdır (yeniden deneme penceresi
sırasında bir kesinti, yanlış kapsamlı bir endpoint, sağlayıcının eklediği bir event tipi) ve günlük
bir yakınsama geçişi, ödemesini yapmış ama bir gün boyunca kısıtlanan bir müşteriyle yazana kadar
kısıtlanan bir müşteri arasındaki farktır. Ayrıca hiç event gelmeden sona ermiş bir aboneliği fark
eden tek mekanizmadır.

### 5. Alıcı Nest router'ın altına mount edilir

```
POST /billing/webhooks/:provider
```

`configure-app.ts` içinde, `mountBetterAuth`'tan sonraki ve body parser'lardan önceki yuvaya, o
path'e kapsanmış `express.raw({ type: 'application/json', limit: '64kb' })` ile ve oradaki organization
firewall'ın zaten kullandığı biçimde elle yazılmış bir hata zarfıyla kaydedilir. Bu yerleşimden üç
şey doğar ve zaten onlar için seçilmiştir: ham baytlar imza kontrolüne ayrıştırılmadan ulaşır; route
tam olarak `/auth/*`'ın yaptığı gibi ([ADR 0031](0031-api-versioning.md)) yapısı gereği gelecekteki bir
`/v1`'in dışında kalır, ki bu doğrudur çünkü kontratı Kurul'un API'sine değil sağlayıcıya aittir; ve
global `SessionAuthGuard` ile hiç karşılaşmaz, dolayısıyla unutulacak bir `@Public` anotasyonu yoktur.

Global guard'ları atlamanın bedeli, throttler'ın da atlanmasıdır. Telafiler handler'ın içindedir: 64
KB gövde sınırı, herhangi bir veritabanı işinden önce çalışan bir imza kontrolü ve sabit zamanlı bir
karşılaştırma. İmzasız bir istek `401`'dir ve bir HMAC'e mal olur.

**Checkout bir oturumdan, bir owner tarafından başlatılır.**
`POST /workspaces/:workspaceId/billing/checkout` `MemberRole.OWNER` ve `@SessionOnly`'dir ve
sağlayıcının barındırdığı bir URL döner. `ADMIN_ROLES` yerine owner, çünkü bu, birinin adına bir ödeme
yükümlülüğü yaratır ve bu, workspace yönetiminden daha dar bir sorudur; session-only ise token
route'larının olduğu gerekçeyle: sürekli duran bir kimlik bilgisi bir satın alma başlatabilmemelidir.

### 6. Başarısızlık bir ödemesiz dönemdir ve hiçbir şey silinmez

Başarısız bir ödemede workspace mevcut tavanlarını `graceUntil`'e kadar korur, varsayılan olarak yedi
gün. Ödemesiz dönem dolduğunda mutabakat job'ı ücretsiz planın limitlerini yazar ve düşürmenin tamamı
budur: hiçbir board silinmez, hiçbir üye çıkarılmaz, hiçbir dosya eki koparılmaz. ADR 0032'nin
tavanları tasarımı gereği yumuşaktır ve yalnızca **yeni** yazmaları reddeder, dolayısıyla yeni
tavanının üzerinde kalan bir workspace basitçe ekleme yapamaz; bu, plan limiti hata zarfının kullanıcıya
bir kod, bir limit ve güncel bir sayıyla zaten açıkladığı bir durumdur.

Ödememe yüzünden bir şey silmek, bu kod tabanının öğrenebileceği en yıkıcı şey olurdu ve sahip olduğu
en güvenilmez girdi üzerine (bir üçüncü tarafın bir kart hakkındaki görüşü) kurulu olurdu; üstelik
ürünün hiçbir parçası bunu bir hatadan ayırt edemezdi.

### 7. `BILLING_PROVIDER` ayarlı değilse tamamen atıl

`BILLING_PROVIDER`'ın ayarlı olmaması, kendi kendine barındırmanın varsayılanıdır ve şu demektir:

- faturalandırma modülü **hiçbir controller ve hiçbir route** kaydetmez, yani
  `POST /billing/webhooks/:provider` ve checkout route'u yoktur;
- hiçbir mutabakat job'ı zamanlanmaz ve hiçbir queue oluşturulmaz;
- `GET /workspaces/{workspaceId}/plan`, `plan: null` cevaplar;
- `Workspace.planLimits`, [self-hosting.md](../self-hosting.md)'nin söylediği şey olarak kalır: bir
  operatörün elle yazdığı bir kolon.

Bu bir niyet değil bir kontrattır, dolayısıyla kontratların kanıtlandığı gibi kanıtlanır: API'yi
`BILLING_PROVIDER` ayarlı değilken açan ve belge belge şunları doğrulayan bir e2e:

- `GET /config`, aynı build'in sağlayıcı yapılandırılmışken sunduğu `InstanceConfigDto` ile **bayt
  bayt aynıdır**. Faturalandırma oraya hiçbir yönde hiçbir yetenek yayımlamaz, dolayısıyla bu, hiçbir
  istisnası olmayan tam eşitlik iddiasıdır;
- `GET /workspaces/{workspaceId}/plan`, bu kayıttan önce sunulan belgeden **tam olarak tek bir üye
  kadar ve başka hiçbir şeyle** ayrılır: 8. bölümün eklediği ve değeri `null` olan `plan` anahtarı.
  `limits` ve `usage` bayt bayt aynıdır ve yanıtın hiçbir yerinde başka bir anahtar görünmez;
- `POST /billing/webhooks/:provider` ve checkout route'u `404` cevaplar.

İkinci iddia "bayt bayt aynı"dan bilinçli olarak daha dardır ve bu fark bir taviz değil, kararın
kendisidir. `plan`, yalnızca barındırılana özel bir anahtar değil, **her** instance'ta
`WorkspacePlanDto`'nun bir üyesidir; çünkü bir alanın var olup olmadığına göre dallanmak zorunda kalan
bir istemci, sunucunun nasıl kurulduğunu bilmek zorunda kalan bir istemcidir. Dolayısıyla test etmeye
değer özellik, belgenin hiç değişmemiş olması değil, faturalandırmayı kapatmanın yayımlanan tipin
zaten vaat ettiği o tek `null`'ın ötesinde hiçbir şey eklememesidir. `/plan` üzerinde bayt eşitliği
iddia etmek, 8. bölümün kararının tersini iddia etmek olurdu ve geçemeyecek bir test, hiç test
olmamasından kötüdür.

ADR 0028, kendi kendine barındıranlara hiçbir şey saklanmadan aynı kodu vaat ediyor; tersi vaat, yani
çalıştırdıkları kodun **fazladan** hiçbir şey barındırmadığı, bir paragraf değil bir test ister.

### 8. `WorkspacePlanDto` eklemeli biçimde bir plan kimliği kazanır

```ts
interface WorkspacePlanDto {
  limits: WorkspacePlanLimitsDto;
  usage: WorkspacePlanUsageDto;
  /** Faturalandırma sağlayıcısı yapılandırılmamış her instance'ta `null`. */
  plan: { code: string; name: string; manageUrl: string | null } | null;
}
```

Ret zarfı hangi tavana çarpıldığını zaten söylüyor ve `plan-limit.exception.ts` "barındırılan bir
deployment'ın `planLimit.code`'u bir yükseltme istemine eşlemesi"ni zaten öngörüyor, ama hiçbir şey bir
istemciye workspace'in hangi planda olduğunu ya da bunu nereden değiştireceğini söylemiyor. Bunu
mevcut okumaya eklemek, üçüncü bir yüzey açmak yerine ADR 0032'nin "iki okuma yüzeyi" kuralını
koruyor. `manageUrl` sağlayıcının müşteri portalıdır ve yalnızca bir owner için null olmayan bir
değerdir, çünkü bir faturalandırma hesabına giden bir bağlantıdır; diğer her üye kodu ve adı görür.

### 9. Yumuşak tavanlar faturalandırma sınırı olur, bu da advisory kilit için yeni bir tetiktir

[ADR 0027](0027-attachment-quotas.md) workspace başına bir `pg_advisory_xact_lock`'u değerlendirip
yazılı olarak reddetti ve [ADR 0032](0032-plan-limits.md) aynı takası sayımlar için yineledi:
oku-sonra-yaz, eşzamanlılıkla sınırlı aşım, "**Tetik:** bir tavanın kasten yarıştırıldığına dair bir
rapor". `BoardService` o reddi işaret eden bir yorum taşıyor.

Her iki ret de operatör korkuluğu olan bir tavan için doğruydu. **Hiçbiri gelir sınırı olan bir tavanda
ayakta kalmıyor**: bir müşterinin aynı anda on istek göndererek aşabildiği bir limit bir plan
değildir.

Bu yeni bir tetiktir, o kayıtların adlandırdığı tetiklerden biri değil ve farkı net söylemeye değer.
ADR 0027'ninkiler "eşzamanlı aşımın bir `ATTACHMENT_MAX_BYTES`'ı belirgin biçimde aştığı ölçülmüş bir
deployment ya da kotanın kasten yarıştırıldığına dair bir operatör raporu"dur ve ADR 0032 aynı çifti
sayımlar için yineler. Hiçbiri ateşlenmedi ve bu kayıt aksini iddia etmiyor. Değişen şey, tavanın ne
**anlama geldiği**; o kayıtların tartamayacağı bir gerekçe bu, çünkü yazıldıklarında bir tavanın
arkasında gelir yoktu. Dolayısıyla zemin burada yazılıyor ve önceki kayıtlar bu zemin üzerinde yeniden
ele alınıyor, bunu önceden görmüş gibi okunmuyorlar. Dolayısıyla, **faturalandırma diliminin parçası
olarak, ondan önce değil**, board oluşturma, davet oluşturma ve kabul etme ve dosya
eki oluşturma için transaction içinde workspace başına bir
`pg_advisory_xact_lock(hashtext(workspaceId))` alınır; instance geneli kullanıcı tavanı için de kayıt
etrafında tek bir sabit anahtar. `GET .../plan` mevcut kilitsiz okumalarını korur; onlar bir gösterimdir
ve bayat olabilir.

Sıra önemli: kilit faturalandırmayla iner, böylece hiç plan atamayan bir instance serileştirmenin
bedelini hiç ödemez ve ADR 0027'nin "bir workspace'in yüklemelerini serileştirir" argümanı tam olarak
hakkında yazıldığı deployment'lar için doğru kalır.

### 10. Token tavanları plan niceliğidir, kataloğa ertelenir

Bugün bir üye sınırsız personal access token üretebilir ve bir token'ın son kullanma tarihi
opsiyoneldir, yani hiç sona ermeyen bir kimlik bilgisi mümkündür. Kendi kendine barındıran bir takım
için bu bir kusur değildir. Barındırılan bir servis için koltuk başına sınırsız kimlik bilgisi bir
destek ve iptal problemidir. Cevap **iki yeni ortam değişkeni değildir**: ADR 0028 ücretli farkların
nicelik olduğunu söylüyor ve `PLAN_CATALOG` artık bir niceliğin yaşadığı yer. Barındırılan servisin
müşterileri olduğunda kataloğa ve plan limiti çözümleyicisine bir `maxTokensPerMember` anahtarı girer
ve mevcut `Plan Limit Exceeded` zarfıyla reddeder. Azami token **ömrü** farklı bir sorudur, bir plan
sorusundan çok bir API 1.0 sertleştirme sorusudur ve `/v1` kalanıyla birlikte durur.

### 11. Barındırma için operasyonel ön koşullar, listelenir ve karara bağlanmaz

Barındırılan servisi işletmek, bu kaydın bilinçli olarak vermediği kararlar gerektirir; her biri kendi
ADR'sidir ve hiçbiri bir müşteriden ücret almanın kritik yolunda değildir. "Barındırma başka ne
gerektiriyor" sorusunun cevabı hafıza olmasın diye listeleniyorlar:

| Ön koşul                                                                                                                                                                  | Karar tetiği                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Mevcut `StorageBackend` port'unun arkasında nesne depolama (yalnızca `disk-storage-backend.ts` var; ADR 0022 port'u ayırmıştı)                                            | İkinci bir API instance'ına ihtiyaç duyan ilk barındırılan deployment              |
| Bir metrik yüzeyi (`docs/development.md` tasarım gereği Prometheus, Grafana ve log shipper olmadığını söylüyor)                                                           | Bir müşteriye verilen ilk erişilebilirlik taahhüdü                                 |
| Sırların `.env` yerine bir secrets manager'dan gelmesi                                                                                                                    | Sürdürücü olmayan ilk operatör                                                     |
| Uçtan uca çok instance davranışı (Socket.io'da Redis adapter zaten var; yükleme bayt sayaçları Redis hata verdiğinde process belleğine düşüyor, ki bu instance başınadır) | Nesne depolamayla aynı tetik; Compose dosyası tek-host kısıtını zaten adlandırıyor |
| Tenant başına yedekleme ve geri yükleme                                                                                                                                   | Tek bir workspace'i dışa aktarma veya geri yükleme yönündeki ilk müşteri talebi    |

## Gerekçe

**Vergi argümanı neden ücret argümanından üstün.** Bir merchant of record işlem başına bir işlemciden
daha pahalıdır ve bir tabloda karşılaştırmanın tamamı budur. Yanlış tablodur. Solo bir projeyi
gerçekten tehdit eden maliyet bir yüzde değil, sürdürücünün yaşamadığı yargı alanlarında, son
tarihleri, beyanları ve cezaları olan, ödeyen kişinin otomatikleştiremeyeceği ve ölçekte değil ilk
satışta gelen tekrar eden bir uyum yükümlülüğüdür. Satıcı olması için bir sağlayıcıya ödeme yapmak,
açık uçlu bir hukuki maruziyeti bir gider kalemine çevirir. Kurul bir gün yüzdenin gerçekten baskın
olduğu bir hacme ulaşırsa, bu iyi bir problemdir, 1. bölümdeki port ikinci adaptörün gideceği yerdir ve
bu kayıt, ihtiyattan değil kanıttan yazılmış bir kayıtla yerini bırakabilir.

**Hak yazımı neden yazmadan önce doğrular.** Bu, ADR 0032'nin bilinçli olarak bağışlayıcı okuyucusunun
tehlikeli hâle geldiği tek yerdir. Kullanılamaz bir anahtarı düşürmek, elle yazılan ve her istekte
okunan bir kolon için doğrudur; kötü bir yazmanın bir kesintiye değil instance varsayılanına
düşmesini sağlar. Ama hiçbir `PLAN_MAX_*` değişkeni ayarlı olmayan barındırılan bir instance'ta
"instance varsayılanına düşer" _sınırsız_ demektir, dolayısıyla doğrulamayan bir yazıcı bir yazım
hatasını bedava bir kurumsal plana çevirir ve bunu hiçbir yerde hiçbir şey raporlamaz. Doğrulama dört
satırdır ve yazımın otomatikleştirilmesini güvenli kılan şeydir.

**Webhook'lara ek olarak neden günlük bir mutabakat.** Webhook teslimi en iyi ihtimalle
en-az-bir-keredir ve pratikte elden gelenin en iyisidir; [ADR 0033](0033-webhook-delivery-and-failure-policy.md) Kurul'un kendi dışa giden teslimleri
için aynı şeyi söylüyor ve tüketicilere mutabakat kurmalarını söylüyor. Bunu Kurul'un tüketicilerinden
istemek ve sonra burada bir sağlayıcının event'lerine tek doğruluk kaynağı olarak güvenmek tutarsız
olurdu. Mutabakat geçişi ayrıca ödemesiz dönem sonunu bir zamanlayıcı olmadan işleten şeydir: zaten
her aboneliği ziyaret eden günlük bir job'dır.

**Alıcı neden `@Public()` bir Nest controller değil de Nest'in altında.** İkisi de çalışır. Nest'in
altında ham gövde Nest'e özgü bir opt-in olmadan hazırdır, route yapısı gereği `/v1`'in dışındadır ve
asla versiyonlanmış kontratın parçası olmaz, ve gelecekteki global bir guard'ın sessizce ona uygulanma
ihtimali yoktur. Nest içinde route exception filter'ı ve OpenAPI belgesini miras alırdı, ki bu bir
kazanç gibi duruyor ta ki ikisinin de istenmediği fark edilene kadar: sağlayıcı Kurul'un hata zarfını
okumaz ve alıcıyı API dokümantasyonunda yayımlamak, sahip olmadığı çağıranları davet eder.

**Ödememede neden hiçbir şey silinmez.** Çünkü ürün "bu müşteri ödemeyi bıraktı" ile "bu sağlayıcının
günü kötüydü"yü ayırt edemez ve ikisinin webhook'u aynıdır. Yeni yazmaları reddetmek ödeyerek geri
alınabilir; bir board'u silmek hiçbir şeyle geri alınamaz. Plan limiti katmanı yok etmek için değil
reddetmek için inşa edildi ve faturalandırma, ondan bundan fazlasını isteyen ilk çağıran olmamalı.

## Sonuçlar

- **Kendi kendine barındırılan ürünün değişmediği kanıtlanabilmeli.** 7. bölümün e2e'si bütün dilimin
  kabul kriteridir, olsa iyi olur denen bir şey değil. O olmadan "varsayılan olarak kapalı", kodun
  kendisinin kontrol etmediği, kod hakkında bir iddiadır ve ilk regresyonu kendi kendine barındıran
  biri keşfeder.
- **Yeni tablolar yeni saklama satırları demektir.** `BillingEvent` yalnızca ekleme yapılan bir tablodur
  ve her sağlayıcı yeniden denemesiyle büyür, dolayısıyla bir pencereyle
  [ADR 0020](0020-data-retention.md)'nin tablosuna girer (öneri 90 gün: "o event'i uyguladık mı"
  sorusunu cevaplayacak kadar uzun, defterin süpürme için asla indekse ihtiyaç duymayacağı kadar kısa).
  `Subscription`'ın penceresi yoktur: ödeme yapan workspace başına tek bir satırdır ve workspace'iyle
  birlikte cascade eder.
- **Advisory kilit barındırılan instance'larda ölçülebilir davranışı değiştirir.** Board oluşturma,
  davet oluşturma ve kabul etme ve dosya eki oluşturma workspace başına serileşir. Bu, eşzamanlılık
  altında gerçek bir gecikme maliyetidir ve tam tavana ihtiyaç duyan deployment'lar için, ADR 0027'nin
  önceden gördüğü bir tetikle değil, bu kaydın yazdığı bir tetikle burada kabul ediliyor.
- **Kabul edilirse [ROADMAP.md](../../../ROADMAP.md) ve
  [api-conventions.md](../api-conventions.md) değişir, bu kayıt onları değiştirmez.** "Hosted service
  billing and plan assignment" satırı buraya bir link ve ilk bir alt maddesi (ADR'nin kendisi) kazanır,
  kabul kriteri atıllık e2e'siyle büyür ve api-conventions'ın `Plan limitleri` bölümü
  `WorkspacePlanDto`'nun `plan` üyesini Türkçe aynasıyla kazanır. `apps/api/openapi.json` DTO
  değişikliğiyle aynı pull request'te yeniden üretilir, çünkü kod ile belge uyuşmazsa CI başarısız olur.
- **[ADR 0027](0027-attachment-quotas.md) ve [ADR 0032](0032-plan-limits.md), 9. bölümce kısmen geri
  alınır ve indeks satırları bunu söyler.** İkisi de mevcut durumunu korur ve
  [0011](0011-label-task-metadata-permissions.md) ile [0022](0022-attachment-storage.md)'nin zaten
  kullandığı biçimde, bu kaydı adlandıran bir not kazanır: advisory kilit retleri, operatör korkuluğu
  olan bir tavan için geçerliliğini koruyor ve gelir sınırı olan bir tavan için burada yeniden ele
  alınıyor. İndeksten 0027'ye gelen bir okuyucunun bunu öğrenmek için 0034'e kadar gitmesi
  gerekmemeli.
- **`.env.example`, `docs/self-hosting.md`, `docker-compose.yml` ve Türkçe aynaları `BILLING_PROVIDER`'ı
  ve sağlayıcının anahtar ve imzalama sırrı değişkenlerini kazanır**, hepsi ayarsız, ve ayarsızın ne
  demek olduğunu söyleyen paragrafla. Compose'un `api` environment bloğunda forward edilmeyen bir
  değişken, yayımlanan yığını çalıştıran hiç kimse için var değildir; bu artık hatırlanan değil
  denetlenen bir şey: `scripts/lib/compose-env.test.mjs`, `docker-compose.yml` API'nin okuduğu bir
  ayarı düşürdüğünde build'i düşürür.
- **Artık bir fiyatlandırma kararı bir kod kararını bekletiyor ve doğru sıra bu.** `PLAN_CATALOG`'un
  sayıları, katmanlar seçilmeden yazılamaz. Bu kayıttaki diğer her şey yer tutucu katmanlara karşı inşa
  edilebilir; kataloğun bir şema değil tek bir sabit olmasının nedeni de budur.
- **Para yeni bir olay sınıfı yaratır.** Regresyona uğrayan bir imza kontrolü, ödeme yapan bir
  workspace'e ücretsiz planı yazan bir mutabakat job'ı, iki kez uygulanan bir event: bunların her biri
  artık, en kötü mevcut hatası kaybolan bir e-posta olan bir kod tabanında, destek maliyeti olan ve
  müşterinin gördüğü bir başarısızlıktır. Idempotency defteri, tek transaction ve doğrulama adımı bu
  yüzden var ve hiçbiri opsiyonel değil.

## Değerlendirilen Alternatifler

| Alternatif                                                                      | Neden değil                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Doğrudan Stripe                                                                 | Türkiye'de yaşayan solo bir sürdürücüyü kayıtlı satıcı yapar ve sattığı her yerde sınır ötesi KDV kaydı ile beyanından sorumlu kılar                                                                                                                        |
| Better Auth'un organization `referenceId`'siyle anahtarlanan Stripe eklentisi   | Sağlayıcıyı araca göre karara bağlar; abonelik durumunu auth kütüphanesinin tablolarında, `planLimits`'i yazan transaction'ın dışında tutar; exception filter'ın çalışmadığı `/auth/*` altına mount olur; faturalandırmayı bir Better Auth major'una bağlar |
| Katman başına satırları olan bir `Plan` tablosu                                 | Bir deploy'dan başka kimsenin düzenlemediği bir kataloğu her testin ve her ortamın seed etmesi gereken bir fixture yapar, bir katman tavan kazandığında derleme hatasını kaybeder                                                                           |
| Tavanların `Subscription` satırında saklanması                                  | ADR 0032'nin kolonunu çoğaltır ve "bu workspace ne yapabilir" sorusuna, ilkiyle çelişmekte özgür ikinci bir cevap yaratır                                                                                                                                   |
| Her workspace için `afterCreateOrganization` ile ücretsiz `Subscription` satırı | Faturalandırmanın yokluğunu temsil etmek için kendi kendine barındırılan her instance'ta workspace başına bir satır; "satır yoksa ücretsiz" ne hook ne de mevcut workspace'ler için migration ister                                                         |
| Mutabakat job'ı olmadan sağlayıcı webhook'larına güvenmek                       | Kaçırılmış ya da yanlış kapsamlı bir event, ödeme yapan bir müşteriyi şikâyet edene kadar kısıtlı bırakır; hiç event gelmeden sona eren bir aboneliği fark eden bir şey yoktur                                                                              |
| Idempotency defteri olmadan event uygulamak                                     | Sağlayıcılar tasarım gereği yeniden dener ve tekrarlanan bir "abonelik güncellendi" yazımı yeniden çalıştırırdı; tekrarı bedava kılan şey tekil indekstir                                                                                                   |
| Kataloğu doğrulamadan `planLimits` yazmak                                       | `parseWorkspacePlanOverride` ayrıştıramadığını düşürür, dolayısıyla kötü bir yazma başarısız olmak yerine sınırsız verir ve bunu hiçbir şey raporlamaz                                                                                                      |
| Alıcının `@Public()` bir Nest controller'ı olması                               | Ham gövde opt-in'i, throttle muafiyeti ve guard muafiyeti ister ve sağlayıcının kontratının işi olmayan versiyonlanmış API yüzeyine katılırdı                                                                                                               |
| Ödememede veriyi askıya almak veya silmek                                       | Ürün, ödemesi geçmiş bir müşteriyi bir sağlayıcı kesintisinden ayırt edemez ve yeni yazmaları reddetmek geri alınabilirken bir board'u silmek değildir                                                                                                      |
| Ayrı bir `GET /workspaces/{id}/subscription` endpoint'i                         | ADR 0032'nin bilinçle ikide bıraktığı yerde plan durumu için üçüncü bir okuma yüzeyi; plan kimliği mevcut olanın üzerine eklemelidir                                                                                                                        |
| Ortam değişkeni olarak `PAT_MAX_TOKENS` ve `PAT_MAX_LIFETIME_DAYS`              | Yalnızca barındırmayı ilgilendiren bir konu için iki belgelenmiş değişken ve bir `/config` alanı ekler; ADR 0028 ücretli farkların nicelik olduğunu söylüyor ve nicelikler katalogda yaşıyor                                                                |
| Advisory kilidi faturalandırmadan önce, şimdi almak                             | Tavanları hâlâ operatör korkuluğu olan deployment'lar için ADR 0027'nin yazılı reddiyle sessizce çelişir; tetik ücretli bir plandır, dolayısıyla onunla iner                                                                                                |
