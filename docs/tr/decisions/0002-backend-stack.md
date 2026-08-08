# 0002. Backend Stack: NestJS + Prisma + PostgreSQL + Redis

**Durum:** Kabul edildi
**Tarih:** 2026-08-08

> 🌐 [English (canonical)](../../decisions/0002-backend-stack.md) | Türkçe — Bu çeviri güncel olmayabilir; kanonik kaynak İngilizce'dir.

## Bağlam

Backend'in; solo/küçük ekip tarafından geliştirilen, realtime'a eğilimli, çok kiracılı bir kanban aracına uygun ve Next.js frontend'iyle tipleri temiz biçimde paylaşabilen bir framework, ORM, veritabanı ve cache/kuyruk katmanına ihtiyacı var.

## Karar

**NestJS + TypeScript**, ORM olarak **Prisma**, **PostgreSQL 17** ve **Redis**.

## Gerekçe

- Sektör emsali: ClickUp TypeScript/NestJS/PostgreSQL/Redis üzerinde çalışıyor (kendi ölçeğinde ayrıca Kafka ile); Linear uçtan uca Node.js/TypeScript'i, event bus ve cache olarak PostgreSQL ve Redis ile birlikte çalıştırıyor.
- NestJS'in modüler mimarisi, çok modüllü bir ürünü (auth, workspace, board, task, dashboard, notification) solo bir geliştirici veya küçük bir ekip için düzenli tutuyor.
- Frontend ile aynı dil, `packages/shared-types`'ı mümkün kılıyor — task/board tipleri bir kez tanımlanıp her iki tarafça da tüketiliyor, bu da veri modeli her değiştiğinde gerçek zaman kazandırıyor.
- OSS PM alternatiflerinin çoğu (Plane, Taiga) hızlı CRUD ve ücretsiz bir admin paneli için Django kullanıyor; realtime senkronizasyon öncelik haline geldiğinde — ki burada durum bu — uçtan uca TypeScript daha güçlü seçim haline geliyor.
- **Drizzle yerine Prisma:** ikisi de 2026'da üretime hazır. Drizzle SQL'e yakın kontrol ve en küçük footprint'i (~7.4kb) sunuyor; Prisma ise şema-öncelikli bir akış, olgun bir ekosistem ve zengin tooling (Prisma Studio) sunuyor. Prisma 7, Rust engine bağımlılığını kaldırarak tarihsel bundle boyutu şikayetini büyük ölçüde çözdü. Prisma'nın rehberli migration'ları ve kapsamlı dokümantasyonu solo çalışırken hata ayıklama süresinden tasarruf sağlıyor — Drizzle'ın performans avantajı ORM katmanında yaşıyor ve pratikte DB round-trip'i (5–50ms) bu farkı gölgede bırakıyor.
- **Postgres + Redis** neredeyse tartışmasız bir tercih: hem ticari emsaller (ClickUp, Linear) hem de OSS emsaller (Plane, Taiga, Focalboard) Postgres kullanıyor — JSON alanları esnek metadata'yı (custom field'lar) karşılıyor, ilişkisel bütünlük task/board ilişkilerini karşılıyor. Redis, dört ihtiyacı karşılayan tek bir araç: bildirim kuyruğu, session store, rate limiting ve Socket.io pub/sub adapter'ı.

## Sonuçlar

- Rehberli migration'lar ve güçlü dokümantasyon solo geliştirici hata ayıklama süresini azaltıyor; Prisma Studio yerel incelemeyi hızlandırıyor.
- Redis, temel özellikler için opsiyonel bir ek değil, katı bir runtime bağımlılığı haline geliyor.
- Prisma'nın şema-öncelikli akışı, karmaşık sorgular sonunda ortaya çıktığında ham SQL'e göre daha az esnek.
- Uçtan uca TypeScript'e bağlanmak, OSS emsallerin ücretsiz elde ettiği Django'nun her şey dahil admin panelinden vazgeçmek anlamına geliyor.

## Değerlendirilen Alternatifler

| Alternatif | Neden değil |
|---|---|
| Fastify | Daha hafif, ama Nest'in yerleşik modüler DI yapısından yoksun — çok modüllü bir ürün için elle daha fazla şey yazmak gerekir |
| Django | Hızlı CRUD + ücretsiz admin paneli (Plane, Taiga'nın onu seçme nedeni), ama uçtan uca TS tip paylaşımını kırıyor ve realtime ağırlıklı bir ürüne daha az uyuyor |
| Drizzle | Daha küçük footprint, SQL'e daha yakın, ama solo geliştirme için daha az rehberli migration tooling'i |
