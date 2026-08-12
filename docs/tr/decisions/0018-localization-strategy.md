# 0018. Yerelleştirme Stratejisi: URL Yönlendirmesi Olmadan next-intl

**Durum:** Kabul edildi
**Tarih:** 2026-08-12

> 🌐 [English (kanonik)](../../decisions/0018-localization-strategy.md) | Türkçe

## Bağlam

Ürün planı, İngilizce arayüzü baştan sona bitirmek ve ardından ikinci dil olarak Türkçeyi
eklemek. Bu da şu soruyu doğurdu: Türkçe için doğru araç next-intl mi, yoksa farklı bir
yaklaşım mı gerekiyor?

Dar sorunun cevabı şu: next-intl zaten kullanılan araç ve bir süredir öyle.
`NextIntlClientProvider` root layout'u sarıyor, `getLocale()` / `getMessages()` onu besliyor,
53 dosya `useTranslations` veya `getTranslations` çağırıyor ve `apps/web/messages/en.json`
yaklaşık 279 anahtar tutuyor. `formatRelativeTime` sabit `'en'` yerine zaten bir locale
parametresi alıyor. Uygulamayı tek dilli tutan tek şey `apps/web/i18n/request.ts` içindeki
tek satır:

```ts
const locale = 'en';
```

Yani asıl karar "hangi kütüphane" değil, o satırın ertelediği üç soru: locale nasıl seçilecek,
tercih nerede yaşayacak ve mesaj kataloğunda değil veritabanında duran metinlere ne olacak?

Cevabı iki kısıt şekillendiriyor. Birincisi, Kurultay'daki her sayfa kimlik doğrulama arkasında
— indekslenecek içerik yok ve bir tanıtım ya da dokümantasyon sitesi yapılırsa bu Next.js
uygulamasının dışında yaşayacak. İkincisi, `apps/api` tarafında hiç locale farkındalığı yok:
hatalar sabit kodlar ve bir HTTP durumu olarak dönüyor, web bunları `resolveApiMessage` ile
çeviri anahtarlarına eşliyor.

Bu ADR ürün yerelleştirmesi hakkında. Depo dokümantasyonundaki "İngilizce kanonik + `docs/tr`
aynası" kuralı ayrı ve ilgisiz bir gelenektir.

## Karar

next-intl kalıyor; ikinci bir i18n kütüphanesi getirilmiyor. Locale, **URL yönlendirmesi
olmadan**, `apps/web/i18n/request.ts` içinde uygulanan bir zincirden çözülüyor:

```
User.locale  →  locale çerezi  →  Accept-Language  →  'en'
```

`[locale]` yol parçası yok, i18n middleware'i yok. Bunun yanında:

1. **Locale kullanıcı düzeyinde bir tercihtir**, `User` üzerinde nullable bir IETF etiketi
   olarak saklanır ve kullanıcı dil seçtiğinde bir çereze yansıtılır. Workspace ayarı değildir.
2. **Backend arayüz çevirisinden uzak durur.** API hata kodları ve durumları döndürmeye devam
   eder; mesaj kataloğunun sahibi web'dir. API `Accept-Language`'ı yalnızca kullanıcı adına
   veritabanına yazdığı içerik için ve giden e-postalar için okur.
3. **Saklanan metinler yeniden adlandırılabilirlik kuralına uyar:** kullanıcı yeniden
   adlandırabiliyorsa o kullanıcı verisidir — yaratıcının dilinde tohumla ve düz string olarak
   sakla. Kullanıcı yeniden adlandıramıyorsa (`priority`, roller, enum etiketleri) sistem
   verisidir — enum'u sakla, çeviriyi web yapsın.
4. **İngilizce kanonik kalır.** `messages/en.json` tek doğruluk kaynağıdır; `tr.json` ancak
   İngilizce arayüz tamamlandığında eklenir.

## Gerekçe

- `[locale]` yol parçasının tek gerçek getirisi SEO'dur: her dil için ayrı URL artı `hreflang`.
  Kurultay'da indekslenen hiçbir şey yok, dolayısıyla bu getiri geçerli değil; ona ihtiyaç
  duyacak tanıtım sitesinin de başka yerde yaşaması planlanıyor.
- Yol parçasının maliyeti ise anında ve eksiksiz ödenir: tüm `app/` ağacı `app/[locale]/`
  altına taşınır, Better Auth'un oturum akışının yanına bir middleware iner ve her `<Link>` ile
  `router.push` next-intl'in locale-farkında sarmalayıcılarına geçmek zorunda kalır. Bu geçişi
  kaçıran her çağrı yeri kullanıcının dilini sessizce sıfırlar — doğal olarak yakalayan bir
  testi olmayan, sessiz bir hata biçimi.
- next-intl, yönlendirmesiz kurulumu birinci sınıf bir yapılandırma olarak belgeliyor;
  dolayısıyla bu seçim kütüphaneye ters düşmüyor ve desteklenen yolun dışına çıkmıyor.
- Workspace düzeyi yerine kullanıcı düzeyi, çünkü bir workspace meşru şekilde farklı diller
  okuyan üyeler barındırır. Workspace geneli bir ayar, bunlardan birini yanlış arayüze mahkûm
  ederdi.
- Çeviriyi backend'in dışında tutmak aynı kataloğu iki kez sürdürmeyi önler. API zaten kodlarla
  konuşuyor; ona iki dilde düzyazı vermek web'in kataloğuyla API'nin kataloğunun ayrışmasına
  yol açardı.

## Sonuçlar

- `User` nullable bir `locale` sütunu ve bir migration kazanır; bir ayarlar ekranı bunu açığa
  çıkarmalıdır. Giden e-postaların alıcının dilini bilmesi gerektiği için tercih yalnızca
  çerezde değil veritabanında yaşamak zorundadır.
- `apps/web/i18n/request.ts` çözümleme zincirini ve dil değişiminde bir çerez yazımını kazanır.
- Kimlik doğrulaması olmayan route'lar — özellikle `/invite/[invitationId]` — `Accept-Language`
  üzerinden çözülür, yani davet edilen kişi oturum açmadan kendi dilini görür. İstenen davranış
  budur ve davet akışının yol parçası yaklaşımını zorunlu kılmamasının başlıca sebebidir.
- Paylaşılan bir board URL'i dil taşımaz: alıcı onu göndericinin değil **kendi** dilinde görür.
  Bilinçli olarak kabul edildi; genellikle insanların istediği de budur.
- İki dili yan yana incelemek ayrı tarayıcı profilleri ya da gizli pencere gerektirir.
- **Ertelendi, reddedilmedi:** bir tanıtım veya dokümantasyon sitesi bir gün bu uygulamanın
  _içine_ taşınırsa, `[locale]` yönlendirmesi o noktada getirilmek zorundadır ve geçiş yukarıda
  anlatılan tam maliyettir. Erteleme bir gözden kaçırma değil bir karar olarak kalsın diye
  tetikleyici burada kayıtlıdır.
- Bundan sonra kullanıcıya görünen her yeni metin `messages/en.json` üzerinden geçer. Sabit
  kodlanmış bir string kestirme değil bir kusurdur, çünkü Türkçe turuna görünmez ve eksik
  anahtar olarak da ortaya çıkmaz.
- API daha önce hiç sahip olmadığı küçük bir locale farkındalığı — `Accept-Language` okuma —
  kazanır. Bu, veritabanı tohumlaması ve e-posta ile sınırlıdır.

## Değerlendirilen alternatifler

| Alternatif                                                      | Neden olmadı                                                                                                                                                                    |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `[locale]` yol parçası (next-intl'in yönlendirmeli varsayılanı) | SEO getirisi indekslenebilir sayfası olmayan bir uygulamada geçersiz; buna karşılık tüm route ağacına, bir middleware'e ve bugünden başlayan kalıcı link disiplinine mal oluyor |
| Workspace düzeyinde locale                                      | Bir workspace meşru şekilde farklı diller okuyan üyelere sahiptir; ortak bir ayar birini yanlış dile mahkûm eder                                                                |
| Backend i18n (`nestjs-i18n`, `Accept-Language` ile düzyazı)     | Web'in zaten sahip olduğu kataloğu ikizler ve ayrışmalarına izin verir; API zaten `resolveApiMessage` ile eşlenen kodlar döndürüyor                                             |
| react-i18next veya Lingui'ye geçmek                             | next-intl 53 dosyada zaten entegre ve App Router'ın doğal seçeneği; takas hiçbir şey kazandırmaz, çalışan kodu yeniden yazar                                                    |
| İstek anında makine çevirisi                                    | Ürün sözlüğü öngörülemez hale gelir, istek başına gecikme ve maliyet doğar, metni kullanıcı görmeden gözden geçirmenin yolu kalmaz                                              |
