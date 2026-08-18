# Dokümantasyon

Kurul dokümanlarının beş dakikalık haritası. İngilizce kanoniktir; Türkçe kopyalar
[`tr/`](.) altında yaşar.

> 🌐 [English (canonical)](../README.md) | Türkçe — Bu çeviri güncel olmayabilir; kanonik kaynak İngilizce'dir.

## Buradan başlayın

| Ne istiyorsanız…                          | Okuyun                                                                                                   |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Ürün ne / hızlı başlangıç                 | [../../README.tr.md](../../README.tr.md)                                                                 |
| Sistem nasıl şekillendi                   | [architecture.md](architecture.md) · [design.md](design.md)                                              |
| Günlük kodlama                            | [development.md](development.md) · [coding-standards.md](coding-standards.md)                            |
| Kendi domain'inizde çalıştırmak           | [self-hosting.md](self-hosting.md)                                                                       |
| REST şekilleri ve hatalar                 | [api-conventions.md](api-conventions.md)                                                                 |
| Üretilen API spesifikasyonu               | [`apps/api/openapi.json`](../../apps/api/openapi.json) (İngilizce), veya çalışan bir instance'da `/docs` |
| Test'ler ve CI kapıları                   | [testing.md](testing.md)                                                                                 |
| Branch'ler, PR'lar, release'ler           | [git-strategy.md](git-strategy.md)                                                                       |
| Bir stack ya da politika kararının nedeni | [tech-stack.md](tech-stack.md) · [decisions/](decisions/)                                                |
| Ne bitti / ne ertelendi                   | [roadmap.md](roadmap.md)                                                                                 |

Kök topluluk dosyaları (`README.md`, `CONTRIBUTING.md`, `SECURITY.md`, `CHANGELOG.md`, …)
`docs/` dışında durur, çünkü GitHub bunlara özel davranır.

## Dil politikası

- Davranış, mimari ve süreç için **İngilizce kanoniktir**.
- Türkçe, aynı dosya adlarıyla `docs/tr/` altında yaşar; kökte `README.tr.md` kullanılır.
- EN ve TR çeliştiğinde önce EN düzeltilir, sonra TR senkronlanır. TR geride kalabilir;
  banner'lar bunu belirtebilir.

## Aktif dokümanlar

| Doküman                                    | Kapsam                                                                                                                 |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| [architecture.md](architecture.md)         | Modül haritası, veri modeli, runtime evrimi                                                                            |
| [tech-stack.md](tech-stack.md)             | Stack seçimleri ve gerekçesi (pin'ler: kök / app `package.json`'a bakın)                                               |
| [development.md](development.md)           | Env kurulumu, Compose, pnpm script'leri, günden güne, upgrade & rollback                                               |
| [self-hosting.md](self-hosting.md)         | Bir release'i kendi domain'inize deploy etmek: DNS, Caddy ile HTTPS, SMTP, backup'lar, kendi reverse proxy'niz         |
| [coding-standards.md](coding-standards.md) | TS / NestJS / Next.js konvansiyonları                                                                                  |
| [design.md](design.md)                     | UI/UX dili                                                                                                             |
| [git-strategy.md](git-strategy.md)         | Git Flow, Conventional Commits, release'ler                                                                            |
| [testing.md](testing.md)                   | Test katmanları ve beklentiler                                                                                         |
| [api-conventions.md](api-conventions.md)   | REST adlandırma, hatalar, pagination ve üretilen OpenAPI dokümanının nerede olduğu                                     |
| [cla.md](cla.md)                           | Katkıda Bulunan Lisans Anlaşması (**taslak**, kullanılmıyor — [ADR 0015](decisions/0015-no-external-contributions.md)) |
| [roadmap.md](roadmap.md)                   | MVP durumu ve beyond-MVP backlog'u                                                                                     |
| [decisions/](decisions/)                   | Mimari karar kayıtları (ADR'ler)                                                                                       |

## Tarihsel

| Doküman                                                                          | Durum                                                                                                                                   |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| [project-skeleton.md](project-skeleton.md)                                       | Stub → [../archive/project-skeleton.md](../archive/project-skeleton.md) (İngilizce); güncel yerleşim [architecture.md](architecture.md) |
| [../archive/roadmap-mvp-phases.md](../archive/roadmap-mvp-phases.md) (İngilizce) | Tam Faz 0–9 + hardening checklist'leri (`v0.1.0` öncesi detay)                                                                          |
| [../archive/specs/](../archive/specs/) (İngilizce)                               | Sevkedilmiş faz / visual-debt tasarım spec'leri                                                                                         |
| [../archive/plans/](../archive/plans/) (İngilizce)                               | Bitmiş implementasyon planları                                                                                                          |

MVP sonrası yeni özellik tasarımı bir **GitHub Issue** olarak açılır (kalıcı bir karar
gerektiğinde bir ADR ile birlikte). Rutin işler için paralel bir `docs/specs/` ağacı
büyütülmez.

## Arşiv politikası

`docs/archive/` günlük okuma için değildir; İngilizce kalır ve çevrilmez. Onun yerine
[roadmap.md](roadmap.md) ve [architecture.md](architecture.md) tercih edilir. CHANGELOG'a
bağlı bir yol taşındığında, aynı PR'da her `CHANGELOG.md` linki güncellenir.
