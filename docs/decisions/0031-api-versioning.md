# 0031. API Versiyonlama: 1.0'da Tanıtılan Bir `/v1` URI Öneki ve Şeylerin Gönderilme Sırası

**Durum:** Kabul edildi
**Tarih:** 2026-08-23

> 🌐 [English (kanonik)](../../decisions/0031-api-versioning.md) | Türkçe (bu çeviri güncel olmayabilir; kanonik kaynak İngilizce'dir)

## Bağlam

REST API, `apps/api/openapi.json`'da commit edilen ve `/docs`'ta servis edilen, üretilmiş bir
OpenAPI belgesiyle tarif edilir; kod ile belge uyuşmadığında başarısız olan bir CI kapısı vardır
([api-conventions.md](../api-conventions.md#openapi-belgesi)). Uyumluluk hakkında herhangi bir söz
verebilmenin ön koşulu budur: bir kontratın değişmeyeceği söylenebilmeden önce yazılı hale
getirilmiş olması gerekir.

[api-conventions.md](../api-conventions.md#versiyonlama), bu kayıt var olmadan önce de bu
pozisyonu belirtiyordu: 1.0 öncesi `/v1` öneki yok, breaking değişiklikler herhangi bir `0.y.0`
release'inde gelebilir ve `CHANGELOG.md`'de belgelenir, ve `@kurul/shared-types` monorepo ile
birlikte versiyonlanır, dolayısıyla paketi pinleyen bir client kontratı da pinler. Açık bırakılan
şey şemanın kendisiydi ("URI öneki muhtemel seçim, gerçekten ihtiyaç duyulduğunda karar
verilecek") ve alternatiflerdi, ki bunlar hiçbir zaman yazılı olarak reddedilmemişti.
`ROADMAP.md`'nin "API 1.0" bölümü, 1.0'ın büyümesi beklenen üç şeyi kapsadı (bir `/v1` öneki,
kişisel erişim token'ları, minimal webhook'lar) ve tam olarak bunu istedi: diğer şemaları atlamak
yerine reddeden, ve üçünün hangi sırayla gönderildiğini kayda geçiren bir ADR.

Masada üç şema vardı.

1. **Bir URI öneki.** `/v1/workspaces/...`. Versiyon path'in içindedir, her log satırında ve her
   `curl`'de görünür, ve ikinci bir versiyon ikinci bir router mount'udur.
2. **Header negotiation.** Tek bir path, versiyon `Accept`'te (`application/vnd.kurul.v1+json`)
   ya da özel bir `X-Api-Version` header'ında, ve header yokken bir varsayılan.
3. **Versiyonlama yok.** Kontratı 1.0'da dondur ve sonsuza dek yalnızca eklemeli genişlet;
   eklemeli olamayan bir değişiklik bütün ürünün 2.0'ıdır.

## Karar

**Her route'ta bir `/v1` URI öneki, 1.0'da tanıtılır, öncesinde değil.** `/auth/*` ve iki health
probe'u bunun dışındadır: Better Auth ilkinin sahibidir ([ADR 0004](0004-auth-better-auth.md)), ve
API versiyonuyla birlikte taşınan bir probe, release gününde her healthcheck'i kırardı. 1.0'a
kadar hiçbir şey değişmez: route'lar önek almadan kalır, api-conventions.md'deki 1.0-öncesi
kurallar yürürlükte kalır, ve şimdi görünecek bir versiyon segmenti, projenin API'nin en çok
çalkalanması beklenen döneminde henüz vermediği bir söz olurdu.

**Header negotiation ve versiyonsuzluk reddedilir**, aşağıdaki gerekçelerle, ve bu reddin kendisi
kaydın önemli olan kısmıdır: önek yaygın bir seçimdir, ve bunu yazıya dökmenin sebebi kimsenin
alternatifleri bir PR yorumunda yeniden açmamasını sağlamaktır.

**Sıralama: önce kişisel erişim token'ları, sonra `/v1`, sonra webhook'lar.** Token'lar önekiz
route'lara karşı ilk gönderilir. Önek 1.0'da gelir, tarayıcı olmayan ve kararlı bir path'in bir
değer taşıdığı bir çağıran ortaya çıktığında. Webhook'lar en sona kalır, çünkü imzalı teslimat ve
bir başarısızlık politikası kendi ADR'lerini ve işaret edecekleri bir kontratı hak eder. Her adım
`ROADMAP.md`'de bir satırdır, ve sıra bir tarih değil bir bağımlılıktır.

## Gerekçe

**Neden header negotiation yerine önek.** Self-host edilen bir instance, script'ler, CI job'ları
ve bir operatörün bir araya getirdiği her şey tarafından çağrılır, ve bu çağıranlar bir API
versiyonunun var olmasının bütün sebebidir. Path versiyonu erişim logunda, bir reverse proxy'nin
routing kurallarında, bir bookmark'ta ve bir bug raporunda görünür; header versiyonu dördünde de
görünmezdir, ve iki çağıran hangi versiyonu konuştukları konusunda ilk kez anlaşamadığında
operatörün grep'leyecek hiçbir şeyi yoktur. Negotiation ayrıca header göndermeyen bir çağıran için
bir varsayılana ihtiyaç duyar, ve hangi varsayılan seçilirse seçilsin iki popülasyondan biri için
yanlıştır: en yeniye varsayılan olunca her pinlenmemiş script upgrade'de kırılır, en eskiye
varsayılan olunca her yeni çağıran sihirli header'ı öğrenene kadar eski şekli alır. Path'in yanlış
olabilecek bir varsayılanı yoktur. Son olarak, bu API bir Nest router tarafından Caddy'nin
arkasında servis edilir ve üretilmiş bir OpenAPI dosyasıyla belgelenir: önek bir mount noktası ve
bir `servers` girdisidir, header şeması ise framework'ün sağlamadığı ve OpenAPI belgesinin tek bir
kontrat olarak ifade edemediği bir content-negotiation katmanıdır.

**Neden versiyonsuzluk yerine önek.** "Sonsuza dek eklemeli", her yanıtın gelecekteki şekli
hakkında bir sözdür, ve bu proje iyi sebeplerle zaten bir kez gönderdiği şekilleri kırdı (üye
listesi bir cursor sayfasına dönüştü, davet yanıtı bir teslimat durumu kazandı). Hiçbir zaman bir
alanı yeniden adlandıramayan ya da bir tipi sıkılaştıramayan bir API, hatalarının kalıcı olduğu
bir API'dir. Versiyonsuzluk ayrıca ürünün major versiyonunu API'nin major versiyonu yapar: web
uygulamasının bir 2.0'ı her route'un bir 2.0'ı olmak zorunda kalırdı, ve breaking bir route
değişikliği bunu beklemek zorunda kalırdı. İkisinin ayrı hareket edebilmesi gerekir.

**Neden 1.0'da ve şimdi değil.** Önek lehindeki argüman ucuz olmasıdır; şimdi eklememenin karşı
argümanı bedava olmamasıdır. Her client'ta, her belgede, her README'deki her `curl`'de bir
satırdır, ve içindeki `v1` bir yalan olurdu: arkasındaki route'lar herhangi bir `0.y.0`'da hâlâ
değişebilir. 1.0-öncesi çalkalanma sırasında bump edilmek zorunda kalan bir önek, çağıranlara onu
yok saymayı öğretir, ve kontrat hareket ederken `v1`'e pinlenmiş bir önek daha kötü bir şey
öğretir. SemVer 0.y'nin ne anlama geldiğini zaten söylüyor; önek 1.0 sinyalidir ve onunla birlikte
gelmelidir.

**Neden önekten önce token'lar.** Web uygulaması olmayan bir çağıran ortaya çıkana kadar önek
kimseyi korumaz. Kişisel erişim token'ları bu ilk çağırandır, ve bugünün önekiz route'larına karşı
çalışırlar çünkü token'ı geçerli kılan versiyon değildir; dolayısıyla bağımlılık önce token'lar
sonra önek şeklinde işler, asla tersi değil. Webhook'lar tam tersi sebeple en sondadır: bunlar
API'nin dışarıyı çağırmasıdır, teslimat formatı kendi başına bir kontrattır, ve bu kontrat önek
tarafından yeniden kırılmak yerine `/v1`'in şekillerine karşı yazılmalıdır.

## Sonuçlar

- 1.0'da, her Nest route'u global bir path prefix'i üzerinden `/v1` önekini kazanır, OpenAPI
  `servers` girdisi `/`'den `/v1`'e değişir, ve web uygulamasının API client'ı bunu takip eder.
  `/auth/*`, `/health` ve `/health/ready` oldukları yerde kalır.
- Bir `/v2`, değişen route'ların `/v1`'in yanında ikinci bir mount'udur, `CHANGELOG.md`'de
  duyurulan bir deprecation penceresi için. Pencerenin uzunluğu ilk `/v2` ihtiyaç duyulduğunda
  karar verilir; bu kayıt bir tanesinin olacağına söz verir, ne kadar süreceğine değil.
- [api-conventions.md](../api-conventions.md#versiyonlama)'nin 1.0-öncesi bölümü, öneki ekleyen
  release'e kadar yürürlükte kalır, ve o release'in changelog girdisi migration notudur.
- Kişisel erişim token'ları önekiz route'lara karşı gönderilir ve önek geldikten sonra da çalışmaya
  devam eder: token bir kullanıcıyı ve bir workspace'i tanımlar, ve ikisi de yerinden oynamaz.
- ROADMAP'ın "API 1.0" bölümü kapsamı korur ve sıra için buraya link verir; bu kayıt gerekçedir, o
  bölüm ise durumdur.

## Değerlendirilen Alternatifler

| Alternatif                                             | Neden değil                                                                                                                                                                                |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Header negotiation (`Accept` ya da özel header)        | Loglarda, proxy'lerde ve bug raporlarında görünmez; bir popülasyon için yanlış olan bir varsayılana ihtiyaç duyar; üretilmiş OpenAPI belgesinin ifade edebileceği tek bir kontrat değildir |
| Yalnızca eklemeli değişikliklerle versiyonlama yok     | Gönderilen her şekli kalıcı yapar; API'nin major versiyonunu ürününkine bağlar; bu proje 1.0'dan önce zaten eklemeli olmayan değişikliklere ihtiyaç duydu                                  |
| `/v1`'i şimdi ekleyip 1.0'a kadar serbestçe bump etmek | Çalkalanma sırasında hareket eden bir versiyon, çağıranların yok saymayı öğrendiği bir versiyondur; hareket eden bir kontratın üzerinde pinlenmiş bir `v1` yanlış bir sözdür               |
| Kaynak başına versiyon (`/workspaces/v2/...`)          | Her client tek bir yerine bir versiyon tablosu tutar; OpenAPI belgesi birden çoğa bölünür; önekin operasyonel görünürlük argümanı gürültüde kaybolur                                       |
| Tarih tabanlı versiyonlar (`/2026-08-23/...`)          | Çalkalanma konusunda dürüst, ama her tarih bir breaking release'tir ve çağıranlar bir kontrat yerine bir takvim pinler; SemVer bunun için zaten var ve projenin geri kalanı onu kullanıyor |
| Token'lardan önce webhook'lar                          | Teslimat kendi başına bir kontrattır ve `/v1`-öncesi şekillere karşı yazılmış olurdu; token'lar önekin var olduğu çağırandır, dolayısıyla önek cevap vermeden önce ihtiyacı onlar kurar    |
