# 0005. Realtime: Socket.io + Redis Adapter

**Durum:** Kabul edildi
**Tarih:** 2026-08-08

> 🌐 [English (canonical)](../../decisions/0005-realtime-socketio.md) | Türkçe — Bu çeviri güncel olmayabilir; kanonik kaynak İngilizce'dir.

## Bağlam

Bir kanban board'unun, bağlı client'lar arasında board/task state'ini senkron tutması gerekiyor. Proje, serverless bir deployment'ı hedeflemek yerine, zaten kendi Postgres ve Redis altyapısını çalıştırıyor.

## Karar

Bare `ws` ve yönetilen realtime servisleri (Ably, Pusher, Liveblocks) yerine, **`@socket.io/redis-adapter`** ile **Socket.io**.

## Gerekçe

- Self-hosted altyapı zaten yerinde olduğundan, Socket.io + Redis adapter standart seçim: `@socket.io/redis-adapter` olayları tüm sunucu instance'larına dağıtıyor, bu da yatay ölçeklendirme için gerekli.
- Bare `ws`'in overhead'i daha düşük ama oda yönetimini ve otomatik yeniden bağlanmayı elle inşa etmeyi bırakıyor — ikisi de zaten bir kanban board'unun çok-client senaryosu için gerekli, dolayısıyla tasarruf gerçekleşmiyor.
- Yönetilen servisler (Ably, Pusher, Liveblocks) serverless deployment'lara özgü sorunları çözüyor; kendi sunucu altyapımızı uçtan uca işlettiğimiz için burada geçerli değiller.
- **Bilinçli sıralama:** realtime, özellik sırasında son sıraya konuyor (bkz. [project-skeleton.md](../project-skeleton.md)) — auth, board'lar, task'lar, task metadata'sı, filtreleme ve dashboard'lardan sonra — çünkü veri akışının önce oturması gerekiyor. Socket'leri erken bağlamak, sonraki her özellik değişikliğinde event kontratlarını güncellemek anlamına gelirdi.

## Sonuçlar

- Oda'lar ve yeniden bağlanma, elle yazılmak yerine kütüphane tarafından hallediliyor.
- Birden fazla sunucu instance'ı gerektiğinde Redis adapter üzerinden kanıtlanmış bir yatay ölçekleme yolu mevcut.
- Vendor lock-in yok, bağlantı başına yönetilen-servis maliyeti yok.
- Redis pub/sub, cache ve kuyruk görevlerinin üzerine işletilmesi gereken başka bir yük deseni haline geliyor.
- Realtime'ı sona ertelemek, socket event kontratlarının inşanın geç bir aşamasına kadar gerçek kullanıma karşı doğrulanmadığı anlamına geliyor — o noktada keşfedilen yeniden işlemeler önceki özelliklere geri sıçrayabilir.

## Değerlendirilen Alternatifler

| Alternatif | Neden değil |
|---|---|
| Bare `ws` | Daha düşük overhead, ama zaten gerekli olan oda ve yeniden bağlanma mantığının elle yazılması gerekirdi |
| Ably / Pusher / Liveblocks (yönetilen) | Sahip olmadığımız serverless ölçekleme sorunlarını çözüyor; self-hosted altyapının gereksiz kıldığı maliyet ve harici bir bağımlılık ekliyor |
