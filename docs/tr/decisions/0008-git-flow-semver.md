# 0008. Git Flow + Conventional Commits + SemVer

**Durum:** Kabul edildi
**Tarih:** 2026-08-08

> 🌐 [English (canonical)](../../decisions/0008-git-flow-semver.md) | Türkçe — Bu çeviri güncel olmayabilir; kanonik kaynak İngilizce'dir.

## Bağlam

Kurul, tek bir hosted SaaS instance'ını sürekli deploy etmek yerine, self-hosted bir ürünün versiyonlanmış release'lerini yayınlıyor. Branching modelinin, commit konvansiyonunun ve versiyonlama şemasının bu release şekline uyması gerekiyor.

## Karar

**Git Flow** (`main` / `develop` / `feature/*` / `fix/*` / `docs/*` / `chore/*` / `release/*` / `hotfix/*`) + **Conventional Commits** + **SemVer** + **Keep a Changelog** formatında bakımı yapılan bir `CHANGELOG.md`.

## Gerekçe

- GitHub Flow yerine seçildi çünkü proje, self-hosted bir ürünün versiyonlanmış release'lerini yayınlıyor: devam eden `develop` işinden bağımsız hareket edebilen stabil bir release hattına ve bir hotfix yoluna ihtiyacı var. GitHub Flow'un tek-main-branch modeli, sürekli deploy edilen SaaS'a bu şekilden daha iyi uyuyor.
- Conventional Commits, ileride changelog ve release otomasyonunu tetikleyebilecek yapılandırılmış bir commit geçmişi üretiyor.
- SemVer, versiyonlar arasında yükselen self-hoster'lara uyumluluk beklentilerini iletiyor.
- Keep a Changelog, `CHANGELOG.md`'yi insan-okunabilir ve tutarlı biçimde yapılandırılmış tutuyor (Added / Changed / Fixed / vb.).
- **Emsallerden bilinçli sapma:** birçok büyük OSS proje, `CHANGELOG.md`'yi atlayıp yalnızca GitHub Releases'e güveniyor. Kurul ikisini bilinçli olarak senkron tutuyor — repodaki bir changelog dosyası, clone'larından çıkmadan geçmişi tarayan self-hoster'lar için daha erişilebilir.
- Maintainer'ın mevcut ev stiliyle eşleşiyor: `main`/`develop` artı tipli branch önekleri (`feature/`, `fix/`, `docs/`, `chore/`, `release/`, `hotfix/`) zaten maintainer'ın kendi repolarında kullanılan desen, süreç-değiştirme maliyetini en aza indiriyor.

## Sonuçlar

- "Geliştirme aşamasında" (`develop`) ile "release edilmiş ve stabil" (`main`) arasında net bir ayrım.
- Devam eden özellik işini bozmayan bir hotfix yolu mevcut.
- CHANGELOG.md ve SemVer birlikte, self-hoster'lara net upgrade rehberliği veriyor.
- Solo/küçük bir ekip için GitHub Flow'a göre daha fazla branch ve süreç yükü.
- `CHANGELOG.md` ve GitHub Releases'i senkron tutmak, zorlanmadıkça sürüklenebilecek elle yapılan bir disiplin (örn. bir PR checklist maddesi).
- Git Flow'un release-branch töreni, release'lerin sık ve gayriresmi olabileceği 1.0 öncesinde ağır hissettirebilir.

## Değerlendirilen Alternatifler

| Alternatif                                  | Neden değil                                                                                                                                           |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| GitHub Flow                                 | Sürekli deploy edilen SaaS'a uyuyor; stabil release hatlarına ve hotfix'lere ihtiyaç duyan versiyonlanmış self-hosted bir ürüne uymuyor               |
| Trunk-based development                     | Aynı uyumsuzluk — release stabilizasyonu veya eski versiyonlara karşı hotfix'ler için doğal bir yer yok                                               |
| Yalnızca GitHub Releases (CHANGELOG.md yok) | Yaygın bir emsal deseni, ama repoyu doğrudan tarayan self-hoster'lar için daha az erişilebilir; yukarıdaki bilinçli-sapma gerekçesine göre reddedildi |
