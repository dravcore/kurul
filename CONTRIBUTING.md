# Kurul'a Katkıda Bulunma

Değişikliklerin nasıl önerileceği, geliştirileceği ve gönderileceği.

Kurul AGPL-3.0 lisanslıdır ([LICENSE](LICENSE) dosyasına bakın) ve katkıya açıktır: kod, doküman
ve çeviri hoş karşılanır; hata bildirimleri, özellik fikirleri ve tasarım geri bildirimi de öyle.
Proje 2026-08-21'e kadar dışarıdan gelen pull request'leri reddediyordu; bu karar, geçmişi ve
gerekçeyi kaydeden [ADR 0028](docs/decisions/0028-open-contributions-hosted-service.md) ile tersine
çevrildi.

## Davranış kuralları

Katılım [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) ile yönetilir. Bir issue ya da PR açmadan önce
okuyun.

## Katkıların lisansı

**Inbound = outbound.** Bir pull request açtığınızda katkınızı AGPL-3.0 altında lisanslamış
olursunuz: kod tabanının geri kalanının zaten taşıdığı ve her kullanıcının zaten sahip olduğu aynı
koşullar. Sizden bundan daha geniş hiçbir şey istenmez.

**Telif hakkınız sizde kalır.** Proje çalışmanızın sahipliğini almaz ve onu yeniden lisanslayamaz.
Çalışmanız sizin kalır; verdiğiniz şey projenin kendi lisansıdır, fazlası değil.

**CLA yok, DCO da yok.** İmzalanacak bir şey yok, pull request'inize yorum yapan bir bot yok,
işveren onay formu yok. Proje büyüyüp gerek duyarsa ileride bir `Signed-off-by` zorunluluğu
getirilebilir; bu, kimseye uygulanmadan önce bu dosyaya yazılır ve merge edilmiş işe asla geriye
dönük uygulanmaz.

**Bir PR açarak teyit ettiğiniz şey**, işi gönderme hakkınıza sahip olduğunuzdur: ya onu kendiniz
yazdınız ya da sahibi (bir işveren, bir upstream proje) onu AGPL-3.0 altında katkı olarak vermenize
izin veriyor. Şirket mesaisinde ya da şirket ekipmanıyla çalışıyorsanız ve emin değilseniz, pull
request review edilmeden önce bunu pull request'te belirtin.

## Katkıda bulunma yolları

| Tür                           | Nasıl                                                                          |
| ----------------------------- | ------------------------------------------------------------------------------ |
| Hata bildirimi                | [Bir hata bildirimi issue'su açın](.github/ISSUE_TEMPLATE/bug_report.yml)      |
| Özellik fikri                 | [Bir özellik isteği issue'su açın](.github/ISSUE_TEMPLATE/feature_request.yml) |
| Tasarım geri bildirimi        | Bir issue'ya yorum yazın ya da bir discussion açın                             |
| Kod                           | Önce bir issue bulun ya da açın, ardından `develop`'a karşı bir PR açın        |
| Doküman                       | Aynı; doküman Türkçe yazılır                                                   |
| Çeviri                        | Aynı; locale katalogları İngilizce ile key key eşleşmeye devam eder            |
| Yazım hatası / kırık bağlantı | Tek satırlık bir PR yeterli, issue gerekmez                                    |

Dokümantasyon yalnız Türkçedir ([ADR 0036](docs/decisions/0036-turkish-only-documentation.md)):
`docs/` altındaki dosyalar ve `README.md` Türkçe yazılır; güncellenecek bir İngilizce asıl ya da
ayna yoktur. Kod, kod yorumları, commit mesajları, dal adları ve PR başlıkları İngilizcedir. Bir
doküman başlığını değiştiren PR, o başlığın çapasına verilen bağlantıları da günceller (çapalar
Türkçe başlıktan türer; kod yorumlarından, compose dosyalarından ve `.env.example`'dan bu çapalara
bağlantı vardır).

## Issue-first kuralı

Uygulamadan önce önerin. Önemsiz olmayan bir işe başlamadan önce bir issue açın ya da mevcut olanı
bulun ve onaylanmasını bekleyin — bu, aynı işin iki kez yapılmasını ve kabul edilmeyecek
değişikliklere boşa harcanan review zamanını önler. Önemsiz düzeltmeler (yazım hataları, kırık
bağlantılar) doğrudan bir PR'a geçebilir.

## Geliştirme ortamı kurulumu

Monorepo'yu (`apps/api`, `apps/web`, Postgres, Redis) [docs/development.md](docs/development.md)
ile klonlayın, kurun ve çalıştırın — ortam değişkenleri, Compose, migration'lar ve günlük döngü için
oradan başlayın. Hızlı başlangıç ayrıca kökteki [README.md](README.md) içinde de yer alır.

## Branch'ler ve commit'ler

- `develop`'tan dallanın, `<type>/<short-description>` biçiminde adlandırın (ör. `feature/board-dnd`,
  `fix/task-position-rounding`)
- Commit mesajları [Conventional Commits](https://www.conventionalcommits.org/) kurallarını
  (`feat:`, `fix:`, `docs:`, ...) izler ve İngilizce yazılır

Tam branch modeli (Git Flow: `main` / `develop` / `feature/*` / `fix/*` / `docs/*` /
`chore/*` / `release/*` / `hotfix/*`) ve commit konvansiyonları:
[docs/git-strategy.md](docs/git-strategy.md).

## Kodlama yönergeleri

TypeScript/NestJS/Next.js kodu için konvansiyonlar: [docs/coding-standards.md](docs/coding-standards.md).
Test beklentileri: [docs/testing.md](docs/testing.md).

## Pull request açma

- **`develop`'u hedefleyin** (`release/*` / `hotfix/*` hariç; bunlar
  [docs/git-strategy.md](docs/git-strategy.md) dosyasını izler).
- **PR'ları küçük ve odaklı tutun.** PR başına 500 satırın altında değişiklik ve tek bir sorumluluk
  hedefleyin (lockfile'lar ve üretilen çıktı hariç). Mümkün olduğunda şema değişikliklerini logic
  değişikliklerinden, frontend'i backend'den ayırın.
- PR'ın ele aldığı issue'yu linkleyin.
- PR şablonundaki kontrol listesini doldurun (conventional başlık, ilgili yerlerde güncellenmiş
  doküman, lint/typecheck/test — CI yeşil olmalı).
- Bir fork'tan gelen pull request üzerindeki CI repository secret'ları olmadan çalışır; bu yüzden
  secret gerektiren bir job onun yerine merge sonrasında çalışır. PR'ınızda bir kontrol atlandıysa
  sebebi budur.
- Merge öncesinde **bir onaylayıcı review** olmasını bekleyin. Bu bir ayar değil, bir norm:
  `develop` ve `main` üzerindeki branch protection bugün sıfır onay gerektiriyor, tam da Kurul'un
  tek bir maintainer'ı olduğu ve _onun_ pull request'lerini review edecek kimse bulunmayacağı için.
  Protection'ın her iki branch'te, maintainer dahil herkes için gerçekten zorunlu kıldığı şeyler
  ise bir pull request, tabanıyla güncel bir branch, force push yok, silme yok ve iki yeşil
  context: `ci-ok` ve `CodeQL`. Dolayısıyla maintainer'ın açtığı PR'lar CI yeşile döndüğünde kendi
  kendine review edilir ve kendi kendine merge edilir; sizin PR'larınız her zamanki gibi review
  edilir; ve onay sayısı, ikinci bir maintainer var olduğu anda yeniden yükselir. `develop`'a merge
  commit (`--no-ff`) tercih edin, böylece çok commit'li history okunabilir kalır; `develop`'a
  squash, Dependabot / tek commit'lik gürültü için serbesttir. `main`'e squash asla serbest
  değildir — bkz. [docs/git-strategy.md](docs/git-strategy.md#merge-stratejisi).
- Review istemeden önce gürültülü fixup commit'lerini temizleyin (interactive rebase veya amend) —
  bunlar `develop`'a olduğu gibi iner.

## Yardıma mı ihtiyacınız var?

Bir [GitHub Discussion](https://github.com/dravcore/kurul/discussions) açın ya da ilgili issue'ya
yorum yazın.
