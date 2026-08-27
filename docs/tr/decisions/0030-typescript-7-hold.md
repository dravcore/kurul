# 0030. TypeScript, typescript-eslint ve ts-jest 7'yi Destekleyene Kadar 5.x Hattında Kalır

**Durum:** Kabul edildi

**Tarih:** 2026-08-23

> 🌐 [English (kanonik)](../../decisions/0030-typescript-7-hold.md) | Türkçe (bu çeviri güncel olmayabilir; kanonik kaynak İngilizce'dir)

## Bağlam

TypeScript 7.0 (Go'ya yeniden yazılmış, ~10x daha hızlı, önceden `tsgo` diye bilinen derleyici)
2026-08-20'de `typescript@7.0.2` olarak genel kullanıma açıldı. `typescript`, bu deponun dört
`package.json` dosyasında (kök, `apps/api`, `apps/web`, `packages/auth-access`,
`packages/shared-types`) `^5.8.2` olarak sabitlenmiş ve lockfile'da `5.9.3`'e çözümleniyor.
`.github/dependabot.yml` zaten `typescript`'in majör sürüm atlamalarını reddeden bir `ignore`
kuralı taşıyor; yorumu iki peer-range tavanını gerekçe gösteriyordu. O yorum, TypeScript
7.0 çıkmadan önce, yalnızca yayınlanmış peer aralıklarının gücüyle yazılmıştı; bu ADR onu
gerçekte yayında olanla karşılaştırıyor, bakımcıları doğrudan alıntılıyor ve holde gelecekteki
bir PR'ın hiçbir şeyi yeniden türetmeden kontrol edebileceği bir tetikleyici veriyor.

**Bugün kurulu olana göre doğrulanmış, tahmin edilmemiş, 7'yi engelleyenler:**

- **`typescript-eslint`** (peer aralığını gerçekte taşıyan paket olan
  `@typescript-eslint/typescript-estree`), bu deponun çalıştırdığı `8.67.0` sürümü itibarıyla
  `"typescript": ">=4.8.4 <6.1.0"` beyan ediyor. İki uyumluluk raporu —
  [typescript-eslint#12720](https://github.com/typescript-eslint/typescript-eslint/issues/12720)
  ve [#12518](https://github.com/typescript-eslint/typescript-eslint/issues/12518) — TypeScript
  7'nin yayınlandığı gün `NOT_PLANNED` olarak kapatıldı. Bakımcı bradzacher, projenin sabitlenmiş
  takip issue'sunda [#10940](https://github.com/typescript-eslint/typescript-eslint/issues/10940):
  "Şimdilik - tsgo / TSv7'yi desteklemek için yapabileceğimiz hiçbir şey yok. Blog yazısında
  belirtildiği ve yukarıda vurgulandığı gibi - şu anda kararlı bir JS API'si yok." O issue artık
  kilitli, API'yi bekliyor.
- **`ts-jest`**, bu deponun çalıştırdığı `29.4.12` sürümü itibarıyla
  `"typescript": ">=4.3 <7"` beyan ediyor.
  [kulshekhar/ts-jest#5366](https://github.com/kulshekhar/ts-jest/issues/5366) açık; bakımcı
  kulshekhar, çok geniş kapsamlı ilk kapatmadan sonra issue'yu yeniden açarken: "TypeScript 7
  şu anda ts-jest'in bağımlı olduğu JavaScript derleyici API'sinden yoksun, bu yüzden gerçek
  destek yalnızca peer aralığını genişletmekle değil farklı bir entegrasyonla mümkün...
  Esasen 7.1'i beklememiz gerekecek (kararlı programatik API'nin 7.1'de geleceği varsayımıyla)."
- **TypeScript ekibi kendi sürümü için aynı şeyi söylüyor.**
  ["Announcing TypeScript 7.0"](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)
  devblog yazısından: "TypeScript 7.0 burada olsa da bir API ile gelmiyor. TypeScript 7.1'in
  yeni (ve farklı) bir API ile geleceğini bekliyoruz, ama o zamana kadar derleyiciye hâlâ
  programatik erişime ihtiyaç duyan araçlar (typescript-eslint gibi) için TypeScript'i
  TypeScript 6.0 ile yan yana çalıştırabilmeyi öncelik haline getirdik." Tam da bu geçiş dönemi
  için bir `@typescript/typescript6` uyumluluk paketi (bir `tsc6` ikili dosyası artı 6.0 API'sinin
  yeniden dışa aktarımı) yayınlıyorlar. 7.1 için bir yayın tarihi verilmiyor; aynı yazı
  2026-08-20 GA'sından itibaren "TypeScript 7.0'dan önceki sürümlere oldukça benzer bir zaman
  çizelgesi, her 3-4 ayda bir yeni özellikli sürümler" tahmin ediyor, yani 2026'nın sonlarına
  doğru bir zaman.

**Aynı şekilde kontrol edilmiş ve 7'yi engellemeyenler — kimse yeniden tartışmasın diye
kayda geçirilmeye değer:**

- **Prisma.** `prisma` paketinin `peerDependencies.typescript`'i `">=5.4.0"` — açık uçlu,
  7 tarafından zaten karşılanıyor. Generator veya CLI'da hiçbir şey bir TypeScript majör
  sürümüne bağlı değil.
- **`@nestjs/cli`.** Hiç `typescript` `peerDependency`'si yok. Kendi `typescript`'ini
  (`5.9.3`'e sabitlenmiş) düz bir `dependency` olarak taşıyor; `nest build`'in varsayılan
  tsc tabanlı derlemesi için dahili olarak kullanıyor — yani workspace'in kurulu TypeScript
  sürümü tarafından kurulum anında kısıtlanmıyor. (`nest build`'in 7.x bir tsconfig'e karşı
  temiz tip kontrolü yapıp yapmadığı burada test edilmedi, çünkü yukarıdaki iki engelleyici
  hâlâ tuttuğu sürece 7 zaten kurulamıyor.)
- **Next.js 16 (`16.3.0`).** Hiç `typescript` `peerDependency`'si yok. `next build` sırasındaki
  tip kontrolü isteğe bağlı ve projenin çözümlediği her ne `typescript` ise onu okuyor; bir
  sürüm kapısı değil.
- **Vitest (`4.1.10`).** Hiç `typescript` `peerDependency`'si yok — peer'leri `vite`, `jsdom`,
  `happy-dom`, `@types/node` ve kendi plugin paketleri. `apps/web`'in test çalıştırıcısının bu
  eksende hiçbir TypeScript-sürüm bağımlılığı yok.

Yani hold, "TypeScript ekosistemi hazır değil"den daha dar: tam olarak iki paket engelliyor,
ikisi de aynı sebeple (hem kendi hem de Microsoft'un kendi ifadesine göre, çalışacak kararlı bir
TypeScript 7 derleyici API'si yok), ve iki bakımcı da aynı çözüme işaret ediyor.

## Karar

**`typescript`, dört `package.json` dosyasının hepsinde `^5.8.2` kalır ve
`dependabot.yml`'in `typescript` majör sürüm güncellemeleri için ignore kuralı, aşağıdakilerin
ikisi de doğru olana kadar kalır:**

1. `typescript-eslint` (`@typescript-eslint/typescript-estree`'nin yayınlanmış
   `peerDependencies.typescript`'i üzerinden kontrol edilir) kararlı, prerelease olmayan bir
   sürümde `7.x`'i kabul ediyor.
2. `ts-jest`'in yayınlanmış `peerDependencies.typescript`'i kararlı, prerelease olmayan bir
   sürümde `7.x`'i kabul ediyor.

**Tetikleyici, ya Dependabot bir sonraki `typescript` majör atlamasını önerdiğinde (bugün
öneremiyor — ignore kuralı onu filtreliyor — yani bu elle kontrol etmek anlamına geliyor) ya da
2026-12-01'e kadar, hangisi önce gelirse:** yukarıdaki iki peer aralığını npm'den
(`npm view typescript-eslint peerDependencies`, `npm view ts-jest peerDependencies`) veya
`CHANGELOG.md`'lerinden oku. İkisi de `7`'yi içeriyorsa, tek bir değişiklikte: `typescript`'i
dört `package.json` dosyasının hepsinde `^7.x`'e yükselten, `dependabot.yml` ignore kuralını
(ve bu ADR'nin yorum referansını, bir satırlık bir notla yerini alarak) kaldıran ve birleştirmeden
önce `pnpm lint`, `pnpm test`, `pnpm typecheck`, `nest build` ve `next build`'i bir kez 7'ye karşı
çalıştıran bir PR aç — son ikisi bugün temiz kanıtlanmış değil çünkü iki engelleyici hâlâ tutarken
7 kurulamıyor, yani ilk gerçek atlama aynı zamanda onların ilk gerçek testi de olacak. Yalnızca
biri doğruysa, kontrol edilen tarihi ve hangi paketin hâlâ engellediğini bu ADR'nin
changelog'una kaydet ve tüm resmi yeniden türetmek yerine üç ay daha ertele.

`.github/dependabot.yml`'in `ignore` yorumu bu PR'da, gerekçeyi satır içinde tekrarlamak
yerine bu ADR'ye işaret edecek şekilde güncellendi.

## Gerekçe

**Neden bir üst-sınır peer aralığı geçilebilir bir şey değil de sert bir engelleyici olarak
ele alınıyor.** `pnpm install`, `typescript-eslint@8.67.0`'ın `<6.1.0` tavanına karşı
`typescript@7` kurulumunu doğrudan reddediyor (`ERESOLVE`/peer dep hatası) ve bunu override'larla
zorlamak gerçekte neyin bozulduğunu değiştirmiyor: `ts-jest`'in kendi uyumluluk sayfası (yeniden
açılan issue'sundan referanslanan), TypeScript 7'nin "ts-jest'in gerektirdiği JavaScript derleyici
API'sini açığa çıkarmadığını" belgeliyor — transform kurulum anında değil, çalışma anında
çöküyor, yani bir override, yüksek sesli bir hatayı sessiz bir hatayla takas ederdi. Hiçbir araç
paketlemede geride değil; her iki bakımcı da kamuya açık olarak, kayıtlarda, bağımlı oldukları
API'nin 7.0'da henüz var olmadığını söyledi. Bu depo, ikisini de daha erken açacak hiçbir şey
yapamaz.

**Neden tetikleyici "TypeScript 7.1 çıkar" değil de "her iki peer aralığı da 7'yi kabul eder."**
7.1'in vaat edilen API ile çıkması gerekli ama yeterli değil — her iki bakımcının da ona karşı
bir sürüm kesmesi gerekiyor, ve yukarıdaki `ts-jest` tarihçesi (`29.4.12`, issue çözümü iddiasıyla
yayınlandı ve kullanıcılar peer aralığının değişmediğini bildirdikten günler sonra yeniden
açıldı) "TypeScript 7'ye referans veren bir sürüm" ile "peer aralığı gerçekten genişleyen bir
sürüm"ün aynı olay olmadığını gösteriyor. Yayınlanmış aralığı kontrol etmek, yarı doğru
olamayacak tek sinyal.

**Neden bu depo geneli bir sabitleme, paket başına değil.** Dört `package.json` dosyası zaten
aynı `^5.8.2`'yi taşıyor, ve iki engelleyici peer `apps/api`'de (`ts-jest`) ve workspace kökünde
(`typescript-eslint`, her iki uygulamanın lint config'i tarafından paylaşılıyor) oturuyor.
Bölünmüş bir sürüm, her tüketen paketin kendi `typescript`'ini çözümlemesini gerektirirdi;
bu kadar geniş paylaşılan bir peer dependency için `pnpm`'in workspace hoisting'i bunu vermiyor,
ve bugün kimsenin engellenmediği bir derleyici hız kazancı için bir engellenmiş yükseltmeyi
"bu dosya hangi typescript'i görüyor" hata matrisine çevirirdi.

## Sonuçlar

- `pnpm install`, `pnpm lint` ve `pnpm test` (`apps/api`'de `ts-jest` üzerinden) tam olarak
  bugünkü gibi çalışmaya devam ediyor; bu ADR mevcut davranışta hiçbir şeyi değiştirmiyor,
  yalnızca bir sonraki rutin bağımlılık atlamasını durduran şeyi değiştiriyor.
- `.github/dependabot.yml`'in `typescript` majör güncellemeleri için `ignore` kuralı artık
  iki peer aralığını satır içinde tekrarlamak yerine bu ADR'yi yoluyla anıyor, böylece iki
  belge sessizce birbirinden sapamıyor — aralıklardan birindeki bir değişiklik, ikisini de
  yeniden okumak için bir sebep.
- Nihai atlama kasıtlı olarak bir `nest build` / `next build` kontrolüyle paketlendi, çünkü
  bu ikisi bu toolchain'in henüz kimsenin 7'ye karşı test edemediği parçaları (kuruluma resmi
  bir peer kapısı engel olmuyor, ama bu aynı zamanda kimsenin _build_'i temiz kanıtlamadığı
  anlamına da geliyor) — yukarıdaki "engellemeyenler" listesine bakın.
- Bu depoda bugün TypeScript 7 sözdizimi veya API değişikliklerini öngörerek yazılmış hiçbir
  kod yok; önceden taşınacak bir şey yok, yalnızca sürüm sabitlemesi ve beklenen iki upstream
  sürümü var.

## Değerlendirilen alternatifler

| Alternatif                                                                                             | Neden olmaz                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Atlamayı pnpm override'larla zorla, peer uyarısını yok say                                             | Uyarı gerçek hata değil — `ts-jest`, TS7 ikilisi çağırdığı derleyici API'sini açığa çıkarmadığı için transform zamanında çöküyor; bu, yüksek sesli bir `pnpm install` hatasını CI'da başarısız testlerle takas eder                                     |
| TypeScript 6 ve 7'yi yan yana alias'la (lint/test için `@typescript/typescript6`, build için gerçek 7) | Kurulu derleyiciyi ikiye katlar, ekibin geri kalanının beklemeyeceği paket başına alias gerektirir ve deponun şu an engellenmediği bir derleme-hızı kazancı satın alır — 7.1 çıkmadan önce bu karmaşıklığa değmez                                       |
| Bir engelleyiciyi erken kaldırmak için `ts-jest`'i şimdi `@swc/jest` ile değiştir                      | TS7 sorusuyla ilgisiz bir transform-motoru değişimi, `pnpm test`'in gerçekte tip kontrolü yaptığı şeyi değiştirir (`@swc/jest` tip kontrolü yapmaz) ve `typescript-eslint`'i yine de tek başına sert bir engelleyici olarak bırakır                     |
| ADR yok; dependabot yorumunu tek kayıt olarak bırak                                                    | Hardening roadmap maddesi, ignore kuralının işaret edebileceği alıntılanabilir bir karar istedi; yalnızca bir yorumda bakımcıların kendi ifadelerine veya gelecekteki bir PR'ın bunu yeniden araştırmadan kontrol edebileceği bir tetikleyiciye yer yok |
| "TypeScript 7.1 yayınlandı" yerine peer aralıklarını tetikleyici yap                                   | Gerekli ama yeterli değil — yukarıdaki `ts-jest` tarihçesi, bir sürümün peer aralığı gerçekten genişlemeden TS7 desteğine referans verebileceğini gösteriyor; aralık, yarı doğru olamayacak tek iddia                                                   |
