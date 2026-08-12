# 0017. Kısmi İndeksler Migration'larda Yaşar, Testlerle Korunur

**Durum:** Kabul edildi
**Tarih:** 2026-08-12

> 🌐 [English (canonical)](../../decisions/0017-partial-indexes-outside-prisma-schema.md) | Türkçe — Bu çeviri güncel olmayabilir; kanonik kaynak İngilizce'dir.

## Bağlam

Yaklaşan son tarih bildirimleri, her tick'te son tarihi yaklaşan tüm task'ları yeniden tarayan
zamanlanmış bir worker (`notification/due-soon.worker.ts`) tarafından yazılır. Tekilleştirme
olmadan aynı okunmamış hatırlatma her tick'te yeniden yazılır; bu yüzden worker
`createMany({ skipDuplicates: true })` kullanır.

Bu bayrak `INSERT … ON CONFLICT DO NOTHING`'e derlenir. Tüm etkisi, satırların çakışabileceği
bir unique indeksin var olmasına bağlıdır — **indeks yoksa bu cümlecik sessiz bir no-op'tur ve
her insert başarılı olur.** İhtiyaç duyduğu indeks bilinçli olarak kısmidir:

```sql
CREATE UNIQUE INDEX "Notification_due_soon_unread_uidx"
ON "Notification" ("userId", "taskId")
WHERE "type" = 'due_soon' AND "readAt" IS NULL AND "taskId" IS NOT NULL;
```

Predikat yük taşır. Düz bir `@@unique([userId, taskId])` bir task'ta iki mention'ı yasaklardı
ve daha önceki hatırlatması okunmuş bir task'ın bir daha hiç bildirilmesine izin vermezdi.
Yalnızca filtrelenmiş biçim gerçekte kastedileni söyler: _kullanıcı ve task başına bir tane
okunmamış due-soon hatırlatması_.

**Prisma'nın şema dili bir indeks üzerinde `WHERE` ifade edemez.** Bu yüzden indeks yalnızca
`migrations/20260809180000_due_soon_perf_indexes/migration.sql` içinde yaşar.
`schema.prisma`'nın bakış açısından o, kimsenin bildirmediği bir nesnedir — ki
`prisma migrate dev`'in tam olarak drift dediği şey budur. Dolayısıyla ileriki bir şema
değişikliği onu düşüren bir migration üretebilir ve komutu çalıştıran geliştirici, başka
indeks hareketleriyle dolu bir diff içinde sıradan bir indeks silme görür.

Ardından gelen hata sessiz ve gecikmelidir: hata yok, başarısız istek yok; sadece
`skipDuplicates` sessizce hiçbir şey yapmaz ve kullanıcılar tek bir task'ın bildirim
listelerini her scheduler tick'inde bir satır daha doldurmasını izler.

## Karar

Kısmi indeksler ham SQL migration'larda kalır — başka seçenek yok — ve her biri **indeksin
`pg_indexes` içinde var olduğunu ve ona bağlı davranışın hâlâ geçerli olduğunu doğrulayan bir
entegrasyon testiyle korunur.**

`test/due-soon-index.e2e-spec.ts` bunu `Notification_due_soon_unread_uidx` için yapar:
indeksin mevcut ve unique olduğunu, predikatının hâlâ `("userId", "taskId")` üzerinde
`due_soon`, `readAt IS NULL` ve `taskId IS NOT NULL` adlarını taşıdığını kontrol eder ve
sonra sonuçlarını koşturur — tekrarlanan bir okunmamış hatırlatma tek satıra iner, okunduktan
sonraki yeniden bildirim inmez ve diğer bildirim türleri serbestçe tekrarlanmaya devam eder.

İleride eklenecek her kısmi indeks aynı deseni benimser.

## Gerekçe

- **Var olan tek mekanik koruma bu testtir.** `Notification` modelindeki şema yorumu
  "üretilmiş bir migration'ın bunu düşürmesine izin verme" diyor, ama bir yorum CI'da
  koşmaz. Düşürülen bir indeks o dosyadaki beş testten üçünü anında kırmızıya çevirir —
  canlı bir test veritabanında indeks düşürülerek doğrulandı.
- **Sadece adı değil, predikatı doğrulamak asıl mesele.** Genişletilmiş bir `WHERE` ile hayatta
  kalan bir indeks, eksik olandan daha kötüdür: yinelenenleri reddetmeyi başaramamakla
  kalmaz, meşru satırları (ikinci bir mention) reddetmeye başlar.
- **Davranışsal doğrulamalar tanım metninden daha uzun ömürlüdür.** Postgres bir gün
  `indexdef` biçimini değiştirirse, üç davranış testi hâlâ doğru sebeple başarısız olur.
  Tanım doğrulamaları, _hangi_ değişmezin kırıldığını adlandırmak için oradadır.
- **Bu testlerin yeri entegrasyon katmanıdır.** Mock'lanmış bir Prisma istemcisine karşı
  anlamsızdırlar — test edilen nesne bir veritabanı nesnesidir. `docs/testing.md` zaten
  "API'yi gerçek bir PostgreSQL'e karşı test et"i stratejinin merkezine koyar ve bu, bunun en
  saf örneğidir.

## Sonuçlar

- İndeksi düşüren üretilmiş bir migration, production'a ulaşmak yerine CI'ın entegrasyon
  adımında başarısız olur. Çözüm, üretilen migration'ı düzenleyip
  `CREATE UNIQUE INDEX`'i korumaktır; testi gevşetmek değil.
- İndeks tanımı iki yerde doğrulanır — migration ve test — bu yüzden predikatta kasıtlı bir
  değişiklik iki kez yapılmak zorundadır. Bu yineleme kasıtlıdır; değişikliği bilinçli olmaya
  zorlar.
- `prisma migrate dev` bu indeksi drift olarak bildirmeye devam edecek. Bu, Prisma'ya özgü bir
  durumdur, bu ADR'nin kaldırdığı bir şey değildir; koruma, sessiz bir kaybı gürültülü bir
  kayba çevirir.
- Aynı muamele, ileride eklenecek her filtreli, ifade tabanlı veya `CONCURRENTLY` oluşturulmuş
  indekse — şemanın gidiş-dönüş yapamadığı her şeye — borçludur. Koruma testi olmadan böyle
  bir indeks eklemek, bu ADR'nin önlemeyi amaçladığı gerilemenin ta kendisidir.

## Değerlendirilen Alternatifler

| Alternatif                                                                    | Neden değil                                                                                                                                           |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Prisma'nın ifade edebildiği düz bir `@@unique([userId, taskId])`              | Yanlış anlam: bir task'ta ikinci bir mention'ı yasaklar ve önceki hatırlatması okunmuş bir task'ın yeniden bildirilmesini engeller                    |
| Bunun yerine worker içinde tekilleştir (mevcut satırları oku, sonra filtrele) | Tek bir ifadeyi eşzamanlı tarayıcılar arasında oku-sonra-yaz yarışına çevirir — ki unique indeksin atomik olarak çözdüğü şey tam da budur             |
| Şema yorumuna ve gözden geçirenin dikkatine güven                             | Bir yorum CI'da koşmaz ve silme, ilgisiz indeks hareketleriyle dolu üretilmiş bir migration'ın içinde gelir                                           |
| `pg_indexes`'i bir referansla karşılaştıran migration lint adımı              | Kurulacak ve güncel tutulacak daha büyük bir mekanizma; davranış testleri aynı kaybı yakalar ve üstelik gerçekleştiğinde neyin kırıldığını da açıklar |
| `map` ile `@@index` artı ham bir `ALTER`                                      | Prisma predikatı yine modellemez, yani drift değişmez — sadece yaşadığı dosya değişir                                                                 |
