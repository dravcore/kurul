# Geliştirme

Kurultay geliştirme ortamının nasıl kurulacağı ve günden güne nasıl çalışılacağı.

> 🌐 [English (canonical)](../development.md) | Türkçe — Bu çeviri güncel olmayabilir; kanonik kaynak İngilizce'dir.

## İçindekiler

- [Durum](#durum)
- [Ön koşullar](#ön-koşullar)
- [Klonlama ve kurulum](#klonlama-ve-kurulum)
- [Ortam değişkenleri](#ortam-değişkenleri)
- [SMTP ve Mailpit](#smtp-ve-mailpit)
- [Çalışma modları](#çalışma-modları)
- [pnpm script'leri](#pnpm-scriptleri)
- [Veritabanı iş akışı](#veritabanı-iş-akışı)
- [Yükseltme ve yedekleme](#yükseltme-ve-yedekleme)
- [Günlük döngü](#günlük-döngü)
- [Sorun giderme](#sorun-giderme)

## Durum

Monorepo ve MVP özellik seti (Faz 1–9) repository’de **mevcuttur**. Bu sayfadaki komutlar
gündelik kontrattır — gerçeklik bu dokümandan sapıyorsa ikisinden biri buglıdır ve aynı
PR’da düzeltilir.

- Yerleşim, Prisma modelleri ve erken kabul kriterleri: [project-skeleton.md](project-skeleton.md)
- Faz ilerlemesi (MVP tamam): [roadmap.md](roadmap.md)
- Her aracın neden seçildiği: [tech-stack.md](tech-stack.md)

## Ön koşullar

| Araç           | Sürüm           | Kontrol                  | Notlar                                                                                                                                                                                                           |
| -------------- | --------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node.js        | 22 veya üzeri   | `node -v`                | 22 taban çizgisi — Node 20 ömrünü tamamladı (2026-04-30) ve Prisma 7 zaten ≥ 20.19.0 istiyor. **24 LTS önerilir** (2028-04-30'a kadar Active LTS)                                                                |
| pnpm           | 9 veya üzeri    | `pnpm -v`                | Corepack üzerinden: `corepack enable && corepack prepare pnpm@latest --activate`. Corepack, Node ≥ 25 ile artık birlikte gelmiyor — orada önce `npm i -g corepack`, ya da pnpm'i bağımsız kurun: `npm i -g pnpm` |
| Docker         | herhangi güncel | `docker -v`              | macOS'ta Docker Desktop veya Colima                                                                                                                                                                              |
| Docker Compose | v2 (plugin)     | `docker compose version` | `docker-compose` v1 desteklenmiyor                                                                                                                                                                               |
| Git            | 2.30+           | `git --version`          |                                                                                                                                                                                                                  |

Yerel bir PostgreSQL veya Redis kurulumu gerekmiyor — ikisi de Docker içinde çalışır.

## Klonlama ve kurulum

```bash
git clone https://github.com/dravcore/kurultay.git
cd kurultay
pnpm install          # her workspace paketini kurar
pnpm db:generate       # apps/api/prisma/schema.prisma'dan Prisma client'ı üret
```

Repository bir pnpm workspace'idir (`apps/*`, `packages/*`). `pnpm install`'ı her zaman
repository kökünden çalıştırın — asla `apps/api` veya `apps/web` içinden değil.

Üretilen Prisma client'ı (`apps/api/src/generated/`) git-ignore'ludur ve onu oluşturan bir
`postinstall` hook'u yoktur — `pnpm db:generate` her temiz klonda gerekli ve açık bir adımdır.
`@prisma/client` türevli tipleri import eden kod, bunu en az bir kez çalıştırana kadar
typecheck'ten geçmez ve build olmaz.

`packages/shared-types` ve `packages/auth-access` build edilmiş `dist/` dizinlerinden tüketilir
ve o dizinler de aynı sebeple git-ignore'ludur; dolayısıyla temiz bir klonda test suite'leri
koşmadan önce bunların build edilmesi gerekir:

```bash
pnpm --filter @kurultay/shared-types build
pnpm --filter @kurultay/auth-access build
```

Bu adımı atlamak yardımcı bir hata üretmez. `pnpm test`, paylaşılan bir tipi import eden her
dosyada `Failed to resolve entry for package "@kurultay/shared-types"` ile düşer ve bu, eksik
bir build'den çok bozuk bir checkout gibi okunur. `pnpm build` ve `pnpm typecheck` bunu yan
etki olarak zaten yapar; `pnpm test` yapmaz, `pnpm lint` de yapmaz. CI bunları hem lint hem
test job'ından önce açıkça build eder.

## Ortam değişkenleri

```bash
cp .env.example .env
```

Sonra boşlukları doldurun. `.env` git tarafından ignore edilir ve asla commit edilmemelidir.

| Değişken              | Örnek                                                             | Amaç                                                                                                                       |
| --------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`        | `postgresql://kurultay:kurultay@localhost:5432/kurultay`          | Prisma bağlantı string'i                                                                                                   |
| `REDIS_URL`           | `redis://localhost:6379`                                          | Socket.io Redis adapter'ı, caching, BullMQ due-soon worker (`due-soon` kuyruğu)                                            |
| `BETTER_AUTH_SECRET`  | _(üret)_                                                          | Session imzalama secret'ı — zorunlu, varsayılan yok                                                                        |
| `BETTER_AUTH_URL`     | `http://localhost:4000`                                           | API'nin public URL'i (Better Auth `/auth/*` altında monte edilir)                                                          |
| `API_PORT`            | `4000`                                                            | NestJS dinleme portu                                                                                                       |
| `WEB_URL`             | `http://localhost:3000`                                           | API için CORS origin'i                                                                                                     |
| `NEXT_PUBLIC_API_URL` | `http://localhost:4000`                                           | Web bundle'ına derlenen API URL'i — **build sırasında gömülür** (Docker build'leri bunu build arg olarak geçirir)          |
| `SMTP_HOST`           | `localhost` (geliştirme, Mailpit üzerinden)                       | SMTP sunucu host'u. Tamamen boş bırakılırsa mail modülü göndermek yerine loglar — bkz. [SMTP ve Mailpit](#smtp-ve-mailpit) |
| `SMTP_PORT`           | `1025` (geliştirme, Mailpit üzerinden) / `587` (tipik production) | SMTP sunucu portu                                                                                                          |
| `SMTP_USER`           | _(Mailpit için boş)_                                              | SMTP auth kullanıcı adı, sunucunuz gerektiriyorsa                                                                          |
| `SMTP_PASSWORD`       | _(Mailpit için boş)_                                              | SMTP auth şifresi, sunucunuz gerektiriyorsa                                                                                |
| `SMTP_SECURE`         | `false`                                                           | Örtük TLS için (port 465) `true`, STARTTLS/plaintext için (587/25, ve Mailpit) `false`                                     |
| `MAIL_FROM`           | `Kurultay <noreply@example.com>`                                  | Giden mail'lerdeki `From:` başlığı                                                                                         |

Bir secret üretmek için:

```bash
openssl rand -base64 32
```

**Yeni bir ortam değişkeni eklemek üç adımlı bir değişikliktir** ve üçü de aynı PR'a girer:
`apps/api/src/common/env.ts` yardımcıları üzerinden bağla (veya `process.env` okuyan çağrı
noktası — bugün ayrı bir Zod/tipli env şeması yok), güvenli bir placeholder ile
`.env.example`'a ekle ve yukarıdaki tabloda belgele.

## SMTP ve Mailpit

Kurultay bugün tek bir akış için e-posta gönderiyor: `accept-invitation`'ın bir davet
edilenin workspace'e katılmasına izin vermeden önce ihtiyaç duyduğu doğrulama linki (bkz.
[`decisions/0013-invitation-email-verification.md`](decisions/0013-invitation-email-verification.md)).
`SMTP_HOST`'u boş bırakmak geçerli bir seçenek — API yine ayağa kalkar ve mail modülü mesajı
göndermek yerine loglar — ama bu doğru olduğu sürece **hiçbir davet kabul edilemez**. Gerçek
mail göndermeden akışı lokal olarak yerinde denemek için, `docker-compose.dev.yml`'in
`postgres` ve `redis`'in yanında zaten başlattığı `mailpit` servisini kullanın:

```bash
docker compose -f docker-compose.dev.yml up -d   # postgres + redis + mailpit
```

Sonra `.env`'inizde şunları set edin (zaten `.env.example`'ın önerdiği varsayılanlar, ama
Mailpit host/port'un ona açıkça yönlendirilmesini gerektirir):

```bash
SMTP_HOST=localhost
SMTP_PORT=1025
SMTP_SECURE=false
# SMTP_USER / SMTP_PASSWORD boş kalır — Mailpit auth gerektirmez
MAIL_FROM=Kurultay <noreply@example.com>
```

| URL                   | Ne                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------- |
| http://localhost:8025 | Mailpit web UI'ı — API'nin gönderdiği her mesaj gerçek bir inbox yerine buraya düşer  |
| localhost:1025        | Mailpit'in SMTP dinleyicisi — yukarıdaki `SMTP_HOST`/`SMTP_PORT`'un işaret ettiği yer |

Davet akışını uçtan uca test etmek için: uygulamadan bir davet gönderin, http://localhost:8025
adresini açın, en yeni mesaja tıklayın ve içindeki doğrulama linkini tarayıcınızda açın (veya
kopyalayın — Mailpit hem plain-text hem HTML kısımları render eder, link her ikisinde de aynı
şekilde çalışır). Davet edilenin hesabı artık doğrulanmıştır ve `accept-invitation` başarılı
olur. `docker compose -f docker-compose.dev.yml down -v`, Postgres/Redis volume'leriyle
birlikte Mailpit'in sakladığı mesajları da temizler.

## Çalışma modları

### Önerilen: geliştirme döngüsü (servisler Docker'da, uygulamalar host'ta)

Postgres ve Redis container'larda çalışır; `api` ve `web` host'ta hot reload ile çalışır. Bu
hızlı döngü — kod değişiklikleri arasında image rebuild gerekmez.

```bash
pnpm db:generate                                 # Prisma client'ı üret (zaten yapıldıysa atla)
docker compose -f docker-compose.dev.yml up -d   # yalnızca postgres + redis
pnpm db:migrate                                  # migration'ları uygula
pnpm dev                                         # api + web paralel, hot reload
```

| URL                          | Ne                            |
| ---------------------------- | ----------------------------- |
| http://localhost:3000        | Web uygulaması (Next.js)      |
| http://localhost:4000        | API (NestJS)                  |
| http://localhost:4000/health | Health check — 200 dönmelidir |

Container'ları `docker compose -f docker-compose.dev.yml down` ile durdurun (veritabanı
volume'unu da düşürüp temiz bir sayfadan başlamak için `-v` ekleyin).

### Docker'da tam stack

Her şey container'da, production'a en yakın hâl. Dockerfile'ları ve compose bağlantısını
doğrulamak için, veya Kurultay'ı geliştirmek değil sadece çalıştırmak istediğinizde kullanın.

```bash
docker compose up --build
```

|                                 | Geliştirme döngüsü | Tam Docker                                                       |
| ------------------------------- | ------------------ | ---------------------------------------------------------------- |
| Hot reload                      | Evet               | Hayır — rebuild gerekir                                          |
| Kod değişikliği sonrası başlama | saniyeler          | onlarca saniye                                                   |
| Production'a benzerlik          | Kısmen             | Evet                                                             |
| Kullanım amacı                  | Günlük geliştirme  | Image'ları doğrulama, release kontrolleri, uygulamayı çalıştırma |

## pnpm script'leri

Repository kökünden çalıştırın.

| Script           | Komut                 | Ne yapar                                                                                                                                                                                                                                                                                                |
| ---------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dev`            | `pnpm dev`            | `apps/api` ve `apps/web`'i hot reload ile paralel çalıştırır                                                                                                                                                                                                                                            |
| `build`          | `pnpm build`          | Her workspace paketini build eder                                                                                                                                                                                                                                                                       |
| `lint`           | `pnpm lint`           | Tüm paketlerde ESLint                                                                                                                                                                                                                                                                                   |
| `format`         | `pnpm format`         | Repo genelinde Prettier write                                                                                                                                                                                                                                                                           |
| `format:check`   | `pnpm format:check`   | Prettier check (CI kapısı)                                                                                                                                                                                                                                                                              |
| `typecheck`      | `pnpm typecheck`      | `@kurultay/shared-types` + `@kurultay/auth-access` build, ardından her workspace'te `tsc --noEmit`                                                                                                                                                                                                      |
| `test`           | `pnpm test`           | Tüm workspace paketlerinin test suite'lerini çalıştırır                                                                                                                                                                                                                                                 |
| `db:generate`    | `pnpm db:generate`    | `prisma generate`'i çalıştırır: Prisma client'ı şemadan (yeniden) üretir. Migration'lara veya veritabanına dokunmaz. Klonlama sonrasında ve başkasının yaptığı şema/migration değişikliklerini pull'ladıktan sonra gereklidir                                                                           |
| `db:migrate`     | `pnpm db:migrate`     | `prisma migrate deploy`'u çalıştırır: var olan, zaten commit edilmiş migration'ları uygular. Asla migration oluşturmaz ve client'ı asla yeniden üretmez — CI/production için güvenlidir. Bunu yalnızca yeni migration'ları pull'ladıktan sonra çalıştırdıysanız, ardından `pnpm db:generate` çalıştırın |
| `db:migrate:dev` | `pnpm db:migrate:dev` | `prisma migrate dev`'i çalıştırır: yerel şemanızı diff'ler, **yeni bir migration dosyası oluşturur**, uygular ve client'ı yeniden üretir. `schema.prisma`'yı düzenledikten sonra yerelde çalıştırmanız gereken komut budur — `db:migrate` tek başına onu oluşturmaz                                     |
| `db:seed`        | `pnpm db:seed`        | Demo veriyi yükler: bir workspace, bir board, varsayılan column'lar, birkaç task. Prisma 7 altında seed giriş noktası `prisma.config.ts` içinde deklare edilir — seeding hiçbir zaman otomatik değildir ve açıkça çağrılmalıdır                                                                         |
| `db:studio`      | `pnpm db:studio`      | http://localhost:5555 adresinde Prisma Studio'yu açar                                                                                                                                                                                                                                                   |

Tek bir workspace'i hedeflemek için pnpm'in filter flag'ini kullanın:

```bash
pnpm --filter @kurultay/api dev
pnpm --filter @kurultay/web build
pnpm --filter @kurultay/api test
```

## Veritabanı iş akışı

```bash
# 1. apps/api/prisma/schema.prisma dosyasını düzenle
# 2. Bir migration oluştur, uygula ve client'ı yeniden üret
pnpm db:migrate:dev
# 3. Demo veriyi yükle (boş board'lara karşı geliştirmek zor)
pnpm db:seed
# 4. Veriyi incele
pnpm db:studio
```

Migration'ı oluşturmak için `pnpm db:migrate` değil, `pnpm db:migrate:dev` kullanın —
`db:migrate` yalnızca zaten var olan migration'ları uygular (`prisma migrate deploy`) ve şema
değişikliğinizden bir tane oluşturmaz. `db:migrate:dev` ayrıca Prisma client'ı da yeniden
üretir, dolayısıyla burada ayrı bir `pnpm db:generate` adımına gerek yoktur.

Bunun yerine başkasının zaten commit ettiği migration'ları alıyorsanız (örn. `git pull`
sonrası), `pnpm db:migrate` ardından `pnpm db:generate` kullanın — `db:migrate` onları uygular
ama `db:migrate:dev`'in aksine client'ı yeniden üretmez.

Kurallar:

- Migration'lar **commit edilir**. Zaten commit edilmiş bir migration dosyasını asla
  düzenlemeyin — yeni bir tane yazın.
- Pratikte mümkün olduğunda, şema değişiklikleri onları kullanan logic'ten ayrı kendi
  PR'ında olur.
- `Task.position` ve `Column.position` `Float`'tır (fractional indexing) — özensizce değiştirilmemesi gereken
  model seviyesi kurallar için [project-skeleton.md](project-skeleton.md)'ye bakın.

Yerel bir veritabanını sıfırdan sıfırlamak:

```bash
docker compose -f docker-compose.dev.yml down -v
docker compose -f docker-compose.dev.yml up -d
pnpm db:migrate
pnpm db:seed
```

## Yükseltme ve yedekleme

Bu, önemsediği veriyle Kurultay çalıştıran herkes için geçerlidir, atılabilir yerel
veritabanları için değil. 1.0 öncesi, kırıcı şema değişiklikleri herhangi bir `0.y.0`
release'inde gelebilir ([git-strategy.md](git-strategy.md#versiyonlama-politikası-semver)),
dolayısıyla kural basit:

**Her yükseltmeden önce veritabanını dump'layın.**

```bash
docker compose exec -T postgres pg_dump -U kurultay kurultay > kurultay-$(date +%F).sql
```

- Önce hedef sürümün `CHANGELOG.md` girdisini okuyun — her kırıcı değişiklik orada bir
  migration notu taşır.
- Sonra image'ları yükseltin ve migration'ları çalıştırın.

**PostgreSQL major sürüm yükseltmeleri bir dump ve restore gerektirir.** Resmi `postgres`
imajı, `PGDATA` volume'ü farklı bir major sürüm tarafından initialize edildiğinde başlamayı
reddediyor ("database files are incompatible with server"); volume kendini migrate etmiyor.
Bir major'dan sonrakine geçmek için: eski image'da `pg_dump`, yeni major'ı boş bir volume'e
karşı başlatın, dump'ı `psql`/`pg_restore` edin. Minor yükseltmeler (18.4 → 18.5) yerinde
yapılır ve dump gerektirmez — yukarıdaki upgrade-öncesi yedek yine de sağlıklı bir alışkanlık.

**Redis yedeklenmez.** Cache, session'lar, rate-limit sayaçları, Socket.io pub/sub
fan-out'u ve bildirim kuyruğunu tutar — hepsi yeniden inşa edilebilir. Onu kaybetmek
herkesin oturumunu kapatır ve henüz teslim edilmemiş kuyruklanmış bildirimleri düşürür;
hiçbir board verisini kaybetmez. Redis yükseltmeleri bir major içinde, ve 7 → 8, yerinde
ve RDB/AOF uyumludur.

### İndeks migration'ları yazma kilidi alır

**`apps/api/prisma/migrations/` içindeki her indeks düz bir `CREATE INDEX` ile oluşturulur ve
bu, inşa boyunca tablo üzerinde bir `SHARE` kilidi tutar.** Okumalar sürer; **o tabloya
yazmalar indeks bitene kadar bloke olur.** Taze veya küçük bir veritabanında bu milisaniyeler
sürer ve görünmezdir. Büyük bir veritabanında ise inşa süresi kadar uzun bir yazma kesintisidir.

En kritik olan ikisi, `20260809190000_task_trgm_search_indexes` içindeki trigram GIN
indeksleridir: `Task_title_idx` ve `Task_description_idx`. Metin üzerindeki GIN inşaları var
olan en yavaş indeks inşaları arasındadır ve `Task`, şemadaki en hızlı büyüyen tablodur.

Bu bilinçli bir takas, bir gözden kaçırma değil. `CREATE INDEX CONCURRENTLY` bir transaction
bloğu içinde çalışamaz ve `prisma migrate deploy` her migration'ı bir transaction'a sarar —
yani onu kullanmak, Prisma'nın uygulayamayacağı migration'ları elle yazmak anlamına gelirdi;
karşılığında ise bu projenin fiilen deploy edildiği her veritabanında fark edilmeyen bir kilit
kazanılırdı. Prisma'nın bu durum için kendi önerisi de aşağıdaki manuel yoldur.

**Büyük bir `Task` tablosu olan (kabaca: birkaç yüz bin satırı geçmiş) bir kurulumu ya da
yazma duraklaması kaldıramayacak herhangi bir kurulumu yükseltmeden önce:**

1. Uygulamadan önce sürümdeki yeni migration'ları okuyun:
   `git diff <mevcut-tag>..<hedef-tag> -- apps/api/prisma/migrations`.
2. Biri büyük bir tabloda indeks oluşturuyorsa, eski sürüm hâlâ trafiğe hizmet ederken o
   ifadeyi `CONCURRENTLY` ile kendiniz uygulayın:

   ```bash
   docker compose exec -T postgres psql -U kurultay kurultay -c \
     'CREATE INDEX CONCURRENTLY IF NOT EXISTS "Task_title_idx" ON "Task" USING GIN ("title" gin_trgm_ops);'
   ```

   `CONCURRENTLY` yazmaları bloke etmez, ama bir transaction içinde çalışamaz ve kabaca iki
   kat uzun sürer. Başarısız olursa geride **geçersiz** bir indeks bırakır; yeniden denemeden
   önce bunun düşürülmesi gerekir (`DROP INDEX CONCURRENTLY "Task_title_idx";`) — kontrol
   için: `SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid;`.

3. Sonra her zamanki gibi `pnpm db:migrate` çalıştırın. Migration'ın kendi `CREATE INDEX`'i,
   aynı adla zaten var olan bir indekse karşı no-op'tur, dolayısıyla deploy hiç kilit almaz.

Bunu rutin olarak yapmayın — normal boyuttaki bir kurulum için tek başına 3. adım doğrudur ve
tüm prosedür boşa emektir. Bu, yalnızca varsayılanın canı yakacağı tek durum için, sürüm
notlarıyla tetiklenen bir kaçış kapısıdır.

Aynı migration'daki `CREATE EXTENSION IF NOT EXISTS pg_trgm` superuser veya
`pg_database_owner` yetkisi ister. Eklentileri kısıtlayan yönetilen bir Postgres'te,
migration çalışmadan önce `pg_trgm`'in sağlayıcı tarafından etkinleştirilmiş olması gerekir.

## Günlük döngü

```bash
# 1. Güncel bir develop'tan başla ve dallan
git switch develop && git pull
git switch -c feature/board-drag-and-drop

# 2. Servisleri ayağa kaldır (session başına bir kez)
docker compose -f docker-compose.dev.yml up -d
pnpm dev

# 3. Kod + test yaz

# 4. Push etmeden önce yerelde doğrula
pnpm lint
pnpm build
pnpm --filter @kurultay/api test

# 5. Conventional Commits formatında, İngilizce commit at
git commit -m "feat(web): add drag-and-drop to the kanban board"

# 6. Push et ve develop'a karşı bir PR aç
git push -u origin feature/board-drag-and-drop
```

CI, her PR'da aynı lint, typecheck ve test adımlarını çalıştırır — bunları önce yerelde
çalıştırmak sadece bir gidiş-dönüşten tasarruf ettirir. Branch adlandırma, commit formatı ve
PR/release süreci [git-strategy.md](git-strategy.md)'de belirtilmiştir.

## Sorun giderme

| Belirti                                                 | Sebep                                                             | Çözüm                                                                                                 |
| ------------------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `ECONNREFUSED 127.0.0.1:5432`                           | Postgres container'ı ayakta değil                                 | `docker compose -f docker-compose.dev.yml up -d`                                                      |
| `Environment variable not found: DATABASE_URL`          | `.env` eksik                                                      | `cp .env.example .env` ve doldur                                                                      |
| 3000/4000/5432 portu zaten kullanımda                   | Başka bir process veya eski bir container                         | `docker compose down`, veya `.env`'de portu değiştir                                                  |
| Pull sonrası Prisma tipleri güncel değil                | Client yeniden üretilmedi — `pnpm db:migrate` onu yeniden üretmez | `pnpm db:generate` (yeni migration'ları `pnpm db:migrate` ile uyguladıktan sonra)                     |
| Yeni üretilen client devreye girmiyor                   | Çalışan `pnpm dev` `dist`'teki eski client'ı tutar                | `pnpm db:generate` sonrası `pnpm dev`'i yeniden başlatın — asset'ler (yeniden) başlangıçta kopyalanır |
| `pnpm install` bir workspace hatasıyla başarısız oluyor | Bir alt-paket içinde çalıştırıldı                                 | Repository kökünden çalıştırın                                                                        |

## Ayrıca bakınız

- [project-skeleton.md](project-skeleton.md) — bu dokümanın kontratı olduğu yerleşim ve
  kabul kriterleri
- [roadmap.md](roadmap.md) — faz sırası
- [git-strategy.md](git-strategy.md) — branch'ler, commit'ler, release'ler
- [coding-standards.md](coding-standards.md) — bu uygulamaların içindeki kodun nasıl
  yazıldığı
- [testing.md](testing.md) — testlerin nasıl çalıştırılacağı ve yazılacağı
- [../CONTRIBUTING.md](../../CONTRIBUTING.md) — katkı süreci
