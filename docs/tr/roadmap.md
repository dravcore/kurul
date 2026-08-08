# Roadmap

Kurultay için dokümantasyondan MVP'ye ve ötesine uzanan, fazlara ayrılmış teslimat planı.

> 🌐 [English (canonical)](../roadmap.md) | Türkçe — Bu çeviri güncel olmayabilir; kanonik kaynak İngilizce'dir.

**Son güncelleme:** 2026-08-08

## İçindekiler

- [Bu roadmap nasıl çalışır](#bu-roadmap-nasıl-çalışır)
- [Durum lejantı](#durum-lejantı)
- [Faz 0 — Dokümantasyon ve standartlar](#faz-0--dokümantasyon-ve-standartlar)
- [Faz 1 — İskelet](#faz-1--iskelet)
- [Faz 2 — Auth ve workspace'ler](#faz-2--auth-ve-workspaceler)
- [Faz 3 — Board'lar ve column'lar](#faz-3--boardlar-ve-columnlar)
- [Faz 4 — Task'lar ve drag-and-drop](#faz-4--tasklar-ve-drag-and-drop)
- [Faz 5 — Task metadata'sı](#faz-5--task-metadatası)
- [Faz 6 — Filtreleme ve arama](#faz-6--filtreleme-ve-arama)
- [Faz 7 — Dashboard](#faz-7--dashboard)
- [Faz 8 — Aktivite log'u ve bildirimler](#faz-8--aktivite-logu-ve-bildirimler)
- [Faz 9 — Realtime](#faz-9--realtime)
- [MVP ötesi](#mvp-ötesi)

## Bu roadmap nasıl çalışır

**Bu dosya yalnızca yüksek seviyeli fazları tutar.** Görev seviyesi takip GitHub
Issues'ta yaşar: [github.com/dravcore/kurultay/issues](https://github.com/dravcore/kurultay/issues).

| Seviye | Nerede | Granülerlik |
|---|---|---|
| Faz | Bu dosya | "Board'lar ve column'lar" — haftalarca iş, tek bir tutarlı yetenek |
| Görev | GitHub Issues | "Column reorder endpoint'i cross-board taşımada 409 dönüyor" — bir PR |
| Karar | [decisions/](decisions/) | Bir fazın neden o şekilde inşa edildiği |

Fazlar sırayla teslim edilir. Her biri çalışan, merge edilmiş, gösterilebilir bir durumda
biter — hiçbir faz `develop`'ta yarım kalmış kod bırakmaz. Bir faz bir `0.y.0` release'ine
karşılık gelebilir; bkz.
[git-strategy.md](git-strategy.md#versiyonlama-politikası-semver).

Sıra bilinçlidir ve gelişigüzel yeniden önceliklendirilecek bir backlog değildir. Gerekçesi
[project-skeleton.md](project-skeleton.md)'de kayıtlıdır ve aşağıda faz başına
tekrarlanmıştır.

## Durum lejantı

| İşaret | Anlam |
|---|---|
| `[x]` | Bitti — `develop`'a merge edildi |
| `[~]` | Devam ediyor |
| `[ ]` | Başlanmadı |
| `[-]` | Ertelendi / şimdilik kapsam dışı |

---

## Faz 0 — Dokümantasyon ve standartlar

**Hedef:** bir satır uygulama kodu var olmadan önce her proje standardının yazıya
dökülmesi.
**Durum:** tamamlandı

### Governance ve topluluk dosyaları

- [x] `LICENSE` — AGPL-3.0
- [x] `README.md` — Kurultay'ın ne olduğu, durum, hızlı başlangıç, stack
- [x] `CONTRIBUTING.md` — katkı süreci
- [x] `CODE_OF_CONDUCT.md` — Contributor Covenant 2.1
- [x] `SECURITY.md` — güvenlik açığı bildirim politikası
- [x] `CHANGELOG.md` — Keep a Changelog, `[Unreleased]`'den başlıyor
- [x] `.github/ISSUE_TEMPLATE/` — bug report ve feature request formları
- [x] `.github/PULL_REQUEST_TEMPLATE.md`
- [x] `README.tr.md` — Türkçe README

### Süreç dokümantasyonu

- [x] `docs/git-strategy.md` — Git Flow, Conventional Commits, release süreci, SemVer
- [x] `docs/development.md` — ortam kurulumu ve günlük döngü
- [x] `docs/coding-standards.md` — TypeScript, NestJS, Next.js konvansiyonları
- [x] `docs/design.md` — tasarım ilkeleri, token'lar, yerleşim, hareket, durumlar, UI writing
- [x] `docs/testing.md` — test stratejisi ve CI beklentileri
- [x] `docs/api-conventions.md` — REST, hatalar, pagination, DTO'lar
- [x] `docs/roadmap.md` — bu dosya

### Mimari dokümantasyonu

- [x] `docs/architecture.md` — modüler monolit, modül haritası, veri modeli özeti
- [x] `docs/tech-stack.md` — İngilizce kanonik versiyon
- [x] `docs/project-skeleton.md` — İngilizce kanonik versiyon
- [x] `docs/decisions/` — ADR 0001–0008 + indeks

### Lokalizasyon

- [x] `docs/tr/` — `docs/` altındaki her yayımlanmış süreç/mimari dokümanın Türkçe kopyası
      (`docs/specs/` hariç)
- [x] Cross-link kontrolü: her EN doc kendi TR eşini linkler ve tersi
- [x] `docs/tr/design.md` — tasarım dokümanının Türkçe çevirisi

### Repository yapılandırması

- [x] `develop` branch'i `main`'den oluşturuldu
- [x] `main` ve `develop` üzerinde branch protection (doğrudan push yok, PR zorunlu; CI
      var olunca status check)
- [x] "Delete branch on merge" ve squash-merge varsayılanları etkinleştirildi

---

## Faz 1 — İskelet

**Hedef:** boş ama çalışan bir monorepo. İş mantığı yok — sonraki her özellik "kutuyu
doldurmak" oluyor.
**Referans:** [project-skeleton.md](project-skeleton.md)
**Durum:** başlanmadı

**Bu faz tek büyük bir maintainer-authored PR olarak iniyor** —
[CONTRIBUTING.md](../../CONTRIBUTING.md)'deki <500 satır kılavuzunun belgelenmiş bir
istisnası. Bir pnpm workspace, bir NestJS uygulaması, bir Next.js uygulaması, Prisma şeması
ve Docker Compose'u iskeletlemek, bağımsız olarak merge edilebilir birimlere ayrılmıyor;
her yarısı diğeri olmadan build edilemiyor. Bundan sonraki her faz olağan boyut kuralını
takip ediyor.

- [ ] pnpm workspace: `apps/api`, `apps/web`, `packages/shared-types`, `pnpm-workspace.yaml`
- [ ] Kök `package.json` script'leri: `dev`, `build`, `lint`, `test`, `db:migrate`, `db:seed`,
      `db:studio`
- [ ] Paylaşılan tooling: TypeScript strict base config, ESLint, Prettier
- [ ] `.env.example` ve `.gitignore`
- [ ] `docker-compose.yml` — postgres 18, redis 8, api, web (healthcheck'ler +
      `depends_on`)
- [ ] `docker-compose.dev.yml` — yalnızca postgres + redis
- [ ] `apps/api` — NestJS bootstrap, `app.module.ts`, global `ValidationPipe`, exception
      filter
- [ ] `apps/api` — boş modül klasörleri: `common/`, `prisma/`, `auth/`, `workspace/`,
      `board/`, `task/`, `label/`, `comment/`, `activity/`, `dashboard/`, `notification/`,
      `realtime/`
- [ ] Repository kökünde `prisma.config.ts` (Prisma 7: şema yolu, seed girişi, env yükleme)
- [ ] Prisma şeması — `User`, `Workspace`, `WorkspaceMember`, `Board`, `Column`, `Task`,
      `TaskAssignee`, `Label`, `TaskLabel`, `Comment`, `Activity`
- [ ] Id'ler `@default(uuid(7))`; `Task.position` ve `Column.position` `Float`'tır;
      `dueDate` ve `estimatedMinutes` ayrı alanlardır
- [ ] Join-tablosu unique kısıtları, `Column @@unique([boardId, id])` composite FK'i, ve
      açık `onDelete` aksiyonları ([project-skeleton.md](project-skeleton.md#prisma-şeması--ilk-tablolar))
- [ ] İlk migration commit edildi — yalnızca Faz 1 tabloları; `Notification`
      [Faz 8](#faz-8--aktivite-logu-ve-bildirimler)'e ertelenmiştir
- [ ] `db:seed` — bir demo workspace, board, varsayılan column'lar, birkaç task
- [ ] 200 dönen `GET /health`
- [ ] `apps/web` — Next.js App Router, Tailwind, shadcn/ui init, `@dnd-kit`, Recharts,
      `socket.io-client`, `next-intl` (i18n katmanı bağlanır; string'ler ilk component'ten
      itibaren katalogdan geçer — [design.md](design.md) §7)
- [ ] `apps/web` — `(auth)/` ve `(app)/` route group'ları, placeholder login sayfası
- [ ] `packages/shared-types` — `Priority`, `MemberRole` enum'ları; entity ve sayfa tipleri
- [ ] `.github/workflows/ci.yml` — push ve PR'da lint + typecheck + test + build

### Kabul kriterleri

```bash
docker compose up            # tüm servisler sağlıklı ayağa kalkıyor
pnpm db:migrate               # migration başarılı
pnpm db:seed                  # demo veri yüklenir
curl localhost:4000/health   # 200
# localhost:3000 login sayfasını render ediyor
pnpm lint && pnpm test && pnpm build   # hata yok
```

---

## Faz 2 — Auth ve workspace'ler

**Hedef:** bir kullanıcı kayıt olabilir, giriş yapabilir ve bir workspace'e sahip
olabilir. Bu var olmadan tenant-safe hiçbir şey inşa edilemez.
**Durum:** başlanmadı

- [ ] Better Auth entegrasyonu (organization plugin), session yönetimi
- [ ] Kayıt / giriş / çıkış / session yenileme
- [ ] `GET /me`
- [ ] Tüm korunan route'larda auth guard'ı
- [ ] **Workspace scoping guard'ı** — her request `workspaceId`'yi çözümler ve doğrular
- [ ] Workspace CRUD, slug benzersizliği
- [ ] Üyelik + rol'ler: `OWNER`, `ADMIN`, `MEMBER`, `GUEST`; role guard'ı
- [ ] Davetler: oluşturma, kabul etme, iptal etme
- [ ] Web: login/register sayfaları, session provider, workspace switcher, app shell
      layout'u
- [ ] Testler: auth akışları, workspace izolasyonu, rol matrisi
      ([testing.md](testing.md#neler-test-edilmeli))

---

## Faz 3 — Board'lar ve column'lar

**Hedef:** Kanban'ın gerçekten yaşadığı konteyner.
**Referans:** [design.md](design.md) — buradan itibaren tüm board UI çalışmaları için bağlayıcı referans
**Durum:** başlanmadı

- [ ] Web: [design.md](design.md) §3–§4'e göre design token'ları (açık + koyu), tipografi ve
      app shell chrome'u — önerilen değerleri gerçek ekranlarda doğrula ve her değişikliği o
      dokümana geri kaydet
- [ ] Board CRUD, workspace'e scope'lanmış
- [ ] Column CRUD
- [ ] Column yeniden sıralama (`position`)
- [ ] Board oluşturmada varsayılan column'lar (Yapılacak / Devam Ediyor / Tamamlandı)
- [ ] Web: board listesi, board sayfası kabuğu, column render'ı,
      oluştur/yeniden adlandır/sil dialog'ları

---

## Faz 4 — Task'lar ve drag-and-drop

**Hedef:** ürünün çekirdek etkileşimi.
**Durum:** başlanmadı

- [ ] Task CRUD
- [ ] `Task.position` için **fractional indexing** — arasına ekleme, üste, alta, boş
      column'a ekleme
- [ ] `PATCH .../tasks/:taskId/position` — column içinde ve column'lar arası taşıma
- [ ] Talep üzerine yeniden dengeleme: komşular arası boşluk hassasiyet eşiğinin altına
      düştüğünde bir column'u taşımayla aynı transaction içinde yeniden akıtma (zamanlanmış
      job yok — bkz.
      [`decisions/0006-fractional-indexing.md`](decisions/0006-fractional-indexing.md))
- [ ] Eşzamanlı taşıma (concurrent-move) yönetimi (yinelenen position yok)
- [ ] Web: `@dnd-kit` board'u, başarısızlıkta geri alınan (rollback) optimistic yeniden
      sıralama
- [ ] Web: task detay paneli
- [ ] **`@dnd-kit`'i yeniden değerlendir**, artık board etkileşimi gerçekten var: klasik hat
      donmuş ve ADR'nin fallback'i `pragmatic-drag-and-drop`. Sonucu her hâlükârda
      [`decisions/0003-frontend-stack.md`](decisions/0003-frontend-stack.md)'e kaydet
- [ ] Testler: [testing.md](testing.md#1-fractional-indexing-taskposition)'deki tam
      positioning matrisi

---

## Faz 5 — Task metadata'sı

**Hedef:** task'lar yalnızca listelenmek için değil, planlanmak için yeterli bilgiyi taşır.
**Durum:** başlanmadı

- [ ] Çoklu atanan (`TaskAssignee`)
- [ ] Label'lar: board-scoped CRUD, task'lara atama/kaldırma
- [ ] Priority (`LOW`/`MEDIUM`/`HIGH`/`URGENT`) — label'lardan ayrı tutulur
- [ ] `dueDate` ve `estimatedMinutes` — ayrı alanlar, ayrı UI
- [ ] Task'larda yorumlar
- [ ] Web: atanan seçici, label seçici, priority badge'i, tarih seçici, yorum thread'i

---

## Faz 6 — Filtreleme ve arama

**Hedef:** board'lar birkaç düzine kartı geçtikten sonra da kullanılabilir kalır.
**Durum:** başlanmadı

- [ ] Whitelist'lenmiş filtre/sıralama alanlarına sahip Query DTO
      ([api-conventions.md](api-conventions.md#filtreleme-sıralama-alan-seçimi))
- [ ] Filtreler: atanan, label, priority, due date aralığı, atanmamış/due-date'siz
- [ ] Başlık ve açıklama üzerinde serbest metin arama
- [ ] Task listelerinde cursor pagination
- [ ] Filtrelenen/sıralanan kolonlar için index'ler
- [ ] Web: filtre çubuğu, aktif-filtre chip'leri, URL'de filtre durumu

---

## Faz 7 — Dashboard

**Hedef:** bir workspace genelinde agregat görünüm.
**Durum:** başlanmadı

- [ ] Agregasyon endpoint'leri: statüye göre task'lar, atanana göre, priority'ye göre;
      gecikmiş sayısı; zaman içinde tamamlanma
- [ ] Agregasyonlar üzerinde sorgu performansı geçişi
- [ ] Web: Recharts görselleştirmeleriyle dashboard sayfası
- [ ] Boş ve yükleniyor durumları

---

## Faz 8 — Aktivite log'u ve bildirimler

**Hedef:** kullanıcılar neyin değiştiğini görebilir ve bunun hakkında bilgilendirilebilir.
**Durum:** başlanmadı

- [ ] Task oluşturma/taşıma/güncelleme/yorum/atama üzerinde `Activity` yazımı (yeni
      aktivite tiplerinin migration gerektirmemesi için `payload` JSON olarak)
- [ ] Aktivite feed endpoint'i (task seviyesi ve workspace seviyesi), cursor-paginated
- [ ] `Notification` modeli (yeni migration): mention, atama, yaklaşan due date —
      Faz 1 şemasında yok
- [ ] Okundu işaretle / tümünü okundu işaretle
- [ ] Web: task panelinde aktivite zaman çizelgesi, bildirim merkezi
- [ ] `[-]` E-posta gönderimi — MVP ötesine ertelendi

---

## Faz 9 — Realtime

**Hedef:** aynı board'daki iki kişi birbirlerinin değişikliklerini canlı görür.
**Durum:** başlanmadı

**Realtime bilerek en sona bırakıldı.** Socket event'leri veri modelini yansıtır, bu
yüzden model oturmadan önce yazılan her event onunla birlikte yeniden yazılmak zorunda
kalır. Realtime'ı kararlı bir şema üzerine inşa etmek tek bir iş turu; onu erken inşa
etmek ise ondan önceki sekiz fazın tümüne bir vergidir.

- [ ] Redis adapter'lı Socket.io gateway'i (yatay ölçekleme)
- [ ] Mevcut session'ı kullanan socket auth'u; **workspace/board başına scope'lanmış
      oda'lar**
- [ ] `@kurultay/shared-types`'ta event kontratı — her iki taraf için tek kaynak
- [ ] Event'ler: task oluşturuldu/güncellendi/taşındı/silindi, column değişti, yorum
      eklendi
- [ ] Web: board mount'ta subscribe olma, lokal optimistic state ile uzlaştırma,
      reconnect'te resync
- [ ] Bir remote taşıma drag ortasında geldiğinde çakışma davranışı

---

## MVP ötesi

Planlanmadı. Mimarinin bunlarla uyumlu kalması için listelendi, taahhüt olarak değil.

| Öğe | Not |
|---|---|
| `[-]` E2E test suite (Playwright) | UI şekil değiştirmeyi bıraktığında — [testing.md](testing.md) |
| `[-]` Gantt / zaman çizelgesi görünümü | `dueDate` + `estimatedMinutes` bunun için ayrı tutuluyor |
| `[-]` Task ekleri | Bir object-storage kararı (ADR) gerektiriyor |
| `[-]` Board şablonları | |
| `[-]` Public API token'ları + `/v1` öneki | 1.0 sonrası — [api-conventions.md](api-conventions.md#versiyonlama) |
| `[-]` Webhook'lar | |
| `[-]` E-posta bildirimleri | |
| `[-]` Trello / Jira'dan import | |
| `[-]` Ek UI dil paketleri | next-intl katmanının kendisi Faz 1'de gelir ve MVP yalnız İngilizce'dir; bu satır ek dillerin (önce Türkçe) paketlenmesiyle ilgilidir — bkz. [design.md](design.md#7-ui-metni) |
| `[-]` Docker Compose ötesinde self-host deployment rehberi | |

**1.0.0**, Faz 1–9 tamamlandığında ve REST API geriye dönük uyumluluk vaat edecek kadar
kararlı olduğunda kesilir.

## Ayrıca bakınız

- [project-skeleton.md](project-skeleton.md) — Faz 1'in tam detayı
- [architecture.md](architecture.md) — modüllerin nasıl bir araya geldiği
- [git-strategy.md](git-strategy.md) — bir fazın nasıl bir release'e dönüştüğü
- [development.md](development.md) — bunların herhangi birinin yerelde nasıl inşa edileceği
- [CHANGELOG.md](../../CHANGELOG.md) — gerçekte neyin teslim edildiği
- [GitHub Issues](https://github.com/dravcore/kurultay/issues) — görev seviyesi takip
