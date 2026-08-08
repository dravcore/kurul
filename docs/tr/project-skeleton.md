# Proje İskeleti

Kurultay monorepo iskeletini kurmak için adım adım bir referans: workspace, uygulamalar,
şema, container'lar ve işin bittiğini söyleyen kontroller.

> 🌐 [English (canonical)](../project-skeleton.md) | Türkçe — Bu çeviri güncel olmayabilir; kanonik kaynak İngilizce'dir.

**Paket adı:** `kurultay` · **Organizasyon:** dravcore · **Lisans:** AGPL-3.0 · **Mimari:** monorepo + modüler monolit

## İçindekiler

- [0. Ön kontroller](#0-ön-kontroller)
- [1. Monorepo kurulumu](#1-monorepo-kurulumu)
- [2. packages/shared-types](#2-packagesshared-types)
- [3. apps/api — NestJS](#3-appsapi--nestjs)
- [4. apps/web — Next.js](#4-appsweb--nextjs)
- [5. Docker Compose](#5-docker-compose)
- [6. .env.example](#6-envexample)
- [7. Repository dosyaları](#7-repository-dosyaları)
- [8. Doğrulama — iskelet ne zaman hazır sayılır](#8-doğrulama--iskelet-ne-zaman-hazır-sayılır)
- [9. Sıradaki ilk özellikler](#9-sıradaki-ilk-özellikler)

---

## 0. Ön kontroller

```bash
node -v                  # 20+
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
| `db:migrate` | Prisma migration'larını çalıştırır |
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

## 3. apps/api — NestJS

```
apps/api/
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── src/
│   ├── main.ts
│   ├── app.module.ts
│   ├── common/            # guard, interceptor, filter, decorator
│   ├── prisma/            # PrismaService (global module)
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
Label           id, boardId, name, color
TaskLabel       id, taskId, labelId
Comment         id, taskId, userId, body, createdAt
Activity        id, taskId, userId, type, payload(Json), createdAt
```

**Kritik detaylar**

| Kural | Neden |
|---|---|
| `position` **Float**'tır, Int değil | Fractional indexing — `1` ile `2` arasına bırakılan bir kart `1.5` olur, böylece listeyi yeniden numaralamak yerine yalnızca taşınan satır yazılır. Bkz. [`decisions/0006-fractional-indexing.md`](decisions/0006-fractional-indexing.md) |
| `dueDate` ve `estimatedMinutes` **ayrı alanlardır** | "Ne zamana kadar" ve "ne kadar sürer" farklı kavramlardır; ileride bir Gantt görünümü ikisine de ihtiyaç duyar |
| `priority` label'lardan **ayrı tutulur** | Temiz filtreleme ve dashboard agregasyonu |
| Multi-tenant izolasyonu | Her sorgu `workspaceId` ile scope'lanır, guard/interceptor seviyesinde zorlanır — asla her serviste yeniden uygulanmaz |
| `Activity.payload` **Json**'dır | Yeni aktivite tipleri şema migration'ı gerektirmez |

---

## 4. apps/web — Next.js

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
`@dnd-kit/sortable` + `recharts` + `socket.io-client`.

---

## 5. Docker Compose

`docker-compose.yml` — tam stack:

| Servis | Detay |
|---|---|
| `postgres` | `postgres:17-alpine`, named volume, healthcheck |
| `redis` | `redis:7-alpine`, named volume |
| `api` | `apps/api` Dockerfile'ından build edilir; `condition: service_healthy` ile postgres + redis'e `depends_on` |
| `web` | `apps/web` Dockerfile'ından build edilir; api'ye `depends_on` |

`docker-compose.dev.yml` — yalnızca geliştirme için: **sadece postgres ve redis'i** ayağa
kaldırır, `api` ve `web` ise host'ta hot reload ile çalışır. Bu, geliştirme döngüsünü
belirgin şekilde kısaltır.

---

## 6. .env.example

```
DATABASE_URL=postgresql://kurultay:kurultay@localhost:5432/kurultay
REDIS_URL=redis://localhost:6379
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
| `LICENSE` | AGPL-3.0 — kodun kapalı kaynak bir SaaS olarak yeniden satılmasını engeller ve bir open-core yolunu açık bırakır. AGPL'i sonradan gevşetmek her katkıda bulunanın onayını gerektirir, bu yüzden en başta doğru olmalı. Bkz. [`decisions/0007-license-agpl.md`](decisions/0007-license-agpl.md) |
| `CONTRIBUTING.md` | Ortam kurulumu, commit convention'ı, PR süreci |
| `CODE_OF_CONDUCT.md` | Contributor Covenant |
| `.github/workflows/ci.yml` | lint + typecheck + build, push ve PR'da |

---

## 8. Doğrulama — iskelet ne zaman hazır sayılır

```bash
docker compose up            # her servis ayağa kalkar
pnpm db:migrate              # migration başarılı olur
curl localhost:4000/health   # 200 döner
# localhost:3000 açılır ve login sayfasını render eder
pnpm lint && pnpm build      # hata yok
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
