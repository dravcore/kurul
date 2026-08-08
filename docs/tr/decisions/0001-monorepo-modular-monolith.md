# 0001. Monorepo + Modüler Monolit

**Durum:** Kabul edildi
**Tarih:** 2026-08-08

> 🌐 [English (canonical)](../../decisions/0001-monorepo-modular-monolith.md) | Türkçe — Bu çeviri güncel olmayabilir; kanonik kaynak İngilizce'dir.

## Bağlam

Kurultay henüz iskelet öncesi aşamada: henüz hiç kod yok, dolayısıyla ilk satır yazılmadan önce hem kod organizasyonu ekseni (monorepo vs. polyrepo) hem de runtime ekseni (monolit vs. mikroservis) karara bağlanmalı. Bu iki eksen birbirinden bağımsız — kodun *nasıl saklandığı*, *nasıl çalıştığı* değildir — ve ikisi de açık bir cevap gerektiriyor.

## Karar

Kod organizasyonu için **monorepo** (pnpm workspace: `apps/api`, `apps/web`, `packages/shared-types`), runtime için **modüler monolit**: temiz modül sınırlarına (auth, workspace, board, task, dashboard, notification, …) sahip tek bir NestJS process'i. Bu aşamada mikroservis yok.

## Gerekçe

- Frontend ve backend TypeScript'i paylaşıyor, bu yüzden `packages/shared-types` task/board tiplerini sınır boyunca taşıyor — veri modeli değişikliği tek yerde güncellenir.
- Solo/küçük ekip hızı: iki repo, henüz hiçbir faydası olmayan, yinelenen PR'lar ve versiyon senkronizasyon yükü getirir.
- Daha düşük OSS katkı bariyeri: tek clone, tek `docker compose up`.
- Referans projelerin çoğu monorepo olarak yayınlanıyor (Plane, Huly).
- Mikroservis reddedildi: MVP'nin ihtiyacı olmayan bağımsız ölçeklendirme karşılığında dağıtık sistem karmaşıklığı ekliyor (servisler arası çağrılar, dağıtık transaction'lar, ayrı deploy pipeline'ları, observability).
- Kanban sıkı sıkıya bağlı: bir task'ı taşımak task satırına, aktivite loguna, bildirimlere ve dashboard toplamlarına aynı anda dokunuyor — bunu servislere bölmek tek bir transaction'ı dağıtık bir transaction'a dönüştürür.
- Veri modeli henüz oturmadı. Servis sınırlarını çok erken çizmek yanlış yerden bölme riski taşır, bu da şekil netleştikten sonra bir monoliti bölmekten çok daha pahalıya mal olur.

**Kademeli evrim yolu:** MVP'de tek NestJS process'i → trafik gerektirdiğinde aynı kod tabanının aynı image'dan çalışan `api` / `ws` (Socket.io) / `worker` (kuyruk) rollerine bölünmesi → o gün gelirse yalnızca kanıtlanmış bir darboğazın kendi servisine çıkarılması.

**Referans projeler:** Plane (monolit + iki destek servisi — bir DB-proxy Gateway ve bir entegrasyon Pilot'u), Linear (tek kod tabanı, farklı workload rolleri — WebSocket sunucuları, GraphQL API, job runner'ları — her biri bağımsız ölçeklenebiliyor), Huly (monorepo + çoklu servis, ama bunu yönetmek için kendi build sistemini, Rush'ı, kurmak zorunda kalmış).

## Sonuçlar

- Tek deploy artifact'ı, daha basit onboarding, tek kod stili, paketler arası versiyon kayması yok.
- Modül sınırları ilk günden temiz kalmalı — bu disiplin sonraki bölünmeyi ucuzlaştıran şey; özensiz sınırlar onu tekrar pahalı hale getirir.
- Roller ayrılana kadar tüm uygulama tek birim olarak ölçeklenir.
- Bir modüldeki bir hata, tüm process'in kullanılabilirliğini etkileyebilir.

## Değerlendirilen Alternatifler

| Alternatif | Neden değil |
|---|---|
| Polyrepo (ayrı api/web repoları) | Solo/küçük ekip için yinelenen PR/versiyon senkronizasyon yükü; OSS katkıda bulunanların yerel olarak çalıştırması daha zor |
| Baştan itibaren mikroservis | Henüz ölçekleme ihtiyacı yokken dağıtık karmaşıklık; kanban'ın transaction'ları sıkı sıkıya bağlı; veri modeli oturmamış, dolayısıyla sınırlar muhtemelen yanlış olurdu |
