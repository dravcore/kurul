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

| Kural | |
|---|---|
| Fiil değil isim | `/tasks`, asla `/getTasks` değil |
| Çoğul koleksiyonlar | `/boards`, `/tasks`, `/workspaces` |
| Path'lerde kebab-case | `/workspace-members`, `/workspaceMembers` değil |
| camelCase path param'ları | `:workspaceId`, `:boardId`, `:taskId` |
| İç içelik sahipliği ifade eder | Bir task'a kendi board'u ve workspace'i üzerinden ulaşılır |
| İç içelik 3 seviyede durur | Daha derin hiyerarşiler yerine query filtreleri kullanılır |

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

GET    /workspaces/:workspaceId/members
POST   /workspaces/:workspaceId/invitations

GET    /workspaces/:workspaceId/boards
POST   /workspaces/:workspaceId/boards
GET    /workspaces/:workspaceId/boards/:boardId

GET    /workspaces/:workspaceId/boards/:boardId/columns
POST   /workspaces/:workspaceId/boards/:boardId/columns

GET    /workspaces/:workspaceId/boards/:boardId/tasks
POST   /workspaces/:workspaceId/boards/:boardId/tasks
GET    /workspaces/:workspaceId/boards/:boardId/tasks/:taskId
PATCH  /workspaces/:workspaceId/boards/:boardId/tasks/:taskId
DELETE /workspaces/:workspaceId/boards/:boardId/tasks/:taskId

GET    /workspaces/:workspaceId/boards/:boardId/tasks/:taskId/comments
POST   /workspaces/:workspaceId/boards/:boardId/tasks/:taskId/comments
```

Workspace olmayan route'lar (tam liste):

```
GET  /health                 # liveness, kimliksiz
POST /auth/*                 # Better Auth handler'ları
GET  /me                     # mevcut kullanıcı profili
```

### CRUD olmayan aksiyonlar

Bazı operasyonlar bir kaynak güncellemesi değildir — bir task'ı taşımak sıralamayı yeniden
hesaplar, bir davet düzenlenmek yerine kabul edilir. Bunları mümkün olduğunda **fiilsiz
isimli bir alt-kaynak** olarak, mümkün olmadığında ise açık bir aksiyon segmenti olarak
modelleyin:

```
PATCH /workspaces/:workspaceId/boards/:boardId/tasks/:taskId/position
POST  /workspaces/:workspaceId/invitations/:invitationId/accept
POST  /workspaces/:workspaceId/boards/:boardId/tasks/:taskId/assignees
```

Aksiyon segmentleri istisnadır ve her birinin bir sebebi olmalıdır.
`/tasks/:id/doUpdate` gibi bir şey icat etmeyin.

## HTTP verb'leri ve status kodları

| Verb | Semantik | Idempotent | Body | Başarı |
|---|---|---|---|---|
| `GET` | Bir kaynağı veya koleksiyonu oku | Evet | Hayır | `200` |
| `POST` | Oluştur, ya da idempotent olmayan bir aksiyonu tetikle | Hayır | Evet | `201` (oluşturma), `200` (aksiyon) |
| `PATCH` | Kısmi güncelleme — yalnızca gönderilen alanlar değişir | Hayır | Evet | `200` |
| `PUT` | Tam değiştirme | Evet | Evet | `200` |
| `DELETE` | Kaldır | Evet | Hayır | `204` |

**Güncellemeler için varsayılan `PATCH`'tir.** `PUT`, yalnızca tam bir değiştirmenin
gerçekten operasyon olduğu yerde kullanılır (örneğin bir column'un tamamını yeniden
sıralamak). Bir alanı atlayan bir `PATCH` onu dokunulmamış bırakır; açıkça `null` göndermek
nullable bir alanı temizler.

| Status | Ne zaman |
|---|---|
| `200 OK` | Başarılı okuma, güncelleme veya aksiyon |
| `201 Created` | Kaynak oluşturuldu; body oluşturulan kaynaktır |
| `204 No Content` | Başarılı silme; boş body |
| `400 Bad Request` | Bozuk request veya validation hatası |
| `401 Unauthorized` | Eksik veya geçersiz session |
| `403 Forbidden` | Kimlikli, workspace üyesi, ama rol yetersiz |
| `404 Not Found` | Kaynak yok **veya** başka bir workspace'e ait |
| `409 Conflict` | Benzersizlik ihlali (yinelenen slug), veya çakışan bir eşzamanlı değişiklik |
| `422 Unprocessable Entity` | İyi biçimlendirilmiş ama semantik olarak geçersiz (örn. bir task'ı başka bir board'daki bir column'a taşımak) |
| `429 Too Many Requests` | Rate limit uygulandı |
| `500 Internal Server Error` | Ele alınmamış hata. Asla bir stack trace sızdırmaz. |

**Cross-workspace erişim `403` değil `404` döner.** Bir `403`, kaynağın var olduğunu
doğrulardı, ki bu tenant sınırının ötesine bilgi sızdırır. `403`, rolü çok düşük meşru bir
üye için ayrılmıştır.

## Request ve response body'leri

Kaynaklar **düz JSON objeleri** olarak döndürülür. Bir `data` sarmalayıcısı, bir `success`
flag'i, bir zarf (envelope) yoktur.

```jsonc
// GET /workspaces/w_1/boards/b_1/tasks/t_1  → 200
{
  "id": "clx8f2k9a0001qw3h4t2v9m1p",
  "boardId": "clx8f2k9a0000qw3h1a2b3c4d",
  "columnId": "clx8f2k9a0002qw3h7y8z9w0v",
  "title": "Implement fractional indexing",
  "description": "Positions must survive concurrent moves.",
  "priority": "HIGH",
  "position": 1024.5,
  "dueDate": "2026-09-01T00:00:00.000Z",
  "estimatedMinutes": 240,
  "assignees": [{ "id": "usr_1", "name": "Doğan", "avatarUrl": null }],
  "labels": [{ "id": "lbl_1", "name": "backend", "color": "#00C896" }],
  "createdById": "usr_1",
  "createdAt": "2026-08-08T09:12:31.114Z",
  "updatedAt": "2026-08-08T09:12:31.114Z"
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
    { "field": "estimatedMinutes", "constraint": "min", "message": "estimatedMinutes must not be less than 0" }
  ],
  "path": "/workspaces/w_1/boards/b_1/tasks",
  "timestamp": "2026-08-08T09:12:31.114Z"
}
```

| Alan | Tip | Zorunlu | Anlam |
|---|---|---|---|
| `statusCode` | number | evet | HTTP status'ünü yansıtır |
| `error` | string | evet | Kararlı, makine tarafından okunabilir sebep ifadesi (`Bad Request`, `Not Found`) |
| `message` | string | evet | İnsan tarafından okunabilir, tek cümle, loglanması güvenli |
| `details` | array | hayır | Alan bazlı validation problemleri; yalnızca `400`/`422`'de mevcut |
| `path` | string | evet | Request path'i |
| `timestamp` | string | evet | ISO 8601 UTC |

- Tek bir global exception filter, ele alınmamışlar dahil **her** hata için bu şekli
  üretir. API'nin hiçbir yerinde ikinci bir hata formatı yoktur.
- `message`, production'da asla ham bir exception string'i değildir, stack trace'ler
  döndürülmez, loglanır.
- Client'lar `message` metnine değil, `statusCode` ve `error`'a göre dallanır.

## Pagination

**Cursor pagination varsayılandır.** Sayfa numarası pagination'ı yalnızca toplam sayının
doğal olarak küçük ve kararlı olduğu, küçük ve sınırlı koleksiyonlar için kabul edilebilir
(bir workspace'in üyeleri, bir board'un column'ları).

Neden varsayılan olarak cursor:

- Task listeleri en sık kullanılan yoldur ve **sürekli yeniden sıralanır** — bir kullanıcı
  kaydırırken drag-and-drop `position`'ı değiştirir. Kayan bir liste üzerinde offset
  pagination satırları düşürür ve çoğaltır; bir satıra bağlanmış bir cursor bunu yapmaz.
- `OFFSET`, büyük tablolarda doğrusal olarak bozulur; keyset lookup'lar sabit kalır.
- Realtime katmanı, session ortasında client'ın altına satır ekler, ki bu tam olarak offset
  pagination'ın en kötü ele aldığı durumdur.

### Cursor request ve response

```
GET /workspaces/w_1/boards/b_1/tasks?limit=50&cursor=clx8f2k9a0001qw3h4t2v9m1p
```

| Param | Varsayılan | Maks | Notlar |
|---|---|---|---|
| `limit` | 50 | 100 | Maksimumun üzerindeki değerler reddedilmez, kırpılır (clamp) |
| `cursor` | — | — | Opak. Önceki sayfanın son item'ının `id`'si. Client'lar onu parse etmemelidir. |

```jsonc
{
  "items": [ /* … kaynaklar … */ ],
  "nextCursor": "clx8f2k9a0051qw3h9k1m2n3o",  // son sayfada null
  "hasMore": true
}
```

### Sayfa bazlı (yalnızca küçük koleksiyonlar)

```
GET /workspaces/w_1/members?page=1&perPage=25
```

```jsonc
{
  "items": [ /* … */ ],
  "page": 1,
  "perPage": 25,
  "total": 7,
  "totalPages": 1
}
```

Her iki şekil de `@kurultay/shared-types`'ta (`CursorPage<T>`, `OffsetPage<T>`) tiplenmiştir,
böylece client'lar bunları genel olarak ele alabilir.

## Filtreleme, sıralama, alan seçimi

| Kaygı | Konvansiyon | Örnek |
|---|---|---|
| Eşitlik filtresi | `?field=value` | `?priority=HIGH` |
| Çoklu değer (OR) | Tekrarlanan veya virgülle ayrılmış | `?priority=HIGH,URGENT` |
| İlişki filtresi | `?relationId=value` | `?assigneeId=usr_1&labelId=lbl_2` |
| Aralık | `?field[gte]=`, `?field[lte]=` | `?dueDate[lte]=2026-09-01T00:00:00Z` |
| Null kontrolü | `?field=null` | `?dueDate=null` |
| Serbest metin arama | `?q=` | `?q=indexing` |
| Sıralama | `?sort=field` / azalan için `?sort=-field` | `?sort=-createdAt` |
| Çoklu sıralama | Virgülle ayrılmış, önceliği soldan sağa | `?sort=priority,-dueDate` |

- Birleşik filtreler **AND**'dir; bir filtre içindeki tekrarlanan değerler **OR**'dur.
- Yalnızca query DTO'sunda deklare edilen whitelist'lenmiş alanlar filtrelenebilir ve
  sıralanabilir. Bilinmeyen bir filtre sessizce yok sayılmaz, her zaman `400`'dür — sessizce
  düşürülen bir filtre kullanıcıya görmemesi gereken veriyi gösterir.
- Task'lar için varsayılan sıralama artan `position`'dır; geri kalan her şey için
  `-createdAt`.
- `?fields=` sparse-fieldset desteği yok. Response şekilleri DTO'ları tarafından
  sabitlenmiştir; bir client daha azına ihtiyaç duyuyorsa, bu caching ve tipleme
  karmaşıklığına değmez.

## DTO adlandırma

| Amaç | Desen | Örnek |
|---|---|---|
| Oluşturma request'i | `Create<Entity>Dto` | `CreateTaskDto` |
| Tam/kısmi güncelleme | `Update<Entity>Dto` | `UpdateTaskDto` |
| Aksiyon request'i | `<Verb><Entity>Dto` | `MoveTaskDto`, `InviteMemberDto` |
| Liste query param'ları | `<Entity>QueryDto` | `TaskQueryDto` |
| Tekil kaynak response'u | `<Entity>ResponseDto` | `TaskResponseDto` |
| Liste response'u | `<Entity>ListResponseDto` | `TaskListResponseDto` |

- Dosya başına bir DTO, modülün `dto/` klasöründe, kebab-case adlandırılmış:
  `create-task.dto.ts`.
- `UpdateXDto`, alanları yeniden yazmak yerine `PartialType` üzerinden `CreateXDto`'dan
  türetilir.
- Request DTO'ları `class-validator` decorator'ları taşır; response DTO'ları
  `@kurultay/shared-types`'ta yansıtılan düz şekillerdir.

Tam DTO/validation kuralları: [coding-standards.md](coding-standards.md#dtolar-ve-validation).

## Veri tipleri

| Tip | Gösterim | Örnek |
|---|---|---|
| Identifier | Opak string (cuid, ara sıra uuid). Client'lar onları asla parse etmez, sıralamaz, üretmez. | `"clx8f2k9a0001qw3h4t2v9m1p"` |
| Tarih/saat | **ISO 8601, her zaman UTC, her zaman `Z` ile** | `"2026-08-08T09:12:31.114Z"` |
| Yalnızca tarih değeri | Yine de `T00:00:00.000Z`'de tam bir ISO 8601 timestamp'i | `"2026-09-01T00:00:00.000Z"` |
| Süre | Tam sayı dakika (`estimatedMinutes`) — asla formatlanmış bir string değil | `240` |
| Position | `Float` (fractional indexing) — asla tam sayı veya bitişiklik varsaymayın | `1024.5` |
| Enum | Shared types'ta tanımlanmış UPPER_SNAKE string | `"HIGH"`, `"OWNER"` |
| Para | Henüz kullanılmıyor. Kullanıldığında: tam sayı minor unit + para birimi kodu. | — |

API asla lokal saat veya bir timezone offset'i döndürmez. Kullanıcının locale'ine göre
formatlamak frontend'in işidir.

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
