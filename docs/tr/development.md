# Geliştirme

Kurultay geliştirme ortamının nasıl kurulacağı ve günden güne nasıl çalışılacağı.

> 🌐 [English (canonical)](../development.md) | Türkçe — Bu çeviri güncel olmayabilir; kanonik kaynak İngilizce'dir.

## İçindekiler

- [Durum](#durum)
- [Ön koşullar](#ön-koşullar)
- [Klonlama ve kurulum](#klonlama-ve-kurulum)
- [Ortam değişkenleri](#ortam-değişkenleri)
- [Veritabanı ve cache kimlik bilgileri](#veritabanı-ve-cache-kimlik-bilgileri)
- [Veritabanı bağlantı havuzu](#veritabanı-bağlantı-havuzu)
- [SMTP ve Mailpit](#smtp-ve-mailpit)
- [Çalışma modları](#çalışma-modları)
- [Container sertleştirme](#container-sertleştirme)
- [pnpm script'leri](#pnpm-scriptleri)
- [Veritabanı iş akışı](#veritabanı-iş-akışı)
- [Veri saklama](#veri-saklama)
- [Aktivasyon hunisi ve telemetri](#aktivasyon-hunisi-ve-telemetri)
- [Yükseltme ve yedekleme](#yükseltme-ve-yedekleme)
- [Geri alma (rollback)](#geri-alma-rollback)
- [Gözlemlenebilirlik](#gözlemlenebilirlik)
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

| Değişken                              | Örnek                                                               | Amaç                                                                                                                                                                                                                                               |
| ------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                        | `postgresql://kurultay:<POSTGRES_PASSWORD>@localhost:5432/kurultay` | Prisma bağlantı string'i — şifre kısmı aşağıdaki `POSTGRES_PASSWORD` ile eşleşmelidir                                                                                                                                                              |
| `REDIS_URL`                           | `redis://localhost:6379`                                            | Socket.io Redis adapter'ı, caching, BullMQ zamanlanmış işler (`due-soon` ve `cleanup` kuyrukları)                                                                                                                                                  |
| `BETTER_AUTH_SECRET`                  | _(üret)_                                                            | Session imzalama secret'ı — zorunlu, varsayılan yok                                                                                                                                                                                                |
| `BETTER_AUTH_URL`                     | `http://localhost:4000`                                             | API'nin public URL'i (Better Auth `/auth/*` altında monte edilir)                                                                                                                                                                                  |
| `API_PORT`                            | `4000`                                                              | NestJS dinleme portu                                                                                                                                                                                                                               |
| `WEB_URL`                             | `http://localhost:3000`                                             | API için CORS origin'i                                                                                                                                                                                                                             |
| `RATE_LIMIT_ENABLED`                  | `true`                                                              | [Rate limiting](api-conventions.md#rate-limiting) ana anahtarı. Varsayılan açık; yalnızca entegrasyon testleri kapatır                                                                                                                             |
| `TRUST_PROXY`                         | `false`                                                             | Gerçek client IP'si için güvenilecek reverse proxy hop'(lar)ı — `false` (varsayılan), hop sayısı (`1`) veya IP/CIDR listesi. Bkz. [rate limiting](api-conventions.md#rate-limiting) — doğrudan expose edilen bir kurulumda **asla `true` olmasın** |
| `NEXT_PUBLIC_API_URL`                 | `http://localhost:4000`                                             | Web bundle'ına derlenen API URL'i — **build sırasında gömülür** (Docker build'leri bunu build arg olarak geçirir)                                                                                                                                  |
| `SMTP_HOST`                           | `localhost` (geliştirme, Mailpit üzerinden)                         | SMTP sunucu host'u. Tamamen boş bırakılırsa mail modülü göndermek yerine loglar — bkz. [SMTP ve Mailpit](#smtp-ve-mailpit)                                                                                                                         |
| `SMTP_PORT`                           | `1025` (geliştirme, Mailpit üzerinden) / `587` (tipik production)   | SMTP sunucu portu                                                                                                                                                                                                                                  |
| `SMTP_USER`                           | _(Mailpit için boş)_                                                | SMTP auth kullanıcı adı, sunucunuz gerektiriyorsa                                                                                                                                                                                                  |
| `SMTP_PASSWORD`                       | _(Mailpit için boş)_                                                | SMTP auth şifresi, sunucunuz gerektiriyorsa                                                                                                                                                                                                        |
| `SMTP_SECURE`                         | `false`                                                             | Örtük TLS için (port 465) `true`, STARTTLS/plaintext için (587/25, ve Mailpit) `false`                                                                                                                                                             |
| `MAIL_FROM`                           | `Kurultay <noreply@example.com>`                                    | Giden mail'lerdeki `From:` başlığı                                                                                                                                                                                                                 |
| `CLEANUP_ENABLED`                     | `true`                                                              | Gecelik [veri saklama süpürmesi](#veri-saklama) ana anahtarı. Kapalıysa instance kendi saklama politikasını uygulamayı bırakır                                                                                                                     |
| `NOTIFICATION_RETENTION_DAYS`         | `90`                                                                | Bir bildirimin **okunduktan sonra** saklandığı gün sayısı. Okunmamış bildirimler hangi yaşta olursa olsun silinmez. `0` = sonsuza dek                                                                                                              |
| `ACTIVITY_RETENTION_DAYS`             | `365`                                                               | Bir aktivite satırının yazıldıktan sonra saklandığı gün sayısı. `0` = sonsuza dek — yasal denetim izi yükümlülüğünüz varsa bunu kullanın                                                                                                           |
| `DATABASE_POOL_MAX`                   | `20`                                                                | Paylaşılan `pg` havuzunun Postgres'e açtığı azami eşzamanlı bağlantı sayısı — bkz. [Veritabanı bağlantı havuzu](#veritabanı-bağlantı-havuzu)                                                                                                       |
| `DATABASE_POOL_CONNECTION_TIMEOUT_MS` | `10000`                                                             | Tüm `DATABASE_POOL_MAX` bağlantılar meşgulken bir isteğin havuzdan bağlantı için ne kadar bekleyeceği — bkz. [Veritabanı bağlantı havuzu](#veritabanı-bağlantı-havuzu)                                                                             |
| `DATABASE_STATEMENT_TIMEOUT_MS`       | `30000`                                                             | Postgres'in tek bir SQL ifadesini öldürmeden önce ne kadar çalışmasına izin vereceği — bkz. [Veritabanı bağlantı havuzu](#veritabanı-bağlantı-havuzu)                                                                                              |
| `SENTRY_DSN`                          | _(boş)_                                                             | API hata takibi. **Boş = kapalı, ve kapalı SDK'nın hiç yüklenmemesi demektir** — bkz. [Gözlemlenebilirlik](#gözlemlenebilirlik)                                                                                                                    |
| `SENTRY_ENVIRONMENT`                  | _(boş)_ / `production`                                              | API event'lerindeki ortam etiketi; boşsa `NODE_ENV`'e düşer. Staging ve production aynı imajı çalıştırıyorsa açıkça ayarlayın                                                                                                                      |
| `SENTRY_RELEASE`                      | _(boş)_ / `v0.2.0`                                                  | API event'lerindeki sürüm etiketi; en iyisi dağıtılan tag. Boşsa hiç gönderilmez                                                                                                                                                                   |
| `NEXT_PUBLIC_SENTRY_DSN`              | _(boş)_                                                             | Web hata takibi, aynı opt-in kuralı — **build sırasında gömülür**, değiştirdikten sonra web imajını yeniden build edin                                                                                                                             |
| `NEXT_PUBLIC_SENTRY_ENVIRONMENT`      | _(boş)_ / `production`                                              | `SENTRY_ENVIRONMENT`'ın web karşılığı, o da build zamanlı                                                                                                                                                                                          |
| `NEXT_PUBLIC_SENTRY_RELEASE`          | _(boş)_ / `v0.2.0`                                                  | `SENTRY_RELEASE`'in web karşılığı, o da build zamanlı                                                                                                                                                                                              |
| `SEED_LARGE_BOARD_TASKS`              | _(boş)_ / `1000`                                                    | Yalnızca `pnpm db:seed` okur. Demo board'un yanına bu kadar task taşıyan sentetik bir board ekler. Boş ya da `0` atlar — bkz. [Büyük board seed'lemek](#büyük-board-seedlemek)                                                                     |
| `INSTANCE_ADMIN_EMAILS`               | _(boş)_                                                             | Kurulum genelindeki [aktivasyon hunisini](#aktivasyon-hunisi-ve-telemetri) okumasına izin verilen, virgülle ayrılmış adresler. **Boş, hiç kimse demektir** — makinedeki her workspace'in sahibi olan hesap dahil                                   |
| `TELEMETRY_ENABLED`                   | `false`                                                             | Dışa telemetri. **Varsayılan kapalı; bu `false` iken hiçbir şey gönderilmez** — bkz. [Aktivasyon hunisi ve telemetri](#aktivasyon-hunisi-ve-telemetri)                                                                                             |
| `TELEMETRY_ENDPOINT`                  | _(boş)_                                                             | Opt-in ping'in POST edileceği adres. **Varsayılanı yok**; `TELEMETRY_ENABLED=true` iken bu boşsa hata loglanır ve hiçbir şey gönderilmez                                                                                                           |
| `TELEMETRY_TIMEOUT_MS`                | `5000`                                                              | Açılıştaki tek ping'in terk edilmeden önce sürebileceği süre. Başarısızlık tek bir uyarı satırıdır, başka hiçbir şey değil                                                                                                                         |

`SENTRY_AUTH_TOKEN`, `SENTRY_ORG` ve `SENTRY_PROJECT` yalnızca `next build` tarafından, source
map yüklenirken ve yalnızca ayarlanmışlarsa okunur; bunlar olmadan build sessizce başarılı
olduğu için `.env.example`'da yer almazlar. Bkz.
[Gözlemlenebilirlik](#gözlemlenebilirlik).

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

## Veritabanı bağlantı havuzu

`apps/api/src/prisma/database.ts` process genelinde tek bir `pg` `Pool` açar ve bunu
`PrismaService` ile Better Auth (`apps/api/src/auth/auth.ts`) arasında paylaştırır — neden ayrı
ayrı değil de paylaşmaları gerektiği için modülün kendisine bakın. Üç ortam değişkeni bunu
şekillendirir; üçü de opsiyoneldir ve varsayılanları normal trafiğin asla tetiklemeyeceği kadar
cömert seçilmiştir:

| Değişken                              | Varsayılan | Amaç                                                                                   |
| ------------------------------------- | ---------- | -------------------------------------------------------------------------------------- |
| `DATABASE_POOL_MAX`                   | `20`       | Bu instance'ın Postgres'e açtığı azami eşzamanlı bağlantı sayısı                       |
| `DATABASE_POOL_CONNECTION_TIMEOUT_MS` | `10000`    | Tüm `DATABASE_POOL_MAX` bağlantılar meşgulken bir isteğin bağlantı için beklediği süre |
| `DATABASE_STATEMENT_TIMEOUT_MS`       | `30000`    | Postgres'in tek bir SQL ifadesini öldürmeden önce ne kadar çalışmasına izin verdiği    |

`DATABASE_POOL_CONNECTION_TIMEOUT_MS` var olmadan önce, havuz zaten `DATABASE_POOL_MAX`
bağlantıda dolu haldeyken gelen bir istek sınırsız kuyrukta bekliyordu — `pg`'nin kendi
varsayılanı burada `0`'dır, yani sonsuza dek bekle. Sürekli yük altında bu, havuz doygunluğunu
net, loglanmış bir hata yerine hiç sonuçlanmayan isteklere dönüştürüyordu.
`DATABASE_STATEMENT_TIMEOUT_MS` sorgu tarafındaki eşdeğer boşluğu kapatır: bu olmadan, kaçak
bir ifade (eksik bir index'e çarpan büyük bir tarama, patolojik bir filtre) bir bağlantıyı — ve
`DATABASE_POOL_MAX` slotlarından birini — süresiz tutar.

`DATABASE_STATEMENT_TIMEOUT_MS`, bu havuzun açtığı **her bağlantıya**, bir Postgres başlangıç
parametresi olarak uygulanır (`pg`'nin kendi handshake'i, bu kod tabanının gönderdiği bir sorgu
değil) — dolayısıyla yalnızca `getSharedPool()` üzerinden geçen trafiğe ulaşır:

- `prisma migrate deploy` / `prisma migrate dev` etkilenmez — migration'lar Prisma'nın kendi
  engine sürecinden, `DATABASE_URL`'e doğrudan bağlanarak çalışır, bu havuz üzerinden asla.
- `pnpm db:seed` (`apps/api/prisma/seed.ts`) kendi toplu silme/ekleme işlemleri için
  etkilenmez — bunlar için ayrı bir `Pool` açar. Seed'in paylaşılan havuzu geçen tek kısmı,
  Better Auth çağrılarıdır (`signUpEmail`, `createOrganization`); bunlar da 30 saniyelik
  varsayılana hiç yaklaşmayan sıradan, hafif sorgulardır.

Bir instance spike'lar dışında normal yük altında da sürekli kuyruğa giriyorsa,
`DATABASE_POOL_MAX`'ı Postgres'in kendi `max_connections`'ıyla birlikte artırın; sınırsız bir
havuz bunu düzeltmez, sadece tükenmeyi bu uygulamadan veritabanını paylaşan başka bir şeye
taşır.

## SMTP ve Mailpit

Kurultay bugün tek bir akış için e-posta gönderiyor: `accept-invitation`'ın bir davet
edilenin workspace'e katılmasına izin vermeden önce ihtiyaç duyduğu doğrulama linki (bkz.
[`decisions/0013-invitation-email-verification.md`](decisions/0013-invitation-email-verification.md)).
`SMTP_HOST`'u boş bırakmak geçerli bir seçenek — API yine ayağa kalkar ve mail modülü mesajı
göndermek yerine loglar — ama bu doğru olduğu sürece **hiçbir davet kabul edilemez**.

Bu durum yalnızca burada değil, üründe de görünür. `GET /config`
`{ "mailEnabled": false }` döner ve web uygulaması bunu **Ayarlar → Üyeler** ekranında,
davetlerin teslim edilmeyeceğini söyleyen ve bu bölüme link veren kalıcı bir uyarıya çevirir.
`POST /workspaces/:workspaceId/invitations` ayrıca az önce oluşturduğu davet için
`"emailDelivery": "NOT_CONFIGURED"` bildirir; böylece admin bunu, hiçbir e-posta almamış bir
takım arkadaşından değil, daveti gönderdiği anda öğrenir. İkisi de mail modülünün gerçekten
seçtiği transport'tan türer — bkz.
[api-conventions.md](api-conventions.md#instance-yapılandırması). SMTP'siz geçiş yolu her
bekleyen davetin üzerindeki **Bağlantıyı kopyala** kontrolüdür: davet edilenin adresi zaten
doğrulanmışsa kabul bağlantısı çalışır.

Gerçek mail göndermeden akışı lokal olarak yerinde denemek için, `docker-compose.dev.yml`'in
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
docker compose pull && docker compose up -d
```

`docker-compose.yml`'de `api` ve `web`, hem `image:` hem `build:` bildirir. Her etiketli
release ikisini de GHCR'a yayınlar (`.github/workflows/release-images.yml`, `linux/amd64` +
`linux/arm64`), böylece `pull` hazır build edilmiş imajı çeker, ardından gelen `up -d` de
onu başlatır — lokal build yok, `pnpm install` yok, Docker layer cache ısıtması yok. Belirli
bir release'i `latest` yerine sabitlemek için `.env`'de `TAG` ayarlayın:

```bash
TAG=v0.2.0   # release-images.yml'in yayınladığı bir tag ile eşleşmeli; liste için `git tag -l`
```

Compose'un varsayılan pull politikası bir servisi yalnızca `image:` tag'i lokalde veya
registry'de çözülemediğinde build eder, dolayısıyla `pull` adımını atlarsanız da hiçbir şey
bozulmaz: `docker compose up -d` tek başına da önce registry'yi dener ve `TAG`'iniz için henüz
yayınlanmış bir imaj yoksa (release öncesi, veya hiç yayınlanmamış bir `TAG`) ya da
`ghcr.io`'ya ağ erişimi yoksa otomatik olarak `build:`'e döner — bu repo'nun her zaman yaptığı
aynı kaynak build'i. `docker compose up --build` (veya `up -d --build`) bilinçli olarak build
etmek için (örn. bir Dockerfile'ı düzenledikten sonra veya `api`/`web`'de yayınlanmamış bir
değişikliği test ederken) değişmeden çalışmaya devam eder.

Tek istisna `migrate`: `image:` eşleniği yok (neden olmadığı `docker-compose.yml`'de yanındaki
yorumda açıklanıyor), dolayısıyla her zaman kaynaktan build eder — `api`/`web`'i GHCR'dan
çeken bir `docker compose up -d` bile bu tek servisin build maliyetini bir kez öder. Kapsam
gerekçesinin tamamı için bkz.
[denetim bulgusu OPS-04](https://github.com/dravcore/kurultay/issues/126).

Web imajı, Dockerfile'ının varsayılan `NEXT_PUBLIC_API_URL`'i (`http://localhost:4000`) ve
boş Sentry DSN'leriyle yayınlanır, çünkü Next.js `NEXT_PUBLIC_*` değerlerini build zamanında
client bundle'a gömer — yayınlanmış bir imaj, `api`'nin `DATABASE_URL`'i gibi bunları
container başlangıcında alamaz. Deploy'unuz farklı bir `NEXT_PUBLIC_API_URL` gerektiriyorsa
(API'ye tarayıcıdan `localhost:4000` dışında bir adresten erişiliyorsa), `web`'i çekmek yerine
lokal build edin:

```bash
docker compose build web   # NEXT_PUBLIC_API_URL / NEXT_PUBLIC_SENTRY_*'i .env'den gömer
docker compose up -d
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

## Container sertleştirme

Her iki compose dosyasındaki her servis, dosyaların başındaki `x-hardened` YAML anchor'ı
üzerinden tüm Linux capability set'i düşürülmüş (`cap_drop: [ALL]`) ve
`no-new-privileges:true` ayarlanmış olarak çalışır. Bir container'ın varsayılan capability
seti — `CAP_NET_RAW`, `CAP_SYS_PTRACE`, `CAP_CHOWN` ve bir düzine daha fazlası — hangi işletim
sistemi kullanıcısıyla çalıştığından bağımsız olarak saldırı yüzeyidir: bir kod-çalıştırma
açığı, uygulamanın kendi inisiyatifiyle düşürdüğü değil, kernel'in container'a verdiği her
şeyi devralır. Bu, SEC-02'nin ikinci yarısıdır (`audit/findings/security.md`); birinci
yarı — her iki Dockerfile'ın runner stage'inde `USER node`, yani `api`/`web`'in baştan root
olarak çalışmaması — PR #109'da tamamlandı.

Bir capability yalnızca bir servis düşürülmüş haliyle gerçekten çalıştırılıp başarısız
olduğu gözlemlendiğinde geri eklenir, "muhtemelen gerekir" diye değil. Compose
dosyalarındaki her `cap_add:` yanındaki yorum, o kararı gerektiren gerçek hatayı taşır;
kısa özeti:

| Servis       | `cap_add`                                             | Neden                                                                                                                                                                                                                                                                                                                                                 |
| ------------ | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `api`, `web` | yok                                                   | Zaten `USER node` — container'ın ömrü boyunca hiçbir noktada `chown`, `setuid` veya ayrıcalıklı port bind'i yok                                                                                                                                                                                                                                       |
| `migrate`    | yok                                                   | `migrate` build hedefinin `USER`'ı yok (runner öncesi `build` stage'inin kendisi), yani root çalışır — ama yalnızca DB'ye bağlanır ve kendi zaten inşa edilmiş `/app`'ini okur                                                                                                                                                                        |
| `backup`     | yok                                                   | `entrypoint:`, postgres imajının kendi entrypoint'ini tamamen değiştiriyor, dolayısıyla chown/re-exec mantığı hiç çalışmıyor — sidecar root kalır ama hiçbir sahiplik değiştirmiyor                                                                                                                                                                   |
| `postgres`   | `CHOWN`, `FOWNER`, `SETUID`, `SETGID`, `DAC_OVERRIDE` | Resmî entrypoint her zaman root olarak başlar, _her_ açılışta (yalnızca ilkinde değil) `PGDATA`'yı `postgres` kullanıcısına `chown`'lar, sonra `gosu postgres` ile kendini yeniden exec eder — `DAC_OVERRIDE` özellikle ikinci açılıştan itibaren gerekir: `PGDATA` artık `chmod 0700` olduğunda root bu izin olmadan içine `find` ile bile giremiyor |
| `redis`      | `SETUID`, `SETGID`                                    | Entrypoint, `setpriv` ile uid 999'a ayrıcalık düşürür — ama yalnızca ilk argümanı harfiyen `redis-server` olduğunda; aşağıya bakın                                                                                                                                                                                                                    |

**redis'in `command:`'i exec form'dur, shell wrapper değil — ve bu kozmetik bir tercih değil.**
Bu sertleştirme turunun ilk taslağı, `REDIS_PASSWORD`'u opsiyonel tutmak için
`command: ['sh', '-c', 'if [ -n "$REDIS_PASSWORD" ]; then …; fi']` kullanıyordu. Bu,
container'ın entrypoint'ine ilk argüman olarak `redis-server` yerine `sh`'ı veriyordu — tam
olarak entrypoint'in kendi ayrıcalık-düşürme kontrolünün baktığı şey bu. Dolayısıyla düşürme
sessizce hiç çalışmadı ve redis-server ömrü boyunca root olarak kaldı. Review sırasında
`docker top` ile yakalandı (`docker exec ... id` ile değil — o, PID 1'in gerçek çalışma
zamanı kullanıcısını değil, imajın `USER` yönergesinden gelen _exec session_'ın kullanıcısını
raporlar; yanlış araç aynı çıktıyı verip hatayı gizlerdi). Bu, `REDIS_PASSWORD`'u sabit bir
varsayılan olmadan opsiyonel yapmak için `sh -c` wrapper'ını ekleyen PR #166'dan kaynaklanan
gerçek bir gerilemeydi.

Düzeltme `command: ['redis-server', '--requirepass', '${REDIS_PASSWORD:-}']` — dizi (exec)
formu, Compose'un kendisi tarafından config zamanında değiştiriliyor (`${REDIS_PASSWORD:-}`,
bu dosyada başka yerlerde bir container'ın kendi shell'inin çalışma zamanında çözdüğü
değerler için kullanılan `$$` kaçışı değil). `redis-server` yeniden ilk argüman olarak literal
şekilde geldiğinde entrypoint'in tespiti yeniden eşleşiyor, `setpriv --reuid redis --regid
redis` çalışıyor, ve bu işlemin ihtiyaç duyduğu capability'ler (`SETUID`, `SETGID`) bu
belgenin önceki bir sürümünde anlatılan `DAC_OVERRIDE`'ın yerini alıyor — `DAC_OVERRIDE`,
root olarak çalışmayı telafi ediyordu; süreç artık uid 999 olup `/data`'ya (imajın bu şekilde
bakladığı) doğrudan sahipken hiçbir override gerekmiyor. `docker top`'un `root ...
redis-server` yerine `999 ... redis-server` göstermesiyle, ve hem şifreli hem şifresiz
durumda değerin sağlam kaldığı bir `SET` → restart döngüsüyle doğrulandı.

Bu sertleştirme turunun kapsamı dışında: salt-okunur kök dosya sistemi (`read_only: true`)
ve seccomp profilleri. İkisi de hangi yolların yazılabilir kalması gerektiğine dair
servis-bazlı bir denetim isteyen daha katı kısıtlar (geçici dizinler, node'un kendi `/tmp`
kullanımı vb.) — takip işi olarak izleniyor, buraya dahil edilmedi.

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

### Büyük board seed'lemek

Varsayılan seed dört task'tır; bir özellik geliştirmek için doğru, board'un yük altında ne
yaptığını görmek için yanlış boyuttur. `SEED_LARGE_BOARD_TASKS`, demo board'un yanına ikinci
bir board ekler — "Load Test Board", beş column, en büyüğü task'ların yaklaşık üçte birini
tutar:

```bash
SEED_LARGE_BOARD_TASKS=1000 pnpm db:seed
```

Boş ya da `0` (varsayılan) bunu tamamen atlar; istemeyen kimse bedelini ödemez. Pozitif tam
sayı olmayan her değer clamp'lenmek yerine "boş" sayılır: bir yazım hatası, ölçmek üzere
olduğunuzdan başka boyutta bir board'u sessizce seed'lememelidir.

Satırlar tekdüze değil gerçekçidir — karışık öncelikler, kartların yaklaşık yarısında label,
dörtte birinde atanan kişi, due-soon penceresinin içine ve gerisine yayılmış son tarihler —
çünkü her kartın aynı şekilde olduğu bir board tek bir kart şeklini ölçer.
[`apps/web/components/board/board-column.tsx`](../../apps/web/components/board/board-column.tsx)
içindeki column başına render bütçesi bu board'a karşı ölçüldü.

## Veri saklama

Kurultay artık saklamaya hakkı olmayan satırları siler. Bir BullMQ işi `REDIS_URL` üzerinde
**günde bir kez** koşar — due-soon taramasıyla aynı mekanizma — ve beş tabloyu süpürür:

| Tablo          | Ne zaman silinir                     | Ayar                                            |
| -------------- | ------------------------------------ | ----------------------------------------------- |
| `Session`      | `expiresAt` geçtiğinde               | yok — yapılandırılabilir değil                  |
| `Verification` | `expiresAt` geçtiğinde               | yok — yapılandırılabilir değil                  |
| `Notification` | okunmuşsa ve N günden önce okunmuşsa | `NOTIFICATION_RETENTION_DAYS` (varsayılan `90`) |
| `Activity`     | N günden önce yazılmışsa             | `ACTIVITY_RETENTION_DAYS` (varsayılan `365`)    |
| `UsagePing`    | N günden önce yazılmışsa             | `ACTIVITY_RETENTION_DAYS` (varsayılan `365`)    |

`UsagePing` bilerek kendi penceresini taşımak yerine `ACTIVITY_RETENTION_DAYS`'i paylaşır: aynı
sınıf satırdır — bir kullanıcıyı adlandıran kurulum geçmişi — ve tek bir veri sınıfı üzerindeki
iki ayar ancak birbiriyle çelişebilir. O tablonun ne sakladığı (kişi, workspace, tür ve UTC gün
başına tekilleştirilmiş tek satır) ve bilerek neyi saklamadığı için bkz.
[ADR 0021](decisions/0021-activation-funnel-and-opt-in-telemetry.md).

Her pencerenin ardındaki gerekçe — ve `Activity`'nin neden arşivlenmek ya da süresiz
saklanmak yerine bir yıl sonra silindiği — [ADR 0020](decisions/0020-data-retention.md)'de.

Bunlardan birini değiştirmeden önce bilinmesi gereken iki şey:

- **Okunmamış bildirimler hangi yaşta olursa olsun silinmez.** Pencere `createdAt`'ten değil,
  `readAt`'ten ölçülür.
- Her iki pencere için de **`0` "sonsuza dek sakla" demektir.** Yasal bir denetim izi
  yükümlülüğünüz varsa `ACTIVITY_RETENTION_DAYS=0` yapın. Negatif bir değer kırpılmaz,
  başlangıçta reddedilir — gelecekte bir kesim noktası olurdu ve canlı satırları silerdi.

Her koşu stdout'a, tablo başına silinen satır sayısını taşıyan tek bir JSON satırı yazar —
başka hiçbir şey yok: kimlik yok, payload yok:

```json
{
  "ts": "2026-08-14T03:00:01.204Z",
  "level": "info",
  "event": "retention.cleanup",
  "durationMs": 41.8,
  "sessions": 132,
  "verifications": 9,
  "notifications": 2140,
  "activities": 0,
  "usagePings": 0
}
```

Satır her sayı sıfır olsa bile yazılır; böylece satırın yokluğu, işin koşmayı bıraktığının
işareti olur.

`CLEANUP_ENABLED=false` süpürmeyi tamamen kapatır ve bunu yalnızca başlangıçta değil, silme
anında yapar — daha eski bir deployment'ın Redis'te bıraktığı bir iş tanımı anahtarı
aşamaz. Entegrasyon suite'i bu anahtar kapalı koşar (`test/setup-e2e.ts`) ve yalnızca kendi
doğrulamalarının çevresinde açar; global ve zamanlanmış bir `DELETE`, fixture'ları geçmişe
tarihlenmiş bir suite'in arka planında koşmasını isteyeceğiniz bir şey değil.

Silme batch'lidir (statement başına 1000 satır); böylece uzun süredir çalışan bir instance'ta
ilk koşu, kilitleri tutan ve autovacuum'u engelleyen tek bir uzun transaction'a dönüşmez.

## Aktivasyon hunisi ve telemetri

Ayrı ayrı kararlaştırılmış iki ayrı şey ve aralarındaki fark, her ikisinden de önemli. Tam
gerekçe: [ADR 0021](decisions/0021-activation-funnel-and-opt-in-telemetry.md).

### 1. Aktivasyon hunisi — burada hesaplanır, size gösterilir, hiçbir yere gönderilmez

Kurultay, kurulumunuzun zaten tuttuğu satırlardan on bir adımlık bir aktivasyon hunisi türetir;
yanında bir de Kuzey Yıldızı metriği: **Haftalık Aktif Takım Workspace'i** — iki veya daha fazla
üyesi olan ve son yedi günde iki veya daha fazla mevcut üyesi bir şey yapmış workspace'ler.

| #   | Adım                 | Sayı nereden geliyor                                              |
| --- | -------------------- | ----------------------------------------------------------------- |
| 1   | `user_registered`    | `COUNT(User)`                                                     |
| 2   | `workspace_created`  | `role = OWNER` olan distinct `WorkspaceMember.userId`             |
| 3   | `board_created`      | `board.created` aktivitesindeki distinct aktörler                 |
| 4   | `first_task_created` | `task.created` üzerindeki distinct aktörler                       |
| 5   | `first_drag`         | `task.moved` üzerindeki distinct aktörler                         |
| 6   | `invite_sent`        | `invitation.created` üzerindeki distinct aktörler                 |
| 7   | `smtp_configured`    | bu dağıtımın SMTP aktarımı var mı (kişi sayısı değil)             |
| 8   | `invite_accepted`    | `invitation.accepted` distinct aktörleri — aktör davet edilendir  |
| 9   | `dashboard_viewed`   | `UsagePing`'de `dashboard_view` satırı olan distinct kullanıcılar |
| 10  | `task_completed`     | Bir kartı `COMPLETED` kolona taşıyan distinct aktörler            |
| 11  | `wau_board_view`     | Son 7 günde `board_view` satırı olan distinct kullanıcılar        |

On birin dokuzu `Activity`, `User` ve `WorkspaceMember`'dan okunur — ürünün kendi nedenleriyle
zaten yazdığı tablolar — dolayısıyla huni yükseltmeden bu yana geçen süreyi değil, kurulumunuzun
tüm geçmişini kapsar. Yalnızca 9. ve 11. adımlar kendi depolamasını gerektirdi, çünkü `Activity`
değişiklikleri kaydeder ve _bir board'u okumak bir değişiklik değildir_: onlar olmadan, her sabah
board'unu açıp hiçbir şeyi düzenlemeyen bir takım ölü olarak raporlanırdı.

Her adım **distinct kişi** sayar, asla olay değil; tek istisna dağıtımın bir özelliği olan 7.
adımdır. `smtp_configured` bilerek "davet gönderildi" ile "davet kabul edildi" arasında durur:
mail aktarımı olmadan davetli adresini doğrulayamaz ve dolayısıyla hiç kabul edemez (bkz.
[SMTP ve Mailpit](#smtp-ve-mailpit) ve
[ADR 0013](decisions/0013-invitation-email-verification.md)); oradaki bir sıfır, aksi hâlde ürün
sorunu gibi görünecek bir düşüşü açıklar.

**Buradaki hiçbir şey sunucunuzdan çıkmaz.** İstek anında hesaplanır ve diğer her şeyle aynı API
üzerinden oturum açmış tek bir çağırana döner.

#### Kimler görebilir

Siz söyleyene kadar hiç kimse:

```dotenv
INSTANCE_ADMIN_EMAILS=siz@example.com,ops@example.com
```

Varsayılan olan boş değer, uç noktanın herkese — makinedeki her workspace'in sahibi olan hesap
dahil — `403` yanıtı vermesi demektir. Vermek zorunda: kaydın açık olduğu bir kurulumda
"workspace sahibi" her ziyaretçinin bir workspace oluşturarak kendine verebileceği bir roldür,
yani hiçbir workspace rolü sınır olamazdı. Adresler büyük/küçük harf duyarsız eşleşir; listeyi
değiştirmek için yeniden başlatma gerekir.

Ayarlandıktan sonra huni, o hesaplar için **Ayarlar** ekranının altında görünür; başka kimse için
görünmez. Uygulama içinden yetki vermenin bir yolu yoktur.

### 2. Dışa telemetri — kapalı ve siz açmadıkça kapalı kalır

```dotenv
TELEMETRY_ENABLED=false          # varsayılan
TELEMETRY_ENDPOINT=              # varsayılanı yok; yukarıdaki anahtara ek olarak gerekli
```

`TELEMETRY_ENABLED=false` ile — ki dokunulmamış bir `.env` bu demektir — **hiçbir dışa istek
yapılmaz**. `true` yapıp `TELEMETRY_ENDPOINT` ayarlamamak hata loglar ve yine hiçbir şey
göndermez; yerleşik bir toplayıcı adresi bilerek yoktur.

Açtığınızda, API süreci başlarken tam olarak bir `POST` yapılır; gövdesi şudur ve **başka hiçbir
şey içermez**:

```json
{
  "event": "instance_started",
  "version": "0.1.0"
}
```

Alan alan, listenin tamamı budur:

| Alan      | Değer                | Not                                                |
| --------- | -------------------- | -------------------------------------------------- |
| `event`   | `"instance_started"` | Her zaman bu düz metin. Tek bir olay vardır        |
| `version` | örn. `"0.1.0"`       | Bu derlemenin geldiği `@kurultay/api` paket sürümü |

Gönderil**mey**en ve gönderilmesi için kod yolu bulunmayanlar: herhangi bir kurulum kimliği,
hostname'iniz, IP adresiniz, URL'iniz, veritabanınız, kullanıcı/workspace/board/task sayıları,
yukarıdaki aktivasyon hunisinin herhangi bir parçası ve herhangi bir kişiye dair herhangi bir
şey. Oturum yok, çerez yok, parmak izi yok ve ikinci bir istek yok — yeniden deneme yok, kuyruk
yok, zamanlama yok. Yük gönderilmeden önce tamamen loglanır, böylece sunucunuzdan neyin çıktığını
kendi API log'unuzda okuyabilirsiniz:

```text
LOG [TelemetryService] TELEMETRY_ENABLED is on — sending {"event":"instance_started","version":"0.1.0"} to https://…
```

Reddedilen bağlantı, DNS hatası, toplayıcıdan gelen hata ya da zaman aşımı
(`TELEMETRY_TIMEOUT_MS`, varsayılan 5sn) — hepsi tek bir uyarı satırı üretir, başka hiçbir şey;
telemetri açılışı asla geciktiremez ya da düşüremez.

Kurulum kimliği olmadığı için bir toplayıcı kurulumları değil _başlangıçları_ sayabilir. Bu,
güvene dayalı hiçbir şey içermeyen bir söz karşılığında bilerek verilen bir hassasiyet kaybıdır;
takas [ADR 0021](decisions/0021-activation-funnel-and-opt-in-telemetry.md)'de tartışılıyor.

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

`api`/`web`, her etiketli release'te GHCR'a yayınlanır (bkz.
[Docker'da tam stack](#dockerda-tam-stack)), dolayısıyla geri almak bir rebuild değil, bir tag
değişikliğidir:

```bash
# .env
TAG=v0.1.0   # bilinen son sağlam tag — yayınlanmış sürümleri `git tag -l` ile listeleyin
```

```bash
docker compose pull && docker compose up -d   # v0.1.0'ın image'larını çeker ve onlarla yeniden başlatır
```

O tag için yayınlanmış bir image yok mu (bu workflow var olmadan önce yükseltilmiş eski
kurulumlar, veya `ghcr.io`'ya erişilemiyor)? O zaman daha önce tek seçenek olan kaynak
rebuild'e dönün:

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
   uyuşsun: `.env`'de `TAG=v0.1.0` ayarlayıp `docker compose pull` çalıştırın (bkz.
   [Uygulamayı geri almak](#uygulamayı-geri-almak)), o tag için yayınlanmış image yoksa
   `git switch --detach v0.1.0 && docker compose up -d --build`.

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

## Gözlemlenebilirlik

Üç sinyal, üç hedef. Buradaki hiçbir şey bir metrik stack'i değildir — Prometheus yok, Grafana
yok, log toplayıcı yok. Kurultay'ın ölçeğinde cevaplanmaya değer soru "bir şey bozuldu mu ve
bunu fark eden oldu mu"dur; bunun için tam olarak bu kadarı yeter:

| Sinyal                      | Nereye akar                                                           | Nerede yapılandırılır                              |
| --------------------------- | --------------------------------------------------------------------- | -------------------------------------------------- |
| İstek ve süreç log'ları     | konteyner stdout → Docker `json-file`, sınırlandırılmış ve rotasyonlu | `docker-compose.yml` (`x-logging`)                 |
| Yakalanmamış hatalar (5xx)  | Sentry, **yalnızca bir DSN yapılandırdıysanız**                       | `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN`            |
| Instance'ın ayakta olmaması | `/health/ready`'yi yoklayan harici bir uptime monitörü                | monitörünüzün paneli — bu repository'de hiçbir şey |

Üçü tek bir tanımlayıcı üzerinde buluşur. Her istek bir `X-Request-Id` alır (upstream bir
proxy gönderiyorsa o yeniden kullanılır, yoksa UUIDv7 üretilir); istemciye geri yansıtılır,
JSON access-log satırına yazılır, sunucu tarafındaki stack trace'e eklenir ve — hata takibi
açıksa — Sentry event'ine aranabilir bir `requestId` tag'i olarak iliştirilir. "Bozuldu, sayfa
`0198e2c1-…` yazdı" diyen bir kullanıcı, tam olarak o hatadan bir `grep` ve bir Sentry
aramasıdır.

### Log'lar

Her iki uygulama da stdout'a loglar; Docker toplar. `docker compose logs -f api` ile geri
okunur.

API her tamamlanan istek için tek bir JSON nesnesi yazar — `ts`, `level`, `requestId`,
`method`, `path`, `status`, `durationMs`, `userId`. Bu alan listesi bilerek kapalıdır: istek
gövdeleri, query string'ler, header'lar ve cookie'ler asla loglanmaz; çünkü bu API session
cookie'leri, davet token'ları ve task içeriği taşır.

Her iki compose dosyasındaki her servis log'larını **3 dosya × 10 MB** ile sınırlar
(`docker-compose.yml` başındaki `x-logging`). Docker'ın `json-file` varsayılanı
_sınırsızdır_ ve dolan bir disk başlı başına bir kesintidir — üstelik bu stack'in kendi
başına ulaşabileceği bir kesinti, çünkü access log trafikle birlikte büyür. Ayar konteyner
**oluşturulurken** uygulanır; bu yüzden mevcut bir dağıtımda etkili olması için
`docker compose up -d` (konteynerleri yeniden oluşturur) gerekir, düz bir `restart` yetmez.
Doğrulama:

```bash
docker inspect kurultay-api-1 --format '{{json .HostConfig.LogConfig}}'
# {"Type":"json-file","Config":{"max-file":"3","max-size":"10m"}}
```

### Hata takibi (Sentry) — varsayılan kapalı

Kurultay hata takibi **kapalı** gelir ve kapalı olması SDK'nın hiç yüklenmemesi demektir:
initialize yok, global handler yok, dışarı bağlantı yok ve web tarafında ziyaretçinin
tarayıcısının istediği bir Sentry chunk'ı yok. Kimsenin talep etmediği bir telemetri hattını
sessizce açan self-host yazılım bu projenin gönderdiği bir şey değildir; DSN'leri boş bırakmak
desteklenen, kalıcı bir yapılandırmadır.

Açmak için `.env` içinde DSN'leri ayarlayın:

```bash
SENTRY_DSN=https://<key>@<org>.ingest.sentry.io/<project>              # API
NEXT_PUBLIC_SENTRY_DSN=https://<key>@<org>.ingest.sentry.io/<project>  # web
SENTRY_ENVIRONMENT=production            # opsiyonel; boşsa NODE_ENV'e düşer
SENTRY_RELEASE=v0.2.0                    # opsiyonel; dağıttığınız tag'i verin
```

ardından `docker compose up -d --build web && docker compose up -d api`. API DSN'ini
konteyner başlarken okur, bu yüzden restart yeterlidir. Web DSN'i bir `NEXT_PUBLIC_*`
değeridir ve Next.js bunu **build** sırasında gömer — değişikliğin etkili olması için web
imajının yeniden build edilmesi gerekir, tıpkı `NEXT_PUBLIC_API_URL` gibi.

**İki ayrı Sentry projesi** kullanın, uygulama başına bir tane. Tarayıcı DSN'i her
ziyaretçinin indirdiği JavaScript'e derlenir, dolayısıyla yapısı gereği publiktir; sunucunuzun
kullandığı DSN ile aynı olmamalıdır. Self-host Sentry de aynı şekilde çalışır — DSN yalnızca
kendi host'unuzu işaret eder.

**Ne raporlanır, ne raporlanmaz.** API 5xx'i ve yalnızca 5xx'i raporlar: eşlenmemiş bir Prisma
hatası, fırlatan bir bug, `Error` olmayan bir şeyin `throw`'u. İstemci hataları — 400, 401,
403, 404, 409, 429 — asla gönderilmez. Bunlar API'nin tasarlandığı gibi çalışmasıdır, zaten
access log'da sayılırlar ve ayda binlercesini göndermek bir alarm kanalının okunmaz hâle
gelme biçimidir.

**Süreçten ne çıkar.** `sendDefaultPii` kapalıdır ve bir `beforeSend` hook'u her iki tarafta
da şunları temizler:

- `cookie`, `set-cookie`, `authorization` ve `proxy-authorization` header'ları — yakalanmış bir
  session cookie'si, Sentry projesini okuyabilen herkese verilmiş bir session'dır;
- tüm cookie'ler, istek/yanıt gövdeleri ve query string'ler (`?q=` arama terimleri taşır, ki
  bunlar kullanıcı içeriğidir);
- `user` üzerindeki `id` dışındaki her şey — e-posta yok, kullanıcı adı yok, IP adresi yok.
  `id` opak bir UUIDv7'dir, access log'un zaten yazdığı değerin aynısı.

Korunanlar: exception tipi, mesajı ve stack'i; istek metodu ve route path'i; `requestId`
tag'i; ve `user.id`. **Performans tracing'i ve Session Replay kapalıya sabitlenmiştir**
(`tracesSampleRate: 0`, her iki replay oranı `0`) ve ayar olarak sunulmazlar — replay
render edilmiş DOM'u, yani ekrandaki her task başlığını ve yorumu gönderirdi; tracing ise
SDK'nın uygulama açılmadan önce yüklenmiş olmasını gerektirirdi ki bu "istemediyseniz
yüklenmez" ilkesiyle bağdaşmaz.

**Source map'ler.** Sentry build eklentisi yalnızca `NEXT_PUBLIC_SENTRY_DSN` ayarlıyken
çalışır ve o zaman bile `SENTRY_AUTH_TOKEN` da yoksa hiçbir şey yüklemez — yani token'sız bir
build asla kırılmaz ve uyarı da vermez. Yükleme olmadan tarayıcı stack trace'leri minified
kalır; okunabilir olmaları için build sırasında `SENTRY_AUTH_TOKEN`, `SENTRY_ORG` ve
`SENTRY_PROJECT` ayarlayın. Eklentinin kendi build-time telemetrisi koşulsuz kapalıdır.

### Uptime izleme — kesintiyi asıl yakalayan bu, kurun

Restart politikaları çöken bir konteyneri geri getirir, ama host'un kendisi düştüğünde, disk
dolduğunda veya Postgres bağlantı kabul etmeyi bıraktığında size bunu söyleyen hiçbir şey
yoktur. Harici bir monitör, izlediği makineden sağ çıkan tek sinyaldir ve herhangi birinin
ücretsiz katmanı yeterlidir.

**`/health`'i değil, `/health/ready`'yi izleyin.** İkisi farklı soruları yanıtlar:

| Endpoint        | Soru                                                                                                | Davranış                                                                |
| --------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `/health`       | Süreç ayakta mı ve HTTP'ye yanıt veriyor mu?                                                        | Statik `{"status":"ok"}` — hiçbir şeye dokunmaz. Node yaşıyorsa hep 200 |
| `/health/ready` | Bu instance gerçekten istek karşılayabiliyor mu — Postgres erişilebilir mi, Redis yanıt veriyor mu? | `checks` dökümüyle `200`, ya da bir bağımlılık düştüyse `503`           |

`/health` bir liveness probe'udur: bir orkestratörün süreci yeniden başlatmanın işe yarayıp
yaramayacağına karar vermek için kullandığı şeydir ve veritabanı yanarken bilerek yeşil kalır,
çünkü restart veritabanını iyileştiremez. Onu izlemek, hiçbir kullanıcının board açamadığı bir
kesinti sırasında size API'nin "ayakta" olduğunu söylerdi. `/health/ready` ise ürün gerçekten
bozulduğunda kızaran endpoint'tir ve yanıt gövdesi hangi bağımlılığın düştüğünü söyler. İkisi
de publiktir (auth yok) ve rate limit'ten muaftır, böylece bir monitör kendini throttle edip
yanlış alarm üretemez.

Kurulum — örnek olarak [UptimeRobot](https://uptimerobot.com) veya
[healthchecks.io](https://healthchecks.io); bir URL'yi yoklayıp e-posta gönderebilen her
monitör olur:

1. `https://<host-unuz>/health/ready` için bir **HTTP(s) monitörü** oluşturun (API henüz bir
   reverse proxy arkasında değilse `:4000/health/ready`).
2. **Aralık: 5 dakika.** Gece yaşanan bir kesintiyi sabaha kalmadan yakalayacak kadar hızlı,
   her ücretsiz katmanın içinde kalacak kadar yavaş.
3. Alarm öncesi **eşik: art arda 2 başarısız yoklama** — bir deploy veya
   `docker compose up -d` sırasında kaçan tek bir yoklama olay değildir ve kurt masalı anlatan
   bir alarm kanalı susturulur.
4. **Beklenen durum: 200.** `/health/ready`'den gelen bir `503` gerçek bir bağımlılık
   arızasıdır ve "down" sayılmalıdır; kabul edilen aralığı "herhangi bir 2xx/3xx/5xx" diye
   genişletmeyin.
5. **Zaman aşımı: 10 saniye.** Readiness probe'u kendi bağımlılık kontrollerini ~2s ile
   sınırlar, dolayısıyla bundan yavaş olan her şey ağ ya da takılmış bir süreçtir.
6. Bir **e-posta alarm kişisi** ekleyin ve "tekrar ayakta" bildirimini de açın — ne zaman
   düzeldiğini bilmek, ne olduğunu bilmenin yarısıdır.
7. **Bir kez bilerek tetikleyin** ve mailin geldiğini doğrulayın:
   `docker compose stop postgres`, iki aralık bekleyin, kırmızı alarmı görün, sonra
   `docker compose start postgres` ile toparlanma mailini bekleyin. Hiç tetiklenmemiş bir
   alarm kurulumu bir güvence değil, bir varsayımdır.

API henüz internetten erişilebilir değilse healthchecks.io'nun _push_ modeli alternatiftir:
sizden ses **kesildiğinde** alarm verir; host tarafında bir cron
(`*/5 * * * * curl -fsS localhost:4000/health/ready && curl -fsS <ping-url>`) hiçbir şeyi dışa
açmadan özel bir dağıtımı kapsar.

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
