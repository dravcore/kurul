# Teknoloji Stack'i

Kurultay'ın her katmanı için seçilen teknoloji, kısa bir gerekçe ve karşılaştırıldığı
alternatif.

> 🌐 [English (canonical)](../tech-stack.md) | Türkçe — Bu çeviri güncel olmayabilir; kanonik kaynak İngilizce'dir.

## İçindekiler

- [1. Özet](#1-özet)
- [2. Katman bazlı gerekçeler](#2-katman-bazlı-gerekçeler)
- [3. Bilinçli olarak dahil edilmeyenler](#3-bilinçli-olarak-dahil-edilmeyenler)
- [4. Açık kaynak referansları](#4-açık-kaynak-referansları)
- [5. Karar kayıtları](#5-karar-kayıtları)

---

## 1. Özet

| Katman | Seçim | Değerlendirilen alternatif |
|---|---|---|
| Backend | NestJS + TypeScript | Fastify (daha hafif), Django |
| Veritabanı | PostgreSQL 17 | — |
| Cache / PubSub / Queue | Redis | — |
| ORM | Prisma | Drizzle ORM |
| API | REST (başlangıçta) | GraphQL (sonradan) |
| Realtime | Socket.io + `@socket.io/redis-adapter` | `ws` (daha hafif, özellik yok) |
| Frontend | Next.js + React + TypeScript | — |
| Stil | Tailwind CSS | — |
| UI kit | shadcn/ui | Radix UI (ham) |
| Drag & drop | @dnd-kit | pragmatic-drag-and-drop |
| Grafik | Recharts | Chart.js, Apache ECharts |
| Auth | Better Auth (organization plugin) | Auth.js / NextAuth (bakım modunda) |
| Deployment | Docker Compose | Kubernetes (ölçek gerektirdiğinde) |

Mimari (monorepo + modüler monolit) ayrı olarak [architecture.md](architecture.md)'de ele
alınıyor.

---

## 2. Katman bazlı gerekçeler

### Backend — NestJS + TypeScript

İki ticari referans noktası da bu yolda ilerliyor: ClickUp TypeScript/Node.js/NestJS/
PostgreSQL üzerinde, Linear ise tamamen Node.js + TypeScript üzerinde, PostgreSQL ve Redis
ile. NestJS'in modül sistemi, tek bir geliştirici veya küçük bir ekip tarafından
geliştirilirken çok modüllü bir ürünü (auth, workspace, board, task, dashboard,
notification) düzenli tutuyor. Frontend ile aynı dili paylaşmak `packages/shared-types`'ı
mümkün kılan şey — ki bu her veri modeli değişikliğinde karşılığını veriyor. Açık kaynak
alternatiflerin çoğu (Plane, Taiga) hızlı CRUD ve ücretsiz bir admin panel için Django'yu
seçti — realtime senkronizasyon öncelik değilse iyi bir takas, ama burada yanlış tercih
olurdu.

### Veritabanı — PostgreSQL + Redis

Tartışmasız: ClickUp, Linear, Plane, Taiga ve Focalboard'ın hepsi Postgres üzerinde
oturuyor. JSON kolonları esnek metadata'yı (custom field'lar, aktivite payload'ları)
karşılarken ilişkisel bütünlük task/board grafiğini karşılıyor. Redis ise tek bir araçla
dört ihtiyacı karşılıyor: bildirim kuyruğu, session store, rate limiting ve Socket.io
pub/sub adapter'ı.

### ORM — Prisma

Drizzle ve Prisma, 2026'da baskın iki TypeScript ORM'i ve ikisi de üretime hazır. Drizzle
SQL seviyesinde kontrol ve en küçük footprint'i (~7.4kb) sunuyor; Prisma ise şema-öncelikli
bir iş akışı, olgun bir ekosistem ve Prisma Studio gibi tooling sunuyor — Prisma 7 Rust
bağımlılığını kaldırdığından beri eski bundle boyutu itirazı da büyük ölçüde ortadan kalktı.
Prisma burada kazanıyor çünkü migration hikâyesi daha rehberli, bu da tek başına
çalışırken hata ayıklama süresinden tasarruf ettiriyor. Drizzle'ın performans avantajı ORM
katmanında yaşıyor ve pratikte 5–50 ms'lik veritabanı round trip'i bunu gölgede bırakıyor.

### Realtime — Socket.io + Redis adapter

Self-hosted altyapı için `@socket.io/redis-adapter` ile Socket.io standart cevap:
adapter, event'leri her sunucu instance'ına yayıyor, ki bu yatay ölçeklenme için kesin bir
gereklilik. Ham `ws` daha düşük overhead'e sahip ama oda yönetimini ve yeniden bağlanma
mantığını sana bırakıyor — bir Kanban board'unun ise ikisine de ihtiyacı var. Yönetilen
servisler (Ably, Pusher, Liveblocks) kendi sunucularımızı çalıştırdığımızda geçerli olmayan
bir serverless problemini çözüyor.

### Drag & drop — @dnd-kit

`react-beautiful-dnd` deprecated — Atlassian projeden çekildi. 2026'da `@dnd-kit`, çoğu
React drag-and-drop işi için varsayılan tercih: ~6 KB çekirdek, erişilebilir (klavye ve
ekran okuyucu), framework-agnostik ve aktif bakımda; Linear issue sıralaması için bunu
kullanıyor. Board başına tipik 50–200 öğede, yalnızca ~1000 öğeyi aştığında öne geçen ve
kendi collision detection'ını yazmayı gerektiren Atlassian'ın daha yeni
`pragmatic-drag-and-drop`'una karşı ölçülebilir bir performans farkı yok. Kritik eşlik eden
kural sıralama: position'lar float olarak saklanır ve **fractional indexing** ile yeniden
sıralanır, asla yeniden numaralandırılmış tam sayılar olarak değil.

### Grafik — Recharts

Bir React dashboard'u için en güvenli varsayılan: geniş ekosistem benimsenmesi, anlaşılır
bir component API'si, SVG rendering, MIT lisansı ve shadcn/ui ile iyi uyum. En hafif seçenek
değil (~290 KB). Grafik sayısı hızla artarsa veya veri setleri büyürse, Canvas tabanlı bir
kütüphane (Chart.js, Apache ECharts) yeniden değerlendirmeye değer hale gelir.

### Auth — Better Auth

Multi-tenant workspace'ler bu ürünün kalbinde, dolayısıyla auth yükü ağır bir seçim.
Better Auth, 2026'da yeni projeler için en güçlü self-hosted seçenek — NextAuth'tan daha
yetenekli, ücretsiz, aktif bakımda — ve Auth.js/NextAuth bakım modunda, Better Auth ise
onun halefi konumunda. Belirleyici faktör **organization plugin**: kutudan çıkar çıkmaz
multi-tenant organizasyonlar, davetler, üye rolleri ve izinler — bunu sıfırdan yazmak
haftalar sürerdi. Self-hosting, Clerk gibi yönetilen bir servise bağımlılık olmadan veri
egemenliğini içeride tutuyor. Better Auth'un yalnızca backend logic sağladığını, login ve
register UI'ının bizim yazmamız gerektiğini unutma.

### Deployment — Docker Compose

Dört servis — `api`, `web`, `postgres`, `redis` — mevcut self-managed Linux sunucu
kurulumuyla eşleşiyor. Ölçek gerektirdiğinde Kubernetes'e giden yol açık kalıyor (hem
ClickUp hem Linear sonunda oraya vardı), ama şimdilik tek bir host'ta Compose doğru
büyüklük.

---

## 3. Bilinçli olarak dahil edilmeyenler

| Teknoloji | Neden şimdi değil |
|---|---|
| Kafka | ClickUp kullanıyor, ama 20M+ kullanıcı ölçeğinde. Redis pub/sub MVP için fazlasıyla yeterli; sonradan eklenebilir |
| GraphQL | Linear kullanıyor. REST'le başlamak daha hızlı; API tüketicileri çeşitlendiğinde yeniden değerlendirilir |
| Elasticsearch | Tam metin arama PostgreSQL'in yerleşik FTS'iyle başlayabilir |
| Kubernetes | Tek bir host'ta Docker Compose yeterli. Trafik gerektirdiğinde geçiş yapılır |
| MinIO / S3 | Dosya ekleri MVP kapsamı dışında. Eklendiğinde S3-uyumlu bir store seçilir |
| Local-first sync engine | Linear'ın en büyük teknik yatırımı. Çok yüksek karmaşıklık — server-first ile başla |

---

## 4. Açık kaynak referansları

Mimari ve veri modelleme için incelemeye değer projeler:

| Proje | Backend | Frontend | Not |
|---|---|---|---|
| Plane | Django | Next.js | En popüler OSS PM aracı (46k+ yıldız), AGPL-3.0 |
| Huly | TypeScript / Node.js | Svelte | Tam TS, ama Rush monorepo karmaşıklığını taşıyor |
| Taiga | Django | React | Agile/Scrum odaklı, MPL-2.0 |
| OpenProject | Ruby on Rails | Angular | En eski / enterprise, GPL-3.0 |
| Focalboard | Go | React | Basit Kanban, artık aktif bakımda değil |

---

## 5. Karar kayıtları

Tam argümanlar ve sonuçlar burada tekrarlanmak yerine [`decisions/`](decisions/) altında
yaşıyor:

| ADR | Konu |
|---|---|
| [`0001-monorepo-modular-monolith.md`](decisions/0001-monorepo-modular-monolith.md) | Monorepo + modüler monolit |
| [`0002-backend-stack.md`](decisions/0002-backend-stack.md) | NestJS + Prisma + PostgreSQL + Redis |
| [`0003-frontend-stack.md`](decisions/0003-frontend-stack.md) | Next.js + Tailwind + shadcn/ui + Recharts |
| [`0004-auth-better-auth.md`](decisions/0004-auth-better-auth.md) | Organization plugin'i ile Better Auth |
| [`0005-realtime-socketio.md`](decisions/0005-realtime-socketio.md) | Socket.io + Redis adapter |
| [`0006-fractional-indexing.md`](decisions/0006-fractional-indexing.md) | Sıralama için Float position'lar |
| [`0007-license-agpl.md`](decisions/0007-license-agpl.md) | AGPL-3.0 |
| [`0008-git-flow-semver.md`](decisions/0008-git-flow-semver.md) | Git Flow + SemVer |

İlgili: [architecture.md](architecture.md) · [project-skeleton.md](project-skeleton.md)
