# Kurul

Açık kaynak, Kanban odaklı proje yönetim aracı.

[![CI](https://github.com/dravcore/kurul/actions/workflows/ci.yml/badge.svg?branch=develop)](https://github.com/dravcore/kurul/actions/workflows/ci.yml) [![CodeQL](https://github.com/dravcore/kurul/actions/workflows/codeql.yml/badge.svg?branch=develop)](https://github.com/dravcore/kurul/actions/workflows/codeql.yml) [![Sürüm](https://img.shields.io/github/v/release/dravcore/kurul)](https://github.com/dravcore/kurul/releases) [![Lisans](https://img.shields.io/badge/license-AGPL--3.0-blue)](LICENSE)

![Kurul panosu](docs/assets/board.png)

> 🌐 [English (canonical)](README.md) | Türkçe

## Durum

Kurul’ın **MVP özellik seti (Faz 1–9) tamamlandı** (Faz 0 docs/standartlardı) — auth/workspace’ler, board ve
task’lar, filtreleme, dashboard, aktivite/bildirimler ve realtime board senkronu. Bkz.
[docs/roadmap.md](docs/tr/roadmap.md). Kritik tarayıcı akışlarını altı senaryoluk bir
Playwright smoke paketi kapsıyor ([docs/testing.md](docs/tr/testing.md#browser-uçtan-uca)).
MVP ötesi maddeler (e-posta bildirimleri, presence, ek diller, …) hâlâ MVP ötesi altında
listelenir.

## Kurul nedir?

**Kurul**, toplanıp konuşan, karar alan ve önündeki işi kendi arasında bölüşen heyettir. Bu
aracın bir ekip için yaptığı şey de tam olarak bu: insanlar bir board etrafında toplanır, işi
konuşur, neyin önemli olduğuna karar verir ve görevleri aralarında paylaştırır — herkes için
izlenebilir, önceliklendirilmiş ve görünür şekilde.

Proje v0.2.0'a kadar **Kurultay** adını taşıyordu — Türk-Moğol geleneğinde boyların toplanıp
meseleleri tartıştığı, karar aldığı büyük meclis. Kısa ad aynı fikri ve aynı kökü koruyor, ve
projenin artık üzerinde yaşadığı domain'e uyuyor.

Kurul, verisinin ve iş akışının sahibi olmak isteyen ekipler için ticari Kanban/PM
araçlarına (Trello, Linear, Jira) kendi kendine barındırılabilir, AGPL lisanslı bir
alternatif olmayı hedefliyor.

## Neden Kurul

Kendi kendine barındırılan bir board seçen ekipler bunu genelde Trello ile değil, diğer
self-host seçenekleriyle kıyaslar. Bugün o alanın durumu:

| Proje                                                            | Durumu                                                                                                                                        |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| [Planka](https://github.com/plankanban/planka)                   | Kaynağı görünür ama artık OSI uyumlu açık kaynak değil — "fair-code distributed under the Fair Use License and PLANKA Pro/Enterprise License" |
| [WeKan](https://github.com/wekan/wekan)                          | Tümüyle açık kaynak (MIT), ücretli katman yok; Meteor tabanlı stack (Meteor 3.5 / Node.js 24)                                                 |
| [Focalboard](https://github.com/mattermost-community/focalboard) | "This repository is currently not maintained" — geliştirme yalnızca Mattermost eklentisi olarak sürüyor                                       |
| [Vikunja](https://vikunja.io/pricing/)                           | Çekirdek AGPLv3, ama admin paneli, audit log'ları ve zaman takibi kendi barındırdığınız instance'ta bile yalnız Pro'da                        |
| [OpenProject](https://www.openproject.org/pricing/)              | GPLv3 Community Edition, Rails tabanlı ve kurumsal ölçekli; bir grup özellik Enterprise'a özel kalıyor                                        |

Kurul'un cevabı bilinçli olarak dar:

- **Tek lisans, tek katman.** Kod tabanının tamamı AGPL-3.0, hiçbir şey saklı değil. Ticari
  model, aynı kodun ikili lisanslanması; ücretli bir özellik sürümü değil
  ([ADR 0014](docs/tr/decisions/0014-dual-licensing-cla.md)).
- **Güncel stack, tek compose dosyası.** Next.js 16 / NestJS 11 / PostgreSQL 18, uçtan uca
  TypeScript, tamamı için `docker compose pull && docker compose up -d` — yayınlanmış
  image'lar, lokal build gerekmiyor.
- **Realtime ve çok-kiracılılık çekirdekte.** Socket.io board senkronu ve workspace'e
  scope'lanmış sorgular sonradan eklenmedi, baştan tasarlandı.

Ve `v0.2.0` itibarıyla olmayanlar: subtask yok, zaman takibi yok, public API token'ları ve
webhook'lar yok. UI hem İngilizce hem Türkçe konuşuyor — her arayüz metni, yeni bir board'un
başladığı column adları ve size gönderdiğimiz e-posta dahil — ve üçüncü bir dil bir katalog
uzakta. API token'ları, webhook'lar ve ek dil paketleri
[MVP ötesi](docs/tr/roadmap.md#mvp-ötesi) altında, her biri kendisini bekleten açık soruyla
listeli; subtask ve zaman takibi ise o listede hiç yok. Bunlara bugün ihtiyacınız varsa
yukarıdaki daha olgun projelerden biri daha iyi bir seçim.

## Özellikler

MVP’de gelenler — sıralama geçmişi için [docs/roadmap.md](docs/tr/roadmap.md):

- **Board'lar ve kolonlar** — sürükle-bırakla yeniden sıralanabilen klasik Kanban düzeni
- **Task'lar** — çoklu atanan kişi, label'lar, (label'lardan bağımsız tutulan) priority,
  ayrı alanlar olarak due date ve süre tahmini
- **Checklist'ler** — bir task'ta birden çok adlandırılmış checklist, her birinin kendi
  item'ları; board kartında ilerleme rozeti (`3/5`) görünür, task'ta checklist yoksa hiç
  görünmez ([ADR 0023](docs/tr/decisions/0023-checklist-data-model.md))
- **Ek'ler** — kartta dosya ve bağlantı. Dosyalar kendi diskinizde saklanır, uzantısına değil
  magic byte'larına bakılarak kabul edilir ve sizin belirlediğiniz boyut limitiyle geri servis
  edilir; görseller panelde önizlenir. Bağlantı saklanır, gösterilir ve açılır — sunucu o URL'e
  hiç istek atmaz, yani hiçbir önizleme fetch'i ağınızı yoklayan bir araca dönüşemez
  ([ADR 0022](docs/tr/decisions/0022-attachment-storage.md),
  [ADR 0024](docs/tr/decisions/0024-attachment-kinds-and-serving-policy.md))
- **Trello import'u (tek yönlü)** — bir Trello board'unun JSON export'unu yükleyin, karşılığında
  bir Kurul board'u alın: list'ler, kart'lar, label'lar ve checklist'ler. Tek yönlüdür ve
  tekrarlanabilir değildir: **aynı export'u iki kez import etmek iki board yaratır** — yerinde
  güncelleme de yok, tekilleştirme de. Üç şey bilinçli olarak gelmez ve import raporu her birinin
  kaç tane olduğunu söyler: **dosyalar** (Trello export'u attachment'ların baytlarını değil
  URL'lerini taşır, dolayısıyla bağlantı olarak gelirler ve sunucu o URL'lere hiç istek atmaz),
  **üyeler** (bir Trello hesabı bir Kurul hesabı değildir; atamalar düşer ve her şey sizin
  üzerinize yazılır) ve **yorumlar**. Arşivlenmiş list ve kartlar da atlanır, ve içe aktarılan her
  kolon "başlanmadı" olarak gelir — Kurul hangi kolonunuzun "bitti" demek olduğunu asla tahmin
  etmez, onu sonradan siz ayarlarsınız. Rapor yalnız cevabın içindedir: bir kez gösterilir,
  saklanmaz, kapatmak kalıcıdır
  ([ADR 0025](docs/tr/decisions/0025-trello-import-mapping.md))
- **Fractional-indexed sıralama** — bir kartı yeniden sıralamak yalnızca o kartın position'ına
  dokunur, tüm listeyi yeniden numaralandırmaz
- **Workspace'ler** — temelden itibaren multi-tenant; her sorgu workspace'e göre scope'lanır
- **Filtreleme ve arama** — board task filtreleri, cursor pagination
- **Dashboard** — agregasyon görünümleri ve grafikler (created vs completed dahil)
- **Aktivite log'u ve bildirimler** — uygulama içi atama, mention, due-soon; `/notifications`
- **Realtime senkronizasyon** — board değişiklikleri Socket.io üzerinden canlı yayılır
- **İngilizce ve Türkçe** — workspace başına değil, kullanıcı başına bir tercih; böylece tek bir
  workspace farklı diller okuyan insanları bir arada tutabilir. Giriş yaptığınız her cihaza
  gelir, oluşturduğunuz board'un başladığı column adlarını belirler ve size gönderilen e-postanın
  dilini seçer. Bir katalogda olup diğerinde olmayan bir key build'i düşürür
  ([ADR 0018](docs/tr/decisions/0018-localization-strategy.md))

## Hızlı başlangıç

```bash
git clone https://github.com/dravcore/kurul.git
cd kurul
cp .env.example .env   # BETTER_AUTH_SECRET ayarla (openssl rand -base64 32), POSTGRES_PASSWORD ayarla (openssl rand -hex 32)
pnpm install
pnpm -r --filter @kurul/shared-types --filter @kurul/auth-access build   # paylaşılan paketler, git-ignored dist/ üzerinden tüketilir
pnpm db:generate        # Prisma client'ı üret (git-ignored, otomatik oluşmaz)
docker compose -f docker-compose.dev.yml up -d
pnpm db:migrate
pnpm db:seed
pnpm dev
```

- Web: http://localhost:3000
- API health: http://localhost:4000/health

`POSTGRES_PASSWORD`'ün varsayılanı yoktur — ayarlanmadan compose başlamayı reddeder — ve
`.env.example`'da birkaç satır üstündeki `DATABASE_URL`'in şifre kısmı bununla elle
eşleştirilmelidir. `BETTER_AUTH_SECRET`'ten farklı olarak bu değer doğrudan bir bağlantı
URL'ine gömülür, dolayısıyla `openssl rand -base64 32` burada yanlış üreticidir — alfabesi
`/` ve `+` içerir, ikisi de parolaya düşerse URL'i bozar (`/` authority bölümünü doğrudan
sonlandırır; base64-32 çıktılarının kabaca yarısı en az bir tane içerir). Bunun yerine
alfabesi (`0-9a-f`) her zaman URL-güvenli olan `openssl rand -hex 32` kullanın; bkz.
[docs/tr/development.md#veritabanı-ve-cache-kimlik-bilgileri](docs/tr/development.md#veritabanı-ve-cache-kimlik-bilgileri).

Uygulama SMTP yapılandırılmadan da ayağa kalkar, ama davetler yapılandırılana kadar kabul
edilemez — yukarıdaki dev compose dosyası [Mailpit](https://mailpit.axllent.org/)'i zaten
başlatır, böylece bu akışı gerçek bir mail sağlayıcısı olmadan lokal olarak test edebilirsiniz;
bkz. [docs/tr/development.md#smtp-ve-mailpit](docs/tr/development.md#smtp-ve-mailpit).

Tam stack Docker, pull tabanlı: `docker compose pull && docker compose up -d`, ardından
http://localhost adresini açın. Her etiketli release, `api`/`web` imajlarını GHCR'a yayınlar
(`ghcr.io/dravcore/kurul-api`, `ghcr.io/dravcore/kurul-web`) — bu sayede kurulum ve
upgrade lokal build gerektirmez; `latest` yerine belirli bir sürümü sabitlemek için `.env`'de
`TAG=vX.Y.Z` ayarlayın. `TAG`'iniz için henüz yayınlanmış bir imaj yoksa (veya `ghcr.io`'ya ağ
erişimi yoksa) `docker compose up -d` otomatik olarak kaynaktan build'e döner —
`docker compose up --build` de bilinçli olarak build etmek isteyenler için aynen çalışmaya
devam eder. Günlük detaylar: [docs/tr/development.md](docs/tr/development.md).

Her iki uygulama da pakete dahil Caddy reverse proxy'sinin arkasında **tek origin**'den
sunulur; bu sayede **aynı yayınlanmış imaj her domain'de yeniden build edilmeden çalışır** —
kendi domain'inize taşımak için `.env`'de `SITE_URL=https://kurul.example.com` ayarlamanız
yeterli, bu aynı zamanda otomatik HTTPS'i de açar. SMTP dahil tek sayfalık rehber:
[docs/tr/self-hosting.md](docs/tr/self-hosting.md).

## Stack

| Katman            | Seçim                                                                          |
| ----------------- | ------------------------------------------------------------------------------ |
| Backend           | NestJS 11 + Prisma 7 + PostgreSQL 18 + Redis 8 + Socket.io                     |
| Frontend          | Next.js 16 (App Router) + Tailwind CSS + shadcn/ui + @dnd-kit + Recharts       |
| Auth              | Better Auth (organization plugin → Workspace)                                  |
| E-posta           | SMTP üzerinden `nodemailer` (davet doğrulaması)                                |
| Paylaşılan tipler | `packages/shared-types` + `packages/auth-access` (DTO'lar / BA org AC rolleri) |
| Deployment        | Docker Compose                                                                 |
| Mimari            | Monorepo, modüler monolit — mikroservis yok                                    |

Her seçimin tam gerekçesi: [docs/tr/tech-stack.md](docs/tr/tech-stack.md) ve
[docs/tr/decisions/](docs/tr/decisions/).

## Dokümantasyon

Beş dakikalık harita (EN kanonik): **[docs/README.md](docs/README.md)**. Türkçe kopyalar
`docs/tr/` altında.

| Doküman                                                  | Kapsam                               |
| -------------------------------------------------------- | ------------------------------------ |
| [docs/tr/architecture.md](docs/tr/architecture.md)       | Modül haritası, veri modeli          |
| [docs/tr/design.md](docs/tr/design.md)                   | UI/UX dili                           |
| [docs/tr/development.md](docs/tr/development.md)         | Yerel kurulum ve günlük komutlar     |
| [docs/tr/api-conventions.md](docs/tr/api-conventions.md) | REST, hatalar, pagination            |
| [docs/tr/roadmap.md](docs/tr/roadmap.md)                 | MVP bitti; Beyond MVP listesi        |
| [docs/tr/decisions/](docs/tr/decisions/)                 | ADR’ler                              |
| [docs/archive/](docs/archive/)                           | Tarihsel spec / plan / faz checklist |

## Katkıda bulunma

Hata bildirimleri, özellik fikirleri ve tasarım geri bildirimi hoş karşılanıyor ve gerçekten
faydalı. **Dışarıdan gelen kod, doküman ve çeviri pull request'leri kabul edilmiyor** — kod
tabanı belirsiz süreyle tek yazarlı kalıyor
([ADR 0015](docs/tr/decisions/0015-no-external-contributions.md)).
Kurul issue-first çalışıyor: uygulamaya geçmeden önce öner. Süreç için
[CONTRIBUTING.md](CONTRIBUTING.md)'ye, birlikte nasıl çalıştığımız için ise
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)'ye bakın.

## Güvenlik

Bir güvenlik açığı bildirmek için [SECURITY.md](SECURITY.md)'ye bakın.

## Lisans

[AGPL-3.0](LICENSE).
