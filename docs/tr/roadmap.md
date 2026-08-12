# Roadmap

Kurultay’ın durumu ve şimdilik bilinçli olarak kapsam dışı bırakılanlar.

> 🌐 [English (canonical)](../roadmap.md) | Türkçe — Bu çeviri güncel olmayabilir; kanonik kaynak İngilizce'dir.

**Son güncelleme:** 2026-08-13

## Durum

**MVP tamam.** Ürün Faz **1–9** (artı Faz **0** docs/standartlar) ve MVP sonrası sağlamlaştırma
[`v0.1.0`](../../CHANGELOG.md#010---2026-08-12) ile yayınlandı. Aktif iş, aşağıdaki Beyond
MVP maddeleri ve `develop` üzerindeki sıradan bug/refactor’lar.

| İz                         | Durum                                                                           |
| -------------------------- | ------------------------------------------------------------------------------- |
| Faz 0–9                    | Bitti — Faz 0 docs; 1–9 ürün MVP — [EN arşiv](../archive/roadmap-mvp-phases.md) |
| MVP sonrası sağlamlaştırma | Bitti — aynı arşiv                                                              |
| Beyond MVP                 | Planlanmadı — yalnızca uyumluluk listesi                                        |

Görev seviyesi iş [GitHub Issues](https://github.com/dravcore/kurultay/issues)’ta.
Release süreci: [git-strategy.md](git-strategy.md).

## Teslim edilen MVP (özet)

| Faz | Yetenek                                               |
| --- | ----------------------------------------------------- |
| 0   | Docs, standartlar, ADR’ler, branch protection         |
| 1   | Monorepo iskeleti, Prisma, Compose, CI                |
| 2   | Auth, workspace’ler, roller, davetler                 |
| 3   | Board’lar ve column’lar                               |
| 4   | Task’lar, fractional indexing, drag-and-drop          |
| 5   | Atananlar, etiketler, öncelik, due/estimate, yorumlar |
| 6   | Filtreleme, arama, cursor pagination                  |
| 7   | Dashboard toplamları ve grafikler                     |
| 8   | Aktivite log’u ve uygulama içi bildirimler            |
| 9   | Realtime board senkronu (Socket.io)                   |

Faz 4–9 ve visual-debt tasarım kayıtları: [archive/specs/](../archive/specs/).
Uygulama planları: [archive/plans/](../archive/plans/).

## MVP ötesi

Planlanmadı. Mimariyi bunlara açık tutmak için listelenir; taahhüt değildir.

| Madde                                        | Not                                                                                                                                            |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `[-]` E2E test suite (Playwright)            | UI şekli oturunca — [testing.md](testing.md)                                                                                                   |
| `[-]` Gantt / timeline view                  | `dueDate` + `estimatedMinutes` bunun için ayrı tutuluyor                                                                                       |
| `[-]` Task attachments                       | Object-storage ADR gerekir                                                                                                                     |
| `[-]` Board templates                        |                                                                                                                                                |
| `[-]` Public API tokens + `/v1` prefix       | 1.0 sonrası — [api-conventions.md](api-conventions.md#versiyonlama)                                                                            |
| `[-]` Webhooks                               |                                                                                                                                                |
| `[-]` E-posta bildirimleri                   | Transactional SMTP zaten var ([ADR 0013](decisions/0013-invitation-email-verification.md)); kalan, `Notification` satırlarını ona yönlendirmek |
| `[-]` Trello / Jira import                   |                                                                                                                                                |
| `[-]` Ek UI dil paketleri                    | Çözümleme mekanizması post-MVP’de geldi ([ADR 0018](decisions/0018-localization-strategy.md)). Kalan: ikinci locale                            |
| `[-]` Docker Compose ötesi self-host rehberi |                                                                                                                                                |
| `[-]` Due-soon teslim alternatifleri         | Nest interval scanner veya OS cron → internal HTTP                                                                                             |
| `[-]` Üye picker’sız mention’lar             | Düz `@DisplayName` veya API-only `mentionedUserIds[]`                                                                                          |
| `[-]` Activity feed realtime push            | Bell zaten `notification:unread-changed` alıyor; task activity hâlâ panel açılışında yükleniyor                                                |

**1.0.0**, REST API geriye uyumluluk vaat edecek kadar kararlı olduğunda kesilir (MVP özellik
işi zaten bitti).

## Ayrıca bakınız

- [archive/roadmap-mvp-phases.md](../archive/roadmap-mvp-phases.md) — tam faz checklist’leri (EN)
- [architecture.md](architecture.md) — modüller
- [git-strategy.md](git-strategy.md) — release
- [../../CHANGELOG.md](../../CHANGELOG.md) — ne yayınlandı
- [GitHub Issues](https://github.com/dravcore/kurultay/issues)
