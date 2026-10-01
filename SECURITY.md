# Güvenlik Politikası

Kurul'daki bir güvenlik açığının nasıl bildirileceği.

## Desteklenen sürümler

Kurul 1.0 öncesi aşamadadır: güvenlik düzeltmelerini yalnızca en son `0.y` release alır. Bunun
ötesinde bir destek matrisi yoktur — kapsam içinde kalmak için en son release'e yükseltin.
Halihazırda yayımlanmış bir sürüm için düzeltme, `main`'e merge edilen ve `develop`'a geri-merge
edilen bir `hotfix/*` branch'i olarak çıkar; henüz yayımlanmamış bir şey için düzeltme `develop`'a
sıradan bir `fix/*` branch'i olarak girer ve bir sonraki release ile birlikte çıkar. İkisi de
doğrudan commit değildir: `main` ve `develop` korumalıdır ve güvenlik düzeltmeleri dahil her
değişiklik bir pull request üzerinden gelir. Bkz. [docs/git-strategy.md](docs/git-strategy.md).

## Güvenlik açığı bildirme

Lütfen güvenlik açıkları için herkese açık bir GitHub issue'su **açmayın**.

Aşağıdakilerden biriyle özel olarak bildirin:

1. **[GitHub Security Advisories](https://github.com/dravcore/kurul/security/advisories/new)**
   (tercih edilen) — varsayılan olarak özeldir, tartışmayı ve varsa düzeltmeyi tek bir yerde tutar.
2. **E-posta**: developer@dogancanyildiz.com

Elinizden geleni ekleyin: etkilenen bileşen, yeniden üretme adımları, etki ve varsa önerdiğiniz
düzeltme.

## Yanıt beklentileri

Kurul şu anda tek bir maintainer tarafından sürdürülüyor. Henüz garanti edilen bir SLA yok — birkaç
gün içinde ilk bir teyit bekleyin ve düzeltme süreleri konusunda sabırlı olun. Sorunun ciddiyeti ve
ulaşılabilirliği, nasıl önceliklendirileceğini belirler.

## İfşa

Herkese açık herhangi bir ifşadan önce, maintainer'a inceleme yapması ve bir düzeltme yayımlaması
için makul bir süre tanıyın. Koordineli ifşa, bir bildirim teyit edildikten sonra birlikte
kararlaştırılır.
