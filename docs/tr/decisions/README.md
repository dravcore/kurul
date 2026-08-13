# Mimari Karar Kayıtları

Kurultay'ın ardındaki önemli kararların hafif, MADR tarzı kayıtları.

> 🌐 [English (canonical)](../../decisions/README.md) | Türkçe — Bu çeviri güncel olmayabilir; kanonik kaynak İngilizce'dir.

## Neden ADR

Kurultay, aktif geliştirme öncesinde ve sırasında küçük bir ekip (çoğunlukla solo) tarafından inşa ediliyor. "Neden Drizzle yerine Prisma" veya "neden AGPL" gibi kararlar, gerçek trade-off'lar tartılarak bir kez veriliyor ve yazılı hale getirilmedikçe unutuluyor. Bir ADR, kararın verildiği anda bağlamı, kararı ve gerekçeyi yakalar, böylece gelecekteki bir katkıda bulunanın (gelecekteki biz dahil) gerekçeyi bir Slack thread'inden yeniden inşa etmesi veya kapanmış bir tartışmayı yeniden açması gerekmez. Bunlar bilinçli olarak kısa ve olgusal, tasarım dokümanları değil.

## Dizin

| #                                                     | Başlık                                                               | Durum                                                 | Tarih      |
| ----------------------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------- | ---------- |
| [0001](0001-monorepo-modular-monolith.md)             | Monorepo + Modüler Monolit                                           | Kabul edildi                                          | 2026-08-08 |
| [0002](0002-backend-stack.md)                         | Backend Stack: NestJS + Prisma + PostgreSQL + Redis                  | Kabul edildi                                          | 2026-08-08 |
| [0003](0003-frontend-stack.md)                        | Frontend Stack: Next.js + Tailwind + shadcn/ui + @dnd-kit + Recharts | Kabul edildi                                          | 2026-08-08 |
| [0004](0004-auth-better-auth.md)                      | Auth: Organization Plugin ile Better Auth                            | Kabul edildi                                          | 2026-08-08 |
| [0005](0005-realtime-socketio.md)                     | Realtime: Socket.io + Redis Adapter                                  | Kabul edildi                                          | 2026-08-08 |
| [0006](0006-fractional-indexing.md)                   | Task ve Column Pozisyonu için Fractional Indexing                    | Kabul edildi                                          | 2026-08-08 |
| [0007](0007-license-agpl.md)                          | Lisans: AGPL-3.0                                                     | Kabul edildi                                          | 2026-08-08 |
| [0008](0008-git-flow-semver.md)                       | Git Flow + Conventional Commits + SemVer                             | Kabul edildi                                          | 2026-08-08 |
| [0009](0009-board-column-permissions.md)              | Board ve Column İzinleri                                             | Kabul edildi                                          | 2026-08-09 |
| [0010](0010-task-permissions.md)                      | Task İzinleri                                                        | Kabul edildi                                          | 2026-08-09 |
| [0011](0011-label-task-metadata-permissions.md)       | Label ve Task-Metadata İzinleri                                      | Kabul edildi (yorum-silme satırının yerini 0012 aldı) | 2026-08-09 |
| [0012](0012-comment-delete-authorship.md)             | Yorum Silme Yazarlığı                                                | Kabul edildi                                          | 2026-08-09 |
| [0013](0013-invitation-email-verification.md)         | Davet Kabulünde E-posta Doğrulaması                                  | Kabul edildi                                          | 2026-08-10 |
| [0014](0014-dual-licensing-cla.md)                    | Çift Lisanslama ve Katkıda Bulunan Lisans Sözleşmesi                 | Kabul edildi (yolu 0015 ile askıda)                   | 2026-08-11 |
| [0015](0015-no-external-contributions.md)             | Dış Katkı Kabul Edilmiyor; Hukuk Masrafı Ertelendi                   | Kabul edildi                                          | 2026-08-12 |
| [0016](0016-foreign-key-violation-status.md)          | Yabancı Anahtar İhlalleri 422'ye Değil 409'a Eşlenir                 | Kabul edildi                                          | 2026-08-12 |
| [0017](0017-partial-indexes-outside-prisma-schema.md) | Kısmi İndeksler Migration'larda Yaşar, Testlerle Korunur             | Kabul edildi                                          | 2026-08-12 |
| [0018](0018-localization-strategy.md)                 | Yerelleştirme Stratejisi: URL Yönlendirmesi Olmadan next-intl        | Kabul edildi                                          | 2026-08-12 |
| [0019](0019-column-category.md)                       | Kolon Tamamlanmışlığı Bir Kategoridir, Ad Değil                      | Kabul edildi                                          | 2026-08-12 |
| [0020](0020-data-retention.md)                        | Veri Saklama: Tablo Başına Pencereler, Gecelik Bir Süpürme ile       | Kabul edildi                                          | 2026-08-14 |

Bir durum daha sonra, kendisinin yerini alan ADR'e bir bağlantıyla **Superseded** (yerini aldı) olarak değişebilir (örn. `**Durum:** [0012](0012-....md) tarafından yerini aldı`).

## Yeni bir ADR eklemek

1. Aşağıdaki şablonu yeni bir dosyaya kopyala: `docs/decisions/NNNN-kebab-title.md`, burada `NNNN` sıradaki bir sonraki sıfırla-doldurulmuş dört haneli sayı.
2. Her bölümü doldur — hiçbir yeri placeholder olarak bırakma.
3. Yukarıdaki dizin tablosuna bir satır ekle.
4. Bir PR aç. Tartışma PR üzerinde gerçekleşir; merge edildikten sonra ADR'in durumu `Accepted` olur ve kayıt tarihsel olarak ele alınır (sonraki kararları yerini alma yoluyla düzenle, geçmişi yeniden yazarak değil).

## Şablon

```markdown
# NNNN. Başlık

**Durum:** Önerildi | Kabul edildi | [NNNN](NNNN-file.md) tarafından yerini aldı
**Tarih:** YYYY-AA-GG

> 🌐 [English (canonical)](../../decisions/NNNN-kebab-title.md) | Türkçe — Bu çeviri güncel olmayabilir; kanonik kaynak İngilizce'dir.

## Bağlam

Bu kararı hangi problem veya soru zorladı? Hangi kısıtlar geçerliydi?

## Karar

Verilen seçim, bir veya iki cümleyle açıkça ifade edilir.

## Gerekçe

Bu seçenek neden diğerlerine tercih edildi, yukarıdaki bağlam göz önüne alındığında.

## Sonuçlar

Bunun neyi kolaylaştırdığı, neyi zorlaştırdığı ve olumsuz trade-off'lar — sadece artıları değil, dürüstçe belirtilmiş.

## Değerlendirilen Alternatifler

| Alternatif | Neden değil |
| ---------- | ----------- |
| ...        | ...         |
```
