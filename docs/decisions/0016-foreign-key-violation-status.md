# 0016. Yabancı Anahtar İhlalleri 422'ye Değil 409'a Eşlenir

**Durum:** Kabul edildi
**Tarih:** 2026-08-12

> 🌐 [English (kanonik)](../../decisions/0016-foreign-key-violation-status.md) | Türkçe (bu çeviri güncel olmayabilir; kanonik kaynak İngilizce'dir)

## Bağlam

`AllExceptionsFilter`, bir servisten dışarı sızabilen üç Prisma hata kodunu HTTP durumlarına
çevirir: `P2002` (tekillik ihlali) → `409`, `P2025` (kayıt bulunamadı) → `404` ve `P2003`
(yabancı anahtar kısıtı ihlali) → `409`. `P2003` satırının testi yoktu ve bir tech-debt
denetim geçişi, var olmayan bir satırı adlandıran bir isteğin "iyi biçimlendirilmiş ama
anlamsal olarak geçersiz" olduğu okumasıyla — ki `docs/api-conventions.md`'nin `422`'ye
verdiği ifadenin tam olarak bu olduğu — bunun `422 Unprocessable Entity`'ye çevrilmesini
önerdi.

Eşlemeyi bir testle kilitlemek, önce hangi kodun doğru olduğuna karar vermeyi gerektirdi:
yanlış duruma karşı yazılmış bir test, doğru sözleşmeyi korumak yerine yanlışını
çimentolardı.

## Karar

`P2003`, **`409 Conflict`**'e eşlenir. Denetimin `422` önerisi reddedilmiştir. Durum artık
`all-exceptions.filter.spec.ts` içindeki iki testle kapsanıyor; bu testler ayrıca veritabanı
kısıt adının yanıt gövdesine asla ulaşmadığını da doğrular.

## Gerekçe

**Bu şemanın üretebileceği her `P2003`, istek gövdesindeki bir hata değil, veritabanı
durumuyla çakışmadır.** Kod tam olarak iki biçimde gelir:

- **Engellenmiş bir silme.** `WorkspaceMember.user`, `Task.createdBy`, `TaskAssignee.user`,
  `Comment.user` ve `Activity.user` alanlarının hepsi `onDelete: Restrict` taşır. Hâlâ bir
  şeyin referans verdiği bir satırı kaldırmak `P2003` doğurur. İstek tamamen geçerlidir;
  onu reddeden şey veritabanının o anki durumudur. Bu, ders kitabı `409` örneğidir — ve
  zaten `409`'a eşlenen `P2002` ile aynı kategoridedir.
- **Kaybedilmiş bir yarış.** Servisler, yazmadan önce referans verilen satırın var olduğunu
  ve workspace içinde olduğunu doğrular. Dolayısıyla insert sırasındaki bir `P2003`, satırın
  kontrol ile yazma arasında silindiği anlamına gelir. Yeniden denemek pekâlâ başarılı
  olabilir; `409`'un ilettiği, `422`'nin ise reddettiği şey budur.

**Bu API'de `422` alan bazlı bir yanıttır ve filtrenin verecek alanı yoktur.**
`docs/api-conventions.md`, `details`'i "yalnızca `400`/`422` için mevcut" diye belgeler — bir
`422`, istemcinin alan alan okuduğu biçimdir. Filtrenin elinde yalnızca Prisma'nın
`meta.field_name` değeri vardır; bu da bir DTO yolu değil, bir veritabanı tanımlayıcısıdır
(`Task_createdById_fkey (index)`). `details` içermeyen bir `422` üretmek ya da `details`
içine bir şema kısıt adı koymak, hata sözleşmesini her iki yönde de bozar.

**API'nin gerçek `422` durumu bilinçlidir ve asla filtreden gelmez.** Sözleşmenin kendi
örneği — bir task'ı başka bir board'un kolonuna taşımak — servis içinde kontrol edilir ve
servis durumu doğru bir mesajla kendisi fırlatır. Exception filtresine ulaşmak, uygulama
seviyesindeki kontrolün ateşleyen şey _olmadığı_ anlamına gelir; bunu bir doğrulama hatası
saymak, sorunun nerede olduğunu yanlış bildirir.

**Son çare eşlemesi muhafazakâr olmalıdır.** Filtre, hiçbir servisin öngörmediği hatalar için
bir güvenlik ağıdır. `409` "durum çakıştı, bu geçici olabilir" der; `422` ise "girdin yanlış,
yeniden deneme" der. İkisinden, gerçek bir yarış durumunda istemciye gövdesinin yanlış
olduğunu söylemek daha yanıltıcı olan başarısızlıktır.

## Sonuçlar

- `docs/api-conventions.md` değişikliğe ihtiyaç duymaz: "çakışan eşzamanlı bir değişiklik"
  ifadesi `P2003`'ün her iki biçimini de kapsar ve oradaki hiçbir ifade bir yabancı anahtar
  hatasının `422` olduğunu ima etmez.
- Engellenmiş bir silme, `409 Conflict` ile `"Related resource conflict"` yanıtı verir —
  bilinçli olarak genel. Hedefe hâlâ _hangi_ satırların referans verdiğini söylemez, çünkü
  bunu bir tenant sınırı boyunca söylemek varlık sızdırır. Belirli, eyleme dönük bir mesaj
  isteyen bir endpoint (örneğin "önce bu üyenin task'larını devret") bağımlıları kendisi
  kontrol edip kendi exception'ını fırlatmalıdır; filtreye yaslanmamalıdır.
- Eşleme yalnızca filtreye karşı birim testleriyle koşturulur. API'deki hiçbir HTTP rotası
  istek üzerine `P2003` üretmeye zorlanamaz — erişilebilir her yol referanslarını önce
  doğrular, ki amaç da budur — dolayısıyla bir entegrasyon testi de hatayı taklit etmek
  zorunda kalırdı.
- İleride bir endpoint, bir silmenin engelleyicilerini alan bazlı açıklamak isterse, o
  endpoint `details` ile birlikte bilinçli olarak `422` fırlatır. Bu ADR, olası her yabancı
  anahtar yanıtını değil, ele alınmamış son çare davranışını yönetir.

## Değerlendirilen Alternatifler

| Alternatif                                     | Neden değil                                                                                                                                             |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `422 Unprocessable Entity` (denetimin önerisi) | Durum çakışmasını ve kaybedilmiş yarışı gövde doğrulama hatası olarak yanlış bildirir; ayrıca istemcinin okuyacağı `details` içermeyen bir `422` üretir |
| Insert tarafındaki biçim için `404 Not Found`  | Filtrede silme tarafındaki biçimden ayırt edilemez; "adlandırdığın satır orada yok" zaten `P2025`'in alanıdır                                           |
| `400 Bad Request`                              | Gövde iyi biçimlendirilmiştir ve doğrulamadan geçmiştir; hata istekte değil, veritabanının durumundadır                                                 |
| `P2003`'ü `meta.field_name`'e göre ayırmak     | Prisma kısıt adlarına dallanmak HTTP sözleşmesini şema adlandırmasına bağlar ve her iki dal da yine `409` yanıtı verirdi                                |
