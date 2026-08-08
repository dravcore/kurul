# Proje İskeleti

Kurultay monorepo iskeletini kurmak için adım adım bir referans: workspace, uygulamalar,
şema, container'lar ve işin bittiğini söyleyen kontroller.

> 🌐 [English (canonical)](../project-skeleton.md) | Türkçe — Bu çeviri güncel olmayabilir; kanonik kaynak İngilizce'dir.

**Paket adı:** `kurultay` · **Organizasyon:** dravcore · **Lisans:** AGPL-3.0 · **Mimari:** monorepo + modüler monolit

## İçindekiler

- [0. Ön kontroller](#0-ön-kontroller)
- [1. Monorepo kurulumu](#1-monorepo-kurulumu)
- [2. packages/shared-types](#2-packagesshared-types)
- [3. apps/api — NestJS 11](#3-appsapi--nestjs-11)
- [4. apps/web — Next.js 16](#4-appsweb--nextjs-16)
- [5. Docker Compose](#5-docker-compose)
- [6. .env.example](#6-envexample)
- [7. Repository dosyaları](#7-repository-dosyaları)
- [8. Doğrulama — iskelet ne zaman hazır sayılır](#8-doğrulama--iskelet-ne-zaman-hazır-sayılır)
- [9. Sıradaki ilk özellikler](#9-sıradaki-ilk-özellikler)

---

## 0. Ön kontroller

```bash
node -v                  # 22+ (24 LTS önerilir)
docker -v
docker compose version
pnpm -v
```

İsim kontrolleri: npm paket adı `kurultay` müsait. Kalanlar: `github.com/dravcore/kurultay`
ve bir domain (`kurultay.dev` / `kurultay.io`).

> **İsmin kökeni.** *Kurultay*, Türk-Moğol geleneğinde boyların toplandığı, tartıştığı,
> karar aldığı ve işi bölüştüğü büyük meclistir — aracın yaptığı şeyin adil bir tarifi.
> (`kurultay` Türkçe yazımı; `kurultai` Moğolca/İngilizce transliterasyonudur.) README bu
> hikâyeyi anlatmalı.

---

## 1. Monorepo kurulumu

pnpm workspace kullanılıyor (npm workspaces de çalışırdı; pnpm disk kullanımı ve kurulum
hızında kazanıyor).

```
kurultay/
├── apps/
│   ├── api/                 # NestJS backend
│   └── web/                 # Next.js frontend
├── packages/
│   └── shared-types/        # api ve web tarafından paylaşılan TS tipleri
├── pnpm-workspace.yaml
├── package.json
├── prisma.config.ts         # Prisma 7 tarafından gerektirilir — şema yolu, seed girişi, env yükleme
├── docker-compose.yml
├── docker-compose.dev.yml
├── .env.example
├── .gitignore
├── README.md
├── LICENSE
└── CONTRIBUTING.md
```

**pnpm-workspace.yaml**

```yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

Kök `package.json` script'leri:

| Script | Ne yapar |
|---|---|
| `dev` | `api` ve `web`'i paralel çalıştırır |
| `build` | Her workspace paketini build eder |
| `lint` | Her workspace paketini lint eder |
| `test` | Her workspace paketinde testleri çalıştırır |
| `db:migrate` | Prisma migration'larını çalıştırır |
| `db:seed` | Demo veriyi yükler (bir workspace, board, column'lar, birkaç task). Prisma 7 otomatik seeding'i kaldırdı — giriş noktası `prisma.config.ts` içinde deklare edilir ve açıkça çalıştırılır |
| `db:studio` | Prisma Studio'yu açar |

---

## 2. packages/shared-types

Frontend ve backend arasında paylaşılan TypeScript tipleri — Prisma'nın ürettiği
modellerden türetilen DTO'lar ve enum'lar, artı socket kontratı.

| İçerik | Detay |
|---|---|
| `Priority` enum | `LOW \| MEDIUM \| HIGH \| URGENT` |
| `MemberRole` enum | `OWNER \| ADMIN \| MEMBER \| GUEST` |
| DTO tipleri | Task, Board, Column, Label, Workspace |
| Socket event'leri | Event isim sabitleri ve payload tipleri — tek doğruluk kaynağı, böylece frontend ve backend birbirinden sapamaz |

---

## 3. apps/api — NestJS 11

Bootstrap hedefi: **NestJS 11** (pinlenen major; NestJS 12 ESM migration'ı Faz 0'da hâlâ draft'tı).

```
apps/api/
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── src/
│   ├── main.ts
│   ├── app.module.ts
│   ├── generated/prisma/  # Prisma 7 client çıktısı — git-ignored, üretilir
│   ├── common/            # guard, interceptor, filter, decorator
│   ├── prisma/            # PrismaService (global module, pg Pool'u sahiplenir)
│   ├── auth/              # Better Auth entegrasyonu
│   ├── workspace/         # workspace CRUD + üyelik/davet
│   ├── board/             # board + column yönetimi
│   ├── task/              # task CRUD, taşıma, sıralama
│   ├── label/
│   ├── comment/
│   ├── activity/          # aktivite log'u
│   ├── dashboard/         # agregasyon sorguları
│   ├── notification/
│   └── realtime/          # Socket.io gateway + Redis adapter
└── package.json
```

**Her modül aynı iskelete sahip:** `*.module.ts`, `*.controller.ts`, `*.service.ts`, `dto/`.

Modül sınırlarını en baştan temiz tut — bir modülü ileride kendi process'ine veya servisine
bölme seçeneği buna bağlı. Modül haritası ve aşamalı runtime planı için
[architecture.md](architecture.md)'ye bakın.

### Prisma şeması — ilk tablolar

```
User            id, email, name, avatarUrl, createdAt
Workspace       id, name, slug, createdAt
WorkspaceMember id, workspaceId, userId, role
Board           id, workspaceId, name, description, createdAt
Column          id, boardId, name, position, color
Task            id, boardId, columnId, title, description,
                priority, position, dueDate, estimatedMinutes,
                createdById, createdAt, updatedAt
TaskAssignee    id, taskId, userId          # çoklu atanan
Label           id, boardId, name, color   # color = design-token slot adı (slot-1..8), hex değil
TaskLabel       id, taskId, labelId
Comment         id, taskId, userId, body, createdAt
Activity        id, workspaceId, taskId?, userId, type, payload(Json), createdAt
```

`Notification` [roadmap Faz 8](roadmap.md#faz-8--aktivite-logu-ve-bildirimler)'e ertelenmiştir — ilk migration'da oluşturulmaz. Davetler Better Auth'a (organization plugin) aittir, burada Prisma modeli değildir; bkz. [ADR 0004](decisions/0004-auth-better-auth.md#alan-eşlemesi-organization--workspace).

**Kritik detaylar**

| Kural | Neden |
|---|---|
| Her `id` `@id @default(uuid(7))` | UUIDv7 (Prisma ≥ 5.18) — zaman-sıralı, dolayısıyla ekleme-yoğun task/comment/activity tablolarında primary key'ler index-local kalır *ve* kararlı bir pagination cursor'ı olarak kullanılabilir. Bkz. [api-conventions.md](api-conventions.md#pagination) |
| `Task.position` ve `Column.position` **Float**'tır, Int değil | Fractional indexing — `1` ile `2` arasına bırakılan bir kart veya column `1.5` olur, böylece listeyi yeniden numaralamak yerine yalnızca taşınan satır yazılır. Bkz. [`decisions/0006-fractional-indexing.md`](decisions/0006-fractional-indexing.md) |
| `dueDate` ve `estimatedMinutes` **ayrı alanlardır** | "Ne zamana kadar" ve "ne kadar sürer" farklı kavramlardır; ileride bir Gantt görünümü ikisine de ihtiyaç duyar |
| `priority` label'lardan **ayrı tutulur** | Temiz filtreleme ve dashboard agregasyonu |
| Multi-tenant izolasyonu | Her sorgu `workspaceId` ile scope'lanır, guard/interceptor seviyesinde zorlanır — asla her serviste yeniden uygulanmaz |
| `Activity.payload` **Json**'dır | Yeni aktivite tipleri şema migration'ı gerektirmez |
| `Activity.taskId` **nullable**, `Activity.workspaceId` **zorunlu** | Faz 8, workspace-seviyesi bir feed vaat ediyor. "Board yeniden adlandırıldı", "üye katıldı", "column silindi" bir task'a bağlı olmayan workspace olayları — bu şeklin ilk migration'dan itibaren bunlara izin vermesi gerekir, yoksa Faz 8 bir migration ve bir backfill ister |

**İlk migration'da olması gereken kısıtlar**

Bunları sonradan eklemek önce yinelenen satırları temizlemek anlamına gelir, dolayısıyla
şemayla birlikte gelirler:

| Kısıt | Neyi önler |
|---|---|
| `WorkspaceMember @@unique([workspaceId, userId])` | Aynı kullanıcının bir workspace'e iki farklı rolle iki kez katılması — "hangi rol kazanır?" sorusunu tanımsız bırakır |
| `TaskAssignee @@unique([taskId, userId])` | Aynı atananın iki kez eklenmesi; liste response'larında, bildirim fan-out'unda ve activity payload'larında ikilenir |
| `TaskLabel @@unique([taskId, labelId])` | Aynı label'ın iki kez eklenmesi |
| `Column @@unique([boardId, id])` | Tek başına hiçbir şeyi önlemez — `Task`'ın bir composite foreign key `(boardId, columnId) → Column(boardId, id)` deklare edebilmesi için var |

Sonuncusunun asıl noktası bu composite FK: `Task`, sorgu kolaylığı için hem `boardId` hem de
`columnId` taşır, ve bu olmadan veri katmanında hiçbir şey ikisinin senkron dışı kalmasını
engellemez — ham bir sorgu, bir toplu import, veya gelecekteki bir migration script'i bir
task'ı başka bir board'daki bir column'a taşıyabilir ve hiçbir kısıt bunu yakalamaz.
`422 Unprocessable Entity`
([api-conventions.md](api-conventions.md#http-verbleri-ve-status-kodları)) böylece
veritabanının da zorladığı bir kuralın uygulama-seviyesi ifadesi haline gelir, tek savunma
hattı olmak yerine.

**Cascade davranışı açıktır, varsayılana bırakılmamıştır.** Prisma'nın zorunlu bir ilişki
için varsayılan referans aksiyonu `Restrict`'tir, yani burayı belirtmeden bırakmak
şaşırtıcı sonuca çözülür: bir board'u silmek cascade etmek yerine *başarısız olur*.
Sahiplenilen çocuklar cascade eder:

```
Workspace → Board → Column, Task → Comment, Activity, TaskAssignee, TaskLabel
```

Bu ilişkilerin her biri `onDelete: Cascade` olarak deklare edilir. *Paylaşılan* satırlara
referanslar cascade etmez: `Task.createdById`, `Comment.userId`, `Activity.userId` ve
`TaskAssignee.userId`, `User`'a işaret eder ve `Restrict` kalır — bir kullanıcıyı silmek,
yorumlarını sessizce silen bir yan etki değil, kasıtlı bir operasyon olmalıdır.

### Prisma 7 — sürümün maliyeti

Prisma 7, Rust query engine'i kaldırdı, bu da seçilme sebebi
([`decisions/0002-backend-stack.md`](decisions/0002-backend-stack.md)). Ücretsiz bir upgrade
değil, ve aşağıdakilerin her biri sonradan keşfedilen bir detay olmak yerine iskeleti
şekillendiriyor:

| Gereklilik | İskelet üzerindeki etki |
|---|---|
| Bir driver adapter zorunlu | `@prisma/adapter-pg`, `apps/api`'nin bir bağımlılığı, ve `PrismaService`, `OnModuleInit`/`OnModuleDestroy` içinde bir `pg` Pool'un yaşam döngüsünü sahipleniyor — yalnızca bir connection string değil |
| Kök dizinde `prisma.config.ts` | `schema.prisma` içindeki env-var yapılandırmasının yerini alır ve seed giriş noktasını deklare eder (yukarıdaki `db:seed`) |
| Generator `output`'u zorunlu | Client artık `node_modules`'a üretilmiyor. `apps/api/src/generated/prisma`'ya gidiyor, ve bunun hem `apps/api`'den hem de `packages/shared-types`'tan çözümlenebilmesi gerekiyor — sonuncusu DTO tiplerini üretilen modellerden türetiyor ([architecture.md](architecture.md#5-packagesshared-types)) |
| Client middleware (`$use`) kaldırıldı | Herhangi bir sorgu-seviyesi cross-cutting kaygı — `workspaceId` scoping helper'ı, `position` üzerinde bir compare-and-swap guard'ı — artık bir **Client Extension**. Baştan extension'lar için tasarlayın; geri düşülecek bir middleware yok |
| Env değişkenleri otomatik yüklenmiyor | `dotenv` açıkça çağrılıyor. Aşağıdaki `.env.example` aynı değişkenleri tarif etmeye devam ediyor; yalnızca yükleme elle yapılıyor |

Bundan doğan asgari sürümler: Node ≥ 20.19.0 (projenin taban çizgisi daha yüksek — bkz.
[development.md](development.md#ön-koşullar)) ve TypeScript 5.4.

---

## 4. apps/web — Next.js 16

Bootstrap hedefi: **Next.js 16** (App Router).

```
apps/web/
├── app/
│   ├── (auth)/
│   │   ├── login/
│   │   └── register/
│   ├── (app)/
│   │   ├── layout.tsx           # sidebar + workspace switcher
│   │   ├── dashboard/
│   │   └── board/[boardId]/
│   └── layout.tsx
├── components/
│   ├── ui/                      # shadcn/ui
│   ├── board/                   # KanbanBoard, Column, TaskCard
│   ├── task/                    # TaskDetailPanel
│   └── dashboard/                # grafik component'leri
├── lib/
│   ├── api.ts                   # backend client
│   ├── socket.ts                # Socket.io client
│   └── auth.ts                  # Better Auth client
└── package.json
```

Kurulum: Next.js (App Router) + Tailwind + `shadcn/ui` init + `@dnd-kit/core` +
`@dnd-kit/sortable` + `recharts` + `socket.io-client` + `next-intl` (i18n katmanı ilk
component'ten itibaren bağlanır — bkz. [design.md](design.md)).

---

## 5. Docker Compose

`docker-compose.yml` — tam stack:

| Servis | Detay |
|---|---|
| `postgres` | `postgres:18-alpine`, named volume, healthcheck |
| `redis` | `redis:8-alpine`, named volume |
| `api` | `apps/api` Dockerfile'ından build edilir; `condition: service_healthy` ile postgres + redis'e `depends_on` |
| `web` | `apps/web` Dockerfile'ından build edilir; api'ye `depends_on` |

Her iki tag de bilerek sabitlenmiştir. **Redis 8, 7 değil:** `redis:7` bandı yalnızca
RSALv2/SSPLv1 — source-available, OSI açık kaynak değil. Redis 8, OSI onaylı bir lisansı
geri getirdi, ve o lisans AGPLv3 — Kurultay'ın kendisinin altında dağıtıldığı lisansla aynı
([`decisions/0007-license-agpl.md`](decisions/0007-license-agpl.md)), böylece bir
self-hoster'ın çalıştırdığı compose dosyası uçtan uca lisans-uyumlu oluyor. **Postgres 18**
mevcut major sürüm; sonradan major atlamak her self-hoster'a bir dump ve restore işi
maliyetlendiriyor ([development.md](development.md#yükseltme-ve-yedekleme)), dolayısıyla
hiçbir veri yokken şimdi yapılıyor.

`docker-compose.dev.yml` — yalnızca geliştirme için: **sadece postgres ve redis'i** ayağa
kaldırır, `api` ve `web` ise host'ta hot reload ile çalışır. Bu, geliştirme döngüsünü
belirgin şekilde kısaltır.

---

## 6. .env.example

```
DATABASE_URL=postgresql://kurultay:kurultay@localhost:5432/kurultay
REDIS_URL=redis://localhost:6380
BETTER_AUTH_SECRET=
BETTER_AUTH_URL=http://localhost:3000
API_PORT=4000
WEB_URL=http://localhost:3000
```

Gerçek `.env` `.gitignore`'da olmalıdır.

---

## 7. Repository dosyaları

| Dosya | İçerik |
|---|---|
| `README.md` | Ne yaptığı, ekran görüntüsü (sonra), hızlı başlangıç (`docker compose up`), stack listesi, katkı linki |
| `LICENSE` | AGPL-3.0 — network-use maddesi, değiştirilmiş bir Kurultay'ı bir servis olarak çalıştıran herkesin değişikliklerini yayınlamasını gerektiriyor, bu da hosting'i yasaklamadan kapalı kaynak bir SaaS fork'unun teşvikini ortadan kaldırıyor. Bir open-core yolunu açık bırakır. AGPL'i sonradan gevşetmek her katkıda bulunanın onayını gerektirir, bu yüzden en başta doğru olmalı. Bkz. [`decisions/0007-license-agpl.md`](decisions/0007-license-agpl.md) |
| `CONTRIBUTING.md` | Ortam kurulumu, commit convention'ı, PR süreci |
| `CODE_OF_CONDUCT.md` | Contributor Covenant |
| `.github/workflows/ci.yml` | lint + typecheck + test + build, push ve PR'da |

---

## 8. Doğrulama — iskelet ne zaman hazır sayılır

```bash
docker compose up            # her servis ayağa kalkar
pnpm db:migrate              # migration başarılı olur
curl localhost:4000/health   # 200 döner
# localhost:3000 açılır ve login sayfasını render eder
pnpm lint && pnpm test && pnpm build   # hata yok
```

Bunlar geçtiğinde iskelet hazırdır. Henüz hiçbir özellik yoktur, ama bu noktadan sonra her
özellik "boş bir kutuyu doldurmak"tır.

---

## 9. Sıradaki ilk özellikler

1. Auth akışı (register / login / session) + workspace oluşturma
2. Board ve column yönetimi (CRUD + column sıralama)
3. Task CRUD + drag & drop (fractional indexing ile)
4. Task metadata'sı: çoklu atanan, label'lar, priority, due date, süre tahmini
5. Filtreleme ve arama
6. Dashboard + grafikler (agregasyon endpoint'leri + Recharts)
7. Aktivite log'u + bildirimler
8. Realtime senkronizasyon (Socket.io)

Realtime bilerek en sona bırakıldı: veri akışının önce oturması gerekiyor. Erken eklemek,
her özellik değişikliğiyle birlikte socket event'lerini de güncellemek anlamına gelir.

İlgili: [architecture.md](architecture.md) · [tech-stack.md](tech-stack.md)
