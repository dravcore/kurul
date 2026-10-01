# Trello export fixture'ları

**Bu dizinin doğrudan altındaki dosyalar sentetiktir; `real/` altındakiler değildir.** Üst düzey
fixture'lar bu repository'de 2026-08-15 tarihinde, Trello'nun export biçimine dair hafızadan elle
yazıldı ve o tarihte hiçbir şeye karşı doğrulanmadı. `real/` dizini, 2026-08-22 tarihli,
anonimleştirilmiş iki **gerçek** Trello export'u tutar — aşağıdaki
[Gerçek export'lar](#gerçek-exportlar) bölümüne ve [`real/README.md`](real/README.md) dosyasına
bakın. Sentetik dosyalara karşı geçen bir testi, importer'ın Trello'nun gerçek çıktısını
işleyebildiğinin kanıtı saymayın; o kanıt `real/` ile onun e2e spec'inin işidir.

Bu ayrım, bu dosyanın onunla başlamasının tek sebebidir. Trello'nun export şemasında sürüm alanı da
yok, değişiklik kaydı da; dolayısıyla "Trello importer'ı çalışıyor" bir tarih hakkında ve o tarihte
elde olan dosyalar hakkında bir iddiadır. 2026-08-15'te elde gerçek bir export yoktu: bu projeyi
yürüten kişinin o sırada export edecek Trello verisi yoktu. Uydurma bir JSON dosyasına
`real-1.json` demek, fixture'ların kendi hayal gücümüzü ölçmesine ve sonucun
"doğrulandı" diye etiketlenmesine yol açardı — aşağıdaki sentetik fixture'lar bu yüzden uç durumlar
ve tam bir board olarak adlandırılmış kalır, asla `real-*` olarak değil.

İki gerçek Trello export'una karşı doğrulama isteyen roadmap metriği, `real/` altındaki iki dosya
girip `trello-import-real.e2e-spec.ts` testinden uçtan uca geçtiği 2026-08-22'de kapandı. Aşağıdaki
alan eşleme farklarına bir satır daha eklenmesi anlamında, gerçek bir export bu repository'nin
öngörmediği bir şekil gösterdiği bir sonraki sefer — maintainer'dan ya da bir topluluk bug
raporundan — yeniden açılır; o noktada **kazanan export'tur, bu repository değil**.

## Importer bu konuda ne yapıyor

Hiçbir alan adı 2026-08-22'ye kadar gerçek bir export'a karşı doğrulanmadığı için okuyucunun
sözleşmesi "Trello şemasını biliyorum" değil, **"bilmediğimi bildiririm"**
(`apps/api/src/import/trello-export.ts`,
[ADR 0025](../../../../../docs/decisions/0025-trello-import-mapping.md)). Eksik bir alan, beklenmedik
tipte bir alan ya da okuyucunun temsil edemediği bir girdi, import'un `(scope, reason)` raporuna
düşer ve okuma devam eder. Yalnızca iki şey hatadır: hiç JSON olmayan bir gövde ve bir board
export'una benzemeyen bir kök nesne.

`edge-unknown-shape.json`, bu sözleşmeyi sabit tutmak için vardır. Bir şema kaymasının neye
benzeyeceğini gösteren fixture odur ve onu okuyan testler iki yarıyı da doğrular: okunabilen satırlar
aktarılır, _ve_ okunamayanlar hata olarak fırlatılmak yerine raporlanır.

## Fixture'lar

| Fixture                     | Yazıldı    | Nedir                                                                                                                                                                                                                                                    | Gerçek mi? |
| --------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| `synthetic-full-board.json` | 2026-08-15 | Dört liste (biri arşivlenmiş), altı kart (biri arşivlenmiş, biri isimsiz), beş label (biri isimsiz, biri renksiz, biri bilinmeyen renkte), iki karta yayılmış üç checklist, üç ek (http, https, `file:`), iki yorum ve yorum olmayan bir action, iki üye | hayır      |
| `edge-empty-board.json`     | 2026-08-15 | Hiç listesi ve hiç kartı olmayan bir board                                                                                                                                                                                                               | hayır      |
| `edge-empty-list.json`      | 2026-08-15 | Bir liste, içinde hiç kart yok                                                                                                                                                                                                                           | hayır      |
| `edge-unknown-color.json`   | 2026-08-15 | `tangerine`, `null` ve `sky_light` renkli label'lar                                                                                                                                                                                                      | hayır      |
| `edge-unknown-shape.json`   | 2026-08-15 | Doğru kök, geri kalan her şey yanlış — aşağıdaki listeye bakın                                                                                                                                                                                           | hayır      |
| `edge-card-export.json`     | 2026-08-15 | Trello'nun _kart_ export'u — geçerli JSON, bir `name` taşıyor, board değil                                                                                                                                                                               | hayır      |
| `edge-truncated.json`       | 2026-08-15 | Nesnenin ortasında kesilmiş geçerli bir export; **bilerek geçerli JSON değil**                                                                                                                                                                           | hayır      |

`synthetic-full-board.json` bir uç durum değildir ve öyle adlandırılmamıştır. Sıradan bir board'u
anlatan tek sentetik fixture odur; bu yüzden eşleme testleri onun üzerinde koşar — bu da onun
kusurlarının eşleme testlerinin kusurları olduğu anlamına gelir ve bunlar açılış paragraflarının
anlattığı kusurlardır: elle yazılmış olması ve `real/` var olana kadar hiçbir şeye karşı
doğrulanmamış olması.

İçindeki birkaç şey tesadüfi değil bilinçlidir, çünkü her birine bir test bağlıdır:

- **Listeler dosyada `pos` sırasında değildir.** `Backlog` (16384), `In Progress` (32768)
  listesinden sonra yazılmıştır. Aksi halde diziyi olduğu gibi döndüren bir okuyucu ile onu sıralayan
  bir okuyucu birbirinden ayırt edilemezdi.
- **`pos` değerleri Trello ölçeğindedir** (16384, 32768, 65535) ve bu repository'nin 1000 olan
  `POSITION_GAP` değerine hiç yakın değildir; böylece bir test, yeniden atanmış bir pozisyonu
  taşınmış olandan sayıya bakarak ayırt edebilir.
- **Ek URL'lerinden biri `file:` şemalıdır.** Asla bir `Attachment` satırına dönüşmemelidir.
- **Action'lardan biri `commentCard` değildir.** Yorum sayısı, action sayısı değil yorum sayısı
  olmalıdır.
- **Bir label'ın adı boş, bir başkasının rengi yoktur**; ADR 0025'in sırasıyla bir ad ve bir renk
  uydurmak zorunda kaldığı iki durum bunlardır.

## `edge-unknown-shape.json` içinde neyin yanlış olduğu

İçindeki her girdi, okuyucuya uygulanan bir mutasyon onsuz hayatta kaldığı için vardır — yani
okuyucu tam o belirli biçimde bozulabiliyordu ve bütün testler yeşil kalıyordu. Fixture baştan
tasarlanmak yerine o çalışma sırasında büyüdü ve o sırayla tutulmaya değer: aşağıdaki her madde,
suite'in daha önce göremediği bir bug'dır.

- Bir liste olması gereken yerde çıplak bir sayı ve hiç `id` alanı olmayan bir liste.
- `name` alanı bir dizi **ve** `closed` alanı bir string olan bir liste — okuyucunun okunamayan
  _alanları_ değil okunamayan _girdileri_ saydığını kanıtlayan girdi.
- Tek sorunu `closed: "true"` olan bir liste. O olmadan, sessizce tip dönüştüren bir `closed`
  kontrolü fark edilmeden kalıyordu ve arşivlenmiş bir listenin canlı bir sütun olarak gelmesi eksik
  değil yanlış bir import'tur.
- Aksi halde sorunsuz bir listede `pos: "bottom"`; bu **raporlanmamalıdır**: ADR 0025, sayısal
  olmayan bir `pos` değerinin id sırasına düştüğüne zaten karar verdi.
- Nesne olarak `labels`, string olarak `members`, nesne olarak `actions` — üç bölümün tamamı
  kayboluyor, her biri için birer rapor satırı.
- `idLabels` alanı bir string olan bir kart, kullanılabilir bir `url` alanı olmayan bir ek taşıyan
  bir kart, `due` alanı bir ISO string yerine epoch sayısı olan bir kart ve çıplak bir string olan
  bir girdi. `due` olanı oradadır, çünkü yanlış bir tipi yutan nullable bir alan okuyucudaki en
  sessiz arızadır: kullanıcı bir bitiş tarihini kaybeder ve hiçbir şey duymaz.
- Okunamayan bir öğesi olan bir checklist (öğe olarak raporlanır, böylece okunabilen öğeler kalır)
  ve `checkItems` alanı bir string olan bir checklist (checklist olarak raporlanır).

`edge-truncated.json`, repository'nin `.prettierignore` dosyasında listelidir, çünkü bilerek geçersiz
bir JSON'dur ve aksi halde `prettier --check` onda başarısız olurdu. O girdi yük taşır: biri
formatter mutlu olsun diye dosyayı "düzeltirse", yarım inmiş bir export'a çökmek yerine 400 cevabı
verildiğini kanıtlayan test yanlış sebeple geçmeye başlar.

## Gerçek export'lar

`v0.3.0` kapısı, uçtan uca import edilen en az iki anonimleştirilmiş gerçek export istiyordu
(`ROADMAP.md`, şimdi [MVP ötesi](../../../../../ROADMAP.md#mvp-ötesi) altındaki
Trello / Jira'dan import satırı) ve 2026-08-22'de kapandı: `real/` dizini
`starter-guide-board.json` (Trello'nun kendi varsayılan "Starter Guide" board'u) ve
`eleven-list-board.json` (aynı gün export edilmiş on bir listeli bir board) dosyalarını tutar ve
ikisi de `trello-import-real.e2e-spec.ts` üzerinden temiz şekilde import edilir.

**Neredeler.** [`real/`](real/README.md). `trello-import-real.e2e-spec.ts`, o dizindeki her `*.json`
dosyasını modül yüklenirken okur ve her birini bir admin olarak `POST /workspaces/:id/imports/trello`
üzerinden import eder; beklenen sayıları dosyadan ADR 0025'in kurallarıyla türetir ve bunları hem
raporla hem de veritabanıyla karşılaştırır. Dizin bir gün yeniden boşalırsa spec tam olarak bir
atlanmış test bildirir, `no anonymised real Trello exports in fixtures/trello/real yet (v0.3.0 gate)`;
içinde iki dosya varken ise dosya başına bir test koşar.

**Bir tane daha nasıl eklenir.**

1. Trello'da board menüsünü açın: **More**, **Print and export**, **Export as JSON**.
2. `node scripts/anonymise-trello-export.mjs ~/Downloads/board.json apps/api/test/fixtures/trello/real/<name>.json --seed <anything>`.
   Betik, export'un yapısını bayt bayt korur (anahtarlar, sıra, uzunluklar, null'lar, sayılar,
   tarihler, renkler, `closed` bayrakları, id ilişkileri) ve her metin parçasını aynı uzunlukta ve
   şekilde deterministik bir takma adla değiştirir. Trello id'leri sekiz karakterlik zaman damgası
   ön eklerini ve sıralama düzenlerini korur, çünkü planner eşitlik durumunda onlara düşer.
3. Yazdırdığı özeti okuyun: tanınmayan üst düzey anahtarlar ve betiğin metin taşıdığını bilmediği
   anahtarlar altında değiştirilen string'ler metin olarak anonimleştirildi; bu güvenlidir ama metin
   olmayan bir değerin şeklini değiştirmiş olabilir. Dosyayı push etmeden önce bir kez göz gezdirin;
   o andan itibaren herkese açıktır.
4. `pnpm --filter @kurul/api test:e2e` komutunu çalıştırın, neyin başarısız olduğunu okuyun ve
   aşağıya bir satır ekleyin.

`real/*.json` bilerek `.prettierignore` içinde listelenmiştir: o dosyalar betiğin bayt bayt çıktısıdır
ve onları yeniden biçimlendirirsek "betiğin yazdığı dosya" ile "repo'daki dosya" iki ayrı şey olurdu.

Anonimleştiricinin importer'ın okuduğu hiçbir şeyi değiştirmediğini güvence altına alan koruma, ne
olursa olsun her CI koşusunda çalışır: aynı spec, `synthetic-full-board.json` dosyasını CLI üzerinden
anonimleştirir ve iki import'un şekil bakımından birebir aynı raporu ve aynı board'u ürettiğini
doğrular.

### Alan eşleme farkları

Gerçek bir export'un sentetik fixture'ların varsaydığıyla uyuşmadığı her yer için bir satır. `real/`
altındaki iki dosya da `apps/api/src/import/trello-export.ts` dosyasının okuduğu her alana karşı
denetlendi.

| Alan                                                                                                                                                                                                                                                           | Sentetik fixture varsayımı                                                                                                                                                                                   | Gerçek export'un gösterdiği                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Gereken importer değişikliği |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------- |
| Okuyucunun dokunduğu her alan: `lists[].{id,name,pos,closed}`, `cards[].{id,name,desc,idList,pos,closed,due,idLabels,idMembers,attachments[].{id,name,url}}`, `labels[].{id,name,color}`, `checklists[].{id,idCard,name,pos,checkItems[].{id,name,state,pos}}` | `trello-export.ts` ve ADR 0025'in zaten varsaydığı tipler ve şekiller (string id'ler, sayısal `pos`, boolean `closed`, nullable `desc`/`due`/`color`, aramadan önce atılan bir `_dark`/`_light` renk soneki) | İki dosyada da eşleşti; adı anılmaya değer iki şekil var, çünkü sentetik fixture'ın sınamadığı varsayımları sınıyorlar: `lists[].pos` bazen kesirlidir (`32767.5`, `49151.25`; yalnızca Trello'nun klasik ikinin kuvvetleri değil) ve `labels[].color`, `purple_light` taşır — sentetik fixture'ın zaten kapsadığı `_dark` sonekinin yanında `_light` soneki. `labels[].name`, Trello'nun kendi isimsiz varsayılan label'larında `""` değerini taşır, `cards[].due` iki dosyadaki her kartta `null`'dır ve `checklists[].checkItems[].state` `"incomplete"` string'idir (iki dosyada da tamamlanmış bir öğe bulunmuyor). İki export de arşivlenmiş bir liste ya da kart içermez (`closed` baştan sona `false`'tur), bu yüzden arşiv yolu hâlâ yalnızca sentetik fixture ile sınanır. | yok                          |

Importer'ın okuduğu hiçbir alan kod değişikliği gerektirmedi. İki export de okuyucunun hiç bakmadığı
yüzün çok üzerinde alan taşıyor — aralarında `nodeId`,
`creationMethod`/`creationMethodError`/`creationMethodLoadingPhase`/`creationMethodLoadingStartedAt`,
`premiumFeatures`, `pluginData[]` (ve `access`/`scope` alt alanları), `cards[].badges` (iki dosyada
da daima `""` olan `badges.fogbugz` dahil) ve `cards[].originalName`/`originalDesc` da var. Bunlar
tam olarak ADR 0025'in tasarım gereği kapsam dışı dediği türden alanlardır ve anonimleştiricinin
özeti, metin taşıdığını bilmediği alanları işaretler; böylece bir maintainer dosya push edilmeden
önce onlara göz gezdirebilir; hiçbiri import'tan sonra bir board'un nasıl göründüğünü değiştirmez.
