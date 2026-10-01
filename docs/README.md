# Dokümantasyon

Kurul dokümanlarının beş dakikalık haritası. Dokümantasyon yalnız Türkçedir; ayrıntı
[Dil politikası](#dil-politikası) bölümünde.

## Buradan başlayın

| Ne istiyorsanız…                          | Okuyun                                                                                                |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Ürün ne / hızlı başlangıç                 | [../README.md](../README.md)                                                                          |
| Sistem nasıl şekillendi                   | [architecture.md](architecture.md) · [design.md](design.md)                                           |
| Günlük kodlama                            | [development.md](development.md) · [coding-standards.md](coding-standards.md)                         |
| Kendi domain'inizde çalıştırmak           | [self-hosting.md](self-hosting.md)                                                                    |
| REST şekilleri ve hatalar                 | [api-conventions.md](api-conventions.md)                                                              |
| Üretilen API spesifikasyonu               | [`apps/api/openapi.json`](../apps/api/openapi.json) (İngilizce), veya çalışan bir instance'da `/docs` |
| Test'ler ve CI kapıları                   | [testing.md](testing.md)                                                                              |
| Branch'ler, PR'lar, release'ler           | [git-strategy.md](git-strategy.md)                                                                    |
| Bir stack ya da politika kararının nedeni | [tech-stack.md](tech-stack.md) · [decisions/](decisions/)                                             |
| Ne bitti / ne ertelendi                   | [../ROADMAP.md](../ROADMAP.md)                                                                        |

Kök topluluk dosyaları (`README.md`, `CONTRIBUTING.md`, `SECURITY.md`, `CHANGELOG.md`, …)
`docs/` dışında durur, çünkü GitHub bunlara özel davranır.

## Dil politikası

- Dokümantasyon **yalnız Türkçedir**. Karar
  [ADR 0036](decisions/0036-turkish-only-documentation.md)'dadır.
- Dosya adları ve yolları değişmez: İngilizce kebab-case kalır.
- Ürünün arayüz dilleri ayrı bir konudur: [ADR 0018](decisions/0018-localization-strategy.md).
- Kod, kod yorumları, test adları, commit mesajları, dal adları, PR başlıkları, API hata metinleri ve
  OpenAPI açıklaması İngilizcedir.
- `CHANGELOG.md` içinde `[0.4.1]` ve öncesi kayıtlar yayımlandıkları dilde, yani İngilizce kalır ve
  çevrilmez; `[Unreleased]` ve sonrası Türkçe yazılır.
- Bir doküman başlığını değiştiren PR, o başlığın çapasına verilen bağlantıları da günceller (çapalar
  Türkçe başlıktan türer; kod yorumlarından, compose dosyalarından ve `.env.example`'dan bu çapalara
  bağlantı vardır).

## Aktif dokümanlar

| Doküman                                    | Kapsam                                                                                                         |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| [architecture.md](architecture.md)         | Modül haritası, veri modeli, runtime evrimi                                                                    |
| [tech-stack.md](tech-stack.md)             | Stack seçimleri ve gerekçesi (pin'ler: kök / app `package.json`'a bakın)                                       |
| [development.md](development.md)           | Env kurulumu, Compose, pnpm script'leri, günden güne, upgrade & rollback                                       |
| [self-hosting.md](self-hosting.md)         | Bir release'i kendi domain'inize deploy etmek: DNS, Caddy ile HTTPS, SMTP, backup'lar, kendi reverse proxy'niz |
| [coding-standards.md](coding-standards.md) | TS / NestJS / Next.js konvansiyonları                                                                          |
| [design.md](design.md)                     | UI/UX dili                                                                                                     |
| [git-strategy.md](git-strategy.md)         | Git Flow, Conventional Commits, release'ler                                                                    |
| [testing.md](testing.md)                   | Test katmanları ve beklentiler                                                                                 |
| [api-conventions.md](api-conventions.md)   | REST adlandırma, hatalar, pagination ve üretilen OpenAPI dokümanının nerede olduğu                             |
| [../ROADMAP.md](../ROADMAP.md)             | Yol haritası: sağlamlaştırma + özellik hatları, beyond-MVP backlog'u                                           |
| [decisions/](decisions/)                   | Mimari karar kayıtları (ADR'ler)                                                                               |

MVP sonrası yeni özellik tasarımı bir **GitHub Issue** olarak açılır (kalıcı bir karar
gerektiğinde bir ADR ile birlikte). Rutin işler için paralel bir `docs/specs/` ağacı
büyütülmez.
