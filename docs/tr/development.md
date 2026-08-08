# Geliştirme

Kurultay geliştirme ortamının nasıl kurulacağı ve günden güne nasıl çalışılacağı.

> 🌐 [English (canonical)](../development.md) | Türkçe — Bu çeviri güncel olmayabilir; kanonik kaynak İngilizce'dir.

## İçindekiler

- [Durum: iskelet henüz mevcut değil](#durum-iskelet-henüz-mevcut-değil)
- [Ön koşullar](#ön-koşullar)
- [Klonlama ve kurulum](#klonlama-ve-kurulum)
- [Ortam değişkenleri](#ortam-değişkenleri)
- [Çalışma modları](#çalışma-modları)
- [pnpm script'leri](#pnpm-scriptleri)
- [Veritabanı iş akışı](#veritabanı-iş-akışı)
- [Günlük döngü](#günlük-döngü)
- [Sorun giderme](#sorun-giderme)

## Durum: iskelet henüz mevcut değil

Kurultay **iskelet öncesi** durumda. Aşağıda anlatılan `apps/api`, `apps/web`,
`packages/shared-types`, `docker-compose.yml` ve kök `package.json` **henüz repository'de
değil**.

Bu doküman dolayısıyla var olanın bir raporu değildir — **iskeletin sağlaması gereken
kontrattır**. Monorepo'yu iskeletleyen kişi, bu sayfadaki her komutun yazıldığı gibi
çalışacağı şekilde kurar. İskelet geldikten sonra gerçeklik bu dokümandan sapıyorsa,
ikisinden biri buglıdır ve aynı PR'da düzeltilir.

- Yerleşim, Prisma modelleri ve kabul kriterleri: [project-skeleton.md](project-skeleton.md)
- İskelet ne zaman planlanıyor: [roadmap.md](roadmap.md) (Faz 1)
- Her aracın neden seçildiği: [tech-stack.md](tech-stack.md)

## Ön koşullar

| Araç | Sürüm | Kontrol | Notlar |
|---|---|---|---|
| Node.js | 20 LTS veya üzeri | `node -v` | 20+ gerekli; 22 LTS önerilir |
| pnpm | 9 veya üzeri | `pnpm -v` | `corepack enable && corepack prepare pnpm@latest --activate` |
| Docker | herhangi güncel | `docker -v` | macOS'ta Docker Desktop veya Colima |
| Docker Compose | v2 (plugin) | `docker compose version` | `docker-compose` v1 desteklenmiyor |
| Git | 2.30+ | `git --version` | |

Yerel bir PostgreSQL veya Redis kurulumu gerekmiyor — ikisi de Docker içinde çalışır.

## Klonlama ve kurulum

```bash
git clone https://github.com/dravcore/kurultay.git
cd kurultay
pnpm install          # her workspace paketini kurar
```

Repository bir pnpm workspace'idir (`apps/*`, `packages/*`). `pnpm install`'ı her zaman
repository kökünden çalıştırın — asla `apps/api` veya `apps/web` içinden değil.

## Ortam değişkenleri

```bash
cp .env.example .env
```

Sonra boşlukları doldurun. `.env` git tarafından ignore edilir ve asla commit edilmemelidir.

| Değişken | Örnek | Amaç |
|---|---|---|
| `DATABASE_URL` | `postgresql://kurultay:kurultay@localhost:5432/kurultay` | Prisma bağlantı string'i |
| `REDIS_URL` | `redis://localhost:6379` | Socket.io adapter'ı, caching |
| `BETTER_AUTH_SECRET` | *(üret)* | Session imzalama secret'ı — zorunlu, varsayılan yok |
| `BETTER_AUTH_URL` | `http://localhost:3000` | Web uygulamasının public URL'i |
| `API_PORT` | `4000` | NestJS dinleme portu |
| `WEB_URL` | `http://localhost:3000` | API için CORS origin'i |

Bir secret üretmek için:

```bash
openssl rand -base64 32
```

**Yeni bir ortam değişkeni eklemek üç adımlı bir değişikliktir** ve üçü de aynı PR'a girer:
tipli env şemasına ekle, güvenli bir placeholder ile `.env.example`'a ekle ve yukarıdaki
tabloda belgele.

## Çalışma modları

### Önerilen: geliştirme döngüsü (servisler Docker'da, uygulamalar host'ta)

Postgres ve Redis container'larda çalışır; `api` ve `web` host'ta hot reload ile çalışır. Bu
hızlı döngü — kod değişiklikleri arasında image rebuild gerekmez.

```bash
docker compose -f docker-compose.dev.yml up -d   # yalnızca postgres + redis
pnpm db:migrate                                  # migration'ları uygula
pnpm dev                                         # api + web paralel, hot reload
```

| URL | Ne |
|---|---|
| http://localhost:3000 | Web uygulaması (Next.js) |
| http://localhost:4000 | API (NestJS) |
| http://localhost:4000/health | Health check — 200 dönmelidir |

Container'ları `docker compose -f docker-compose.dev.yml down` ile durdurun (veritabanı
volume'unu da düşürüp temiz bir sayfadan başlamak için `-v` ekleyin).

### Docker'da tam stack

Her şey container'da, production'a en yakın hâl. Dockerfile'ları ve compose bağlantısını
doğrulamak için, veya Kurultay'ı geliştirmek değil sadece çalıştırmak istediğinizde kullanın.

```bash
docker compose up --build
```

| | Geliştirme döngüsü | Tam Docker |
|---|---|---|
| Hot reload | Evet | Hayır — rebuild gerekir |
| Kod değişikliği sonrası başlama | saniyeler | onlarca saniye |
| Production'a benzerlik | Kısmen | Evet |
| Kullanım amacı | Günlük geliştirme | Image'ları doğrulama, release kontrolleri, uygulamayı çalıştırma |

## pnpm script'leri

Repository kökünden çalıştırın.

| Script | Komut | Ne yapar |
|---|---|---|
| `dev` | `pnpm dev` | `apps/api` ve `apps/web`'i hot reload ile paralel çalıştırır |
| `build` | `pnpm build` | Her workspace paketini build eder |
| `lint` | `pnpm lint` | Tüm paketlerde ESLint + Prettier kontrolü |
| `db:migrate` | `pnpm db:migrate` | Prisma migration'larını uygular (şema değiştiyse dev'de bir tane oluşturur) |
| `db:studio` | `pnpm db:studio` | http://localhost:5555 adresinde Prisma Studio'yu açar |

Tek bir workspace'i hedeflemek için pnpm'in filter flag'ini kullanın:

```bash
pnpm --filter @kurultay/api dev
pnpm --filter @kurultay/web build
pnpm --filter @kurultay/api test
```

## Veritabanı iş akışı

```bash
# 1. apps/api/prisma/schema.prisma dosyasını düzenle
# 2. Bir migration oluştur ve uygula
pnpm db:migrate
# 3. Veriyi incele
pnpm db:studio
```

Kurallar:

- Migration'lar **commit edilir**. Zaten commit edilmiş bir migration dosyasını asla
  düzenlemeyin — yeni bir tane yazın.
- Pratikte mümkün olduğunda, şema değişiklikleri onları kullanan logic'ten ayrı kendi
  PR'ında olur.
- `Task.position` `Float`'tır (fractional indexing) — özensizce değiştirilmemesi gereken
  model seviyesi kurallar için [project-skeleton.md](project-skeleton.md)'ye bakın.

Yerel bir veritabanını sıfırdan sıfırlamak:

```bash
docker compose -f docker-compose.dev.yml down -v
docker compose -f docker-compose.dev.yml up -d
pnpm db:migrate
```

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

| Belirti | Sebep | Çözüm |
|---|---|---|
| `ECONNREFUSED 127.0.0.1:5432` | Postgres container'ı ayakta değil | `docker compose -f docker-compose.dev.yml up -d` |
| `Environment variable not found: DATABASE_URL` | `.env` eksik | `cp .env.example .env` ve doldur |
| 3000/4000/5432 portu zaten kullanımda | Başka bir process veya eski bir container | `docker compose down`, veya `.env`'de portu değiştir |
| Pull sonrası Prisma tipleri güncel değil | Client yeniden üretilmedi | `pnpm db:migrate` (veya `pnpm --filter @kurultay/api exec prisma generate`) |
| `pnpm install` bir workspace hatasıyla başarısız oluyor | Bir alt-paket içinde çalıştırıldı | Repository kökünden çalıştırın |

## Ayrıca bakınız

- [project-skeleton.md](project-skeleton.md) — bu dokümanın kontratı olduğu yerleşim ve
  kabul kriterleri
- [roadmap.md](roadmap.md) — faz sırası
- [git-strategy.md](git-strategy.md) — branch'ler, commit'ler, release'ler
- [coding-standards.md](coding-standards.md) — bu uygulamaların içindeki kodun nasıl
  yazıldığı
- [testing.md](testing.md) — testlerin nasıl çalıştırılacağı ve yazılacağı
- [../CONTRIBUTING.md](../../CONTRIBUTING.md) — katkı süreci
