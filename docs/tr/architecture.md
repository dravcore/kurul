# Mimari

Kurultay sisteminin şekli: kod nasıl saklanıyor, nasıl çalışıyor ve veri nasıl modelleniyor.

> 🌐 [English (canonical)](../architecture.md) | Türkçe — Bu çeviri güncel olmayabilir; kanonik kaynak İngilizce'dir.

## İçindekiler

- [1. Karar özeti](#1-karar-özeti)
- [2. Monorepo yerleşimi](#2-monorepo-yerleşimi)
- [3. apps/api — modül haritası](#3-appsapi--modül-haritası)
- [4. apps/web — yapı](#4-appsweb--yapı)
- [5. packages/shared-types](#5-packagesshared-types)
- [6. Veri modeli](#6-veri-modeli)
- [7. Multi-tenant izolasyonu](#7-multi-tenant-izolasyonu)
- [8. Runtime evrimi](#8-runtime-evrimi)
- [9. Karar kayıtları](#9-karar-kayıtları)

---

## 1. Karar özeti

Kurultay bir **modüler monolit** içeren bir **monorepo**'dur.

Bu iki bağımsız eksendir ve ikisini ayrı tutmak önemlidir:

| Eksen                   | Hangi soruyu yanıtlar | Kurultay'ın cevabı                            |
| ----------------------- | --------------------- | --------------------------------------------- |
| Monorepo vs. polyrepo   | Kod nasıl _saklanır_? | Monorepo (tek pnpm workspace)                 |
| Monolit vs. mikroservis | Kod nasıl _çalışır_?  | Modüler monolit (tek deploy edilebilir birim) |

**Neden monorepo**

- Frontend ve backend'in ikisi de TypeScript, bu yüzden `packages/shared-types` task/board
  tiplerinin tek tanımını tutabiliyor. Veri modeli değişikliği tek bir yerde olur.
- Tek geliştirici / küçük ekip: iki repo, her cross-cutting değişiklik için iki PR ve manuel
  versiyon uyumu demek.
- Katkı bariyeri: bir katkıda bulunan tek bir repo klonlar ve `docker compose up` çalıştırır.
- Bu alandaki çoğu referans proje (Plane, Huly) monorepo.

**Neden modüler monolit, mikroservis değil**

- Mikroservisler bağımsız ölçeklenmeyi dağıtık sistem karmaşıklığı pahasına satın alır:
  servisler arası çağrılar, dağıtık transaction'lar, ayrı deploy pipeline'ları, dağıtık
  observability. MVP ölçeğinde bağımsız ölçeklenmesi gereken henüz hiçbir şey yok.
- Kanban doğası gereği yüksek derecede bağlı (coupled). Bir task'ı taşımak task satırına,
  aktivite log'una, bildirimlere ve dashboard agregatlarına dokunur — bugün tek bir lokal
  transaction, bölünürse dağıtık bir transaction.
- Veri modeli henüz oturmadı. Servis sınırlarını erken çizmek pahalı türden bir hatadır:
  yanlış bir bölünmeyi düzeltmek, monoliti daha sonra bölmekten çok daha maliyetlidir.

**Referans projeler ne yapıyor**

| Proje  | Yaklaşım                                                                                                                                                                            |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plane  | Çekirdekte monolit, artı iki destek servisi (Gateway = DB proxy, Pilot = entegrasyon yüzeyi)                                                                                        |
| Linear | Tek kod tabanı, farklı rollerde birkaç workload olarak deploy edilir: WebSocket sunucuları, public/private GraphQL API, arka plan iş çalıştırıcıları — her biri bağımsız ölçeklenir |
| Huly   | Kendi Rush-tabanlı build sistemini kurmak pahasına, çok servisli monorepo                                                                                                           |

Kurultay'ın izlediği model Linear'ınki: **tek kod tabanı, gerektiğinde birkaç process rolü.**
WebSocket sunucusunu kendi container'ında çalıştırmak kodu değil, deployment'ı bölmek
demektir.

Tam gerekçe: [`decisions/0001-monorepo-modular-monolith.md`](decisions/0001-monorepo-modular-monolith.md).

---

## 2. Monorepo yerleşimi

```
kurultay/
├── apps/
│   ├── api/               # NestJS backend (modüler monolit)
│   └── web/               # Next.js App Router frontend
├── packages/
│   ├── shared-types/      # api ve web tarafından paylaşılan TS tipleri / DTO'lar
│   └── auth-access/       # Better Auth organization AC rolleri (api + web)
├── pnpm-workspace.yaml
├── docker-compose.yml
├── docker-compose.dev.yml
└── .env.example
```

Bu ağacın adım adım kurulabilir versiyonu [project-skeleton.md](project-skeleton.md)'de;
arkasındaki teknoloji seçimleri ise [tech-stack.md](tech-stack.md)'de.

---

## 3. apps/api — modül haritası

Her modül aynı iskelete sahip: `*.module.ts`, `*.controller.ts`, `*.service.ts`, `dto/`.
Modül sınırları en baştan temiz tutulur — process rollerini daha sonra bölme imkânı tamamen
buna bağlıdır.

**Mevcut vs planlanan:** Faz 2 sonrası yalnızca `auth`, `workspace`, `health`, `common` ve
`prisma` gerçek handler'lara sahip. `board`, `task`, `label`, `comment`, `activity`,
`dashboard`, `notification` ve `realtime` route iskeletleridir; path'ler
`/workspaces/:workspaceId/...` altında yuvalanmıştır ve roadmap fazlarını bekler. Aşağıdaki
tabloyu hedef harita olarak okuyun — her modülün uygulandığı iddiası değildir.

| Modül          | Sorumluluk                                                                |
| -------------- | ------------------------------------------------------------------------- |
| `auth`         | Better Auth entegrasyonu, session yönetimi, request user çözümlemesi      |
| `workspace`    | Workspace CRUD, üyelik, davetler, rol'ler                                 |
| `board`        | Board ve column yönetimi, column sıralaması                               |
| `task`         | Task CRUD, column'lar arası taşıma, fractional-index ile yeniden sıralama |
| `label`        | Board-scoped label'lar ve task-label ataması                              |
| `comment`      | Task yorumları                                                            |
| `activity`     | Yalnızca-ekleme (append-only) aktivite log'u (`payload` Json)             |
| `dashboard`    | Grafikleri besleyen agregasyon sorguları                                  |
| `notification` | Bildirim dağıtımı, Redis destekli kuyruk                                  |
| `realtime`     | Socket.io gateway + `@socket.io/redis-adapter`                            |

Cross-cutting altyapı:

| Modül    | Sorumluluk                                                                                                                      |
| -------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `common` | Guard'lar, exception filter'lar, decorator'lar, paylaşılan Nest bootstrap — workspace scoping; interceptor'lar Faz 3+ ile gelir |
| `prisma` | Paylaşılan `pg` pool + Nest `PrismaService`; Better Auth aynı pool'u kullanır                                                   |

Bağımlılık yönü: özellik modülleri `common` ve `prisma`'ya bağımlıdır, asla tersi değil.
`realtime`, domain event'lerinin tüketicisidir, domain logic'in yaşadığı bir yer değil —
böylece iş kurallarını beraberinde sürüklemeden kendi process rolüne çıkarılabilir.

---

## 4. apps/web — yapı

```
apps/web/
├── app/
│   ├── (auth)/            # login, register — kimliksiz kabuk
│   ├── (app)/             # kimlikli kabuk: sidebar + workspace switcher
│   │   ├── dashboard/
│   │   └── board/[boardId]/
│   └── layout.tsx
├── components/
│   ├── layout/            # AppShell, WorkspaceProvider, AppSidebar
│   ├── auth/              # paylaşılan auth form primitive'leri
│   ├── ui/                # shadcn/ui primitive'leri (Faz 3+)
│   ├── board/             # KanbanBoard, Column, TaskCard (Faz 3+)
│   ├── task/              # TaskDetailPanel (Faz 5+)
│   └── dashboard/         # grafik component'leri (Faz 7+)
└── lib/
    ├── api.ts             # typed REST client
    ├── socket.ts          # Socket.io client stub (Faz 9)
    ├── permissions.ts     # `@kurultay/auth-access` re-export
    └── auth.ts            # Better Auth client
```

İki route group layout ağacını böler: `(auth)` sade bir kabuk render eder, `(app)` workspace
chrome'unu render eder ve bir session olduğunu varsayar. Next.js middleware, `(app)`
route'larından önce Better Auth session cookie'sini `/auth/get-session` ile doğrular; client
shell session varken workspace bootstrap'ını yapar. Board etkileşimi client-side'dır
(`@dnd-kit`), doğruluk kaynağı olarak sunucu ile birlikte — optimistic bir taşıma hem API
yanıtına hem de gelen socket event'lerine karşı uzlaştırılır.

---

## 5. packages/shared-types

Telden geçen her şey için tek doğruluk kaynağı. Backend ve frontend aynı deklarasyonları
import eder, böylece aralarındaki bir sapma runtime sürprizi yerine bir type hatasına
dönüşür.

| İçerik          | Örnekler                                                                           |
| --------------- | ---------------------------------------------------------------------------------- |
| Enum'lar        | `Priority`, `MemberRole`, `InvitationStatus`, `LabelColorSlot` (`slot-1`…`slot-8`) |
| DTO tipleri     | Workspace, Board, Column, Task, Label, Invitation request/response şekilleri       |
| Sayfalama       | `CursorPage<T>` (varsayılan liste şekli; anahtar `id`)                             |
| Socket kontratı | Event isim sabitleri ve payload tipleri                                            |

Better Auth organization **rol / access-control** tanımları `@kurultay/auth-access` içindedir
(bu pakette değil); böylece api ve web tek AC tanımını paylaşır, types paketine Better Auth
çekilmez.

Enum'lar ve DTO'lar bugün Prisma şemasıyla **elle hizalanır**; mekanik Prisma→shared-types
codegen yolu hedef olarak kalır (ADR 0002). Paket runtime Prisma bağımlılığı taşımaz. Prisma 7
client hâlâ Nest ve Better Auth adapter için `apps/api/src/generated/prisma`'ya üretilir.

---

## 6. Veri modeli

| Model             | Anahtar alanlar                                                                                                                                     | Notlar                                                                                                                                                                                                                   |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `User`            | `id`, `email`, `name`, `avatarUrl`, `createdAt`                                                                                                     | Kimlik, Better Auth'a ait                                                                                                                                                                                                |
| `Workspace`       | `id`, `name`, `slug`, `createdAt`                                                                                                                   | Tenant kökü — her şey buna bağlanır                                                                                                                                                                                      |
| `WorkspaceMember` | `id`, `workspaceId`, `userId`, `role`                                                                                                               | Join tablosu; `role` yetkileri belirler                                                                                                                                                                                  |
| `Board`           | `id`, `workspaceId`, `name`, `description`, `createdAt`                                                                                             | Board'lar bir workspace'e ait                                                                                                                                                                                            |
| `Column`          | `id`, `boardId`, `name`, `position`, `color`                                                                                                        | `position` bir board içindeki column'ları sıralar                                                                                                                                                                        |
| `Task`            | `id`, `boardId`, `columnId`, `title`, `description`, `priority`, `position`, `dueDate`, `estimatedMinutes`, `createdById`, `createdAt`, `updatedAt` | Çekirdek entity — kurallar aşağıda                                                                                                                                                                                       |
| `TaskAssignee`    | `id`, `taskId`, `userId`                                                                                                                            | Join tablosu; task başına birden fazla atanan                                                                                                                                                                            |
| `Label`           | `id`, `boardId`, `name`, `color`                                                                                                                    | Board-scoped. `color`, bir design-token slot adı saklar (`slot-1`…`slot-8`), temaya göre resolve edilir — ham bir hex değil; bkz. [design.md](design.md)                                                                 |
| `TaskLabel`       | `id`, `taskId`, `labelId`                                                                                                                           | Join tablosu                                                                                                                                                                                                             |
| `Comment`         | `id`, `taskId`, `userId`, `body`, `createdAt`                                                                                                       |                                                                                                                                                                                                                          |
| `Activity`        | `id`, `workspaceId`, `taskId` (nullable), `userId`, `type`, `payload` (Json), `createdAt`                                                           | Yalnızca-ekleme log. `workspaceId` zorunlu ve `taskId` opsiyonel, böylece task'ı olmayan workspace seviyesi olaylar — "board yeniden adlandırıldı", "üye katıldı" — temsil edilebilir; Faz 8 feed'inin vaat ettiği de bu |

`Notification` Phase 1 şemasında **yok**. [Roadmap Faz 8](roadmap.md#faz-8--aktivite-logu-ve-bildirimler) ile activity feed ve uygulama içi bildirimler gelince eklenir. O zamana kadar `notification` Nest modül klasörü yalnızca stub'dır.

Davetler `WorkspaceInvitation` olarak saklanır; Better Auth organization plugin
tablolarından Kurultay adlarına map edilir. Ürün dili ve REST path'leri
**Workspace** kullanır — bkz. [ADR 0004](decisions/0004-auth-better-auth.md#alan-eşlemesi-organization--workspace).

Better Auth ayrıca auth altyapısı tablolarını `Session`, `Account` ve `Verification` yönetir; bunlar plugin tarafından yönetilir ve yukarıdaki domain model tablosundan bilerek hariç tutulur.

### Kritik alan kuralları

Bunlar pazarlığa açık değildir; ayrıca `CLAUDE.md` içinde de kayıtlıdır.

| Kural                                                              | Sebep                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Her `id` **UUIDv7**'dir (`@default(uuid(7))`)                      | Zaman-sıralı, dolayısıyla ekleme-yoğun tablolarda key'ler index-local kalır ve kararlı bir pagination cursor'ı olarak hizmet eder. Bkz. [api-conventions.md](api-conventions.md#veri-tipleri)                                                                               |
| `Task.position` ve `Column.position` **Float**'tır, asla Int değil | Fractional indexing. `1` ve `2` position'ları arasına eklemek `1.5` yazar — tüm listeyi yeniden numaralamak yerine tek satır güncellenir. Hem kartlar hem column'lar için geçerlidir. Bkz. [`decisions/0006-fractional-indexing.md`](decisions/0006-fractional-indexing.md) |
| `dueDate` ve `estimatedMinutes` **ayrı alanlardır**                | "Ne zamana kadar" ve "ne kadar sürer" farklı kavramlardır; ileride bir Gantt görünümü ikisine de ihtiyaç duyar                                                                                                                                                              |
| `priority` label'lardan **ayrı tutulur**                           | Filtreleme ve dashboard agregasyonunu temiz tutar — priority sıralı bir skaler, label'lar ise sırasız bir küme                                                                                                                                                              |
| `Activity.payload` **Json**'dır                                    | Şema migration'ı gerektirmeden yeni aktivite tipleri eklenebilir                                                                                                                                                                                                            |

### Kısıtlar ve referans aksiyonları

Join tabloları kullanım kolaylığı için bir surrogate `id` taşır, ama veritabanının
zorladığı şey doğal anahtardır:

| Kısıt                                             | Neyi önler                                                                                                                                                                                                                                     |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WorkspaceMember @@unique([workspaceId, userId])` | Bir kullanıcının aynı workspace'te iki rol taşıması                                                                                                                                                                                            |
| `TaskAssignee @@unique([taskId, userId])`         | Aynı atananın listelerde, bildirimlerde ve activity payload'larında iki kez sayılması                                                                                                                                                          |
| `TaskLabel @@unique([taskId, labelId])`           | Aynı label'ın iki kez eklenmesi                                                                                                                                                                                                                |
| `Column @@unique([boardId, id])`                  | Yalnızca `Task`'ın bir composite foreign key `(boardId, columnId) → Column(boardId, id)` deklare edebilmesi için var — "bir task'ın column'u kendi board'undadır" kuralını uygulama-seviyesi bir kontrol yerine bir veritabanı garantisi yapar |

**Silmeler kasıtlı olarak cascade eder.** Prisma'nın zorunlu bir ilişki üzerindeki
varsayılan aksiyonu `Restrict`'tir, dolayısıyla burayı belirtmeden bırakmak board
silmenin _başarısız olması_ anlamına gelir — iki varsayılandan daha şaşırtıcı olanı.
Sahiplenilen çocuklar cascade eder
(`Workspace → Board → Column, Task → Comment, Activity, TaskAssignee, TaskLabel`).
`User`'a referanslar cascade etmez: yazarından daha uzun yaşayan bir yorum veya
activity satırı doğrudur, ve bir kullanıcıyı silmek sessiz bir silinme değil,
kasıtlı bir operasyon olmalıdır.

---

## 7. Multi-tenant izolasyonu

Her workspace bir tenant'tır ve izolasyon kuralı mutlaktır: **her sorgu `workspaceId` ile
scope'lanır.**

Bu kural bugün guard seviyesinde zorlanır (request-scoped Prisma Client Extension /
interceptor'lar Faz 3+ ile gelir); her serviste yeniden uygulanmaz:

1. Bir guard, mevcut kullanıcının istenen workspace'teki üyeliğini çözümler ve üyelik yoksa
   isteği reddeder (üye olmayanlara 404 — anti-enumeration).
2. Çözümlenen `workspaceId` / üyelik rolü, request context'ine eklenir.
3. Servisler scope'u bu context'ten okur; repository erişim yolları her zaman ona göre
   filtreler.
4. İç içe geçmiş kaynaklar, ebeveyn zincirleri üzerinden doğrulanır (task → board →
   workspace); böylece başka bir tenant'a ait geçerli bir id içeri kaçırılamaz.
5. Workspace/org **mutation**'ları yalnızca Nest `/workspaces/*` üzerinden gider — Better Auth
   `/auth/organization/*` mutation HTTP'si firewall'lanır; Nest politikası bypass edilemez.

Bunu tek bir katmana yerleştirmek, yeni bir modülün izolasyonu varsayılan olarak devralması
demektir. Bunun etrafından dolanan bir modül, bir stil farkı değil, bir bug'dır. Üyelik
`role`'ü (`OWNER`/`ADMIN`/`MEMBER`/`GUEST`) yetki kararları için aynı katmanda kontrol
edilir. Scaffold controller'lar `/workspaces/:workspaceId/...` kullanır; handler'lar
geldiğinde `WorkspaceGuard` `params.workspaceId` okuyabilir.

---

## 8. Runtime evrimi

Aşamalı yol bilinçli bir tercihtir: mikroservis kapısı açık kalır, bedeli sadece baştan
ödenmez.

| Aşama         | Tetikleyici              | Runtime                                                                                                       |
| ------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------- |
| MVP           | Şimdi                    | Tek bir NestJS process (`api`) + `web` + `postgres` + `redis`                                                 |
| Rolleri bölme | Trafik artışı            | Aynı kod tabanı, aynı image, farklı roller: `api`, `ws` (Socket.io), `worker` (kuyruk) — Compose'da üç servis |
| Ayırma        | Kanıtlanmış bir darboğaz | _Sadece_ o modülü kendi servisine çıkar                                                                       |

2. aşamaya ulaşmak mimari bir değişiklik gerektirmez — temiz NestJS modül sınırları tek ön
   koşuldur. 3. aşamaya yalnızca kanıt karşısında girilir, asla spekülasyonla değil.

---

## 9. Karar kayıtları

Bu seçimlerin her birinin arkasındaki gerekçe bir ADR olarak kayıtlıdır:

| ADR                                                                                | Konu                                                    |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------- |
| [`0001-monorepo-modular-monolith.md`](decisions/0001-monorepo-modular-monolith.md) | Monorepo + modüler monolit                              |
| [`0002-backend-stack.md`](decisions/0002-backend-stack.md)                         | NestJS 11 + Prisma 7 + PostgreSQL 18 + Redis 8          |
| [`0003-frontend-stack.md`](decisions/0003-frontend-stack.md)                       | Next.js 16 + Tailwind + shadcn/ui + @dnd-kit + Recharts |
| [`0004-auth-better-auth.md`](decisions/0004-auth-better-auth.md)                   | Organization plugin'i ile Better Auth (→ Workspace)     |
| [`0005-realtime-socketio.md`](decisions/0005-realtime-socketio.md)                 | Socket.io + Redis adapter                               |
| [`0006-fractional-indexing.md`](decisions/0006-fractional-indexing.md)             | Sıralama için Float position'lar                        |
| [`0007-license-agpl.md`](decisions/0007-license-agpl.md)                           | AGPL-3.0                                                |
| [`0008-git-flow-semver.md`](decisions/0008-git-flow-semver.md)                     | Git Flow + SemVer                                       |

İlgili: [tech-stack.md](tech-stack.md) · [project-skeleton.md](project-skeleton.md)
