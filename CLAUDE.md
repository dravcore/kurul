# Kurul

Açık kaynak, Kanban odaklı proje yönetim aracı. `dravcore/kurul` — AGPL-3.0.

## Mimari

- Monorepo (pnpm workspace) + **modüler monolit** — mikroservis yok
- `apps/api` (NestJS 11 + Prisma 7 + PostgreSQL 18 + Redis 8 + Socket.io)
- `apps/web` (Next.js 16 App Router + Tailwind + shadcn/ui + @dnd-kit + Recharts)
- `packages/shared-types` (frontend/backend arasında paylaşılan TS tipleri — DTO'lar, enum'lar, socket event'leri)
- `packages/auth-access` (api + web için Better Auth organization erişim kontrolü rolleri)
- Auth: Better Auth (organization plugin; ürün alanında adı Workspace) · Deploy: Docker Compose

## Kritik kurallar

- `Task.position` ve `Column.position` **Float**'tır (fractional indexing) — asla Int kullanma
- `dueDate` ve `estimatedMinutes` ayrı alanlardır — birleştirme
- `priority` label'lardan ayrı tutulur
- Multi-tenant izolasyon: `WorkspaceGuard` yalnızca üyeliği çözer; her servis sorgusu kendi `workspaceId` koşulunu (ya da `board: { workspaceId }`) eklemek zorundadır. Bunu otomatik yapan hiçbir şey yok
  (interceptor yok, Prisma extension yok): scope'lanmamış bir sorgu bir bug'dır ve onu yalnızca review ile workspace-izolasyonu integration testleri yakalar
- Her `id` UUIDv7'dir (`@default(uuid(7))`) — asla cuid ya da autoincrement değil; pagination cursor anahtarı `id`'dir, asla `position` değil
- `Label.color`, temaya göre resolve edilen bir design-token slot adı saklar (`slot-1`…`slot-8`), asla ham hex değil
- `apps/web/app/globals.css` içindeki yazar CSS'i, istisna kuralın yanında gerekçelendirilmedikçe `@layer base` içine girer:
  katmansız bir kural, özgüllüğünden bağımsız olarak her Tailwind katmanını yener
- Her `text-*`/`bg-*`/`border-*`/`font-*`/`shadow-*`/`rounded-*` class'ı Tailwind theme'ine karşı çözülmelidir:
  çözülmeyen bir class hiçbir CSS üretmez, sessizce ve build hatası vermeden

## Git

- **Git Flow:** `main` (release'ler) ← `develop` (entegrasyon) ← `feature/*`, `fix/*`, `docs/*`, `chore/*`, ayrıca `release/*`, `hotfix/*`
- **Conventional Commits** (`feat:`, `fix:`, `docs:` ...) · SemVer + `CHANGELOG.md`
- Commit mesajları ve PR başlıkları İngilizce yazılır (Conventional Commits)
- `main` ya da `develop`'a doğrudan commit yok — bütün iş feature branch + PR üzerinden gider
- **Hiçbir yerde AI izi yok:** commit'lerde `Co-Authored-By: Claude/Cursor/…` trailer'ı yok; PR gövdelerinde,
  issue'larda, yorumlarda, CHANGELOG'da ve dokümanlarda `🤖 Generated with …` altbilgisi yok. Mesajın gövdesini yaz ve dur.

## Dokümantasyon

- Dokümantasyon yalnız Türkçedir ([ADR 0036](docs/decisions/0036-turkish-only-documentation.md)); İngilizce kopya ya da `docs/tr/` aynası yoktur, yeniden açılmaz
- İngilizce kalanlar: kod, kod yorumları, test adları, commit mesajları, dal adları, PR başlıkları, API hata metinleri ve OpenAPI açıklaması; arayüz `en` ve `tr` dillerini destekler ([ADR 0018](docs/decisions/0018-localization-strategy.md))
- `CHANGELOG.md` içinde `[Unreleased]` ve sonrası Türkçe yazılır; `[0.4.1]` ve öncesi yayımlandıkları dilde, yani İngilizce kalır ve çevrilmez
- Adlandırma: kök topluluk dosyaları BÜYÜK HARF, `docs/` dosyaları kebab-case ve adlar İngilizce kalır, ADR'ler `NNNN-title.md`
- Mimari/stack ayrıntıları: `docs/architecture.md`, `docs/tech-stack.md`, `docs/design.md` (UI/UX dili)
- Süreç: `docs/git-strategy.md`, `docs/coding-standards.md`, `docs/testing.md`, `docs/api-conventions.md`
- Doküman haritası: `docs/README.md` · Kararlar: `docs/decisions/` · İlerleme: `ROADMAP.md`

## Doküman politikası

- Yeni bir `.md` oluşturmadan önce var olan kanonik dosya güncellenir; yeni dosya yalnızca yeni bir kayıt
  _türü_ içindir (pratikte: yeni bir ADR)
- Bir olgu tek bir kanonik dosyada yaşar — başka yerden ona bağlantı verilir, asla kopyalanmaz
- Yol haritasının tek bir kaynağı vardır: kökteki `ROADMAP.md`. Arşiv yoktur: biten bir plan ya da spec
  silinir, git geçmişi onu saklar ve kalıcı sonucu `ROADMAP.md` ya da bir ADR içinde yaşar
- Çalışma notları ve denetim panoları depo dışında kalır; kalıcı sonuçlar bunun yerine
  `ROADMAP.md` maddelerine damıtılır
- Bir doküman başlığını değiştiren PR, o başlığın çapasına verilen bağlantıları da günceller (çapalar Türkçe başlıktan türer; kod yorumlarından, compose dosyalarından ve `.env.example`'dan bu çapalara bağlantı vardır)
