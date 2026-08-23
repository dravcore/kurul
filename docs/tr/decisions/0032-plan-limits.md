# 0032. Plan Limitleri: Her Tavan İçin Tek Çözümleyici, Ayarlanana Kadar Sınırsız

**Durum:** Kabul edildi
**Tarih:** 2026-08-23

> 🌐 [English (kanonik)](../../decisions/0032-plan-limits.md) | Türkçe — Bu çeviri güncel olmayabilir; kanonik kaynak İngilizce'dir.

## Bağlam

[ADR 0028](0028-open-contributions-hosted-service.md) gelirin nereden geldiğini karara bağladı:
hosted bir hizmet, yayınlanan limitler içinde ücretsiz, üzerinde ücretli, ve limitler
"operasyonel miktarlar (seat, board, storage, benzerleri), özellikler değil" diye tanımlandı. Bu
ADR ayrıca bu repo için sonucu tek cümleyle adlandırdı: ürünün, açık kodda, bir self-hoster'ın
istediği her şeye ayarlayabileceği ya da tamamen kapalı bırakabileceği bir plan-limit katmanı
büyütmesi gerekiyor.

Bugün tam olarak bir tavan var. [ADR 0027](0027-attachment-quotas.md) workspace başına ve
instance başına attachment baytlarını sınırlıyor, onları ortam değişkeninden okuyor ve tavanı
aşan bir yüklemeyi kendine ait bir `error` alanı taşıyan bir `413` ile reddediyor. Hiçbir şey bir
sayıyı sınırlamıyor: bir instance sınırsız sayıda hesap kabul ediyor, sınırsız sayıda workspace;
bir workspace sınırsız sayıda üye ve sınırsız sayıda board kabul ediyor. Hosted bir plan hiç ifade
edilemiyor, ve sınırlı bir instance isteyen bir self-hoster'ın başvuracağı bir ayar yok.

Bu ADR'nin cevapladığı soru "limit olmalı mı" değil (0028 onu cevapladı), limitlerin hangi şekli
alacağı: sayılar nerede yaşıyor, "ayarlanmamış" ne demek, nerede uygulanıyorlar, ve reddedilen bir
yazma ne söylüyor.

## Karar

**Tek bir obje her tavan sorusunu cevaplıyor, ve bayt kotaları onun üyesi.** `PlanLimitsService`
workspace başına seat ve board'u, instance başına workspace ve hesabı, ve ADR 0027'nin attachment
kotalarını aynı çözümleyici üzerinden çözümlüyor. Kotalar ortam değişkeni adlarını, `413`'lerini
ve `error: "Attachment Quota Exceeded"`'larını koruyor. Değişen şey, workspace başına olanın artık
workspace başına çözümlenebilir olması, dolayısıyla bir plan onu bir tenant için yükseltebilir ya
da düşürebilir. Öğrenilecek ikinci bir yapılandırma deseni yok: plan katmanı kotayı sarmalıyor,
onu değiştirmiyor ya da yeniden adlandırmıyor.

**Dört yeni instance değişkeni, her biri ayarlanmadığında sınırsız.**

| Değişken                        | Sınırlar                                                  |
| ------------------------------- | --------------------------------------------------------- |
| `PLAN_MAX_SEATS_PER_WORKSPACE`  | Bir workspace'teki üyeler **artı bekleyen davetler**      |
| `PLAN_MAX_BOARDS_PER_WORKSPACE` | Bir workspace'teki board'lar                              |
| `PLAN_MAX_WORKSPACES`           | Instance'taki workspace'ler                               |
| `PLAN_MAX_USERS`                | Instance'taki hesaplar (anonimleştirilmiş kayıtlar hariç) |

`0`, sınırsızın açık yazımı, tıpkı bayt kotaları ve retention pencereleri için zaten olduğu gibi;
negatif ya da tam sayı olmayan bir değer açılışta reddedilir, `readInstancePlanLimits()`'in
`PlanLimitsService.onModuleInit`'ten çalıştığı ve değerler ne olursa olsun tek bir
`Plan ceilings: …` satırı logladığı yerde.

**Ayarlanmamış sınırsızdır, ve bu ADR 0027'nin 2026-08-21 güncellemesinden kasıtlı olarak
ayrılıyor.** Bayt kotaları varsayılan sayılar kazandı çünkü sınırsız bir disk, yayınlanan Compose
topolojisinde Postgres'i de kendisiyle birlikte düşürüyor, kota bölümünü hiç okumayan operatör tam
da veritabanı ölen operatör oluyordu. Hiçbir sayının bu özelliği yok. Onuncu bir board bir satıra
mal olur; yüzüncü bir hesap bir satıra mal olur. Bir varsayılanın önleyeceği başarısızlık modu
yok, ve bir varsayılanın _yaratacağı_ başarısızlık modu gerçek: mevcut bir takımın on birinci
üyesini reddetmeye başlayan bir upgrade, kimsenin yapılandırmadığı bir gerilemedir. Dolayısıyla
katman bir operatör bir sayı söyleyene kadar hareketsizdir, ve hiç birini ayarlamayan bir instance
daha önce çalıştırdığı kod yollarını sorgu sorgusuna aynen çalıştırır: tavan `null` iken
assertion'lar hiçbir sayım sorgusu atmaz.

**Bir seat, bir üye ya da hâlâ bekleyen bir davettir.** Yalnızca üyeleri saymak, tavanı danışma
niteliğine indirirdi: limitteki bir admin yirmi davet gönderip hepsinin kabul edilmesini
izleyebilirdi. Bu, reddi aksiyon alabilecek kişiden (davet iptal edebilen ya da üye çıkarabilen
admin) aksiyon alamayacak kişiye (günler önce gönderilmiş bir bağlantıya tıklayan davetli) taşırdı
da. Bekleyen, davet listesinin zaten kullandığı aynı predicate: `status = 'pending'` ve süresi
dolmamış, dolayısıyla bir seat süpürmeye gerek kalmadan saatle kendini boşaltır, ve ayarlar
ekranının iptal edilebilir gösterdiği şey tam olarak sayının ücretlendirdiği şeydir. **Kabul**
anında sayım yalnızca üyelerdir: kabul edilen davet zaten kendi seat'ini tutuyordur, ikisini
birden saymak, tam da kapıdan giren kişi için yeri olan bir workspace'in son seat'ini reddederdi.

**Workspace başına override'lar `Workspace.planLimits`'te yaşar, nullable bir JSON kolonu.** Yok
anahtar = instance'a bırak; `null` = sınırsız; `0` = sınırsız; bir sayı = o tavan. Anlaşılan
anahtarlar `seats`, `boards`, `storageBytes`. Çözümleme sırası: override, sonra instance ortamı,
sonra sınırsız.

**Uygulama yazmada, tek bir ret şeklinde.** Board oluşturma, board'u ekleyen transaction'ın
içinde denetler. Workspace oluşturma, davet, kabul ve sign-up, koruduğu yazmadan hemen önce
denetler. Her biri `403` ile ve şununla reddeder:

```jsonc
{
  "statusCode": 403,
  "error": "Plan Limit Exceeded",
  "message": "This workspace has no seats left on its plan",
  "planLimit": { "code": "PLAN_LIMIT_SEATS", "limit": 10, "current": 10 },
  "path": "/workspaces/…/invitations",
  "timestamp": "…",
  "requestId": "…",
}
```

`planLimit`, hata zarfının `details`'ten sonraki ikinci opsiyonel üyesi, ve aynı sebeple var:
"bunu yapamazsınız" aksiyon alınabilir değildir, "10 seat'in 10'unu kullanıyorsunuz" alınabilirdir.
Kodlar `PLAN_LIMIT_SEATS`, `PLAN_LIMIT_BOARDS`, `PLAN_LIMIT_WORKSPACES` ve `PLAN_LIMIT_USERS`.

**İki okuma yüzeyi.** `GET /config`, instance tavanlarını `mailEnabled` ve `attachmentsEnabled`'ın
yanında, her çağıran için aynı deployment kapasitesi olarak yayınlar. `GET
/workspaces/{workspaceId}/plan`, bir workspace'in _çözümlenmiş_ tavanlarını ve güncel kullanımını
yayınlar, herhangi bir üye tarafından okunabilir; bu, üyeler ekranının "10 seat'in 7'si
kullanılıyor" demesini ve board listesinin oluşturma kontrolünü tavanda sessiz bir 403 yerine bir
cümleyle devre dışı bırakmasını sağlayan şey.

## Gerekçe

**Neden `403`, kendine ait bir status değil.** Bu, ADR 0027'nin hamlesini bir adım ileri taşıyor.
Kota `413`'ü yeniden kullandı, dosya başına boyut limiti tarafından zaten alınmıştı, ve ikisini
zarfın `error`'ıyla ayırdı, çünkü status tek başına hangi düzeltmenin önerileceğini söyleyemiyordu.
Burada `403` zaten "rolünüz çok düşük" tarafından alınmış, ve bir tavan tam tersi bir tavsiyeye
ihtiyaç duyuyor: hiçbir rol değişikliği yardımcı olmaz, birinin bir seat boşaltması ya da bir
sayıyı yükseltmesi gerekir. Status dürüst olanda kalıyor (kimlikli, anlaşılmış, reddedilmiş) ve
`error` alanı ayrımı taşıyor, tam olarak `docs/api-conventions.md`'nin istemcilerin dallanması
gerektiğini söylediği gibi. `402 Payment Required` reddedildi: bu kod, kimseyle ödeme ilişkisi
olmayan self-hoster'lara gidiyor, ve kendi instance'ını 20 seat'te sınırlayan bir operatörden para
istenmiyor. Hosted bir deployment, API'nin ne olduğu konusunda yalan söylemesine gerek kalmadan bu
zarfı `planLimit.code`'dan bir upgrade istemine eşleyebilir.

**Neden bir `WorkspacePlan` tablosu değil bir JSON kolonu.** Bunu yazacak satır henüz yok: hosted
billing (ADR 0028) hâlâ tasarlanmakta olan bir şekle sahip bir plan atıyor, ve bu katman için
belirtilen gereksinim, billing'in bir workspace'in tavanlarını _migration olmadan_ yazabilmesi
gerektiğiydi. Tipli bir tablo, her yeni tavanı bir migration yapar, ve yeni tavanlar olacak:
0028'in kendi listesi "benzerleri" ile bitiyor. JSON kolonu, çözümleyici onu okumayı öğrendiği gün
yeni bir anahtarı alır, ve daha eski bir okuyucu bilmediği anahtarları başarısız olmak yerine
görmezden gelir. Billing'in tavanların ötesinde ihtiyaç duyduğu şey (plan adı, sağlayıcı id'leri,
dönem sonu), 0028'in kendi sebepleriyle ekleyeceği bir tablo; bu, bu kolondan bağımsız, ve ikisini
ayrı tutmak, hiç billing'i olmayan self-hosted bir instance'ın hâlâ çalışan bir override
mekanizması olduğu anlamına geliyor.

**Neden bozuk bir override reddedilmek yerine görmezden geliniyor.** Ortam yapılandırmadır ve
orada kötü bir değer açılışta reddedilir, tam olarak tek bir kişinin gördüğü ve henüz hiçbir şeyin
çalışmadığı yerde. Kolon _veridir_, bir entegrasyon tarafından yazılır, ve bir JSON değeri
ayrıştırılamaz diye bir workspace'e hizmet vermeyi reddetmek, kötü bir yazmayı o tenant için bir
kesintiye çevirirdi. Kullanılamaz anahtarlar düşürülür, ve tavan instance'ın kendi sayısına düşer,
ki bu, kimse o satırı yazmadan önce workspace'in sahip olacağı cevaptır.

**Neden sayımlar bir sayaçta tutulmak yerine yazmada alınıyor.** ADR 0027 bunu baytlar için
cevapladı ve satırlar için de cevap aynı: `Workspace → Board → Task` cascade'i tamamen Postgres
içinde, hiçbir uygulama kodu çalışmadan iniyor, dolayısıyla denormalize bir sayaç tam da en çok yer
açan yollarda sapıyor. Canlı satırları saymak, her cascade'den sonra tanım gereği doğrudur, ve
bunun için indeks eklenmedi (ADR 0020'nin önce-ölç emsali): her sayım ya primary key üzerinden ya
da zaten foreign key olarak indekslenmiş bir kolon üzerinden çalışır, ve hiçbiri yapılandırılmamış
bir instance'ta çalışmaz.

**Neden sign-up, Better Auth mount'unda reddediliyor.** `/auth/*`, Nest router'ının altında ham
Express tarafından servis ediliyor (ADR 0004), dolayısıyla orada dinleyen bir exception filter
yok. Aynı dosyadaki organization firewall'unun kendi zarfını elle yazmasının sebebi bu. Alternatif,
bir `databaseHooks.user.create.before` hook'u, olabilecek her hesap oluşturan yolu kapsardı, ama
yalnızca Better Auth'un `APIError`'ını fırlatarak reddedebilir, ki gövdesi
`docs/api-conventions.md`'nin vaat ettiği tek hata zarfı değildir. `emailAndPassword`, bugün etkin
olan tek sign-up yolu, dolayısıyla iki yerleşim aynı istekleri kapsıyor; hook'a taşımanın
tetikleyicisi ilk ek yol (bir sosyal sağlayıcı, bir magic link). Bir tavan yalnızca sign-**up**'ı
reddeder: sign-in, bir adresi doğrulamak ve geri kalan her şey her sayıda açık kalır, dolayısıyla
`PLAN_MAX_USERS`'ı bir instance'ın kendi nüfusunun altına ayarlamak kimseyi kilitlemez.

## Sonuçlar

- **Tavanlar yumuşaktır, ve sınırlıdır.** Yalnızca board denetimi kendi yazmasıyla bir transaction
  paylaşıyor, ve o bile read-committed: iki eşzamanlı oluşturma her biri `n`'i sayabilir. Aşım,
  eşzamanlı istek sayısıyla sınırlıdır, ki bu ADR 0027'nin kabul edilen ödünüyle aynı sözlerle.
  **Tetikleyici:** bir tavanın kasten yarıştırıldığına dair bir rapor, ya da eşzamanlı istek
  başına bir yazmanın ötesinde ölçülmüş bir aşım. **Tetiklendiğinde maliyeti:** sayım ile
  insert'in etrafında, workspace id'siyle anahtarlanan bir `pg_advisory_xact_lock`.
- Workspace oluşturma ve davet, yazmalarıyla bir transaction hiç paylaşamıyor: iki yazma da Better
  Auth'un API'sine ait, bu kodun yaptığı bir Prisma çağrısına değil. Pencere bir round trip.
- `.env.example`, `docs/self-hosting.md`, `docs/api-conventions.md` ve Türkçe aynaları dört
  değişkeni, hata kod tablosunu ve iki okuma yüzeyini kazanıyor.
- Web, create-board ve invite dialog'larında `PLAN_LIMIT_ERROR` üzerinden dallanıyor, ve board'lar
  ile üyeler ekranlarında `GET .../plan`'ı okuyor. Başarısız bir plan okuması **açık** başarısız
  olur: kontrol etkin kalır, çünkü API yazmayı kendi başına reddeder ve bir reddedilen istek,
  neden hakkında hiçbir şey söylenmeyen, board oluşturamayan bir workspace'ten daha küçük bir
  zarardır.
- Hosted billing (ADR 0028) artık uygulama noktasına sahip. Bir plan atamak, `Workspace.planLimits`'i
  yazmaktır; üründeki başka hiçbir şeyin paranın karıştığını bilmesi gerekmiyor.

## Değerlendirilen alternatifler

| Alternatif                                                             | Neden olmaz                                                                                                                                 |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Varsayılan sayılar, bayt kotalarının şimdi sahip olduğu gibi           | Hiçbir sayım, dolu bir diskin yapabileceği gibi bir instance'ı düşüremez; bir varsayılan yalnızca mevcut deployment'ları upgrade'te bozardı |
| Tipli kolonlu bir `WorkspacePlan` tablosu                              | Her gelecekteki tavanı bir migration yapar, ki bu tam olarak hosted-billing satırının ihtiyaç duymaması gereken şey                         |
| `402 Payment Required`                                                 | Self-hoster'ların ödeme ilişkisi yok; kendi kendine dayatılan bir tavan bir fatura değildir                                                 |
| Yeni bir status kodu, ya da `409`'u yeniden kullanmak                  | `403` zaten "kimlikli ve reddedildi" demek; `error` alanı, hangi reddi söylemenin kod tabanının yerleşik yolu                               |
| Her tavan için tek bir guard ya da interceptor                         | Bir isteğin hangi miktarı tükettiğini tahmin etmesi gerekirdi, ve yazmaların ikisinin yaşadığı Better Auth route'larında hiç çalışmazdı     |
| Bekleyen davetler olmadan yalnızca üyeleri saymak                      | Seat tavanını danışma niteliğine indirir, ve reddi aksiyon alamayan davetliye taşır                                                         |
| Kabul anında bekleyen davetleri de saymak                              | Tam da o kişi için yeri olan bir workspace'in son seat'ini reddeder                                                                         |
| Attachment kota değişkenlerini `PLAN_MAX_*` olarak yeniden adlandırmak | Kimsenin istemediği bir adlandırma simetrisi için her mevcut `.env`'i bozar; plan katmanı kotaları okur, onlara sahip olmaz                 |
| Denormalize kullanım sayaçları                                         | Cascade silmeler tamamen Postgres içinde çalışır, dolayısıyla sayaç en çok yer açan yollarda sapar (ADR 0027'nin bulgusu, değişmeden)       |
