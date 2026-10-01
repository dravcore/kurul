# Kodlama Standartları

Bu repository'deki TypeScript, NestJS ve Next.js kodu için konvansiyonlar.

## İçindekiler

- [İlkeler](#i̇lkeler)
- [TypeScript](#typescript)
- [Adlandırma konvansiyonları](#adlandırma-konvansiyonları)
- [NestJS (`apps/api`)](#nestjs-appsapi)
- [DTO'lar ve validation](#dtolar-ve-validation)
- [Next.js (`apps/web`)](#nextjs-appsweb)
- [Paylaşılan tipler (`packages/shared-types`)](#paylaşılan-tipler-packagesshared-types)
- [Import'lar](#importlar)
- [Formatting ve linting](#formatting-ve-linting)

## İlkeler

1. **Stil için doğruluk kaynağı linter'dır.** Formatting code review'da asla tartışılmaz.
   Bir kural sahip olmaya değerse, ESLint veya Prettier'a kodlanmaya da değer.
2. **Modül sınırları mimaridir.** Kurul bir modüler monolit; onu bir çamur yumağına
   dönüşmekten alıkoyan tek şey kimin kimi import edebileceği konusundaki disiplindir.
3. **Tipler bir kez deklare edilir.** API sınırını geçen her şey `@kurul/shared-types`
   içinde yaşar ve import edilir, asla yeniden tiplenmez.
4. **Zekice olan yerine açık olan.** Kod, yazıldığından çok daha sık okunur.

## TypeScript

- `strict: true` kökteki `tsconfig.base.json`'da açıktır; `apps/api`, `apps/web`,
  `packages/shared-types`, `packages/auth-access` ve `e2e` bu dosyayı `extends` eder ve hiçbiri
  kapatmaz. Hiçbir paket bundan muaf değildir.
- Ayrıca açık: `noUncheckedIndexedAccess`, `noImplicitOverride`,
  `noFallthroughCasesInSwitch`.

| Kural                  |                                                                                                                                                                                                                                                                                                             |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `any`                  | Yasak. `unknown` kullanıp daraltın, ya da tipi yazın. `// eslint-disable` nedenini açıklayan bir yorum gerektirir.                                                                                                                                                                                          |
| Non-null assertion `!` | Kaçının. Tipi daraltın ya da açıkça throw edin.                                                                                                                                                                                                                                                             |
| `as` cast'leri         | Yalnızca gerçekten tiplenemeyen sınırlar için (parse edilmiş JSON, üçüncü parti boşlukları), bir yorumla birlikte.                                                                                                                                                                                          |
| Return tipleri         | Export edilen fonksiyonlarda ve tüm public service/controller metotlarında açık. Lokal helper'lar için inferred olması sorun değil.                                                                                                                                                                         |
| `enum`                 | String-literal union'ları veya `as const` objelerini tercih edin. Ürün enum'ları `@kurul/shared-types`'ta `as const` objesi (artı türetilmiş union tipi) olarak yazılır ve `schema.prisma`'daki enum'un elle tutulan yansımasıdır (`enums.ts` başındaki not); shared types Prisma'dan yeniden export etmez. |
| `interface` vs `type`  | Genişletilebilecek obje şekilleri için `interface`, union'lar, intersection'lar ve mapped tipler için `type`. Aynı kavram için ikisini karıştırmayın.                                                                                                                                                       |
| `null` vs `undefined`  | `null` saklanan bir yokluktur (bir DB kolonu), `undefined` yok olan bir değerdir (opsiyonel bir alan). İkisini birbirinin yerine kullanmayın.                                                                                                                                                               |

Hatalar tiplenir ve throw edilir, bir servisten asla `{ error: string }` olarak
döndürülmez. API, bunları [api-conventions.md](api-conventions.md#hatalar)'de tarif edilen
yanıt şekline çevirir.

## Adlandırma konvansiyonları

| Şey                                                       | Konvansiyon                             | Örnek                                                     |
| --------------------------------------------------------- | --------------------------------------- | --------------------------------------------------------- |
| Dosyalar ve dizinler                                      | `kebab-case`                            | `task-position.service.ts`, `components/board/`           |
| Class'lar, decorator'lar, tipler, interface'ler, enum'lar | `PascalCase`                            | `TaskService`, `CreateTaskDto`, `MemberRole`              |
| Fonksiyonlar, değişkenler, metotlar, property'ler         | `camelCase`                             | `moveTask`, `workspaceId`                                 |
| Sabitler (modül seviyesi, gerçekten sabit)                | `UPPER_SNAKE_CASE`                      | `DEFAULT_PAGE_SIZE`, `POSITION_GAP`                       |
| React component'leri                                      | `kebab-case` dosya, `PascalCase` export | `components/task/task-card.tsx`, `TaskCard`'ı export eder |
| React hook'ları                                           | `use` öneki, camelCase                  | `use-board-socket.ts`, `useBoardSocket`'i export eder     |
| Boolean'lar                                               | `is` / `has` / `can` öneki              | `isArchived`, `hasUnreadComments`                         |
| Prisma modelleri                                          | `PascalCase` tekil                      | `Task`, `WorkspaceMember`                                 |
| Veritabanına bakan id'ler                                 | `<entity>Id`                            | `workspaceId`, `boardId`                                  |

Default export `PascalCase` olsa bile dosya adları kebab-case'dir — dosya sistemi macOS'ta
büyük/küçük harf duyarsız, CI'da ise duyarlı, ve kebab-case bu bozulma sınıfının tamamından
kaçınır.

### NestJS dosya son ekleri

`apps/api`'deki Nest bileşenleri rolünü belirten bir son ek taşır (bugün üç provider bunun
dışında: `notification/notification-mailer.ts`, `common/rate-limit/upload-budget.ts` ve
`health/redis-health.client.ts`); rolü olmayan saf yardımcı modüller (`common/env.ts`,
`common/uuid.ts`) son eksiz, kebab-case adlıdır:

| Son ek             | Rol                                          |
| ------------------ | -------------------------------------------- |
| `*.module.ts`      | Nest modül tanımı                            |
| `*.controller.ts`  | HTTP route handler'ları                      |
| `*.service.ts`     | İş mantığı                                   |
| `*.dto.ts`         | Request/response DTO'ları (`dto/` içinde)    |
| `*.guard.ts`       | Guard'lar                                    |
| `*.interceptor.ts` | Interceptor'lar (bugün kullanılmıyor)        |
| `*.filter.ts`      | Exception filter'lar                         |
| `*.decorator.ts`   | Özel decorator'lar                           |
| `*.gateway.ts`     | Socket.io gateway'leri                       |
| `*.schema.ts`      | OpenAPI response şeması (`openapi/schemas/`) |
| `*.mapper.ts`      | Satır → DTO dönüşümü                         |
| `*.worker.ts`      | BullMQ worker'ları                           |
| `*.pipe.ts`        | Pipe'lar                                     |
| `*.middleware.ts`  | Middleware'ler                               |
| `*.spec.ts`        | Yerinde (colocated) unit testler             |

## NestJS (`apps/api`)

### Modül iskeleti

Her domain modülü aynı şekle sahiptir. Bugün ise bu iskeletin (`*.module.ts`,
`*.controller.ts`, `*.service.ts`, `dto/`) bir kısmını taşımayan modüller var; listesi
[architecture.md §3](architecture.md#3-appsapi--modül-haritası)'te.

```
src/task/
├── task.module.ts
├── task.controller.ts
├── task.service.ts
├── dto/
│   ├── create-task.dto.ts
│   ├── update-task.dto.ts
│   ├── move-task.dto.ts
│   └── task-response.dto.ts
└── task.service.spec.ts
```

| Katman     | Sorumluluk                                                      | Yapmamalı                                                                              |
| ---------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Controller | HTTP şekli: routing, param'lar, status kodları, giren/çıkan DTO | İş mantığı içermemeli veya Prisma'ya dokunmamalı                                       |
| Service    | İş mantığı, transaction'lar, Prisma erişimi                     | HTTP'yi bilmemeli (saf logic helper'larında `Request`, `Response`, HTTP exception yok) |
| DTO        | Validation decorator'larıyla birlikte sınırdaki kontrat         | Logic içermemeli                                                                       |

### Modül sınırları

**Bir modül başka bir modülün iç parçalarına uzanmaz; yalnızca o modülün `exports`
listesindeki provider'ları kullanır.** Bir servisi inject etmek için sınıfı TypeScript'te
import etmek kaçınılmazdır (constructor tipi); sınır DI düzeyindedir: bağımlı olduğunuz modülü
`imports`'a yazın, onun provider'ını kendi `providers` dizinize yazmayın ya da `new` ile
üretmeyin.

```ts
// Yanlış — başka modülün servisini kendi providers dizisine yazmak
@Module({ providers: [TaskService, BoardService] })
// Doğru — modüle bağımlı ol, modülün export ettiğini inject et
@Module({
  imports: [BoardModule],
  providers: [TaskService],
})
export class TaskModule {}
```

Kurallar:

- Bir modülün public API'si, `@Module({ exports: [...] })`'ünün listelediği şeydir. Geri
  kalan her şey o modüle özeldir.
- İşe yarayan en küçük yüzeyi export edin. Başka yerde yalnızca iki metot gerekiyorsa,
  tüm servisi değil dar bir facade'ı export edin.
- Bir döngü yaratacak cross-module okumalar bir tasarım kokusudur. Bunları paylaşılan
  kaygıyı `common/`'a taşıyarak veya bir back-import eklemek yerine bir event yayarak
  çözün.
- `PrismaModule`, `AuthModule` ve `TokenModule` `@Global()`'dır; `common/` ise bir modül
  değil, her yerden import edilebilen paylaşılan koddur. Feature modülleri yine de, sınırın
  önemli olduğu yerlerde ihtiyaç duyduklarını açıklık için import eder.

Modüler monoliti ileride ayrıştırılabilir tutan şey budur — bkz.
[architecture.md](architecture.md) ve
[decisions/0001-monorepo-modular-monolith.md](decisions/0001-monorepo-modular-monolith.md).

### Multi-tenant izolasyonu

Her sorgu `workspaceId` ile scope'lanır. `WorkspaceGuard` yalnızca üyeliği kurar; her servis
metodu Prisma'yı yine de o `workspaceId` ile (ya da `board: { workspaceId }` ile) filtreler.
Kapsamda bir `workspaceId` olmadan `boardId` alan bir servis metodu bir kısayol değil, bir
bug'dır.

> Request-scoped Prisma Client Extension'lar hâlâ ertelenmiş durumda. İzolasyon review ve
> `apps/api/test/*.e2e-spec.ts` içine dağılmış cross-tenant integration testleriyle zorlanır —
> bir lint kuralı ya da otomatik bir sorgu yeniden yazıcısıyla değil. Workspace scoping'i
> olmayan herhangi bir sorguyu review'da engelleyici (blocking) kabul edin.

## DTO'lar ve validation

Validation **sınırda**, DTO'larda, `class-validator` ile gerçekleşir. Servisler kendi
girdilerine güvenir; controller'lar güvenmez.

```ts
// src/task/dto/create-task.dto.ts (import'lar çıkarıldı; sınırlar dto/task-limits.ts'te)
export class CreateTaskDto {
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_TASK_TITLE_LENGTH)
  title!: string;

  @IsUuidV7()
  columnId!: string;

  @OptionalNullable()
  @IsString()
  @MaxLength(MAX_TASK_DESCRIPTION_LENGTH)
  description?: string | null;

  @IsOptional()
  @IsEnum(Priority)
  priority?: Priority;

  @OptionalNullable()
  @IsISO8601({ strict: true, strictSeparator: true })
  dueDate?: string | null;

  @OptionalNullable()
  @IsInt()
  @Min(0)
  @Max(MAX_ESTIMATED_MINUTES)
  estimatedMinutes?: number | null;

  @IsOptional()
  @IsUuidV7()
  afterTaskId?: string | null;
}
```

- Global bir `ValidationPipe`, `whitelist: true`, `forbidNonWhitelisted: true` ve
  `transform: true` ile çalışır. Bilinmeyen property'ler sessizce düşürülmez, reddedilir.
- `UpdateXDto`, `CreateXDto`'dan `PartialType` ile türetilmez; alanlarını kendisi bildirir,
  çünkü `PATCH`'te `null`'ın anlamı sütuna bağlıdır: nullable bir sütunun alanı
  `@OptionalNullable()` taşır (atlanırsa dokunulmaz, `null` temizler), nullable olmayanınki
  `@OptionalNonNullable()` (atlanırsa dokunulmaz, `null` `400`'dür) —
  `common/validation/optional.ts`, bkz. [api-conventions.md](api-conventions.md#dto-adlandırma).
- Id'ler de doğrulanır, asla ham güvenilmez: path'teki id'ler `@UuidParam()` ile
  (`ParseUuidV7Pipe`), gövdedeki id'ler `@IsUuidV7()` ile (`common/uuid.ts`; `@IsUUID('7')`'yi
  sarar) — her id bir UUIDv7'dir, bkz. [api-conventions.md](api-conventions.md#veri-tipleri).
- Response DTO'ları açıktır — bir controller'dan asla doğrudan bir Prisma entity'si
  döndürülmez. Response şekli deklare edildiğinde şifre hash'leri, dahili flag'ler ve
  soft-delete kolonları kazara sızmaz.

DTO adlandırması ve response/hata formatı: [api-conventions.md](api-conventions.md).

## Next.js (`apps/web`)

- **Yalnızca App Router.** `pages/` yok.
- **Varsayılan olarak Server Component'ler.** `'use client'`'ı yalnızca component'in state,
  effect, event handler veya browser API'lerine ihtiyacı olduğunda ekleyin — ve ağaçta
  olabildiğince aşağı itin. Sadece bir buton `onClick` istediği için tüm bir board sayfası
  client component olmamalı.
- İlk render için veri bugün istemcide çekilir: sayfalar (`page.tsx`) veri okumaz; okumalar
  client component'lerde `lib/use-api-resource.ts` (board'da el yapımı yükleme) üzerinden,
  yazmalar `lib/api.ts`'teki tipli client üzerinden gider
  ([ADR 0029](decisions/0029-client-data-layer.md)). Sunucuda yapılan tek okumalar `proxy.ts`'teki
  oturum yoklaması ve `i18n/user-locale.ts`'teki locale için `/me` okumasıdır.
- Socket.io subscription'ları client component'lerde yaşar, bir hook içinde kurulur,
  unmount'ta kapatılır.

### Component organizasyonu

Component'ler tipe göre değil, **domain'e göre** organize edilir.

```
components/
├── ui/           # yalnızca shadcn/ui primitive'leri — üretilir, elle düzenlenmez
├── common/       # domain'ler arası bileşikler: ConfirmDialog, FormDialog, InlineRename, SubmitError
├── board/        # board-view.tsx, board-canvas.tsx, board-column.tsx, task-composer.tsx, use-board-*.ts
├── task/         # task-card.tsx, task-panel.tsx, priority-icon.tsx, use-board-task-dnd.ts
├── dashboard/    # grafik component'leri
├── notification/ # zil, liste, okunmamış sayacı
├── settings/     # ayar bölümleri ve dialog'ları
├── auth/         # oturum açma, kayıt, davet ve doğrulama ekranları
├── brand/        # DamgaMark
└── layout/       # app-shell, sidebar, workspace switcher, topbar
```

| Kural                                 |                                                                                                                                                    |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `components/ui/`                      | Yalnızca shadcn/ui çıktısı. Proje component'lerini buraya koymayın ve primitive'leri shadcn workflow'unun ürettiğinin ötesinde elle değiştirmeyin. |
| Domain klasörleri                     | Kendi component'lerine sahiptir; bir board component'i ne kadar küçük olursa olsun `board/`'a aittir                                               |
| `components/common/`                  | Domain'den bağımsız, domain'ler arası paylaşılan bileşikler — DTO yok, API çağrısı yok. `ConfirmDialog` / `FormDialog` `ui/`'da değil buradadır    |
| Domain'ler arası paylaşılan component | Önce lokal tutmayı tercih edin. 3+ domain kullanıyorsa ya da 2 domain aksi halde önemsiz olmayan bir iskeleti tekrarlayacaksa `common/`'a taşıyın  |
| Sayfa dosyaları                       | `page.tsx` component'leri bir araya getirir; herhangi bir boyutta layout logic'i veya markup tutmaz                                                |

### Stil

- Markup'ta Tailwind utility class'ları; CSS modülleri yok, styled-components yok.
- Koşullu class'lar string concatenation değil, `cn()` helper'ından geçer. `cn()`
  (`apps/web/lib/utils.ts`) `tailwind-merge`'ü Kurul'un tip ölçeği ve `font-strong` ağırlığıyla
  genişletir; böylece bir tüketicinin `text-*`/`font-*` override'ı, primitifin kendi
  varsayılanıyla tekilleşir, ikisi birden DOM'a ulaşmaz.
- Design token'ları (renkler, spacing, radius) Tailwind theme'inden gelir — component'lerde
  keyfi hex değerleri yok.
- İki çağrı noktası bilerek ham renk taşır: components/ui/button.tsx'in destructive
  `text-white`'ı ve components/ui/select.tsx'in chevron `stroke="%23888"`'i; ikisi de
  `RAW_COLOUR_CALL_SITES` (`apps/web/app/globals.contrast.test.ts`) içinde sabitlenmiş ve
  ölçülmüş durumda. Chevron bir token'ı hiç okuyamaz: kontrolün kendi background'una bir
  `data:` URI olarak çizilir ve orada `var()` çözülmez. Bu ikisinin dışındaki her şey bir
  defect'tir.
- Tek bir çağrı noktası bilerek `outline-none` taşır: `components/ui/dialog.tsx`'in
  `DialogContent` ve `DialogDrawerContent`'i; Radix content wrapper'ları açıldıklarında focus'u
  Tab, ok tuşu veya bir link değil script taşır, yani tek focus işaretinin böleceği bir klavye
  yolculuğu yoktur. Ham renk istisnalarıyla aynı şekilde korunur:
  `apps/web/app/globals-css-layers.test.ts` ağacın tamamını `outline-none` / `outline-hidden`
  için tarar ve sonuç adı konmuş, gerekçelendirilmiş bu tek istisnadan başka bir şeyse kırmızıya
  döner.
- `apps/web/app/globals.css` içindeki yazar CSS'i, kuralın yanına yazılmış bir gerekçe yoksa
  `@layer base` içine girer. Katmansız bir kural özgüllüğünden bağımsız olarak her cascade
  katmanını yener; bu yüzden katmansız bir `*` seçici, Tailwind'in `@layer utilities` içine
  ürettiği yardımcı sınıfları yeniden boyar ve markup'ta yazılan class söylediği şeyi ifade
  etmeyi bırakır. `:focus-visible` outline'ı böyle bir gerekçe taşıyan kuraldı; kontroller kendi
  focus ring'lerini ve `outline-none`'larını bıraktığı anda `base` içine taşındı. Bilerek katmansız
  kalanlar da var: forced-colors yedekleri yardımcı sınıfların üstünde durmak zorundadır,
  `board-scroller`'ın sürükleme sırasında snap'i bırakması da öyle (gerekçesi `globals.css`'te
  kuralın yanında yazılı). `apps/web/app/globals-css-layers.test.ts` bu kuralı her satır için
  taramaz, seçili kuralların katmanını sabitler: `*` border-color yedeği, `:focus-visible`
  outline'ı ve geçersiz alan için yeniden renklendirmesi `base` içinde, forced-colors yedekleri
  `utilities`'in üstünde kalmak zorundadır.
- Her `text-*`, `bg-*`, `border-*`, `font-*`, `shadow-*` ve `rounded-*` class'ının
  `@theme inline` içinde ya da
  Tailwind'in yerleşik ölçeğinde bir karşılığı olmalı. Karşılığı olmayan class hiç CSS üretmez:
  hata da vermez, element yalnızca miras alır ve yanlışlık review'da görünmez.
  `apps/web/app/theme-classes.test.ts` ağacı Tailwind üzerinden derler ve hiçbir şey üretmeyen her
  class'ta kırmızıya döner.

## Paylaşılan tipler (`packages/shared-types`)

API sınırını geçen her şey **bir kez**, `@kurul/shared-types` içinde deklare edilir ve
her iki taraftan da import edilir:

- DTO/response şekilleri
- Enum'lar (`Priority`, `MemberRole`, `InvitationStatus`, `LabelColorSlot`)
- Socket.io event isimleri ve payload tipleri

Better Auth organization **access-control rolleri** `@kurul/auth-access` içindedir
(`better-auth` peer dependency). Rolleri oradan import edin — `permissions`
açıklamalarını `apps/api` ile `apps/web` arasında kopyalamayın.

```ts
// Doğru
import type { TaskResponse, Priority } from '@kurul/shared-types';
import { ac, organizationRoles } from '@kurul/auth-access';

// Yanlış — sessizce sapacak yeniden deklare edilmiş bir şekil
interface Task {
  id: string;
  title: string;
  priority: string;
}
```

Asla yeniden deklare etmeyin, asla çoğaltmayın, asla "sadece bir alanı lokal olarak
ekleyeyim" demeyin. Frontend, backend'in döndürmediği bir şekle ihtiyaç duyuyorsa, bu bir
API değişikliğidir, lokal bir tip değil.

## Import'lar

Tercih edilen sıra (konvansiyon; şu an `eslint-plugin-import` ile makine zorlaması yok):

```ts
// 1. Node built-in'leri
import { randomUUID } from 'node:crypto';

// 2. Dış paketler
import { Injectable, NotFoundException } from '@nestjs/common';

// 3. Workspace paketleri
import type { TaskResponse } from '@kurul/shared-types';

// 4. Mutlak dahili (path alias; yalnızca apps/web'de tanımlı)
import { cn } from '@/lib/utils';

// 5. Göreli
import { CreateTaskDto } from './dto/create-task.dto';
```

- Yalnızca tip için import'larda `import type` kullanın.
- `apps/web`'de bir seviyeden fazla `../` zinciri yerine `@/` alias'ını kullanın; `apps/api`'de
  alias yoktur, dahili import göreli yazılır (`../prisma/prisma.service`).

### Barrel dosyaları

Bunları ölçülü kullanın.

- **Kabul edilebilir:** `packages/shared-types` veya `packages/auth-access`'in tek public
  giriş noktası; bir modülün `dto/index.ts`'i.
- **Kaçının:** `apps/api` modül klasörleri içinde ve `components/` genelinde barrel'lar.
  Import döngüleri yaratırlar, tree-shaking'i bozarlar, TypeScript sunucusunu
  yavaşlatırlar ve farkına varmadan bir modül sınırının ötesine import etmeyi
  kolaylaştırırlar.
- Cross-module import'ları kolaylaştırmak için bir modülün iç kısımlarını asla bir
  barrel üzerinden yeniden export etmeyin — bu, sınır kuralının fazladan adımlarla
  çiğnenmesidir.

## Formatting ve linting

| Araç                | Rol                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Prettier            | Tüm formatting. Config commit edilir; editor-local override yok.                                                                                                                                                                                                                                                                                                                                                                      |
| ESLint              | Flat config: `@eslint/js`, `typescript-eslint`, `eslint-config-prettier`, artı `apps/web` plugin'leri (`eslint-plugin-react-hooks`, `@next/eslint-plugin-next`, `eslint-plugin-jsx-a11y` recommended). Nest ve `eslint-plugin-import` bağlı değil — import sırası konvansiyonla tutulur. `jsx-a11y` hâlâ eslint ^3–9 peer'ı istiyor; kök `pnpm.peerDependencyRules.allowedVersions` upstream yakalayana kadar eslint 10'a izin verir. |
| `tsc --noEmit`      | Typecheck, CI'da lint'ten ayrı çalışır                                                                                                                                                                                                                                                                                                                                                                                                |
| Husky + lint-staged | Yerelde pre-commit: staged `*.ts` / `*.tsx` dosyalarına `eslint --fix --max-warnings 0` ve `prettier --write`; `*.{mjs,cjs,js,json,md,yml,yaml,css}` dosyalarına `prettier --write`. Tip denetimi ve testler pre-commit'te koşmaz                                                                                                                                                                                                     |

```bash
pnpm lint          # ESLint kontrol
pnpm lint --fix    # ESLint otomatik düzeltme
pnpm format        # Prettier write
pnpm format:check  # Prettier check (CI kapısı)
pnpm typecheck     # shared paket build + tsc --noEmit
```

- CI, lint hatalarında, format sapmasında (`format:check`) ve type hatalarında başarısız
  olur. Uyarıların birikmesine izin verilmez: bir kural ya bir hatadır ya da kaldırılır.
- ESLint bugün şunları **zorlamaz**, yalnızca konvansiyondur: non-null assertion'dan kaçınma
  (`no-non-null-assertion` yalnız `strict` preset'te; bu repo `recommended` kullanır), export
  edilen fonksiyonlarda açık return tipi, `eslint-disable` için açıklama yorumu ve import sırası.
  `no-explicit-any` ise `error`'dır (`eslint.config.mjs`).
- **Stil insanlar tarafından review edilmez.** Bir reviewer bir formatting değişikliği
  istiyorsa, düzeltme bir review yorumu değil bir lint kuralı PR'ıdır.
- Üretilen çıktıyı (`dist/`, `.next/`, Prisma client) commit etmeyin veya nedeni açıklayan
  bir yorum olmadan kuralları dosya genelinde devre dışı bırakmayın.

## Ayrıca bakınız

- [architecture.md](architecture.md) — modül haritası ve katmanlaşma
- [api-conventions.md](api-conventions.md) — REST, DTO adlandırması, hata formatı
- [testing.md](testing.md) — test yerleşimi ve beklentiler
- [git-strategy.md](git-strategy.md) — commit'ler ve PR süreci
- [architecture.md](architecture.md#2-monorepo-yerleşimi) — bu kuralların varsaydığı dizin yerleşimi
- [../CONTRIBUTING.md](../CONTRIBUTING.md) — katkı süreci
