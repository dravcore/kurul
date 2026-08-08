# Kurultay

Açık kaynak, Kanban odaklı proje yönetim aracı.

> 🌐 [English (canonical)](README.md) | Türkçe

## Durum

Kurultay **MVP öncesi** aşamada. Faz 0 (dokümantasyon) ve Faz 1 (monorepo iskeleti)
yerinde — `apps/api`, `apps/web` ve `packages/shared-types` yerelde çalışır. Auth ve ürün
özellikleri Faz 2'de başlar — bkz. [docs/roadmap.md](docs/tr/roadmap.md).

## Kurultay nedir?

*Kurultay*, Türk-Moğol geleneğinde boyların bir araya gelip meseleleri tartıştığı, kararlar
aldığı ve önündeki işi bölüştüğü büyük meclisin adıdır. Bu aracın bir ekip için yaptığı şey
de tam olarak bu: insanlar bir board etrafında toplanır, işi konuşur, neyin önemli olduğuna
karar verir ve görevleri aralarında paylaştırır — herkes için izlenebilir, önceliklendirilmiş
ve görünür şekilde.

Kurultay, verisinin ve iş akışının sahibi olmak isteyen ekipler için ticari Kanban/PM
araçlarına (Trello, Linear, Jira) kendi kendine barındırılabilir, AGPL lisanslı bir
alternatif olmayı hedefliyor.

## Özellikler

İlk sürüm için planlananlar — sıralama için [docs/roadmap.md](docs/tr/roadmap.md)'ye bakın:

- **Board'lar ve kolonlar** — sürükle-bırakla yeniden sıralanabilen klasik Kanban düzeni
- **Task'lar** — çoklu atanan kişi, label'lar, (label'lardan bağımsız tutulan) priority,
  ayrı alanlar olarak due date ve süre tahmini
- **Fractional-indexed sıralama** — bir kartı yeniden sıralamak yalnızca o kartın position'ına
  dokunur, tüm listeyi yeniden numaralandırmaz
- **Workspace'ler** — temelden itibaren multi-tenant; her sorgu workspace'e göre scope'lanır
- **Dashboard** — task/board aktivitesi üzerinde agregasyon görünümleri ve grafikler
- **Realtime senkronizasyon** — board değişiklikleri Socket.io üzerinden canlı yayılır
- **Aktivite log'u ve bildirimler**

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

Tam stack Docker: `docker compose up --build`. Günlük detaylar:
[docs/tr/development.md](docs/tr/development.md).

## Stack

| Katman | Seçim |
|---|---|
| Backend | NestJS 11 + Prisma 7 + PostgreSQL 18 + Redis 8 + Socket.io |
| Frontend | Next.js 16 (App Router) + Tailwind CSS + shadcn/ui + @dnd-kit + Recharts |
| Auth | Better Auth (organization plugin → Workspace) |
| Paylaşılan tipler | `packages/shared-types` (frontend/backend arasında paylaşılan TS tipleri) |
| Deployment | Docker Compose |
| Mimari | Monorepo, modüler monolit — mikroservis yok |

Her seçimin tam gerekçesi: [docs/tr/tech-stack.md](docs/tr/tech-stack.md) ve
[docs/tr/decisions/](docs/tr/decisions/).

## Dokümantasyon

| Doküman | Kapsam |
|---|---|
| [docs/tr/architecture.md](docs/tr/architecture.md) | Modül haritası, veri modeli özeti |
| [docs/tr/tech-stack.md](docs/tr/tech-stack.md) | Stack seçimleri ve gerekçeleri |
| [docs/tr/project-skeleton.md](docs/tr/project-skeleton.md) | Planlanan repo yerleşimi, ilk Prisma şeması |
| [docs/tr/development.md](docs/tr/development.md) | Ortam kurulumu, günlük iş akışı, komutlar |
| [docs/tr/coding-standards.md](docs/tr/coding-standards.md) | TS/NestJS/Next.js konvansiyonları |
| [docs/tr/design.md](docs/tr/design.md) | UI/UX dili: ilkeler, token'lar, yerleşim, hareket, durumlar, metin |
| [docs/tr/git-strategy.md](docs/tr/git-strategy.md) | Git Flow, Conventional Commits, release'ler |
| [docs/tr/testing.md](docs/tr/testing.md) | Test katmanları, araçlar, beklentiler |
| [docs/tr/api-conventions.md](docs/tr/api-conventions.md) | REST adlandırma, hata formatı, pagination |
| [docs/tr/roadmap.md](docs/tr/roadmap.md) | Fazlar ve ilerleme |
| [docs/tr/decisions/](docs/tr/decisions/) | Hafif mimari karar kayıtları (ADR) |

## Katkıda bulunma

Kurultay henüz iskelet öncesi ve issue-first çalışıyor: uygulamaya geçmeden önce öner. Süreç
için [CONTRIBUTING.md](CONTRIBUTING.md)'ye, birlikte nasıl çalıştığımız için ise
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)'ye bakın.

## Güvenlik

Bir güvenlik açığı bildirmek için [SECURITY.md](SECURITY.md)'ye bakın.

## Lisans

[AGPL-3.0](LICENSE).
