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

| Katman                 | Seçim                                  | Değerlendirilen alternatif              |
| ---------------------- | -------------------------------------- | --------------------------------------- |
| Backend                | NestJS 11 + TypeScript                 | Fastify (daha hafif), Django            |
| Veritabanı             | PostgreSQL 18                          | —                                       |
| Cache / PubSub / Queue | Redis 8 (AGPLv3)                       | Valkey (BSD-3, Linux Foundation fork'u) |
| ORM                    | Prisma 7                               | Drizzle ORM                             |
| API                    | REST (başlangıçta)                     | GraphQL (sonradan)                      |
| Realtime               | Socket.io + `@socket.io/redis-adapter` | `ws` (daha hafif, özellik yok)          |
| Frontend               | Next.js 16 + React + TypeScript        | —                                       |
| Stil                   | Tailwind CSS                           | —                                       |
| UI kit                 | shadcn/ui                              | Radix UI (ham)                          |
| Drag & drop            | @dnd-kit                               | pragmatic-drag-and-drop                 |
| Grafik                 | Recharts                               | Chart.js, Apache ECharts                |
| Auth                   | Better Auth (organization plugin)      | Auth.js / NextAuth (bakım modunda)      |
| E-posta                | SMTP üzerinden `nodemailer`            | Sağlayıcı API'si (Resend, SendGrid, …)  |
| Deployment             | Docker Compose                         | Kubernetes (ölçek gerektirdiğinde)      |

Mimari (monorepo + modüler monolit) ayrı olarak [architecture.md](architecture.md)'de ele
alınıyor.

---

## 2. Katman bazlı gerekçeler

### Backend — NestJS 11 + TypeScript

İki ticari referans noktası da bu yolda ilerliyor: ClickUp TypeScript/Node.js/NestJS/
PostgreSQL üzerinde, Linear ise tamamen Node.js + TypeScript üzerinde, PostgreSQL ve Redis
ile. **NestJS 11** pinlenen major'dır (Faz 0 itibarıyla son kararlı; NestJS 12 ESM
migration'ı hâlâ draft'tı). NestJS'in modül sistemi, tek bir geliştirici veya küçük bir ekip tarafından
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

Her iki versiyon da bilerek sabitlenmiştir. **PostgreSQL 18** mevcut major sürüm; öncekisi
hâlâ yıllarca destekleniyor, ama v0.1 çıktıktan sonra bir major atlama her self-hoster'a bir
`pg_dump`/restore maliyetlendiriyor — resmi imaj, farklı bir major tarafından initialize
edilmiş bir `PGDATA` volume'üne karşı başlamayı reddediyor
([development.md](development.md#yükseltme-ve-yedekleme)). Bunu şimdi, hiçbir veri yokken
yapmak bedava. **Redis 8** bir versiyon kadar bir lisans tercihi de: 7.4–7.8 bandı yalnızca
RSALv2/SSPLv1, ki bu source-available ve OSI açık kaynak değil, ve Redis 8 bir OSI seçeneğini
geri getirdi — AGPLv3, Kurultay'ın kendisinin altında dağıtıldığı lisansla aynı. Stack'i
yeniden dağıtan bir self-hoster, sormadığı bir lisans sorusu miras almıyor. Valkey
(BSD-3-Clause, Linux Foundation'ın Redis 7.2.4 fork'u) protokol uyumlu ve aşağı akışta
izinli bir lisans gerekirse tek satırlık bir imaj değişimi olarak duruyor.

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

`react-beautiful-dnd` deprecated — Atlassian projeden çekildi. Kurultay **klasik `@dnd-kit`
hattını** kullanıyor (`@dnd-kit/core` 6.3.1 + `@dnd-kit/sortable` 10.0.0, pinlenmiş): MIT,
~6 KB çekirdek, erişilebilir (klavye ve ekran okuyucu), framework-agnostik ve en yaygın
kullanılan React drag-and-drop kütüphanesi. Aynı zamanda **donmuş** — Aralık 2024'ten beri
sürüm yok, dokümantasyon sitesi repository'si Şubat 2026'da arşivlendi, bakım çabası farklı
bir API'ye sahip 1.0 öncesi bir yeniden yazıma (`@dnd-kit/react`) kaydı; onu benimsemiyoruz.
Atlassian'ın `pragmatic-drag-and-drop`'u (Apache-2.0) aktif sürüm çıkarıyor ve fallback,
collision detection'ı elle yazma maliyetiyle. Solo bir maintainer için, board başına
50–200 kartta donmuş-ama-sabit, hareketli-ve-1.0-öncesine karşı kazanıyor; tam argüman ve
yeniden değerlendirme tetikleyicisi
[`decisions/0003-frontend-stack.md`](decisions/0003-frontend-stack.md)'de. Kritik eşlik eden
kural sıralama: position'lar float olarak saklanır ve **fractional indexing** ile yeniden
sıralanır, asla yeniden numaralandırılmış tam sayılar olarak değil.

### Grafik — Recharts

Bir React dashboard'u için en güvenli varsayılan: geniş ekosistem benimsenmesi, anlaşılır
bir component API'si, SVG rendering, MIT lisansı ve shadcn/ui ile iyi uyum. En hafif seçenek
değil, ve kaydetmeye değer maliyet bir byte sayısı değil bağımlılık yüzeyi: Recharts v3,
`@reduxjs/toolkit`, `react-redux`, `immer` ve `victory-vendor`'ı (d3 modülleri) runtime
bağımlılığı olarak deklare ediyor, dolayısıyla onu benimsemek başka hiçbir state
kütüphanesi olmayan bir uygulamaya Redux Toolkit'i sokuyor. Grafik sayısı büyürse, bir
bundle bütçesi daralırsa veya o bağımlılık grafiği uygulama-seviyesi state seçimleriyle
çatışmaya başlarsa yeniden gözden geçirin — Canvas tabanlı bir kütüphane (Chart.js, Apache
ECharts) fallback.

### Auth — Better Auth

Multi-tenant workspace'ler bu ürünün kalbinde, dolayısıyla auth yükü ağır bir seçim.
Better Auth, 2026'da yeni projeler için en güçlü self-hosted seçenek — NextAuth'tan daha
yetenekli, ücretsiz, aktif bakımda — ve Auth.js/NextAuth bakım modunda, Better Auth ise
onun halefi konumunda. Belirleyici faktör **organization plugin**: kutudan çıkar çıkmaz
multi-tenant organizasyonlar, davetler, üye rolleri ve izinler — bunu sıfırdan yazmak
haftalar sürerdi. Ürün dilinde bunlar 1:1 olarak **Workspace** / **WorkspaceMember** /
davetlere eşlenir — bkz. [`decisions/0004-auth-better-auth.md`](decisions/0004-auth-better-auth.md#alan-eşlemesi-organization--workspace).
Self-hosting, Clerk gibi yönetilen bir servise bağımlılık olmadan veri
egemenliğini içeride tutuyor. Better Auth'un yalnızca backend logic sağladığını, login ve
register UI'ının bizim yazmamız gerektiğini unutma.

### E-posta — SMTP üzerinden nodemailer

Kurultay bugüne kadar tek bir sınıf e-posta gönderiyor: `better-auth`'un sağlamlaştırılmış
davet-kabul kontrolünün bir davet edilenin workspace'e katılmasına izin vermeden önce
ihtiyaç duyduğu doğrulama linki (bkz.
[`decisions/0013-invitation-email-verification.md`](decisions/0013-invitation-email-verification.md)).
`nodemailer` düz SMTP konuşur, yalnızca `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` /
`SMTP_PASSWORD` / `SMTP_SECURE` / `MAIL_FROM` üzerinden yapılandırılır — sağlayıcı SDK'sı yok,
dolayısıyla self-hoster'lar yeni bir vendor hesabı oluşturmak yerine zaten çalıştırdıkları
herhangi bir mail sunucusuna yönlendirirler. `docker-compose.dev.yml`, lokal geliştirmenin
asla gerçek mail göndermemesi için lokal bir SMTP catch-all olarak
[Mailpit](https://mailpit.axllent.org/) çalıştırır; bkz.
[development.md#smtp-ve-mailpit](development.md#smtp-ve-mailpit).

### Frontend — Next.js 16

`apps/web` için pinlenen major **Next.js 16** (App Router). Tailwind, shadcn/ui, klasik
`@dnd-kit` ve Recharts bunun üstünde oturur; ayrıntılar ve trade-off'lar
[`decisions/0003-frontend-stack.md`](decisions/0003-frontend-stack.md)'de.

### i18n — next-intl

`next-intl`, Faz 1'den beri kurulu — her kullanıcıya görünen metin hardcode edilmek yerine
`useTranslations()` / `messages/en.json` üzerinden geçiyor — yani locale şu an `en` olarak
sabitlenmiş ve henüz bir locale switcher olmasa da (MVP İngilizce-only, bkz.
[roadmap.md — MVP ötesi](roadmap.md#mvp-ötesi)) uygulama çeviriye hazır. Alternatif, string'ler
component ağacına zaten yayıldıktan sonra i18n'i sonradan eklemekti; bu daha pahalı bir sıra.

### Deployment — Docker Compose

Dört servis — `api`, `web`, `postgres`, `redis` — mevcut self-managed Linux sunucu
kurulumuyla eşleşiyor. Ölçek gerektirdiğinde Kubernetes'e giden yol açık kalıyor (hem
ClickUp hem Linear sonunda oraya vardı), ama şimdilik tek bir host'ta Compose doğru
büyüklük.

---

## 3. Bilinçli olarak dahil edilmeyenler

| Teknoloji               | Neden şimdi değil                                                                                                 |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Kafka                   | ClickUp kullanıyor, ama 20M+ kullanıcı ölçeğinde. Redis pub/sub MVP için fazlasıyla yeterli; sonradan eklenebilir |
| GraphQL                 | Linear kullanıyor. REST'le başlamak daha hızlı; API tüketicileri çeşitlendiğinde yeniden değerlendirilir          |
| Elasticsearch           | Tam metin arama PostgreSQL'in yerleşik FTS'iyle başlayabilir                                                      |
| Kubernetes              | Tek bir host'ta Docker Compose yeterli. Trafik gerektirdiğinde geçiş yapılır                                      |
| MinIO / S3              | Dosya ekleri MVP kapsamı dışında. Eklendiğinde S3-uyumlu bir store seçilir                                        |
| Local-first sync engine | Linear'ın en büyük teknik yatırımı. Çok yüksek karmaşıklık — server-first ile başla                               |

---

## 4. Açık kaynak referansları

Mimari ve veri modelleme için incelemeye değer projeler:

| Proje       | Backend              | Frontend | Not                                              |
| ----------- | -------------------- | -------- | ------------------------------------------------ |
| Plane       | Django               | Next.js  | En popüler OSS PM aracı, AGPL-3.0                |
| Huly        | TypeScript / Node.js | Svelte   | Tam TS, ama Rush monorepo karmaşıklığını taşıyor |
| Taiga       | Django               | React    | Agile/Scrum odaklı, MPL-2.0                      |
| OpenProject | Ruby on Rails        | Angular  | En eski / enterprise, GPL-3.0                    |
| Focalboard  | Go                   | React    | Basit Kanban, artık aktif bakımda değil          |

---

## 5. Karar kayıtları

Tam argümanlar ve sonuçlar burada tekrarlanmak yerine [`decisions/`](decisions/) altında
yaşıyor:

| ADR                                                                                            | Konu                                                              |
| ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| [`0001-monorepo-modular-monolith.md`](decisions/0001-monorepo-modular-monolith.md)             | Monorepo + modüler monolit                                        |
| [`0002-backend-stack.md`](decisions/0002-backend-stack.md)                                     | NestJS 11 + Prisma 7 + PostgreSQL 18 + Redis 8                    |
| [`0003-frontend-stack.md`](decisions/0003-frontend-stack.md)                                   | Next.js 16 + Tailwind + shadcn/ui + @dnd-kit + Recharts           |
| [`0004-auth-better-auth.md`](decisions/0004-auth-better-auth.md)                               | Organization plugin'i ile Better Auth (→ Workspace)               |
| [`0005-realtime-socketio.md`](decisions/0005-realtime-socketio.md)                             | Socket.io + Redis adapter                                         |
| [`0006-fractional-indexing.md`](decisions/0006-fractional-indexing.md)                         | Sıralama için Float position'lar                                  |
| [`0007-license-agpl.md`](decisions/0007-license-agpl.md)                                       | AGPL-3.0                                                          |
| [`0008-git-flow-semver.md`](decisions/0008-git-flow-semver.md)                                 | Git Flow + SemVer                                                 |
| [`0009-board-column-permissions.md`](decisions/0009-board-column-permissions.md)               | Board ve column rol matrisi (OWNER/ADMIN yapısı)                  |
| [`0010-task-permissions.md`](decisions/0010-task-permissions.md)                               | Task rol matrisi (MEMBER+ içerik işi)                             |
| [`0011-label-task-metadata-permissions.md`](decisions/0011-label-task-metadata-permissions.md) | Label ve task-metadata rol matrisi                                |
| [`0012-comment-delete-authorship.md`](decisions/0012-comment-delete-authorship.md)             | Yorum silme: yazarlık veya OWNER/ADMIN                            |
| [`0013-invitation-email-verification.md`](decisions/0013-invitation-email-verification.md)     | SMTP mail gönderimi, e-posta doğrulaması yalnızca davet kabulünde |
| [`0014-dual-licensing-cla.md`](decisions/0014-dual-licensing-cla.md)                           | Çift lisanslama + katkıda bulunan lisans sözleşmesi               |
| [`0015-no-external-contributions.md`](decisions/0015-no-external-contributions.md)             | Dış katkı yok; CLA yürürlükte değil, hukuk masrafı ertelendi      |

İlgili: [architecture.md](architecture.md) · [project-skeleton.md](project-skeleton.md)
