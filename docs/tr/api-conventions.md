# API Konvansiyonları

Kurultay API'si için REST konvansiyonları: URL'ler, verb'ler, payload'lar, hatalar,
pagination ve DTO'lar.

> 🌐 [English (canonical)](../api-conventions.md) | Türkçe — Bu çeviri güncel olmayabilir; kanonik kaynak İngilizce'dir.

## İçindekiler

- [Kapsam](#kapsam)
- [Kaynak adlandırma](#kaynak-adlandırma)
- [HTTP verb'leri ve status kodları](#http-verbleri-ve-status-kodları)
- [Request ve response body'leri](#request-ve-response-bodyleri)
- [Hatalar](#hatalar)
- [Rate limiting](#rate-limiting)
- [Pagination](#pagination)
- [Filtreleme, sıralama, alan seçimi](#filtreleme-sıralama-alan-seçimi)
- [DTO adlandırma](#dto-adlandırma)
- [Veri tipleri](#veri-tipleri)
- [Versiyonlama](#versiyonlama)

## Kapsam

Bu kurallar `apps/api`'deki her HTTP endpoint'i için geçerlidir. Socket.io event'leri,
`@kurultay/shared-types`'ta tanımlanan ve [architecture.md](architecture.md)'de tarif
edilen kendi kontratını takip eder.

Geliştirmede base URL: `http://localhost:4000`.

## Kaynak adlandırma

| Kural                                                            |                                                                                                                                                                                                                                                                                   |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fiil değil isim                                                  | `/tasks`, asla `/getTasks` değil                                                                                                                                                                                                                                                  |
| Çoğul koleksiyonlar                                              | `/boards`, `/tasks`, `/workspaces`                                                                                                                                                                                                                                                |
| Path'lerde kebab-case                                            | `/workspace-members`, `/workspaceMembers` değil                                                                                                                                                                                                                                   |
| camelCase path param'ları                                        | `:workspaceId`, `:boardId`, `:taskId`                                                                                                                                                                                                                                             |
| İç içelik sahipliği ifade eder                                   | Bir koleksiyona kendi sahibi üzerinden ulaşılır: bir board'un task'ları, bir task'ın yorumları                                                                                                                                                                                    |
| İç içelik, workspace kökünün 2 seviye altında durur              | `:workspaceId` her route'ta zorunludur ve limite dahil edilmez — o bir hiyerarşi seviyesi değil, tenant scope'udur. Daha derin hiyerarşiler yerine query filtreleri kullanılır                                                                                                    |
| Bir kaynağın id'si olduğunda, ona sığ (shallow) biçimde ulaşılır | `/workspaces/:workspaceId/tasks/:taskId`, asla `/workspaces/:workspaceId/boards/:boardId/tasks/:taskId` değil. Id zaten satırı tanımlıyor; workspace guard'ı zaten onu scope'luyor. Ebeveyn segmenti, sunucunun doğrulaması gereken ama hiçbir fayda sağlamayan bir değer ekliyor |

### Workspace scoping

**Kaynak taşıyan her route bir workspace'in altına iç içe geçirilir.** Bu bir süsleme
değildir — multi-tenant izolasyonunun, hiçbir servis kodu çalışmadan önce guard
seviyesinde nasıl zorlandığıdır. `:workspaceId` içermeyen bir route bir guard tarafından
scope'lanamaz ve bu yüzden, aşağıda listelenen hesap seviyesi route'lar dışında izin
verilmez.

```
GET    /workspaces
POST   /workspaces
GET    /workspaces/:workspaceId
PATCH  /workspaces/:workspaceId
DELETE /workspaces/:workspaceId

GET    /workspaces/:workspaceId/members        # roster'ın cursor sayfası
GET    /workspaces/:workspaceId/members/me     # çağıranın kendi üyeliği
POST   /workspaces/:workspaceId/members/me/leave      # workspace'ten ayrıl (her rol)
DELETE /workspaces/:workspaceId/members/:userId       # üyeyi çıkar (OWNER/ADMIN)
PATCH  /workspaces/:workspaceId/members/:userId/role  # üyenin rolünü değiştir (OWNER/ADMIN)
GET    /workspaces/:workspaceId/invitations     # bekleyen davetlerin cursor sayfası (OWNER/ADMIN)
POST   /workspaces/:workspaceId/invitations
DELETE /workspaces/:workspaceId/invitations/:invitationId

GET    /workspaces/:workspaceId/boards
POST   /workspaces/:workspaceId/boards
GET    /workspaces/:workspaceId/boards/:boardId
PATCH  /workspaces/:workspaceId/boards/:boardId
DELETE /workspaces/:workspaceId/boards/:boardId

GET    /workspaces/:workspaceId/boards/:boardId/columns
POST   /workspaces/:workspaceId/boards/:boardId/columns
POST   /workspaces/:workspaceId/boards/:boardId/columns/defaults  # boş board'u tohumla
PATCH  /workspaces/:workspaceId/columns/:columnId
DELETE /workspaces/:workspaceId/columns/:columnId
PATCH  /workspaces/:workspaceId/columns/:columnId/position

GET    /workspaces/:workspaceId/boards/:boardId/tasks     # listele, board'a scope'lu
POST   /workspaces/:workspaceId/boards/:boardId/tasks     # bir board içinde oluştur

GET    /workspaces/:workspaceId/tasks/:taskId
PATCH  /workspaces/:workspaceId/tasks/:taskId
DELETE /workspaces/:workspaceId/tasks/:taskId
PATCH  /workspaces/:workspaceId/tasks/:taskId/position

GET    /workspaces/:workspaceId/boards/:boardId/labels
POST   /workspaces/:workspaceId/boards/:boardId/labels
PATCH  /workspaces/:workspaceId/labels/:labelId
DELETE /workspaces/:workspaceId/labels/:labelId

POST   /workspaces/:workspaceId/tasks/:taskId/assignees
DELETE /workspaces/:workspaceId/tasks/:taskId/assignees/:userId
POST   /workspaces/:workspaceId/tasks/:taskId/labels
DELETE /workspaces/:workspaceId/tasks/:taskId/labels/:labelId

GET    /workspaces/:workspaceId/tasks/:taskId/comments
POST   /workspaces/:workspaceId/tasks/:taskId/comments
DELETE /workspaces/:workspaceId/comments/:commentId

GET    /workspaces/:workspaceId/activities                 # workspace aktivite akışı
GET    /workspaces/:workspaceId/tasks/:taskId/activities    # task aktivite akışı

GET    /workspaces/:workspaceId/dashboard/summary

GET    /workspaces/:workspaceId/notifications
GET    /workspaces/:workspaceId/notifications/unread-count
POST   /workspaces/:workspaceId/notifications/read-all
POST   /workspaces/:workspaceId/notifications/:notificationId/read
```

Board ve column rol kapıları:
[ADR 0009](decisions/0009-board-column-permissions.md). Task kapıları:
[ADR 0010](decisions/0010-task-permissions.md). Label ve metadata kapıları:
[ADR 0011](decisions/0011-label-task-metadata-permissions.md). Comment silme yetkisi:
[ADR 0012](decisions/0012-comment-delete-authorship.md). Activity, dashboard ve notification
route'ları aynı veri üzerinde salt-okunur agregasyon/akışlardır ve ayrı bir rol matrisi
yerine workspace üyelik kapısını (`WorkspaceGuard`) miras alır.

Davetler public API'de workspace-scoped'dır. Persistence Better Auth organization
plugin'ine aittir (Faz 1'de Prisma `Invitation` modeli yok). Ürün isimleri
organization → Workspace eşlemesini kullanır — bkz. [ADR 0004](decisions/0004-auth-better-auth.md#alan-eşlemesi-organization--workspace).

Şekle dikkat edin: bir **koleksiyon**, listeyi scope'layan şey olduğu için onu sahiplenen
ebeveynin altına iç içe yerleştirilir. Bir **tekil kaynak**, kendisini bulmak için
başka hiçbir şeye ihtiyaç olmadığı için kendi id'siyle doğrudan workspace'in altında
adreslenir.

Workspace olmayan route'lar (tam liste):

```
GET   /health                # liveness, kimliksiz
GET   /health/ready          # readiness, kimliksiz
POST  /auth/*                # Better Auth handler'ları
GET   /me                    # mevcut kullanıcı profili
PATCH /me                    # kendi profili; bugün yalnızca arayüz dili
```

İki health route'u farklı sorulara cevap verir, birbirinin yerine kullanılamaz. `/health`
liveness'tır — süreç ayakta mı — ve hiçbir bağımlılığa dokunmaz; böylece bir bağımlılıktaki
anlık dalgalanma instance'ı yeniden başlatmaya yol açmaz. `/health/ready` Postgres ve Redis'i
yoklar: instance trafik alabiliyorsa `{ status, checks }` gövdesiyle `200`, alamıyorsa aynı
gövdeyle `503` döner; `checks` düşen bağımlılığı adıyla söyler (`up` / `down` / `skipped` —
sonuncusu deployment'ın o bağımlılığı hiç yapılandırmadığı anlamına gelir). Hata gövdesi
bilinçli olarak aşağıdaki hata zarfı değil, probe belgesinin kendisidir — çağıran taraf bir
healthcheck'tir, bir istemci değil.

`PATCH /me` workspace'e scope'lu değildir ve rol kontrolü yoktur: özne çağıranın kendisidir,
dolayısıyla yetkilendirmenin tamamı session guard'ıdır. `User.locale`'in yazıldığı tek yer de
burasıdır — bkz.
[decisions/0018-localization-strategy.md](decisions/0018-localization-strategy.md).

### CRUD olmayan aksiyonlar

Bazı operasyonlar bir kaynak güncellemesi değildir — bir task'ı taşımak sıralamayı yeniden
hesaplar, bir davet düzenlenmek yerine kabul edilir. Bunları mümkün olduğunda **fiilsiz
isimli bir alt-kaynak** olarak, mümkün olmadığında ise açık bir aksiyon segmenti olarak
modelleyin:

```
PATCH /workspaces/:workspaceId/columns/:columnId/position
PATCH /workspaces/:workspaceId/tasks/:taskId/position
POST  /workspaces/:workspaceId/invitations/:invitationId/accept
POST  /workspaces/:workspaceId/tasks/:taskId/assignees
```

Aksiyon segmentleri istisnadır ve her birinin bir sebebi olmalıdır.
`/tasks/:id/doUpdate` gibi bir şey icat etmeyin.

## HTTP verb'leri ve status kodları

| Verb     | Semantik                                               | Idempotent | Body  | Başarı                             |
| -------- | ------------------------------------------------------ | ---------- | ----- | ---------------------------------- |
| `GET`    | Bir kaynağı veya koleksiyonu oku                       | Evet       | Hayır | `200`                              |
| `POST`   | Oluştur, ya da idempotent olmayan bir aksiyonu tetikle | Hayır      | Evet  | `201` (oluşturma), `200` (aksiyon) |
| `PATCH`  | Kısmi güncelleme — yalnızca gönderilen alanlar değişir | Hayır      | Evet  | `200`                              |
| `PUT`    | Tam değiştirme                                         | Evet       | Evet  | `200`                              |
| `DELETE` | Kaldır                                                 | Evet       | Hayır | `204`                              |

**Güncellemeler için varsayılan `PATCH`'tir.** `PUT`, yalnızca tam bir değiştirmenin
gerçekten operasyon olduğu yerde kullanılır (örneğin bir column'un tamamını yeniden
sıralamak). Bir alanı atlayan bir `PATCH` onu dokunulmamış bırakır; açıkça `null` göndermek
nullable bir alanı temizler.

| Status                      | Ne zaman                                                                                                      |
| --------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `200 OK`                    | Başarılı okuma, güncelleme veya aksiyon                                                                       |
| `201 Created`               | Kaynak oluşturuldu; body oluşturulan kaynaktır                                                                |
| `204 No Content`            | Başarılı silme; boş body                                                                                      |
| `400 Bad Request`           | Bozuk request veya validation hatası                                                                          |
| `401 Unauthorized`          | Eksik veya geçersiz session                                                                                   |
| `403 Forbidden`             | Kimlikli, workspace üyesi, ama rol yetersiz                                                                   |
| `404 Not Found`             | Kaynak yok **veya** başka bir workspace'e ait                                                                 |
| `409 Conflict`              | Benzersizlik ihlali (yinelenen slug), veya çakışan bir eşzamanlı değişiklik                                   |
| `422 Unprocessable Entity`  | İyi biçimlendirilmiş ama semantik olarak geçersiz (örn. bir task'ı başka bir board'daki bir column'a taşımak) |
| `429 Too Many Requests`     | Rate limit uygulandı                                                                                          |
| `500 Internal Server Error` | Ele alınmamış hata. Asla bir stack trace sızdırmaz.                                                           |

**Cross-workspace erişim `403` değil `404` döner.** Bir `403`, kaynağın var olduğunu
doğrulardı, ki bu tenant sınırının ötesine bilgi sızdırır. `403`, rolü çok düşük meşru bir
üye için ayrılmıştır.

## Request ve response body'leri

Kaynaklar **düz JSON objeleri** olarak döndürülür. Bir `data` sarmalayıcısı, bir `success`
flag'i, bir zarf (envelope) yoktur.

```jsonc
// GET /workspaces/w_1/tasks/t_1  → 200
{
  "id": "0198e2c1-4f3a-7b21-9c4d-5e6f7a8b9c0d",
  "boardId": "0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d4f",
  "columnId": "0198e2c0-c2d3-7a15-b6e7-8f90a1b2c3d4",
  "title": "Implement fractional indexing",
  "description": "Positions must survive concurrent moves.",
  "priority": "HIGH",
  "position": 1024.5,
  "dueDate": "2026-09-01T00:00:00.000Z",
  "estimatedMinutes": 240,
  "assignees": [{ "userId": "usr_1", "name": "Doğan", "avatarUrl": null }],
  "labels": [
    {
      "id": "lbl_1",
      "boardId": "0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d4f",
      "name": "backend",
      "color": "slot-1",
    },
  ],
  "createdById": "usr_1",
  "createdAt": "2026-08-08T09:12:31.114Z",
  "updatedAt": "2026-08-08T09:12:31.114Z",
}
```

Koleksiyonlar tek istisnadır: sayfalı listeler cursor metadata'sını item'larla birlikte
taşır (bkz. [Pagination](#pagination)).

Kurallar:

- JSON property isimleri `camelCase`'dir.
- Boyut uğruna hiçbir şey atlanmaz — var olan bir alan her zaman mevcuttur, boşsa `null`
  ile. Client'lar "yok"u "null"dan ayırt etmek zorunda kalmamalıdır.
- Bir Prisma entity'sini asla doğrudan döndürmeyin. Neyin public olduğuna response DTO'su
  karar verir.
- Body'si olan her response'ta `Content-Type: application/json; charset=utf-8`.

## Hatalar

Hatalar **problem-JSON tarzı bir obje** kullanır (ruhen RFC 7807, ancak framework'ün
built-in exception'larıyla elle yazılmış olanların aynı görünmesi için NestJS'in alan
isimleriyle):

```jsonc
{
  "statusCode": 400,
  "error": "Bad Request",
  "message": "Validation failed",
  "details": [
    { "field": "title", "constraint": "isNotEmpty", "message": "title should not be empty" },
    {
      "field": "estimatedMinutes",
      "constraint": "min",
      "message": "estimatedMinutes must not be less than 0",
    },
  ],
  "path": "/workspaces/w_1/boards/b_1/tasks",
  "timestamp": "2026-08-08T09:12:31.114Z",
  "requestId": "0198e2c1-4f3a-7b21-9c4d-5e6f7a8b9c0d",
}
```

| Alan         | Tip    | Zorunlu | Anlam                                                                            |
| ------------ | ------ | ------- | -------------------------------------------------------------------------------- |
| `statusCode` | number | evet    | HTTP status'ünü yansıtır                                                         |
| `error`      | string | evet    | Kararlı, makine tarafından okunabilir sebep ifadesi (`Bad Request`, `Not Found`) |
| `message`    | string | evet    | İnsan tarafından okunabilir, tek cümle, loglanması güvenli                       |
| `details`    | array  | hayır   | Alan bazlı validation problemleri; yalnızca `400`/`422`'de mevcut                |
| `path`       | string | evet    | Request path'i                                                                   |
| `timestamp`  | string | evet    | ISO 8601 UTC                                                                     |
| `requestId`  | string | evet    | Korelasyon id'si; `X-Request-Id` response header'ıyla aynı değer                 |

- Tek bir global exception filter, ele alınmamışlar dahil **her** hata için bu şekli
  üretir. API'nin hiçbir yerinde ikinci bir hata formatı yoktur.
- `message`, production'da asla ham bir exception string'i değildir, stack trace'ler
  döndürülmez, loglanır.
- Client'lar `message` metnine değil, `statusCode` ve `error`'a göre dallanır.

### Request korelasyonu

Her request bir id taşır ve her response bunu `X-Request-Id` header'ında geri döndürür.
Client kendi id'sini verebilir — bir reverse proxy ya da load balancer'ın ürettiği id
doğrudan akıp geçer — yeter ki URL-safe ve 8–128 karakter arasında olsun; bunun dışındaki
her şey atılır ve yerine üretilmiş bir [UUIDv7](#veri-tipleri) konur, böylece bir header
değeri hiçbir zaman sanitize edilmeden bir log satırına veya response body'sine ulaşamaz.

Aynı id üç yerde birden görünür, ki asıl mesele budur: client'ın aldığı `X-Request-Id`
header'ı, hata zarfının `requestId` alanı ve o request'e ait sunucu log satırları. Bir
hatayı bildiren kullanıcı tek bir id verir ve bu id tam olarak tek bir request'i seçer.

Biten her request ayrıca stdout'a tek satırlık bir JSON erişim logu yazar:

```jsonc
{
  "ts": "2026-08-13T19:03:32.070Z",
  "level": "info", // info < 400, warn 4xx, error 5xx
  "requestId": "0198e2c1-4f3a-7b21-9c4d-5e6f7a8b9c0d",
  "method": "GET",
  "path": "/workspaces/w_1/tasks", // yalnızca route — query string ayıklanır
  "status": 200,
  "durationMs": 15.444,
  "userId": "0198e2c1-9a11-7c40-8f2b-1d3e5a7c9b02", // kimliksiz istekte yer almaz
  "ip": "203.0.113.7", // Express'in çözdüğü client IP'si — bkz. aşağıda TRUST_PROXY
}
```

Bu alan listesi kapalıdır. Request body'leri, query string'ler, header'lar ve cookie'ler
asla loglanmaz: query kullanıcının verdiği filtreleri ve arama terimlerini, header'lar ise
session cookie'lerini ve davet token'larını taşır. `ip`, ham bir header değil Express'in kendi
`req.ip`'sidir — yapılandırılmamışsa bu her zaman TCP peer'ıdır, yani yapılandırılmamış bir
reverse proxy arkasında her istek için proxy'nin adresidir. Aşağıda `TRUST_PROXY`'ye bakın.

## Rate limiting

Her endpoint'in bir istek bütçesi vardır. Bütçe aşıldığında yukarıdaki hata zarfıyla `429`
döner; `Retry-After` header'ı kaç saniye beklenmesi gerektiğini söyler. Bütçe içindeki
istekler `X-RateLimit-Limit`, `X-RateLimit-Remaining` ve `X-RateLimit-Reset` taşır.

Bütçeler **client IP'si ve route başına**, kayan bir dakikalık pencerede sayılır — yoğun
çalışan bir endpoint asla başka bir endpoint'in payını harcamaz.

| Endpoint                                    | Bütçe    | Neden                                                                       |
| ------------------------------------------- | -------- | --------------------------------------------------------------------------- |
| Aşağıda sayılmayan her endpoint             | 100 / dk | Bir insanın üreteceğinin çok üstünde; script'i sınırlar                     |
| `POST /workspaces/:workspaceId/invitations` | 10 / dk  | Her çağrı, adresini çağıranın seçtiği bir mesajı SMTP relay'ine verir       |
| `GET .../boards/:boardId/tasks?q=`          | 30 / dk  | `q=` bir trigram taramasıdır; aynı route `q=` olmadan varsayılanda kalır    |
| `/auth/sign-in*`, `/auth/sign-up*`          | 3 / 10sn | Better Auth'un kimlik endpoint'leri için yerleşik kuralı                    |
| Diğer `/auth/*`                             | 100 / dk | Better Auth'un kendi limiter'ı — `/auth/*` Nest router'ını atlar (ADR 0004) |
| `GET /health`, `GET /health/ready`          | muaf     | Throttle edilen bir probe, sağlıklı bir API'yi çökmüş gösterir              |

İki router olduğu için iki limiter var. `/auth/*` Nest'in altındaki ham Express tarafından
sunulur, dolayısıyla `ThrottlerGuard` onu hiç görmez ve işi Better Auth'un kendi limiter'ı
yapar. Better Auth'un sayaçları `REDIS_URL` tanımlıysa Redis'te tutulur — instance'lar arası
paylaşılır, restart'ı atlatır — değilse process belleğinde, ki bu da desteklenen tek-instance
konfigürasyonudur. Nest throttler'ının sayaçları her zaman instance başınadır.

İki limiter da aynı çözümlenmiş client IP'sini kullanır, tek bir ayarla sürülür:
`TRUST_PROXY` (varsayılan boş/`false`). Kapalıyken uygulama, ham TCP bağlantısının ötesinde
istek hakkında hiçbir şeye güvenmez — `req.ip` her zaman socket peer'ıdır ve bir client'ın
gönderdiği herhangi bir `X-Forwarded-For` tamamen yok sayılır; doğrudan expose edilen bir
kurulumu bir client'ın kendi rate-limit bucket'ına sızmasına karşı güvenli kılan da budur.
Reverse proxy arkasında (Caddy/Traefik uygulamanın önünde TLS sonlandırıyor) bunu kapalı
bırakmak, her isteğin proxy'den gelmiş gibi görünmesi demektir — gerçek her client için tek
bir paylaşılan bütçe, ve erişim logundaki `ip` alanı da aynı şekilde işe yaramaz hale gelir.
`TRUST_PROXY`'yi hop sayısına (tek proxy için `1`) ya da proxy'nin IP/CIDR'ine ayarlayın;
Express gerçek client'ı `X-Forwarded-For`'dan her iki router için de aynı şekilde çözer.
Better Auth bu ayara kendiliğinden hiç bakmaz — `X-Forwarded-For`'u kendi başına yeniden
parse eder ve uygulamanın önünde hiç proxy olmasa bile tek-değerli, taklit edilmiş bir
header'ı kabul ederdi — bu yüzden `auth/auth.ts`, Better Auth'un
`advanced.ipAddress.ipAddressHeaders` ayarını, uygulamanın her istekte aynı
Express-çözümlü adresle damgaladığı ve client'ın gönderdiği her şeyin üzerine yazdığı özel
bir header'a yönlendirir. `TRUST_PROXY=true`, hiçbir doğrulama yapmadan iletilen zincirin
tamamına güvenir ve yalnızca API proxy dışında erişilemezken kullanılmalıdır — doğrudan
expose edilen bir kurulumda her saldırgana sınırsız bütçe verir.

`RATE_LIMIT_ENABLED=false` her iki limiter'ı da kapatır. Tek bir adresten route başına
yüzlerce istek süren entegrasyon testleri için vardır; bunu ayarlayan bir deployment'ın
brute-force tavanı yoktur.

## Pagination

**Cursor pagination varsayılandır.** Sayfa numarası pagination'ı yalnızca gerçekten sınırlı
koleksiyonlar (bir board'un column'ları) için kabul edilebilir — yani toplam sayının
beklentiyle değil, yapısı gereği küçük olduğu yerlerde.

"Üye sayısı zaten azdır" tam olarak böyle bir beklentiydi ve roster'ın bir faz boyunca
`take: 1000` arkasında düz bir dizi döndürmesinin nedeni buydu: bu sınırı aşan bir workspace
kuyruğunu sessizce kaybediyordu, yanıtta bunu söyleyen hiçbir alan olmadan. Boyutuna
kullanıcının karar verdiği bir koleksiyon cursor alır: sayfalanmamış bir liste, sunucunun
onu her zaman bütün döndürebileceği vaadidir.

Neden varsayılan olarak cursor:

- `OFFSET`, büyük tablolarda doğrusal olarak bozulur; keyset lookup'lar sabit kalır.
- Satırlar session ortasında client'ın altına ekleniyor — başka bir kullanıcı tarafından,
  ve realtime katmanı üzerinden görünür biçimde. Offset pagination bunu en kötü
  ele alan yöntem: client'ın penceresinden önceki her ekleme tüm listeyi kaydırır ve
  sonraki sayfa satırları ya tekrarlar ya da atlar.

### Cursor anahtarı her zaman `id`'dir, asla `position` değil

**Bu bir tercih değil, doğruluk kuralıdır.** Bir keyset cursor'ın hiçbir satırı
düşürmemeyi garanti etmesi, ancak üzerine key'lendiği alan client'ın henüz görmediği
satırlar için _değişmez (immutable)_ ise mümkündür. `Task.position` değişmezliğin tam
tersidir: fractional indexing onu her drag-and-drop'ta yeniden yazar
([`decisions/0006-fractional-indexing.md`](decisions/0006-fractional-indexing.md)).
Client'ın cursor'ının ötesinde oturan bir task, biri onu column'un en üstüne sürüklediğinde
artık cursor değerinin _altında_ bir `position`'a sahip oluyor — `WHERE position > :cursor`
onu bir daha asla döndürmeyecek ve satır sessizce düşecek. Eşzamanlı yeniden sıralama, tam
olarak `position`'ın neden cursor anahtarı olamayacağının nedenidir.

`id`, cursor'ın ihtiyaç duyduğu özelliklere sahip: bir **UUIDv7**
([Veri tipleri](#veri-tipleri)), dolayısıyla satırın ömrü boyunca değişmez, ekleme
zamanına göre monotonik ve index-local — rastgele bir seek değil, gerçek bir keyset.

Board rendering hâlâ task'ları `position`'a göre sıralıyor; bu ikisi ayrı kaygılar.
`position` bir kartın _nerede göründüğüne_ karar verir, `id` _sayfa sınırının nerede
düştüğüne_ karar verir. Büyük bir task listesini sayfalayan bir client, her satırı tam
olarak bir kez alır ve gösterim için biriktirilmiş kümeyi `position`'a göre sıralar.

### Cursor request ve response

```
GET /workspaces/w_1/boards/b_1/tasks?limit=50&cursor=0198e2c1-4f3a-7b21-9c4d-5e6f7a8b9c0d
```

| Param    | Varsayılan | Maks | Notlar                                                                         |
| -------- | ---------- | ---- | ------------------------------------------------------------------------------ |
| `limit`  | 50         | 100  | Maksimumun üzerindeki değerler reddedilmez, kırpılır (clamp)                   |
| `cursor` | —          | —    | Opak. Önceki sayfanın son item'ının `id`'si. Client'lar onu parse etmemelidir. |

```jsonc
{
  "items": [/* … kaynaklar … */],
  "nextCursor": "0198e2c1-8b6d-7e93-a015-4c2f8d1e6b70", // son sayfada null
  "hasMore": true,
}
```

### Sayfa bazlı (yalnızca küçük koleksiyonlar)

```
GET /workspaces/w_1/some-bounded-collection?page=1&perPage=25
```

```jsonc
{
  "items": [/* … */],
  "page": 1,
  "perPage": 25,
  "total": 7,
  "totalPages": 1,
}
```

Bugün hiçbir endpoint bu şekli kullanmıyor — sayfalanan her liste
`@kurultay/shared-types` içindeki `CursorPage<T>`. Gerçekten sayfa numarasına ihtiyaç duyan
bir koleksiyon, ayrı bir tip yazmaya değene kadar yukarıdaki satır içi şekli kullanabilir;
ikinci bir varsayılan paylaşılan sayfalama tipi eklemeyin.

Tek sayfaya sığan bir liste de bir sayfadır. `GET .../members`, `limit` varsayılanını `100`
tavanına ayarlar; dolayısıyla sıradan bir workspace tek istekte `hasMore: false` yanıtı alır
— client cursor'ı yalnızca gidilecek bir yer kaldığında yürütür.

## Filtreleme, sıralama, alan seçimi

| Kaygı               | Konvansiyon                                | Örnek                                |
| ------------------- | ------------------------------------------ | ------------------------------------ |
| Eşitlik filtresi    | `?field=value`                             | `?priority=HIGH`                     |
| Çoklu değer (OR)    | Tekrarlanan veya virgülle ayrılmış         | `?priority=HIGH,URGENT`              |
| İlişki filtresi     | `?relationId=value`                        | `?assigneeId=usr_1&labelId=lbl_2`    |
| Aralık              | `?field[gte]=`, `?field[lte]=`             | `?dueDate[lte]=2026-09-01T00:00:00Z` |
| Null kontrolü       | `?field=null`                              | `?dueDate=null`                      |
| Serbest metin arama | `?q=`                                      | `?q=indexing`                        |
| Sıralama            | `?sort=field` / azalan için `?sort=-field` | `?sort=-createdAt`                   |
| Çoklu sıralama      | Virgülle ayrılmış, önceliği soldan sağa    | `?sort=priority,-dueDate`            |

- Birleşik filtreler **AND**'dir; bir filtre içindeki tekrarlanan değerler **OR**'dur.
- Yalnızca query DTO'sunda deklare edilen whitelist'lenmiş alanlar filtrelenebilir ve
  sıralanabilir. Bilinmeyen bir filtre sessizce yok sayılmaz, her zaman `400`'dür — sessizce
  düşürülen bir filtre kullanıcıya görmemesi gereken veriyi gösterir.
- Task'lar için varsayılan **gösterim** sıralaması artan `position`'dır; geri kalan her şey
  için `-createdAt`. Dikkat: sayfalı bir task listesi, istenen sıralamadan bağımsız olarak
  her zaman `id`'ye göre _dolaşılır_ — bkz.
  [Pagination](#cursor-anahtarı-her-zaman-iddir-asla-position-değil).
- `?fields=` sparse-fieldset desteği yok. Response şekilleri DTO'ları tarafından
  sabitlenmiştir; bir client daha azına ihtiyaç duyuyorsa, bu caching ve tipleme
  karmaşıklığına değmez.

## DTO adlandırma

| Amaç                    | Desen                     | Örnek                            |
| ----------------------- | ------------------------- | -------------------------------- |
| Oluşturma request'i     | `Create<Entity>Dto`       | `CreateTaskDto`                  |
| Tam/kısmi güncelleme    | `Update<Entity>Dto`       | `UpdateTaskDto`                  |
| Aksiyon request'i       | `<Verb><Entity>Dto`       | `MoveTaskDto`, `InviteMemberDto` |
| Liste query param'ları  | `<Entity>QueryDto`        | `TaskQueryDto`                   |
| Tekil kaynak response'u | `<Entity>ResponseDto`     | `TaskResponseDto`                |
| Liste response'u        | `<Entity>ListResponseDto` | `TaskListResponseDto`            |

- Dosya başına bir DTO, modülün `dto/` klasöründe, kebab-case adlandırılmış:
  `create-task.dto.ts`.
- `UpdateXDto`, alanları yeniden yazmak yerine `PartialType` üzerinden `CreateXDto`'dan
  türetilir.
- Request DTO'ları `class-validator` decorator'ları taşır; response DTO'ları
  `@kurultay/shared-types`'ta yansıtılan düz şekillerdir.

Tam DTO/validation kuralları: [coding-standards.md](coding-standards.md#dtolar-ve-validation).

## Veri tipleri

| Tip                   | Gösterim                                                                                                                                                                                | Örnek                                    |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Identifier            | **UUIDv7**, Prisma'nın `@default(uuid(7))`'i tarafından üretilir (Prisma 5.18'den beri mevcut). Client'lara opak: asla parse edilmez, asla sıralanmaz, asla client tarafında üretilmez. | `"0198e2c1-4f3a-7b21-9c4d-5e6f7a8b9c0d"` |
| Tarih/saat            | **ISO 8601, her zaman UTC, her zaman `Z` ile**                                                                                                                                          | `"2026-08-08T09:12:31.114Z"`             |
| Yalnızca tarih değeri | Yine de `T00:00:00.000Z`'de tam bir ISO 8601 timestamp'i                                                                                                                                | `"2026-09-01T00:00:00.000Z"`             |
| Süre                  | Tam sayı dakika (`estimatedMinutes`) — asla formatlanmış bir string değil                                                                                                               | `240`                                    |
| Position              | `Float` (fractional indexing) — asla tam sayı veya bitişiklik varsaymayın                                                                                                               | `1024.5`                                 |
| Enum                  | Shared types'ta tanımlanmış UPPER_SNAKE string                                                                                                                                          | `"HIGH"`, `"OWNER"`                      |
| Para                  | Henüz kullanılmıyor. Kullanıldığında: tam sayı minor unit + para birimi kodu.                                                                                                           | —                                        |

API asla lokal saat veya bir timezone offset'i döndürmez. Kullanıcının locale'ine göre
formatlamak frontend'in işidir.

"Opak" ifadesi iki yönlü işliyor. UUIDv7 bir timestamp gömer ve sunucu cursor pagination
için bu sıralamaya güvenir — ama client'lar güvenmemelidir. `id`'ye göre sıralayan veya
içinden bir oluşturulma zamanı okuyan bir client, gelecekteki bir id stratejisinin
kırabileceği bir implementasyon detayına bağımlı olmuş olur. Bu belgedeki URL örnekleri
okunabilirlik için id'leri kısaltır (`w_1`, `b_1`, `t_1`); gerçek olanlar 36 karakterlik
UUIDv7 string'leridir.

## Versiyonlama

**1.0 öncesi `/v1` öneki yok.** Şimdi bir versiyon segmenti eklemek, projenin vermediği bir
uyumluluk sözü ima eder — ve tam da API'nin çalkalanması beklenen dönemde tekrar tekrar
bump edilmesi gerekirdi. Bkz.
[git-strategy.md](git-strategy.md#versiyonlama-politikası-semver).

1.0'a kadar:

- Breaking API değişiklikleri herhangi bir `0.y.0` release'inde gelebilir.
- Her biri, eski ve yeni şekil ile bir migration notuyla birlikte `CHANGELOG.md`'de
  `### Changed` / `### Removed` altında belgelenir.
- `@kurultay/shared-types` monorepo ile birlikte versiyonlanır, dolayısıyla paket
  versiyonunu pinleyen bir client kontratı da pinler.

1.0'da API SemVer'ın arkasında dondurulur. Bundan sonra bir versiyonlama şeması gerekirse,
bir ADR ile getirilecektir — URI öneki (`/v1`) muhtemel seçimdir, önden değil gerçekten
ihtiyaç duyulduğunda karar verilecektir.

## Ayrıca bakınız

- [architecture.md](architecture.md) — modül haritası, socket kontratı
- [coding-standards.md](coding-standards.md) — DTO'lar, validation, modül sınırları
- [testing.md](testing.md) — endpoint testlerinin neyi assert ettiği
- [git-strategy.md](git-strategy.md) — SemVer ve changelog politikası
- [project-skeleton.md](project-skeleton.md) — bu kaynakların eşlendiği veri modeli
