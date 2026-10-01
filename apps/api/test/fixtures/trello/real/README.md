# Anonimleştirilmiş gerçek Trello export'ları

Bu dizindeki her `*.json` dosyası, commit edilmeden önce `scripts/anonymise-trello-export.mjs`
betiğinden geçmiş **gerçek** bir Trello board export'udur. Burada hiçbir şey elle yazılmış değildir:
dizinin amacı, yapısının Trello'dan gelmesi, bu repository'nin Trello hakkındaki hafızasından
gelmemesidir (bkz. [`../README.md`](../README.md) ve
[ADR 0025](../../../../../../docs/decisions/0025-trello-import-mapping.md)).

Anonimleştirici export'un şeklini bayt bayt korur (anahtarlar, anahtar sırası, dizi uzunlukları,
null'lar, boolean'lar, sayılar, tarihler, renkler, `closed` bayrakları, her id ilişkisi) ve her
metin parçasını aynı uzunlukta ve şekilde deterministik takma adlarla değiştirir. Importer'ın
okuduğu şey değişmez; bir insanın yazdığı şey gider.

## Fixture'lar

| Fixture                    | Board                                                                            | Seed    | Export edildi | Sayılar                                                              |
| -------------------------- | -------------------------------------------------------------------------------- | ------- | ------------- | -------------------------------------------------------------------- |
| `starter-guide-board.json` | Trello'nun kendi varsayılan "Starter Guide" board'u                              | `kurul` | 2026-08-22    | 4 liste, 7 kart, 6 label, 7 checklist / 22 öğe, 6 ek, 1 üye, 0 yorum |
| `eleven-list-board.json`   | On bir listeli bir board, kapsanan şekli genişletmek için aynı gün export edildi | —       | 2026-08-22    | 11 liste, 11 kart, 6 label, 0 checklist, 14 action                   |

İkisi de `trello-import-real.e2e-spec.ts` üzerinden uçtan uca temiz şekilde import edilir; ortaya
çıkardıkları alan eşleme farkları (hiçbiri okuyucunun kullandığı bir alanda değil)
[`../README.md`](../README.md#alan-eşleme-farkları) içinde kayıtlıdır.

## Yenisini eklemek

1. Trello'da: board menüsü, **More**, **Print and export**, **Export as JSON**. Dosyayı kaydedin.
2. Anonimleştiriciyi çalıştırın; takma adların orijinalden yeniden üretilebilir olmasını
   istemiyorsanız kendi seed'inizle:

   ```bash
   node scripts/anonymise-trello-export.mjs ~/Downloads/board.json \
     apps/api/test/fixtures/trello/real/<short-name>.json --seed <anything>
   ```

3. Yazdırdığı özeti okuyun. Tanınmayan bir üst düzey anahtar ya da betiğin metin taşıdığını
   bilmediği bir anahtar altında değiştirilmiş bir string, commit etmeden önce göz atmaya değer:
   değer anonimleştirildi (güvenli varsayılan), ama metin olmayan bir değer şeklini kaybetmiş
   olabilir. Sayılar olduğu gibi korunur, bu yüzden Map power-up'ını kullanmış bir board
   `coordinates` alanını da olduğu gibi taşır.
4. Çıktıya, betiğin kişisel olduğunu bilemeyeceği herhangi bir şey için göz gezdirin. Dosya push
   edildiği anda herkese açıktır.
5. [`../README.md`](../README.md) içindeki fixture tablosuna bir satır ekleyin ve ilk koşudan sonra
   oradaki **Alan eşleme farkları** tablosunu doldurun.

Dosyayı `TRELLO_IMPORT_MAX_BYTES` altında tutun (varsayılan 20 MiB): harness onu gerçek endpoint
üzerinden production limitiyle import eder ve limiti yükseltmez, çünkü sığmayan bir gerçek export
bir bulgudur, test kurulumu sorunu değil. Birkaç yüz kartlı bir board birkaç megabayttır. Betik
çıktıyı girdinin biçimlendirildiği şekilde yazar, bu yüzden Trello'nun minify edilmiş tek satırı tek
satır kalır; export'u önce pretty-print etmeyin, bu tek başına boyutunu yarısı kadar artırır.

## Onu ne okuyor

`apps/api/test/trello-import-real.e2e-spec.ts`, buradaki her `*.json` dosyasını modül yüklenirken
alır ve her birini bir admin olarak `POST /workspaces/:id/imports/trello` üzerinden uçtan uca import
eder. Beklenen sayılar dosyanın kendisinden ADR 0025'in belirttiği kurallarla türetilir (arşivlenmiş
listeler ve kartlar atlanır, isimsiz olanlar malformed sayılır, ekler şemaları `http` ya da `https`
olduğunda link'e dönüşür, yorumlar ve üyeler sayılır ve düşürülür) ve hem import raporuyla hem de
veritabanındaki satırlarla karşılaştırılır. Bir başarısızlık mutlaka testteki bir bug değildir:
Trello'nun şeması ile bu repository'nin onun hakkındaki fikri arasındaki farkın ilk göründüğü
yerdir ve kazanan export'tur. Bulduğunuzu farklar tablosuna kaydedin ve importer'ı düzeltin.

Bu dizin bir gün yeniden hiç `*.json` içermezse, o spec
`no anonymised real Trello exports in fixtures/trello/real yet (v0.3.0 gate)` adlı tam olarak bir
atlanmış test bildirir; böylece açık bir kapı, hiçbir şey göstermemek yerine her CI koşusunda görünür
kalır. Yukarıdaki iki dosya yerindeyken ise dosya başına bir test koşar.
