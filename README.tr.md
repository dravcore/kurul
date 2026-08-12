# Kurultay

Açık kaynak, Kanban odaklı proje yönetim aracı.

> 🌐 [English (canonical)](README.md) | Türkçe

## Durum

Kurultay’ın **MVP özellik seti (Faz 1–9) tamamlandı** (Faz 0 docs/standartlardı) — auth/workspace’ler, board ve
task’lar, filtreleme, dashboard, aktivite/bildirimler ve realtime board senkronu. Bkz.
[docs/roadmap.md](docs/tr/roadmap.md). MVP ötesi maddeler (e-posta bildirimleri, presence,
Playwright e2e, ek diller, …) hâlâ MVP ötesi altında listelenir.

## Kurultay nedir?

_Kurultay_, Türk-Moğol geleneğinde boyların bir araya gelip meseleleri tartıştığı, kararlar
aldığı ve önündeki işi bölüştüğü büyük meclisin adıdır. Bu aracın bir ekip için yaptığı şey
de tam olarak bu: insanlar bir board etrafında toplanır, işi konuşur, neyin önemli olduğuna
karar verir ve görevleri aralarında paylaştırır — herkes için izlenebilir, önceliklendirilmiş
ve görünür şekilde.

Kurultay, verisinin ve iş akışının sahibi olmak isteyen ekipler için ticari Kanban/PM
araçlarına (Trello, Linear, Jira) kendi kendine barındırılabilir, AGPL lisanslı bir
alternatif olmayı hedefliyor.

## Özellikler

MVP’de gelenler — sıralama geçmişi için [docs/roadmap.md](docs/tr/roadmap.md):

- **Board'lar ve kolonlar** — sürükle-bırakla yeniden sıralanabilen klasik Kanban düzeni
- **Task'lar** — çoklu atanan kişi, label'lar, (label'lardan bağımsız tutulan) priority,
  ayrı alanlar olarak due date ve süre tahmini
- **Fractional-indexed sıralama** — bir kartı yeniden sıralamak yalnızca o kartın position'ına
  dokunur, tüm listeyi yeniden numaralandırmaz
- **Workspace'ler** — temelden itibaren multi-tenant; her sorgu workspace'e göre scope'lanır
- **Filtreleme ve arama** — board task filtreleri, cursor pagination
- **Dashboard** — agregasyon görünümleri ve grafikler (created vs completed dahil)
- **Aktivite log'u ve bildirimler** — uygulama içi atama, mention, due-soon; `/notifications`
- **Realtime senkronizasyon** — board değişiklikleri Socket.io üzerinden canlı yayılır

## Hızlı başlangıç

```bash
git clone https://github.com/dravcore/kurultay.git
cd kurultay
cp .env.example .env   # BETTER_AUTH_SECRET ayarla (openssl rand -base64 32)
pnpm install
pnpm db:generate        # Prisma client'ı üret (git-ignored, otomatik oluşmaz)
docker compose -f docker-compose.dev.yml up -d
pnpm db:migrate
pnpm db:seed
pnpm dev
```

- Web: http://localhost:3000
- API health: http://localhost:4000/health

Uygulama SMTP yapılandırılmadan da ayağa kalkar, ama davetler yapılandırılana kadar kabul
edilemez — yukarıdaki dev compose dosyası [Mailpit](https://mailpit.axllent.org/)'i zaten
başlatır, böylece bu akışı gerçek bir mail sağlayıcısı olmadan lokal olarak test edebilirsiniz;
bkz. [docs/tr/development.md#smtp-ve-mailpit](docs/tr/development.md#smtp-ve-mailpit).

Tam stack Docker: `docker compose up --build`. Günlük detaylar:
[docs/tr/development.md](docs/tr/development.md).

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
Kurultay issue-first çalışıyor: uygulamaya geçmeden önce öner. Süreç için
[CONTRIBUTING.md](CONTRIBUTING.md)'ye, birlikte nasıl çalıştığımız için ise
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)'ye bakın.

## Güvenlik

Bir güvenlik açığı bildirmek için [SECURITY.md](SECURITY.md)'ye bakın.

## Lisans

[AGPL-3.0](LICENSE).
