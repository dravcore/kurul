# 0010. Task İzinleri

**Durum:** Kabul edildi
**Tarih:** 2026-08-09

> 🌐 [English (kanonik)](../../decisions/0010-task-permissions.md) | Türkçe (bu çeviri güncel olmayabilir; kanonik kaynak İngilizce'dir)

## Bağlam

Faz 4, task CRUD ve drag-and-drop taşımalarını getiriyor.
[ADR 0009](0009-board-column-permissions.md) task yetkilendirmesini bilinçli olarak
erteledi; böylece board/column yapı kuralları yeniden açılmayacaktı. Handler'lar
gelmeden önce Nest `@Roles` matrisi gerekir; ürün duruşu: **üyeler içerik işi
yapar, admin'ler board şekline sahiptir**.

## Karar

Task yetkilendirmesi Nest'te `@Roles` ile şu matris üzerinden uygulanır:

| İşlem                                           | OWNER | ADMIN | MEMBER | GUEST |
| ----------------------------------------------- | :---: | :---: | :----: | :---: |
| Task okuma                                      |   ✓   |   ✓   |   ✓    |   ✓   |
| Task oluştur; başlık / açıklama güncelle        |   ✓   |   ✓   |   ✓    |   —   |
| Task taşı (column içinde veya column'lar arası) |   ✓   |   ✓   |   ✓    |   —   |
| Task sil                                        |   ✓   |   ✓   |   ✓    |   —   |

Column oluştur / yeniden adlandır / sırala / sil OWNER/ADMIN'te kalır (ADR 0009).

## Gerekçe

- Kart taşımak ve düzenlemek günlük üye işidir; bunu yalnızca Admin+'a kilitlemek
  ADR 0009'un “üyeler içerik yapar” gerekçesiyle çelişir.
- Tek bir task silmek (board silmenin aksine) yeterince geri alınabilirdir; MEMBER
  silebilir. GUEST her yerde salt okunur kalır.
- Düz matris (“yalnızca kendi task'ları” yok) authorship kontrolünden kaçınır ve
  küçük ekip OSS kullanımına uyar; daha ince kurallar sonraki ADR'ye kalır.

## Sonuçlar

- Controller'lar tüm task mutasyonlarında `@Roles(OWNER, ADMIN, MEMBER)` kullanır.
- Web UI `canMutateTasks(role)` ile aynı matrisi yansıtır.
- Assignees, label'lar, yorumlar ve diğer Faz 5+ yüzeyler, sonraki bir ADR daraltana
  kadar aynı varsayılanı miras alır.
- Better Auth organization AC `task` için genişletilmez; Nest ürün yetkilendirme
  katmanı olmaya devam eder.

## Değerlendirilen Alternatifler

| Alternatif                                                | Neden değil                                                               |
| --------------------------------------------------------- | ------------------------------------------------------------------------- |
| Yalnızca Admin task taşıyabilir                           | MEMBER için günlük kanban'ı bozar; column yapı kurallarına fazla yaklaşır |
| MEMBER düzenleyip taşıyabilir; silme yalnızca OWNER/ADMIN | Soft-delete'siz MVP'de az güvenlik için ekstra zihinsel model             |
| Yalnızca yazar düzenleyip silebilir                       | Her yolda `createdById` kontrolü; Faz 4 için aşırı                        |
