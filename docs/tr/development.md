# Geliştirme

Kurultay geliştirme ortamının nasıl kurulacağı ve günden güne nasıl çalışılacağı.

> 🌐 [English (canonical)](../development.md) | Türkçe — Bu çeviri güncel olmayabilir; kanonik kaynak İngilizce'dir.

## İçindekiler

- [Durum](#durum)
- [Ön koşullar](#ön-koşullar)
- [Klonlama ve kurulum](#klonlama-ve-kurulum)
- [Ortam değişkenleri](#ortam-değişkenleri)
- [Veritabanı ve cache kimlik bilgileri](#veritabanı-ve-cache-kimlik-bilgileri)
- [SMTP ve Mailpit](#smtp-ve-mailpit)
- [Çalışma modları](#çalışma-modları)
- [pnpm script'leri](#pnpm-scriptleri)
- [Veritabanı iş akışı](#veritabanı-iş-akışı)
- [Yükseltme ve yedekleme](#yükseltme-ve-yedekleme)
- [Geri alma (rollback)](#geri-alma-rollback)
- [Günlük döngü](#günlük-döngü)
- [Sorun giderme](#sorun-giderme)

## Durum

Monorepo ve MVP özellik seti (Faz 1–9; Faz 0 docs/standartlardı) repository’de **mevcuttur**. Bu sayfadaki komutlar
gündelik kontrattır — gerçeklik bu dokümandan sapıyorsa ikisinden biri buglıdır ve aynı
PR’da düzeltilir.

- Yerleşim, Prisma modelleri ve erken kabul kriterleri: [project-skeleton.md](project-skeleton.md)
- Faz ilerlemesi (MVP tamam): [roadmap.md](roadmap.md)
- Her aracın neden seçildiği: [tech-stack.md](tech-stack.md)

## Ön koşullar

| Araç           | Sürüm              | Kontrol                  | Notlar                                                                                                                                                                                                           |
| -------------- | ------------------ | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node.js        | **≥ 24** (engines) | `node -v`                | Kök `package.json` `"engines": { "node": ">=24" }`. Prisma 7 ≥ 20.19.0 ister; proje tabanı daha yüksek. Desteklenen çizgi **24 LTS**.                                                                            |
| pnpm           | 9 veya üzeri       | `pnpm -v`                | Corepack üzerinden: `corepack enable && corepack prepare pnpm@latest --activate`. Corepack, Node ≥ 25 ile artık birlikte gelmiyor — orada önce `npm i -g corepack`, ya da pnpm'i bağımsız kurun: `npm i -g pnpm` |
| Docker         | herhangi güncel    | `docker -v`              | macOS'ta Docker Desktop veya Colima                                                                                                                                                                              |
| Docker Compose | v2 (plugin)        | `docker compose version` | `docker-compose` v1 desteklenmiyor                                                                                                                                                                               |
| Git            | 2.30+              | `git --version`          |                                                                                                                                                                                                                  |

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
ve o dizinler de aynı sebeple git-ignore'ludur; dolayısıyla temiz bir klonda, paylaşılan bir
tipi import eden herhangi bir şey koşmadan önce bunların build edilmesi gerekir:

```bash
pnpm -r --filter @kurultay/shared-types --filter @kurultay/auth-access build
```

Bu adımı atlamak yardımcı bir hata üretmez. `pnpm test`, paylaşılan bir tipi import eden her
dosyada `Failed to resolve entry for package "@kurultay/shared-types"` ile düşer; `pnpm dev`,
`apps/api` içinde `TS2307: Cannot find module '@kurultay/shared-types'` ile düşer; `pnpm
db:seed` ise veritabanına hiç ulaşamadan `Cannot find module
'.../@kurultay/auth-access/dist/cjs/index.js'` ile ölür — hepsi eksik bir build'den çok bozuk
bir checkout gibi okunur. `pnpm build` ve `pnpm typecheck` bunu yan etki olarak zaten yapar;
`pnpm dev`, `pnpm db:seed`, `pnpm test` ve `pnpm lint` yapmaz. CI bunları hem lint hem test
job'ından önce açıkça build eder.

## Ortam değişkenleri

```bash
cp .env.example .env
```

Sonra boşlukları doldurun. `.env` git tarafından ignore edilir ve asla commit edilmemelidir.

| Değişken              | Örnek                                                               | Amaç                                                                                                                       |
| --------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`        | `postgresql://kurultay:<POSTGRES_PASSWORD>@localhost:5432/kurultay` | Prisma bağlantı string'i — şifre kısmı aşağıdaki `POSTGRES_PASSWORD` ile eşleşmelidir                                      |
| `REDIS_URL`           | `redis://localhost:6379`                                            | Socket.io Redis adapter'ı, caching, BullMQ due-soon worker (`due-soon` kuyruğu)                                            |
| `BETTER_AUTH_SECRET`  | _(üret)_                                                            | Session imzalama secret'ı — zorunlu, varsayılan yok                                                                        |
| `BETTER_AUTH_URL`     | `http://localhost:4000`                                             | API'nin public URL'i (Better Auth `/auth/*` altında monte edilir)                                                          |
| `API_PORT`            | `4000`                                                              | NestJS dinleme portu                                                                                                       |
| `WEB_URL`             | `http://localhost:3000`                                             | API için CORS origin'i                                                                                                     |
| `RATE_LIMIT_ENABLED`  | `true`                                                              | [Rate limiting](api-conventions.md#rate-limiting) ana anahtarı. Varsayılan açık; yalnızca entegrasyon testleri kapatır     |
| `NEXT_PUBLIC_API_URL` | `http://localhost:4000`                                             | Web bundle'ına derlenen API URL'i — **build sırasında gömülür** (Docker build'leri bunu build arg olarak geçirir)          |
| `SMTP_HOST`           | `localhost` (geliştirme, Mailpit üzerinden)                         | SMTP sunucu host'u. Tamamen boş bırakılırsa mail modülü göndermek yerine loglar — bkz. [SMTP ve Mailpit](#smtp-ve-mailpit) |
| `SMTP_PORT`           | `1025` (geliştirme, Mailpit üzerinden) / `587` (tipik production)   | SMTP sunucu portu                                                                                                          |
| `SMTP_USER`           | _(Mailpit için boş)_                                                | SMTP auth kullanıcı adı, sunucunuz gerektiriyorsa                                                                          |
| `SMTP_PASSWORD`       | _(Mailpit için boş)_                                                | SMTP auth şifresi, sunucunuz gerektiriyorsa                                                                                |
| `SMTP_SECURE`         | `false`                                                             | Örtük TLS için (port 465) `true`, STARTTLS/plaintext için (587/25, ve Mailpit) `false`                                     |
| `MAIL_FROM`           | `Kurultay <noreply@example.com>`                                    | Giden mail'lerdeki `From:` başlığı                                                                                         |

`.env.example` ayrıca `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `REDIS_PASSWORD`,
`BACKUP_INTERVAL` ve `BACKUP_KEEP` taşır. Altısı da **yalnızca compose'a aittir** —
`docker-compose.yml` bunları `postgres`/`redis`/`migrate`/`api`/`backup` servislerine
enterpolasyon eder ve hiçbir uygulama kodu doğrudan okumaz; bu yüzden yukarıdaki tabloda yer
almazlar ve `apps/api` tarafında bağlanmaları gerekmez. İlk dördü için bkz.
[Veritabanı ve cache kimlik bilgileri](#veritabanı-ve-cache-kimlik-bilgileri), yedekleme
çifti için bkz. [Yükseltme ve yedekleme](#yükseltme-ve-yedekleme).

Bir secret üretmek için:

```bash
openssl rand -base64 32
```

**Yeni bir ortam değişkeni eklemek üç adımlı bir değişikliktir** ve üçü de aynı PR'a girer:
`apps/api/src/common/env.ts` yardımcıları üzerinden bağla (veya `process.env` okuyan çağrı
noktası — bugün ayrı bir Zod/tipli env şeması yok), güvenli bir placeholder ile
`.env.example`'a ekle ve yukarıdaki tabloda belgele.

## Veritabanı ve cache kimlik bilgileri

Ne `docker-compose.yml` ne de `docker-compose.dev.yml` artık Postgres konteynerine bilinen bir
`kurultay`/`kurultay` şifresi gömüyor — `POSTGRES_PASSWORD` zorunlu bir `.env` değeridir ve
ayarlanmadan compose başlamayı reddeder:

```bash
$ docker compose config
error while interpolating services.migrate.environment.DATABASE_URL: required variable POSTGRES_PASSWORD is missing a value: set POSTGRES_PASSWORD in .env — see docs/development.md#database-and-cache-credentials
```

Bu, yukarıdaki `BETTER_AUTH_SECRET` ile aynı fail-loud kalıbıdır: bir placeholder varsayılan,
`.env.example`'ı dikkatlice okumayan her self-hosted kurulumun, Docker ağını paylaşan başka
her şeye açık bir veritabanında, diğer her Kurultay kurulumuyla aynı şifreyle ayağa kalkması
anlamına gelirdi.

**`POSTGRES_PASSWORD` ve `REDIS_PASSWORD`'ü, yukarıdaki `BETTER_AUTH_SECRET` için kullanılan
`-base64 32` yerine `openssl rand -hex 32` ile üretin.** Fark burada
`BETTER_AUTH_SECRET`'teki gibi önemsiz değil: bu iki değer doğrudan bir bağlantı URL'ine
gömülür (`DATABASE_URL`/`REDIS_URL`) ve percent-encode etmiyoruz, dolayısıyla `/ @ : # ? %`
karakterlerinden biri değere düşerse URL bozulur — en keskin durum `/`'dir, çünkü göründüğü
yerde authority bölümünü doğrudan sonlandırır:

```bash
$ node -e "new URL('postgresql://kurultay:ab/cd@postgres:5432/kurultay')"
TypeError: Invalid URL
    at new URL (node:internal/url:840:25)
  code: 'ERR_INVALID_URL'

$ openssl rand -hex 32
1b7c3785ecf7f7bd2ec4826214889d19ff17d518ce44126ab6f07393b39b98a   # yalnızca 0-9a-f, her zaman URL-güvenli
```

`-base64 32`'nin alfabesi `/` ve `+` içerir; parola başına 43 base64 karakteriyle, en az bir
`/` veya `+`'nin düşme olasılığı `1 - (63/64)^43 ≈ %51` — yeni üretilen bir parolanın kendi
bağlantı string'ini sessizce bozup bozmayacağı kabaca yazı tura. `openssl rand -hex 32`'de
kaçınılması gereken böyle bir karakter yok.

| Değişken            | Varsayılan      | Amaç                                                                                                                   |
| ------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `POSTGRES_USER`     | `kurultay`      | Compose'un ilk açılışta oluşturduğu ve her servisin bağlandığı Postgres rolü                                           |
| `POSTGRES_PASSWORD` | _yok — zorunlu_ | Postgres rol şifresi. Varsayılanı yok; ayarlanmazsa `docker compose config`/`up` sesli şekilde başarısız olur          |
| `POSTGRES_DB`       | `kurultay`      | Compose'un ilk açılışta oluşturduğu veritabanı adı                                                                     |
| `REDIS_PASSWORD`    | _(boş)_         | `redis` servisi için opsiyonel `requirepass`. Boş bırakılırsa Redis bu değişken var olmadan önceki gibi şifresiz kalır |

Bu dört değişken, `docker-compose.yml`'in kendi `migrate`/`api` servisleri için kurduğu
`DATABASE_URL`/`REDIS_URL`'i besler (`postgres:5432`/`redis:6379`, ağ içi adresler) — bu,
[dev loop](#çalışma-modları)'da `pnpm dev`'in `localhost:5432`/`localhost:6379`'a ulaşmak için
kullandığı `.env`'inizdeki host-side `DATABASE_URL`/`REDIS_URL`'den **ayrı** bir düğmedir.
Compose ikisini birbiriyle senkron tutmaz: `POSTGRES_PASSWORD` veya `REDIS_PASSWORD`'ü
değiştirirseniz, host-side `DATABASE_URL`/`REDIS_URL`'i de eşleştirin — yoksa host'ta çalışan
`api`/`web`, `docker-compose.dev.yml`'in başlattığı konteynerlere karşı authenticate olamaz.

`REDIS_PASSWORD`, `POSTGRES_PASSWORD`'ün sahip olduğu `:?`-zorunlu koruması olmadan
tasarlanmıştır — buradaki Redis cache girdileri, session'lar, rate-limit sayaçları ve
bildirim kuyruğunu tutar; hepsi yeniden inşa edilebilir, hiçbiri board verisi değildir (bkz.
["Redis yedeklenmez"](#yükseltme-ve-yedekleme)) — bu yüzden zorunlu kılmak, karşılığında
görece az bir kazanç için her mevcut `docker-compose.yml`'i yükseltmede bozardı. Boş
bırakmak önceki şifresiz davranışı korur; ayarlamak, aynı Docker ağına düşen başka bir
konteynere karşı savunma derinliği ekler.

**`POSTGRES_PASSWORD`'ü mevcut bir `postgres_data` volume'unda değiştirmek, çalışan
veritabanının şifresini döndürmez.** Resmi Postgres image'ı `POSTGRES_PASSWORD`'ü yalnızca
`initdb` sırasında, yani bir volume ilk oluşturulduğunda uygular — `.env`'i düzenleyip zaten
initialize edilmiş bir stack'i yeniden başlatmak, rolün şifresini tam olarak eskisi gibi
bırakır. Çalışan bir instance'ta şifreyi döndüren `ALTER USER ... PASSWORD` komutu için
`CHANGELOG.md`'deki `[Unreleased]` girdisine bakın.

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

Bu aynı zamanda veritabanını zamanlanmış olarak dump'layan `backup` sidecar'ını da başlatır —
bkz. [Yükseltme ve yedekleme](#yükseltme-ve-yedekleme). `docker-compose.dev.yml`'de böyle bir
servis yok: geliştirme döngüsünün veritabanı tasarım gereği atılabilir.

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
dolayısıyla iki kural var: zamanlanmış yedeğin çalışmasına izin verin ve **her yükseltmeden
hemen önce bir dump daha alın.**

### Zamanlanmış yedekleme sidecar'ı

`docker compose up`, `postgres`'in yanında bir `backup` servisi de başlatır.
[`scripts/backup.sh`](../../scripts/backup.sh)'i bir `postgres:18-alpine` container'ında
çalıştırır — sunucuyla aynı image, yani `pg_dump`/`pg_restore` her zaman sunucu major'ıyla
eşleşir — ve döngüye girer:

1. `pg_dump --format=custom` ile `backup_data` volume'üne
   `/backups/kurultay-<UTC timestamp>.dump` yazar (önce `.part` olarak yazılır, başarıda
   yeniden adlandırılır; yarıda kesilen bir dump asla tamamlanmış bir arşiv gibi görünmez),
2. en yeni `BACKUP_KEEP` arşivinden eskisini siler,
3. `BACKUP_INTERVAL` saniye uyur, tekrarlar.

Varsayılanlar — günde bir dump, yedi tanesi saklanır — **en fazla 24 saatlik bir kurtarma
noktası (RPO ≤ 24 sa) ve bir haftalık geçmiş** demektir; host'ta cron yok, hatırlanacak bir
şey yok. Servis `restart: unless-stopped`: yeniden başlatmadan sonra ayağa kalkmayan bir
yedekleme sidecar'ı sessizce kurtarma noktası üretmeyi bırakır ki bu bölümün var olma sebebi
tam olarak bu hatadır. `docker-compose.dev.yml`'de bilinçli olarak **yok** — `pnpm db:seed`'in
istendiğinde sildiği yerel bir veritabanında saklanmaya değer bir şey yoktur.

İki ayar, ikisi de compose tarafından `.env`'den okunur (yalnızca compose'a aittir — hiçbir
uygulama kodu okumaz, dolayısıyla API'nin yüklediği [ortam
değişkenlerinin](#ortam-değişkenleri) parçası değildirler):

| Değişken          | Varsayılan | Amaç                                                                      |
| ----------------- | ---------- | ------------------------------------------------------------------------- |
| `BACKUP_INTERVAL` | `86400`    | Dump'lar arası saniye. `86400` = günlük; bu **doğrudan** sizin RPO'nuzdur |
| `BACKUP_KEEP`     | `7`        | Saklanan arşiv sayısı; her yeni dump'tan sonra daha eskileri silinir      |

Kontrol edin — test edilmemiş bir yedek yedek değildir, okunmamış bir log da öyle:

```bash
docker compose logs backup | tail            # "wrote /backups/kurultay-….dump (… bytes)"
docker compose exec backup ls -lh /backups   # en yeni arşiv ve kaç tanesi saklanıyor
```

**Arşivleri host dışına kopyalayın.** `backup_data`, `postgres_data` ile aynı diskte durur;
yani "yanlış tabloyu düşürdüm"ü kapsar, ölen bir diski veya kaybolan bir sunucuyu hiç
kapsamaz — volume'ü düzenli olarak başka bir yere aynalayın
(`docker compose exec -T backup cat /backups/<arşiv>` üzerinden ya da doğrudan volume'ün host
yolundan `rsync`/`rclone`), yoksa felaket senaryosu yine her şeyi kaybettirir.

### Elle dump almak

Bir yükseltmeden önce ya da kurtarma noktasını `BACKUP_INTERVAL` sonra değil şimdi istediğiniz
her an, aynı script'i bir kez çalıştırın — aynı volume'e yazar ve aynı kurala göre budar:

```bash
docker compose exec backup /bin/sh /usr/local/bin/backup.sh once
```

Volume dışında bir kopya tutmak için (yükseltme öncesi önerilir, çünkü
`docker compose down -v`'den sağ çıkar):

```bash
docker compose exec -T postgres \
  pg_dump -U kurultay --format=custom kurultay > kurultay-$(date -u +%Y%m%dT%H%M%SZ).dump
```

- Önce hedef sürümün `CHANGELOG.md` girdisini okuyun — her kırıcı değişiklik orada bir
  migration notu taşır.
- Sonra image'ları yükseltin ve migration'ları çalıştırın.
- Yükseltme ters giderse, bkz. [Geri alma (rollback)](#geri-alma-rollback).

### Yedekten geri dönme

**Hedef: restore kararından itibaren iki saatin altında ayakta olmak (RTO ≤ 2 sa).**
Aşağıdaki prosedür küçük bir kurulumda saniyeler sürer; bütçe karar vermek, doğru arşivi
bulmak ve doğrulamak içindir. Uçtan uca prova edilmiştir — `scripts/backup.sh` ile
dump'lanan seed'li bir veritabanı boş bir sunucuya restore edildiğinde 17 tablonun tamamını,
her satır sayısını, 59 indeksin hepsini, `pg_trgm`'i ve `_prisma_migrations` tablosunu
eksiksiz üretti.

Restore `pg_restore` iledir (arşivler SQL metni değil `--format=custom`) ve **boş** bir
veritabanı ister — dolu bir veritabanının üzerine restore etmek temiz bir üzerine yazma
değil, duplicate-key hataları üretir.

```bash
# 1. Yazan her şeyi durdurun — yarı restore edilmiş veritabanını dump'layıp iyi bir arşivi
#    rotasyonla düşürmesin diye yedekleme sidecar'ı dahil. Postgres'in kendisi ayakta kalır.
docker compose stop web api backup

# 2. Restore edilecek arşivi seçin. Sidecar durduğu için `run --rm`; tek kullanımlık
#    container aynı backup_data volume'ünü mount eder.
docker compose run --rm --entrypoint ls backup -1 /backups

# 3. Veritabanını boş olarak yeniden oluşturun. Yıkıcı adım budur — arşiv alındıktan sonra
#    yazılan her şey buradan itibaren gitmiştir.
docker compose exec -T postgres psql -U kurultay -d postgres \
  -c 'DROP DATABASE kurultay WITH (FORCE);' \
  -c 'CREATE DATABASE kurultay OWNER kurultay;'

# 4. Restore edin. --exit-on-error, kısmi bir restore'u iyi görünen yarı dolu bir veritabanı
#    yerine gürültülü bir hataya çevirir.
docker compose run --rm --entrypoint pg_restore backup \
  --host=postgres --username=kurultay --dbname=kurultay \
  --no-owner --exit-on-error /backups/kurultay-<timestamp>.dump

# 5. Migration durumunu kontrol edin. Arşiv _prisma_migrations'ı taşıdığı için kayıtlı durum
#    restore edilen şemayla eşleşir ve bunun yapacak bir şey bulmaması beklenir.
docker compose run --rm migrate

# 6. Trafiği geri almadan önce doğrulayın.
docker compose exec -T postgres psql -U kurultay -d kurultay \
  -c '\dt' \
  -c 'SELECT count(*) FROM "User";' \
  -c 'SELECT count(*) FROM "Workspace";' \
  -c 'SELECT count(*) FROM "Task";' \
  -c 'SELECT count(*) FROM "_prisma_migrations";'

# 7. Stack'i geri getirin.
docker compose up -d
```

Checkout edilmiş kod arşivin şemasından yeniyse, 5. adım eksik migration'ları ileri doğru
uygular; bu doğrudur. **Eskiyse**, 5. adımdan önce arşive karşılık gelen release tag'ine
geçin — bkz. [Geri alma (rollback)](#geri-alma-rollback).

Volume'dekinin yerine host tarafındaki bir dosyadan restore (4. adımın varyantı):

```bash
docker compose run --rm -T --entrypoint pg_restore backup \
  --host=postgres --username=kurultay --dbname=kurultay --no-owner \
  --exit-on-error < kurultay-20260813T194856Z.dump
```

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

## Geri alma (rollback)

Bir yükseltme veya release ters gittiğinde ve bilinen son sağlam sürümün geri gelmesi
gerektiğinde ne yapmalı. Geri alınması gerekebilecek iki farklı şey vardır ve bunlar
birbirinden bağımsız hareket eder: **uygulama** (container'ların çalıştırdığı kod) ve
**veritabanı şeması** (uygulanmış Prisma migration'ları). Uygulamayı geri almak ucuz ve
hızlıdır; bir migration'ı geri almak değildir — migration kısmını, gece 2'de ihtiyacınız
olmadan önce okuyun.

### Uygulamayı geri almak

Yayınlanmış registry image'ları yok — `docker compose up`, `api` ve `web`'i checkout edilmiş
kaynak ağacından build eder (bkz. `docker-compose.yml`). Dolayısıyla uygulamayı geri almak,
bir önceki release tag'ini checkout edip image'ları yeniden build etmek demektir:

```bash
git fetch --tags
git switch --detach v0.1.0        # bilinen son sağlam tag — `git tag -l` ile listeleyin
docker compose up -d --build      # api + web'i o ağaçtan yeniden build et ve yeniden başlat
```

One-shot `migrate` servisi her `up`'ta çalışır, ama yalnızca checkout edilmiş ağaçta var olan
migration'ları **uygular** (`prisma migrate deploy`) — veritabanında olup ağaçta olmayan
migration'ları asla geri çevirmez. Yani bir kod geri almasından sonra veritabanı yeni şemayı
korur. Kötü release'in migration'ları tamamen ekleyiciyse (yeni tablolar, yeni nullable
kolonlar, yeni indeksler), eski kod o şemaya karşı sorunsuz çalışır ve kod geri alması tek
başına tüm prosedürdür. Kötü release, eski kodun okuduğu bir şeyi yeniden adlandırdıysa veya
düşürdüyse, yalnızca kodu geri almak açılışta çöker — bu, aşağıdaki migration geri alma
durumudur.

### Bir migration'ı geri almak

**Prisma down migration üretmez.** `apps/api/prisma/migrations/` altındaki her dizin yalnızca
ileri yönlü bir `migration.sql` içerir; bir `migrate down` komutu ve otomatik bir geri alma
yolu yoktur. Seçenekler, tercih sırasıyla:

1. **Forward-fix (tercih edilen).** Kötü değişikliği geri alan veya onaran **yeni** bir
   migration yazın — kötü kolonu düşürün, eski adı geri getirin, veriyi backfill edin —
   yerelde `pnpm db:migrate:dev` ile oluşturun ve her zamanki gibi ileri doğru deploy edin.
   Tarih doğrusal kalır, kötü migration'ın kendisinin yok ettiği dışında hiçbir veri atılmaz
   ve commit edilmiş hiçbir migration dosyası asla düzenlenmez. Aşağıdaki hotfix akışıyla
   yayınlayın.
2. **Yedekten restore.** `backup` sidecar'ı size en fazla `BACKUP_INTERVAL` eskilikte
   (varsayılan 24 saat) bir arşiv verir ve [yukarıdaki bölüm](#yükseltme-ve-yedekleme) her
   yükseltmeden hemen önce bir tane daha alın der — burada isteyeceğiniz, o taze arşivdir.
   Arşiv alındıktan sonra yazılan her şey **kalıcı olarak kaybolur**: kurtarma noktası
   `pg_dump`'ın çalıştığı andır, dolayısıyla canlı bir kurulumda bu, şema karşılığında
   kullanıcı verisi takas eder. Kötü migration'ın kendisi, arşivde hâlâ bulunan veriyi yok
   ettiyse (bir kolon veya tablo düşürdüyse) kullanın.

   [Yedekten geri dönme](#yedekten-geri-dönme) adımlarını eksiksiz uygulayın; tek eklemeyle —
   stack'i geri getirmeden önce arşive karşılık gelen release tag'ine geçin ki kod ve şema
   uyuşsun:

   ```bash
   git switch --detach v0.1.0         # arşive karşılık gelen release
   docker compose up -d --build
   ```

   Arşiv, `_prisma_migrations` defter tablosunu da içerir; dolayısıyla restore'dan sonra
   kayıtlı migration durumu restore edilen şemayla eşleşir ve eski release'in `migrate`
   servisi uygulayacak bir şey bulmaz.

3. **`prisma migrate resolve` — işaretleme, geri çevirme değil.** `resolve` yalnızca
   `_prisma_migrations` defter tablosunu düzenler; hiçbir şemayı değiştirmez ve hiçbir veriyi
   geri getirmez. Senaryosu, **yarı yolda başarısız olmuş** ve artık her `migrate deploy`'u
   bloke eden bir migration'dır: veritabanını elle onarın (veya restore edin), sonra —
   `apps/api` içinden — ya `pnpm exec prisma migrate resolve --rolled-back <migration_adı>`
   (bir sonraki deploy onu yeniden dener) ya da `--applied <migration_adı>` (bir sonraki
   deploy onu atlar). Başarıyla tamamlanmış bir migration'ı "geri almak" için ona uzanmak
   şemaya hiçbir şey yapmaz — bu yanlış kullanım yalnızca defterin yalan söylemesine yol açar.

### Production'da asla `migrate reset`

`prisma migrate reset` tüm veritabanını düşürür ve yeniden oluşturur. Atılabilir yerel veriler
için bir geliştirme döngüsü kolaylığıdır, asla bir rollback aracı değildir — ve production'ı
işaret etmesini engelleyen tek şey shell'inizdeki `DATABASE_URL`'dir. Seed de aynı biçimde bir
tehlikedir: `pnpm db:seed`, demo veriyi eklemeden önce **her tablodaki her satırı** silerek
başlar; bu yüzden [`apps/api/prisma/seed.ts`](../../apps/api/prisma/seed.ts), `NODE_ENV`
`production` iken çalışmayı reddeder
([`apps/api/src/common/seed-guard.ts`](../../apps/api/src/common/seed-guard.ts)) — bilinçli
olarak hiçbir override flag'i yoktur. `migrate reset`'in böyle bir koruması yoktur. Gece
2'deki kural mutlaktır: bu iki komuttan hiçbiri, bir dump'tan yeniden oluşturmayı göze
alamayacağınız bir veritabanına karşı asla çalışmaz.

### Rollback ve hotfix akışı

Rollback zaman kazandırır; çözümün kendisi değildir. Kalıcı çözüm, `main`'den açılan bir
`hotfix/*` branch'i olarak yayınlanır — [git-strategy.md](git-strategy.md#hotfix-süreci):
branch aç, düzelt (yukarıdaki 1. seçenekteki forward-fix migration dahil), patch sürümünü
yükselt, `main`'e PR aç, tag'le, `develop`'a back-merge et, sonra production'ı yeni tag'e
yükselt — rollback'i bitiren şey de budur. Kötü release `v0.2.0` idiyse ve production
`v0.1.0`'da park hâlindeyse, hotfix `v0.2.1` olarak yayınlanır; eski tag'de, onu yayınlamanın
alacağı süreden daha uzun park hâlinde kalmayın.

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
